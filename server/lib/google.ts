import { openSecret, sealSecret } from "./crypto";
import type { Deps } from "./context";
import { HttpError } from "./http";
import type { ConnectionRow, ServerStore } from "./store";

/** What the user chooses to grant. Gmail access always includes the calendar. */
export type GoogleAccess = "calendar" | "gmail";
const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"];
const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"];
export const GOOGLE_SCOPES: Record<GoogleAccess, string[]> = {
  calendar: ["openid", "email", ...CALENDAR_SCOPES],
  gmail: ["openid", "email", ...CALENDAR_SCOPES, ...GMAIL_SCOPES],
};
export const hasCalendar = (scopes: string[]) => CALENDAR_SCOPES.every(s => scopes.includes(s));
export const hasGmail = (scopes: string[]) => GMAIL_SCOPES.every(s => scopes.includes(s));
const STATE_TTL_MS = 10 * 60 * 1000;

const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - text.length % 4) % 4)), c => c.charCodeAt(0));
const sha256 = async (text: string) => base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))));

/** HMAC key for OAuth state, derived from the server's secrets key so no extra secret is needed. */
async function stateKey(secretsConfig: string): Promise<CryptoKey> {
  const first = secretsConfig.split(",")[0]?.trim() || "";
  const material = first.includes(":") ? first.split(":", 2)[1] : first;
  if (!material) throw new HttpError(503, "Secure storage is not set up on this server yet.");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`synapse-oauth-state|${material}`));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export function googleConfig(deps: Deps, request: Request) {
  const config = deps.google?.();
  if (!config) throw new HttpError(503, "Google connections are not set up on this server yet.");
  return { ...config, redirectUri: config.redirectUri || `${new URL(request.url).origin}/connect/google` };
}

/**
 * Starts a connection. The PKCE verifier goes back to the browser that started it; the signed state binds
 * this user, the requested access, the verifier and a 10-minute expiry, so a callback from another
 * session, account or attempt is rejected.
 */
export async function startGoogleConnection(deps: Deps, request: Request, userId: string, access: GoogleAccess, now = Date.now()) {
  const { clientId, redirectUri } = googleConfig(deps, request);
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = await sha256(verifier);
  const payload = base64url(encoder.encode(JSON.stringify({ u: userId, a: access, c: challenge, e: now + STATE_TTL_MS, n: base64url(crypto.getRandomValues(new Uint8Array(12))) })));
  const signature = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", await stateKey(deps.secretsKey()), encoder.encode(payload))));
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: GOOGLE_SCOPES[access].join(" "),
    access_type: "offline", prompt: "consent", include_granted_scopes: "true",
    state: `${payload}.${signature}`, code_challenge: challenge, code_challenge_method: "S256",
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, verifier };
}

async function verifyState(deps: Deps, state: string, userId: string, verifier: string, now: number): Promise<GoogleAccess> {
  const [payload, signature] = state.split(".");
  let valid = false;
  try { valid = !!payload && !!signature && await crypto.subtle.verify("HMAC", await stateKey(deps.secretsKey()), fromBase64url(signature), encoder.encode(payload)); }
  catch { valid = false; }
  if (!valid) throw new HttpError(400, "This connection link is invalid. Start again from Settings.");
  const data = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as { u: string; a: GoogleAccess; c: string; e: number };
  if (data.u !== userId) throw new HttpError(400, "This connection was started by a different account. Start again from Settings.");
  if (data.e < now) throw new HttpError(400, "This connection link expired. Start again from Settings.");
  if (await sha256(verifier) !== data.c) throw new HttpError(400, "This connection was started in a different browser. Start again from Settings.");
  if (data.a !== "calendar" && data.a !== "gmail") throw new HttpError(400, "Invalid connection request.");
  return data.a;
}

/** Finishes a connection: exchanges the code, then stores the refresh token encrypted and the granted scopes. */
export async function completeGoogleConnection(deps: Deps, request: Request, store: ServerStore, input: { code: string; state: string; verifier: string }, now = Date.now()) {
  await verifyState(deps, input.state, store.userId, input.verifier, now);
  const { clientId, clientSecret, redirectUri } = googleConfig(deps, request);
  const response = await upstream(deps)("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: input.code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: input.verifier }),
  });
  const token = await response.json().catch(() => ({})) as { refresh_token?: string; access_token?: string; scope?: string; id_token?: string; error_description?: string };
  if (!response.ok || !token.access_token) throw new HttpError(400, `Google did not complete the connection${token.error_description ? `: ${token.error_description}` : "."}`);
  if (!token.refresh_token) throw new HttpError(400, "Google did not grant offline access. Remove Synapse at myaccount.google.com/permissions and connect again.");
  const scopes = (token.scope || "").split(/\s+/).filter(Boolean);
  if (!hasCalendar(scopes)) throw new HttpError(400, "Calendar access was not granted, so nothing was connected. Allow calendar access to continue.");
  const email = idTokenEmail(token.id_token);
  if (!email) throw new HttpError(400, "Google did not share the account's email address.");
  const sealed = await sealSecret(deps.secretsKey(), store.userId, "google", token.refresh_token);
  await store.putSecret("google", { ...sealed, hint: email.slice(0, 8) });
  await store.putConnection({ provider: "google", accountEmail: email, scopes, status: "active" });
  await store.appendAudit({ actor: "user", action: "connected", entityType: "connection", entityId: "google", title: `Google (${email}): ${hasGmail(scopes) ? "Calendar and Gmail" : "Calendar"}` });
  return connectionStatus(await store.getConnection("google"));
}

/** The email claim of an ID token received directly from Google's token endpoint over TLS. */
function idTokenEmail(idToken?: string): string | null {
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(idToken!.split(".")[1])));
    return typeof claims.email === "string" && claims.email.includes("@") ? claims.email : null;
  } catch { return null; }
}

export function connectionStatus(row: ConnectionRow | null) {
  if (!row) return { connected: false as const };
  return { connected: true as const, email: row.accountEmail, calendar: hasCalendar(row.scopes), gmail: hasGmail(row.scopes), status: row.status, connectedAt: row.connectedAt, lastError: row.lastError };
}

/** Revokes the grant at Google (best effort) and deletes the token and connection. */
export async function disconnectGoogle(deps: Deps, store: ServerStore) {
  const sealed = await store.getSecret("google");
  if (sealed) {
    try {
      const token = await openSecret(deps.secretsKey(), store.userId, "google", sealed);
      await upstream(deps)(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
    } catch { /* Deleting our copy still disconnects; the grant can also be removed at myaccount.google.com. */ }
  }
  await store.deleteSecret("google");
  await store.deleteConnection("google");
  await store.appendAudit({ actor: "user", action: "disconnected", entityType: "connection", entityId: "google", title: "Google" });
}

const upstream = (deps: Deps): typeof fetch => deps.googleFetch ?? ((...args) => fetch(...args));

/** Authorized access to Google's APIs for one request. Tokens stay in memory and are never returned. */
export interface GoogleSession {
  scopes: string[];
  email: string;
  json<T = any>(url: string, init?: RequestInit): Promise<T>;
}

/** Opens a session for a connected user, or returns null when Google is not connected or needs reconnecting. */
export async function googleSession(deps: Deps, store: ServerStore): Promise<GoogleSession | null> {
  if (!deps.google?.()) return null;
  const connection = await store.getConnection("google");
  if (!connection || connection.status !== "active") return null;
  const sealed = await store.getSecret("google");
  if (!sealed) return null;
  const refreshToken = await openSecret(deps.secretsKey(), store.userId, "google", sealed);
  const { clientId, clientSecret } = deps.google()!;
  const fetchImpl = upstream(deps);
  let accessToken = "";
  let expiresAt = 0;
  const needsReconnect = async (message: string) => {
    await store.markConnection("google", { status: "needs_reconnect", lastError: message });
    return new HttpError(409, "Google access expired or was revoked. Reconnect Google in Settings.");
  };
  const refresh = async () => {
    const response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    const body = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
    if (body.error === "invalid_grant" || response.status === 401) throw await needsReconnect("The refresh token was rejected (expired or revoked).");
    if (!response.ok || !body.access_token) throw new HttpError(502, "Google is not responding right now. Try again in a moment.");
    accessToken = body.access_token;
    expiresAt = Date.now() + Math.max(60, (body.expires_in || 3600) - 60) * 1000;
  };
  let used = false;
  return {
    scopes: connection.scopes,
    email: connection.accountEmail,
    async json(url, init = {}) {
      if (!accessToken || Date.now() >= expiresAt) await refresh();
      const send = () => fetchImpl(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${accessToken}` } });
      let response = await send();
      if (response.status === 401) { await refresh(); response = await send(); }
      if (response.status === 401) throw await needsReconnect("Google rejected the access token.");
      if (response.status === 403) throw new HttpError(403, "Google denied access. The permission may not have been granted; reconnect Google in Settings.");
      if (!response.ok) throw new HttpError(502, `Google returned an error (HTTP ${response.status}).`);
      if (!used) { used = true; await store.markConnection("google", { used: true, lastError: null }); }
      return response.status === 204 ? undefined : response.json();
    },
  };
}

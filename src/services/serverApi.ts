import { getSupabase, managedAuthEnabled } from "./managedAuth";

/** The signed-in user's current access token (refreshed by Supabase as needed). */
export async function accessToken(): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again to continue.");
  return token;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await accessToken()}`, ...(init.body ? { "Content-Type": "application/json" } : {}) } });
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `Server request failed (HTTP ${response.status}).`);
  return body as T;
}

let canRelay: boolean | undefined;
/**
 * Asks the app's server to read a link, because browsers can't read most other sites. Returns null when
 * there is no server to ask (desktop builds, static hosts), so the caller fetches the page itself.
 */
export async function readUrlOnServer(url: string, offset: number, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  if (canRelay === false) return null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (managedAuthEnabled) {
    try { headers.Authorization = `Bearer ${await accessToken()}`; } catch { return null; }
  }
  let response: Response;
  try {
    response = await fetch("/api/read", { method: "POST", headers, body: JSON.stringify({ url, offset }), signal });
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
  // Hosts without the API answer with the app's own page or a 404.
  if (!(response.headers.get("content-type") || "").includes("application/json") || response.status === 404 || response.status === 405) {
    canRelay = false;
    return null;
  }
  const body = await response.json().catch(() => null);
  if (response.ok && body) { canRelay = true; return body; }
  if (response.status === 422) throw new Error(body?.error || "The page couldn't be read.");
  return null;
}

export interface ServerFeatures { secrets: boolean; agent: boolean; approvals: boolean; google: boolean; telegram: boolean }
const NONE: ServerFeatures = { secrets: false, agent: false, approvals: false, google: false, telegram: false };
let features: Promise<ServerFeatures> | undefined;
/**
 * What the server offers. Hosts without the API (desktop, static previews) report nothing, and the app
 * keeps working entirely in the browser.
 */
export function serverFeatures(): Promise<ServerFeatures> {
  if (!managedAuthEnabled) return Promise.resolve(NONE);
  return features ??= fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(5000) })
    .then(async response => {
      if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) return NONE;
      const body = await response.json();
      return { secrets: body.secrets === true, agent: body.agent === true, approvals: body.approvals === true, google: body.google === true, telegram: body.telegram === true };
    })
    .catch(() => { features = undefined; return NONE; });
}

export interface StoredKeyStatus { configured: boolean; hint?: string; updatedAt?: string }
export const getStoredKey = () => apiJson<{ openrouter: StoredKeyStatus }>("/api/secrets").then(r => r.openrouter);
export const storeKey = (value: string, opts?: { base?: string; model?: string }) => apiJson<{ openrouter: StoredKeyStatus }>("/api/secrets", { method: "POST", body: JSON.stringify({ name: "openrouter", value, ...(opts?.base ? { base: opts.base } : {}), ...(opts?.model ? { model: opts.model } : {}) }) }).then(r => r.openrouter);
export const removeStoredKey = () => apiJson<{ openrouter: StoredKeyStatus }>("/api/secrets?name=openrouter", { method: "DELETE" }).then(r => r.openrouter);

export interface AccountHistoryEntry { id: number; at: string; actor: "user" | "assistant" | "system"; action: string; entity_type: string | null; title: string | null }
/**
 * The account's append-only audit trail (who changed what, including approvals), read directly as the
 * signed-in user. Empty when the server migration is not applied yet.
 */
export async function accountHistory(limit = 100): Promise<AccountHistoryEntry[]> {
  if (!managedAuthEnabled) return [];
  const { data, error } = await (getSupabase() as any).from("audit_events").select("id,at,actor,action,entity_type,title").order("at", { ascending: false }).limit(limit);
  return error ? [] : (data || []) as AccountHistoryEntry[];
}

export interface GoogleStatus { configured?: boolean; connected: boolean; email?: string; calendar?: boolean; gmail?: boolean; send?: boolean; status?: "active" | "needs_reconnect"; connectedAt?: string; lastError?: string | null }
export interface GoogleCalendarEvent { id: string; title: string; date: string; endDate?: string; startTime?: string; endTime?: string; allDay: boolean; location?: string; link?: string; attendees: number }
export interface TelegramStatus { configured: boolean; linked: boolean; username?: string | null; briefEnabled: boolean; briefHour: number; alertsEnabled: boolean }
export const telegramStatus = () => apiJson<TelegramStatus>("/api/telegram");
export const startTelegramLink = (timeZone: string) => apiJson<{ url: string }>("/api/telegram", { method: "POST", body: JSON.stringify({ timeZone }) });
export const updateTelegramPrefs = (prefs: Partial<Pick<TelegramStatus, "briefEnabled" | "briefHour" | "alertsEnabled">> & { timeZone?: string }) => apiJson<TelegramStatus>("/api/telegram", { method: "PATCH", body: JSON.stringify(prefs) });
export const disconnectTelegram = () => apiJson<TelegramStatus>("/api/telegram", { method: "DELETE" });

export const googleStatus = () => apiJson<GoogleStatus>("/api/google");
export const disconnectGoogle = () => apiJson<GoogleStatus>("/api/google", { method: "DELETE" });

const VERIFIER_KEY = "synapse_google_verifier";
export const CONNECT_RESULT_KEY = "synapse_google_connect_result";
/** Sends the browser to Google's consent screen. The PKCE verifier waits in this tab until Google returns. */
export async function startGoogleConnect(access: "calendar" | "gmail" | "send"): Promise<void> {
  const { url, verifier } = await apiJson<{ url: string; verifier: string }>(`/api/google?action=start&access=${access}`);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  window.location.assign(url);
}
/**
 * Finishes a connection when Google redirects back to /connect/google. Returns null when this page load is
 * not a Google callback. The outcome is kept for the Connections panel to show.
 */
export async function finishGoogleConnect(): Promise<string | null> {
  if (window.location.pathname !== "/connect/google") return null;
  const params = new URLSearchParams(window.location.search);
  const verifier = sessionStorage.getItem(VERIFIER_KEY) || "";
  sessionStorage.removeItem(VERIFIER_KEY);
  window.history.replaceState(null, "", "/");
  let message: string;
  if (params.get("error")) message = params.get("error") === "access_denied" ? "Google connection cancelled. Nothing was connected." : `Google returned an error: ${params.get("error")}`;
  else {
    try {
      const status = await apiJson<GoogleStatus>("/api/google", { method: "POST", body: JSON.stringify({ code: params.get("code"), state: params.get("state"), verifier }) });
      message = `Connected ${status.email}: ${status.send ? "Calendar, Gmail and sending with your approval" : status.gmail ? "Calendar and Gmail" : "Calendar"}.`;
    } catch (error) { message = error instanceof Error ? error.message : "Could not connect Google."; }
  }
  sessionStorage.setItem(CONNECT_RESULT_KEY, message);
  return message;
}

const eventCache = new Map<string, Promise<GoogleCalendarEvent[]>>();
/** Google Calendar events between two dates, cached for this page session. Empty when not connected. */
export function googleEvents(from: string, to: string, refresh = false): Promise<GoogleCalendarEvent[]> {
  const key = `${from}|${to}`;
  if (refresh) eventCache.delete(key);
  let pending = eventCache.get(key);
  if (!pending) {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    pending = apiJson<{ events: GoogleCalendarEvent[] }>(`/api/google?action=events&from=${from}&to=${to}&timeZone=${encodeURIComponent(timeZone)}`)
      .then(r => r.events || []).catch(() => { eventCache.delete(key); return []; });
    eventCache.set(key, pending);
  }
  return pending;
}
export const clearGoogleEventCache = () => eventCache.clear();

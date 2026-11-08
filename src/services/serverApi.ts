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

export interface ServerFeatures { secrets: boolean; agent: boolean; approvals: boolean }
const NONE: ServerFeatures = { secrets: false, agent: false, approvals: false };
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
      return { secrets: body.secrets === true, agent: body.agent === true, approvals: body.approvals === true };
    })
    .catch(() => { features = undefined; return NONE; });
}

export interface StoredKeyStatus { configured: boolean; hint?: string; updatedAt?: string }
export const getStoredKey = () => apiJson<{ openrouter: StoredKeyStatus }>("/api/secrets").then(r => r.openrouter);
export const storeKey = (value: string) => apiJson<{ openrouter: StoredKeyStatus }>("/api/secrets", { method: "POST", body: JSON.stringify({ name: "openrouter", value }) }).then(r => r.openrouter);
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

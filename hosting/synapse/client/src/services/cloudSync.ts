import type { BrainState, AuthSession } from "../types";

export const cloudEnabled = import.meta.env.VITE_CLOUD_SYNC === "true";
let revision = 0;
let saved = "";
let dirty = false;
let pending = 0;
let status = "Connecting…";
export const cloudStatus = () => status;
function report(message: string) {
  status = message;
  window.dispatchEvent(new Event("synapse-sync-status"));
}
export function sharedState(state: BrainState) {
  const { openRouterKey: _key, userId: _user, ...shared } = state;
  return shared;
}
async function request(method = "GET", body?: unknown) {
  const response = await fetch("/api/brain", { method, credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 409) throw new Error("Another device saved changes. Export your work, then reload before editing again.");
  if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to sync." : "Cloud unavailable. Keep this tab open and retry.");
  return response.json();
}
export async function loadCloud(): Promise<{ state: Partial<BrainState>; session: AuthSession }> {
  const data = await request();
  revision = data.revision;
  saved = data.state ? JSON.stringify(data.state) : "";
  dirty = false;
  report("Synced");
  return { state: data.state || { tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [] },
    session: { isGuest: false, currentUser: { id: data.user.id, email: data.user.email, name: data.user.email.split("@")[0], provider: "google", createdAt: "", lastLoginAt: "" } } };
}
export async function cloudSession(): Promise<AuthSession> {
  return (await loadCloud()).session;
}
export async function saveCloud(state: BrainState) {
  const payload = sharedState(state);
  const text = JSON.stringify(payload);
  if (text === saved) return;
  dirty = true;
  pending++;
  report("Saving…");
  try {
    const data = await request("PUT", { revision, state: payload });
    revision = data.revision;
    saved = text;
    dirty = false;
    report("Synced");
  } catch (error) {
    report(error instanceof Error ? error.message : "Sync failed");
    throw error;
  } finally { pending--; }
}
export function markCloudDirty() { dirty = true; }
export async function refreshCloud(current: BrainState, isCurrent: () => boolean = () => true): Promise<BrainState | null> {
  if (pending || dirty || JSON.stringify(sharedState(current)) !== saved) return null;
  try {
    const data = await request();
    // An edit may have started while this read was in flight.
    if (!isCurrent() || pending || dirty || JSON.stringify(sharedState(current)) !== saved || data.revision <= revision) return null;
    revision = data.revision;
    saved = JSON.stringify(data.state);
    return { ...current, ...data.state, userId: current.userId, openRouterKey: current.openRouterKey };
  } catch { return null; }
}

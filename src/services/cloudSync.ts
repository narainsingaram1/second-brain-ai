import type { BrainState, AuthSession } from "../types";
import { getManagedSession, managedAuthEnabled } from "./managedAuth";
import { readManagedBrain, supabaseRecordTransport, writeManagedBrain } from "./supabaseBrain";
import { RecordSync } from "./recordSync";

export const cloudEnabled = import.meta.env.VITE_CLOUD_SYNC === "true" || managedAuthEnabled;
let revision = 0;
let ownerId = "";
let generation = 0;
let saved = "";
let dirty = false;
let pending = 0;
let status = "Connecting…";
/** Per-record sync for hosted accounts once the database supports it; otherwise the whole-snapshot path below. */
let records: RecordSync | undefined;
/** Asks the app to refresh now, e.g. after a save found records changed on another device. */
export const REMOTE_CHANGE_EVENT = "synapse-remote-change";
export const cloudStatus = () => status;
let notice = "";
/** Informational sync note, e.g. records replaced by another device's newer version. Not an error. */
export const cloudNotice = () => notice;
function report(message: string) {
  status = message;
  window.dispatchEvent(new Event("synapse-sync-status"));
}
export function sharedState(state: BrainState) {
  const { openRouterKey: _key, userId: _user, ...shared } = state;
  return shared;
}
async function request(method = "GET", body?: unknown, knownRevision?: number) {
  if (managedAuthEnabled) {
    if (method === "GET") return readManagedBrain(knownRevision);
    const args = body as { state: unknown; revision: number; ownerId: string };
    return writeManagedBrain(args.state, args.revision, args.ownerId);
  }
  const response = await fetch("/api/brain", { method, credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 409) throw new Error("Another device saved changes. Export your work, then reload before editing again.");
  if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to sync." : "Cloud unavailable. Keep this tab open and retry.");
  return response.json();
}
export async function loadCloud(): Promise<{ state: Partial<BrainState>; session: AuthSession }> {
  const runGeneration = ++generation;
  records = undefined;
  if (managedAuthEnabled) {
    const session = await getManagedSession();
    const engine = new RecordSync(supabaseRecordTransport(session.currentUser!.id), () => window.dispatchEvent(new Event(REMOTE_CHANGE_EVENT)));
    const state = await engine.load();
    if (runGeneration !== generation) throw new Error("Account changed during load. Reload before editing.");
    if (state) {
      records = engine;
      ownerId = session.currentUser!.id;
      dirty = false;
      report("Synced");
      return { state, session };
    }
  }
  const data = await request();
  if (runGeneration !== generation) throw new Error("Account changed during load. Reload before editing.");
  ownerId = data.user.id;
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
  const runGeneration = generation;
  if (records) {
    if (!ownerId || state.userId !== ownerId) throw new Error("Account changed. Reload before saving.");
    const engine = records;
    pending++;
    report("Saving…");
    try {
      await engine.save(sharedState(state));
      if (runGeneration !== generation) throw new Error("Account changed during save. Reload before editing.");
      report("Synced");
    } catch (error) {
      report(error instanceof Error ? error.message : "Sync failed");
      throw error;
    } finally { pending--; }
    return;
  }
  if (managedAuthEnabled && (!ownerId || state.userId !== ownerId)) throw new Error("Account changed. Reload before saving.");
  const payload = sharedState(state);
  const text = JSON.stringify(payload);
  if (text === saved) return;
  dirty = true;
  pending++;
  // The cloud rejects workspaces over 2 MB; warn well before that point.
  report(new TextEncoder().encode(text).length > 1_700_000 ? "Saving… (workspace is near the 2 MB cloud limit)" : "Saving…");
  try {
    const data = await request("PUT", { revision, state: payload, ownerId });
    if (runGeneration !== generation) throw new Error("Account changed during save. Reload before editing.");
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
export async function refreshCloud(current: BrainState, isCurrent: () => boolean = () => true, latest: () => BrainState | null = () => current): Promise<BrainState | null> {
  if (records) {
    const engine = records;
    try {
      const next = await engine.refresh(() => isCurrent() && engine === records ? latest() : null);
      if (!next) return null;
      if (engine.lastRefreshConflicts) {
        notice = `${engine.lastRefreshConflicts} record${engine.lastRefreshConflicts === 1 ? " was" : "s were"} edited on another device at the same time; the newer saved version was kept.`;
        report(status);
      }
      return next;
    } catch { return null; }
  }
  if (pending || dirty || JSON.stringify(sharedState(current)) !== saved) return null;
  try {
    const runGeneration = generation;
    const data = await request("GET", undefined, revision);
    if (data.unchanged || runGeneration !== generation || data.user.id !== ownerId) return null;
    // An edit may have started while this read was in flight.
    if (!isCurrent() || pending || dirty || JSON.stringify(sharedState(current)) !== saved || data.revision <= revision) return null;
    revision = data.revision;
    saved = JSON.stringify(data.state);
    return { ...current, ...data.state, userId: current.userId, openRouterKey: current.openRouterKey };
  } catch { return null; }
}

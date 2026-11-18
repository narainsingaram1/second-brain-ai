import type { BrainState } from "../types";
import { SERVER_HELD_KEY } from "./providerTransport";

// A copy of the account's workspace as the cloud last confirmed it, kept in this browser so a reload can show
// the app at once and refresh from the cloud in the background. It is only a starting point: saves wait until
// the cloud copy has loaded, and the copy is deleted on sign-out. API keys are never stored here.

const DB_NAME = "synapse-startup-cache";
const STORE = "workspaces";
const VERSION = 1;

interface CachedWorkspace { userId: string; state: Partial<BrainState>; savedAt: number }

let opening: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("No IndexedDB"));
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "userId" }); };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading or deleting the database closes this connection; reopen on next use.
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Startup cache blocked"));
  });
  opening.catch(() => { opening = undefined; });
  return opening;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(db => new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Startup cache transaction aborted"));
  }));
}

const reads = new Map<string, Promise<Partial<BrainState> | null>>();
/** The last confirmed workspace for this account on this device, or null. Never throws. */
export function readStartupCache(userId: string): Promise<Partial<BrainState> | null> {
  let read = reads.get(userId);
  if (!read) {
    read = run<CachedWorkspace | undefined>("readonly", store => store.get(userId))
      .then(record => (record && record.userId === userId && record.state && typeof record.state === "object" ? record.state : null))
      .catch(() => null);
    // Kept until the next write, so the early read started at boot is reused by the app.
    reads.set(userId, read);
  }
  return read;
}

// Writing copies the whole workspace (a structured clone on the main thread), so it waits for an idle moment
// and only the newest pending copy is written.
let pending: CachedWorkspace | null = null;
let timer: { idle: boolean; id: number | ReturnType<typeof setTimeout> } | undefined;
function cancelTimer() {
  if (!timer) return;
  if (timer.idle) cancelIdleCallback(timer.id as number);
  else clearTimeout(timer.id as ReturnType<typeof setTimeout>);
  timer = undefined;
}
let writes = Promise.resolve();
let flushOnHide = false;
function flush() {
  cancelTimer();
  const job = pending;
  pending = null;
  if (!job) return;
  writes = writes.then(() => run("readwrite", store => { store.put(job); }).then(() => {}, () => {}));
}

/** Remembers the workspace the cloud just confirmed for this account. */
export function writeStartupCache(userId: string, state: Partial<BrainState>): void {
  if (!userId || typeof indexedDB === "undefined") return;
  const { openRouterKey: key, ...rest } = state;
  // Only the marker for a key kept on the server is stored, never a key itself.
  reads.delete(userId);
  pending = { userId, state: { ...rest, userId, ...(key === SERVER_HELD_KEY ? { openRouterKey: key } : {}) }, savedAt: Date.now() };
  if (!flushOnHide && typeof window !== "undefined") {
    // A reload right after a save should still start from that save.
    flushOnHide = true;
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  }
  if (timer) return;
  timer = typeof requestIdleCallback === "function"
    ? { idle: true, id: requestIdleCallback(flush, { timeout: 4000 }) }
    : { idle: false, id: setTimeout(flush, 1500) };
}

/** Deletes every cached workspace on this device (sign-out). */
export async function clearStartupCache(): Promise<void> {
  pending = null;
  reads.clear();
  cancelTimer();
  if (typeof indexedDB === "undefined") return;
  await writes;
  await run("readwrite", store => { store.clear(); }).catch(() => {});
}

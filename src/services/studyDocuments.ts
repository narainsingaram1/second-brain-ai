import { getSupabase, managedAuthEnabled } from "./managedAuth";

/**
 * Extracted text of course documents, kept outside the synced snapshot.
 * - IndexedDB is the local store (per account).
 * - With managed accounts, a private Supabase table mirrors it so other devices can read it.
 * - An in-memory map lets synchronous code (assistant retrieval) read loaded text instantly.
 */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
let dbPromise: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("synapse_study_v1", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("texts");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
const slot = (userId: string, id: string) => `${userId || "guest"}|${id}`;
async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const database = await db();
    return await new Promise((resolve, reject) => {
      const tx = database.transaction("texts", mode);
      const req = run(tx.objectStore("texts"));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return undefined;
  }
}
function changed() {
  for (const listener of listeners) listener();
}
export function onDocumentTextChange(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Text already loaded into memory, or undefined. Synchronous for retrieval. */
export const cachedDocumentText = (id: string) => memory.get(id);

export async function saveDocumentText(userId: string, id: string, hash: string, text: string): Promise<void> {
  memory.set(id, text);
  await idb("readwrite", (store) => store.put(text, slot(userId, id)));
  changed();
  if (managedAuthEnabled) {
    // Local copy is authoritative for this device; a failed upload only limits other devices.
    const { error } = await getSupabase().from("study_documents").upsert({ user_id: userId, id, hash, content: text, updated_at: new Date().toISOString() });
    if (error) console.warn("[Study] Cloud copy of document text failed:", error.message);
  }
}

export async function deleteDocumentTexts(userId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  for (const id of ids) {
    memory.delete(id);
    await idb("readwrite", (store) => store.delete(slot(userId, id)));
  }
  changed();
  if (managedAuthEnabled) {
    const { error } = await getSupabase().from("study_documents").delete().eq("user_id", userId).in("id", ids);
    if (error) console.warn("[Study] Could not remove cloud document text:", error.message);
  }
}

/** Loads every listed document's text into memory: IndexedDB first, then the cloud for anything missing. */
export async function hydrateDocumentTexts(userId: string, ids: string[]): Promise<void> {
  const missing: string[] = [];
  for (const id of ids) {
    if (memory.has(id)) continue;
    const text = await idb<string>("readonly", (store) => store.get(slot(userId, id)) as IDBRequest<string>);
    if (typeof text === "string") memory.set(id, text);
    else missing.push(id);
  }
  if (missing.length && managedAuthEnabled) {
    for (let i = 0; i < missing.length; i += 20) {
      const { data, error } = await getSupabase().from("study_documents").select("id,content").eq("user_id", userId).in("id", missing.slice(i, i + 20));
      if (error) break;
      for (const row of data || []) {
        memory.set(row.id, row.content);
        await idb("readwrite", (store) => store.put(row.content, slot(userId, row.id)));
      }
    }
  }
  changed();
}

/** Text for one document, loading it on demand. */
export async function loadDocumentText(userId: string, id: string): Promise<string | undefined> {
  if (!memory.has(id)) await hydrateDocumentTexts(userId, [id]);
  return memory.get(id);
}

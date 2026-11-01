import { BrainState } from "../types";

export type RecordType = "task" | "goal" | "habit" | "journal" | "knowledge";
export interface BrainRecord { id: string; type: RecordType; title: string; date?: string; text: string; data: Record<string, unknown> }
export interface Source { id: string; type: string; title: string; snippet: string; offset?: number }
export function records(state: BrainState, type?: RecordType): BrainRecord[] {
  return ([
    ...state.tasks.map(data => ({ type: "task" as const, title: data.title, date: data.dueDate, data })),
    ...state.goals.map(data => ({ type: "goal" as const, title: data.title, date: data.targetDate, data })),
    ...state.habits.map(data => ({ type: "habit" as const, title: data.name, date: undefined, data })),
    ...state.journalEntries.map(data => ({ type: "journal" as const, title: data.title, date: data.date, data })),
    ...state.knowledgeItems.map(data => ({ type: "knowledge" as const, title: data.title || data.subject, date: data.startDate, data })),
  ]).filter(r => !type || r.type === type).map(r => ({ ...r, id: r.data.id, data: { ...r.data }, text: JSON.stringify(r.data, null, 2) }));
}
export function chunks(record: BrainRecord): Source[] {
  const result: Source[] = [];
  // Overlap preserves context at boundaries. Offsets also support exact follow-up reads.
  for (let offset = 0; offset < record.text.length; offset += 2800) {
    result.push({ id: record.id, type: record.type, title: record.title, offset, snippet: record.text.slice(offset, offset + 3200) });
  }
  return result;
}

// Separate, content-addressed neural index. Never mixes embedding spaces or accounts.
const MODEL = "openai/text-embedding-3-small";
let dbPromise: Promise<IDBDatabase> | undefined;
function embeddingDB(): Promise<IDBDatabase> {
  return dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("synapse_retrieval_v1", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("embeddings");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, "0")).join("");
}
async function cachedEmbedding(key: string): Promise<number[] | undefined> {
  try {
    const db = await embeddingDB();
    return await new Promise((resolve, reject) => {
      const req = db.transaction("embeddings").objectStore("embeddings").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch { return undefined; }
}
async function storeEmbedding(key: string, vector: number[]): Promise<void> {
  try {
    const db = await embeddingDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("embeddings", "readwrite");
      tx.objectStore("embeddings").put(vector, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* An unavailable cache does not invalidate retrieved evidence. */ }
}
export async function embed(inputs: string[], key: string, signal?: AbortSignal): Promise<number[][]> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  });
  if (!res.ok) throw new Error(`Embedding service failed (HTTP ${res.status})`);
  const body = await res.json();
  const sorted = body.data?.sort((a: { index: number }, b: { index: number }) => a.index - b.index);
  if (!sorted || sorted.length !== inputs.length || sorted.some((x: { embedding: number[] }) => !Array.isArray(x.embedding) || !x.embedding.length || x.embedding.some(v => !Number.isFinite(v)))) throw new Error("Invalid embedding response");
  return sorted.map((x: { embedding: number[] }) => x.embedding);
}
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
export async function searchRecords(state: BrainState, query: string, type: RecordType | undefined, offset: number, key: string, signal?: AbortSignal, progress?: (s: string) => void) {
  const sources = records(state, type).flatMap(chunks);
  const terms = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [])];
  const lexical = sources.map(source => {
    const text = source.snippet.toLocaleLowerCase(), title = source.title.toLocaleLowerCase();
    return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0) + (title.includes(term) ? 2 : 0), 0) / Math.max(1, terms.length * 3);
  });
  let neural: number[] | undefined;
  let warning: string | undefined;
  try {
    if (!sources.length) return { results: [], total: 0, nextOffset: null, complete: true, mode: "hybrid" };
    const keys = await Promise.all(sources.map(s => digest(`${state.userId || "guest"}|${MODEL}|${s.title}|${s.snippet}`)));
    const vectors = await Promise.all(keys.map(cachedEmbedding));
    const missing = vectors.flatMap((v, i) => v ? [] : [i]);
    for (let start = 0; start < missing.length; start += 32) {
      signal?.throwIfAborted();
      progress?.(`Indexing notes: ${Math.min(start + 32, missing.length)} of ${missing.length} passages`);
      const indices = missing.slice(start, start + 32);
      const batch = await embed(indices.map(i => `${sources[i].title}\n${sources[i].snippet}`), key, signal);
      await Promise.all(indices.map(async (i, j) => { vectors[i] = batch[j]; await storeEmbedding(keys[i], batch[j]); }));
    }
    const [q] = await embed([query], key, signal);
    neural = vectors.map(v => v ? cosine(q, v) : 0);
  } catch (err) {
    signal?.throwIfAborted();
    warning = `${err instanceof Error ? err.message : "Semantic search unavailable"}. Results use keyword search only; paraphrases may be missed.`;
  }
  const ranked = sources.map((source, i) => ({ ...source, score: lexical[i] * 0.4 + (neural?.[i] || 0) * 0.6 }))
    .filter((_, i) => lexical[i] > 0 || (neural?.[i] || 0) >= 0.3)
    .sort((a, b) => b.score - a.score);
  const results = ranked.slice(offset, offset + 6);
  return { results, total: ranked.length, searchedPassages: sources.length, nextOffset: offset + results.length < ranked.length ? offset + results.length : null,
    complete: offset + results.length >= ranked.length, mode: neural ? "hybrid" : "keyword", warning };
}

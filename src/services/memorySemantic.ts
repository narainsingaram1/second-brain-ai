import type { BrainState } from "../types";
import {
  activeMemories,
  memoryHash,
  normalizeAgentMemory,
  searchMemories,
} from "./agentMemory";
import { embed } from "./brainRetrieval";
const model = "openai/text-embedding-3-small";
let dbPromise: Promise<IDBDatabase> | undefined;
let owner = "",
  generation = 0;
let controller = new AbortController();
const vectors = new Map<string, { signature: string; vector: number[] }>();
function db() {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("synapse_memory_embeddings_v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("vectors");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
async function cached(id: string) {
  try {
    const store = await db();
    return await new Promise<
      { signature: string; vector: number[] } | undefined
    >((resolve, reject) => {
      const r = store.transaction("vectors").objectStore("vectors").get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return undefined;
  }
}
async function cache(
  id: string,
  value?: { signature: string; vector: number[] },
) {
  try {
    const store = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = store.transaction("vectors", "readwrite");
      const s = tx.objectStore("vectors");
      if (value) s.put(value, id);
      else s.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* Optional caches never determine whether a memory exists. */
  }
}
export function setMemoryAccount(id: string) {
  if (owner === id) return;
  controller.abort();
  controller = new AbortController();
  owner = id;
  generation++;
  vectors.clear();
}
export async function invalidateMemoryEmbedding(userId: string, id: string) {
  if (owner === userId) {
    vectors.delete(id);
    generation++;
  }
  await cache(`${userId}|${model}|${id}`);
}
export async function semanticMemorySearch(
  state: BrainState,
  query: string,
  offset: number,
  key: string,
  signal?: AbortSignal,
) {
  const fallback = searchMemories(state, query, offset);
  const memory = normalizeAgentMemory(state.agentMemory);
  if (!memory.enabled) return fallback;
  setMemoryAccount(state.userId || "guest");
  const run = generation,
    runOwner = owner;
  const abort = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  const entries = activeMemories(memory);
  if (!entries.length) return fallback;
  try {
    const data = await Promise.all(
      entries.map(async (entry) => {
        const signature = memoryHash(`${entry.topic}|${entry.content}`);
        const id = `${runOwner}|${model}|${entry.id}`;
        const value = vectors.get(id) || (await cached(id));
        return {
          entry,
          id,
          signature,
          vector: value?.signature === signature ? value.vector : undefined,
        };
      }),
    );
    const missing = data.filter((item) => !item.vector);
    for (let i = 0; i < missing.length; i += 32) {
      abort.throwIfAborted();
      const batch = missing.slice(i, i + 32),
        results = await embed(
          batch.map((item) => `${item.entry.topic}\n${item.entry.content}`),
          key,
          abort,
        );
      if (generation !== run || owner !== runOwner)
        throw new Error("Memory changed during search. Search again.");
      await Promise.all(
        batch.map(async (item, j) => {
          item.vector = results[j];
          const value = { signature: item.signature, vector: results[j] };
          vectors.set(item.id, value);
          await cache(item.id, value);
        }),
      );
    }
    const [q] = await embed([query], key, abort);
    if (generation !== run || owner !== runOwner)
      throw new Error("Memory changed during search. Search again.");
    const similarity = (v: number[]) => {
      if (v.length !== q.length) return 0;
      let dot = 0,
        a = 0,
        b = 0;
      for (let i = 0; i < v.length; i++) {
        dot += v[i] * q[i];
        a += v[i] ** 2;
        b += q[i] ** 2;
      }
      return a && b ? dot / Math.sqrt(a * b) : 0;
    };
    const ranked = data
      .map((item) => ({ ...item.entry, score: similarity(item.vector!) }))
      .filter((item) => item.score >= 0.3)
      .sort((a, b) => b.score - a.score);
    return {
      results: ranked.slice(offset, offset + 10),
      total: ranked.length,
      nextOffset: offset + 10 < ranked.length ? offset + 10 : null,
      mode: "hybrid",
    };
  } catch (error) {
    abort.throwIfAborted();
    if (generation !== run || owner !== runOwner)
      return {
        results: [],
        total: 0,
        nextOffset: null,
        mode: "keyword",
        warning: "Memory changed during search. Search again.",
      };
    return {
      ...fallback,
      warning: `${error instanceof Error ? error.message : "Semantic search unavailable"}. Using keyword search; paraphrases may be missed.`,
    };
  }
}

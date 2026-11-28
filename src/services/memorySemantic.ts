import type { BrainState } from "../types";
import {
  activeMemories,
  MEMORY_LIMIT,
  memoryHash,
  normalizeAgentMemory,
  searchMemories,
} from "./agentMemory";
import { digest, embed, type EmbeddingCache } from "./brainRetrieval";

const model = "openai/text-embedding-3-small";
const MAX_ACCOUNTS = 16;

type CachedVector = { signature: string; vector: number[] };
type AccountSemanticState = {
  generation: number;
  controller: AbortController;
  vectors: Map<string, CachedVector>;
  queryVectors: Map<string, number[]>;
};

const accounts = new Map<string, AccountSemanticState>();
let activeBrowserAccount: string | undefined;
let dbPromise: Promise<IDBDatabase> | undefined;

function accountState(id: string): AccountSemanticState {
  let acc = accounts.get(id);
  if (acc) {
    accounts.delete(id);
    accounts.set(id, acc);
    return acc;
  }
  acc = {
    generation: 0,
    controller: new AbortController(),
    vectors: new Map(),
    queryVectors: new Map(),
  };
  accounts.set(id, acc);
  while (accounts.size > MAX_ACCOUNTS) {
    const oldest = accounts.keys().next().value;
    if (oldest === undefined) break;
    const dropped = accounts.get(oldest);
    accounts.delete(oldest);
    dropped?.controller.abort();
  }
  return acc;
}

function db() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("synapse_memory_embeddings_v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("vectors");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

async function cached(id: string) {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const store = await db();
    return await new Promise<CachedVector | undefined>((resolve, reject) => {
      const r = store.transaction("vectors").objectStore("vectors").get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return undefined;
  }
}

async function cache(id: string, value?: CachedVector) {
  if (typeof indexedDB === "undefined") return;
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

async function readSharedVectors(
  embeddingCache: EmbeddingCache,
  keys: string[],
): Promise<Map<string, number[]>> {
  if (!keys.length) return new Map();
  if (embeddingCache.getMany) {
    return embeddingCache.getMany(keys).catch(() => new Map());
  }
  const found = new Map<string, number[]>();
  await Promise.all(
    keys.map(async (k) => {
      const v = await embeddingCache.get(k).catch(() => undefined);
      if (v) found.set(k, v);
    }),
  );
  return found;
}

async function writeSharedVectors(
  embeddingCache: EmbeddingCache,
  entries: Array<[string, number[]]>,
): Promise<void> {
  if (!entries.length) return;
  if (embeddingCache.putMany) {
    await embeddingCache.putMany(entries).catch(() => {});
    return;
  }
  await Promise.all(
    entries.map(([k, v]) => embeddingCache.put(k, v).catch(() => {})),
  );
}

/** Switches the active local browser account, aborting any previous browser session's in-flight indexing. */
export function setMemoryAccount(id: string) {
  if (activeBrowserAccount === id) return;
  if (activeBrowserAccount !== undefined) {
    const prev = accounts.get(activeBrowserAccount);
    if (prev) {
      prev.controller.abort();
      prev.controller = new AbortController();
      prev.generation++;
    }
  }
  activeBrowserAccount = id;
  accountState(id);
}

export async function invalidateMemoryEmbedding(userId: string, id: string) {
  const acc = accounts.get(userId);
  if (acc) {
    acc.vectors.delete(id);
    acc.vectors.delete(`${userId}|${model}|${id}`);
    acc.generation++;
  }
  await cache(`${userId}|${model}|${id}`);
}

export async function semanticMemorySearch(
  state: BrainState,
  query: string,
  offset: number,
  key: string,
  signal?: AbortSignal,
  ctx?: { embeddingCache?: EmbeddingCache; providerBase?: string },
) {
  const fallback = searchMemories(state, query, offset);
  const memory = normalizeAgentMemory(state.agentMemory);
  if (!memory.enabled) return fallback;
  const runOwner = state.userId || "guest";
  const account = accountState(runOwner);
  const run = account.generation;
  const accountSignal = account.controller.signal;
  const abort = signal
    ? AbortSignal.any([signal, accountSignal])
    : accountSignal;
  const entries = activeMemories(memory);
  if (!entries.length) return fallback;
  const liveIds = new Set(entries.map((e) => e.id));
  for (const cachedId of account.vectors.keys()) {
    if (!liveIds.has(cachedId)) account.vectors.delete(cachedId);
  }
  try {
    const items = await Promise.all(
      entries.map(async (entry) => {
        const signature = memoryHash(`${entry.topic}|${entry.content}`);
        const idbKey = `${runOwner}|${model}|${entry.id}`;
        const memValue = account.vectors.get(entry.id);
        const vector =
          memValue?.signature === signature ? memValue.vector : undefined;
        const sharedKey = ctx?.embeddingCache
          ? await digest(
              `${runOwner}|${model}|${ctx.providerBase ?? ""}|${entry.id}|${signature}`,
            )
          : undefined;
        return {
          entry,
          idbKey,
          sharedKey,
          signature,
          vector,
        };
      }),
    );

    const cacheMisses = items.filter((item) => !item.vector);
    if (cacheMisses.length) {
      if (ctx?.embeddingCache) {
        const sharedKeys = cacheMisses
          .map((item) => item.sharedKey!)
          .filter(Boolean);
        const found = await readSharedVectors(ctx.embeddingCache, sharedKeys);
        for (const item of cacheMisses) {
          const vector = item.sharedKey ? found.get(item.sharedKey) : undefined;
          if (vector) {
            item.vector = vector;
            account.vectors.set(item.entry.id, {
              signature: item.signature,
              vector,
            });
          }
        }
      } else {
        await Promise.all(
          cacheMisses.map(async (item) => {
            const value = await cached(item.idbKey);
            if (value?.signature === item.signature) {
              item.vector = value.vector;
              account.vectors.set(item.entry.id, value);
            }
          }),
        );
      }
    }

    const missing = items.filter((item) => !item.vector);
    for (let i = 0; i < missing.length; i += 32) {
      abort.throwIfAborted();
      const batch = missing.slice(i, i + 32);
      const results = await embed(
        batch.map((item) => `${item.entry.topic}\n${item.entry.content}`),
        key,
        abort,
        ctx?.providerBase,
      );
      if (account.generation !== run || accountSignal.aborted) {
        throw new Error("Memory changed during search. Search again.");
      }
      if (ctx?.embeddingCache) {
        const sharedWrites: Array<[string, number[]]> = [];
        batch.forEach((item, j) => {
          item.vector = results[j];
          account.vectors.set(item.entry.id, {
            signature: item.signature,
            vector: results[j],
          });
          if (item.sharedKey) sharedWrites.push([item.sharedKey, results[j]]);
        });
        await writeSharedVectors(ctx.embeddingCache, sharedWrites);
      } else {
        await Promise.all(
          batch.map(async (item, j) => {
            item.vector = results[j];
            const value = { signature: item.signature, vector: results[j] };
            account.vectors.set(item.entry.id, value);
            await cache(item.idbKey, value);
          }),
        );
      }
    }

    const queryKey = `${ctx?.providerBase ?? ""}|${query.trim()}`;
    let q = account.queryVectors.get(queryKey);
    if (!q) {
      [q] = await embed([query], key, abort, ctx?.providerBase);
    }
    if (account.generation !== run || accountSignal.aborted) {
      throw new Error("Memory changed during search. Search again.");
    }
    account.queryVectors.delete(queryKey);
    account.queryVectors.set(queryKey, q);
    if (account.queryVectors.size > 64) {
      account.queryVectors.delete(account.queryVectors.keys().next().value!);
    }

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
    const semantic = items
      .map((item) => ({ ...item.entry, score: similarity(item.vector!) }))
      .filter((item) => item.score >= 0.3)
      .sort((a, b) => b.score - a.score);
    // Fuse both rankings. A strong exact match must survive a weak embedding.
    const lexical = searchMemories(state, query, 0, MEMORY_LIMIT).results;
    const scores = new Map<string, number>();
    for (const list of [lexical, semantic]) {
      list.forEach((entry, rank) =>
        scores.set(entry.id, (scores.get(entry.id) || 0) + 1 / (60 + rank + 1)),
      );
    }
    const ranked = entries
      .filter((entry) => scores.has(entry.id))
      .map((entry) => ({ ...entry, score: scores.get(entry.id)! }))
      .sort(
        (a, b) =>
          b.score - a.score || b.updatedAt.localeCompare(a.updatedAt),
      );
    return {
      results: ranked.slice(offset, offset + 10),
      total: ranked.length,
      nextOffset: offset + 10 < ranked.length ? offset + 10 : null,
      mode: "hybrid",
    };
  } catch (error) {
    abort.throwIfAborted();
    if (account.generation !== run) {
      return {
        results: [],
        total: 0,
        nextOffset: null,
        mode: "keyword",
        warning: "Memory changed during search. Search again.",
      };
    }
    return {
      ...fallback,
      warning: `${error instanceof Error ? error.message : "Semantic search unavailable"}. Using keyword search; paraphrases may be missed.`,
    };
  }
}

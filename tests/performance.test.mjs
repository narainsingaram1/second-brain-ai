import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  logLevel: "error",
});
after(() => server.close());
const { persistLatestBrainState, persistBrainState } = await server.ssrLoadModule("/src/services/storage.ts");
const retrieval = await server.ssrLoadModule("/src/services/brainRetrieval.ts");

const state = (tasks = []) => ({
  userId: "alice", tasks, goals: [], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [], conversations: [],
  sections: [], subsections: {}, theme: "light", selectedModel: "test/model", openRouterKey: "",
});
const task = (id, title, description = "") => ({ id, title, description, status: "not_started", completed: false, section: "Work", priority: "medium", dueDate: "" });

function countingStorage() {
  const data = new Map();
  const writes = [];
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { if (key === "synapse_user_data_alice") writes.push(JSON.parse(value)); data.set(key, value); },
    removeItem: key => data.delete(key),
  };
  return { writes, restore: () => { globalThis.localStorage = previous; } };
}

test("a burst of saves while one is queued writes the newest state once instead of once per request", async () => {
  const store = countingStorage();
  const warn = console.warn; console.warn = () => {};
  try {
    let latest = state();
    const requests = [];
    for (let i = 0; i < 20; i++) {
      latest = state([task(`t${i}`, `Edit ${i}`)]);
      requests.push(persistLatestBrainState(() => latest, "alice"));
    }
    await Promise.all(requests);
    assert.equal(store.writes.length, 1);
    assert.equal(store.writes[0].tasks[0].id, "t19");
    // A request made after that save read the state queues a new one, so later edits are never dropped.
    latest = state([task("after", "Later edit")]);
    await persistLatestBrainState(() => latest, "alice");
    assert.equal(store.writes.length, 2);
    assert.equal(store.writes[1].tasks[0].id, "after");
  } finally { store.restore(); console.warn = warn; }
});

test("a request behind an in-flight save still saves the state the in-flight save did not see", async () => {
  const store = countingStorage();
  const warn = console.warn; console.warn = () => {};
  try {
    let latest = state([task("first", "First")]);
    const inFlight = persistBrainState(() => latest, "alice");
    const queued = persistLatestBrainState(() => latest, "alice");
    latest = state([task("second", "Second")]);
    const joined = persistLatestBrainState(() => latest, "alice");
    assert.equal(joined, queued);
    await Promise.all([inFlight, queued]);
    assert.deepEqual(store.writes.map(w => w.tasks[0].id), ["second", "second"]);
  } finally { store.restore(); console.warn = warn; }
});

test("saves for different accounts are never merged", async () => {
  const store = countingStorage();
  const warn = console.warn; console.warn = () => {};
  try {
    const a = persistLatestBrainState(() => state([task("a", "A")]), "alice");
    const b = persistLatestBrainState(() => ({ ...state([task("b", "B")]), userId: "bob" }), "bob");
    assert.notEqual(a, b);
    await Promise.all([a, b]);
    assert.ok(globalThis.localStorage.getItem("synapse_user_data_bob"));
    assert.equal(store.writes.length, 1);
  } finally { store.restore(); console.warn = warn; }
});

test("cached keyword search matches a fresh index and follows edits and deletions", async () => {
  const cache = { get: async () => undefined, put: async () => {} };
  const search = (s, q) => retrieval.rankPassages(s, q, undefined, undefined, undefined, undefined, { embeddingCache: cache }).then(r => r.ranked.map(x => [x.id, x.score]));
  const base = state([task("budget", "Quarterly budget review", "Spreadsheet of expenses"), task("exam", "Graph algorithms exam", "Dijkstra and heaps"), task("trip", "Plan trip", "Book the train")]);
  retrieval.clearRetrievalMemory();
  const cold = await search(base, "graph exam");
  const warm = await search(base, "graph exam");
  assert.deepEqual(warm, cold);
  assert.equal(cold[0][0], "exam");
  // An edited passage is re-tokenized: the old text no longer matches and the new text does.
  const edited = state([task("budget", "Quarterly budget review", "Spreadsheet of expenses"), task("exam", "Biology quiz", "Cells"), task("trip", "Plan trip", "Book the train to the graph theory exam")]);
  const afterEdit = await search(edited, "graph exam");
  retrieval.clearRetrievalMemory();
  assert.deepEqual(afterEdit, await search(edited, "graph exam"));
  assert.deepEqual(afterEdit.map(([id]) => id), ["trip"]);
  // Deleted records are not returned from the cache.
  assert.deepEqual(await search(state([task("budget", "Quarterly budget review")]), "graph exam"), []);
});

test("a search looks up every passage's cached vector in one batch, not one request per passage", async () => {
  const many = state(Array.from({ length: 300 }, (_, i) => task(`t${i}`, `Task number ${i}`, `Details for item ${i}`)));
  const vector = [1, 0, 0];
  let single = 0, batches = 0, keysSeen = 0;
  const cache = {
    get: async () => { single++; return vector; },
    put: async () => {},
    getMany: async keys => { batches++; keysSeen += keys.length; return new Map(keys.map(k => [k, vector])); },
    putMany: async () => {},
  };
  const fetch = globalThis.fetch;
  // Only the query itself is embedded; every passage vector comes from the cache.
  globalThis.fetch = async (_url, opts) => new Response(JSON.stringify({ data: JSON.parse(opts.body).input.map((_, index) => ({ index, embedding: vector })) }), { status: 200 });
  try {
    retrieval.clearRetrievalMemory();
    const result = await retrieval.rankPassages(many, "task number 7", undefined, "test-key", undefined, undefined, { embeddingCache: cache });
    assert.equal(result.neural, true);
    assert.equal(single, 0);
    assert.equal(batches, 1);
    assert.equal(keysSeen, 300);
    // Warm: vectors are in memory, so the cache is not consulted again.
    await retrieval.rankPassages(many, "task number 8", undefined, "test-key", undefined, undefined, { embeddingCache: cache });
    assert.equal(batches, 1);
  } finally { globalThis.fetch = fetch; retrieval.clearRetrievalMemory(); }
});

test("bm25 over cached term counts scores exactly like bm25 over tokens", () => {
  const docs = ["the graph exam covers graphs and heaps", "budget meeting notes", "exam exam exam review", ""].map(retrieval.tokenize);
  const query = retrieval.tokenize("graph exam review");
  assert.deepEqual(retrieval.bm25Counts(docs.map(retrieval.termCounts), query), retrieval.bm25(docs, query));
  const reference = (() => {
    const k1 = 1.2, b = 0.75, terms = [...new Set(query)], avg = docs.reduce((n, d) => n + d.length, 0) / docs.length;
    return docs.map(doc => terms.reduce((score, t) => {
      const f = doc.filter(x => x === t).length, df = docs.filter(d => d.includes(t)).length;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      return score + (f ? idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * doc.length / avg)) : 0);
    }, 0));
  })();
  retrieval.bm25(docs, query).forEach((score, i) => assert.ok(Math.abs(score - reference[i]) < 1e-12));
});

test("passages of unchanged records are reused, and any edit (replaced or in place) re-splits the record", () => {
  const long = Array.from({ length: 8 }, (_, i) => `## Part ${i}\n\n${"word ".repeat(80)}`).join("\n\n");
  const note = { id: "n1", title: "Long note", subject: "General", content: long, type: "note" };
  const s = { ...state([task("t1", "Plan launch")]), knowledgeItems: [note] };
  const first = retrieval.chunks(retrieval.records(s, "knowledge")[0]);
  assert.ok(first.length > 1);
  assert.equal(retrieval.chunks(retrieval.records(s, "knowledge")[0]), first, "Unchanged record: same passages, not re-split");
  const replaced = { ...s, knowledgeItems: [{ ...note, content: long + "\n\nAdded paragraph" }] };
  assert.match(retrieval.chunks(retrieval.records(replaced, "knowledge")[0]).at(-1).snippet, /Added paragraph/);
  note.content = long.replace("Part 0", "Intro");
  assert.ok(retrieval.chunks(retrieval.records(s, "knowledge")[0]).some(c => /Intro/.test(c.snippet)), "In-place edits are picked up too");
  // A typed lookup builds only that type, and the full JSON text is still there when read.
  const tasks = retrieval.records(s, "task");
  assert.deepEqual(tasks.map(r => r.type), ["task"]);
  assert.equal(JSON.parse(tasks[0].text).title, "Plan launch");
});

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
after(() => server.close());
const memory = await server.ssrLoadModule("/src/services/agentMemory.ts");
const learning = await server.ssrLoadModule("/src/services/memoryLearning.ts");
const graph = await server.ssrLoadModule("/src/services/memoryGraph.ts");
const { AutonomousBrainAgent } = await server.ssrLoadModule("/src/services/agentDispatcher.ts");
const { executeRead, BRAIN_TOOLS, parseToolArguments } = await server.ssrLoadModule("/src/services/brainTools.ts");
const { RecordSync } = await server.ssrLoadModule("/src/services/recordSync.ts");
const { toolTier } = await server.ssrLoadModule("/src/services/actionPolicy.ts");

const now = "2026-11-01T12:00:00Z";
let accounts = 0;
const state = (over = {}) => ({
  userId: `account-${++accounts}`, tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [], conversations: [],
  conversationId: "thread", sections: [], subsections: {}, theme: "light", selectedModel: "test/model", openRouterKey: "fixture-key", agentMemory: memory.emptyMemory(), ...over,
});
const message = (id, content, role = "user") => ({ id, role, content, timestamp: now });
const turn = (id, content) => ({ message: message(id, content), reply: "OK.", conversationId: "thread" });
const entry = (id, topic, content, over = {}) => ({ id, topic, category: "fact", content, sources: [{ conversationId: "thread", messageId: `src-${id}`, excerpt: content.slice(0, 40) }], createdAt: now, updatedAt: now, pinned: false, ...over });
const withEntries = (entries, over) => state({ agentMemory: { ...memory.emptyMemory(), entries }, ...over });
const candidate = (topic, content, excerpt, over = {}) => ({ topic, category: "fact", content, excerpt, ...over });
const proposes = (...candidates) => ({ choices: [{ message: { content: null, tool_calls: [{ id: "c", type: "function", function: { name: "propose_memories", arguments: JSON.stringify({ candidates }) } }] } }] });
const provider = (responses, requests = []) => {
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, "unexpected provider call");
    return Response.json(next);
  };
  return requests;
};
const learn = async (s, text, ...candidates) => {
  provider([proposes(...candidates)]);
  return learning.learnFromTurns(s, [turn("m1", text)]);
};
const apply = (m, changes) => memory.applyMemoryChange(m, { kind: "batch", changes });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("facts the old gates silently dropped now reach memory", async () => {
  // The quote has no first-person word: the old gate required one in the excerpt itself.
  let changes = await learn(state(), "Hey, CS major at Georgia Tech here, can you plan my week?", candidate("major", "Studies CS at Georgia Tech.", "CS major at Georgia Tech"));
  assert.equal(changes.length, 1);
  // Models normalize punctuation and spacing; the old gate required an exact substring.
  changes = await learn(state(), "I’m   working on Synapse, my second brain app", candidate("project: synapse", "Is building Synapse.", "I'm working on Synapse", { category: "project" }));
  assert.equal(changes.length, 1);
  assert.match(changes[0].entry.sources[0].excerpt, /working on Synapse/, "Evidence is the user's text, not the model's");
  // A paraphrased quote still counts when the fact is visibly in the message.
  changes = await learn(state(), "Priya is my lab partner this term in data structures", candidate("person: priya", "Priya is their lab partner in data structures.", "my partner Priya", { category: "person" }));
  assert.equal(changes.length, 1);
  // The old check treated any "don't … learn/save" as refusing to be remembered.
  changes = await learn(state(), "I don't want to learn React yet, I am sticking with Vue", candidate("frontend framework", "Sticks with Vue instead of React.", "sticking with Vue"));
  assert.equal(changes.length, 1);
  // More than three facts in one message are all kept.
  const many = "I'm Narain, I study CS at Georgia Tech, I live in Atlanta, I build apps in TypeScript, I study at night";
  changes = await learn(state(), many, ...[["name", "Name is Narain.", "I'm Narain"], ["major", "Studies CS at Georgia Tech.", "I study CS at Georgia Tech"], ["city", "Lives in Atlanta.", "I live in Atlanta"], ["language", "Builds apps in TypeScript.", "I build apps in TypeScript"], ["study time", "Studies at night.", "I study at night"]].map(c => candidate(...c)));
  assert.equal(changes.length, 5);
});

test("the cheap gate lets statements through but not plain requests", () => {
  for (const text of ["Doing CS 1332 this semester, pretty rough so far", "I usually study late", "Priya and I are building a weather app"]) assert.equal(learning.worthLearning(text), true, text);
  for (const text of ["ok thanks", "What is due this week?", "Show the notes from Friday", "password: hunter22222"]) assert.equal(learning.worthLearning(text), false, text);
});

test("unsupported, sensitive, secret, temporary and declined facts stay out", async () => {
  assert.equal((await learn(state(), "I study CS", candidate("city", "Lives in Paris.", "I live in Paris"))).length, 0, "Invented");
  assert.equal((await learn(state(), "I study CS and have ADHD", candidate("health", "Has ADHD.", "I study CS and have ADHD"))).length, 0, "Sensitive");
  assert.equal((await learn(state(), "For this answer I prefer bullets", candidate("format", "Prefers bullets.", "For this answer I prefer bullets"))).length, 0, "Temporary");
  provider([]);
  assert.deepEqual(await learning.learnFromTurns(state(), [turn("m1", "Please don't save this, I'm moving to Boston")]), [], "Declined messages never reach the model");
  assert.deepEqual(await learning.learnFromTurns(state(), [turn("m1", "my api_key=abcdefghijkl and I like tea")]), [], "Credentials never reach the model");
  const off = state({ agentMemory: { ...memory.emptyMemory(), automaticLearning: false } });
  assert.deepEqual(await learning.learnFromTurns(off, [turn("m1", "I like tea a lot")]), []);
});

test("updates supersede, repeats reinforce, and unrelated facts sharing a topic both survive", async () => {
  const base = entry("city", "city", "Lives in Atlanta.", { origin: "auto" });
  let s = withEntries([base]);
  // A correction replaces the memory in place and keeps what it used to say.
  let changes = await learn(s, "I moved to Boston last month", candidate("home", "Lives in Boston.", "I moved to Boston", { action: "update", target: "m1" }));
  let saved = apply(s.agentMemory, changes);
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].id, "city");
  assert.equal(saved.entries[0].topic, "city", "A correction keeps the stable topic");
  assert.equal(saved.entries[0].content, "Lives in Boston.");
  assert.equal(saved.entries[0].history[0].content, "Lives in Atlanta.");
  // Repeating a fact strengthens it rather than duplicating or rewriting it.
  s = withEntries(saved.entries);
  provider([proposes(candidate("where i live", "Lives in Boston.", "I live in Boston", { action: "same", target: "m1" }))]);
  changes = await learning.learnFromTurns(s, [turn("m2", "As I said, I live in Boston")]);
  saved = apply(s.agentMemory, changes);
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].mentions, 2);
  assert.equal(saved.entries[0].history.length, 1, "A repeat is not a correction");
  // Reprocessing the same message is a no-op, so a second device cannot inflate it.
  assert.equal(apply(saved, changes).entries[0].mentions, 2);
  // Wording overlap catches a duplicate the model labelled new.
  provider([proposes(candidate("hometown now", "Lives in Boston.", "I live in Boston", { action: "new" }))]);
  changes = await learning.learnFromTurns(s, [turn("m3", "I live in Boston these days")]);
  assert.equal(apply(s.agentMemory, changes).entries.length, 1);
  // A new, unrelated fact that reuses a generic topic must not overwrite the old one.
  s = withEntries([entry("p1", "project", "Is building a weather app.", { category: "project" })]);
  changes = await learn(s, "My other project is a chess engine in Rust", candidate("project", "Is building a chess engine in Rust.", "chess engine in Rust", { action: "new", category: "project", entities: ["Rust"] }));
  saved = apply(s.agentMemory, changes);
  assert.equal(saved.entries.length, 2);
  assert.ok(saved.entries.some(e => /weather/.test(e.content)));
  assert.ok(saved.entries.some(e => e.topic !== "project" && /chess/.test(e.content)));
});

test("a batch skips forgotten topics without losing the rest; auto memories make room, others never do", () => {
  let m = memory.applyMemoryChange(undefined, { kind: "remember", explicit: true, entry: entry("gone", "old hobby", "Likes chess.") });
  m = memory.applyMemoryChange(m, { kind: "forget", id: "gone" });
  const auto = (id, topic, content) => ({ kind: "remember", explicit: false, entry: entry(id, topic, content, { origin: "auto" }) });
  m = apply(m, [auto("a", "old hobby", "Likes chess again."), auto("b", "city", "Lives in Boston.")]);
  assert.deepEqual(m.entries.map(e => e.id), ["b"], "Forgotten stays forgotten; the other fact still saves");
  const full = { ...memory.emptyMemory(), entries: [
    entry("user-made", "user made", "Set by the user."),
    entry("pinned", "pinned auto", "Pinned.", { origin: "auto", pinned: true }),
    entry("strong", "strong", "Repeated.", { origin: "auto", mentions: 9, updatedAt: "2026-01-01T00:00:00Z" }),
    entry("weak", "weak", "Said once.", { origin: "auto", updatedAt: "2026-02-01T00:00:00Z", related: ["strong"] }),
    ...Array.from({ length: 496 }, (_, i) => entry(`filler-${i}`, `filler ${i}`, `Filler ${i}.`, { origin: "auto", mentions: 3 })),
  ] };
  const after = memory.applyMemoryChange(full, auto("new", "new fact", "A new fact."));
  assert.equal(after.entries.length, 500);
  const ids = new Set(after.entries.map(e => e.id));
  for (const kept of ["user-made", "pinned", "strong", "new"]) assert.ok(ids.has(kept), kept);
  assert.ok(!ids.has("weak"), "The least-repeated learned memory is dropped first");
});

test("memories link to records and each other, and forgetting removes the connection", async () => {
  const s = withEntries([entry("old", "lab partner", "Has a lab partner in data structures.")], {
    study: { courses: [{ id: "c1", workspaceId: "w", code: "CS 1332", name: "Data Structures & Algorithms" }], folders: [], documents: [], decks: [], quizzes: [] },
    goals: [{ id: "g1", title: "Land a summer internship", status: "in_progress", milestones: [] }],
    tasks: [{ id: "t1", title: "Work", status: "todo", completed: false }],
  });
  const changes = await learn(s, "Priya is my partner in cs1332 and I need that summer internship",
    candidate("person: priya", "Priya is their CS1332 partner.", "Priya is my partner in cs1332", { category: "person", entities: ["Priya"], links: ["m1"] }),
    candidate("internship goal", "Wants to land a summer internship with Priya's help.", "I need that summer internship", { category: "goal", entities: ["Priya"] }));
  const [priya, goal] = changes;
  assert.deepEqual(priya.entry.records, [{ type: "course", id: "c1" }], "Course codes match however they are spaced");
  assert.ok(goal.entry.records.some(r => r.type === "goal" && r.id === "g1"));
  assert.ok(!goal.entry.records.some(r => r.id === "t1"), "A one-word title is too easily a coincidence");
  assert.ok(priya.entry.related.includes(goal.entry.id), "Facts learned together about the same person connect");
  let m = apply(s.agentMemory, changes);
  const saved = m.entries.find(e => e.id === priya.entry.id);
  assert.ok(saved.related.includes("old"));
  assert.ok(m.entries.find(e => e.id === "old").related.includes(saved.id), "Connections work both ways");
  m = memory.applyMemoryChange(m, { kind: "forget", id: saved.id });
  assert.ok(m.entries.every(e => !e.related?.includes(saved.id)), "Forgetting leaves no dangling connection");
  assert.deepEqual(graph.matchRecords("work is busy", graph.recordCatalog(s)), []);
});

test("recall follows connections, linked records and the thread of the conversation", () => {
  const s = withEntries([
    entry("project", "project: synapse", "Is building a second brain app.", { category: "project", related: ["stack"], entities: ["Synapse"] }),
    entry("stack", "tech stack", "Prefers TypeScript and Supabase.", { category: "preference", related: ["project"] }),
    entry("partner", "person: priya", "Priya is a teammate.", { category: "person", entities: ["Synapse"] }),
    entry("course", "study approach", "Struggles most with recursion.", { records: [{ type: "course", id: "c1" }] }),
    entry("noise", "pizza", "Likes pizza.", { category: "preference" }),
  ], { study: { courses: [{ id: "c1", workspaceId: "w", code: "CS 1332", name: "Data Structures" }], folders: [], documents: [], decks: [], quizzes: [] } });
  const ids = q => memory.recallMemories(s, q).map(e => e.id);
  const app = ids("How should I structure the second brain app?");
  assert.equal(app[0], "project");
  assert.ok(app.includes("stack"), "A connected memory comes along");
  assert.ok(app.includes("partner"), "So does one about the same entity");
  assert.ok(!app.includes("noise"));
  assert.deepEqual(ids("Help me prep for CS 1332"), ["course"], "Linking to a named record is enough");
  const followUp = { ...s, chatHistory: [message("a", "Tell me about the second brain app")] };
  assert.ok(memory.recallMemories(followUp, "and what should I do next?").some(e => e.id === "project"), "Follow-ups keep their subject");
  const context = memory.memoryContext(s, "second brain app");
  assert.match(context, /Relevant to this message:[\s\S]*id project/);
  assert.match(context, /connected to: tech stack/);
  assert.match(context, /Profile:[\s\S]*pizza/, "The rest of who they are is always there");
});

test("the prompt stays bounded however large memory grows, and new chats get the profile with no extra calls", async () => {
  const entries = Array.from({ length: 500 }, (_, i) => entry(`e${i}`, `topic ${i}`, `Works on project ${i} with a very long description of everything about it `.repeat(2), { category: i % 2 ? "project" : "preference" }));
  const big = withEntries(entries);
  assert.ok(memory.memoryContext(big, "project 5 description").length < 7000);
  assert.ok(new TextEncoder().encode(memory.memoryContext(big, "hello")).length < 7500);
  const s = withEntries([entry("n", "name", "The user's name is Narain."), entry("p", "project", "Is building Synapse.", { category: "project" })]);
  const requests = provider([{ choices: [{ message: { content: "Hello Narain." } }] }]);
  await AutonomousBrainAgent.execute("Hi there", s);
  assert.equal(requests.length, 1, "No embedding or extraction call runs before the reply");
  assert.match(requests[0].messages[0].content, /Narain[\s\S]*Synapse/);
});

test("the learner batches turns, retries failures without losing them, and reads each message once", async () => {
  let current = state({ chatHistory: [message("a", "I like tea a lot")] });
  const commits = [], learned = [];
  const requests = [];
  const make = () => new learning.MemoryLearner({
    getState: () => current,
    commit: async changes => { commits.push(changes); current = { ...current, agentMemory: apply(current.agentMemory, changes) }; return current.agentMemory; },
    onLearned: byMessage => learned.push(byMessage),
    debounceMs: 5, maxPending: 3, retryMs: 5,
  });
  const learner = make();
  provider([proposes(candidate("tea", "Likes tea.", "I like tea", { message: 0 }), candidate("city", "Lives in Boston.", "I live in Boston", { message: 1 }))], requests);
  learner.enqueue([turn("a", "I like tea a lot")]);
  learner.enqueue([turn("b", "I live in Boston now")]);
  await wait(30);
  assert.equal(requests.length, 1, "Two quick turns share one call");
  assert.equal(commits.length, 1, "And one save");
  assert.equal(requests[0].model, "anthropic/claude-haiku-5.5");
  assert.deepEqual([...learned[0].keys()].sort(), ["a", "b"]);
  // Already read: a reload or reopening the chat costs nothing.
  learner.enqueue([turn("a", "I like tea a lot")]);
  await wait(15);
  assert.equal(requests.length, 1);

  const flaky = make(), attempts = [];
  provider([new Error("Provider down"), proposes(candidate("coffee", "Likes coffee too.", "I like coffee"))], attempts);
  flaky.enqueue([turn("c", "I like coffee as well")]);
  await wait(15);
  assert.equal(attempts.length, 2, "A failed batch is retried");
  assert.ok(current.agentMemory.entries.some(e => e.topic === "coffee"), "Nothing was lost");
  assert.equal(flaky.currentStatus.state, "idle");

  const closed = make(), never = [];
  provider([], never);
  closed.enqueue([turn("d", "I like running at dawn")]);
  closed.dispose();
  await wait(15);
  assert.equal(never.length, 0, "Disposed learners make no calls");
  const off = make();
  current = { ...current, agentMemory: { ...current.agentMemory, automaticLearning: false } };
  off.enqueue([turn("e", "I like swimming too")]);
  await wait(15);
  assert.equal(never.length, 0, "Turning learning off stops the queue");
});

test("a provider that never answers can't take a reply down with it", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => { requests.push(JSON.parse(options.body)); return Response.json({ choices: [{ message: { content: "Reply." } }] }); };
  const result = await AutonomousBrainAgent.execute("I like tea", state());
  assert.equal(result.queryAnswer, "Reply.");
  assert.equal(requests.length, 1, "Learning is not part of a reply");
});

test("reading all chats saves across threads, skips what was read and cannot restore forgotten memories", async () => {
  let forgotten = memory.applyMemoryChange(undefined, { kind: "remember", explicit: true, entry: entry("x", "hobby", "Likes chess.") });
  forgotten = memory.applyMemoryChange(forgotten, { kind: "forget", id: "x" });
  const s = state({
    agentMemory: forgotten, chatHistory: [message("now", "I live in Boston"), message("r", "OK", "assistant")],
    conversations: [{ id: "old", title: "Old", updatedAt: now, messages: [message("o1", "I like chess a lot"), message("o2", "My name is Narain Singaram")] }],
  });
  const commit = async changes => (s.agentMemory = apply(s.agentMemory, changes));
  const requests = provider([proposes(candidate("city", "Lives in Boston.", "I live in Boston", { message: 0 }), candidate("hobby", "Likes chess.", "I like chess", { message: 1 }), candidate("name", "Name is Narain Singaram.", "My name is Narain Singaram", { message: 2 }))]);
  const result = await learning.learnFromAllChats(s, commit, new AbortController().signal, () => {});
  assert.equal(requests.length, 1);
  assert.deepEqual(s.agentMemory.entries.map(e => e.topic).sort(), ["city", "name"]);
  assert.equal(result.reviewed, 3);
  assert.equal(s.agentMemory.entries.find(e => e.topic === "name").sources[0].conversationId, "old", "Evidence points at the right chat");
  provider([]);
  assert.equal((await learning.learnFromAllChats(s, commit, new AbortController().signal, () => {})).reviewed, 0, "Running it again costs nothing");
});

test("the assistant can pin, connect and search connections from chat", async () => {
  assert.equal(toolTier("organize_memory"), "internal");
  const tool = BRAIN_TOOLS.find(t => t.function.name === "organize_memory");
  assert.deepEqual(parseToolArguments(JSON.stringify({ id: "a", pinned: true, records: [{ type: "course", id: "c1" }] }), tool.function.parameters).records, [{ type: "course", id: "c1" }]);
  assert.throws(() => parseToolArguments(JSON.stringify({ id: "a", records: [{ type: "made-up", id: "c1" }] }), tool.function.parameters));
  const s = withEntries([entry("a", "stack", "Uses TypeScript."), entry("b", "project", "Builds Synapse.", { category: "project" })], {
    study: { courses: [{ id: "c1", workspaceId: "w", code: "CS 1332", name: "Data Structures" }], folders: [], documents: [], decks: [], quizzes: [] },
  });
  let m = s.agentMemory;
  const steps = [{ id: "a", pinned: true, relatedIds: ["b"], records: [{ type: "course", id: "c1" }] }];
  const requests = provider([
    { choices: [{ message: { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "organize_memory", arguments: JSON.stringify(steps[0]) } }] } }] },
    { choices: [{ message: { content: "Done." } }] },
  ]);
  await AutonomousBrainAgent.execute("Pin my stack memory and connect it", s, undefined, undefined, { getMemory: () => m, commitMemory: async change => (m = memory.applyMemoryChange(m, change)) });
  assert.ok(requests[0].tools.some(t => t.function.name === "organize_memory"));
  assert.equal(m.entries.find(e => e.id === "a").pinned, true);
  assert.ok(m.entries.find(e => e.id === "b").related.includes("a"));
  const read = await executeRead("search_memories", { query: "typescript" }, { ...s, agentMemory: m }, "key");
  assert.equal(read.output.results[0].connections.records[0].title, "CS 1332");
  assert.equal(read.output.results[0].connections.related[0].id, "b");
  // Removing a connection from the app clears it on both sides, and new fields survive a backup round trip.
  m = memory.normalizeAgentMemory(JSON.parse(JSON.stringify(m)));
  m = memory.applyMemoryChange(m, { kind: "edit", id: "a", related: [] });
  assert.ok(!m.entries.find(e => e.id === "b").related?.includes("a"));
  assert.throws(() => memory.normalizeAgentMemory({ ...m, entries: [{ ...m.entries[0], records: [{ type: "bad", id: "x" }] }] }));
});

test("a database still on the old memory rules keeps saving, without connections", async () => {
  const sent = [];
  const transport = {
    migrate: async () => "records", readPreferences: async () => ({ state: {}, revision: 1 }), preferencesRevision: async () => 1, readRecords: async () => [], savePreferences: async () => 2,
    saveRecords: async changes => {
      const row = changes.find(c => c.collection === "memory");
      if (row?.data?.entries?.some(e => "origin" in e || e.category === "person")) throw { message: "Invalid record memory agent" };
      sent.push(row?.data?.entries);
      return { saved: changes.map((c, i) => ({ collection: c.collection, id: c.id, revision: 1, seq: i + 1, deleted: false })), conflicts: [] };
    },
  };
  const sync = new RecordSync(transport);
  await sync.load();
  const agentMemory = { ...memory.emptyMemory(), entries: [entry("a", "person: priya", "Priya is a teammate.", { category: "person", origin: "auto", entities: ["Priya"] })] };
  await sync.save({ agentMemory, tasks: [] });
  assert.equal(sent[0][0].category, "fact");
  assert.equal(sent[0][0].entities, undefined);
  assert.equal(sent[0][0].content, "Priya is a teammate.");
});

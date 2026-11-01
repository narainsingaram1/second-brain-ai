import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});
after(() => server.close());
const memory = await server.ssrLoadModule("/src/services/agentMemory.ts");
const { AutonomousBrainAgent } = await server.ssrLoadModule(
  "/src/services/agentDispatcher.ts",
);
const { executeRead } = await server.ssrLoadModule(
  "/src/services/brainTools.ts",
);
const { semanticMemorySearch, setMemoryAccount, invalidateMemoryEmbedding } =
  await server.ssrLoadModule("/src/services/memorySemantic.ts");
const { previewHistoryMemories } = await server.ssrLoadModule(
  "/src/services/memoryHistory.ts",
);
const now = "2026-11-01T12:00:00Z";
const user = {
  id: "user-msg",
  role: "user",
  content: "I prefer concise answers with concrete examples.",
  timestamp: now,
};
const state = () => ({
  userId: "alice",
  tasks: [],
  goals: [],
  habits: [],
  journalEntries: [],
  knowledgeItems: [],
  chatHistory: [user],
  conversations: [],
  conversationId: "thread",
  sections: [],
  subsections: {},
  theme: "light",
  selectedModel: "test/model",
  openRouterKey: "fixture-key",
  agentMemory: memory.emptyMemory(),
});
const entry = (
  id = "m1",
  content = "Prefers concise answers with concrete examples.",
) => ({
  id,
  topic: "writing style",
  category: "preference",
  content,
  sources: [
    { conversationId: "thread", messageId: "user-msg", excerpt: user.content },
  ],
  createdAt: now,
  updatedAt: now,
  pinned: false,
});
const args = {
  topic: "writing style",
  category: "preference",
  content: "Prefers concise answers with concrete examples.",
  messageId: "user-msg",
  excerpt: user.content,
};
const completion = (content, tool_calls) => ({
  choices: [{ message: { content, tool_calls } }],
});
const call = (name, args) => ({
  id: crypto.randomUUID(),
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
function provider(responses, requests = []) {
  globalThis.fetch = async (url, options) => {
    assert.match(url, /chat\/completions$/);
    requests.push(JSON.parse(options.body));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, "No extra extraction call allowed");
    return Response.json(
      typeof next === "function" ? next(requests.at(-1)) : next,
    );
  };
  return requests;
}

test("memory defaults, limits and malformed backups are validated without silently deleting content", () => {
  assert.deepEqual(
    memory.normalizeAgentMemory(undefined),
    memory.emptyMemory(),
  );
  for (const bad of [
    null,
    {},
    { ...memory.emptyMemory(), version: 2 },
    {
      ...memory.emptyMemory(),
      entries: [{ ...entry(), category: "invented" }],
    },
    { ...memory.emptyMemory(), entries: [entry(), entry()] },
  ])
    assert.throws(() => memory.normalizeAgentMemory(bad));
  assert.throws(
    () =>
      memory.normalizeAgentMemory({
        ...memory.emptyMemory(),
        entries: Array.from({ length: 501 }, (_, i) => ({
          ...entry(`m${i}`),
          topic: `topic ${i}`,
        })),
      }),
    /full/,
  );
  assert.throws(
    () =>
      memory.normalizeAgentMemory({
        ...memory.emptyMemory(),
        entries: [
          { ...entry(), content: "api_key=sk-do-not-retain-1234567890" },
        ],
      }),
    /credential/,
  );
  assert.throws(
    () =>
      memory.normalizeAgentMemory({
        ...memory.emptyMemory(),
        suppressed: Array.from({ length: 4000 }, () => ({
          topicHash: "ab",
          sourceIds: ["x".repeat(100)],
          forgottenAt: now,
        })),
      }),
    /full/,
  );
});
test("automatic memory requires actual user evidence and rejects temporary, sensitive and secret content", () => {
  const s = state();
  const change = memory.prepareMemoryChange(
    "remember_memory",
    args,
    s,
    "I prefer concise answers",
    user,
  );
  assert.equal(
    memory.applyMemoryChange(s.agentMemory, change).entries.length,
    1,
  );
  assert.throws(
    () =>
      memory.prepareMemoryChange(
        "remember_memory",
        { ...args, messageId: "invented" },
        s,
        "hello",
        user,
      ),
    /exact excerpt/,
  );
  assert.throws(
    () =>
      memory.prepareMemoryChange(
        "remember_memory",
        args,
        s,
        "hello",
        user,
        true,
      ),
    /off/,
  );
  s.agentMemory.automaticLearning = false;
  assert.throws(
    () => memory.prepareMemoryChange("remember_memory", args, s, "hello", user),
    /disabled/,
  );
  assert.ok(
    memory.prepareMemoryChange(
      "remember_memory",
      args,
      s,
      "Remember my writing preference",
      user,
    ),
  );
  const sensitive = {
    ...user,
    content: "I have a medical diagnosis and take medication.",
  };
  s.chatHistory = [sensitive];
  s.agentMemory.automaticLearning = true;
  assert.throws(
    () =>
      memory.prepareMemoryChange(
        "remember_memory",
        { ...args, content: sensitive.content, excerpt: sensitive.content },
        s,
        "hello",
        sensitive,
      ),
    /Sensitive/,
  );
  assert.ok(
    memory.prepareMemoryChange(
      "remember_memory",
      { ...args, content: sensitive.content, excerpt: sensitive.content },
      s,
      "Remember my medical diagnosis",
      sensitive,
    ),
  );
  const temp = {
    ...user,
    content: "For this answer, I prefer long explanations.",
  };
  s.chatHistory = [temp];
  assert.throws(
    () =>
      memory.prepareMemoryChange(
        "remember_memory",
        { ...args, excerpt: temp.content },
        s,
        temp.content,
        temp,
      ),
    /enduring/,
  );
});
test("topic merging keeps identity and provenance; stale corrections and unrequested forgetting fail", () => {
  let m = memory.applyMemoryChange(undefined, {
    kind: "remember",
    entry: entry(),
    explicit: true,
  });
  m = memory.applyMemoryChange(m, {
    kind: "remember",
    entry: {
      ...entry("m2", "Prefers detailed answers."),
      updatedAt: "2026-11-02T12:00:00Z",
      sources: [
        {
          conversationId: "other",
          messageId: "correction",
          excerpt: "I now prefer detailed answers.",
        },
      ],
    },
    explicit: true,
  });
  assert.equal(m.entries.length, 1);
  assert.equal(m.entries[0].id, "m1");
  assert.equal(m.entries[0].sources.length, 2);
  assert.throws(
    () =>
      memory.applyMemoryChange(m, {
        kind: "edit",
        id: "m1",
        expectedUpdatedAt: now,
        content: "stale",
      }),
    /changed/,
  );
  assert.throws(
    () =>
      memory.prepareMemoryChange(
        "forget_memory",
        { id: "m1" },
        { ...state(), agentMemory: m },
        "hello",
        user,
      ),
    /explicit/,
  );
});
test("forgetting suppresses topic and source, survives backups, and only explicit new remember can restore it", () => {
  let m = memory.applyMemoryChange(undefined, {
    kind: "remember",
    entry: entry(),
    explicit: true,
  });
  m = memory.applyMemoryChange(m, { kind: "forget", id: "m1" });
  m = memory.normalizeAgentMemory(JSON.parse(JSON.stringify(m)));
  assert.equal(m.entries.length, 0);
  assert.equal(m.suppressed.length, 1);
  assert.throws(
    () =>
      memory.applyMemoryChange(m, {
        kind: "remember",
        entry: entry("new"),
        explicit: false,
      }),
    /forgotten/,
  );
  assert.throws(
    () =>
      memory.applyMemoryChange(m, {
        kind: "remember",
        entry: entry("new"),
        explicit: true,
      }),
    /forgotten/,
    "approving history import must not restore forgotten facts",
  );
  assert.equal(
    memory.applyMemoryChange(m, {
      kind: "remember",
      entry: entry("new"),
      explicit: true,
      restoreForgotten: true,
    }).entries.length,
    1,
  );
});
test("bounded local recall handles expiration, disablement, account changes and archived message IDs", async () => {
  const s = state();
  s.agentMemory.entries = [
    { ...entry(), pinned: true },
    {
      ...entry("expired"),
      topic: "outdated",
      expiresAt: "2020-01-01T00:00:00Z",
    },
  ];
  assert.equal(memory.searchMemories(s, "concise").total, 1);
  assert.match(memory.memoryContext(s, "hi"), /concise/);
  s.agentMemory.enabled = false;
  assert.equal(memory.searchMemories(s, "concise").total, 0);
  assert.doesNotMatch(memory.memoryContext(s, "hi"), /concise/);
  const other = state();
  other.userId = "bob";
  assert.equal(memory.searchMemories(other, "concise").total, 0);
  s.conversations = [
    {
      id: "old",
      title: "Research",
      updatedAt: now,
      messages: [
        {
          ...user,
          id: "old-msg",
          content: "We selected robotics as the project focus.",
        },
      ],
    },
  ];
  const result = memory.searchConversations(s, "robotics");
  assert.equal(result.results[0].conversationId, "old");
  const read = await executeRead(
    "recall_conversation",
    { conversationId: "old", offset: 0 },
    s,
    "",
  );
  assert.match(read.output.content, /robotics/);
  s.conversations = [];
  assert.equal(memory.searchConversations(s, "robotics").total, 0);
});
test("greetings make one normal model call and no embedding/extraction request; new chats receive relevant context", async () => {
  const s = state();
  s.agentMemory.entries = [{ ...entry(), pinned: true }];
  s.chatHistory = [];
  const requests = provider([completion("Hello.")]);
  await AutonomousBrainAgent.execute("Hello", s);
  assert.equal(requests.length, 1);
  assert.match(requests[0].messages[0].content, /Prefers concise/);
  assert.ok(memory.memoryContext(s, "hi").length < 8000);
});
test("agent saves through the existing tool loop, deduplicates writes, and only exposes confirmed IDs", async () => {
  const s = state();
  s.chatHistory = [];
  let m = s.agentMemory,
    writes = 0;
  provider([
    completion(null, [
      call("remember_memory", args),
      call("remember_memory", args),
    ]),
    completion("Remembered."),
  ]);
  const result = await AutonomousBrainAgent.execute(
    user.content,
    s,
    undefined,
    undefined,
    {
      currentMessage: user,
      getMemory: () => m,
      commitMemory: async (change) => {
        writes++;
        m = memory.applyMemoryChange(m, change);
        return m;
      },
    },
  );
  assert.equal(writes, 1);
  assert.equal(result.rememberedIds.length, 1);
  assert.equal(result.actions.length, 0);
  provider([
    completion(null, [call("remember_memory", args)]),
    completion("Could not save."),
  ]);
  const failed = await AutonomousBrainAgent.execute(
    user.content,
    s,
    undefined,
    undefined,
    {
      currentMessage: user,
      commitMemory: async () => {
        throw new Error("Cloud save failed");
      },
    },
  );
  assert.equal(failed.rememberedIds.length, 0);
  assert.match(failed.memoryNotice, /Cloud save failed/);
});
test("temporary chat sends no saved memory, no archives and no memory tool definitions", async () => {
  const s = state();
  s.agentMemory.entries = [entry()];
  s.chatHistory = [];
  const requests = provider([completion("Hello.")]);
  await AutonomousBrainAgent.execute("Hi", s, undefined, undefined, {
    temporary: true,
  });
  assert.doesNotMatch(requests[0].messages[0].content, /Prefers concise/);
  assert.ok(
    !requests[0].tools.some((t) =>
      ["remember_memory", "search_memories", "search_conversations"].includes(
        t.function.name,
      ),
    ),
  );
});
test("semantic memory search reuses unchanged vectors and invalidation cannot resurrect forgotten entries", async () => {
  const s = state();
  s.agentMemory.entries = [entry()];
  setMemoryAccount("alice");
  let inputs = [];
  globalThis.fetch = async (url, options) => {
    assert.match(url, /embeddings$/);
    const body = JSON.parse(options.body);
    inputs.push(...body.input);
    return Response.json({
      data: body.input.map((_, index) => ({ index, embedding: [1, 0, 0] })),
    });
  };
  await semanticMemorySearch(s, "brief replies", 0, "key");
  s.agentMemory.entries[0] = {
    ...s.agentMemory.entries[0],
    pinned: true,
    updatedAt: "2026-11-02T12:00:00Z",
  };
  await semanticMemorySearch(s, "short replies", 0, "key");
  assert.equal(
    inputs.filter((text) => text.includes("writing style")).length,
    1,
  );
  await invalidateMemoryEmbedding("alice", "m1");
  s.agentMemory = memory.applyMemoryChange(s.agentMemory, {
    kind: "forget",
    id: "m1",
  });
  assert.equal(
    (await semanticMemorySearch(s, "short replies", 0, "key")).total,
    0,
  );
  setMemoryAccount("bob");
  assert.equal(
    (
      await semanticMemorySearch(
        { ...s, userId: "bob" },
        "short replies",
        0,
        "key",
      )
    ).total,
    0,
  );
});
test("history import is preview-only, filters unsafe suggestions and supports cancellation", async () => {
  const s = state();
  s.conversations = [
    { id: "old", title: "Old", updatedAt: now, messages: [user] },
  ];
  provider([
    completion(null, [
      call("propose_memory_candidates", { candidates: [args] }),
    ]),
  ]);
  const preview = await previewHistoryMemories(
    s,
    ["old"],
    new AbortController().signal,
    () => {},
  );
  assert.equal(preview.candidates.length, 1);
  assert.equal(s.agentMemory.entries.length, 0);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    previewHistoryMemories(s, ["old"], abort.signal, () => {}),
  );
});

test("queued persistence resolves the latest snapshot and failed saves never publish confirmed memory", async () => {
  const { persistBrainState } = await server.ssrLoadModule(
    "/src/services/storage.ts",
  );
  const previousStorage = globalThis.localStorage;
  const data = new Map();
  const warn = console.warn,
    error = console.error;
  console.warn = () => {};
  console.error = () => {};
  globalThis.localStorage = {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  try {
    let latest = state();
    const nextMemory = memory.applyMemoryChange(latest.agentMemory, {
      kind: "remember",
      entry: entry(),
      explicit: true,
    });
    const first = persistBrainState(
      () => ({ ...latest, agentMemory: nextMemory }),
      "alice",
      (snapshot) => {
        latest = { ...latest, agentMemory: snapshot.agentMemory };
      },
    );
    latest = {
      ...latest,
      tasks: [
        {
          id: "concurrent",
          title: "An unrelated edit",
          status: "not_started",
          completed: false,
          section: "Work",
          priority: "medium",
          dueDate: "",
        },
      ],
    };
    const second = persistBrainState(() => latest, "alice");
    await Promise.all([first, second]);
    const saved = JSON.parse(data.get("synapse_second_brain_state"));
    assert.equal(saved.tasks[0].id, "concurrent");
    assert.equal(saved.agentMemory.entries[0].id, "m1");
    let confirmed = false;
    globalThis.localStorage.setItem = () => {
      throw new Error("Storage unavailable");
    };
    await assert.rejects(
      persistBrainState(
        () => latest,
        "alice",
        () => {
          confirmed = true;
        },
      ),
      /Could not save/,
    );
    assert.equal(confirmed, false);
  } finally {
    globalThis.localStorage = previousStorage;
    console.warn = warn;
    console.error = error;
  }
});

test("a confirmed memory remains reported if the provider fails later", async () => {
  const s=state();s.chatHistory=[];
  provider([completion(null,[call('remember_memory',args)]),new Error('Provider unavailable')]);
  const result=await AutonomousBrainAgent.execute(user.content,s,undefined,undefined,{currentMessage:user,commitMemory:async change=>memory.applyMemoryChange(undefined,change)});
  assert.equal(result.status,'error');assert.equal(result.rememberedIds.length,1);assert.match(result.explanation,/memory change.*saved/);assert.match(result.queryAnswer,/memory change.*saved/);
});
test("account changes cancel in-flight semantic indexing before vectors can be retained", async () => {
  const s=state();s.agentMemory.entries=[entry('pending')];setMemoryAccount('alice');
  let finish;globalThis.fetch=async()=>new Promise(resolve=>{finish=()=>resolve(Response.json({data:[{index:0,embedding:[1,0,0]}]}));});
  const pending=semanticMemorySearch(s,'context',0,'key');
  for(let i=0;i<20 && !finish;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.ok(finish);setMemoryAccount('bob');finish();await assert.rejects(pending);
  assert.equal((await semanticMemorySearch({...state(),userId:'bob'},'context',0,'key')).total,0);
});

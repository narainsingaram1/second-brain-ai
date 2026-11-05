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
const { previewHistoryMemories, learnFromTurn } = await server.ssrLoadModule(
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
    // Without IndexedDB, the save falls back to a single per-account localStorage copy.
    const saved = JSON.parse(data.get("synapse_user_data_alice"));
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

test("current personal facts bind to actual user evidence even with absent or incorrect model IDs", async () => {
  for (const [content, topic, category, messageId] of [
    ["My name is Narain Singaram", "name", "fact", undefined],
    ["my favorite color is blue", "favorite color", "preference", "wrong-model-id"],
  ]) {
    const s = state();
    s.chatHistory = [{ ...user, id: "assistant-only", role: "assistant", content: "Earlier reply" }];
    const current = { ...user, id: crypto.randomUUID(), content };
    let saved = s.agentMemory;
    const requests = provider([
      completion(null, [call("remember_memory", { topic, category, content, excerpt: content, ...(messageId ? { messageId } : {}) })]),
      completion("Remembered."),
    ]);
    const result = await AutonomousBrainAgent.execute(content, s, undefined, undefined, {
      currentMessage: current,
      commitMemory: async change => (saved = memory.applyMemoryChange(saved, change)),
    });
    assert.equal(result.status, "complete");
    assert.equal(result.memoryNotice, undefined);
    assert.equal(saved.entries.length, 1);
    assert.equal(saved.entries[0].sources[0].messageId, current.id);
    assert.equal(saved.entries[0].sources[0].excerpt, content);
    assert.equal(requests.length, 2, "Saving needs no separate extraction call");
    assert.equal(s.chatHistory.length, 1, "Original history remains untouched");
  }
});

test("binding current evidence never substitutes assistant claims or unrelated past user statements", () => {
  const s = state();
  s.chatHistory.push({ ...user, id: "assistant", role: "assistant", content: "Your favorite color is red" });
  const current = { ...user, id: "current-user", content: "Hello" };
  for (const evidence of [
    { messageId: "assistant", excerpt: "Your favorite color is red" },
    { messageId: "missing", excerpt: "My name is Somebody Else" },
    { messageId: user.id, excerpt: user.content },
  ]) {
    assert.throws(() => memory.prepareMemoryChange("remember_memory", { ...args, ...evidence }, s, current.content, current), /real user message|Past conversations/);
  }
});

test("conversation recall sees the current message and never duplicates it in the provider history", async () => {
  const s = state();
  const current = { ...user, id: "current-user", content: "My name is Narain Singaram" };
  s.chatHistory = [current];
  const requests = provider([
    completion(null, [call("recall_conversation", { offset: 0 })]),
    completion("Hello Narain."),
  ]);
  await AutonomousBrainAgent.execute(current.content, s, undefined, undefined, { currentMessage: current });
  assert.equal(requests[0].messages.filter(m => m.role === "user" && m.content === current.content).length, 1);
  const output = JSON.parse(requests[1].messages.find(m => m.role === "tool").content);
  assert.match(output.content, /Narain Singaram/);
  assert.equal((output.content.match(/current-user/g) || []).length, 1);
});

test("a recovered memory save clears its warning while retaining unrelated failed saves", async () => {
  const s = state(); s.chatHistory = [];
  let saved = s.agentMemory;
  const corrected = { ...args, excerpt: user.content };
  provider([
    completion(null, [
      call("remember_memory", { ...args, excerpt: "not actually said" }),
      call("remember_memory", { ...args, topic: "unrelated", excerpt: "also not said" }),
    ]),
    completion(null, [call("remember_memory", corrected)]),
    completion("Remembered your writing preference."),
  ]);
  const result = await AutonomousBrainAgent.execute(user.content, s, undefined, undefined, {
    currentMessage: user,
    commitMemory: async change => (saved = memory.applyMemoryChange(saved, change)),
  });
  assert.equal(saved.entries.length, 1);
  assert.ok(result.memoryNotice, "An unrelated failed save must remain visible");
  provider([
    completion(null, [call("remember_memory", { ...args, excerpt: "not actually said" })]),
    completion(null, [call("remember_memory", corrected)]),
    completion("Remembered."),
  ]);
  const recovered = await AutonomousBrainAgent.execute(user.content, s, undefined, undefined, {
    currentMessage: user,
    commitMemory: async change => memory.applyMemoryChange(s.agentMemory, change),
  });
  assert.equal(recovered.memoryNotice, undefined);
  assert.equal(recovered.rememberedIds.length, 1);
});

test("keyword retrieval ignores conversational filler and new chats receive basic identity", () => {
  const s = state();
  s.agentMemory.entries = [
    { ...entry("identity", "The user's name is Narain Singaram."), topic: "name", category: "fact" },
    { ...entry("color", "My favorite color is blue."), topic: "favorite color" },
    { ...entry("work", "My project is a weather app."), topic: "project", category: "project" },
  ];
  assert.deepEqual(memory.searchMemories(s, "What is my favorite color?").results.map(e => e.id), ["color"]);
  assert.equal(memory.searchMemories(s, "What do you remember about me?").total, 3, "Broad personal recall still lists all memories");
  assert.equal(memory.searchMemories(s, "").total, 3, "An empty query still lists all memories");
  assert.match(memory.memoryContext(s, "Hi there"), /Narain Singaram/);
});

test("hybrid memory search preserves keyword matches and caches repeated query embeddings per account", async () => {
  const s = state();
  s.userId = "hybrid-fixture";
  s.agentMemory.entries = [
    { ...entry("color", "Favorite color is blue."), topic: "favorite color" },
    { ...entry("style", "Use brief explanations."), topic: "writing style" },
  ];
  setMemoryAccount(s.userId);
  let queryCalls = 0;
  globalThis.fetch = async (_url, options) => {
    const { input } = JSON.parse(options.body);
    if (input.length === 1 && input[0] === "favorite color") queryCalls++;
    return Response.json({ data: input.map((text, index) => ({ index, embedding: text.startsWith("favorite color\n") ? [0, 1] : [1, 0] })) });
  };
  const first = await semanticMemorySearch(s, "favorite color", 0, "fixture");
  assert.equal(first.mode, "hybrid");
  assert.equal(first.total, 2);
  assert.ok(first.results.some(e => e.id === "color"), "Exact keyword evidence survives low cosine similarity");
  await semanticMemorySearch(s, "favorite color", 0, "fixture");
  assert.equal(queryCalls, 1);
  setMemoryAccount("another-hybrid-account");
  await semanticMemorySearch({ ...s, userId: "another-hybrid-account" }, "favorite color", 0, "fixture");
  assert.equal(queryCalls, 2, "Query cache is isolated across accounts");
});

test("saved personal facts survive storage reload and are retrieved in a fresh conversation", async () => {
  const { persistBrainState, loadInitialState } = await server.ssrLoadModule("/src/services/storage.ts");
  const previousStorage = globalThis.localStorage;
  const data = new Map();
  globalThis.localStorage = {
    getItem: key => data.get(key) || null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  };
  try {
    let latest = state(); latest.chatHistory = [];
    const save = async change => {
      await persistBrainState(
        () => ({ ...latest, agentMemory: memory.applyMemoryChange(latest.agentMemory, change) }),
        latest.userId,
        snapshot => { latest = snapshot; },
      );
      return latest.agentMemory;
    };
    for (const [text, topic, category] of [
      ["My name is Narain Singaram", "name", "fact"],
      ["my favorite color is blue", "favorite color", "preference"],
    ]) {
      provider([
        completion(null, [call("remember_memory", { topic, category, content: text, excerpt: text })]),
        completion("Remembered."),
      ]);
      const result = await AutonomousBrainAgent.execute(text, latest, undefined, undefined, { commitMemory: save });
      assert.equal(result.rememberedIds.length, 1);
      assert.equal(result.memoryNotice, undefined);
    }
    const restored = await loadInitialState(latest.userId);
    assert.equal(restored.agentMemory.entries.length, 2);
    restored.chatHistory = [];
    restored.conversationId = "fresh-conversation";
    const requests = provider([
      completion(null, [call("search_memories", { query: "favorite color" })]),
      request => {
        const evidence = JSON.parse(request.messages.filter(m => m.role === "tool").at(-1).content);
        assert.equal(evidence.results.length, 1);
        assert.match(evidence.results[0].content, /blue/);
        return completion("Your favorite color is blue.");
      },
    ]);
    const answer = await AutonomousBrainAgent.execute("What is my favorite color?", restored);
    assert.match(requests[0].messages[0].content, /Narain Singaram/);
    assert.match(answer.queryAnswer, /blue/);
    assert.equal(answer.rememberedIds.length, 0, "Recall does not resave existing memories");
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test("explicit remember/forget intent ignores questions, recall and idioms", () => {
  const remember = [
    ["Remember my writing preference", true], ["Remember that I'm vegetarian.", true], ["Please memorize my favorite color is teal", true],
    ["Can you remember that I prefer dark mode?", true], ["Save this to memory for the future", true], ["Keep in mind I hate 8am classes", true],
    ["Don't forget that I work Tuesdays", true],
    ["Do you remember when my exam is?", false], ["I can't remember my therapist's name", false], ["Remember when we talked about CS 1332?", false],
    ["What do you remember about me?", false], ["Remember I like tea, but don't save my address", false], ["Help me remember to study", false],
  ];
  const forget = [
    ["Forget my old address", true], ["Please forget that I like tea", true], ["Delete that memory", true], ["Stop remembering my diet", true],
    ["Can you forget my GPA?", true],
    ["I always forget to drink water", false], ["Forget it.", false], ["Don't forget to buy milk", false], ["I don't remember that", false],
  ];
  for (const [prompt, expected] of remember) assert.equal(memory.explicitlyRemember(prompt), expected, prompt);
  for (const [prompt, expected] of forget) assert.equal(memory.explicitlyForget(prompt), expected, prompt);
});

test("background learning saves only gated facts from the current message and skips plain questions", async () => {
  const msg = { id: "turn-1", role: "user", content: "I'm a CS major at Georgia Tech and I prefer studying at night. Can you plan my week?", timestamp: now };
  const s = { ...state(), chatHistory: [msg] };
  const requests = [];
  provider([completion(null, [call("propose_memories", { candidates: [
    { topic: "major", category: "fact", content: "Studies CS at Georgia Tech.", excerpt: "I'm a CS major at Georgia Tech" },
    { topic: "study time", category: "preference", content: "Prefers studying at night.", excerpt: "I prefer studying at night" },
    { topic: "invented", category: "fact", content: "Lives in Paris.", excerpt: "I live in Paris" },
    { topic: "health", category: "fact", content: "Has ADHD.", excerpt: "I'm a CS major at Georgia Tech" },
  ] })])], requests);
  const changes = await learnFromTurn(s, msg, "Here is your week…");
  assert.deepEqual(changes.map(c => c.entry.topic).sort(), ["major", "study time"], "Unquoted and sensitive candidates are dropped");
  assert.ok(changes.every(c => c.entry.sources[0].messageId === "turn-1" && !c.explicit));
  assert.equal(requests[0].model, "anthropic/claude-haiku-5.5");
  assert.equal(requests[0].tool_choice.function.name, "propose_memories");

  globalThis.fetch = async () => assert.fail("A question with no personal statement must not call the provider");
  const question = { id: "turn-2", role: "user", content: "What is due this week?", timestamp: now };
  assert.deepEqual(await learnFromTurn({ ...s, chatHistory: [question] }, question, "…"), []);
  const off = { ...s, agentMemory: { ...memory.emptyMemory(), automaticLearning: false } };
  assert.deepEqual(await learnFromTurn(off, msg, "…"), [], "Disabled automatic learning never calls the provider");
});

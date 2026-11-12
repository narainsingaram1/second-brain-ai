import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});
after(() => server.close());
const {
  DEFAULT_PLANNER,
  fixedBlocks,
  schedulePlan,
  overlaps,
  upcomingTasks,
  validRange,
} = await server.ssrLoadModule("/src/utils/dailyPlanner.ts");
const date = "2026-11-16"; // Monday
const now = new Date("2026-11-15T12:00:00");
const fixed = {
  id: "class",
  sourceId: "class",
  title: "Lecture",
  start: "09:00",
  end: "10:00",
  kind: "event",
  locked: true,
};
const work = (title, minutes = 50, taskId) => ({
  title,
  minutes,
  kind: "focus",
  taskId,
});

test("reserves weekly classes and dated events without inventing course times", () => {
  const data = {
    ...DEFAULT_PLANNER,
    routines: [
      {
        id: "cs",
        title: "CS lecture",
        start: "10:00",
        end: "11:00",
        days: [1, 3],
      },
    ],
  };
  const events = [
    {
      id: "meeting",
      title: "Meeting",
      date,
      startTime: "13:00",
      endTime: "14:00",
    },
    { id: "all", title: "Holiday", date },
  ];
  const blocks = fixedBlocks(date, data, events);
  assert.deepEqual(
    blocks.map((b) => b.start),
    ["10:00", "13:00"],
  );
  assert.equal(fixedBlocks("2026-11-17", data, events).length, 0);
});
test("fits work into gaps, never overlaps fixed commitments or extends the day", () => {
  const result = schedulePlan(
    date,
    { ...DEFAULT_PLANNER, end: "12:00" },
    [fixed],
    [work("A"), work("B"), work("C"), work("D", 90)],
    now,
  );
  assert.deepEqual(
    result.blocks.map((b) => b.start),
    ["08:00", "09:00", "10:00", "10:50"],
  );
  assert.deepEqual(result.unscheduled, ["D"]);
  result.blocks.forEach((b, i) =>
    result.blocks.forEach((other, j) => {
      if (i !== j) assert.equal(overlaps(b, other), false);
    }),
  );
});
test("replanning preserves locked and finished sessions and prevents duplicate task sessions", () => {
  const locked = {
    id: "locked",
    title: "Gym",
    start: "08:00",
    end: "09:00",
    kind: "personal",
    locked: true,
  };
  const done = {
    id: "done",
    title: "Assignment",
    start: "10:00",
    end: "11:00",
    kind: "focus",
    done: true,
    taskId: "task1",
  };
  const data = {
    ...DEFAULT_PLANNER,
    plans: {
      [date]: {
        blocks: [locked, done, { ...fixed, done: true }],
        summary: "",
        unscheduled: [],
      },
    },
  };
  const result = schedulePlan(
    date,
    data,
    [fixed],
    [work("Duplicate", 50, "task1"), work("Next", 30, "task2")],
    now,
  );
  assert.ok(result.blocks.some((b) => b.id === "locked"));
  assert.ok(result.blocks.some((b) => b.id === "done"));
  assert.equal(result.blocks.find((b) => b.id === "class").done, true);
  assert.equal(result.blocks.filter((b) => b.taskId === "task1").length, 1);
});
test("today starts after the current time and tasks respect a same-day due time", () => {
  const late = new Date(2026, 10, 16, 14, 12);
  const result = schedulePlan(
    date,
    DEFAULT_PLANNER,
    [],
    [{ ...work("Late task"), latestEnd: "14:30" }, work("Next", 25)],
    late,
  );
  assert.deepEqual(result.unscheduled, ["Late task"]);
  assert.equal(result.blocks[0].start, "14:15");
});
test("invalid and overnight day windows are rejected; touching endpoints do not overlap", () => {
  assert.equal(validRange("23:00", "08:00"), false);
  assert.equal(validRange("bad", "09:00"), false);
  assert.throws(() =>
    schedulePlan(date, { ...DEFAULT_PLANNER, end: "07:00" }, [], [], now),
  );
  assert.equal(overlaps({ start: "08:00", end: "09:00" }, fixed), false);
});
test("deadline horizon includes overdue and undated work and excludes completed tasks", () => {
  const task = { priority: "medium", status: "not_started", completed: false };
  const state = {
    tasks: [
      { ...task, id: "overdue", dueDate: "2026-11-01" },
      { ...task, id: "soon", dueDate: "2026-11-20" },
      { ...task, id: "far", dueDate: "2026-12-01" },
      { ...task, id: "done", dueDate: date, completed: true },
      { ...task, id: "undated", dueDate: "" },
    ],
  };
  assert.deepEqual(
    upcomingTasks(state, date).map((t) => t.id),
    ["overdue", "soon", "undated"],
  );
});
test("planner preferences survive the existing cloud record assembly", async () => {
  const { preferencesOf, assembleState } = await server.ssrLoadModule(
    "/src/services/brainRecords.ts",
  );
  const planner = {
    ...DEFAULT_PLANNER,
    plans: {
      [date]: schedulePlan(date, DEFAULT_PLANNER, [fixed], [work("Read")], now),
    },
  };
  const preferences = { askBeforeChanges: true, planner };
  assert.deepEqual(
    assembleState(preferencesOf({ preferences }), []).preferences,
    preferences,
  );
});
test("time-sensitive activities wait until their preferred time", () => {
  const result = schedulePlan(
    date,
    DEFAULT_PLANNER,
    [],
    [
      { title: "Lunch", kind: "break", minutes: 30, preferredStart: "12:00" },
      work("Morning work"),
    ],
    now,
  );
  assert.equal(result.blocks.find((b) => b.title === "Lunch").start, "12:00");
  assert.equal(
    result.blocks.find((b) => b.title === "Morning work").start,
    "08:00",
  );
});
test("AI request uses live commitments and validates generated task references", async () => {
  const { suggestDailyPlan } = await server.ssrLoadModule(
    "/src/services/dailyPlannerAI.ts",
  );
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "Focus on the approaching deadline.",
                suggestions: [
                  {
                    title: "Work on assignment",
                    minutes: 50,
                    kind: "focus",
                    taskId: "t1",
                  },
                  {
                    title: "Invented task",
                    minutes: 50,
                    kind: "focus",
                    taskId: "unknown",
                  },
                  {
                    title: "Lunch",
                    minutes: 30,
                    kind: "break",
                    preferredStart: "12:00",
                  },
                  { title: "Invalid duration", minutes: -10, kind: "personal" },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const state = {
      tasks: [
        {
          id: "t1",
          title: "Assignment",
          dueDate: date,
          dueTime: "17:00",
          completed: false,
          status: "not_started",
          priority: "high",
        },
      ],
      habits: [{ name: "Walk", frequency: "daily", history: {} }],
      openRouterKey: "test-key",
      selectedModel: "test/model",
    };
    const result = await suggestDailyPlan(
      state,
      date,
      DEFAULT_PLANNER,
      [fixed],
      new AbortController().signal,
    );
    assert.deepEqual(
      result.suggestions.map((s) => s.title),
      ["Work on assignment", "Lunch"],
    );
    assert.equal(result.suggestions[0].latestEnd, "17:00");
    assert.equal(result.suggestions[1].preferredStart, "12:00");
    const context = JSON.parse(request.messages[1].content);
    assert.equal(context.fixed[0].id, "class");
    assert.equal(context.tasks[0].id, "t1");
    assert.equal(context.habits[0].name, "Walk");
    state.openRouterKey = "";
    await assert.rejects(
      () =>
        suggestDailyPlan(
          state,
          date,
          DEFAULT_PLANNER,
          [],
          new AbortController().signal,
        ),
      /key/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const plannerState = {
  tasks: [], habits: [], openRouterKey: "test-key", selectedModel: "test/model",
};
const validPlan = JSON.stringify({
  summary: "Make room for focused work and rest.",
  suggestions: [{ title: "Take a walk", minutes: 20, kind: "personal" }],
});

test("planner recovers from empty, non-JSON, truncated and invalid model answers", async () => {
  const { suggestDailyPlan } = await server.ssrLoadModule("/src/services/dailyPlannerAI.ts");
  const originalFetch = globalThis.fetch;
  try {
    for (const first of [
      { message: { content: null, reasoning: "Still thinking" }, finish_reason: "length" },
      { message: { content: "" }, finish_reason: "stop" },
      { message: { content: "Here is how I would plan your day." } },
      { message: { content: '{"suggestions":[' }, finish_reason: "length" },
      { message: { content: validPlan }, finish_reason: "length" },
      { message: { content: "null" } },
      { message: { content: '{"suggestions":[]}' } },
      { message: { content: '{"suggestions":[{"title":"Invented task","minutes":50,"kind":"focus","taskId":"unknown"}]}' } },
    ]) {
      const requests = [];
      globalThis.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return Response.json({ choices: [requests.length === 1 ? first : { message: { content: validPlan }, finish_reason: "stop" }] });
      };
      const result = await suggestDailyPlan(plannerState, date, DEFAULT_PLANNER, [fixed], new AbortController().signal);
      assert.equal(result.suggestions[0].title, "Take a walk");
      assert.equal(requests.length, 2);
      assert.deepEqual(requests.map((r) => r.max_tokens), [8000, 12000]);
      assert.deepEqual(requests[0].response_format, { type: "json_object" });
      assert.deepEqual(requests[1].messages, requests[0].messages);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("planner bounds retries and falls back transparently to a basic plan", async () => {
  const { suggestDailyPlan } = await server.ssrLoadModule("/src/services/dailyPlannerAI.ts");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ choices: [{ message: { content: "No plan" } }] });
  };
  try {
    const result = await suggestDailyPlan(plannerState, date, DEFAULT_PLANNER, [], new AbortController().signal);
    assert.match(result.summary, /AI could not return a usable plan.*basic plan/);
    assert.deepEqual(result.suggestions, []);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("planner does not retry provider failures or cancellation", async () => {
  const { suggestDailyPlan } = await server.ssrLoadModule("/src/services/dailyPlannerAI.ts");
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [200, 401, 429, 500]) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return Response.json({ error: { message: "Provider unavailable" } }, { status }); };
      await assert.rejects(() => suggestDailyPlan(plannerState, date, DEFAULT_PLANNER, [], new AbortController().signal), /Provider unavailable/);
      assert.equal(calls, 1);
    }
    const controller = new AbortController();
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      controller.abort();
      return Response.json({ choices: [{ message: { content: "" } }] });
    };
    await assert.rejects(() => suggestDailyPlan(plannerState, date, DEFAULT_PLANNER, [], controller.signal), { name: "AbortError" });
    assert.equal(calls, 1);
    await assert.rejects(() => suggestDailyPlan(plannerState, date, DEFAULT_PLANNER, [], controller.signal), { name: "AbortError" });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("a slow provider reaches one shared deadline and produces a schedulable basic plan", async (t) => {
  const { suggestDailyPlan } = await server.ssrLoadModule("/src/services/dailyPlannerAI.ts");
  const deadline = new AbortController();
  const limits = [];
  t.mock.method(AbortSignal, "timeout", (ms) => { limits.push(ms); return deadline.signal; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls++;
    if (calls === 1) return Response.json({ choices: [{ message: { content: "not JSON" } }] });
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      queueMicrotask(() => deadline.abort(new DOMException("signal timed out", "TimeoutError")));
    });
  });
  const state = {
    ...plannerState,
    tasks: [
      { id: "t1", title: "Assignment", dueDate: date, dueTime: "12:00", priority: "high" },
      { id: "kept", title: "Already scheduled", dueDate: date, priority: "high" },
      { id: "done", title: "Finished", dueDate: date, completed: true, priority: "high" },
    ],
    habits: [
      { name: "Walk", timeOfDay: "evening", frequency: "daily", history: {} },
      { name: "Meditate", frequency: "daily", history: { [date]: true } },
      { name: "Lecture", frequency: "daily", history: {} },
    ],
  };
  const locked = { id: "kept-block", title: "Already scheduled", taskId: "kept", start: "10:00", end: "11:00", kind: "focus", locked: true };
  const data = { ...DEFAULT_PLANNER, instructions: "Keep the afternoon free", plans: { [date]: { blocks: [locked] } } };
  const result = await suggestDailyPlan(state, date, data, [fixed], new AbortController().signal);
  assert.equal(calls, 2);
  assert.ok(limits.every((ms) => ms === 30000));
  assert.match(result.summary, /AI took too long.*basic plan/);
  assert.match(result.summary, /preferences were not interpreted/);
  assert.deepEqual(result.suggestions.map((s) => s.title), ["Assignment", "Walk"]);
  assert.equal(result.suggestions[0].latestEnd, "12:00");
  assert.equal(result.suggestions[1].preferredStart, "17:00");
  const scheduled = schedulePlan(date, data, [fixed], result.suggestions, now);
  assert.equal(scheduled.blocks.find((b) => b.taskId === "kept").id, locked.id);
  assert.ok(scheduled.blocks.find((b) => b.taskId === "t1").end <= "12:00");
  assert.equal(scheduled.blocks.find((b) => b.title === "Walk").start, "17:00");
  scheduled.blocks.forEach((a, i) => scheduled.blocks.forEach((b, j) => {
    if (i !== j) assert.equal(overlaps(a, b), false);
  }));
});

test("user cancellation takes precedence over the fallback even when the deadline expires", async (t) => {
  const { suggestDailyPlan } = await server.ssrLoadModule("/src/services/dailyPlannerAI.ts");
  const user = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    user.abort();
    throw new DOMException("signal timed out", "TimeoutError");
  });
  await assert.rejects(() => suggestDailyPlan(plannerState, date, DEFAULT_PLANNER, [], user.signal), { name: "AbortError" });
});

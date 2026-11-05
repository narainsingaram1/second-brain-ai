import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
const server = await createServer({
  configFile: false,
  cacheDir: "/private/tmp/synapse-workspaces-test-cache",
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});
after(() => server.close());
const {
  CAREER_WORKSPACE_ID,
  normalizeWorkspaces,
  normalizeTrackerItems,
  workspaceItems,
  removeWorkspace,
  logSolve,
  practiceDays,
  practiceStreak,
  safeTrackerUrl,
} = await server.ssrLoadModule("/src/utils/workspaces.ts");
const { records } = await server.ssrLoadModule(
  "/src/services/brainRetrieval.ts",
);
const item = (id, workspaceId = CAREER_WORKSPACE_ID, kind = "leetcode") => ({
  id,
  workspaceId,
  kind,
  title: "Two Sum",
  subject: "Arrays",
  status: "not_started",
  fields: { difficulty: "Easy" },
  history: {},
  notes: "",
  streak: 0,
  bestStreak: 0,
  createdAt: "2026-11-01T12:00:00Z",
  updatedAt: "2026-11-01T12:00:00Z",
});
const empty = {
  tasks: [],
  goals: [],
  habits: [],
  journalEntries: [],
  knowledgeItems: [],
  trackerItems: [],
  sections: [],
  subsections: {},
  chatHistory: [],
  openRouterKey: "",
  selectedModel: "test/model",
  theme: "light",
};

test("old snapshots receive a Career workspace, explicit deletions stay deleted, and malformed collections are safe", () => {
  assert.equal(normalizeWorkspaces(undefined)[0].id, CAREER_WORKSPACE_ID);
  assert.deepEqual(normalizeWorkspaces([]), []);
  assert.deepEqual(normalizeWorkspaces([null, {}, { id: "" }]), []);
  const spaces = normalizeWorkspaces([
    { id: "a", name: "  Career  ", template: "career", color: "url(evil)" },
    { id: "a", name: "duplicate" },
  ]);
  assert.equal(spaces.length, 1);
  assert.equal(spaces[0].name, "Career");
  assert.equal(spaces[0].color, "purple");
  const { workspaceId: _legacy, ...legacy } = item("old");
  const tracker = normalizeTrackerItems([
    null,
    {},
    legacy,
    legacy,
    { ...item("bad"), kind: "invalid" },
  ]);
  assert.equal(tracker.length, 1);
  assert.equal(tracker[0].workspaceId, CAREER_WORKSPACE_ID);
  assert.deepEqual(normalizeTrackerItems({}), []);
});

test("deleting a workspace cascades only its tracker entries and preserves unrelated account data", () => {
  const spaces = normalizeWorkspaces([
    { id: CAREER_WORKSPACE_ID, name: "Career", template: "career" },
    { id: "another", name: "Other", template: "career" },
  ]);
  const { workspaceId: _legacy, ...legacy } = item("legacy");
  const original = {
    ...empty,
    workspaces: spaces,
    trackerItems: [item("one"), item("two", "another"), legacy],
    knowledgeItems: [{ id: "note", content: "Keep this note" }],
  };
  assert.deepEqual(
    workspaceItems(original.trackerItems, CAREER_WORKSPACE_ID).map(
      (item) => item.id,
    ),
    ["one", "legacy"],
  );
  const deleted = removeWorkspace(original, CAREER_WORKSPACE_ID);
  assert.deepEqual(
    deleted.workspaces.map((space) => space.id),
    ["another"],
  );
  assert.deepEqual(
    deleted.trackerItems.map((item) => item.id),
    ["two"],
  );
  assert.deepEqual(deleted.knowledgeItems, original.knowledgeItems);
  assert.equal(original.trackerItems.length, 3);
});

test("practice logging tracks repeat solves, local calendar review dates, activity and streaks across month boundaries", () => {
  const original = item("one");
  const first = logSolve(original, new Date(2026, 9, 31, 23, 30));
  assert.equal(first.status, "done");
  assert.equal(first.history["2026-10-31"], 1);
  assert.equal(first.fields.lastPractice, "2026-10-31");
  assert.equal(first.fields.nextReview, "2026-11-07");
  const repeat = logSolve(first, new Date(2026, 9, 31, 23, 45));
  assert.equal(repeat.history["2026-10-31"], 2);
  assert.deepEqual(original.history, {});
  const next = logSolve(repeat, new Date(2026, 10, 1, 9));
  assert.equal(practiceStreak([next], new Date(2026, 10, 1, 12)), 2);
  assert.equal(
    practiceStreak([next], new Date(2026, 10, 2, 12)),
    2,
    "yesterday keeps an in-progress streak alive",
  );
  assert.equal(practiceStreak([next], new Date(2026, 10, 3, 12)), 0);
  assert.deepEqual(practiceDays([next], new Date(2026, 10, 1), 2), [
    { date: "2026-10-31", count: 2 },
    { date: "2026-11-01", count: 1 },
  ]);
});

test("tracker links reject executable protocols and retrieval retains status, company, notes, and workspace provenance", () => {
  assert.equal(safeTrackerUrl("javascript:alert(1)"), undefined);
  assert.equal(safeTrackerUrl("data:text/html,hello"), undefined);
  assert.equal(safeTrackerUrl("not a url"), undefined);
  assert.equal(
    safeTrackerUrl("https://leetcode.com/problems/two-sum/"),
    "https://leetcode.com/problems/two-sum/",
  );
  const application = {
    ...item("application", "career-two", "job_application"),
    title: "Engineer",
    subject: "Example Co",
    status: "screening",
    notes: "Follow up with recruiter",
    fields: { appliedDate: "2026-11-05" },
  };
  const record = records(
    { ...empty, trackerItems: [application] },
    "tracker",
  )[0];
  assert.equal(record.data.subject, "Example Co");
  assert.equal(record.data.status, "screening");
  assert.equal(record.data.workspaceId, "career-two");
  assert.equal(record.data.notes, "Follow up with recruiter");
});

test("workspace notes and both trackers survive actual canonical storage and account reload", async () => {
  const { persistBrainState, loadInitialState } = await server.ssrLoadModule(
    "/src/services/storage.ts",
  );
  const values = new Map();
  const previous = {
    localStorage: globalThis.localStorage,
    window: globalThis.window,
  };
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.window = { dispatchEvent() {} };
  const before = {
    ...empty,
    userId: "career-owner",
    workspaces: normalizeWorkspaces(undefined).map((space) => ({
      ...space,
      notes: "Prepare project examples",
    })),
    trackerItems: [
      logSolve(item("problem")),
      {
        ...item("job", CAREER_WORKSPACE_ID, "job_application"),
        subject: "Example Co",
        status: "applied",
      },
    ],
  };
  try {
    await persistBrainState(before, "career-owner");
    const restored = await loadInitialState("career-owner");
    assert.deepEqual(restored.workspaces, before.workspaces);
    assert.deepEqual(restored.trackerItems, before.trackerItems);
    const other = await loadInitialState("other-owner");
    assert.deepEqual(
      other.trackerItems,
      [],
      "accounts do not share tracker entries",
    );
    assert.equal(
      other.workspaces[0].notes,
      "",
      "accounts do not share workspace notes",
    );
    const again = await loadInitialState("career-owner");
    assert.deepEqual(again.trackerItems, before.trackerItems);
  } finally {
    globalThis.localStorage = previous.localStorage;
    globalThis.window = previous.window;
  }
});

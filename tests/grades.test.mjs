import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
const server = await createServer({ configFile: false, cacheDir: "/private/tmp/synapse-grades-test-cache", server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
after(() => server.close());
const g = await server.ssrLoadModule("/src/utils/grades.ts");
const tools = await server.ssrLoadModule("/src/services/brainTools.ts");
const { records } = await server.ssrLoadModule("/src/services/brainRetrieval.ts");

test("parses common ways of writing a grade breakdown", () => {
  assert.deepEqual(g.parseWeights("exams are 20%, hw is 20% but projects are 30% etc"), [
    { name: "Exams", weight: 20 }, { name: "Hw", weight: 20 }, { name: "Projects", weight: 30 },
  ]);
  assert.deepEqual(g.parseWeights("20% exams, 30% projects and 50% final").map((p) => [p.name, p.weight]), [["Exams", 20], ["Projects", 30], ["Final", 50]]);
  assert.deepEqual(g.parseWeights("Homework 20% (drop lowest 2), Quizzes 10%").map((p) => [p.name, p.dropLowest]), [["Homework", 2], ["Quizzes", undefined]]);
  const parsed = g.parseWeights("Homework (10 assignments, lowest dropped) - 20%\nQuizzes: 10%\nMidterm 25%\nFinal Exam ..... 30%\n15% Projects");
  assert.deepEqual(parsed.map((p) => [p.name, p.weight]), [["Homework", 20], ["Quizzes", 10], ["Midterm", 25], ["Final Exam", 30], ["Projects", 15]]);
  assert.equal(parsed[0].count, 10);
  assert.equal(parsed[0].dropLowest, 1);
  assert.deepEqual(g.parseWeights("Labs 15 percent; participation 5%").map((p) => p.weight), [15, 5]);
  assert.deepEqual(g.parseWeights("no numbers here"), []);
});

const grading = () => ({
  categories: [
    { id: "ex", name: "Exams", weight: 50 },
    { id: "hw", name: "Homework", weight: 30, count: 4, dropLowest: 1 },
    { id: "pj", name: "Projects", weight: 20 },
  ],
  items: [
    { id: "m1", categoryId: "ex", title: "Midterm", score: 80, maxScore: 100, date: "2026-10-01" },
    { id: "fx", categoryId: "ex", title: "Final", maxScore: 100, date: "2026-12-10" },
    { id: "h1", categoryId: "hw", title: "HW 1", score: 10, maxScore: 10, date: "2026-09-05" },
    { id: "h2", categoryId: "hw", title: "HW 2", score: 5, maxScore: 10, date: "2026-09-12" },
    { id: "h3", categoryId: "hw", title: "HW 3", score: 9, maxScore: 10, date: "2026-09-19" },
  ],
});

test("weighted grade, drops, completed share and what is needed", () => {
  const s = g.summarize(grading());
  // HW: 3 graded, lowest (50%) dropped -> 95% avg on 2 of 3 slots.
  const hw = s.categories.find((c) => c.category.id === "hw");
  assert.equal(Math.round(hw.average), 95);
  assert.ok(hw.droppedIds.has("h2"));
  assert.ok(Math.abs(hw.gradedFraction - 2 / 3) < 1e-9);
  // Exams: midterm graded, final upcoming -> half graded.
  // completed = 25 (exams) + 20 (hw) = 45; earned = 25*.8 + 20*.95 = 39
  assert.ok(Math.abs(s.completed - 45) < 1e-9);
  assert.ok(Math.abs(s.earned - 39) < 1e-9);
  assert.equal(s.current, 86.7);
  assert.equal(s.letter, "B");
  assert.ok(Math.abs(s.remaining - 55) < 1e-9);
  assert.equal(s.maxPossible, 94);
  assert.equal(g.neededFor(s, 90), 92.7);
  // The final is worth 25 points; others (30) at current pace 86.7.
  const need = g.neededOnItem(s, grading().items[1], 90);
  assert.equal(need, ((90 - 39 - (30 * 86.7) / 100) / 25 * 100).toFixed(1) * 1);
});

test("trend, insights, normalization and assistant view", () => {
  const trend = g.gradeTrend(grading());
  assert.deepEqual(trend.map((p) => p.id), ["h1", "h2", "h3", "m1"]);
  assert.equal(trend[0].grade, 100);
  const insights = g.gradeInsights(grading(), 90).map((i) => i.text);
  assert.match(insights[0], /average 92.7% on the remaining 55% of the grade/);
  assert.ok(insights.some((t) => /Exams is pulling you down/.test(t)));
  assert.equal(g.normalizeGrading({ categories: [{ id: "a", name: "x", weight: -1 }] }), undefined);
  const clean = g.normalizeGrading({ ...grading(), items: [...grading().items, { id: "bad", categoryId: "nope", title: "x", maxScore: 1 }] });
  assert.equal(clean.items.length, 5);
  const view = g.gradingForAssistant({ ...grading(), target: 90 });
  assert.equal(view.letter, "B");
  assert.equal(view.items.find((i) => i.id === "fx").upcoming, true);
  assert.equal(g.findCategory(grading(), "exam").id, "ex");
  assert.equal(g.findCategory(grading(), "homeworks").id, "hw");
});

test("applying new categories keeps grades of categories that still exist", () => {
  let n = 0;
  const next = g.applyCategories(grading(), [{ name: "exams", weight: 60 }, { name: "Quizzes", weight: 40 }], () => `new-${n++}`);
  assert.equal(next.categories[0].id, "ex");
  assert.equal(next.categories[1].id, "new-0");
  assert.deepEqual(next.items.map((i) => i.id), ["m1", "fx"]);
});

const brain = () => ({ userId: "t", tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], sections: ["Academic"], subsections: { Academic: ["General"] },
  chatHistory: [], openRouterKey: "", selectedModel: "m", theme: "light",
  study: { courses: [{ id: "c1", workspaceId: "w", code: "CS 1332", name: "Data Structures", createdAt: "x", updatedAt: "x" }], folders: [], documents: [], decks: [], quizzes: [] } });

test("Iris can set up grading, record scores and read the computed grade", () => {
  let state = brain();
  assert.throws(() => tools.prepareMutation("record_grade", { courseId: "c1", category: "Exams", title: "Midterm", score: 80 }, state), /no grading set up/);
  const setup = tools.prepareMutation("set_course_grading", { courseId: "c1", categories: [{ name: "Exams", weight: 50 }, { name: "Homework", weight: 30, count: 4, dropLowest: 1 }, { name: "Projects", weight: 20 }], target: 90 }, state);
  tools.validate({ courseId: "c1", categories: [{ name: "Exams", weight: 50 }] }, tools.BRAIN_TOOLS.find((t) => t.function.name === "set_course_grading").function.parameters);
  state = tools.applyMutation(state, setup);
  assert.equal(state.study.courses[0].grading.categories.length, 3);

  state = tools.applyMutation(state, tools.prepareMutation("record_grade", { courseId: "c1", category: "exam", title: "Final", maxScore: 100, date: "2026-12-10" }, state));
  state = tools.applyMutation(state, tools.prepareMutation("record_grade", { courseId: "c1", category: "Exams", title: "Midterm", score: 80 }, state));
  state = tools.applyMutation(state, tools.prepareMutation("record_grade", { courseId: "c1", category: "homeworks", title: "HW 1", score: 9, maxScore: 10 }, state));
  // Reporting the final's score fills the upcoming item instead of duplicating it.
  const final = state.study.courses[0].grading.items.find((i) => i.title === "Final");
  const filled = tools.prepareMutation("record_grade", { courseId: "c1", category: "Exams", title: "final", score: 95 }, state);
  assert.equal(filled.record.grading.items.filter((i) => i.categoryId === final.categoryId).length, 2);
  assert.equal(filled.record.grading.items.find((i) => i.id === final.id).score, 95);
  assert.throws(() => tools.prepareMutation("record_grade", { courseId: "c1", category: "Labs", title: "Lab 1", score: 5 }, state), /Exams, Homework, Projects/);
  assert.throws(() => tools.prepareMutation("set_course_grading", { courseId: "c1", categories: [{ name: "Quizzes", weight: 100 }] }, state), /would be removed: Exams, Homework/);

  const course = records(state, "course")[0];
  assert.equal(course.data.grading.letter, "B");
  assert.equal(course.data.grading.target, 90);
  assert.ok(course.data.grading.items.find((i) => i.title === "Final").neededForTarget > 0);
  assert.equal(state.study.courses[0].code, "CS 1332");
});

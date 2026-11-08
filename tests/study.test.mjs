import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
const server = await createServer({
  configFile: false,
  cacheDir: "/private/tmp/synapse-study-test-cache",
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});
after(() => server.close());
const study = await server.ssrLoadModule("/src/utils/study.ts");
const { officeXmlText, kindOf } = await server.ssrLoadModule("/src/services/studyExtract.ts");
const { selectSource } = await server.ssrLoadModule("/src/services/studyAI.ts");
const { records, searchRecords } = await server.ssrLoadModule("/src/services/brainRetrieval.ts");
const { saveDocumentText } = await server.ssrLoadModule("/src/services/studyDocuments.ts");
const tools = await server.ssrLoadModule("/src/services/brainTools.ts");
const { removeWorkspace } = await server.ssrLoadModule("/src/utils/workspaces.ts");
const { lifeSnapshot } = await server.ssrLoadModule("/src/services/agentDispatcher.ts");

const now = "2026-11-05T12:00:00.000Z";
const course = { id: "c1", workspaceId: "w1", code: "CS 1332", name: "Data Structures", createdAt: now, updatedAt: now };
const doc = { id: "d1", courseId: "c1", folderId: "f1", name: "Lecture 4 - AVL Trees.pdf", kind: "pdf", size: 1000, pages: 2, chars: 60, hash: "h", createdAt: now };
const base = () => ({
  userId: "u1", tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], trackerItems: [], events: [], chatHistory: [],
  sections: ["Academic"], subsections: { Academic: ["General"] }, openRouterKey: "", selectedModel: "", theme: "light",
  workspaces: [{ id: "w1", name: "School", description: "", template: "academic", color: "blue", notes: "", createdAt: now }],
  study: {
    courses: [course],
    folders: [{ id: "f1", courseId: "c1", parentId: null, name: "Lectures", createdAt: now }, { id: "f2", courseId: "c1", parentId: "f1", name: "Week 1", createdAt: now }],
    documents: [doc],
    decks: [{ id: "k1", courseId: "c1", title: "AVL", sourceDocIds: ["d1"], createdAt: now, updatedAt: now,
      cards: [study.newCard("What is a rotation?", "A local restructuring", "d1", "2026-01-01")] }],
    quizzes: [],
  },
});

test("normalizeStudy drops orphans and malformed questions, keeps valid data", () => {
  const out = study.normalizeStudy({
    courses: [course, { id: "bad" }],
    folders: [{ id: "f9", courseId: "missing", name: "x" }, { id: "f1", courseId: "c1", parentId: "gone", name: "Lectures" }],
    documents: [{ ...doc, folderId: "nope", kind: "exe" }],
    decks: [{ id: "k", courseId: "c1", cards: [{ id: "x", front: "", back: "b" }, { id: "y", front: "f", back: "b", ease: 9 }] }],
    quizzes: [{ id: "q", courseId: "c1", questions: [
      { type: "mcq", prompt: "p", choices: ["a", "b"], answerIndex: 5 },
      { type: "mcq", prompt: "p2", choices: ["a", "b"], answer: "b" },
      { type: "short", prompt: "s", answer: "ans" },
    ] }],
  });
  assert.equal(out.courses.length, 1);
  assert.deepEqual(out.folders.map((f) => [f.id, f.parentId]), [["f1", null]]);
  assert.equal(out.documents[0].folderId, null);
  assert.equal(out.documents[0].kind, "text");
  assert.equal(out.decks[0].cards.length, 1);
  assert.equal(out.decks[0].cards[0].ease, 3);
  assert.deepEqual(out.quizzes[0].questions.map((q) => [q.type, q.answerIndex ?? q.answer]), [["mcq", 1], ["short", "ans"]]);
  assert.deepEqual(study.normalizeStudy(undefined), study.emptyStudy());
});

test("spaced repetition grows intervals and resets on again", () => {
  const day = new Date("2026-11-05T12:00:00");
  let card = study.newCard("f", "b", undefined, "2026-11-05");
  card = study.reviewCard(card, "good", day);
  assert.equal(card.interval, 2);
  assert.equal(card.due, "2026-11-07");
  card = study.reviewCard(card, "good", day);
  assert.equal(card.interval, 5);
  card = study.reviewCard(card, "easy", day);
  assert.ok(card.interval > 10);
  const lapsed = study.reviewCard(card, "again", day);
  assert.equal(lapsed.interval, 1);
  assert.equal(lapsed.reps, 0);
  assert.equal(lapsed.lapses, 1);
  assert.ok(lapsed.ease < card.ease);
});

test("folder removal keeps documents; course and workspace removal cascade", () => {
  const s = base().study;
  const afterFolder = { ...s, ...study.removeFolder(s, "f1") };
  assert.equal(afterFolder.folders.length, 0);
  assert.equal(afterFolder.documents[0].folderId, null);
  const { study: gone, documentIds } = study.removeCourse(s, "c1");
  assert.deepEqual(documentIds, ["d1"]);
  assert.equal(gone.decks.length + gone.documents.length + gone.folders.length, 0);
  const state = removeWorkspace(base(), "w1");
  assert.equal(state.study.courses.length, 0);
});

test("courses become Academic task subsections", () => {
  const state = study.linkCourseToTasks(base(), course);
  assert.deepEqual(state.subsections.Academic, ["General", "CS 1332"]);
  assert.equal(study.linkCourseToTasks(state, course), state);
});

test("a course's tasks are the Academic subsection's tasks, however it is spelled", () => {
  const task = { id: "t1", title: "HW 1", section: "Academic", subsection: "cs1332", status: "not_started" };
  const state = { ...base(), subsections: { Academic: ["General", "cs1332"] }, tasks: [task, { ...task, id: "t2", section: "Career" }] };
  assert.deepEqual(study.courseTasks(state, course), [task]);
  assert.equal(study.courseSubsection(state, course), "cs1332");
  assert.equal(study.linkCourseToTasks(state, course), state, "does not add a duplicate subsection");
});

test("linking a course restores a missing Academic section", () => {
  const state = study.linkCourseToTasks({ ...base(), sections: ["Career"], subsections: { Career: ["General"] } }, course);
  assert.deepEqual(state.sections, ["Career", "Academic"]);
  assert.deepEqual(state.subsections.Academic, ["General", "CS 1332"]);
});

test("renaming a course or its subsection keeps the two linked", () => {
  const task = { id: "t1", title: "HW 1", section: "Academic", subsection: "CS 1332", status: "not_started" };
  const linked = { ...base(), subsections: { Academic: ["General", "CS 1332"] }, tasks: [task] };
  const recoded = { ...course, code: "CS 2340" };
  const moved = study.linkCourseToTasks(linked, recoded, course);
  assert.deepEqual(moved.subsections.Academic, ["General", "CS 2340"]);
  assert.equal(moved.tasks[0].subsection, "CS 2340");

  const m = tools.prepareMutation("rename_subsection", { section: "Academic", subsection: "CS 1332", newName: "CS 1331" }, linked);
  const renamed = tools.applyMutation(linked, m);
  assert.equal(renamed.study.courses[0].code, "CS 1331");
  assert.deepEqual(study.courseTasks(renamed, renamed.study.courses[0]).map((t) => t.id), ["t1"]);
});

test("office XML extraction keeps paragraphs, headings and entities", () => {
  const docx = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Trees</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">AVL &amp; </w:t></w:r><w:r><w:t>BST</w:t></w:r></w:p>';
  assert.deepEqual(officeXmlText(docx, "w:p", "w:t"), ["## Trees", "AVL & BST"]);
  assert.deepEqual(officeXmlText("<a:p><a:r><a:t>Slide title</a:t></a:r></a:p><a:p></a:p>", "a:p", "a:t"), ["Slide title"]);
  assert.equal(kindOf({ name: "x.PPTX", type: "" }), "pptx");
  assert.equal(kindOf({ name: "x.exe", type: "" }), null);
});

test("source selection fits the budget and prefers the focus", () => {
  const filler = (word) => `## Page\n\n${(word + " ").repeat(600)}`;
  const text = [filler("heaps"), filler("graphs"), filler("rotations"), filler("hashing")].join("\n");
  const picked = selectSource([{ doc, text }], "rotations", 4000);
  assert.ok(picked.length <= 4000 + 200);
  assert.match(picked, /rotations/);
  assert.match(picked, /\[Doc 1: Lecture 4/);
});

test("assistant records include course material with document text", async () => {
  await saveDocumentText("u1", "d1", "h", "## Page 1\n\nAn AVL tree rebalances using rotations.");
  const state = base();
  const all = records(state);
  const document = all.find((r) => r.type === "document");
  assert.match(document.index, /rebalances using rotations/);
  assert.match(document.text, /An AVL tree/);
  assert.equal(document.data.section, "CS 1332");
  assert.match(all.find((r) => r.type === "course").index, /Lecture 4 - AVL Trees.pdf/);
  assert.match(all.find((r) => r.type === "deck").index, /Q: What is a rotation\?/);
  const found = await searchRecords(state, "rotations", "document", 0, "");
  assert.equal(found.results[0].id, "d1");
  const query = await tools.executeRead("query_records", { type: "deck", section: "CS 1332" }, state, "");
  assert.equal(query.output.records[0].cardsDue, 1);
  assert.match(lifeSnapshot(state), /CS 1332 · Data Structures — 1 documents, 1 decks \(1 cards due today\)/);
});

test("study mutations validate, store in study state, and create a workspace when needed", () => {
  const state = { ...base(), workspaces: [], study: { ...base().study, courses: [] , documents: [], decks: [] } };
  const created = tools.prepareMutation("create_course", { name: "Linear Algebra", code: "MATH 1554" }, state);
  assert.equal(created.record.workspaceId, tools.ACADEMIC_WORKSPACE_ID);
  const next = tools.applyMutation(state, created);
  assert.equal(next.study.courses.length, 1);
  assert.equal(next.workspaces[0].template, "academic");
  assert.ok(next.subsections.Academic.includes("MATH 1554"));
  assert.throws(() => tools.prepareMutation("create_course", { name: "linear algebra" }, next), /already exists/);

  const full = base();
  const deck = tools.prepareMutation("create_flashcard_deck", { courseId: "c1", title: "Rotations", cards: [{ front: "LL case?", back: "Right rotation", sourceDocumentId: "d1" }] }, full);
  assert.equal(deck.record.cards[0].sourceDocId, "d1");
  assert.throws(() => tools.prepareMutation("create_flashcard_deck", { courseId: "c1", title: "x", cards: [{ front: "a", back: "b", sourceDocumentId: "zzz" }] }, full), /Unknown document/);
  const appended = tools.prepareMutation("create_flashcard_deck", { deckId: "k1", cards: [{ front: "a", back: "b" }] }, full);
  assert.equal(appended.record.cards.length, 2);
  assert.equal(tools.mutationRecords(full, "deck")[0].id, "k1");

  const quiz = tools.prepareMutation("create_quiz", { courseId: "c1", title: "Q", questions: [
    { type: "mcq", prompt: "Height bound?", choices: ["O(1)", "O(log n)", "O(n)", "O(n^2)"], answerIndex: 1 },
    { type: "short", prompt: "Why rotate?", answer: "To restore balance" },
  ] }, full);
  assert.equal(quiz.record.questions[0].answer, "O(log n)");
  assert.throws(() => tools.prepareMutation("create_quiz", { courseId: "c1", title: "Q", questions: [{ type: "mcq", prompt: "p", choices: ["a", "b"], answerIndex: 4 }] }, full), /invalid/);
  const withQuiz = tools.applyMutation(full, quiz);
  assert.equal(withQuiz.study.quizzes.length, 1);
  assert.ok(tools.BRAIN_TOOLS.some((t) => t.function.name === "create_quiz"));
});

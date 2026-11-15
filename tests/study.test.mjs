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
const { officeXmlText, kindOf, slideImageTargets, repeatedImages, pageNeedsVision, looksLikeLogistics, LOGISTICS_TAG } = await server.ssrLoadModule("/src/services/studyExtract.ts");
const { selectSource, applyReviews, balanceAnswers, uniqueQuestions, copiesMaterial, shingles } = await server.ssrLoadModule("/src/services/studyAI.ts");
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

test("quiz generation runs in the background, reports real progress and saves into the right account", async () => {
  const jobsApi = await server.ssrLoadModule("/src/services/studyJobs.ts");
  await saveDocumentText("u1", "d1", "h", "AVL trees rebalance with rotations after inserts.").catch(() => {});
  const questions = Array.from({ length: 3 }, (_, i) => ({ type: "mcq", prompt: `Q${i}?`, choices: ["a", "b", "c", "d"], answerIndex: 1, explanation: `Because ${i}.`, doc: 1 }));
  const json = JSON.stringify({ questions });
  // The provider streams the JSON in small pieces, so progress can be counted as questions are finished.
  let release;
  const gate = new Promise((r) => { release = r; });
  // Before writing, the model plans the skills; after, a second model checks each question (here dropping the second).
  const reviewed = [];
  const planned = [];
  let releaseReview;
  const reviewGate = new Promise((r) => { releaseReview = r; });
  const reply = (content) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { headers: { "content-type": "application/json" } });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.stream) return streamed();
    if (/designing an exam/.test(body.messages[0].content)) { planned.push(body); return reply({ skills: [{ skill: "Choose the rotation that rebalances an AVL tree", scenarios: ["a new insert sequence"], visual: "diagram", doc: 1 }] }); }
    reviewed.push(body);
    await reviewGate;
    return reply({ reviews: [{ n: 1, verdict: "keep" }, { n: 2, verdict: "drop" }, { n: 3, verdict: "keep" }] });
  };
  let written = 0;
  const streamed = () => (written++, new Response(new ReadableStream({ async start(c) {
    const enc = new TextEncoder();
    const pieces = json.match(/.{1,40}/g);
    for (const [i, piece] of pieces.entries()) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`));
      if (i === Math.floor(pieces.length / 2)) await gate;
    }
    c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`));
    c.close();
  } }), { headers: { "content-type": "text/event-stream" } }));
  let state = base();
  const onChange = (update) => { state = update(state); };
  const id = jobsApi.startStudyJob({ kind: "quiz", userId: "u1", course, docs: [doc], title: "AVL practice", count: 3,
    options: { difficulty: "exam", format: "mcq" }, apiKey: "k", model: "m", onChange });
  const job = () => jobsApi.studyJobs().find((j) => j.id === id);
  assert.equal(job().status, "reading", "the dialog can close right away: the job is already listed");
  for (let i = 0; i < 50 && !(job().status === "writing" && job().written > 0); i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(job().status, "writing");
  assert.ok(job().written >= 1 && job().written < 3, `partial progress, got ${job().written}`);
  release();
  for (let i = 0; i < 50 && job().status !== "checking"; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(job().status, "checking", "answers are checked before the quiz is saved");
  assert.match(reviewed[0].messages.at(-1).content, /AVL trees rebalance/, "the checker sees the material");
  assert.equal(planned.length, 1, "skills are planned before writing");
  releaseReview();
  for (let i = 0; i < 50 && job().status !== "done"; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(job().status, "done");
  assert.equal(job().written, 2);
  const quiz = state.study.quizzes.find((q) => q.id === job().resultId);
  assert.equal(quiz.title, "AVL practice");
  assert.deepEqual(quiz.questions.map((q) => q.prompt), ["Q0?", "Q2?"]);
  jobsApi.dismissStudyJob(id);
  assert.equal(jobsApi.studyJobs().length, 0);

  // A failure stays listed with its reason and can be retried; a result never lands in another account.
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Rate limited" } }), { status: 429 });
  let other = { ...base(), userId: "someone-else" };
  const failed = jobsApi.startStudyJob({ kind: "quiz", userId: "u1", course, docs: [doc], title: "Again", count: 3,
    options: { format: "mcq" }, apiKey: "k", model: "m", onChange: (update) => { other = update(other); } });
  const failedJob = () => jobsApi.studyJobs().find((j) => j.id === failed);
  for (let i = 0; i < 50 && failedJob().status !== "error"; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(failedJob().status, "error");
  assert.match(failedJob().error, /Rate limited|429/);
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: json }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
  jobsApi.retryStudyJob(failed);
  for (let i = 0; i < 50 && failedJob().status !== "done"; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(failedJob().status, "done", "retry works, also without a streaming provider");
  assert.equal(other.study.quizzes.length, 0, "the other account's state is untouched");
  jobsApi.dismissStudyJob(failed);

  // Cancelling removes the job and saves nothing.
  globalThis.fetch = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  const before = state.study.quizzes.length;
  const cancelled = jobsApi.startStudyJob({ kind: "flashcards", userId: "u1", course, docs: [doc], title: "Cards", count: 10,
    options: { format: "mixed" }, apiKey: "k", model: "m", onChange });
  await new Promise((r) => setTimeout(r, 20));
  jobsApi.cancelStudyJob(cancelled);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(jobsApi.studyJobs().length, 0);
  assert.equal(state.study.quizzes.length, before);
  assert.equal(state.study.decks.length, base().study.decks?.length ?? 0);
});

// Lab 19 style deck: announcement slides as text, the actual problems as screenshots.
test("slide images: per-slide targets, and template art on many slides is ignored", () => {
  const rels = `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout2.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image10.png"/>
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/x.png" TargetMode="External"/></Relationships>`;
  assert.deepEqual(slideImageTargets(rels), ["ppt/media/image10.png"]);
  const decorative = repeatedImages([["ppt/media/image4.png"], ["ppt/media/image4.png"], ["ppt/media/image4.png", "ppt/media/image5.png"], ["ppt/media/image10.png"]]);
  assert.deepEqual([...decorative], ["ppt/media/image4.png"]);
});

test("PDF pages with screenshots, drawings or handwriting go to the vision model", () => {
  assert.equal(pageNeedsVision({ textChars: 2400, largeImages: 0, paths: 3 }), false, "a page of plain text");
  assert.equal(pageNeedsVision({ textChars: 2400, largeImages: 1, paths: 0 }), true, "a screenshot of code");
  assert.equal(pageNeedsVision({ textChars: 900, largeImages: 0, paths: 400 }), true, "GoodNotes ink strokes");
  assert.equal(pageNeedsVision({ textChars: 40, largeImages: 0, paths: 0 }), true, "almost no text");
});

const logisticsSlide = "## Slide 4\n\nProject 4\n\nDue Sunday, November 15th\n\nAssignment located on Canvas, submit on Gradescope\n\nCome to office hours in CCB 208A or post on Piazza";
const contentSlide = "## Slide 12\n\nPreprocessor Directives\n\n### What the slide shows\n\n```c\n#define VERBOSE 0\n#if VERBOSE\nprintf(\"Debug\");\n#else\nprintf(\"Hello world!\");\n#endif\n```";

test("course logistics are recognized and kept out of quiz material", () => {
  assert.equal(looksLikeLogistics(logisticsSlide), true);
  assert.equal(looksLikeLogistics(contentSlide), false);
  // An older document (text layer only, no labels) relies on the wording.
  const old = { ...doc, name: "Lab 19 Slides.pptx", kind: "pptx" };
  const picked = selectSource([{ doc: old, text: `${logisticsSlide}\n${contentSlide}` }]);
  assert.match(picked, /VERBOSE/);
  assert.doesNotMatch(picked, /Gradescope/);
  // A newly read document trusts its labels.
  const fresh = { ...old, extraction: 2 };
  const labeled = `## Slide 3 ${LOGISTICS_TAG}\n\nQuiz 3: how was it?\n${contentSlide}`;
  assert.doesNotMatch(selectSource([{ doc: fresh, text: labeled }]), /Quiz 3/);
  // Asking about deadlines, or a document that is only logistics, still works.
  assert.match(selectSource([{ doc: old, text: `${logisticsSlide}\n${contentSlide}` }], "when is project 4 due"), /Gradescope/);
  assert.match(selectSource([{ doc: old, text: logisticsSlide }]), /Gradescope/);
});

const mcq = (prompt, answerIndex = 0, extra = {}) => ({ id: prompt, type: "mcq", prompt, choices: ["a", "b", "c", "d"], answerIndex, answer: ["a", "b", "c", "d"][answerIndex], ...extra });

test("the review drops bad questions and corrects wrong answer keys", () => {
  const qs = [mcq("When is Project 4 due?"), mcq("What does it print?", 0, { exhibit: "```c\nprintf(\"%d\", 2110);\n```" }), { id: "s", type: "short", prompt: "Why a TRAP?", answer: "x", explanation: "old" }, mcq("Untouched")];
  const out = applyReviews(qs, [{ n: 1, verdict: "drop" }, { n: 2, verdict: "fix", answerIndex: 3, explanation: "It prints 2110." }, { n: 3, verdict: "fix", answer: "To request an OS service" }]);
  assert.deepEqual(out.map((q) => q.prompt), ["What does it print?", "Why a TRAP?", "Untouched"]);
  assert.equal(out[0].answerIndex, 3); assert.equal(out[0].answer, "d"); assert.equal(out[0].explanation, "It prints 2110.");
  assert.equal(out[1].answer, "To request an OS service");
  assert.equal(applyReviews([mcq("x")], [{ n: 1, verdict: "fix", answerIndex: 9 }]).length, 0, "a fix pointing nowhere drops the question");
});

test("correct answers are spread across positions and repeats removed", () => {
  const qs = Array.from({ length: 8 }, (_, i) => mcq(`Q${i}`, 0));
  const balanced = balanceAnswers(qs, () => 0);
  assert.deepEqual(balanced.map((q) => q.answerIndex), [0, 1, 2, 3, 0, 1, 2, 3]);
  for (const q of balanced) assert.equal(q.choices[q.answerIndex], "a", "the correct choice moved with its index");
  const ordered = { ...mcq("Order", 0), choices: ["x", "y", "Both of the above", "z"] };
  assert.equal(balanceAnswers([ordered], () => 0.6)[0].answerIndex, 0, "choices that refer to each other keep their order");
  assert.equal(uniqueQuestions([mcq("Same  prompt"), mcq("same prompt"), mcq("Other")]).length, 2);
});

test("questions keep their exhibit, and the assistant can add one", () => {
  const q = study.normalizeQuestion({ type: "short", prompt: "What does this print?", exhibit: "```c\nprintf(\"I love CS %d!\\n\", 2110);\n```", answer: "I love CS 2110!" });
  assert.match(q.exhibit, /printf/);
  const kept = study.normalizeStudy({ ...base().study, documents: [{ ...doc, extraction: 2, visualPages: 18 }] }).documents[0];
  assert.equal(kept.extraction, 2); assert.equal(kept.visualPages, 18);
  const m = tools.prepareMutation("create_quiz", { courseId: "c1", title: "C preprocessor", questions: [{ type: "mcq", prompt: "What does it print?", exhibit: "```c\n#if 0\n```", choices: ["A", "B", "C", "D"], answerIndex: 1 }] }, base());
  assert.match(m.record.questions[0].exhibit, /#if 0/);
});

test("questions that reuse the material's own problems are caught; new scenarios are not", () => {
  const material = shingles(contentSlide + "\n" + logisticsSlide);
  const copied = { id: "1", type: "short", prompt: "What does this print?", answer: "Hello world!", exhibit: "```c\n#define VERBOSE 0\n#if VERBOSE\nprintf(\"Debug\");\n#else\nprintf(\"Hello world!\");\n#endif\n```" };
  const renamed = { ...copied, exhibit: "```c\n#define VERBOSE 0\n#if VERBOSE\nprintf(\"Debug\");\n#else\nprintf(\"Hi there!\");\n#endif\n```" };
  const fresh = { ...copied, exhibit: "```c\n#define LEVEL 2\n#if LEVEL > 1 && defined(TRACE)\nputs(\"trace\");\n#elif LEVEL\nputs(\"level\");\n#endif\n```" };
  assert.equal(copiesMaterial(copied, material), true);
  assert.equal(copiesMaterial(renamed, material), true, "changing one string is still a copy");
  assert.equal(copiesMaterial(fresh, material), false);
  assert.equal(copiesMaterial({ id: "2", type: "short", prompt: "What does this print?", answer: "x" }, material), false, "short generic prompts don't count");
});

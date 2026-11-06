import type {
  BrainState,
  Course,
  Flashcard,
  FlashcardDeck,
  Quiz,
  QuizQuestion,
  StudyDocument,
  StudyDocumentKind,
  StudyFolder,
  StudyState,
} from "../types";
import { getLocalDateString } from "./habitStreaks";

export const emptyStudy = (): StudyState => ({ courses: [], folders: [], documents: [], decks: [], quizzes: [] });
export const studyOf = (state: Pick<BrainState, "study">): StudyState => state.study || emptyStudy();
export const ACADEMIC_SECTION = "Academic";

const str = (value: unknown, max = 2000) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const num = (value: unknown, fallback: number) => (Number.isFinite(value) ? Number(value) : fallback);
const DOC_KINDS: StudyDocumentKind[] = ["pdf", "docx", "pptx", "text", "image"];

/** Drops records that are malformed or orphaned, so a bad sync can never break the UI or the assistant. */
export function normalizeStudy(value: unknown): StudyState {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const list = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as Record<string, any>[]) : []).filter(
    (item) => item && typeof item === "object" && typeof item.id === "string" && item.id,
  );
  const unique = <T extends { id: string }>(items: T[]) => {
    const seen = new Set<string>();
    return items.filter((item) => !seen.has(item.id) && !!seen.add(item.id));
  };
  const now = new Date().toISOString();
  const courses: Course[] = unique(list("courses").filter((c) => typeof c.workspaceId === "string").map((c) => ({
    id: c.id, workspaceId: c.workspaceId, code: str(c.code, 40), name: str(c.name, 120) || "Untitled course",
    ...(str(c.term, 60) ? { term: str(c.term, 60) } : {}), ...(str(c.instructor, 80) ? { instructor: str(c.instructor, 80) } : {}),
    createdAt: str(c.createdAt) || now, updatedAt: str(c.updatedAt) || now,
  })));
  const courseIds = new Set(courses.map((c) => c.id));
  const folders: StudyFolder[] = unique(list("folders").filter((f) => courseIds.has(f.courseId)).map((f) => ({
    id: f.id, courseId: f.courseId, parentId: typeof f.parentId === "string" ? f.parentId : null,
    name: str(f.name, 80) || "Untitled folder", createdAt: str(f.createdAt) || now,
  })));
  const folderIds = new Set(folders.map((f) => f.id));
  for (const folder of folders) if (folder.parentId && !folderIds.has(folder.parentId)) folder.parentId = null;
  const documents: StudyDocument[] = unique(list("documents").filter((d) => courseIds.has(d.courseId)).map((d) => ({
    id: d.id, courseId: d.courseId, folderId: typeof d.folderId === "string" && folderIds.has(d.folderId) ? d.folderId : null,
    name: str(d.name, 200) || "Untitled document", kind: DOC_KINDS.includes(d.kind) ? d.kind : "text",
    size: num(d.size, 0), ...(Number.isFinite(d.pages) ? { pages: d.pages } : {}), chars: num(d.chars, 0), hash: str(d.hash, 128),
    ...(str(d.summary) ? { summary: str(d.summary) } : {}), createdAt: str(d.createdAt) || now,
  })));
  const today = getLocalDateString();
  const decks: FlashcardDeck[] = unique(list("decks").filter((d) => courseIds.has(d.courseId)).map((d) => ({
    id: d.id, courseId: d.courseId, title: str(d.title, 120) || "Flashcards",
    sourceDocIds: Array.isArray(d.sourceDocIds) ? d.sourceDocIds.filter((x: unknown) => typeof x === "string") : [],
    cards: unique((Array.isArray(d.cards) ? d.cards : []).filter((c: any) => c && typeof c.id === "string" && str(c.front) && str(c.back)).map((c: any) => ({
      id: c.id, front: str(c.front), back: str(c.back), ...(typeof c.sourceDocId === "string" ? { sourceDocId: c.sourceDocId } : {}),
      due: /^\d{4}-\d{2}-\d{2}$/.test(c.due) ? c.due : today, interval: Math.max(0, num(c.interval, 0)),
      ease: Math.min(3, Math.max(1.3, num(c.ease, 2.5))), reps: Math.max(0, num(c.reps, 0)), lapses: Math.max(0, num(c.lapses, 0)),
    }))),
    createdAt: str(d.createdAt) || now, updatedAt: str(d.updatedAt) || now,
  })));
  const quizzes: Quiz[] = unique(list("quizzes").filter((q) => courseIds.has(q.courseId)).map((q) => ({
    id: q.id, courseId: q.courseId, title: str(q.title, 120) || "Practice quiz",
    sourceDocIds: Array.isArray(q.sourceDocIds) ? q.sourceDocIds.filter((x: unknown) => typeof x === "string") : [],
    questions: (Array.isArray(q.questions) ? q.questions : []).map(normalizeQuestion).filter((x: QuizQuestion | null): x is QuizQuestion => !!x),
    attempts: (Array.isArray(q.attempts) ? q.attempts : []).filter((a: any) => a && typeof a.id === "string").map((a: any) => ({
      id: a.id, at: str(a.at) || now, score: num(a.score, 0), total: num(a.total, 0),
      missed: Array.isArray(a.missed) ? a.missed.filter((x: unknown) => typeof x === "string") : [],
    })).slice(-20),
    createdAt: str(q.createdAt) || now,
  })));
  return { courses, folders, documents, decks, quizzes };
}

export function normalizeQuestion(q: any): QuizQuestion | null {
  if (!q || typeof q !== "object" || !str(q.prompt)) return null;
  const id = typeof q.id === "string" && q.id ? q.id : crypto.randomUUID();
  const base = { id, prompt: str(q.prompt), ...(str(q.explanation) ? { explanation: str(q.explanation) } : {}),
    ...(typeof q.sourceDocId === "string" ? { sourceDocId: q.sourceDocId } : {}) };
  const choices = Array.isArray(q.choices) ? q.choices.map((c: unknown) => str(c, 500)).filter(Boolean).slice(0, 6) : [];
  if (q.type !== "short" && choices.length >= 2) {
    const index = Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < choices.length
      ? q.answerIndex : choices.findIndex((c: string) => c === str(q.answer, 500));
    if (index < 0) return null;
    return { ...base, type: "mcq", choices, answerIndex: index, answer: choices[index] };
  }
  return str(q.answer) ? { ...base, type: "short", answer: str(q.answer) } : null;
}

export function newCard(front: string, back: string, sourceDocId?: string, today = getLocalDateString()): Flashcard {
  return { id: crypto.randomUUID(), front: front.trim(), back: back.trim(), ...(sourceDocId ? { sourceDocId } : {}),
    due: today, interval: 0, ease: 2.5, reps: 0, lapses: 0 };
}

export type Grade = "again" | "hard" | "good" | "easy";
function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return getLocalDateString(next);
}
/** SM-2 variant: "again" resets the card to tomorrow; later intervals grow with the card's ease. */
export function reviewCard(card: Flashcard, grade: Grade, now = new Date()): Flashcard {
  if (grade === "again") return { ...card, reps: 0, lapses: card.lapses + 1, interval: 1, ease: Math.max(1.3, card.ease - 0.2), due: addDays(now, 1) };
  const ease = Math.min(3, Math.max(1.3, card.ease + (grade === "hard" ? -0.15 : grade === "easy" ? 0.15 : 0)));
  const interval = card.reps === 0 ? (grade === "easy" ? 4 : grade === "hard" ? 1 : 2)
    : card.reps === 1 ? (grade === "easy" ? 7 : grade === "hard" ? 3 : 5)
    : Math.max(card.interval + 1, Math.round(card.interval * (grade === "hard" ? 1.2 : grade === "easy" ? ease * 1.3 : ease)));
  return { ...card, reps: card.reps + 1, interval, ease, due: addDays(now, interval) };
}
export const dueCards = (deck: FlashcardDeck, today = getLocalDateString()) => deck.cards.filter((c) => c.due <= today);

export function courseLabel(course: Course) {
  return course.code ? `${course.code} · ${course.name}` : course.name;
}

/** Updates the study collections immutably. */
export function withStudy(state: BrainState, change: (study: StudyState) => Partial<StudyState>): BrainState {
  const study = studyOf(state);
  return { ...state, study: { ...study, ...change(study) } };
}
export function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some((x) => x.id === item.id) ? items.map((x) => (x.id === item.id ? item : x)) : [...items, item];
}

/** Every folder ID beneath (and including) the given folder. */
export function folderSubtree(folders: StudyFolder[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
  }
  return ids;
}
/** Removes a folder and its subfolders. Documents inside move up to the course root rather than being lost. */
export function removeFolder(study: StudyState, folderId: string): Partial<StudyState> {
  const ids = folderSubtree(study.folders, folderId);
  return { folders: study.folders.filter((f) => !ids.has(f.id)),
    documents: study.documents.map((d) => (d.folderId && ids.has(d.folderId) ? { ...d, folderId: null } : d)) };
}
/** Removes a course with everything inside it. Returns the document IDs whose stored text should be deleted. */
export function removeCourse(study: StudyState, courseId: string): { study: StudyState; documentIds: string[] } {
  return {
    documentIds: study.documents.filter((d) => d.courseId === courseId).map((d) => d.id),
    study: {
      courses: study.courses.filter((c) => c.id !== courseId),
      folders: study.folders.filter((f) => f.courseId !== courseId),
      documents: study.documents.filter((d) => d.courseId !== courseId),
      decks: study.decks.filter((d) => d.courseId !== courseId),
      quizzes: study.quizzes.filter((q) => q.courseId !== courseId),
    },
  };
}
/** Courses belong to a workspace; deleting the workspace removes them too. */
export function removeWorkspaceCourses(study: StudyState, workspaceId: string): { study: StudyState; documentIds: string[] } {
  let next = study;
  const documentIds: string[] = [];
  for (const course of study.courses.filter((c) => c.workspaceId === workspaceId)) {
    const result = removeCourse(next, course.id);
    next = result.study;
    documentIds.push(...result.documentIds);
  }
  return { study: next, documentIds };
}

/** Courses double as task subsections under Academic, so assignments and materials line up. */
export function linkCourseToTasks(state: BrainState, course: Course): BrainState {
  const label = course.code || course.name;
  if (!state.sections.includes(ACADEMIC_SECTION)) return state;
  const existing = state.subsections[ACADEMIC_SECTION] || [];
  if (existing.some((s) => s.toLocaleLowerCase() === label.toLocaleLowerCase())) return state;
  return { ...state, subsections: { ...state.subsections, [ACADEMIC_SECTION]: [...existing, label] } };
}
export function courseTasks(state: BrainState, course: Course) {
  const label = (course.code || course.name).toLocaleLowerCase();
  return state.tasks.filter((t) => t.section === ACADEMIC_SECTION && t.subsection?.toLocaleLowerCase() === label);
}

export function bestScore(quiz: Quiz) {
  return quiz.attempts.reduce<number | null>((best, a) => {
    const pct = a.total ? Math.round((a.score / a.total) * 100) : 0;
    return best === null || pct > best ? pct : best;
  }, null);
}

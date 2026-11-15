import { useSyncExternalStore } from "react";
import type { BrainState, Course, FlashcardDeck, Quiz, StudyDocument } from "../types";
import { withStudy } from "../utils/study";
import { loadDocumentText } from "./studyDocuments";
import { generateFlashcards, generateQuiz, type SourceDoc, type StudyOptions } from "./studyAI";

/**
 * Quiz and flashcard generation runs here, outside any component, so the dialog can close at once and the user can
 * keep working (or leave the course) while it runs. Progress is shown wherever the workspace lists study items.
 */
export type StudyJobKind = "quiz" | "flashcards";
export type StudyJobStatus = "reading" | "writing" | "checking" | "saving" | "done" | "error";
export interface StudyJob {
  id: string;
  kind: StudyJobKind;
  userId: string;
  courseId: string;
  title: string;
  count: number;
  status: StudyJobStatus;
  /** Items the model has finished writing so far; 0 when the provider doesn't stream. */
  written: number;
  startedAt: number;
  error?: string;
  /** The saved deck or quiz, once done. */
  resultId?: string;
  /** True while the job's own row is on screen, so a separate notice about it would only repeat it. */
  onScreen?: boolean;
}

export interface StudyJobInput {
  kind: StudyJobKind;
  userId: string;
  course: Course;
  docs: StudyDocument[];
  title: string;
  count: number;
  options: Omit<StudyOptions, "count"> & { format: "mcq" | "mixed" };
  apiKey: string;
  model: string;
  /** Saves into the app state. It must keep working after the component that started the job unmounts. */
  onChange: (update: (state: BrainState) => BrainState) => void;
}

let jobs: StudyJob[] = [];
const listeners = new Set<() => void>();
const inputs = new Map<string, StudyJobInput>();
const controllers = new Map<string, AbortController>();

const emit = () => listeners.forEach((l) => l());
const patch = (id: string, change: Partial<StudyJob>) => {
  if (!jobs.some((j) => j.id === id)) return;
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...change } : j));
  emit();
};
const remove = (id: string) => {
  controllers.get(id)?.abort();
  controllers.delete(id);
  inputs.delete(id);
  jobs = jobs.filter((j) => j.id !== id);
  emit();
};

async function run(id: string, input: StudyJobInput, signal: AbortSignal) {
  try {
    const sources: SourceDoc[] = [];
    for (const doc of input.docs) {
      const text = await loadDocumentText(input.userId, doc.id);
      if (text) sources.push({ doc, text });
    }
    signal.throwIfAborted();
    if (!sources.length) throw new Error("None of the selected documents have text on this device.");
    patch(id, { status: "writing" });
    let written = 0;
    const onProgress = (n: number) => {
      const next = Math.min(n, input.count);
      if (next !== written) { written = next; patch(id, { written }); }
    };
    const options = { ...input.options, count: input.count };
    const now = new Date().toISOString();
    const sourceDocIds = sources.map((s) => s.doc.id);
    // A result only lands in the account that asked for it, even if the user switched accounts meanwhile.
    const save = (update: (state: BrainState) => BrainState) =>
      input.onChange((prev) => ((prev.userId || "guest") === input.userId ? update(prev) : prev));
    let resultId: string;
    if (input.kind === "quiz") {
      const questions = await generateQuiz(sources, options, input.apiKey, input.model, signal, { onProgress, onStage: () => patch(id, { status: "checking" }) });
      signal.throwIfAborted();
      patch(id, { status: "saving", written: questions.length });
      const quiz: Quiz = { id: crypto.randomUUID(), courseId: input.course.id, title: input.title, sourceDocIds, questions, attempts: [], createdAt: now };
      save((prev) => withStudy(prev, (s) => ({ quizzes: [...s.quizzes, quiz] })));
      resultId = quiz.id;
    } else {
      const cards = await generateFlashcards(sources, options, input.apiKey, input.model, signal, onProgress);
      signal.throwIfAborted();
      patch(id, { status: "saving", written: cards.length });
      const deck: FlashcardDeck = { id: crypto.randomUUID(), courseId: input.course.id, title: input.title, sourceDocIds, cards, createdAt: now, updatedAt: now };
      save((prev) => withStudy(prev, (s) => ({ decks: [...s.decks, deck] })));
      resultId = deck.id;
    }
    controllers.delete(id);
    inputs.delete(id);
    patch(id, { status: "done", resultId });
  } catch (err) {
    if (signal.aborted) return; // Cancelled: the job was already removed.
    controllers.delete(id);
    patch(id, { status: "error", error: err instanceof Error ? err.message : "Generation failed. Try again." });
  }
}

/** Starts a generation in the background and returns its id. */
export function startStudyJob(input: StudyJobInput): string {
  const id = crypto.randomUUID();
  const controller = new AbortController();
  inputs.set(id, input);
  controllers.set(id, controller);
  jobs = [...jobs, { id, kind: input.kind, userId: input.userId, courseId: input.course.id, title: input.title, count: input.count, status: "reading", written: 0, startedAt: Date.now() }];
  emit();
  void run(id, input, controller.signal);
  return id;
}

/** Rows report when they are visible. */
export const setJobOnScreen = (id: string, onScreen: boolean) => patch(id, { onScreen });

/** Stops a running job; nothing is saved. */
export const cancelStudyJob = (id: string) => remove(id);
/** Clears a finished or failed job from view. */
export const dismissStudyJob = (id: string) => remove(id);

/** Runs a failed job again with the same materials and settings. */
export function retryStudyJob(id: string) {
  const input = inputs.get(id);
  if (!input) return;
  const controller = new AbortController();
  controllers.set(id, controller);
  patch(id, { status: "reading", written: 0, error: undefined, startedAt: Date.now() });
  void run(id, input, controller.signal);
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => jobs;

/** Live list of this user's study generations. */
export function useStudyJobs(userId: string): StudyJob[] {
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  return all.filter((j) => j.userId === userId);
}

/** For tests: the current jobs, without React. */
export const studyJobs = () => jobs;

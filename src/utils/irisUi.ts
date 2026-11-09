import type { Habit, IrisCardState, Task } from "../types";
import { getLocalDateString } from "./habitStreaks";

export type { IrisCardState };

/** Language tag of the fenced block in which the model describes an interactive card. */
export const IRIS_UI_FENCE = "iris-ui";

export interface ChecklistItem { title: string; dueDate?: string; dueTime?: string; priority?: Task["priority"]; section?: string; subsection?: string }
export interface QuizQuestion { question: string; options: string[]; answer: number; why?: string }
export type IrisUiSpec =
  | { type: "checklist"; title: string; section?: string; subsection?: string; items: ChecklistItem[] }
  | { type: "choices"; question?: string; options: string[] }
  | { type: "quiz"; title: string; questions: QuizQuestion[] }
  | { type: "chart"; habitId: string; weeks: number };

const PRIORITIES: readonly string[] = ["urgent", "high", "medium", "low"];
const text = (value: unknown, max: number) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};
const list = (value: unknown, max: number): unknown[] => Array.isArray(value) ? value.slice(0, max) : [];
const texts = (value: unknown, max: number, length: number) => list(value, max).map(v => text(v, length)).filter((v): v is string => !!v);
const validDate = (value: unknown) => {
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  return date && !Number.isNaN(new Date(`${date}T12:00:00`).getTime()) ? date : undefined;
};
const validTime = (value: unknown) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : undefined;

function checklistItem(raw: any): ChecklistItem | undefined {
  const title = text(raw?.title, 160);
  if (!title) return undefined;
  const dueDate = validDate(raw.dueDate), dueTime = dueDate ? validTime(raw.dueTime) : undefined;
  const section = text(raw.section, 60), subsection = text(raw.subsection, 60);
  return { title, ...(dueDate ? { dueDate } : {}), ...(dueTime ? { dueTime } : {}), ...(PRIORITIES.includes(raw.priority) ? { priority: raw.priority } : {}),
    ...(section ? { section } : {}), ...(subsection ? { subsection } : {}) };
}
function quizQuestion(raw: any): QuizQuestion | undefined {
  const question = text(raw?.question, 400), options = texts(raw?.options, 6, 200);
  if (!question || options.length < 2 || !Number.isInteger(raw.answer) || raw.answer < 0 || raw.answer >= options.length) return undefined;
  const why = text(raw.why, 400);
  return { question, options, answer: raw.answer, ...(why ? { why } : {}) };
}

/** The model's output is untrusted: returns a clean spec, or null when the block can't be shown. */
export function parseIrisUi(code: string): IrisUiSpec | null {
  let raw: any;
  try { raw = JSON.parse(code); } catch { return null; }
  switch (raw?.type) {
    case "checklist": {
      const title = text(raw.title, 120), items = list(raw.items, 12).map(checklistItem).filter((i): i is ChecklistItem => !!i);
      if (!title || !items.length) return null;
      const section = text(raw.section, 60), subsection = text(raw.subsection, 60);
      return { type: "checklist", title, ...(section ? { section } : {}), ...(subsection ? { subsection } : {}), items };
    }
    case "choices": {
      const options = [...new Set(texts(raw.options, 6, 80))], question = text(raw.question, 200);
      return options.length >= 2 ? { type: "choices", ...(question ? { question } : {}), options } : null;
    }
    case "quiz": {
      const title = text(raw.title, 120), questions = list(raw.questions, 10).map(quizQuestion).filter((q): q is QuizQuestion => !!q);
      return title && questions.length ? { type: "quiz", title, questions } : null;
    }
    case "chart": {
      const habitId = text(raw.habitId, 120);
      if (!habitId) return null;
      return { type: "chart", habitId, weeks: Number.isInteger(raw.weeks) ? Math.min(12, Math.max(4, raw.weeks)) : 8 };
    }
    default: return null;
  }
}

function describe(spec: IrisUiSpec): string {
  switch (spec.type) {
    case "checklist": return [spec.title, ...spec.items.map(i => `- ${i.title}${i.dueDate ? ` (${i.dueDate})` : ""}`)].join("\n");
    case "choices": return [...(spec.question ? [spec.question] : []), ...spec.options.map(o => `- ${o}`)].join("\n");
    case "quiz": return [spec.title, ...spec.questions.map((q, i) => `${i + 1}. ${q.question}\n${q.options.map(o => `   - ${o}`).join("\n")}\n   Answer: ${q.options[q.answer]}`)].join("\n");
    case "chart": return "";
  }
}

/** Replaces card blocks with readable text, for anywhere that can't show a card (copy, notes, Telegram). */
export function plainIrisUi(content: string): string {
  if (!content.includes(`\`\`\`${IRIS_UI_FENCE}`)) return content;
  const output: string[] = [];
  let block: string[] | null = null;
  const flush = () => {
    const spec = block ? parseIrisUi(block.join("\n")) : null;
    if (spec) output.push(describe(spec));
    block = null;
  };
  for (const line of content.split("\n")) {
    if (block) { if (line.trim() === "```") flush(); else block.push(line); }
    else if (line.trim() === `\`\`\`${IRIS_UI_FENCE}`) block = [];
    else output.push(line);
  }
  block = null; // A block that never closed is an interrupted reply, with nothing readable in it.
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export interface HabitWeek { label: string; done: number; current: boolean }
export const habitWeeklyTarget = (habit: Pick<Habit, "frequency">) => habit.frequency === "daily" ? 7 : habit.frequency === "weekdays" ? 5 : 2;

/** Days completed in each of the last few Monday-to-Sunday weeks, oldest first, always from the habit's real history. */
export function habitWeeks(habit: Pick<Habit, "history">, weeks: number, today = new Date()): HabitWeek[] {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (today.getDay() + 6) % 7, 12);
  return Array.from({ length: weeks }, (_, index) => {
    const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - (weeks - 1 - index) * 7, 12);
    let done = 0;
    for (let day = 0; day < 7; day++) if (habit.history?.[getLocalDateString(new Date(start.getFullYear(), start.getMonth(), start.getDate() + day, 12))]) done++;
    return { label: start.toLocaleDateString(undefined, { month: "short", day: "numeric" }), done, current: index === weeks - 1 };
  });
}

import type { Habit, IrisCardState, Task } from "../types";
import { getLocalDateString } from "./habitStreaks";

export type { IrisCardState };

/** Language tag of the fenced block in which the model describes an interactive card. */
export const IRIS_UI_FENCE = "iris-ui";

export interface ChecklistItem { title: string; dueDate?: string; dueTime?: string; priority?: Task["priority"]; section?: string; subsection?: string }
export interface QuizQuestion { question: string; options: string[]; answer: number; why?: string }
export interface RecordRef { type: string; id: string }
export interface CompareOption { title: string; summary?: string; pros: string[]; cons: string[] }
export type IrisUiSpec =
  | { type: "records"; title?: string; items: Array<{ ref: RecordRef; note?: string }> }
  | { type: "stats"; items: Array<{ label: string; value: string; detail?: string }> }
  | { type: "schedule"; title?: string; items: Array<{ title: string; time?: string; end?: string; note?: string; ref?: RecordRef }> }
  | { type: "compare"; title?: string; recommended?: number; options: CompareOption[] }
  | { type: "steps"; title: string; items: Array<{ title: string; detail?: string }> }
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

const REF_TYPES = ["task", "goal", "habit", "event", "knowledge", "tracker", "course", "document", "deck", "quiz"];
/** "task:ID" → a reference the card resolves against live records. */
function recordRef(value: unknown): RecordRef | undefined {
  const match = typeof value === "string" ? /^([a-z]+):(\S{1,120})$/.exec(value.trim()) : null;
  return match && REF_TYPES.includes(match[1]) ? { type: match[1], id: match[2] } : undefined;
}
const optional = <K extends string>(key: K, value: string | undefined) => (value ? { [key]: value } : {}) as Partial<Record<K, string>>;

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
  const title = text(raw?.title, 120);
  switch (raw?.type) {
    case "records": {
      const items = list(raw.items, 12).map((item: any) => {
        const ref = recordRef(item?.ref);
        return ref ? { ref, ...optional("note", text(item.note, 200)) } : undefined;
      }).filter(<T,>(i: T | undefined): i is T => !!i);
      return items.length ? { type: "records", ...optional("title", title), items } : null;
    }
    case "stats": {
      const items = list(raw.items, 4).map((item: any) => {
        const label = text(item?.label, 40), value = text(typeof item?.value === "number" ? String(item.value) : item?.value, 24);
        return label && value ? { label, value, ...optional("detail", text(item.detail, 60)) } : undefined;
      }).filter(<T,>(i: T | undefined): i is T => !!i);
      return items.length >= 2 ? { type: "stats", items } : null;
    }
    case "schedule": {
      const items = list(raw.items, 16).map((item: any) => {
        const itemTitle = text(item?.title, 120);
        if (!itemTitle) return undefined;
        const time = validTime(item.time), end = time ? validTime(item.end) : undefined, ref = recordRef(item.ref);
        return { title: itemTitle, ...optional("time", time), ...optional("end", end), ...optional("note", text(item.note, 200)), ...(ref ? { ref } : {}) };
      }).filter(<T,>(i: T | undefined): i is T => !!i);
      return items.length ? { type: "schedule", ...optional("title", title), items } : null;
    }
    case "compare": {
      const options = list(raw.options, 3).map((option: any) => {
        const optionTitle = text(option?.title, 80);
        return optionTitle ? { title: optionTitle, ...optional("summary", text(option.summary, 200)), pros: texts(option.pros, 5, 120), cons: texts(option.cons, 5, 120) } : undefined;
      }).filter(<T,>(i: T | undefined): i is T => !!i);
      if (options.length < 2) return null;
      const recommended = Number.isInteger(raw.recommended) && raw.recommended >= 0 && raw.recommended < options.length ? raw.recommended : undefined;
      return { type: "compare", ...optional("title", title), ...(recommended !== undefined ? { recommended } : {}), options };
    }
    case "steps": {
      const items = list(raw.items, 12).map((item: any) => {
        const stepTitle = text(item?.title, 160);
        return stepTitle ? { title: stepTitle, ...optional("detail", text(item.detail, 300)) } : undefined;
      }).filter(<T,>(i: T | undefined): i is T => !!i);
      return title && items.length ? { type: "steps", title, items } : null;
    }
    case "checklist": {
      const items = list(raw.items, 12).map(checklistItem).filter((i): i is ChecklistItem => !!i);
      if (!title || !items.length) return null;
      const section = text(raw.section, 60), subsection = text(raw.subsection, 60);
      return { type: "checklist", title, ...(section ? { section } : {}), ...(subsection ? { subsection } : {}), items };
    }
    case "choices": {
      const options = [...new Set(texts(raw.options, 6, 80))], question = text(raw.question, 200);
      return options.length >= 2 ? { type: "choices", ...(question ? { question } : {}), options } : null;
    }
    case "quiz": {
      const questions = list(raw.questions, 10).map(quizQuestion).filter((q): q is QuizQuestion => !!q);
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

const cite = (ref: RecordRef) => `[${ref.type}:${ref.id}]`;
const timeRange = (time?: string, end?: string) => time ? `${time}${end ? `–${end}` : ""} ` : "";
function describe(spec: IrisUiSpec): string {
  const heading = "title" in spec && spec.title ? [spec.title] : [];
  switch (spec.type) {
    case "records": return [...heading, ...spec.items.map(i => `- ${cite(i.ref)}${i.note ? ` — ${i.note}` : ""}`)].join("\n");
    case "stats": return spec.items.map(i => `- ${i.label}: ${i.value}${i.detail ? ` (${i.detail})` : ""}`).join("\n");
    case "schedule": return [...heading, ...spec.items.map(i => `- ${timeRange(i.time, i.end)}${i.title}${i.note ? ` — ${i.note}` : ""}`)].join("\n");
    case "compare": return [...heading, ...spec.options.map((o, i) => [`${o.title}${i === spec.recommended ? " (recommended)" : ""}${o.summary ? `: ${o.summary}` : ""}`,
      ...o.pros.map(p => `  + ${p}`), ...o.cons.map(c => `  - ${c}`)].join("\n"))].join("\n");
    case "steps": return [...heading, ...spec.items.map((i, n) => `${n + 1}. ${i.title}${i.detail ? ` — ${i.detail}` : ""}`)].join("\n");
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

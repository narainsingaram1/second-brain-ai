import type { BrainState } from "../types";
import { studyOf } from "../utils/study";

/**
 * How memories connect to the user's own records. Everything here is pure, local and cheap, so it can
 * run on every turn. Links store only a type and ID: titles are looked up when needed, so a renamed
 * record never leaves a stale name in memory and a deleted one simply stops appearing.
 */
export const MEMORY_RECORD_TYPES = ["task", "goal", "habit", "journal", "knowledge", "tracker", "event", "course", "document", "deck", "quiz"] as const;
export type MemoryRecordType = (typeof MEMORY_RECORD_TYPES)[number];
export interface MemoryRecordLink { type: MemoryRecordType; id: string }
export interface CatalogRecord extends MemoryRecordLink { title: string }

const FILLER = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "with", "my", "our", "your", "is", "are", "was", "be", "by", "from", "this", "that", "it", "as"]);
const stem = (word: string) => word.length > 4 ? word.replace(/(?:ing|ed|es|s)$/, "") : word;
export const textTerms = (text: string) => [...new Set(text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])];
/** Lowercase word stems without filler, so "projects" and "project" meet. */
export const significantTerms = (text: string) => [...new Set(textTerms(text).filter(word => !FILLER.has(word)).map(stem))];

export function recordCatalog(state: BrainState): CatalogRecord[] {
  const study = studyOf(state);
  const list = <T>(items: T[] | undefined) => items || [];
  const open = list(state.tasks).filter(t => t.status !== "completed" && !t.completed);
  const courseTitle = (id: string) => study.courses.find(c => c.id === id)?.code || "";
  return [
    ...study.courses.flatMap(c => [
      ...(c.code ? [{ type: "course" as const, id: c.id, title: c.code }] : []),
      { type: "course" as const, id: c.id, title: c.name },
    ]),
    ...list(state.goals).map(g => ({ type: "goal" as const, id: g.id, title: g.title })),
    ...open.slice(0, 200).map(t => ({ type: "task" as const, id: t.id, title: t.title })),
    ...list(state.habits).map(h => ({ type: "habit" as const, id: h.id, title: h.name })),
    ...list(state.knowledgeItems).slice(0, 300).map(k => ({ type: "knowledge" as const, id: k.id, title: k.title || k.subject })),
    ...list(state.trackerItems).slice(0, 200).map(t => ({ type: "tracker" as const, id: t.id, title: t.subject ? `${t.title} ${t.subject}` : t.title })),
    ...list(state.events).slice(0, 200).map(e => ({ type: "event" as const, id: e.id, title: e.title })),
    ...study.decks.map(d => ({ type: "deck" as const, id: d.id, title: `${courseTitle(d.courseId)} ${d.title}`.trim() })),
    ...study.quizzes.map(q => ({ type: "quiz" as const, id: q.id, title: `${courseTitle(q.courseId)} ${q.title}`.trim() })),
    ...study.documents.slice(0, 200).map(d => ({ type: "document" as const, id: d.id, title: d.name })),
  ].filter(record => record.id && record.title?.trim());
}

const squash = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const contains = (haystack: string, needle: string) => ` ${haystack} `.includes(` ${needle} `);

/**
 * Records that `text` is clearly about. A one-word title ("Work", "Gym") is too easily a coincidence, so
 * it counts only when named as an entity; longer titles must appear whole or nearly so. Course codes
 * match however they are spaced ("CS 1332", "cs1332").
 */
export function matchRecords(text: string, catalog: CatalogRecord[], entities: string[] = [], limit = 6): MemoryRecordLink[] {
  const body = squash(text), compact = body.replace(/ /g, "");
  const words = new Set(significantTerms(text));
  const named = new Set(entities.map(squash));
  const found = new Map<string, { link: MemoryRecordLink; weight: number }>();
  for (const record of catalog) {
    const title = squash(record.title);
    if (title.length < 2) continue;
    const tokens = title.split(" ");
    const code = record.type === "course" && /\d/.test(title) && tokens.length <= 3;
    let weight = 0;
    if (code && compact.includes(title.replace(/ /g, ""))) weight = 3;
    else if (named.has(title)) weight = 3;
    else if (tokens.length >= 2 && contains(body, title)) weight = 2;
    else {
      const terms = significantTerms(record.title);
      if (terms.length >= 2 && terms.filter(term => words.has(term)).length / terms.length >= 0.8) weight = 1;
    }
    if (!weight) continue;
    const key = `${record.type}:${record.id}`;
    if ((found.get(key)?.weight || 0) < weight) found.set(key, { link: { type: record.type, id: record.id }, weight });
  }
  return [...found.values()].sort((a, b) => b.weight - a.weight).slice(0, limit).map(item => item.link);
}

/** The records most likely to matter for `text`, for the extractor to link against. */
export function nearbyRecords(text: string, catalog: CatalogRecord[], limit = 20): CatalogRecord[] {
  const words = new Set(significantTerms(text));
  const seen = new Set<string>();
  return catalog
    .map(record => ({ record, score: significantTerms(record.title).filter(term => words.has(term)).length }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.record)
    .filter(record => { const key = `${record.type}:${record.id}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, limit);
}

/** A linked record's current title, or undefined if the record no longer exists. */
export function linkedRecordTitle(link: MemoryRecordLink, catalog: CatalogRecord[]): string | undefined {
  const matches = catalog.filter(record => record.type === link.type && record.id === link.id);
  return matches.map(record => record.title).sort((a, b) => a.length - b.length)[0];
}

/** Overlap between two statements, 0 to 1: how likely they say the same thing. */
export function similarity(a: string, b: string): number {
  const left = new Set(significantTerms(a)), right = new Set(significantTerms(b));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const term of left) if (right.has(term)) shared++;
  return shared / (left.size + right.size - shared);
}

import { BrainState, TrackerItem } from "../types";
import { eventTimeLabel, formatTime } from "../utils/events";
import { getLocalDateString } from "../utils/habitStreaks";
import { bestScore, courseLabel, courseTasks, dueCards, studyOf } from "../utils/study";
import { gradingForAssistant } from "../utils/grades";
import { cachedDocumentText } from "./studyDocuments";

export type RecordType = "task" | "goal" | "habit" | "journal" | "knowledge" | "tracker" | "event" | "course" | "document" | "deck" | "quiz";

function trackerDate(item: TrackerItem): string | undefined {
  if (item.kind === "job_application" && typeof item.fields.appliedDate === "string") return item.fields.appliedDate;
  if (typeof item.fields.lastPractice === "string") return item.fields.lastPractice;
  return undefined;
}
export interface BrainRecord { id: string; type: RecordType; title: string; date?: string; text: string; index: string; data: Record<string, unknown> }
export interface Source { id: string; type: string; title: string; snippet: string; offset?: number }

const list = (items: unknown) => Array.isArray(items) ? items.filter(x => typeof x === "string" && x.trim()).join(", ") : "";
const checklist = (items: unknown) => Array.isArray(items)
  ? items.map((x: any) => x && typeof x.title === "string" ? `[${x.completed ? "x" : " "}] ${x.title}` : "").filter(Boolean).join("; ") : "";
/** Notes may be stored as HTML from the editor; index the readable text only. */
function plain(text: unknown): string {
  if (typeof text !== "string") return "";
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;
  return text.replace(/<(?:br|\/p|\/h[1-6]|\/li|\/div)\s*\/?>/gi, "\n").replace(/<h([1-6])[^>]*>/gi, (_, n) => "\n" + "#".repeat(Number(n)) + " ")
    .replace(/<li[^>]*>/gi, "- ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
const lines = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join("\n");

/**
 * Readable text for search and embeddings. Raw JSON (IDs, booleans, field names) dilutes
 * embeddings and matches every query on keys like "status"; this keeps only meaning.
 */
export function recordProse(type: RecordType, d: any): string {
  switch (type) {
    case "task": return lines(`Task: ${d.title}`, `${d.status === "completed" || d.completed ? "Completed" : d.status === "in_progress" ? "In progress" : "Not started"}, ${d.priority} priority, ${d.section}${d.subsection ? ` / ${d.subsection}` : ""}${d.dueDate ? `, due ${d.dueDate}${d.dueTime ? ` at ${formatTime(d.dueTime)}` : ""}` : ", no due date"}`,
      list(d.tags) && `Tags: ${list(d.tags)}`, d.description && `Details: ${d.description}`, checklist(d.subtasks) && `Subtasks: ${checklist(d.subtasks)}`);
    case "goal": return lines(`Goal: ${d.title}`, `${d.sector} goal, ${d.timeframe}, ${d.status}, ${d.progress ?? 0}% done${d.targetDate ? `, target ${d.targetDate}` : ""}`,
      d.metrics && `Metric: ${d.metrics}`, d.why && `Why: ${d.why}`, d.description && `Details: ${d.description}`, checklist(d.milestones) && `Milestones: ${checklist(d.milestones)}`);
    case "habit": return lines(`Habit: ${d.name}`, `${d.frequency}${d.timeOfDay ? `, ${d.timeOfDay}` : ""}, ${d.streak}-day streak (best ${d.bestStreak})`, d.description && `Details: ${d.description}`);
    case "journal": return lines(`Journal: ${d.title} (${d.date}), mood ${d.mood}`, list(d.wins) && `Wins: ${list(d.wins)}`, list(d.challenges) && `Challenges: ${list(d.challenges)}`,
      plain(d.content), list(d.tags) && `Tags: ${list(d.tags)}`, d.aiReflection && `Reflection: ${d.aiReflection}`);
    case "knowledge": return lines(`Note: ${d.title || d.subject}`, list(d.tags) && `Tags: ${list(d.tags)}`, d.summary && !String(d.content || "").startsWith(d.summary) && `Summary: ${d.summary}`, plain(d.content));
    case "event": return lines(`${String(d.kind || "event").replace(/^./, (c: string) => c.toUpperCase())}: ${d.title}`, `${d.date}, ${eventTimeLabel(d)}`,
      d.location && `Location: ${d.location}`, list(d.attendees) && `With: ${list(d.attendees)}`, d.link && "Has a meeting link", d.notes && `Notes: ${d.notes}`);
    case "course": return lines(`Course: ${d.label}`, d.term && `Term: ${d.term}`, d.instructor && `Instructor: ${d.instructor}`,
      `${d.documentCount} documents, ${d.deckCount} flashcard decks (${d.cardsDue} cards due), ${d.quizCount} practice quizzes, ${d.openTasks} open tasks`,
      list(d.documentNames) && `Materials: ${list(d.documentNames)}`, list(d.folderNames) && `Folders: ${list(d.folderNames)}`,
      d.grading && `Grade: ${d.grading.currentGrade ?? "no scores yet"}${d.grading.currentGrade !== null ? `% (${d.grading.letter})` : ""}, ${d.grading.completedPercentOfCourse}% of the course graded`,
      d.grading && `Grade categories: ${d.grading.categories.map((c: any) => `${c.name} ${c.weight}%${c.average !== null ? ` avg ${c.average}%` : ""}`).join(", ")}`);
    case "document": return lines(`Course document: ${d.name} (${d.course}${d.folder ? ` / ${d.folder}` : ""})`, d.summary && `Summary: ${d.summary}`,
      d.content || "[The extracted text of this document is not loaded on this device.]");
    case "deck": return lines(`Flashcard deck: ${d.title} (${d.course})`, `${d.cardCount} cards, ${d.cardsDue} due for review today`,
      ...(Array.isArray(d.cards) ? d.cards.map((c: any) => `Q: ${c.front}\nA: ${c.back}`) : []));
    case "quiz": return lines(`Practice quiz: ${d.title} (${d.course})`,
      `${d.questionCount} questions; ${d.attemptCount ? `taken ${d.attemptCount} times, best ${d.bestScore}%, last ${d.lastScore}` : "not taken yet"}`,
      ...(Array.isArray(d.questions) ? d.questions.map((q: any, i: number) => `${i + 1}. ${q.prompt}${q.choices ? ` [${q.choices.join(" | ")}]` : ""} Answer: ${q.answer}`) : []));
    case "tracker": {
      const fields = Object.entries(d.fields || {}).filter(([, v]) => (typeof v === "string" && v.trim() && !/^https?:/i.test(v)) || typeof v === "number")
        .map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")}: ${v}`);
      return lines(`${String(d.kind || "tracker").replace(/_/g, " ")}: ${d.title}`, d.subject && d.subject !== d.title && `Subject: ${d.subject}`, `Status: ${String(d.status).replace(/_/g, " ")}`,
        ...fields, list(d.tags) && `Tags: ${list(d.tags)}`, d.notes && `Notes: ${d.notes}`);
    }
  }
}
/** Course material flattened into readable records. Document text comes from the loaded text cache. */
function studyRecords(state: BrainState) {
  const study = studyOf(state);
  const today = getLocalDateString();
  const courses = new Map(study.courses.map(c => [c.id, c]));
  const folderName = (id: string | null) => (id ? study.folders.find(f => f.id === id)?.name : undefined);
  const label = (courseId: string) => { const c = courses.get(courseId); return c ? courseLabel(c) : "Unknown course"; };
  const section = (courseId: string) => { const c = courses.get(courseId); return c ? c.code || c.name : undefined; };
  return [
    ...study.courses.map(c => {
      const decks = study.decks.filter(d => d.courseId === c.id);
      const docs = study.documents.filter(d => d.courseId === c.id);
      const data = { ...c, label: courseLabel(c), section: c.code || c.name, documentCount: docs.length, documentNames: docs.map(d => d.name),
        folderNames: study.folders.filter(f => f.courseId === c.id).map(f => f.name), deckCount: decks.length,
        cardsDue: decks.reduce((n, d) => n + dueCards(d, today).length, 0), quizCount: study.quizzes.filter(q => q.courseId === c.id).length,
        openTasks: courseTasks(state, c).filter(t => t.status !== "completed").length, grading: gradingForAssistant(c.grading) };
      return { type: "course" as const, title: courseLabel(c), date: undefined, data, source: data as unknown };
    }),
    ...study.documents.map(d => {
      const data = { ...d, course: label(d.courseId), section: section(d.courseId), folder: folderName(d.folderId), content: cachedDocumentText(d.id) };
      return { type: "document" as const, title: d.name, date: d.createdAt.slice(0, 10), data, source: data as unknown };
    }),
    ...study.decks.map(d => {
      const due = dueCards(d, today);
      const next = d.cards.reduce<string | undefined>((min, c) => (!min || c.due < min ? c.due : min), undefined);
      const data = { ...d, course: label(d.courseId), section: section(d.courseId), cardCount: d.cards.length, cardsDue: due.length, nextReview: next };
      return { type: "deck" as const, title: d.title, date: next, data, source: data as unknown };
    }),
    ...study.quizzes.map(q => {
      const last = q.attempts[q.attempts.length - 1];
      const data = { ...q, course: label(q.courseId), section: section(q.courseId), questionCount: q.questions.length, attemptCount: q.attempts.length,
        bestScore: bestScore(q), lastScore: last ? `${last.score}/${last.total}` : undefined };
      return { type: "quiz" as const, title: q.title, date: (last?.at || q.createdAt).slice(0, 10), data, source: data as unknown };
    }),
  ];
}
export function records(state: BrainState, type?: RecordType): BrainRecord[] {
  return ([
    ...state.tasks.map(data => ({ type: "task" as const, title: data.title, date: data.dueDate, data, source: data as unknown })),
    ...state.goals.map(data => ({ type: "goal" as const, title: data.title, date: data.targetDate, data, source: data as unknown })),
    ...state.habits.map(data => ({ type: "habit" as const, title: data.name, date: undefined, data, source: data as unknown })),
    ...state.journalEntries.map(data => ({ type: "journal" as const, title: data.title, date: data.date, data, source: data as unknown })),
    ...state.knowledgeItems.map(data => ({ type: "knowledge" as const, title: data.title || data.subject, date: data.startDate, data, source: data as unknown })),
    ...(state.events || []).map(data => ({ type: "event" as const, title: data.title, date: data.date, data, source: data as unknown })),
    ...(state.trackerItems || []).map(data => ({
      type: "tracker" as const,
      title: data.title,
      date: trackerDate(data),
      data: { ...data.fields, ...data },
      source: data as unknown,
    })),
    ...(!type || ["course", "document", "deck", "quiz"].includes(type) ? studyRecords(state) : []),
  ]).filter(r => !type || r.type === type).map(({ source, ...r }) => ({ ...r, id: r.data.id, data: { ...r.data },
    // Document text is read as prose after its metadata, not as one escaped JSON string.
    text: r.type === "document" ? `${JSON.stringify({ ...r.data, content: undefined }, null, 2)}\n\n${(r.data as { content?: string }).content ?? "[Text not loaded on this device.]"}` : JSON.stringify(r.data, null, 2),
    get index() { return recordProse(r.type, source); } }));
}

const PASSAGE = 1200, HARD_LIMIT = 1600;
/** Splits at word boundaries when a single paragraph is longer than a passage. */
function splitLong(text: string): string[] {
  if (text.length <= HARD_LIMIT) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > HARD_LIMIT) {
    const window = rest.slice(0, PASSAGE);
    const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const at = cut > PASSAGE / 2 ? cut + 1 : PASSAGE;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}
/**
 * Passages follow the record's structure: short records are one passage; notes split at
 * markdown headings, then paragraphs, into ~1,200-character pieces. Each passage starts with
 * the record title and heading path so it is understandable (and embeddable) on its own.
 */
export function chunks(record: BrainRecord): Source[] {
  const text = record.index;
  const header = (path: string[]) => [record.title, ...path].filter(Boolean).join(" > ");
  const base = { id: record.id, type: record.type, title: record.title };
  if (text.length <= HARD_LIMIT) return [{ ...base, offset: 0, snippet: text }];
  const result: Source[] = [];
  const path: string[] = [];
  let buffer = "", offset = 0, position = 0;
  const flush = () => {
    if (buffer.trim()) for (const piece of splitLong(buffer.trim())) result.push({ ...base, offset, snippet: result.length || offset ? `${header(path)}\n${piece}` : piece });
    buffer = "";
  };
  for (const block of text.split(/\n{2,}|\n(?=#{1,6} )/)) {
    const heading = block.match(/^(#{1,6})\s+(.+)/);
    if (heading) {
      flush();
      path.splice(heading[1].length - 1);
      path[heading[1].length - 1] = heading[2].trim();
      offset = position;
    }
    if (buffer && buffer.length + block.length > PASSAGE) { flush(); offset = position; }
    buffer += (buffer ? "\n\n" : "") + block;
    position += block.length + 2;
  }
  flush();
  return result;
}

const STOP_WORDS = new Set("a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my of on or our so than that the their them then there these they this to too was we were what when where which who why will with you your about after again all also am any because before being both each few more most other over same should some such through under until up very just".split(" "));
/** Lowercase words without stop words; a light plural fold lets "deadlines" match "deadline". */
export function tokenize(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(t => !STOP_WORDS.has(t) && (t.length > 1 || /\d/.test(t)))
    .map(t => t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);
}
/** Okapi BM25: rare terms count more than common ones, and long passages do not win by size. */
export function bm25(docs: string[][], query: string[], k1 = 1.2, b = 0.75): number[] {
  const terms = [...new Set(query)];
  if (!terms.length || !docs.length) return docs.map(() => 0);
  const wanted = new Set(terms);
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const tfs = docs.map(doc => { const tf = new Map<string, number>(); for (const t of doc) if (wanted.has(t)) tf.set(t, (tf.get(t) || 0) + 1); return tf; });
  const idf = new Map(terms.map(t => { const df = tfs.reduce((n, tf) => n + (tf.has(t) ? 1 : 0), 0); return [t, Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))]; }));
  return tfs.map((tf, i) => terms.reduce((score, t) => {
    const f = tf.get(t) || 0;
    return score + (f ? idf.get(t)! * (f * (k1 + 1)) / (f + k1 * (1 - b + b * docs[i].length / avg)) : 0);
  }, 0));
}

// Separate, content-addressed neural index. Never mixes embedding spaces or accounts.
const MODEL = "openai/text-embedding-3-small";
let dbPromise: Promise<IDBDatabase> | undefined;
function embeddingDB(): Promise<IDBDatabase> {
  return dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("synapse_retrieval_v1", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("embeddings");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, "0")).join("");
}
export async function cachedEmbedding(key: string): Promise<number[] | undefined> {
  try {
    const db = await embeddingDB();
    return await new Promise((resolve, reject) => {
      const req = db.transaction("embeddings").objectStore("embeddings").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch { return undefined; }
}
export async function storeEmbedding(key: string, vector: number[]): Promise<void> {
  try {
    const db = await embeddingDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("embeddings", "readwrite");
      tx.objectStore("embeddings").put(vector, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* An unavailable cache does not invalidate retrieved evidence. */ }
}
export async function embed(inputs: string[], key: string, signal?: AbortSignal): Promise<number[][]> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  });
  if (!res.ok) throw new Error(`Embedding service failed (HTTP ${res.status})`);
  const body = await res.json();
  const sorted = body.data?.sort((a: { index: number }, b: { index: number }) => a.index - b.index);
  if (!sorted || sorted.length !== inputs.length || sorted.some((x: { embedding: number[] }) => !Array.isArray(x.embedding) || !x.embedding.length || x.embedding.some(v => !Number.isFinite(v)))) throw new Error("Invalid embedding response");
  return sorted.map((x: { embedding: number[] }) => x.embedding);
}
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
// Vectors for unchanged passages stay in memory, so warm searches skip hashing and IndexedDB reads.
const passageVectors = new Map<string, { snippet: string; key: string; vector?: number[] }>();
const MAX_PASSAGE_VECTORS = 8000;
export async function searchRecords(state: BrainState, query: string, type: RecordType | undefined, offset: number, key: string, signal?: AbortSignal, progress?: (s: string) => void) {
  const sources = records(state, type).flatMap(record => chunks(record).map((source, i) => ({ source, slot: `${state.userId || "guest"}|${MODEL}|${record.type}|${record.id}|${i}` })));
  if (!sources.length) return { results: [], total: 0, nextOffset: null, complete: true, mode: "hybrid" };
  const queryTerms = tokenize(query);
  const lexical = bm25(sources.map(({ source }) => [...tokenize(source.snippet), ...tokenize(source.title)]), queryTerms);
  let neural: number[] | undefined;
  let warning: string | undefined;
  try {
    const entries = await Promise.all(sources.map(async ({ source, slot }) => {
      const known = passageVectors.get(slot);
      if (known?.snippet === source.snippet) return known;
      const entry: { snippet: string; key: string; vector?: number[] } = { snippet: source.snippet, key: await digest(`${state.userId || "guest"}|${MODEL}|${source.title}|${source.snippet}`) };
      entry.vector = await cachedEmbedding(entry.key);
      passageVectors.delete(slot);
      passageVectors.set(slot, entry);
      return entry;
    }));
    while (passageVectors.size > MAX_PASSAGE_VECTORS) passageVectors.delete(passageVectors.keys().next().value!);
    const missing = entries.flatMap((e, i) => e.vector ? [] : [i]);
    for (let start = 0; start < missing.length; start += 32) {
      signal?.throwIfAborted();
      progress?.(`Indexing notes: ${Math.min(start + 32, missing.length)} of ${missing.length} passages`);
      const indices = missing.slice(start, start + 32);
      const batch = await embed(indices.map(i => sources[i].source.snippet.startsWith(sources[i].source.title) ? sources[i].source.snippet : `${sources[i].source.title}\n${sources[i].source.snippet}`), key, signal);
      await Promise.all(indices.map(async (i, j) => { entries[i].vector = batch[j]; await storeEmbedding(entries[i].key, batch[j]); }));
    }
    const [q] = await embed([query], key, signal);
    neural = entries.map(e => e.vector ? cosine(q, e.vector) : 0);
  } catch (err) {
    signal?.throwIfAborted();
    warning = `${err instanceof Error ? err.message : "Semantic search unavailable"}. Results use keyword search only; paraphrases may be missed.`;
  }
  // Reciprocal rank fusion: BM25 and cosine are on different scales, so combine ranks, not scores.
  const fused = new Map<number, number>();
  const rankInto = (scores: number[], keep: (score: number) => boolean) => scores
    .map((score, i) => ({ score, i })).filter(x => keep(x.score)).sort((a, b) => b.score - a.score)
    .forEach(({ i }, rank) => fused.set(i, (fused.get(i) || 0) + 1 / (60 + rank + 1)));
  rankInto(lexical, score => score > 0);
  if (neural) rankInto(neural, score => score >= 0.3);
  const ranked = [...fused].sort((a, b) => b[1] - a[1]).map(([i, score]) => {
    const { offset: _passageOffset, ...source } = sources[i].source;
    return { ...source, score: Number(score.toFixed(5)) };
  });
  const results = ranked.slice(offset, offset + 6);
  return { results, total: ranked.length, searchedPassages: sources.length, nextOffset: offset + results.length < ranked.length ? offset + results.length : null,
    complete: offset + results.length >= ranked.length, mode: neural ? "hybrid" : "keyword", warning };
}

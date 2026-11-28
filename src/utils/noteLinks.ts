import type { BrainState, KnowledgeItem } from "../types";
import { courseLabel, studyOf } from "./study";
import { stripNoteImages } from "./noteImages";

export type LinkTargetType =
  | "knowledge"
  | "task"
  | "course"
  | "event"
  | "tracker"
  | "journal"
  | "habit"
  | "deck"
  | "quiz";

export interface LinkCandidate {
  type: LinkTargetType;
  id: string;
  label: string;
  subtitle?: string;
  badge: string;
  keywords: string;
  date?: string;
  subkind?: "job_application" | "leetcode";
  syntax: "wiki" | "mention";
  unresolved?: boolean;
}

export interface ExtractedLink {
  raw: string;
  syntax: "wiki" | "mention";
  type: LinkTargetType;
  id: string | null;
  label: string;
  unresolved: boolean;
  start: number;
  end: number;
}

export interface BacklinkHit {
  sourceType: LinkTargetType;
  sourceId: string;
  sourceTitle: string;
  sourceMeta?: string;
  sourceDate?: string;
  snippet: string;
  matchText: string;
  field: string;
  start: number;
  end: number;
}

export interface UnlinkedMentionHit {
  sourceType: "knowledge" | "journal" | "task" | "event" | "tracker";
  sourceId: string;
  sourceTitle: string;
  sourceMeta?: string;
  sourceDate?: string;
  snippet: string;
  matchText: string;
  field: "content" | "description" | "notes";
  start: number;
  end: number;
}

const GENERIC_NOTE_TITLES = new Set([
  "untitled",
  "untitled note",
  "note",
  "notes",
  "todo",
  "tasks",
  "journal",
  "draft",
  "test",
  "ideas",
  "summary",
]);

export const LINKABLE_TYPES: readonly LinkTargetType[] = [
  "knowledge",
  "task",
  "course",
  "event",
  "tracker",
  "journal",
  "habit",
  "deck",
  "quiz",
];

export const normalizeLinkTitle = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

export const noteTitleOf = (note: Pick<KnowledgeItem, "title" | "subject">): string =>
  (note.title || note.subject || "Untitled").trim() || "Untitled";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns character ranges `[start, end)` belonging to fenced code blocks or inline code spans,
 * so `[[arr]]` or `@decorator` in code is never parsed as a record link or unlinked mention.
 */
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fenceRegex = /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]{0,3}\2[ \t]*(?=\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    const start = match.index + match[1].length;
    ranges.push([start, match.index + match[0].length]);
  }
  const inlineCodeRegex = /`[^`\n]+`/g;
  while ((match = inlineCodeRegex.exec(text)) !== null) {
    const s = match.index;
    const e = s + match[0].length;
    if (!ranges.some(([rs, re]) => s >= rs && e <= re)) ranges.push([s, e]);
  }
  return ranges;
}

function insideRanges(index: number, end: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([rs, re]) => index < re && end > rs);
}

/** Readable plain excerpt around a match offset, preserving the exact matched string for UI highlighting. */
export function buildSnippet(text: string, start: number, end: number, radius = 78): string {
  const cleanPiece = (s: string) =>
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/@\[([^\]\n]+)\]\(synapse:\/\/[a-z]+\/[^\s)]+\)/g, "$1")
      .replace(/\[\[(?:[a-z]+:[^|\]]+\|)?([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => (b || a))
      .replace(/\s+/g, " ");
  // Expand slightly before cleaning so truncated `@[label](synapse://...)` tokens near the edge still simplify cleanly
  const pad = 120;
  const leftExpanded = text.slice(Math.max(0, start - radius - pad), start);
  const rightExpanded = text.slice(end, Math.min(text.length, end + radius + pad));
  const leftCleaned = cleanPiece(leftExpanded);
  const rightCleaned = cleanPiece(rightExpanded);
  const left = leftCleaned.length > radius
    ? `…${leftCleaned.slice(leftCleaned.length - radius).replace(/^\S*\s+/, "")}`
    : leftCleaned;
  const mid = cleanPiece(text.slice(start, end));
  const right = rightCleaned.length > radius
    ? `${rightCleaned.slice(0, radius).replace(/\s+\S*$/, "")}…`
    : rightCleaned;
  return `${left}${mid}${right}`.trim();
}

/** Builds a searchable catalog of every linkable entity in Synapse. */
export function buildLinkCatalog(state: BrainState | null | undefined): LinkCandidate[] {
  if (!state) return [];
  const study = studyOf(state);
  const folderNames = new Map((state.noteFolders || []).map(f => [f.id, f.name]));
  const courseById = new Map(study.courses.map(c => [c.id, c]));

  const notes: LinkCandidate[] = (state.knowledgeItems || []).map(n => {
    const label = noteTitleOf(n);
    const folder = n.folderId ? folderNames.get(n.folderId) : undefined;
    const tags = (n.tags || []).map(t => `#${t}`).join(" ");
    return {
      type: "knowledge",
      id: n.id,
      label,
      subtitle: [folder, n.updatedAt?.slice(0, 10) || n.startDate].filter(Boolean).join(" · "),
      badge: "Note",
      keywords: `${label} ${folder || ""} ${tags} ${n.summary || ""}`.toLowerCase(),
      date: n.updatedAt || n.createdAt || n.startDate,
      syntax: "wiki",
    };
  });

  const tasks: LinkCandidate[] = (state.tasks || []).map(t => ({
    type: "task",
    id: t.id,
    label: t.title,
    subtitle: [t.section, t.subsection, t.dueDate ? `Due ${t.dueDate}` : undefined, t.completed ? "Done" : undefined]
      .filter(Boolean)
      .join(" · "),
    badge: "Task",
    keywords: `${t.title} ${t.section} ${t.subsection || ""} ${(t.tags || []).join(" ")}`.toLowerCase(),
    date: t.dueDate,
    syntax: "mention",
  }));

  const courses: LinkCandidate[] = study.courses.map(c => {
    const label = courseLabel(c);
    return {
      type: "course",
      id: c.id,
      label,
      subtitle: [c.term, c.instructor].filter(Boolean).join(" · ") || "Course",
      badge: "Course",
      keywords: `${c.code} ${c.name} ${c.term || ""} ${c.instructor || ""}`.toLowerCase(),
      date: c.updatedAt,
      syntax: "mention",
    };
  });

  const events: LinkCandidate[] = (state.events || []).map(e => ({
    type: "event",
    id: e.id,
    label: e.title,
    subtitle: [e.date, e.startTime, e.location].filter(Boolean).join(" · "),
    badge: "Event",
    keywords: `${e.title} ${e.kind} ${e.location || ""} ${(e.attendees || []).join(" ")}`.toLowerCase(),
    date: e.date,
    syntax: "mention",
  }));

  const trackers: LinkCandidate[] = (state.trackerItems || []).map(tr => {
    const isJob = tr.kind === "job_application";
    const label = isJob && tr.subject ? `${tr.title} — ${tr.subject}` : tr.title;
    const statusLabel = tr.status.replace(/_/g, " ");
    return {
      type: "tracker",
      id: tr.id,
      label,
      subtitle: [isJob ? "Job App" : "LeetCode", statusLabel, tr.fields?.company as string | undefined]
        .filter(Boolean)
        .join(" · "),
      badge: isJob ? "Job App" : "LeetCode",
      subkind: tr.kind,
      keywords: `${tr.title} ${tr.subject || ""} ${tr.kind} ${statusLabel} ${(tr.tags || []).join(" ")}`.toLowerCase(),
      date: tr.updatedAt,
      syntax: "mention",
    };
  });

  const journals: LinkCandidate[] = (state.journalEntries || []).map(j => ({
    type: "journal",
    id: j.id,
    label: j.title ? `${j.title} (${j.date})` : `Journal · ${j.date}`,
    subtitle: [j.date, j.mood].filter(Boolean).join(" · "),
    badge: "Journal",
    keywords: `${j.title} ${j.date} ${j.mood} ${(j.tags || []).join(" ")}`.toLowerCase(),
    date: j.date,
    syntax: "mention",
  }));

  const habits: LinkCandidate[] = (state.habits || []).map(h => ({
    type: "habit",
    id: h.id,
    label: h.name,
    subtitle: [`${h.streak}d streak`, h.frequency, h.domain].filter(Boolean).join(" · "),
    badge: "Habit",
    keywords: `${h.name} ${h.domain || ""} ${h.frequency}`.toLowerCase(),
    syntax: "mention",
  }));

  const decks: LinkCandidate[] = study.decks.map(d => ({
    type: "deck",
    id: d.id,
    label: d.title,
    subtitle: [courseById.get(d.courseId)?.code || "Flashcards", `${d.cards.length} cards`].join(" · "),
    badge: "Deck",
    keywords: `${d.title} ${courseById.get(d.courseId)?.code || ""}`.toLowerCase(),
    date: d.updatedAt,
    syntax: "mention",
  }));

  const quizzes: LinkCandidate[] = study.quizzes.map(q => ({
    type: "quiz",
    id: q.id,
    label: q.title,
    subtitle: [courseById.get(q.courseId)?.code || "Quiz", `${q.questions.length} questions`].join(" · "),
    badge: "Quiz",
    keywords: `${q.title} ${courseById.get(q.courseId)?.code || ""}`.toLowerCase(),
    date: q.createdAt,
    syntax: "mention",
  }));

  return [...notes, ...tasks, ...courses, ...events, ...trackers, ...journals, ...habits, ...decks, ...quizzes];
}

/** Searches link candidates for `[[` or `@` autocomplete menus. */
export function searchLinkCandidates(
  state: BrainState | null | undefined,
  query: string,
  trigger: "[[" | "@",
  options?: { excludeNoteId?: string; filterType?: LinkTargetType | "all"; limit?: number },
): LinkCandidate[] {
  const catalog = buildLinkCatalog(state).filter(
    item => !(options?.excludeNoteId && item.type === "knowledge" && item.id === options.excludeNoteId),
  );
  const q = query.trim().toLocaleLowerCase();
  const filterType = options?.filterType && options.filterType !== "all" ? options.filterType : undefined;
  const filtered = filterType ? catalog.filter(item => item.type === filterType) : catalog;

  const scoreItem = (item: LinkCandidate): number => {
    let score = 0;
    const label = item.label.toLocaleLowerCase();
    if (!q) {
      score += trigger === "[[" && item.type === "knowledge" ? 30 : 10;
      if (item.type === "task" || item.type === "course" || item.type === "tracker") score += 6;
      if (item.date) score += 2;
      return score;
    }
    if (label === q) score += 120;
    else if (label.startsWith(q)) score += 80;
    else if (label.includes(q)) score += 50;
    else if (item.keywords.includes(q)) score += 24;
    else {
      const terms = q.split(/\s+/).filter(Boolean);
      if (terms.length > 1 && terms.every(t => item.keywords.includes(t))) score += 20;
      else return -1;
    }
    if (trigger === "[[" && item.type === "knowledge") score += 16;
    return score;
  };

  const ranked = filtered
    .map(item => ({ item, score: scoreItem(item) }))
    .filter(x => x.score >= 0)
    .sort((a, b) => b.score - a.score || (b.item.date || "").localeCompare(a.item.date || "") || a.item.label.localeCompare(b.item.label))
    .slice(0, options?.limit ?? 14)
    .map(x => x.item);

  // Offer instant creation of a brand-new linked note when typing `[[New Title`
  if (
    trigger === "[[" &&
    (!filterType || filterType === "knowledge") &&
    q.length >= 2 &&
    !catalog.some(c => c.type === "knowledge" && normalizeLinkTitle(c.label) === normalizeLinkTitle(query))
  ) {
    ranked.push({
      type: "knowledge",
      id: "",
      label: query.trim(),
      subtitle: "Create new linked note",
      badge: "New note",
      keywords: q,
      syntax: "wiki",
      unresolved: true,
    });
  }

  return ranked;
}

/** Resolves a `[[Wiki-Link]]` string (`Title`, `Title|Alias`, or `type:id|Label`) against live state. */
export function resolveWikiTarget(
  rawInner: string,
  state: BrainState | null | undefined,
): { type: LinkTargetType; id: string | null; label: string; unresolved: boolean } {
  const trimmed = rawInner.trim();
  const typed = /^([a-z]+):([^|\s]+)\|(.+)$/.exec(trimmed);
  if (typed && LINKABLE_TYPES.includes(typed[1] as LinkTargetType)) {
    const type = typed[1] as LinkTargetType;
    const id = typed[2].trim();
    const label = typed[3].trim();
    const exists = !!resolveRecordByTypeAndId(state, type, id);
    return { type, id, label, unresolved: !exists };
  }

  const pipeIdx = trimmed.indexOf("|");
  const targetName = (pipeIdx >= 0 ? trimmed.slice(0, pipeIdx) : trimmed).trim();
  const displayLabel = (pipeIdx >= 0 ? trimmed.slice(pipeIdx + 1) : targetName).trim() || targetName;
  const norm = normalizeLinkTitle(targetName);

  const noteMatch = (state?.knowledgeItems || []).find(n => normalizeLinkTitle(noteTitleOf(n)) === norm);
  if (noteMatch) {
    return { type: "knowledge", id: noteMatch.id, label: displayLabel, unresolved: false };
  }

  // Fallback: match course code/name if someone wrote `[[CS 1332]]`
  const courseMatch = studyOf(state || { study: undefined }).courses.find(
    c => (c.code && normalizeLinkTitle(c.code) === norm) || normalizeLinkTitle(c.name) === norm,
  );
  if (courseMatch) {
    return { type: "course", id: courseMatch.id, label: displayLabel, unresolved: false };
  }

  return { type: "knowledge", id: null, label: displayLabel, unresolved: true };
}

export function resolveRecordByTypeAndId(
  state: BrainState | null | undefined,
  type: LinkTargetType | string,
  id: string | null | undefined,
): { title: string; subtitle?: string } | null {
  if (!state || !id) return null;
  const study = studyOf(state);
  switch (type) {
    case "knowledge": {
      const n = state.knowledgeItems?.find(k => k.id === id);
      return n ? { title: noteTitleOf(n), subtitle: n.updatedAt?.slice(0, 10) || n.startDate } : null;
    }
    case "task": {
      const t = state.tasks?.find(x => x.id === id);
      return t ? { title: t.title, subtitle: `${t.section}${t.dueDate ? ` · ${t.dueDate}` : ""}` } : null;
    }
    case "course": {
      const c = study.courses.find(x => x.id === id);
      return c ? { title: courseLabel(c), subtitle: c.term } : null;
    }
    case "event": {
      const e = state.events?.find(x => x.id === id);
      return e ? { title: e.title, subtitle: [e.date, e.startTime].filter(Boolean).join(" · ") } : null;
    }
    case "tracker": {
      const tr = state.trackerItems?.find(x => x.id === id);
      if (!tr) return null;
      const title = tr.kind === "job_application" && tr.subject ? `${tr.title} — ${tr.subject}` : tr.title;
      return { title, subtitle: tr.kind === "job_application" ? "Job App" : "LeetCode" };
    }
    case "journal": {
      const j = state.journalEntries?.find(x => x.id === id);
      return j ? { title: j.title ? `${j.title} (${j.date})` : `Journal · ${j.date}`, subtitle: j.date } : null;
    }
    case "habit": {
      const h = state.habits?.find(x => x.id === id);
      return h ? { title: h.name, subtitle: `${h.streak}d streak` } : null;
    }
    case "deck": {
      const d = study.decks.find(x => x.id === id);
      return d ? { title: d.title, subtitle: `${d.cards.length} cards` } : null;
    }
    case "quiz": {
      const q = study.quizzes.find(x => x.id === id);
      return q ? { title: q.title, subtitle: `${q.questions.length} questions` } : null;
    }
    default:
      return null;
  }
}

/** Extracts all `[[wiki]]` and `@[label](synapse://type/id)` links from Markdown/text outside code spans. */
export function extractLinksFromText(
  text: string | undefined,
  state?: BrainState | null,
): ExtractedLink[] {
  if (!text) return [];
  const cleanText = text;
  const blocked = codeRanges(cleanText);
  const links: ExtractedLink[] = [];
  const pattern = /@\[([^\]\n]+)\]\(synapse:\/\/([a-z]+)\/([^\s)]+)\)|\[\[([^\[\]\n]+?)\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleanText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (insideRanges(start, end, blocked)) continue;

    if (match[1] && match[2] && match[3]) {
      const type = match[2] as LinkTargetType;
      if (!LINKABLE_TYPES.includes(type)) continue;
      const id = match[3].trim();
      const resolved = resolveRecordByTypeAndId(state, type, id);
      links.push({
        raw: match[0],
        syntax: "mention",
        type,
        id,
        label: resolved?.title || match[1].trim(),
        unresolved: state ? !resolved : false,
        start,
        end,
      });
    } else if (match[4]) {
      const resolved = resolveWikiTarget(match[4], state);
      links.push({
        raw: match[0],
        syntax: "wiki",
        type: resolved.type,
        id: resolved.id,
        label: resolved.label,
        unresolved: resolved.unresolved,
        start,
        end,
      });
    }
  }
  return links;
}

/** Formats a chosen autocomplete candidate into clean Markdown syntax. */
export function formatLinkMarkdown(candidate: Pick<LinkCandidate, "type" | "id" | "label" | "syntax">): string {
  const cleanLabel = candidate.label.replace(/[\[\]]/g, "").trim() || "Untitled";
  if (candidate.syntax === "wiki" && candidate.type === "knowledge" && !cleanLabel.includes("|")) {
    return `[[${cleanLabel}]]`;
  }
  return `@[${cleanLabel}](synapse://${candidate.type}/${candidate.id})`;
}

/** Checks whether an extracted link resolves to a target record `(targetType, targetId, targetTitle)`. */
export function linkPointsToTarget(
  link: ExtractedLink,
  targetType: LinkTargetType,
  targetId: string,
  targetTitleNorm?: string,
): boolean {
  if (link.type !== targetType) return false;
  if (link.id && link.id === targetId) return true;
  if (targetType === "knowledge" && targetTitleNorm && !link.id && normalizeLinkTitle(link.label) === targetTitleNorm) {
    return true;
  }
  return false;
}

/** Detects an active `[[query` or `@query` mention trigger immediately before the cursor. */
export function detectMentionTrigger(
  textBeforeCaret: string,
): { trigger: "[[" | "@"; query: string; offsetFromEnd: number } | null {
  const wiki = /\[\[([^\[\]\n]{0,60})$/.exec(textBeforeCaret);
  if (wiki) {
    return { trigger: "[[", query: wiki[1], offsetFromEnd: wiki[0].length };
  }
  const mention = /(?:^|[\s(\[{"'])@([^\n@\[]{0,40})$/.exec(textBeforeCaret);
  if (mention) {
    const query = mention[1];
    // Avoid keeping menu open across many spaces unless user is still searching a short title
    if (query.split(/\s+/).length <= 5) {
      return { trigger: "@", query, offsetFromEnd: query.length + 1 };
    }
  }
  return null;
}

/** Finds all linked backlinks and unlinked text mentions pointing to a specific Note (or any record). */
export function findBacklinksAndMentions(
  target: { type: LinkTargetType; id: string; title: string },
  state: BrainState | null | undefined,
): { backlinks: BacklinkHit[]; unlinkedMentions: UnlinkedMentionHit[] } {
  if (!state) return { backlinks: [], unlinkedMentions: [] };
  const targetTitle = target.title.trim();
  const targetTitleNorm = normalizeLinkTitle(targetTitle);

  const backlinks: BacklinkHit[] = [];
  const unlinkedMentions: UnlinkedMentionHit[] = [];

  type SourceText = {
    sourceType: LinkTargetType;
    sourceId: string;
    sourceTitle: string;
    sourceMeta?: string;
    sourceDate?: string;
    field: "content" | "description" | "notes";
    text: string;
    canUnlinkScan: boolean;
  };

  const sources: SourceText[] = [];
  for (const n of state.knowledgeItems || []) {
    if (target.type === "knowledge" && n.id === target.id) continue;
    const text = n.content || "";
    if (!text) continue;
    sources.push({
      sourceType: "knowledge",
      sourceId: n.id,
      sourceTitle: noteTitleOf(n),
      sourceMeta: "Note",
      sourceDate: (n.updatedAt || n.startDate || "").slice(0, 10),
      field: "content",
      text,
      canUnlinkScan: true,
    });
  }
  for (const j of state.journalEntries || []) {
    if (target.type === "journal" && j.id === target.id) continue;
    const text = j.content || "";
    if (!text) continue;
    sources.push({
      sourceType: "journal",
      sourceId: j.id,
      sourceTitle: j.title ? `${j.title} (${j.date})` : `Journal · ${j.date}`,
      sourceMeta: "Journal",
      sourceDate: j.date,
      field: "content",
      text,
      canUnlinkScan: true,
    });
  }
  for (const t of state.tasks || []) {
    if (target.type === "task" && t.id === target.id) continue;
    if (!t.description) continue;
    sources.push({
      sourceType: "task",
      sourceId: t.id,
      sourceTitle: t.title,
      sourceMeta: `Task · ${t.section}`,
      sourceDate: t.dueDate,
      field: "description",
      text: t.description,
      canUnlinkScan: true,
    });
  }
  for (const e of state.events || []) {
    if (target.type === "event" && e.id === target.id) continue;
    if (!e.notes) continue;
    sources.push({
      sourceType: "event",
      sourceId: e.id,
      sourceTitle: e.title,
      sourceMeta: "Event",
      sourceDate: e.date,
      field: "notes",
      text: e.notes,
      canUnlinkScan: true,
    });
  }
  for (const tr of state.trackerItems || []) {
    if (target.type === "tracker" && tr.id === target.id) continue;
    if (!tr.notes) continue;
    sources.push({
      sourceType: "tracker",
      sourceId: tr.id,
      sourceTitle: tr.kind === "job_application" && tr.subject ? `${tr.title} — ${tr.subject}` : tr.title,
      sourceMeta: tr.kind === "job_application" ? "Job App" : "LeetCode",
      sourceDate: tr.updatedAt.slice(0, 10),
      field: "notes",
      text: tr.notes,
      canUnlinkScan: true,
    });
  }

  const canScanTitle =
    targetTitle.length >= 3 &&
    !GENERIC_NOTE_TITLES.has(targetTitleNorm) &&
    !/^https?:\/\//i.test(targetTitle);
  const titleRegex = canScanTitle
    ? new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(targetTitle)}(?![\\p{L}\\p{N}_])`, "giu")
    : null;

  for (const src of sources) {
    const extracted = extractLinksFromText(src.text, state);
    const linkedRanges: Array<[number, number]> = extracted.map(l => [l.start, l.end]);

    for (const link of extracted) {
      if (linkPointsToTarget(link, target.type, target.id, targetTitleNorm)) {
        backlinks.push({
          sourceType: src.sourceType,
          sourceId: src.sourceId,
          sourceTitle: src.sourceTitle,
          sourceMeta: src.sourceMeta,
          sourceDate: src.sourceDate,
          snippet: buildSnippet(src.text, link.start, link.end),
          matchText: src.text.slice(link.start, link.end),
          field: src.field,
          start: link.start,
          end: link.end,
        });
      }
    }

    if (!titleRegex || !src.canUnlinkScan) continue;

    // Exclude markdown image syntax, markdown link destinations, headings, and existing code/link spans
    const blocked: Array<[number, number]> = [...codeRanges(src.text), ...linkedRanges];
    const extraMask = /!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\)|^#{1,6}\s+[^\n]+/gm;
    let m: RegExpExecArray | null;
    while ((m = extraMask.exec(src.text)) !== null) {
      blocked.push([m.index, m.index + m[0].length]);
    }

    titleRegex.lastIndex = 0;
    while ((m = titleRegex.exec(src.text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (insideRanges(start, end, blocked)) continue;
      // Avoid matching inside data URLs or long tokens
      if (stripNoteImages(src.text.slice(Math.max(0, start - 16), end + 16)).length === 0) continue;
      unlinkedMentions.push({
        sourceType: src.sourceType as UnlinkedMentionHit["sourceType"],
        sourceId: src.sourceId,
        sourceTitle: src.sourceTitle,
        sourceMeta: src.sourceMeta,
        sourceDate: src.sourceDate,
        snippet: buildSnippet(src.text, start, end),
        matchText: m[0],
        field: src.field,
        start,
        end,
      });
      break; // One clean unlinked mention per source record keeps the list scannable
    }
  }

  return { backlinks, unlinkedMentions };
}

/** Replaces an exact unlinked mention range in text with a formatted Wiki-Link or @Mention. */
export function linkMentionRange(
  text: string,
  start: number,
  end: number,
  target: { type: LinkTargetType; id: string; label: string },
): string {
  if (start < 0 || end > text.length || start >= end) return text;
  const formatted = formatLinkMarkdown({
    type: target.type,
    id: target.id,
    label: target.label,
    syntax: target.type === "knowledge" ? "wiki" : "mention",
  });
  return `${text.slice(0, start)}${formatted}${text.slice(end)}`;
}

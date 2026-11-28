import type { BrainState, KnowledgeItem } from "../types";
import { bm25Counts, termCounts, tokenize } from "../services/brainRetrieval";
import { vectorVault } from "../services/vectorVault";
import { normalizeAgentMemory } from "../services/agentMemory";
import { courseLabel, studyOf } from "./study";
import { stripNoteImages } from "./noteImages";
import {
  extractLinksFromText,
  linkPointsToTarget,
  normalizeLinkTitle,
  noteTitleOf,
  type LinkTargetType,
} from "./noteLinks";

export interface RelatedContextItem {
  type: LinkTargetType | "memory";
  id: string;
  title: string;
  subtitle?: string;
  snippet: string;
  score: number;
  reason: string;
  reasonKind: "semantic" | "tag" | "graph" | "lexical" | "memory";
  alreadyLinked: boolean;
  date?: string;
}

export interface RelatedContextSummary {
  items: RelatedContextItem[];
  counts: {
    notes: number;
    journals: number;
    tasks: number;
    other: number;
  };
  headline: string;
  semanticActive: boolean;
}

function cleanProse(text: string | undefined): string {
  if (!text) return "";
  return stripNoteImages(text)
    .replace(/^(?:Note|Journal|Task|Event|Course|Memory|Flashcard deck|Practice quiz|Habit|Job application|Leetcode):\s*[^\n]*\n?/gim, "")
    .replace(/^(?:Tags|Summary|Details|Wins|Challenges|Status):\s*[^\n]*\n?/gim, "")
    .replace(/@\[([^\]\n]+)\]\(synapse:\/\/[a-z]+\/[^\s)]+\)/g, "$1")
    .replace(/\[\[(?:[a-z]+:[^|\]]+\|)?([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => (b || a))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtWord(text: string, max = 128): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max).replace(/\s+\S*$/, "").trim();
  return `${cut || text.slice(0, max)}…`;
}

export function formatRelatedHeadline(counts: RelatedContextSummary["counts"]): string {
  const parts: string[] = [];
  if (counts.notes > 0) parts.push(`${counts.notes} related ${counts.notes === 1 ? "note" : "notes"}`);
  if (counts.journals > 0) parts.push(`${counts.journals} ${counts.journals === 1 ? "journal entry" : "journal entries"}`);
  if (counts.tasks > 0) parts.push(`${counts.tasks} ${counts.tasks === 1 ? "task" : "tasks"}`);
  if (counts.other > 0 && parts.length < 3) parts.push(`${counts.other} ${counts.other === 1 ? "item" : "items"}`);
  return parts.length ? parts.join(" · ") : "No close matches yet";
}

function summarizeCounts(items: RelatedContextItem[]): RelatedContextSummary["counts"] {
  let notes = 0;
  let journals = 0;
  let tasks = 0;
  let other = 0;
  for (const item of items) {
    if (item.type === "knowledge") notes++;
    else if (item.type === "journal") journals++;
    else if (item.type === "task") tasks++;
    else other++;
  }
  return { notes, journals, tasks, other };
}

/**
 * Instant, zero-network Related Context computation using shared tags, 2-hop graph links,
 * memory connections, and local Okapi BM25 lexical similarity.
 */
export function computeInstantRelatedContext(
  state: BrainState | null | undefined,
  current: {
    type: "knowledge" | "journal";
    id: string;
    title: string;
    content: string;
    tags?: string[];
  },
  limit = 6,
): RelatedContextSummary {
  if (!state) {
    return {
      items: [],
      counts: { notes: 0, journals: 0, tasks: 0, other: 0 },
      headline: "No close matches yet",
      semanticActive: false,
    };
  }

  const prose = cleanProse(current.content);
  const queryText = `${current.title} ${(current.tags || []).join(" ")} ${prose.slice(0, 600)}`.trim();
  const queryTokens = tokenize(queryText);
  const currentTags = new Set((current.tags || []).map(t => t.trim().toLowerCase()).filter(Boolean));
  const outgoing = extractLinksFromText(current.content, state);
  const outgoingKeys = new Set(outgoing.filter(l => l.id).map(l => `${l.type}:${l.id}`));

  const folderNames = new Map((state.noteFolders || []).map(f => [f.id, f.name]));
  const study = studyOf(state);

  type CandidateDoc = {
    type: LinkTargetType | "memory";
    id: string;
    title: string;
    subtitle?: string;
    prose: string;
    displaySnippet: string;
    tags: string[];
    outKeys: Set<string>;
    date?: string;
  };

  const candidates: CandidateDoc[] = [];

  for (const n of state.knowledgeItems || []) {
    if (current.type === "knowledge" && n.id === current.id) continue;
    const title = noteTitleOf(n);
    const body = cleanProse(n.content || n.summary);
    const links = extractLinksFromText(n.content, state);
    candidates.push({
      type: "knowledge",
      id: n.id,
      title,
      subtitle: n.folderId ? folderNames.get(n.folderId) : n.updatedAt?.slice(0, 10) || n.startDate,
      prose: `${title} ${(n.tags || []).join(" ")} ${body.slice(0, 800)}`,
      displaySnippet: truncateAtWord(body, 128),
      tags: n.tags || [],
      outKeys: new Set(links.filter(l => l.id).map(l => `${l.type}:${l.id}`)),
      date: (n.updatedAt || n.startDate || "").slice(0, 10),
    });
  }

  for (const j of state.journalEntries || []) {
    if (current.type === "journal" && j.id === current.id) continue;
    const title = j.title ? `${j.title} (${j.date})` : `Journal · ${j.date}`;
    const rawBody = cleanProse(j.content);
    const body = cleanProse(`${j.content} ${(j.wins || []).join(" ")} ${(j.challenges || []).join(" ")}`);
    const links = extractLinksFromText(j.content, state);
    candidates.push({
      type: "journal",
      id: j.id,
      title,
      subtitle: `${j.date} · ${j.mood}`,
      prose: `${j.title} ${body.slice(0, 600)}`,
      displaySnippet: truncateAtWord(rawBody || body, 128),
      tags: j.tags || [],
      outKeys: new Set(links.filter(l => l.id).map(l => `${l.type}:${l.id}`)),
      date: j.date,
    });
  }

  for (const t of state.tasks || []) {
    if (t.completed && t.status === "completed") continue;
    const body = cleanProse(t.description);
    const links = extractLinksFromText(t.description, state);
    candidates.push({
      type: "task",
      id: t.id,
      title: t.title,
      subtitle: [t.section, t.subsection, t.dueDate].filter(Boolean).join(" · "),
      prose: `${t.title} ${t.section} ${t.subsection || ""} ${body}`,
      displaySnippet: truncateAtWord(body, 128),
      tags: t.tags || [],
      outKeys: new Set(links.filter(l => l.id).map(l => `${l.type}:${l.id}`)),
      date: t.dueDate,
    });
  }

  for (const c of study.courses) {
    candidates.push({
      type: "course",
      id: c.id,
      title: courseLabel(c),
      subtitle: c.term || "Course",
      prose: `${c.code} ${c.name} ${c.instructor || ""}`,
      displaySnippet: [c.instructor, c.term].filter(Boolean).join(" · "),
      tags: [],
      outKeys: new Set(),
      date: c.updatedAt?.slice(0, 10),
    });
  }

  for (const tr of state.trackerItems || []) {
    const isJob = tr.kind === "job_application";
    const title = isJob && tr.subject ? `${tr.title} — ${tr.subject}` : tr.title;
    const notesBody = cleanProse(tr.notes);
    candidates.push({
      type: "tracker",
      id: tr.id,
      title,
      subtitle: isJob ? `Job App · ${tr.status}` : `LeetCode · ${tr.status}`,
      prose: `${title} ${tr.notes || ""} ${(tr.tags || []).join(" ")}`,
      displaySnippet: truncateAtWord(notesBody, 128),
      tags: tr.tags || [],
      outKeys: new Set(),
      date: tr.updatedAt.slice(0, 10),
    });
  }

  for (const e of state.events || []) {
    const notesBody = cleanProse(e.notes || e.location);
    candidates.push({
      type: "event",
      id: e.id,
      title: e.title,
      subtitle: [e.date, e.startTime].filter(Boolean).join(" · "),
      prose: `${e.title} ${e.location || ""} ${e.notes || ""}`,
      displaySnippet: truncateAtWord(notesBody, 128),
      tags: [],
      outKeys: new Set(),
      date: e.date,
    });
  }

  const memory = normalizeAgentMemory(state.agentMemory);
  for (const m of memory.entries) {
    if (m.expiresAt && Date.parse(m.expiresAt) <= Date.now()) continue;
    const memBody = cleanProse(m.content);
    candidates.push({
      type: "memory",
      id: m.id,
      title: m.topic,
      subtitle: `Memory · ${m.category}`,
      prose: `${m.topic} ${m.content} ${(m.entities || []).join(" ")}`,
      displaySnippet: truncateAtWord(memBody, 128),
      tags: [],
      outKeys: new Set((m.records || []).map(r => `${r.type}:${r.id}`)),
      date: m.updatedAt.slice(0, 10),
    });
  }

  const bm25Scores = queryTokens.length
    ? bm25Counts(
        candidates.map(c => termCounts(tokenize(c.prose))),
        queryTokens,
      )
    : candidates.map(() => 0);
  const maxBm25 = Math.max(...bm25Scores, 0.001);

  const scored: RelatedContextItem[] = [];
  const selfKey = `${current.type}:${current.id}`;

  candidates.forEach((doc, index) => {
    const sharedTags = doc.tags.filter(t => currentTags.has(t.trim().toLowerCase()));
    let sharedLinks = 0;
    for (const k of doc.outKeys) if (outgoingKeys.has(k)) sharedLinks++;
    const linksToSelf = doc.outKeys.has(selfKey);
    const alreadyLinked = outgoingKeys.has(`${doc.type}:${doc.id}`) || linksToSelf;

    const lexicalNorm = bm25Scores[index] > 0 ? Math.min(1, bm25Scores[index] / Math.max(maxBm25, 2.5)) : 0;
    const score =
      sharedTags.length * 0.42 +
      sharedLinks * 0.48 +
      (linksToSelf ? 0.35 : 0) +
      lexicalNorm * 0.75;

    if (score < 0.24) return;

    let reason = "Related concept";
    let reasonKind: RelatedContextItem["reasonKind"] = "lexical";
    if (doc.type === "memory") {
      reason = "Saved memory";
      reasonKind = "memory";
    } else if (sharedTags.length) {
      reason = `Shared #${sharedTags[0]}`;
      reasonKind = "tag";
    } else if (sharedLinks > 0 || linksToSelf) {
      reason = linksToSelf ? "Links here" : `${sharedLinks} shared ${sharedLinks === 1 ? "link" : "links"}`;
      reasonKind = "graph";
    }

    scored.push({
      type: doc.type,
      id: doc.id,
      title: doc.title,
      subtitle: doc.subtitle,
      snippet: doc.displaySnippet,
      score,
      reason,
      reasonKind,
      alreadyLinked,
      date: doc.date,
    });
  });

  const top = scored.sort((a, b) => b.score - a.score).slice(0, limit);
  const counts = summarizeCounts(top);
  return {
    items: top,
    counts,
    headline: formatRelatedHeadline(counts),
    semanticActive: false,
  };
}

/**
 * Queries `vectorVault.search` (neural embeddings + BM25 reciprocal rank fusion) and blends it
 * with local graph/tag context. Gracefully returns instant local matches when offline or aborted.
 */
export async function fetchSemanticRelatedContext(
  state: BrainState,
  current: {
    type: "knowledge" | "journal";
    id: string;
    title: string;
    content: string;
    tags?: string[];
  },
  signal?: AbortSignal,
  limit = 6,
): Promise<RelatedContextSummary> {
  const instant = computeInstantRelatedContext(state, current, limit);
  const prose = cleanProse(current.content);
  const query = `${current.title} ${(current.tags || []).join(" ")} ${prose.slice(0, 320)}`.trim();
  if (query.length < 18) return instant;

  try {
    const results = await vectorVault.search(state, query, limit + 4, undefined, signal);
    if (signal?.aborted) return instant;

    const outgoingKeys = new Set(
      extractLinksFromText(current.content, state)
        .filter(l => l.id)
        .map(l => `${l.type}:${l.id}`),
    );
    const merged = new Map<string, RelatedContextItem>(
      instant.items.map(item => [`${item.type}:${item.id}`, item]),
    );

    for (const hit of results) {
      const { item_type, item_id, title, content, date } = hit.chunk;
      if (item_type === current.type && item_id === current.id) continue;
      if (hit.score < 0.28) continue;

      const key = `${item_type}:${item_id}`;
      const prev = merged.get(key);
      const semanticBoost = hit.score * 0.95;
      const snippet = truncateAtWord(cleanProse(content), 128);

      const targetNote = item_type === "knowledge" ? state.knowledgeItems?.find(k => k.id === item_id) : undefined;
      const targetTitleNorm = targetNote ? normalizeLinkTitle(noteTitleOf(targetNote)) : undefined;
      const linkedInText = extractLinksFromText(current.content, state).some(link =>
        linkPointsToTarget(link, item_type as LinkTargetType, item_id, targetTitleNorm),
      );
      if (prev) {
        merged.set(key, {
          ...prev,
          score: Math.max(prev.score, semanticBoost) + 0.15,
          reason: prev.reasonKind === "tag" || prev.reasonKind === "graph" ? prev.reason : "Semantic match",
          reasonKind: prev.reasonKind === "tag" || prev.reasonKind === "graph" ? prev.reasonKind : "semantic",
          snippet: snippet || prev.snippet,
        });
      } else {
        merged.set(key, {
          type: item_type as LinkTargetType,
          id: item_id,
          title: title || "Untitled",
          subtitle: date || item_type,
          snippet,
          score: semanticBoost,
          reason: "Semantic match",
          reasonKind: "semantic",
          alreadyLinked: outgoingKeys.has(key) || linkedInText,
          date,
        });
      }
    }

    const items = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    const counts = summarizeCounts(items);
    return {
      items,
      counts,
      headline: formatRelatedHeadline(counts),
      semanticActive: true,
    };
  } catch {
    return instant;
  }
}

export function notePreviewText(note: KnowledgeItem): string {
  return cleanProse(note.content || note.summary);
}

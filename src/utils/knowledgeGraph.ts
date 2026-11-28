import type { BrainState } from "../types";
import { normalizeAgentMemory } from "../services/agentMemory";
import { bm25Counts, termCounts, tokenize } from "../services/brainRetrieval";
import { courseLabel, courseTasks, studyOf } from "./study";
import { stripNoteImages } from "./noteImages";
import { extractLinksFromText, noteTitleOf } from "./noteLinks";

export type GraphNodeKind =
  | "knowledge"
  | "journal"
  | "tag"
  | "course"
  | "task"
  | "event"
  | "tracker"
  | "memory";

export type GraphEdgeKind = "explicit" | "tag" | "structure" | "semantic" | "memory";

export interface GraphNode {
  id: string; // e.g. "knowledge:note-123" or "tag:dp"
  recordId: string;
  kind: GraphNodeKind;
  subkind?: "job_application" | "leetcode";
  label: string;
  subtitle?: string;
  excerpt?: string;
  date?: string;
  degree: number;
  explicitDegree: number;
  componentId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  weight: number;
  label?: string;
  directed?: boolean;
}

export interface KnowledgeGraphOptions {
  enabledKinds?: Set<GraphNodeKind>;
  enabledEdges?: Set<GraphEdgeKind>;
  includeOrphans?: boolean;
  focusNodeId?: string | null;
  focusDepth?: 1 | 2 | "all";
  width?: number;
  height?: number;
}

export interface KnowledgeGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  allNodesCount: number;
  connectedCount: number;
  componentCount: number;
}

const DEFAULT_KINDS = new Set<GraphNodeKind>([
  "knowledge",
  "journal",
  "tag",
  "course",
  "task",
  "event",
  "tracker",
  "memory",
]);

const DEFAULT_EDGES = new Set<GraphEdgeKind>([
  "explicit",
  "tag",
  "structure",
  "semantic",
  "memory",
]);

function hashUnit(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function cleanSnippet(text: string | undefined): string {
  if (!text) return "";
  return stripNoteImages(text)
    .replace(/@\[([^\]\n]+)\]\(synapse:\/\/[a-z]+\/[^\s)]+\)/g, "$1")
    .replace(/\[\[(?:[a-z]+:[^|\]]+\|)?([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => (b || a))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

/**
 * Builds a genuinely connected, multi-signal Knowledge Graph across Notes, Journal entries,
 * Tags, Academic Courses, Tasks, Events, Career Trackers, and Agent Memories.
 */
export function buildKnowledgeGraph(
  state: BrainState | null | undefined,
  options: KnowledgeGraphOptions = {},
): KnowledgeGraphData {
  if (!state) {
    return { nodes: [], edges: [], allNodesCount: 0, connectedCount: 0, componentCount: 0 };
  }

  const enabledKinds = options.enabledKinds ?? DEFAULT_KINDS;
  const enabledEdges = options.enabledEdges ?? DEFAULT_EDGES;
  const includeOrphans = options.includeOrphans ?? false;
  const width = options.width || 960;
  const height = options.height || 640;

  const study = studyOf(state);
  const folderById = new Map((state.noteFolders || []).map(f => [f.id, f]));
  const nodeMap = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphEdge>();

  const ensureNode = (node: Omit<GraphNode, "degree" | "explicitDegree" | "componentId" | "x" | "y" | "vx" | "vy" | "radius">) => {
    if (!nodeMap.has(node.id)) {
      nodeMap.set(node.id, {
        ...node,
        degree: 0,
        explicitDegree: 0,
        componentId: 0,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        radius: 8,
      });
    }
    return nodeMap.get(node.id)!;
  };

  const addEdge = (source: string, target: string, kind: GraphEdgeKind, weight: number, label?: string, directed = false) => {
    if (source === target) return;
    if (!nodeMap.has(source) || !nodeMap.has(target)) return;
    const key = directed ? `${kind}:${source}->${target}` : `${kind}:${[source, target].sort().join("--")}`;
    if (edgeMap.has(key)) return;
    edgeMap.set(key, { id: key, source, target, kind, weight, label, directed });
  };

  // 1. Register core nodes
  for (const n of state.knowledgeItems || []) {
    const folder = n.folderId ? folderById.get(n.folderId) : undefined;
    ensureNode({
      id: `knowledge:${n.id}`,
      recordId: n.id,
      kind: "knowledge",
      label: noteTitleOf(n),
      subtitle: folder?.name || "Note",
      excerpt: cleanSnippet(n.content || n.summary),
      date: (n.updatedAt || n.startDate || "").slice(0, 10),
    });
  }

  for (const j of state.journalEntries || []) {
    ensureNode({
      id: `journal:${j.id}`,
      recordId: j.id,
      kind: "journal",
      label: j.title ? j.title : `Journal · ${j.date}`,
      subtitle: `${j.date} · ${j.mood}`,
      excerpt: cleanSnippet(j.content),
      date: j.date,
    });
  }

  for (const c of study.courses) {
    ensureNode({
      id: `course:${c.id}`,
      recordId: c.id,
      kind: "course",
      label: courseLabel(c),
      subtitle: c.term || "Course",
      excerpt: [c.instructor, c.term].filter(Boolean).join(" · "),
      date: c.updatedAt?.slice(0, 10),
    });
  }

  for (const t of state.tasks || []) {
    ensureNode({
      id: `task:${t.id}`,
      recordId: t.id,
      kind: "task",
      label: t.title,
      subtitle: [t.section, t.subsection, t.completed ? "Done" : t.priority].filter(Boolean).join(" · "),
      excerpt: cleanSnippet(t.description),
      date: t.dueDate,
    });
  }

  for (const e of state.events || []) {
    ensureNode({
      id: `event:${e.id}`,
      recordId: e.id,
      kind: "event",
      label: e.title,
      subtitle: [e.date, e.startTime].filter(Boolean).join(" · "),
      excerpt: cleanSnippet(e.notes || e.location),
      date: e.date,
    });
  }

  for (const tr of state.trackerItems || []) {
    const isJob = tr.kind === "job_application";
    ensureNode({
      id: `tracker:${tr.id}`,
      recordId: tr.id,
      kind: "tracker",
      subkind: tr.kind,
      label: isJob && tr.subject ? `${tr.title} — ${tr.subject}` : tr.title,
      subtitle: `${isJob ? "Job App" : "LeetCode"} · ${tr.status.replace(/_/g, " ")}`,
      excerpt: cleanSnippet(tr.notes),
      date: tr.updatedAt.slice(0, 10),
    });
  }

  const memory = normalizeAgentMemory(state.agentMemory);
  const activeMemories = memory.entries.filter(m => !m.expiresAt || Date.parse(m.expiresAt) > Date.now());
  for (const m of activeMemories) {
    ensureNode({
      id: `memory:${m.id}`,
      recordId: m.id,
      kind: "memory",
      label: m.topic,
      subtitle: `Memory · ${m.category}`,
      excerpt: cleanSnippet(m.content),
      date: m.updatedAt.slice(0, 10),
    });
  }

  // 2. Explicit [[Wiki-Links]] and @[Record](synapse://...) edges
  if (enabledEdges.has("explicit")) {
    const linkSources: Array<{ nodeId: string; text?: string }> = [
      ...(state.knowledgeItems || []).map(n => ({ nodeId: `knowledge:${n.id}`, text: n.content })),
      ...(state.journalEntries || []).map(j => ({
        nodeId: `journal:${j.id}`,
        text: [j.content, ...(j.wins || []), ...(j.challenges || [])].join("\n"),
      })),
      ...(state.tasks || []).map(t => ({ nodeId: `task:${t.id}`, text: t.description })),
      ...(state.events || []).map(e => ({ nodeId: `event:${e.id}`, text: e.notes })),
      ...(state.trackerItems || []).map(tr => ({ nodeId: `tracker:${tr.id}`, text: tr.notes })),
    ];

    for (const src of linkSources) {
      for (const link of extractLinksFromText(src.text, state)) {
        if (!link.id) continue;
        const targetNodeId = `${link.type}:${link.id}`;
        if (nodeMap.has(targetNodeId)) {
          addEdge(src.nodeId, targetNodeId, "explicit", 1.0, "links to", true);
        }
      }
    }
  }

  // 3. Tag hub nodes & edges (connects notes & journals sharing tags)
  if (enabledEdges.has("tag") && enabledKinds.has("tag")) {
    const tagUsage = new Map<string, { display: string; members: string[] }>();
    const addTag = (raw: string, ownerId: string) => {
      const clean = raw.trim().replace(/^#/, "");
      if (!clean) return;
      const key = clean.toLowerCase();
      const entry = tagUsage.get(key) ?? { display: clean, members: [] };
      if (!entry.members.includes(ownerId)) entry.members.push(ownerId);
      tagUsage.set(key, entry);
    };

    for (const n of state.knowledgeItems || []) {
      for (const t of n.tags || []) addTag(t, `knowledge:${n.id}`);
    }
    for (const j of state.journalEntries || []) {
      for (const t of j.tags || []) if (t.toLowerCase() !== "reflection") addTag(t, `journal:${j.id}`);
    }
    for (const t of state.tasks || []) {
      for (const tag of t.tags || []) addTag(tag, `task:${t.id}`);
    }

    for (const [key, entry] of tagUsage.entries()) {
      if (entry.members.length < 2 && !includeOrphans) continue;
      const tagNodeId = `tag:${key}`;
      ensureNode({
        id: tagNodeId,
        recordId: key,
        kind: "tag",
        label: `#${entry.display}`,
        subtitle: `${entry.members.length} linked ${entry.members.length === 1 ? "item" : "items"}`,
      });
      for (const memberId of entry.members) {
        addEdge(memberId, tagNodeId, "tag", 0.65, `#${entry.display}`);
      }
    }
  }

  // 4. Structural domain bridges (Courses <-> Tasks / Notes in matching folder, Workspace peers)
  if (enabledEdges.has("structure")) {
    for (const course of study.courses) {
      const courseNodeId = `course:${course.id}`;
      for (const task of courseTasks(state, course)) {
        addEdge(courseNodeId, `task:${task.id}`, "structure", 0.72, course.code || "course task");
      }
      // Link notes whose folder or title/tags clearly match the course code or name
      const codeNorm = course.code?.replace(/\s+/g, "").toLowerCase();
      const nameNorm = course.name.toLowerCase();
      for (const n of state.knowledgeItems || []) {
        const folder = n.folderId ? folderById.get(n.folderId) : undefined;
        const hay = `${noteTitleOf(n)} ${folder?.name || ""} ${(n.tags || []).join(" ")}`.toLowerCase();
        const matchesCode = !!codeNorm && codeNorm.length >= 3 && hay.replace(/\s+/g, "").includes(codeNorm);
        const matchesName = nameNorm.length >= 5 && hay.includes(nameNorm);
        if (matchesCode || matchesName || (folder?.workspaceId && folder.workspaceId === course.workspaceId)) {
          addEdge(`knowledge:${n.id}`, courseNodeId, "structure", 0.6, course.code || course.name);
        }
      }
    }

    // Connect notes that share a non-generic domain or same non-workspace folder into subtle topical clusters
    const notesByGroup = new Map<string, { label: string; ids: string[] }>();
    for (const n of state.knowledgeItems || []) {
      const folder = n.folderId ? folderById.get(n.folderId) : undefined;
      if (folder && !folder.workspaceId) {
        const key = `folder:${folder.id}`;
        const g = notesByGroup.get(key) ?? { label: folder.name, ids: [] };
        g.ids.push(`knowledge:${n.id}`);
        notesByGroup.set(key, g);
      } else if (n.domain && !["notes", "general", "untitled"].includes(n.domain.trim().toLowerCase())) {
        const key = `domain:${n.domain.trim().toLowerCase()}`;
        const g = notesByGroup.get(key) ?? { label: n.domain.trim(), ids: [] };
        g.ids.push(`knowledge:${n.id}`);
        notesByGroup.set(key, g);
      }
    }
    for (const group of notesByGroup.values()) {
      if (group.ids.length < 2 || group.ids.length > 16) continue;
      const anchor = group.ids[0];
      for (let i = 1; i < group.ids.length; i++) {
        addEdge(anchor, group.ids[i], "structure", 0.35, group.label);
      }
    }
  }

  // 5. MemoryGraph links (AgentMemory <-> records, entities, symmetric related)
  if (enabledEdges.has("memory")) {
    for (const m of activeMemories) {
      const mNodeId = `memory:${m.id}`;
      for (const r of m.records || []) {
        const targetId = `${r.type}:${r.id}`;
        if (nodeMap.has(targetId)) addEdge(mNodeId, targetId, "memory", 0.75, "remembers", true);
      }
      for (const relId of m.related || []) {
        const targetId = `memory:${relId}`;
        if (nodeMap.has(targetId)) addEdge(mNodeId, targetId, "memory", 0.65, "related memory");
      }
    }
  }

  // 6. Semantic bridges (local BM25 similarity between Notes & Journal entries when not already directly linked)
  if (enabledEdges.has("semantic")) {
    const docs = [
      ...(state.knowledgeItems || []).map(n => ({
        id: `knowledge:${n.id}`,
        text: `${noteTitleOf(n)} ${(n.tags || []).join(" ")} ${cleanSnippet(n.content || n.summary)}`,
      })),
      ...(state.journalEntries || []).slice(0, 40).map(j => ({
        id: `journal:${j.id}`,
        text: `${j.title} ${cleanSnippet(j.content)}`,
      })),
    ].filter(d => d.text.trim().length >= 24);

    if (docs.length >= 2 && docs.length <= 160) {
      const docTerms = docs.map(d => termCounts(tokenize(d.text)));
      const directSet = new Set<string>();
      for (const edge of edgeMap.values()) {
        directSet.add(`${edge.source}::${edge.target}`);
        directSet.add(`${edge.target}::${edge.source}`);
      }

      docs.forEach((doc, idx) => {
        const qTokens = docTerms[idx].terms.slice(0, 28);
        if (qTokens.length < 3) return;
        const scores = bm25Counts(docTerms, qTokens);
        const selfScore = scores[idx] || 1;
        const best = scores
          .map((s, j) => ({ j, ratio: s / selfScore }))
          .filter(x => x.j !== idx && x.ratio >= 0.25 && !directSet.has(`${doc.id}::${docs[x.j].id}`))
          .sort((a, b) => b.ratio - a.ratio)
          .slice(0, 2);

        for (const match of best) {
          addEdge(doc.id, docs[match.j].id, "semantic", Math.min(0.85, match.ratio), "similar concept");
        }
      });
    }
  }

  // Filter nodes & edges by active kind/edge toggles
  const allNodesCount = nodeMap.size;
  const activeNodeSet = new Set<string>();
  for (const node of nodeMap.values()) {
    if (enabledKinds.has(node.kind)) activeNodeSet.add(node.id);
  }

  let edges = [...edgeMap.values()].filter(
    e => enabledEdges.has(e.kind) && activeNodeSet.has(e.source) && activeNodeSet.has(e.target),
  );

  // Count degrees
  const degreeMap = new Map<string, number>();
  const explicitDegreeMap = new Map<string, number>();
  for (const e of edges) {
    degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1);
    degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1);
    if (e.kind === "explicit") {
      explicitDegreeMap.set(e.source, (explicitDegreeMap.get(e.source) || 0) + 1);
      explicitDegreeMap.set(e.target, (explicitDegreeMap.get(e.target) || 0) + 1);
    }
  }

  // Keep connected nodes plus notes/courses (and optionally all orphans)
  let nodes = [...nodeMap.values()].filter(node => {
    if (!activeNodeSet.has(node.id)) return false;
    const deg = degreeMap.get(node.id) || 0;
    if (deg > 0) return true;
    if (includeOrphans) return true;
    return node.kind === "knowledge" || node.kind === "course";
  });

  // Focus Ego-Graph filtering (1-hop or 2-hop around a selected node)
  if (options.focusNodeId && options.focusDepth && options.focusDepth !== "all" && nodeMap.has(options.focusNodeId)) {
    const keep = new Set<string>([options.focusNodeId]);
    let frontier = new Set<string>([options.focusNodeId]);
    for (let hop = 0; hop < options.focusDepth; hop++) {
      const next = new Set<string>();
      for (const e of edges) {
        if (frontier.has(e.source) && !keep.has(e.target)) next.add(e.target);
        if (frontier.has(e.target) && !keep.has(e.source)) next.add(e.source);
      }
      for (const id of next) keep.add(id);
      frontier = next;
    }
    nodes = nodes.filter(n => keep.has(n.id));
    const keptIds = new Set(nodes.map(n => n.id));
    edges = edges.filter(e => keptIds.has(e.source) && keptIds.has(e.target));
  }

  const finalNodeIds = new Set(nodes.map(n => n.id));
  edges = edges.filter(e => finalNodeIds.has(e.source) && finalNodeIds.has(e.target));

  // Recompute final degrees & connected components
  const adj = new Map<string, string[]>();
  degreeMap.clear();
  explicitDegreeMap.clear();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
    degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1);
    degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1);
    if (e.kind === "explicit") {
      explicitDegreeMap.set(e.source, (explicitDegreeMap.get(e.source) || 0) + 1);
      explicitDegreeMap.set(e.target, (explicitDegreeMap.get(e.target) || 0) + 1);
    }
  }

  let compIdx = 0;
  const visited = new Set<string>();
  const componentSizes = new Map<number, number>();
  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const queue = [n.id];
    visited.add(n.id);
    let size = 0;
    while (queue.length) {
      const cur = queue.shift()!;
      const curNode = nodeMap.get(cur);
      if (curNode) curNode.componentId = compIdx;
      size++;
      for (const nb of adj.get(cur) || []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    componentSizes.set(compIdx, size);
    compIdx++;
  }

  // Deterministic, balanced initial placement by connected component + golden angle
  const cx = width / 2;
  const cy = height / 2;
  const spread = Math.min(width, height) * 0.34;
  const compOffsets = new Map<number, { ox: number; oy: number }>();
  const sortedComps = [...componentSizes.entries()].sort((a, b) => b[1] - a[1]);
  sortedComps.forEach(([cid, size], rank) => {
    if (rank === 0 && size > 2) {
      compOffsets.set(cid, { ox: cx, oy: cy });
    } else {
      const angle = rank * 2.399963229728653;
      const dist = Math.min(spread, 68 + Math.sqrt(rank) * 62);
      compOffsets.set(cid, { ox: cx + Math.cos(angle) * dist, oy: cy + Math.sin(angle) * dist });
    }
  });

  let connectedCount = 0;
  nodes.forEach((n, index) => {
    n.degree = degreeMap.get(n.id) || 0;
    n.explicitDegree = explicitDegreeMap.get(n.id) || 0;
    if (n.degree > 0) connectedCount++;
    n.radius =
      n.kind === "knowledge"
        ? Math.min(18, 7.5 + Math.sqrt(n.degree) * 2.4)
        : n.kind === "course"
          ? Math.min(16, 8.5 + Math.sqrt(n.degree) * 1.8)
          : n.kind === "tag"
            ? Math.min(14, 6 + Math.sqrt(n.degree) * 1.9)
            : Math.min(14, 6 + Math.sqrt(n.degree) * 1.7);

    const origin = compOffsets.get(n.componentId) || { ox: cx, oy: cy };
    const angle = (hashUnit(n.id) * 6.28318) + index * 0.45;
    const localR = 18 + Math.sqrt(index % 25) * 22;
    n.x = origin.ox + Math.cos(angle) * localR;
    n.y = origin.oy + Math.sin(angle) * localR;
  });

  return {
    nodes,
    edges,
    allNodesCount,
    connectedCount,
    componentCount: compIdx,
  };
}

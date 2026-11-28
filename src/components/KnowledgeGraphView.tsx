import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Compass,
  Eye,
  EyeOff,
  Maximize2,
  Minus,
  Network,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import type { BrainState } from "../types";
import {
  buildKnowledgeGraph,
  type GraphEdge,
  type GraphEdgeKind,
  type GraphNode,
  type GraphNodeKind,
} from "../utils/knowledgeGraph";
import { navigateToRecord } from "../utils/recordNavigation";
import { RecordTypeIcon } from "./RecordMentionMenu";
import { type LinkTargetType } from "../utils/noteLinks";

interface KnowledgeGraphViewProps {
  state: BrainState | null | undefined;
  initialFocusNodeId?: string | null;
  compact?: boolean;
  onOpenFullGraph?: (nodeId?: string) => void;
  onOpenNoteById?: (noteId: string) => void;
  onInsertLink?: (node: GraphNode) => void;
}

interface ThemePalette {
  bg: string;
  panel: string;
  raised: string;
  ink: string;
  secondary: string;
  muted: string;
  line: string;
  accent: string;
  gridDot: string;
  kinds: Record<GraphNodeKind, string>;
}

const ALL_KINDS: Array<{ id: GraphNodeKind; label: string }> = [
  { id: "knowledge", label: "Notes" },
  { id: "journal", label: "Journal" },
  { id: "course", label: "Courses" },
  { id: "task", label: "Tasks" },
  { id: "event", label: "Events" },
  { id: "tracker", label: "Career" },
  { id: "tag", label: "Tags" },
  { id: "memory", label: "Memories" },
];

const ALL_EDGES: Array<{ id: GraphEdgeKind; label: string; style: string }> = [
  { id: "explicit", label: "Links & @mentions", style: "solid" },
  { id: "tag", label: "Shared tags", style: "soft" },
  { id: "structure", label: "Courses & folders", style: "soft" },
  { id: "semantic", label: "Semantic bridges", style: "dashed" },
  { id: "memory", label: "Memories", style: "soft" },
];

function readThemePalette(): ThemePalette {
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const style = typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const css = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback;
  return {
    bg: css("--workspace-canvas", isDark ? "#141415" : "#fafafa"),
    panel: css("--workspace-panel", isDark ? "#19191b" : "#ffffff"),
    raised: css("--workspace-raised", isDark ? "#232325" : "#f4f4f5"),
    ink: css("--workspace-ink", isDark ? "#ededed" : "#171717"),
    secondary: css("--workspace-secondary", isDark ? "#a1a1a6" : "#525257"),
    muted: css("--workspace-muted", isDark ? "#85858b" : "#737378"),
    line: css("--workspace-line", isDark ? "#2a2a2d" : "#e9e9eb"),
    accent: css("--workspace-accent", isDark ? "#8fa8ef" : "#2f55d4"),
    gridDot: isDark ? "rgba(255,255,255,0.055)" : "rgba(23,23,23,0.06)",
    kinds: {
      knowledge: isDark ? "#8fa8ef" : "#3a62dc",
      journal: isDark ? "#e0a84a" : "#b7791f",
      course: isDark ? "#4cc38a" : "#2f8a57",
      task: isDark ? "#e58aa6" : "#c25576",
      event: isDark ? "#4cc2c2" : "#1f8a8a",
      tracker: isDark ? "#b69be6" : "#7c5cd6",
      tag: isDark ? "#94949c" : "#6f6f77",
      memory: isDark ? "#9d9cf0" : "#5b5bd6",
    },
  };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

interface SimState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeById: Map<string, GraphNode>;
  neighbors: Map<string, Set<string>>;
  alpha: number;
  cam: { x: number; y: number; k: number };
  draggingNode: GraphNode | null;
  panning: { startX: number; startY: number; camX: number; camY: number; moved: boolean } | null;
}

function stepSimulation(sim: SimState, width: number, height: number, compact: boolean, activeFocus: string | null) {
  const { nodes, edges, nodeById } = sim;
  if (!nodes.length) return;
  if (sim.alpha < 0.01 && !sim.draggingNode) return;

  const alpha = Math.max(0.01, sim.alpha);
  const cx = width / 2;
  const cy = height / 2;
  const count = nodes.length;
  const repulsion = compact ? 2500 : count > 90 ? 3400 : 4500;

  for (let i = 0; i < count; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < count; j++) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.5) {
        dx = (i % 2 ? 1 : -1) * 0.9;
        dy = (j % 2 ? 1 : -1) * 0.9;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      const minDist = a.radius + b.radius + (compact ? 42 : 58);
      let force = (repulsion / (d2 + 120)) * alpha;
      if (d < minDist) {
        force += (minDist - d) * 0.28;
      }
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      if (sim.draggingNode !== a) { a.vx -= fx; a.vy -= fy; }
      if (sim.draggingNode !== b) { b.vx += fx; b.vy += fy; }
    }
  }

  for (const e of edges) {
    const a = nodeById.get(e.source);
    const b = nodeById.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const ideal =
      e.kind === "explicit"
        ? (compact ? 92 : 134)
        : e.kind === "tag" || e.kind === "structure"
          ? (compact ? 106 : 154)
          : (compact ? 122 : 178);
    const stiffness = e.kind === "explicit" ? 0.08 : e.kind === "semantic" ? 0.036 : 0.055;
    const diff = (d - ideal) * stiffness * alpha * (0.65 + e.weight * 0.35);
    const fx = (dx / d) * diff;
    const fy = (dy / d) * diff;
    if (sim.draggingNode !== a) { a.vx += fx; a.vy += fy; }
    if (sim.draggingNode !== b) { b.vx -= fx; b.vy -= fy; }
  }

  for (const n of nodes) {
    if (sim.draggingNode === n) continue;
    const pull = n.id === activeFocus && compact ? 0.14 : n.degree === 0 ? 0.025 : 0.016;
    n.vx += (cx - n.x) * pull * alpha;
    n.vy += (cy - n.y) * pull * alpha;
    n.vx *= 0.8;
    n.vy *= 0.8;
    n.x += Math.max(-22, Math.min(22, n.vx));
    n.y += Math.max(-22, Math.min(22, n.vy));
  }

  sim.alpha = sim.draggingNode ? Math.max(sim.alpha, 0.25) : sim.alpha * 0.968;
}

export const KnowledgeGraphView: React.FC<KnowledgeGraphViewProps> = ({
  state,
  initialFocusNodeId = null,
  compact = false,
  onOpenFullGraph,
  onOpenNoteById,
  onInsertLink,
}) => {
  const [enabledKinds, setEnabledKinds] = useState<Set<GraphNodeKind>>(
    () => new Set(ALL_KINDS.map(k => k.id)),
  );
  const [enabledEdges, setEnabledEdges] = useState<Set<GraphEdgeKind>>(
    () => new Set(ALL_EDGES.map(e => e.id)),
  );
  const [includeOrphans, setIncludeOrphans] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [focusNodeId, setFocusNodeId] = useState<string | null>(initialFocusNodeId);
  const [focusDepth, setFocusDepth] = useState<1 | 2 | "all">(compact ? 1 : "all");
  const [selectedId, setSelectedId] = useState<string | null>(initialFocusNodeId);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoomUi, setZoomUi] = useState(1);
  const [layoutSeed, setLayoutSeed] = useState(0);

  useEffect(() => {
    setFocusNodeId(initialFocusNodeId);
    setSelectedId(initialFocusNodeId);
    if (compact) setFocusDepth(1);
  }, [initialFocusNodeId, compact]);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: compact ? 300 : 920, height: compact ? 216 : 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 40 && rect.height > 40) {
        setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graph = useMemo(
    () =>
      buildKnowledgeGraph(state, {
        enabledKinds,
        enabledEdges,
        includeOrphans: compact ? false : includeOrphans,
        focusNodeId: focusDepth === "all" ? null : focusNodeId,
        focusDepth,
        width: size.width,
        height: size.height,
      }),
    [state, enabledKinds, enabledEdges, includeOrphans, compact, focusNodeId, focusDepth, size.width, size.height, layoutSeed],
  );

  // Live simulation refs (60fps without React re-renders per frame)
  const simRef = useRef<SimState>({
    nodes: [],
    edges: [],
    nodeById: new Map(),
    neighbors: new Map(),
    alpha: 1,
    cam: { x: 0, y: 0, k: 1 },
    draggingNode: null,
    panning: null,
  });

  const interactiveRef = useRef({ selectedId, hoveredId, searchQuery, focusNodeId });
  interactiveRef.current = { selectedId, hoveredId, searchQuery, focusNodeId };

  const fitCamera = () => {
    const { nodes } = simRef.current;
    if (!nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - 56);
      maxX = Math.max(maxX, n.x + 56);
      minY = Math.min(minY, n.y - 34);
      maxY = Math.max(maxY, n.y + 42);
    }
    const spanX = Math.max(140, maxX - minX);
    const spanY = Math.max(120, maxY - minY);
    const pad = compact ? 0.84 : 0.86;
    const k = Math.max(0.32, Math.min(compact ? 1.25 : 1.45, Math.min((size.width * pad) / spanX, (size.height * pad) / spanY)));
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    simRef.current.cam = {
      k,
      x: size.width / 2 - midX * k,
      y: size.height / 2 - midY * k,
    };
    setZoomUi(k);
  };

  // Reset and pre-warm physics cleanly when graph topology updates, then auto-frame the layout
  useEffect(() => {
    const prevMap = simRef.current.nodeById;
    const nodes: GraphNode[] = graph.nodes.map(n => {
      const prev = prevMap.get(n.id);
      return prev && layoutSeed === 0
        ? { ...n, x: prev.x, y: prev.y, vx: prev.vx * 0.4, vy: prev.vy * 0.4 }
        : { ...n };
    });
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const neighbors = new Map<string, Set<string>>();
    for (const n of nodes) neighbors.set(n.id, new Set());
    for (const e of graph.edges) {
      neighbors.get(e.source)?.add(e.target);
      neighbors.get(e.target)?.add(e.source);
    }
    simRef.current.nodes = nodes;
    simRef.current.edges = graph.edges;
    simRef.current.nodeById = nodeById;
    simRef.current.neighbors = neighbors;
    simRef.current.alpha = 1;

    // Pre-settle synchronously so nodes never open bunched together in the center
    const warmTicks = nodes.length > 0 ? 85 : 0;
    for (let i = 0; i < warmTicks; i++) {
      stepSimulation(simRef.current, size.width, size.height, compact, focusNodeId);
    }
    fitCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, layoutSeed]);

  // Re-fit gently on container resize
  useEffect(() => {
    if (simRef.current.nodes.length) fitCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, size.width, size.height]);

  // Physics + Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let palette = readThemePalette();
    const observer = new MutationObserver(() => { palette = readThemePalette(); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const renderFrame = () => {
      stepSimulation(simRef.current, size.width, size.height, compact, interactiveRef.current.focusNodeId);

      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(size.width * dpr);
      const targetH = Math.round(size.height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      const { nodes, edges, nodeById, neighbors, cam } = simRef.current;
      const { selectedId: selId, hoveredId: hovId, searchQuery: sq, focusNodeId: focId } = interactiveRef.current;
      const spotlightId = hovId || selId || (compact ? focId : null);
      const spotlightSet = spotlightId ? neighbors.get(spotlightId) : undefined;
      const searchNorm = sq.trim().toLowerCase();

      // Architectural dot grid in world space
      const step = 28 * cam.k;
      if (step >= 10) {
        const offX = ((cam.x % step) + step) % step;
        const offY = ((cam.y % step) + step) % step;
        ctx.fillStyle = palette.gridDot;
        for (let x = offX; x < size.width; x += step) {
          for (let y = offY; y < size.height; y += step) {
            ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
          }
        }
      }

      ctx.translate(cam.x, cam.y);
      ctx.scale(cam.k, cam.k);

      // 1. Draw curved edges
      for (const e of edges) {
        const a = nodeById.get(e.source);
        const b = nodeById.get(e.target);
        if (!a || !b) continue;

        const touchesSpotlight =
          !!spotlightId && (e.source === spotlightId || e.target === spotlightId);
        const dimmed = !!spotlightId && !touchesSpotlight;

        ctx.save();
        ctx.beginPath();
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const curveOffset = e.directed ? Math.min(20, dist * 0.1) : 0;
        const cpx = mx - (dy / dist) * curveOffset;
        const cpy = my + (dx / dist) * curveOffset;

        ctx.moveTo(a.x, a.y);
        if (curveOffset) ctx.quadraticCurveTo(cpx, cpy, b.x, b.y);
        else ctx.lineTo(b.x, b.y);

        if (e.kind === "semantic") ctx.setLineDash([4 / cam.k, 4 / cam.k]);

        if (touchesSpotlight) {
          ctx.strokeStyle = e.kind === "explicit" ? palette.accent : palette.secondary;
          ctx.globalAlpha = e.kind === "explicit" ? 0.92 : 0.72;
          ctx.lineWidth = (e.kind === "explicit" ? 1.9 : 1.35) / cam.k;
        } else if (dimmed) {
          ctx.strokeStyle = palette.muted;
          ctx.globalAlpha = 0.22;
          ctx.lineWidth = 0.9 / cam.k;
        } else {
          ctx.strokeStyle = e.kind === "explicit" ? palette.accent : palette.muted;
          ctx.globalAlpha = e.kind === "explicit" ? 0.52 : e.kind === "semantic" ? 0.34 : 0.32;
          ctx.lineWidth = (e.kind === "explicit" ? 1.4 : 1.05) / cam.k;
        }
        ctx.stroke();

        // Directional arrowhead for explicit / memory links
        if (e.directed && (!dimmed || touchesSpotlight)) {
          const t = 1 - (b.radius + 4) / dist;
          if (t > 0.25 && t < 1) {
            const ax = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cpx + t * t * b.x;
            const ay = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cpy + t * t * b.y;
            const tx = 2 * (1 - t) * (cpx - a.x) + 2 * t * (b.x - cpx);
            const ty = 2 * (1 - t) * (cpy - a.y) + 2 * t * (b.y - cpy);
            const ang = Math.atan2(ty, tx);
            const head = (touchesSpotlight ? 6.5 : 5) / Math.max(0.7, cam.k);
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - Math.cos(ang - 0.45) * head, ay - Math.sin(ang - 0.45) * head);
            ctx.lineTo(ax - Math.cos(ang + 0.45) * head, ay - Math.sin(ang + 0.45) * head);
            ctx.closePath();
            ctx.fillStyle = touchesSpotlight ? palette.accent : palette.muted;
            ctx.globalAlpha = touchesSpotlight ? 0.95 : 0.48;
            ctx.fill();
          }
        }
        ctx.restore();
      }

      // 2. Draw nodes
      for (const n of nodes) {
        const isSelected = n.id === selId;
        const isHovered = n.id === hovId;
        const isFocusedCenter = compact && n.id === focId;
        const isNeighbor = !!spotlightSet?.has(n.id);
        const matchesSearch = !!searchNorm && n.label.toLowerCase().includes(searchNorm);
        const dimmed =
          (!!spotlightId && !isSelected && !isHovered && !isFocusedCenter && !isNeighbor) ||
          (!!searchNorm && !matchesSearch);

        const color = palette.kinds[n.kind] || palette.accent;
        const r = n.radius;

        ctx.save();
        ctx.globalAlpha = dimmed ? 0.38 : 1;

        // Subtle focus ring
        if (isSelected || isHovered || isFocusedCenter || matchesSearch) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 4.5 / Math.max(0.8, cam.k), 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.globalAlpha = dimmed ? 0.08 : 0.16;
          ctx.fill();
          ctx.globalAlpha = dimmed ? 0.18 : 1;
        }

        if (n.kind === "tag") {
          // Diamond-rounded tag badge
          const s = r * 1.45;
          drawRoundedRect(ctx, n.x - s / 2, n.y - s / 2, s, s, 3);
          ctx.fillStyle = palette.panel;
          ctx.fill();
          ctx.lineWidth = 1.5 / Math.max(0.75, cam.k);
          ctx.strokeStyle = color;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
          ctx.fillStyle = isSelected || isFocusedCenter ? color : palette.panel;
          ctx.fill();
          ctx.lineWidth = (isSelected || isHovered ? 2.2 : 1.6) / Math.max(0.75, cam.k);
          ctx.strokeStyle = color;
          ctx.stroke();

          if (!isSelected && !isFocusedCenter) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, Math.max(2.6, r * 0.44), 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
          }
        }
        ctx.restore();
      }

      // 3. Draw crisp level-of-detail node labels with collision avoidance
      const fontSize = Math.max(10, Math.min(12.5, 11.2 / Math.pow(cam.k, 0.32)));
      ctx.font = `500 ${fontSize}px Geist, -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      const priorityOf = (n: GraphNode) =>
        (n.id === selId || n.id === hovId ? 1000 : 0) +
        (compact && n.id === focId ? 900 : 0) +
        (spotlightSet?.has(n.id) ? 500 : 0) +
        (searchNorm && n.label.toLowerCase().includes(searchNorm) ? 400 : 0) +
        n.degree * 10;

      const labelOrder = [...nodes].sort((a, b) => priorityOf(b) - priorityOf(a));
      const drawnBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

      for (const n of labelOrder) {
        const isSelected = n.id === selId;
        const isHovered = n.id === hovId;
        const isFocusedCenter = compact && n.id === focId;
        const isNeighbor = !!spotlightSet?.has(n.id);
        const matchesSearch = !!searchNorm && n.label.toLowerCase().includes(searchNorm);
        const mustShow = isSelected || isHovered || isFocusedCenter || matchesSearch;

        const showLabel =
          mustShow ||
          isNeighbor ||
          (compact && nodes.length <= 16) ||
          (!spotlightId && (cam.k >= 0.68 && (n.degree >= 1 || n.kind === "knowledge" || n.kind === "course"))) ||
          cam.k >= 1.2;

        if (!showLabel) continue;
        const dimmed =
          (!!spotlightId && !isSelected && !isHovered && !isFocusedCenter && !isNeighbor) ||
          (!!searchNorm && !matchesSearch);

        const maxChars = compact ? 18 : 26;
        const label = n.label.length > maxChars ? `${n.label.slice(0, maxChars - 1)}…` : n.label;
        const yPos = n.y + n.radius + 5;
        const metrics = ctx.measureText(label);
        const padX = 5;
        const boxW = metrics.width + padX * 2;
        const boxH = fontSize + 5;
        const box = { x1: n.x - boxW / 2, y1: yPos - 1, x2: n.x + boxW / 2, y2: yPos - 1 + boxH };

        if (!mustShow) {
          const hitsBox = drawnBoxes.some(b => !(box.x2 + 3 < b.x1 || box.x1 - 3 > b.x2 || box.y2 + 2 < b.y1 || box.y1 - 2 > b.y2));
          const hitsNode = nodes.some(other =>
            other.id !== n.id &&
            other.x + other.radius + 2 > box.x1 &&
            other.x - other.radius - 2 < box.x2 &&
            other.y + other.radius + 2 > box.y1 &&
            other.y - other.radius - 2 < box.y2,
          );
          if (hitsBox || hitsNode) continue;
        }
        drawnBoxes.push(box);

        ctx.save();
        ctx.globalAlpha = dimmed ? 0.42 : isSelected || isHovered ? 0.98 : 0.92;
        drawRoundedRect(ctx, box.x1, box.y1, boxW, boxH, 4);
        ctx.fillStyle = isSelected || isHovered ? palette.panel : palette.bg;
        ctx.fill();
        if (isSelected || isHovered) {
          ctx.lineWidth = 1 / Math.max(0.8, cam.k);
          ctx.strokeStyle = palette.line;
          ctx.stroke();
        }
        ctx.fillStyle = isSelected || isHovered ? palette.ink : palette.secondary;
        ctx.fillText(label, n.x, yPos + 1.5);
        ctx.restore();
      }

      ctx.restore();
      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [size.width, size.height, compact]);

  // Pointer hit-testing in world coordinates
  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const { cam } = simRef.current;
    return { wx: (sx - cam.x) / cam.k, wy: (sy - cam.y) / cam.k, sx, sy };
  };

  const hitTestNode = (wx: number, wy: number): GraphNode | null => {
    const { nodes, cam } = simRef.current;
    const slop = 7 / cam.k;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dist = Math.hypot(wx - n.x, wy - n.y);
      if (dist <= n.radius + slop) return n;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { wx, wy, sx, sy } = toWorld(e.clientX, e.clientY);
    const hit = hitTestNode(wx, wy);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (hit) {
      simRef.current.draggingNode = hit;
      simRef.current.panning = { startX: sx, startY: sy, camX: simRef.current.cam.x, camY: simRef.current.cam.y, moved: false };
      simRef.current.alpha = Math.max(simRef.current.alpha, 0.35);
    } else {
      simRef.current.panning = { startX: sx, startY: sy, camX: simRef.current.cam.x, camY: simRef.current.cam.y, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { wx, wy, sx, sy } = toWorld(e.clientX, e.clientY);
    const sim = simRef.current;
    if (sim.draggingNode) {
      if (sim.panning && (Math.abs(sx - sim.panning.startX) > 3 || Math.abs(sy - sim.panning.startY) > 3)) {
        sim.panning.moved = true;
      }
      sim.draggingNode.x = wx;
      sim.draggingNode.y = wy;
      sim.draggingNode.vx = 0;
      sim.draggingNode.vy = 0;
      return;
    }
    if (sim.panning) {
      const dx = sx - sim.panning.startX;
      const dy = sy - sim.panning.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) sim.panning.moved = true;
      sim.cam.x = sim.panning.camX + dx;
      sim.cam.y = sim.panning.camY + dy;
      return;
    }
    const hit = hitTestNode(wx, wy);
    const nextHover = hit?.id || null;
    if (nextHover !== hoveredId) setHoveredId(nextHover);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const sim = simRef.current;
    const wasClick = sim.panning && !sim.panning.moved;
    const dragged = sim.draggingNode;
    sim.draggingNode = null;
    sim.panning = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (wasClick) {
      if (dragged) {
        setSelectedId(dragged.id);
        if (compact && dragged.id !== focusNodeId) {
          openNodeRecord(dragged);
        }
      } else if (!compact) {
        setSelectedId(null);
      }
    }
  };

  const zoomAt = (factor: number, originX = size.width / 2, originY = size.height / 2) => {
    const { cam } = simRef.current;
    const nextK = Math.max(0.28, Math.min(2.6, cam.k * factor));
    const scale = nextK / cam.k;
    cam.x = originX - (originX - cam.x) * scale;
    cam.y = originY - (originY - cam.y) * scale;
    cam.k = nextK;
    setZoomUi(nextK);
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.09 : 0.91;
    zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
  };

  const openNodeRecord = (node: GraphNode) => {
    if (node.kind === "knowledge") {
      if (onOpenNoteById) onOpenNoteById(node.recordId);
      else navigateToRecord("knowledge", node.recordId, node.label, state);
      return;
    }
    if (node.kind === "memory") {
      window.dispatchEvent(new CustomEvent("synapse-open-memory", { detail: { id: node.recordId } }));
      return;
    }
    if (node.kind === "tag") {
      setSearchQuery(node.label.replace(/^#/, ""));
      return;
    }
    navigateToRecord(node.kind as LinkTargetType, node.recordId, node.label, state);
  };

  const toggleKind = (kind: GraphNodeKind) =>
    setEnabledKinds(prev => {
      const next = new Set(prev);
      if (next.has(kind) && next.size > 1) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const toggleEdge = (edgeKind: GraphEdgeKind) =>
    setEnabledEdges(prev => {
      const next = new Set(prev);
      if (next.has(edgeKind) && next.size > 1) next.delete(edgeKind);
      else next.add(edgeKind);
      return next;
    });

  const selectedNode = useMemo(
    () => graph.nodes.find(n => n.id === selectedId) || null,
    [graph.nodes, selectedId],
  );

  const selectedNeighbors = useMemo(() => {
    if (!selectedNode) return [];
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    const list: Array<{ node: GraphNode; edge: GraphEdge; direction: "out" | "in" | "peer" }> = [];
    for (const e of graph.edges) {
      if (e.source === selectedNode.id && byId.has(e.target)) {
        list.push({ node: byId.get(e.target)!, edge: e, direction: e.directed ? "out" : "peer" });
      } else if (e.target === selectedNode.id && byId.has(e.source)) {
        list.push({ node: byId.get(e.source)!, edge: e, direction: e.directed ? "in" : "peer" });
      }
    }
    return list.sort((a, b) => b.edge.weight - a.edge.weight);
  }, [selectedNode, graph.nodes, graph.edges]);

  const jumpToSearchMatch = (value: string) => {
    setSearchQuery(value);
    const q = value.trim().toLowerCase();
    if (!q) return;
    const match = simRef.current.nodes.find(n => n.label.toLowerCase().includes(q));
    if (match) {
      setSelectedId(match.id);
      simRef.current.cam = {
        ...simRef.current.cam,
        x: size.width / 2 - match.x * simRef.current.cam.k,
        y: size.height / 2 - match.y * simRef.current.cam.k,
      };
    }
  };

  if (compact) {
    return (
      <div className="nx-graph-mini">
        <div className="nx-graph-mini-head">
          <div className="nx-graph-mini-title">
            <Network size={13} />
            <span>Local graph</span>
            <em>{Math.max(0, graph.nodes.length - 1)} connected</em>
          </div>
          {onOpenFullGraph && (
            <button type="button" className="nx-graph-mini-expand" onClick={() => onOpenFullGraph(focusNodeId || undefined)}>
              <Maximize2 size={12} /> Full graph
            </button>
          )}
        </div>
        <div ref={containerRef} className="nx-graph-mini-canvas">
          {graph.nodes.length > 1 ? (
            <canvas
              ref={canvasRef}
              style={{ width: "100%", height: "100%", cursor: hoveredId ? "pointer" : "grab" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onWheel={onWheel}
            />
          ) : (
            <div className="nx-graph-mini-empty">
              <Compass size={16} />
              <span>Add [[links]], @mentions, or #tags to connect this note.</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="nx-graph-shell" aria-label="Knowledge Graph">
      {/* Top toolbar */}
      <div className="nx-graph-bar">
        <label className="nx-graph-search">
          <Search size={14} />
          <input
            type="search"
            placeholder="Find node in graph…"
            value={searchQuery}
            onChange={e => jumpToSearchMatch(e.target.value)}
          />
          {searchQuery && (
            <button type="button" aria-label="Clear search" onClick={() => setSearchQuery("")}>
              <X size={13} />
            </button>
          )}
        </label>

        <div className="nx-graph-depth" role="group" aria-label="Graph scope">
          {([
            ["all", "All"],
            [2, "2-hop"],
            [1, "1-hop"],
          ] as const).map(([depth, label]) => (
            <button
              key={String(depth)}
              type="button"
              disabled={depth !== "all" && !focusNodeId}
              aria-pressed={focusDepth === depth}
              onClick={() => setFocusDepth(depth)}
              title={depth === "all" ? "Show entire graph" : "Show neighborhood around selected node"}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`nx-graph-pill ${includeOrphans ? "is-on" : ""}`}
          onClick={() => setIncludeOrphans(v => !v)}
          title="Include records that don't have links yet"
        >
          {includeOrphans ? <Eye size={13} /> : <EyeOff size={13} />}
          <span>Unlinked</span>
        </button>

        <div className="nx-graph-stats">
          <span>{graph.nodes.length} nodes</span>
          <span>·</span>
          <span>{graph.edges.length} connections</span>
        </div>
      </div>

      {/* Filter pills row */}
      <div className="nx-graph-filters">
        <div className="nx-graph-filter-group" aria-label="Node types">
          {ALL_KINDS.map(k => (
            <button
              key={k.id}
              type="button"
              className={`nx-graph-chip ${enabledKinds.has(k.id) ? "is-on" : ""}`}
              onClick={() => toggleKind(k.id)}
            >
              <span className={`nx-gdot nx-gdot-${k.id}`} />
              <span>{k.label}</span>
            </button>
          ))}
        </div>
        <div className="nx-graph-filter-group" aria-label="Connection layers">
          {ALL_EDGES.map(e => (
            <button
              key={e.id}
              type="button"
              className={`nx-graph-edge-chip ${enabledEdges.has(e.id) ? "is-on" : ""}`}
              onClick={() => toggleEdge(e.id)}
            >
              <span className={`nx-eline is-${e.style}`} />
              <span>{e.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Canvas + Inspector */}
      <div className={`nx-graph-stage ${selectedNode ? "has-inspector" : ""}`}>
        <div ref={containerRef} className="nx-graph-canvas-wrap">
          {graph.nodes.length > 0 ? (
            <canvas
              ref={canvasRef}
              style={{ width: "100%", height: "100%", cursor: hoveredId ? "pointer" : "grab" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onWheel={onWheel}
            />
          ) : (
            <div className="nx-graph-empty">
              <Network size={26} strokeWidth={1.3} />
              <h3>Your knowledge graph starts here</h3>
              <p>Create notes, tag them, or link records with [[ and @ to watch your connections grow.</p>
            </div>
          )}

          {/* Bottom-left zoom & layout controls */}
          <div className="nx-graph-controls">
            <button type="button" aria-label="Zoom out" onClick={() => zoomAt(0.84)}><Minus size={14} /></button>
            <span>{Math.round(zoomUi * 100)}%</span>
            <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.18)}><Plus size={14} /></button>
            <button type="button" onClick={fitCamera} title="Fit graph to view">Fit</button>
            <button type="button" onClick={() => setLayoutSeed(s => s + 1)} title="Re-run layout"><RefreshCw size={13} /></button>
          </div>

          {focusNodeId && focusDepth !== "all" && (
            <div className="nx-graph-focus-banner">
              <span>Focused on <strong>{graph.nodes.find(n => n.id === focusNodeId)?.label || "node"}</strong></span>
              <button type="button" onClick={() => { setFocusDepth("all"); setFocusNodeId(null); }}>Show all</button>
            </div>
          )}
        </div>

        {/* Selected Node Inspector */}
        {selectedNode && (
          <aside className="nx-graph-inspector" aria-label="Selected node details">
            <div className="nx-insp-head">
              <span className={`nx-insp-badge nx-type-${selectedNode.kind}`}>
                {selectedNode.kind === "tag" ? <Tag size={12} /> : selectedNode.kind === "memory" ? <Sparkles size={12} /> : <RecordTypeIcon type={selectedNode.kind as LinkTargetType} subkind={selectedNode.subkind} size={12} />}
                <span>{selectedNode.subkind === "job_application" ? "Job App" : selectedNode.subkind === "leetcode" ? "LeetCode" : selectedNode.kind === "knowledge" ? "Note" : selectedNode.kind}</span>
              </span>
              <button type="button" className="nx-icon-btn" aria-label="Close inspector" onClick={() => setSelectedId(null)}>
                <X size={14} />
              </button>
            </div>

            <h3>{selectedNode.label}</h3>
            {selectedNode.subtitle && <p className="nx-insp-sub">{selectedNode.subtitle}</p>}
            {selectedNode.excerpt && <p className="nx-insp-excerpt">{selectedNode.excerpt}</p>}

            <div className="nx-insp-actions">
              {selectedNode.kind !== "tag" && (
                <button type="button" className="nx-btn nx-btn-primary" onClick={() => openNodeRecord(selectedNode)}>
                  Open <ArrowUpRight size={13} />
                </button>
              )}
              <button
                type="button"
                className="nx-btn"
                onClick={() => {
                  setFocusNodeId(selectedNode.id);
                  setFocusDepth(focusDepth === 1 && focusNodeId === selectedNode.id ? "all" : 1);
                }}
              >
                <Compass size={13} />
                <span>{focusDepth === 1 && focusNodeId === selectedNode.id ? "Show full" : "Focus 1-hop"}</span>
              </button>
              {onInsertLink && selectedNode.kind !== "tag" && selectedNode.kind !== "memory" && (
                <button type="button" className="nx-btn" onClick={() => onInsertLink(selectedNode)}>
                  Insert link
                </button>
              )}
            </div>

            <div className="nx-insp-links">
              <h4>Connections ({selectedNeighbors.length})</h4>
              {selectedNeighbors.length > 0 ? (
                <ul>
                  {selectedNeighbors.map(({ node, edge, direction }) => (
                    <li key={`${edge.id}:${node.id}`}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(node.id)}
                        onDoubleClick={() => openNodeRecord(node)}
                      >
                        <span className={`nx-gdot nx-gdot-${node.kind}`} />
                        <span className="nx-insp-link-title">{node.label}</span>
                        <small>
                          {edge.kind === "explicit"
                            ? direction === "out"
                              ? "links to"
                              : "linked by"
                            : edge.label || edge.kind}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="nx-insp-empty">No connections match the active filters.</p>
              )}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
};

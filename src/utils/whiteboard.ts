import { getStroke } from "perfect-freehand";
import type {
  WhiteboardBackground,
  WhiteboardElement,
  WhiteboardPoint,
  WhiteboardScene,
  WhiteboardTheme,
} from "../types";
import { canvasBlob } from "./noteImages";

export const WHITEBOARD_ALT_PREFIX = "wb:";
export const WHITEBOARD_BLANK_SRC = "synapse-wb:blank";

export interface WhiteboardCamera {
  x: number;
  y: number;
  zoom: number;
}

export function createWhiteboardId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `wb-${crypto.randomUUID().slice(0, 12)}`;
  }
  return `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyWhiteboardScene(
  theme: WhiteboardTheme = "light",
  title = "Whiteboard",
): WhiteboardScene {
  return {
    version: 1,
    title,
    theme,
    background: "dots",
    elements: [],
    camera: { x: 0, y: 0, zoom: 1 },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Parses Markdown image alt text for a whiteboard block:
 * `wb:<boardId>` or `wb:<boardId>|<title>` or `wb:<boardId>|<title>|<width>`.
 */
export function parseWhiteboardAlt(
  alt: string | null | undefined,
): { boardId: string; title: string; width: number | null } | null {
  if (!alt || !alt.startsWith(WHITEBOARD_ALT_PREFIX)) return null;
  const parts = alt.slice(WHITEBOARD_ALT_PREFIX.length).split("|");
  const boardId = (parts[0] || "").trim();
  if (!boardId) return null;
  let title = "Whiteboard";
  let width: number | null = null;
  if (parts.length === 2) {
    if (/^\d{2,4}$/.test(parts[1])) width = Number(parts[1]);
    else if (parts[1].trim()) title = parts[1].trim();
  } else if (parts.length >= 3) {
    const maybeWidth = parts[parts.length - 1];
    if (/^\d{2,4}$/.test(maybeWidth)) {
      width = Number(maybeWidth);
      title = parts.slice(1, -1).join(" ").trim() || "Whiteboard";
    } else {
      title = parts.slice(1).join(" ").trim() || "Whiteboard";
    }
  }
  return { boardId, title, width };
}

export function formatWhiteboardAlt(
  boardId: string,
  title?: string | null,
  width?: number | null,
): string {
  const cleanId = boardId.replace(/[[\]|]/g, "").trim();
  const cleanTitle = (title || "Whiteboard").replace(/[[\]|]/g, "").trim() || "Whiteboard";
  return `${WHITEBOARD_ALT_PREFIX}${cleanId}|${cleanTitle}${width ? `|${Math.round(width)}` : ""}`;
}

export function extractWhiteboardIds(markdown: string): string[] {
  if (!markdown) return [];
  const ids = new Set<string>();
  const pattern = /!\[wb:([^\]|\s)]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown))) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Removes near-duplicate sub-pixel points and rounds values so saved stroke JSON stays compact. */
export function compactStrokePoints(points: WhiteboardPoint[], minDist = 0.7): WhiteboardPoint[] {
  if (points.length <= 2) {
    return points.map(([x, y, p]) => [round1(x), round1(y), round2(p)]);
  }
  const out: WhiteboardPoint[] = [[round1(points[0][0]), round1(points[0][1]), round2(points[0][2])]];
  let lastX = points[0][0];
  let lastY = points[0][1];
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y, p] = points[i];
    if (Math.hypot(x - lastX, y - lastY) >= minDist) {
      out.push([round1(x), round1(y), round2(p)]);
      lastX = x;
      lastY = y;
    }
  }
  const last = points[points.length - 1];
  out.push([round1(last[0]), round1(last[1]), round2(last[2])]);
  return out;
}

function traceSmoothPolygon(ctx: CanvasRenderingContext2D, pts: number[][]) {
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 1) {
    ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
  } else {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
  }
  ctx.closePath();
}

export function drawWhiteboardElement(
  ctx: CanvasRenderingContext2D,
  el: WhiteboardElement,
  isLive = false,
) {
  ctx.save();
  if ("points" in el) {
    if (!el.points.length) {
      ctx.restore();
      return;
    }
    const isHighlighter = el.kind === "highlighter";
    ctx.fillStyle = el.color;
    ctx.strokeStyle = el.color;
    if (isHighlighter) {
      ctx.globalAlpha = 0.32;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = el.size * 3.2;
      ctx.beginPath();
      ctx.moveTo(el.points[0][0], el.points[0][1]);
      if (el.points.length === 1) {
        ctx.lineTo(el.points[0][0] + 0.1, el.points[0][1]);
      } else {
        for (let i = 1; i < el.points.length - 1; i++) {
          const [x0, y0] = el.points[i];
          const [x1, y1] = el.points[i + 1];
          ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        }
        const last = el.points[el.points.length - 1];
        ctx.lineTo(last[0], last[1]);
      }
      ctx.stroke();
    } else {
      const outline = getStroke(el.points, {
        size: el.size,
        thinning: el.simulatePressure === false ? 0.58 : 0.48,
        smoothing: 0.5,
        streamline: 0.45,
        simulatePressure: el.simulatePressure ?? false,
        last: !isLive,
      });
      traceSmoothPolygon(ctx, outline);
      ctx.fill();
    }
  } else if ("text" in el) {
    ctx.fillStyle = el.color;
    const fontSize = Math.max(14, el.size * 3.8);
    ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = "top";
    const lines = el.text.split("\n");
    const lineH = fontSize * 1.3;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], el.at[0], el.at[1] + i * lineH);
    }
  } else {
    const [x1, y1] = el.a;
    const [x2, y2] = el.b;
    ctx.strokeStyle = el.color;
    ctx.lineWidth = el.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (el.kind === "rect") {
      ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (el.kind === "ellipse") {
      ctx.ellipse(
        (x1 + x2) / 2,
        (y1 + y2) / 2,
        Math.abs(x2 - x1) / 2,
        Math.abs(y2 - y1) / 2,
        0,
        0,
        Math.PI * 2,
      );
    } else if (el.kind === "line") {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    } else {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(11, el.size * 3.6);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45));
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function paperColors(theme: WhiteboardTheme) {
  return theme === "dark"
    ? { bg: "#111622", pattern: "rgba(148, 163, 184, 0.16)", defaultInk: "#f8fafc" }
    : { bg: "#fdfcf9", pattern: "rgba(15, 23, 42, 0.12)", defaultInk: "#0f172a" };
}

export function drawWhiteboardBackground(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  camera: WhiteboardCamera,
  background: WhiteboardBackground,
  theme: WhiteboardTheme,
) {
  const { bg, pattern } = paperColors(theme);
  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  if (background === "blank") {
    ctx.restore();
    return;
  }

  let step = 28;
  while (step * camera.zoom < 14) step *= 2;
  while (step * camera.zoom > 64) step /= 2;

  const worldLeft = -camera.x / camera.zoom;
  const worldTop = -camera.y / camera.zoom;
  const worldRight = worldLeft + cssWidth / camera.zoom;
  const worldBottom = worldTop + cssHeight / camera.zoom;

  const startX = Math.floor(worldLeft / step) * step;
  const startY = Math.floor(worldTop / step) * step;

  ctx.fillStyle = pattern;
  ctx.strokeStyle = pattern;
  ctx.lineWidth = 1;

  if (background === "dots") {
    const r = Math.max(0.9, Math.min(1.8, 1.2 * Math.sqrt(camera.zoom)));
    for (let wx = startX; wx <= worldRight; wx += step) {
      const sx = wx * camera.zoom + camera.x;
      for (let wy = startY; wy <= worldBottom; wy += step) {
        const sy = wy * camera.zoom + camera.y;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (background === "grid") {
    ctx.beginPath();
    for (let wx = startX; wx <= worldRight; wx += step) {
      const sx = Math.round(wx * camera.zoom + camera.x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, cssHeight);
    }
    for (let wy = startY; wy <= worldBottom; wy += step) {
      const sy = Math.round(wy * camera.zoom + camera.y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(cssWidth, sy);
    }
    ctx.stroke();
  } else if (background === "lined") {
    ctx.beginPath();
    for (let wy = startY; wy <= worldBottom; wy += step) {
      const sy = Math.round(wy * camera.zoom + camera.y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(cssWidth, sy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function segmentDistance(
  [px, py]: [number, number],
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function hitTestWhiteboardElement(
  ctx: CanvasRenderingContext2D | null,
  el: WhiteboardElement,
  p: [number, number],
  slack: number,
): boolean {
  const reach = slack + (el.kind === "highlighter" ? el.size * 1.6 : el.size / 2);
  if ("points" in el) {
    for (let i = 0; i < el.points.length; i++) {
      const prev = el.points[Math.max(0, i - 1)];
      const cur = el.points[i];
      if (segmentDistance(p, [prev[0], prev[1]], [cur[0], cur[1]]) <= reach) return true;
    }
    return false;
  }
  if (el.kind === "line" || el.kind === "arrow") {
    return segmentDistance(p, el.a, el.b) <= reach;
  }
  if ("text" in el) {
    const fontSize = Math.max(14, el.size * 3.8);
    const lines = el.text.split("\n");
    const lineH = fontSize * 1.3;
    let width = fontSize * 2;
    if (ctx) {
      ctx.save();
      ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
      width = Math.max(...lines.map(l => ctx.measureText(l).width), 16);
      ctx.restore();
    }
    const height = lines.length * lineH;
    return (
      p[0] >= el.at[0] - slack &&
      p[0] <= el.at[0] + width + slack &&
      p[1] >= el.at[1] - slack &&
      p[1] <= el.at[1] + height + slack
    );
  }
  const x = Math.min(el.a[0], el.b[0]);
  const y = Math.min(el.a[1], el.b[1]);
  const w = Math.abs(el.b[0] - el.a[0]);
  const h = Math.abs(el.b[1] - el.a[1]);
  if (el.kind === "rect") {
    const inside = p[0] >= x - reach && p[0] <= x + w + reach && p[1] >= y - reach && p[1] <= y + h + reach;
    const deep = p[0] > x + reach && p[0] < x + w - reach && p[1] > y + reach && p[1] < y + h - reach;
    return inside && !deep;
  }
  const rx = w / 2 || 1;
  const ry = h / 2 || 1;
  const nx = (p[0] - x - rx) / rx;
  const ny = (p[1] - y - ry) / ry;
  return Math.abs(Math.hypot(nx, ny) - 1) * Math.min(rx, ry) <= reach;
}

export function computeWhiteboardBounds(
  elements: WhiteboardElement[],
  ctx?: CanvasRenderingContext2D | null,
): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null {
  if (!elements.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const include = (x: number, y: number, pad = 0) => {
    if (x - pad < minX) minX = x - pad;
    if (y - pad < minY) minY = y - pad;
    if (x + pad > maxX) maxX = x + pad;
    if (y + pad > maxY) maxY = y + pad;
  };

  for (const el of elements) {
    if ("points" in el) {
      const pad = el.kind === "highlighter" ? el.size * 1.8 : el.size;
      for (const pt of el.points) include(pt[0], pt[1], pad);
    } else if ("text" in el) {
      const fontSize = Math.max(14, el.size * 3.8);
      const lines = el.text.split("\n");
      let w = Math.max(...lines.map(l => l.length * fontSize * 0.6), fontSize);
      if (ctx) {
        ctx.save();
        ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
        w = Math.max(...lines.map(l => ctx.measureText(l).width), 16);
        ctx.restore();
      }
      include(el.at[0], el.at[1], 4);
      include(el.at[0] + w, el.at[1] + lines.length * fontSize * 1.3, 4);
    } else {
      const pad = Math.max(el.size, el.kind === "arrow" ? 16 : 4);
      include(el.a[0], el.a[1], pad);
      include(el.b[0], el.b[1], pad);
    }
  }

  if (!Number.isFinite(minX)) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/** Renders a crisp cropped preview image of the whiteboard scene for inline note display and Markdown export. */
export async function renderWhiteboardPreviewBlob(scene: WhiteboardScene): Promise<Blob | null> {
  if (!scene.elements.length || typeof document === "undefined") return null;
  const probe = document.createElement("canvas");
  const probeCtx = probe.getContext("2d");
  const bounds = computeWhiteboardBounds(scene.elements, probeCtx);
  if (!bounds) return null;

  const pad = 36;
  const rawW = Math.max(320, bounds.width + pad * 2);
  const rawH = Math.max(180, bounds.height + pad * 2);
  const maxEdge = 1400;
  const scale = Math.min(2, maxEdge / Math.max(rawW, rawH));

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(rawW * scale));
  out.height = Math.max(1, Math.round(rawH * scale));
  const ctx = out.getContext("2d");
  if (!ctx) return null;

  const cssW = out.width / scale;
  const cssH = out.height / scale;
  const offsetX = (cssW - bounds.width) / 2 - bounds.minX;
  const offsetY = (cssH - bounds.height) / 2 - bounds.minY;

  ctx.scale(scale, scale);
  drawWhiteboardBackground(ctx, cssW, cssH, { x: offsetX, y: offsetY, zoom: 1 }, scene.background, scene.theme);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  for (const el of scene.elements) drawWhiteboardElement(ctx, el, false);
  ctx.restore();

  return canvasBlob(out, true);
}

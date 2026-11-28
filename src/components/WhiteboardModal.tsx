import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Check,
  Circle,
  Eraser,
  Grid3X3,
  Hand,
  Highlighter,
  Loader2,
  Maximize,
  Minus,
  Moon,
  Pen,
  PenTool,
  Redo2,
  Square,
  Sun,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  WhiteboardBackground,
  WhiteboardElement,
  WhiteboardPoint,
  WhiteboardScene,
  WhiteboardTheme,
} from "../types";
import {
  compactStrokePoints,
  computeWhiteboardBounds,
  drawWhiteboardBackground,
  drawWhiteboardElement,
  hitTestWhiteboardElement,
  paperColors,
  renderWhiteboardPreviewBlob,
  type WhiteboardCamera,
} from "../utils/whiteboard";

type Tool = "pen" | "highlighter" | "eraser" | "line" | "arrow" | "rect" | "ellipse" | "text" | "hand";

const LIGHT_COLORS = ["#0f172a", "#ef4444", "#f97316", "#eab308", "#16a34a", "#2563eb", "#9333ea", "#ec4899"];
const DARK_COLORS = ["#f8fafc", "#f87171", "#fb923c", "#facc15", "#4ade80", "#60a5fa", "#c084fc", "#f472b6"];
const SIZES = [2.5, 5, 9, 15];
const BACKGROUNDS: Array<{ id: WhiteboardBackground; label: string }> = [
  { id: "dots", label: "Dots" },
  { id: "grid", label: "Grid" },
  { id: "lined", label: "Lined" },
  { id: "blank", label: "Blank" },
];
const TOOLS: Array<{ id: Tool; label: string; key: string; Icon: typeof Pen }> = [
  { id: "pen", label: "Pen", key: "P", Icon: Pen },
  { id: "highlighter", label: "Highlighter", key: "H", Icon: Highlighter },
  { id: "eraser", label: "Eraser", key: "E", Icon: Eraser },
  { id: "line", label: "Line", key: "L", Icon: Minus },
  { id: "arrow", label: "Arrow", key: "A", Icon: ArrowUpRight },
  { id: "rect", label: "Box", key: "R", Icon: Square },
  { id: "ellipse", label: "Circle", key: "O", Icon: Circle },
  { id: "text", label: "Text", key: "T", Icon: Type },
  { id: "hand", label: "Pan", key: "V", Icon: Hand },
];

const nextElementId = () => `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const clampZoom = (z: number) => Math.min(5, Math.max(0.2, z));

interface WhiteboardModalProps {
  initialScene: WhiteboardScene;
  onSave: (scene: WhiteboardScene, previewBlob: Blob | null) => Promise<void> | void;
  onClose: () => void;
}

export const WhiteboardModal: React.FC<WhiteboardModalProps> = ({ initialScene, onSave, onClose }) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState(initialScene.title || "Whiteboard");
  const [theme, setTheme] = useState<WhiteboardTheme>(initialScene.theme || "light");
  const [background, setBackground] = useState<WhiteboardBackground>(initialScene.background || "dots");
  const [tool, setTool] = useState<Tool>("pen");
  const [sizeIndex, setSizeIndex] = useState(1);
  const [color, setColor] = useState(() => (initialScene.theme === "dark" ? DARK_COLORS[0] : LIGHT_COLORS[0]));
  const [pencilOnly, setPencilOnly] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [history, setHistory] = useState<{
    past: WhiteboardElement[][];
    present: WhiteboardElement[];
    future: WhiteboardElement[][];
  }>(() => ({
    past: [],
    present: initialScene.elements || [],
    future: [],
  }));
  const elements = history.present;
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  const [camera, setCamera] = useState<WhiteboardCamera>(() => initialScene.camera || { x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const [viewport, setViewport] = useState({ width: 800, height: 600, dpr: 1 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const [textDraft, setTextDraft] = useState<{
    world: [number, number];
    screen: [number, number];
    value: string;
  } | null>(null);

  // Active stroke / gesture state kept in refs for zero-lag frame rendering.
  const activeElementRef = useRef<WhiteboardElement | null>(null);
  const predictedPointsRef = useRef<WhiteboardPoint[]>([]);
  const drawingPointerIdRef = useRef<number | null>(null);
  const erasingPointerIdRef = useRef<number | null>(null);
  const panningPointerIdRef = useRef<number | null>(null);
  const panLastRef = useRef<{ x: number; y: number } | null>(null);
  const touchPointsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchLastRef = useRef<{ cx: number; cy: number; dist: number } | null>(null);
  const liveFrameRef = useRef(0);
  const staticFrameRef = useRef(0);

  const palette = theme === "dark" ? DARK_COLORS : LIGHT_COLORS;

  // Track stage size + Retina DPR (capped at 2 to stay crisp & lightweight on iPad).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      setViewport({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        dpr,
      });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    window.addEventListener("resize", updateSize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  // Initialize desynchronized live context when canvas mounts/resizes.
  useEffect(() => {
    const live = liveCanvasRef.current;
    const stat = staticCanvasRef.current;
    if (!live || !stat) return;
    const pw = Math.round(viewport.width * viewport.dpr);
    const ph = Math.round(viewport.height * viewport.dpr);
    if (stat.width !== pw || stat.height !== ph) {
      stat.width = pw;
      stat.height = ph;
    }
    if (live.width !== pw || live.height !== ph) {
      live.width = pw;
      live.height = ph;
    }
    liveCtxRef.current =
      (live.getContext("2d", { desynchronized: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null) ||
      live.getContext("2d");
  }, [viewport]);

  const paintStatic = useCallback(() => {
    staticFrameRef.current = 0;
    const canvas = staticCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width, height, dpr } = viewportRef.current;
    const cam = cameraRef.current;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWhiteboardBackground(ctx, width, height, cam, background, theme);
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.zoom, cam.zoom);
    for (const el of elementsRef.current) {
      drawWhiteboardElement(ctx, el, false);
    }
    ctx.restore();
  }, [background, theme]);

  const scheduleStaticPaint = useCallback(() => {
    if (!staticFrameRef.current) {
      staticFrameRef.current = requestAnimationFrame(paintStatic);
    }
  }, [paintStatic]);

  useEffect(() => {
    scheduleStaticPaint();
  }, [elements, camera, viewport, background, theme, scheduleStaticPaint]);

  const paintLive = useCallback(() => {
    liveFrameRef.current = 0;
    const canvas = liveCanvasRef.current;
    const ctx = liveCtxRef.current || canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { dpr } = viewportRef.current;
    const cam = cameraRef.current;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const active = activeElementRef.current;
    if (active) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(cam.x, cam.y);
      ctx.scale(cam.zoom, cam.zoom);
      if ((active.kind === "pen" || active.kind === "highlighter") && predictedPointsRef.current.length) {
        drawWhiteboardElement(
          ctx,
          { ...active, points: [...active.points, ...predictedPointsRef.current] },
          true,
        );
      } else {
        drawWhiteboardElement(ctx, active, true);
      }
    }
    ctx.restore();
  }, []);

  const scheduleLivePaint = useCallback(() => {
    if (!liveFrameRef.current) {
      liveFrameRef.current = requestAnimationFrame(paintLive);
    }
  }, [paintLive]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(liveFrameRef.current);
      cancelAnimationFrame(staticFrameRef.current);
    };
  }, []);

  const toStage = (clientX: number, clientY: number): [number, number] => {
    const rect = liveCanvasRef.current!.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  };

  const toWorld = (clientX: number, clientY: number): [number, number] => {
    const [sx, sy] = toStage(clientX, clientY);
    const cam = cameraRef.current;
    return [(sx - cam.x) / cam.zoom, (sy - cam.y) / cam.zoom];
  };

  const commitElements = useCallback((next: WhiteboardElement[]) => {
    elementsRef.current = next;
    setDirty(true);
    setHistory(h => ({ past: [...h.past, h.present], present: next, future: [] }));
  }, []);

  const pushElement = useCallback(
    (el: WhiteboardElement) => {
      commitElements([...elementsRef.current, el]);
    },
    [commitElements],
  );

  const undo = useCallback(() => {
    setDirty(true);
    setHistory(h =>
      h.past.length
        ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
        : h,
    );
  }, []);

  const redo = useCallback(() => {
    setDirty(true);
    setHistory(h =>
      h.future.length
        ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
        : h,
    );
  }, []);

  const eraseAt = (worldPt: [number, number]) => {
    const ctx = staticCanvasRef.current?.getContext("2d") || null;
    const list = elementsRef.current;
    const slack = 10 / cameraRef.current.zoom;
    for (let i = list.length - 1; i >= 0; i--) {
      if (hitTestWhiteboardElement(ctx, list[i], worldPt, slack)) {
        commitElements(list.filter((_, j) => j !== i));
        return;
      }
    }
  };

  const commitText = () => {
    if (textDraft?.value.trim()) {
      pushElement({
        id: nextElementId(),
        kind: "text",
        color,
        size: SIZES[sizeIndex],
        at: textDraft.world,
        text: textDraft.value.replace(/\s+$/, ""),
      });
    }
    setTextDraft(null);
  };

  const cancelActiveStroke = () => {
    activeElementRef.current = null;
    predictedPointsRef.current = [];
    drawingPointerIdRef.current = null;
    scheduleLivePaint();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Auto-enable Apple Pencil palm rejection as soon as a stylus touches the screen.
    if (e.pointerType === "pen" && !pencilOnly) {
      setPencilOnly(true);
    }

    if (e.pointerType === "touch") {
      touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointsRef.current.size >= 2) {
        // Two-finger pinch/pan always wins and cancels any accidental 1-finger start.
        cancelActiveStroke();
        erasingPointerIdRef.current = null;
        panningPointerIdRef.current = null;
        const pts = Array.from(touchPointsRef.current.values());
        pinchLastRef.current = {
          cx: (pts[0].x + pts[1].x) / 2,
          cy: (pts[0].y + pts[1].y) / 2,
          dist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1,
        };
        return;
      }
    }

    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;

    // Decide whether this pointer should pan instead of draw.
    const isMiddlePan = e.pointerType === "mouse" && e.button === 1;
    const isPalmTouchPan = e.pointerType === "touch" && pencilOnly;
    const isHandTool = tool === "hand" || spaceHeld;
    if (isMiddlePan || isPalmTouchPan || isHandTool) {
      if (textDraft) commitText();
      e.currentTarget.setPointerCapture(e.pointerId);
      panningPointerIdRef.current = e.pointerId;
      panLastRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // Stylus barrel/eraser end or Eraser tool.
    const isPenEraser = e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32) !== 0);
    if (tool === "eraser" || isPenEraser) {
      if (textDraft) commitText();
      e.currentTarget.setPointerCapture(e.pointerId);
      erasingPointerIdRef.current = e.pointerId;
      eraseAt(toWorld(e.clientX, e.clientY));
      return;
    }

    const worldPt = toWorld(e.clientX, e.clientY);
    if (tool === "text") {
      e.preventDefault();
      if (textDraft) {
        commitText();
        return;
      }
      setTextDraft({
        world: worldPt,
        screen: toStage(e.clientX, e.clientY),
        value: "",
      });
      return;
    }

    if (textDraft) commitText();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingPointerIdRef.current = e.pointerId;
    predictedPointsRef.current = [];

    const size = SIZES[sizeIndex];
    const isPenInput = e.pointerType === "pen";
    const pressure = isPenInput && e.pressure > 0 ? e.pressure : 0.5;

    if (tool === "pen" || tool === "highlighter") {
      activeElementRef.current = {
        id: nextElementId(),
        kind: tool,
        color,
        size,
        points: [[worldPt[0], worldPt[1], pressure]],
        simulatePressure: !isPenInput,
      };
    } else {
      activeElementRef.current = {
        id: nextElementId(),
        kind: tool,
        color,
        size,
        a: worldPt,
        b: worldPt,
      };
    }
    scheduleLivePaint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch" && touchPointsRef.current.has(e.pointerId)) {
      touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointsRef.current.size >= 2) {
        const pts = Array.from(touchPointsRef.current.values());
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
        const prev = pinchLastRef.current;
        if (prev) {
          const [stageX, stageY] = toStage(cx, cy);
          const scaleFactor = dist / prev.dist;
          setCamera(cam => {
            const nextZoom = clampZoom(cam.zoom * scaleFactor);
            const ratio = nextZoom / cam.zoom;
            return {
              x: stageX - (stageX - cam.x) * ratio + (cx - prev.cx),
              y: stageY - (stageY - cam.y) * ratio + (cy - prev.cy),
              zoom: nextZoom,
            };
          });
        }
        pinchLastRef.current = { cx, cy, dist };
        return;
      }
    }

    if (panningPointerIdRef.current === e.pointerId && panLastRef.current) {
      const dx = e.clientX - panLastRef.current.x;
      const dy = e.clientY - panLastRef.current.y;
      panLastRef.current = { x: e.clientX, y: e.clientY };
      setCamera(cam => ({ ...cam, x: cam.x + dx, y: cam.y + dy }));
      return;
    }

    if (erasingPointerIdRef.current === e.pointerId) {
      eraseAt(toWorld(e.clientX, e.clientY));
      return;
    }

    if (drawingPointerIdRef.current !== e.pointerId) return;
    const active = activeElementRef.current;
    if (!active) return;

    const native = e.nativeEvent;
    const coalesced = native.getCoalescedEvents?.();
    const events = coalesced && coalesced.length ? coalesced : [native];

    if (active.kind === "pen" || active.kind === "highlighter") {
      const minWorldStep = 0.7 / cameraRef.current.zoom;
      for (const ev of events) {
        const [wx, wy] = toWorld(ev.clientX, ev.clientY);
        const last = active.points[active.points.length - 1];
        if (!last || Math.hypot(wx - last[0], wy - last[1]) >= minWorldStep) {
          const p = ev.pointerType === "pen" && ev.pressure > 0 ? ev.pressure : 0.5;
          active.points.push([wx, wy, p]);
        }
      }
      const predicted = native.getPredictedEvents?.();
      predictedPointsRef.current =
        predicted && predicted.length
          ? predicted.map(ev => {
              const [wx, wy] = toWorld(ev.clientX, ev.clientY);
              const p = ev.pointerType === "pen" && ev.pressure > 0 ? ev.pressure : 0.5;
              return [wx, wy, p] as WhiteboardPoint;
            })
          : [];
    } else if ("b" in active) {
      let b = toWorld(e.clientX, e.clientY);
      if (e.shiftKey) {
        if (active.kind === "rect" || active.kind === "ellipse") {
          const d = Math.max(Math.abs(b[0] - active.a[0]), Math.abs(b[1] - active.a[1]));
          b = [
            active.a[0] + Math.sign(b[0] - active.a[0]) * d,
            active.a[1] + Math.sign(b[1] - active.a[1]) * d,
          ];
        } else {
          // Snap line/arrow to 45-degree increments.
          const dx = b[0] - active.a[0];
          const dy = b[1] - active.a[1];
          const len = Math.hypot(dx, dy);
          const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          b = [active.a[0] + Math.cos(angle) * len, active.a[1] + Math.sin(angle) * len];
        }
      }
      active.b = b;
    }

    scheduleLivePaint();
  };

  const finishPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch") {
      touchPointsRef.current.delete(e.pointerId);
      if (touchPointsRef.current.size < 2) pinchLastRef.current = null;
    }
    if (panningPointerIdRef.current === e.pointerId) {
      panningPointerIdRef.current = null;
      panLastRef.current = null;
    }
    if (erasingPointerIdRef.current === e.pointerId) {
      erasingPointerIdRef.current = null;
    }
    if (drawingPointerIdRef.current !== e.pointerId) return;
    drawingPointerIdRef.current = null;
    predictedPointsRef.current = [];
    const active = activeElementRef.current;
    activeElementRef.current = null;
    scheduleLivePaint();

    if (!active) return;
    if (active.kind === "pen" || active.kind === "highlighter") {
      pushElement({ ...active, points: compactStrokePoints(active.points, 0.65 / cameraRef.current.zoom) });
    } else if ("b" in active) {
      if (Math.hypot(active.b[0] - active.a[0], active.b[1] - active.a[1]) < 3 / cameraRef.current.zoom) return;
      pushElement({
        ...active,
        a: [Math.round(active.a[0] * 10) / 10, Math.round(active.a[1] * 10) / 10],
        b: [Math.round(active.b[0] * 10) / 10, Math.round(active.b[1] * 10) / 10],
      });
    }
  };

  // Trackpad/mouse wheel pan and pinch-zoom.
  useEffect(() => {
    const canvas = liveCanvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.008);
        setCamera(cam => {
          const nextZoom = clampZoom(cam.zoom * factor);
          const ratio = nextZoom / cam.zoom;
          return {
            x: sx - (sx - cam.x) * ratio,
            y: sy - (sy - cam.y) * ratio,
            zoom: nextZoom,
          };
        });
      } else {
        setCamera(cam => ({ ...cam, x: cam.x - e.deltaX, y: cam.y - e.deltaY }));
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const cx = viewportRef.current.width / 2;
    const cy = viewportRef.current.height / 2;
    setCamera(cam => {
      const nextZoom = clampZoom(cam.zoom * factor);
      const ratio = nextZoom / cam.zoom;
      return { x: cx - (cx - cam.x) * ratio, y: cy - (cy - cam.y) * ratio, zoom: nextZoom };
    });
  };

  const fitContent = () => {
    const bounds = computeWhiteboardBounds(elementsRef.current, staticCanvasRef.current?.getContext("2d"));
    if (!bounds) {
      setCamera({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const { width, height } = viewportRef.current;
    const pad = 48;
    const zoom = clampZoom(Math.min(1.5, (width - pad * 2) / bounds.width, (height - pad * 2) / bounds.height));
    setCamera({
      x: width / 2 - (bounds.minX + bounds.width / 2) * zoom,
      y: height / 2 - (bounds.minY + bounds.height / 2) * zoom,
      zoom,
    });
  };

  const toggleTheme = () => {
    const nextTheme: WhiteboardTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    setDirty(true);
    // Keep default high-contrast ink readable when switching paper tone.
    if (color === LIGHT_COLORS[0] && nextTheme === "dark") setColor(DARK_COLORS[0]);
    else if (color === DARK_COLORS[0] && nextTheme === "light") setColor(LIGHT_COLORS[0]);
  };

  const cycleBackground = () => {
    const idx = BACKGROUNDS.findIndex(b => b.id === background);
    setBackground(BACKGROUNDS[(idx + 1) % BACKGROUNDS.length].id);
    setDirty(true);
  };

  const handleClose = useCallback(() => {
    if (dirty && !window.confirm("Discard unsaved whiteboard changes?")) return;
    onClose();
  }, [dirty, onClose]);

  const handleSave = async () => {
    if (textDraft) commitText();
    setSaving(true);
    const scene: WhiteboardScene = {
      version: 1,
      title: title.trim() || "Whiteboard",
      theme,
      background,
      elements: elementsRef.current,
      camera: cameraRef.current,
      updatedAt: new Date().toISOString(),
    };
    try {
      const preview = await renderWhiteboardPreviewBlob(scene);
      await onSave(scene, preview);
    } finally {
      setSaving(false);
    }
  };

  // Keyboard shortcuts (Undo/Redo, tool keys, Space to pan, Escape to close).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        e.stopPropagation();
        redo();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
        return;
      }
      if (!mod && !e.altKey) {
        const matched = TOOLS.find(t => t.key.toLowerCase() === e.key.toLowerCase());
        if (matched) {
          e.preventDefault();
          e.stopPropagation();
          setTool(matched.id);
        } else if (/^[1-8]$/.test(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          setColor(palette[Number(e.key) - 1]);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [undo, redo, handleClose, palette]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const bgLabel = BACKGROUNDS.find(b => b.id === background)?.label || "Dots";
  const paper = paperColors(theme);
  const cursorClass =
    tool === "hand" || spaceHeld
      ? "is-pan"
      : tool === "text"
        ? "is-text"
        : tool === "eraser"
          ? "is-eraser"
          : "";

  return createPortal(
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="wb-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Note whiteboard"
    >
      <div className="wb-bar" role="toolbar" aria-label="Whiteboard tools">
        <input
          type="text"
          aria-label="Whiteboard title"
          value={title}
          onChange={e => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          placeholder="Whiteboard"
          className="wb-title-input"
        />

        <div className="wb-group" aria-label="Drawing tools">
          {TOOLS.map(({ id, label, key, Icon }) => (
            <button
              key={id}
              type="button"
              title={`${label} (${key})`}
              aria-label={label}
              aria-pressed={tool === id}
              onClick={() => setTool(id)}
              className="wb-tool"
            >
              <Icon size={17} strokeWidth={1.9} />
            </button>
          ))}
        </div>

        <div className="wb-group" aria-label="Colors">
          {palette.map((c, idx) => (
            <button
              key={c}
              type="button"
              title={`Color ${idx + 1}`}
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className="wb-swatch"
              style={{ background: c }}
            />
          ))}
        </div>

        <div className="wb-group" aria-label="Stroke thickness">
          {SIZES.map((s, idx) => (
            <button
              key={s}
              type="button"
              title={["Fine", "Medium", "Bold", "Marker"][idx]}
              aria-label={["Fine", "Medium", "Bold", "Marker"][idx]}
              aria-pressed={sizeIndex === idx}
              onClick={() => setSizeIndex(idx)}
              className="wb-tool"
            >
              <span className="wb-dot" style={{ width: 4 + s * 0.8, height: 4 + s * 0.8, background: color }} />
            </button>
          ))}
        </div>

        <div className="wb-group" aria-label="Canvas options">
          <button
            type="button"
            title="Palm rejection: draw with Apple Pencil only, pan/zoom with fingers"
            aria-pressed={pencilOnly}
            onClick={() => setPencilOnly(p => !p)}
            className={`wb-pill ${pencilOnly ? "is-active" : ""}`}
          >
            <PenTool size={14} />
            <span>Pencil only</span>
          </button>

          <button
            type="button"
            title={`Background: ${bgLabel} (click to switch)`}
            onClick={cycleBackground}
            className="wb-pill"
          >
            <Grid3X3 size={14} />
            <span>{bgLabel}</span>
          </button>

          <button
            type="button"
            title={theme === "dark" ? "Switch to light paper" : "Switch to dark board"}
            aria-label={theme === "dark" ? "Switch to light paper" : "Switch to dark board"}
            onClick={toggleTheme}
            className="wb-tool"
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>

        <div className="wb-group" aria-label="History and zoom">
          <button
            type="button"
            title="Undo (⌘Z)"
            aria-label="Undo"
            disabled={!history.past.length}
            onClick={undo}
            className="wb-tool"
          >
            <Undo2 size={17} />
          </button>
          <button
            type="button"
            title="Redo (⇧⌘Z)"
            aria-label="Redo"
            disabled={!history.future.length}
            onClick={redo}
            className="wb-tool"
          >
            <Redo2 size={17} />
          </button>
          <button
            type="button"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => zoomBy(0.8)}
            className="wb-tool"
          >
            <ZoomOut size={16} />
          </button>
          <button
            type="button"
            title="Reset zoom to 100%"
            onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}
            className="wb-zoom-readout"
          >
            {Math.round(camera.zoom * 100)}%
          </button>
          <button
            type="button"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => zoomBy(1.25)}
            className="wb-tool"
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            title="Fit drawing to screen"
            aria-label="Fit drawing to screen"
            onClick={fitContent}
            className="wb-tool"
          >
            <Maximize size={16} />
          </button>
          <button
            type="button"
            title="Clear board"
            aria-label="Clear board"
            disabled={!elements.length}
            onClick={() => commitElements([])}
            className="wb-tool"
          >
            <Trash2 size={17} />
          </button>
        </div>

        <div className="wb-actions">
          <button type="button" className="wb-cancel" onClick={handleClose} disabled={saving}>
            <X size={16} /> Cancel
          </button>
          <button type="button" className="wb-save" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            <span>Done</span>
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className="wb-stage"
        style={{ background: paper.bg }}
        onPointerDown={e => {
          if (e.target === e.currentTarget && textDraft) commitText();
        }}
      >
        <canvas ref={staticCanvasRef} className="wb-canvas-static" />
        <canvas
          ref={liveCanvasRef}
          className={`wb-canvas-live ${cursorClass}`}
          onContextMenu={e => e.preventDefault()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
        />
        {textDraft && (
          <textarea
            ref={el => {
              if (el && document.activeElement !== el) requestAnimationFrame(() => el.focus());
            }}
            className="wb-text-input"
            rows={1}
            placeholder="Type, then Enter"
            value={textDraft.value}
            style={{
              left: textDraft.screen[0],
              top: textDraft.screen[1],
              color,
              fontSize: Math.max(14, SIZES[sizeIndex] * 3.8) * camera.zoom,
            }}
            onChange={e => setTextDraft({ ...textDraft, value: e.target.value })}
            onBlur={commitText}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commitText();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setTextDraft(null);
              }
            }}
          />
        )}
      </div>

      <p className="wb-hint">
        Apple Pencil auto-enables palm rejection (fingers pan &amp; pinch-zoom) · Two-finger pinch zooms · Hold Space to pan
      </p>
    </div>,
    document.body,
  );
};

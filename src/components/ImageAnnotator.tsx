import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Circle, Eraser, Highlighter, Loader2, MoveUpRight, Pencil, Redo2, Square, Trash2, Type, Undo2, X } from "lucide-react";
import { encodeCanvas } from "../utils/noteImages";

type Point = [number, number];
type Tool = "pen" | "highlighter" | "arrow" | "rect" | "ellipse" | "text" | "eraser";
type Shape =
  | { tool: "pen" | "highlighter"; color: string; size: number; points: Point[] }
  | { tool: "arrow" | "rect" | "ellipse"; color: string; size: number; a: Point; b: Point }
  | { tool: "text"; color: string; size: number; at: Point; text: string };

const COLORS = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#a855f7", "#111827", "#ffffff"];
const SIZES = [3, 6, 12];
const MAX_EDGE = 2400;
const TOOLS: Array<[Tool, string, typeof Pencil, string]> = [
  ["pen", "Pen", Pencil, "p"], ["highlighter", "Highlighter", Highlighter, "h"], ["arrow", "Arrow", MoveUpRight, "a"],
  ["rect", "Box", Square, "r"], ["ellipse", "Ellipse", Circle, "o"], ["text", "Text", Type, "t"], ["eraser", "Eraser", Eraser, "e"],
];

function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = s.color;
  ctx.lineCap = ctx.lineJoin = "round";
  if ("points" in s) {
    const highlight = s.tool === "highlighter";
    ctx.lineWidth = highlight ? s.size * 3 : s.size;
    if (highlight) { ctx.globalAlpha = 0.35; ctx.lineCap = "butt"; }
    const p = s.points;
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    if (p.length === 1) ctx.lineTo(p[0][0] + 0.1, p[0][1]);
    // Midpoint quadratic curves smooth out jitter from the pointer without lagging behind it.
    for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    if (p.length > 1) ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
    ctx.stroke();
  } else if ("text" in s) {
    ctx.font = `600 ${s.size * 4.5}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = "top";
    ctx.lineWidth = s.size * 0.9;
    ctx.strokeStyle = s.color === "#ffffff" ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.85)";
    s.text.split("\n").forEach((line, i) => {
      const y = s.at[1] + i * s.size * 5.6;
      ctx.strokeText(line, s.at[0], y);
      ctx.fillText(line, s.at[0], y);
    });
  } else {
    const [x1, y1] = s.a, [x2, y2] = s.b;
    ctx.lineWidth = s.size;
    ctx.beginPath();
    if (s.tool === "rect") ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    else if (s.tool === "ellipse") ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    else {
      const angle = Math.atan2(y2 - y1, x2 - x1), head = Math.max(12, s.size * 4);
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.moveTo(x2, y2); ctx.lineTo(x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45));
      ctx.moveTo(x2, y2); ctx.lineTo(x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45));
    }
    ctx.stroke();
  }
  ctx.restore();
}

const segmentDistance = ([px, py]: Point, [ax, ay]: Point, [bx, by]: Point) => {
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

function hits(ctx: CanvasRenderingContext2D, s: Shape, p: Point, slack: number): boolean {
  const reach = slack + (s.tool === "highlighter" ? s.size * 1.5 : s.size / 2);
  if ("points" in s) return s.points.some((q, i) => segmentDistance(p, s.points[Math.max(0, i - 1)], q) <= reach);
  if (s.tool === "arrow") return segmentDistance(p, s.a, s.b) <= reach;
  if ("text" in s) {
    ctx.font = `600 ${s.size * 4.5}px system-ui, -apple-system, sans-serif`;
    const lines = s.text.split("\n"), w = Math.max(...lines.map(l => ctx.measureText(l).width)), h = lines.length * s.size * 5.6;
    return p[0] >= s.at[0] - slack && p[0] <= s.at[0] + w + slack && p[1] >= s.at[1] - slack && p[1] <= s.at[1] + h + slack;
  }
  const x = Math.min(s.a[0], s.b[0]), y = Math.min(s.a[1], s.b[1]), w = Math.abs(s.b[0] - s.a[0]), h = Math.abs(s.b[1] - s.a[1]);
  if (s.tool === "rect") {
    const inside = p[0] >= x - reach && p[0] <= x + w + reach && p[1] >= y - reach && p[1] <= y + h + reach;
    const deep = p[0] > x + reach && p[0] < x + w - reach && p[1] > y + reach && p[1] < y + h - reach;
    return inside && !deep;
  }
  const rx = w / 2 || 1, ry = h / 2 || 1, nx = (p[0] - x - rx) / rx, ny = (p[1] - y - ry) / ry;
  return Math.abs(Math.hypot(nx, ny) - 1) * Math.min(rx, ry) <= reach;
}

interface Props { src: string; onSave: (dataUrl: string) => void; onClose: () => void }

/** Full-screen drawing layer over a note image. Marks stay editable (undo, erase) until saved, then are flattened in. */
export function ImageAnnotator({ src, onSave, onClose }: Props) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [sizeIndex, setSizeIndex] = useState(1);
  // Snapshot history (shape lists are small and shared structurally), so draw, erase and clear all undo alike.
  const [history, setHistory] = useState<{ past: Shape[][]; present: Shape[]; future: Shape[][] }>({ past: [], present: [], future: [] });
  const shapes = history.present;
  const [textDraft, setTextDraft] = useState<{ at: Point; screen: Point; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const active = useRef<Shape | null>(null);
  const frame = useRef(0);

  const scale = () => {
    const ink = inkRef.current!;
    return ink.width / (ink.getBoundingClientRect().width || ink.width);
  };
  const toCanvas = (e: { clientX: number; clientY: number }): Point => {
    const rect = inkRef.current!.getBoundingClientRect(), k = inkRef.current!.width / rect.width;
    return [(e.clientX - rect.left) * k, (e.clientY - rect.top) * k];
  };

  const paint = useCallback(() => {
    frame.current = 0;
    const ink = inkRef.current, ctx = ink?.getContext("2d");
    if (!ink || !ctx) return;
    ctx.clearRect(0, 0, ink.width, ink.height);
    for (const s of shapesRef.current) drawShape(ctx, s);
    if (active.current) drawShape(ctx, active.current);
  }, []);
  const schedule = useCallback(() => { if (!frame.current) frame.current = requestAnimationFrame(paint); }, [paint]);
  useEffect(() => { schedule(); }, [shapes, schedule]);
  useEffect(() => () => { cancelAnimationFrame(frame.current); frame.current = 0; }, []);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [fit, setFit] = useState<{ width: number; height: number } | undefined>();
  useEffect(() => {
    if (!natural) return;
    // Both layers get the same explicit on-screen size so pointer coordinates map exactly onto the image.
    const measure = () => {
      const k = Math.min(1, (window.innerWidth - 40) / natural.w, (window.innerHeight - 150) / natural.h);
      setFit({ width: Math.round(natural.w * k), height: Math.round(natural.h * k) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [natural]);

  useEffect(() => {
    const img = new Image();
    if (!src.startsWith("data:") && !src.startsWith("blob:")) img.crossOrigin = "anonymous";
    img.onload = () => {
      const ratio = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * ratio), h = Math.round(img.naturalHeight * ratio);
      for (const canvas of [baseRef.current, inkRef.current]) if (canvas) { canvas.width = w; canvas.height = h; }
      baseRef.current?.getContext("2d")?.drawImage(img, 0, 0, w, h);
      setNatural({ w, h });
      setStatus("ready");
    };
    img.onerror = () => setStatus("error");
    img.src = src;
  }, [src]);

  const change = (next: Shape[]) => {
    shapesRef.current = next; // Dragging the eraser can fire again before React re-renders.
    setHistory(h => ({ past: [...h.past, h.present], present: next, future: [] }));
  };
  const push = (shape: Shape) => change([...shapesRef.current, shape]);
  const undo = useCallback(() => setHistory(h => h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h), []);
  const redoLast = useCallback(() => setHistory(h => h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h), []);

  const eraseAt = (p: Point) => {
    const ctx = inkRef.current?.getContext("2d");
    if (!ctx) return;
    const list = shapesRef.current, slack = 6 * scale();
    for (let i = list.length - 1; i >= 0; i--) if (hits(ctx, list[i], p, slack)) {
      change(list.filter((_, j) => j !== i));
      return;
    }
  };

  const commitText = () => {
    if (textDraft?.value.trim()) push({ tool: "text", color, size: SIZES[sizeIndex] * scale(), at: textDraft.at, text: textDraft.value.replace(/\s+$/, "") });
    setTextDraft(null);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (status !== "ready" || (e.pointerType === "mouse" && e.button !== 0)) return;
    const p = toCanvas(e);
    if (tool === "text") {
      e.preventDefault(); // Otherwise the click's mousedown moves focus off the new text box and it closes empty.
      if (textDraft) { commitText(); return; }
      const rect = inkRef.current!.getBoundingClientRect();
      setTextDraft({ at: p, screen: [e.clientX - rect.left, e.clientY - rect.top], value: "" });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "eraser") { eraseAt(p); active.current = null; return; }
    const size = SIZES[sizeIndex] * scale();
    active.current = tool === "pen" || tool === "highlighter" ? { tool, color, size, points: [p] } : { tool, color, size, a: p, b: p };
    schedule();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    if (tool === "eraser") { eraseAt(toCanvas(e)); return; }
    const shape = active.current;
    if (!shape) return;
    // Coalesced events keep fast strokes (and Apple Pencil) smooth instead of polygonal.
    const events = e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent];
    if (shape.tool === "pen" || shape.tool === "highlighter") for (const ev of events) shape.points.push(toCanvas(ev));
    else if ("b" in shape) {
      let b = toCanvas(e);
      if (e.shiftKey && shape.tool !== "arrow") { // Shift draws a square or circle.
        const d = Math.max(Math.abs(b[0] - shape.a[0]), Math.abs(b[1] - shape.a[1]));
        b = [shape.a[0] + Math.sign(b[0] - shape.a[0]) * d, shape.a[1] + Math.sign(b[1] - shape.a[1]) * d];
      }
      shape.b = b;
    }
    schedule();
  };
  const onPointerUp = () => {
    const shape = active.current;
    active.current = null;
    if (!shape) return;
    if ("b" in shape && Math.hypot(shape.b[0] - shape.a[0], shape.b[1] - shape.a[1]) < 3) { schedule(); return; }
    push(shape);
  };

  const save = async () => {
    const base = baseRef.current;
    if (!base) return;
    if (!shapes.length) { onClose(); return; }
    setSaving(true);
    const out = document.createElement("canvas");
    out.width = base.width; out.height = base.height;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(base, 0, 0);
    for (const s of shapes) drawShape(ctx, s);
    try { onSave(encodeCanvas(out, /^data:image\/png/.test(src))); }
    catch { setStatus("error"); setSaving(false); }
  };

  const close = useCallback(() => {
    if (shapesRef.current.length && !window.confirm("Discard your drawing?")) return;
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redoLast() : undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redoLast(); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (!mod && !e.altKey) {
        const found = TOOLS.find(t => t[3] === e.key.toLowerCase());
        if (found) setTool(found[0]);
        else if (/^[1-8]$/.test(e.key)) setColor(COLORS[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redoLast, close]);

  const iconButton = (label: string, Icon: typeof Pencil, onClick: () => void, pressed?: boolean, disabled?: boolean) =>
    <button key={label} type="button" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} className="annotator-tool"><Icon size={18} strokeWidth={1.9} /></button>;

  return createPortal(<div className="annotator" role="dialog" aria-modal="true" aria-label="Draw on image">
    <div className="annotator-bar" role="toolbar" aria-label="Drawing tools">
      <div className="annotator-group">
        {TOOLS.map(([id, label, Icon, key]) => iconButton(`${label} (${key.toUpperCase()})`, Icon, () => setTool(id), tool === id))}
      </div>
      <div className="annotator-group" aria-label="Colour">
        {COLORS.map((c, i) => <button key={c} type="button" title={`Colour ${i + 1}`} aria-label={`Colour ${c}`} aria-pressed={color === c}
          className="annotator-swatch" style={{ background: c }} onClick={() => setColor(c)} />)}
      </div>
      <div className="annotator-group" aria-label="Thickness">
        {SIZES.map((s, i) => <button key={s} type="button" title={["Thin", "Medium", "Thick"][i]} aria-label={["Thin", "Medium", "Thick"][i]} aria-pressed={sizeIndex === i}
          className="annotator-tool" onClick={() => setSizeIndex(i)}><span className="annotator-dot" style={{ width: 4 + s, height: 4 + s, background: color }} /></button>)}
      </div>
      <div className="annotator-group">
        {iconButton("Undo (⌘Z)", Undo2, undo, false, !history.past.length)}
        {iconButton("Redo (⇧⌘Z)", Redo2, redoLast, false, !history.future.length)}
        {iconButton("Clear drawing", Trash2, () => change([]), false, !shapes.length)}
      </div>
      <div className="annotator-actions">
        <button type="button" className="annotator-cancel" onClick={close}><X size={16} /> Cancel</button>
        <button type="button" className="annotator-save" onClick={save} disabled={status !== "ready" || saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save
        </button>
      </div>
    </div>
    <div className="annotator-stage" onPointerDown={e => { if (e.target === e.currentTarget) commitText(); }}>
      {status === "loading" && <p className="annotator-message"><Loader2 size={18} className="animate-spin" /> Loading image…</p>}
      {status === "error" && <p className="annotator-message" role="alert">This image is hosted on another site, so it can’t be drawn on. Download it and paste it into the note instead.</p>}
      <div className="annotator-canvas" hidden={status !== "ready"}>
        <canvas ref={baseRef} style={fit} />
        <canvas ref={inkRef} style={fit} className={`annotator-ink tool-${tool}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
        {textDraft && <textarea ref={el => { if (el && document.activeElement !== el) requestAnimationFrame(() => el.focus()); }} className="annotator-text" rows={1} value={textDraft.value} placeholder="Type, then Enter"
          style={{ left: textDraft.screen[0], top: textDraft.screen[1], color, fontSize: SIZES[sizeIndex] * 4.5 }}
          onChange={e => setTextDraft({ ...textDraft, value: e.target.value })}
          onBlur={commitText}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setTextDraft(null); }
          }} />}
      </div>
    </div>
    <p className="annotator-hint">Shift for perfect squares and circles · Eraser removes a whole mark · Keys: P H A R O T E, 1–8 for colours</p>
  </div>, document.body);
}

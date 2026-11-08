import { useEffect, useRef, useState } from "react";
import { AlertCircle, BookMarked, Brain, CalendarDays, ChevronDown, Database, Globe, ImageIcon, Mail, PenLine, Search, ShieldCheck, SquarePen } from "lucide-react";
import type { AgentStep, AgentStepKind } from "../types";

const ICONS: Record<AgentStepKind, typeof Brain> = {
  think: Brain, prepare: Database, records: Search, web: Globe, email: Mail, calendar: CalendarDays, change: SquarePen,
  memory: BookMarked, image: ImageIcon, approval: ShieldCheck, write: PenLine,
};

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 1) return "";
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Done-state headline: "Thought for 4s" when it only reasoned, otherwise "Worked for 9s". */
function summary(steps: AgentStep[]): string {
  const start = Math.min(...steps.map(s => s.startedAt)), end = Math.max(...steps.map(s => s.endedAt ?? s.startedAt));
  const took = duration(end - start);
  const onlyThinking = steps.every(s => s.kind === "think");
  return `${onlyThinking ? "Thought" : "Worked"}${took ? ` for ${took}` : ""}`;
}

function useElapsed(live: boolean, since: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return now - since;
}

/**
 * What the assistant is doing, as it happens: a live status line that names the current step, and a
 * timeline of every step (with its reasoning and what it found) behind a disclosure arrow.
 */
export function AgentActivity({ steps, live = false, writing = false, continued = false }: { steps: AgentStep[]; live?: boolean; writing?: boolean; continued?: boolean }) {
  const visible = steps.filter(s => !s.hidden);
  // A finished reply keeps the steps open if the reader opened them while it was working.
  const [open, setOpenState] = useState(() => live ? (liveOpen.value = false) : continued && liveOpen.value);
  const setOpen = (value: boolean) => { if (live) liveOpen.value = value; setOpenState(value); };
  const mounted = useRef(Date.now());
  const since = visible.length ? Math.min(...visible.map(s => s.startedAt)) : mounted.current;
  const elapsed = useElapsed(live, since);
  const current = [...visible].reverse().find(s => s.status === "running");
  if (!live && !visible.length) return null;

  const status = live ? (current?.label || (writing ? "Writing" : "Thinking")) : summary(visible);
  const reasoning = live && current?.kind === "think" ? current.detail?.trim() : "";
  const others = visible.filter(s => s.kind !== "think").length;

  return <div className={`agent-activity ${live ? "is-live" : ""} ${open ? "is-open" : ""}`}>
    <button type="button" className="agent-activity-toggle" onClick={() => setOpen(!open)} aria-expanded={open} disabled={!visible.length}
      aria-label={`${status}. ${open ? "Hide" : "Show"} steps`}>
      {live ? <span className="agent-pulse" aria-hidden="true" /> : <Brain size={14} aria-hidden="true" />}
      <span key={status} className={`agent-status ${live ? "agent-shimmer" : ""}`}>{status}</span>
      {live && duration(elapsed) && <span className="agent-elapsed">{duration(elapsed)}</span>}
      {!live && others > 0 && <span className="agent-count">{others} step{others === 1 ? "" : "s"}</span>}
      {visible.length > 0 && <ChevronDown size={14} className="agent-chevron" aria-hidden="true" />}
    </button>
    {live && !open && reasoning && <p className="agent-peek" aria-hidden="true">{reasoning.slice(-280)}</p>}
    <div className="agent-steps-wrap" aria-hidden={!open}>
      <ol className="agent-steps" aria-live={live && open ? "polite" : undefined}>
        {visible.map(step => <ActivityStep key={step.id} step={step} />)}
      </ol>
    </div>
    <span className="sr-only" role="status">{live ? status : ""}</span>
  </div>;
}

function ActivityStep({ step }: { step: AgentStep }) {
  const Icon = step.status === "error" ? AlertCircle : ICONS[step.kind] || Search;
  const took = step.endedAt ? duration(step.endedAt - step.startedAt) : "";
  const links = (step.items || []).map(item => { const [title, url] = item.split("|"); return { title, url }; });
  return <li className={`agent-step is-${step.status} kind-${step.kind}`}>
    <span className="agent-step-icon">{step.status === "running" ? <span className="agent-spinner" aria-label="In progress" /> : <Icon size={13} aria-hidden="true" />}</span>
    <div className="agent-step-body">
      <div className="agent-step-head"><span>{step.label}</span>{took && <time>{took}</time>}</div>
      {step.detail && <p className={step.kind === "think" ? "agent-reasoning" : "agent-step-detail"}>{step.detail}</p>}
      {links.length > 0 && <ul className="agent-step-items">{links.map(({ title, url }, i) => <li key={i}>
        {url ? <a href={url} target="_blank" rel="noreferrer">{title || url}</a> : <span>{title}</span>}
      </li>)}</ul>}
    </div>
  </li>;
}

/** How far each streamed reply has been revealed, so a reply that finishes keeps revealing smoothly. */
const revealed = new Map<string, number>();
const liveOpen = { value: false };
/** True when this message was just streaming (its finished version replaces the live one seamlessly). */
export const wasStreaming = (id: string) => revealed.has(id);

/**
 * Reveals streamed text at a steady pace instead of in bursts: the more text is waiting, the faster it
 * catches up, so it never falls far behind the model.
 */
export function useSmoothText(id: string, text: string, streaming: boolean): string {
  const start = revealed.get(id) ?? (streaming ? 0 : text.length);
  const [length, setLength] = useState(Math.min(start, text.length));
  const target = useRef(text);
  target.current = text;
  const animating = streaming || length < text.length;
  useEffect(() => {
    if (!animating || reducedMotion()) { revealed.delete(id); return; }
    let frame = 0, last = performance.now(), shown = Math.min(revealed.get(id) ?? length, target.current.length);
    const tick = (now: number) => {
      const goal = target.current.length;
      if (shown > goal) shown = goal; // The draft was cleared (it turned into tool calls).
      if (shown < goal) {
        const perSecond = 90 + (goal - shown) * 5;
        shown = Math.min(goal, shown + Math.max(1, Math.round(perSecond * (now - last) / 1000)));
        revealed.set(id, shown);
        setLength(shown);
      }
      last = now;
      if (streaming || shown < goal) frame = requestAnimationFrame(tick);
      else revealed.delete(id);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [id, streaming, animating]);
  if (!animating || reducedMotion()) return text;
  return streaming || length < text.length ? closeMarkdown(text.slice(0, length)) : text;
}
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Text cut off mid-stream can end inside markdown ("**Short ans", "[task:ab"). Close what is open and drop
 * a half-written link or citation, so the reader sees formatted words instead of raw symbols.
 */
export function closeMarkdown(text: string): string {
  let out = text.replace(/\[([^\]\n]*)\]\([^)\n]*$/, "$1").replace(/\[[^\]\n]*$/, "").replace(/\*+$/, "");
  if ((out.match(/```/g) || []).length % 2) return `${out}\n\`\`\``;
  const line = out.slice(out.lastIndexOf("\n") + 1);
  if ((line.match(/`/g) || []).length % 2) out += "`";
  if ((line.match(/\*\*/g) || []).length % 2) out += "**";
  else if ((line.replace(/\*\*/g, "").match(/(^|[^*])\*(?!\s)/g) || []).length % 2 && !/^\s*\* /.test(line)) out += "*";
  return out;
}

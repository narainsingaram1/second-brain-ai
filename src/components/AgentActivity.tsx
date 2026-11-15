import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Ban, BookMarked, Brain, CalendarDays, Check, ChevronDown, Circle, CircleDashed, Database, Globe, ImageIcon, ListChecks, Mail, MousePointerClick, PenLine, Search, ShieldCheck, SquarePen, Monitor } from "lucide-react";
import type { AgentPlanItem, AgentStep, AgentStepKind } from "../types";
import { splitStepItem } from "../services/agentActivity";

const ICONS: Record<AgentStepKind, typeof Brain> = {
  think: Brain, prepare: Database, records: Search, web: Globe, email: Mail, calendar: CalendarDays, change: SquarePen,
  memory: BookMarked, image: ImageIcon, approval: ShieldCheck, write: PenLine, plan: ListChecks, browser: MousePointerClick, desktop: Monitor,
};

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 1) return "";
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Done-state headline: "Thought for 4s" when it only reasoned, otherwise "Worked for 9s". */
function summary(steps: AgentStep[], now?: number): string {
  const start = Math.min(...steps.map(s => s.startedAt)), end = Math.max(...steps.map(s => s.endedAt ?? now ?? s.startedAt));
  const took = duration(end - start);
  const onlyThinking = steps.every(s => s.kind === "think");
  return `${onlyThinking ? "Thought" : "Worked"}${took ? ` for ${took}` : ""}`;
}

/** While no reasoning streams, the status moves through phrases that fit the phase instead of a static "Thinking". */
const IDLE_PHRASES = ["Thinking", "Reading your request", "Working out an approach", "Pulling it together"];
const FOLLOW_UP_PHRASES = ["Reviewing what I found", "Connecting the pieces", "Shaping the answer"];
const PHRASE_MS = 4500;

const FILLER = /^(?:(?:okay|ok|alright|all right|so|now|hmm+|well|right|great|good|wait|actually|then|next|first|also|finally|after that)\b[,.!]?\s*)+/i;
const INTENT = /^(?:i(?:'ll| will| should| need to| want to| must| can| have to|'m going to| am going to)|let me|let's|we(?:'ll| should| need to))\s+(?:(?:also|just|first|then|quickly|now|carefully|probably)\s+)*/i;
const CLAUSE_END = /\s*(?:[,;:]\s*(?:then|and then|and|before|so|but|which|because)\b|;|:|\s[—–]\s|\s-\s)/i;

function gerund(word: string): string {
  const lower = word.toLowerCase();
  if (lower.endsWith("ing") || lower.length < 2) return word;
  if (lower === "be") return "Being";
  if (lower.endsWith("ie")) return `${word.slice(0, -2)}ying`;
  if (/[^aeiou]e$/.test(lower)) return `${word.slice(0, -1)}ing`;
  if (/^[^aeiou]*[aeiou][bdgmnpt]$/.test(lower)) return `${word}${word.slice(-1)}ing`;
  return `${word}ing`;
}

/**
 * A short, live headline for what the model is thinking about right now: its latest finished sentence, trimmed to
 * the first clause, with "I'll check…" turned into "Checking…". Empty until the first sentence is complete.
 */
export function thoughtHeadline(reasoning: string): string {
  const sentences = reasoning.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").match(/[^.!?]+[.!?]+(?=\s|$)/g);
  if (!sentences) return "";
  let text = sentences[sentences.length - 1].trim().replace(/[.!?]+$/, "").replace(FILLER, "");
  if (/^the user(?:'s)?\b/i.test(text)) return "Understanding the request";
  const intent = INTENT.exec(text);
  if (intent) text = text.slice(intent[0].length).replace(/^[A-Za-z]+/, gerund);
  const clause = CLAUSE_END.exec(text);
  if (clause && clause.index >= 12) text = text.slice(0, clause.index);
  text = text.replace(/^[a-z]/, c => c.toUpperCase());
  if (text.length > 64) text = `${text.slice(0, 64).replace(/[\s,;:]+\S*$/, "")}…`;
  return text.length >= 6 ? text : "";
}

/** Holds each value on screen for at least `holdMs`, so a fast-changing status reads as steps rather than flicker. */
function useSteady(value: string, holdMs: number): string {
  const [shown, setShown] = useState(value);
  const since = useRef(Date.now());
  useEffect(() => {
    if (value === shown) return;
    const timer = setTimeout(() => { since.current = Date.now(); setShown(value); }, Math.max(0, holdMs - (Date.now() - since.current)));
    return () => clearTimeout(timer);
  }, [value, shown, holdMs]);
  return shown;
}

export type LoaderPhase = "think" | "work" | "write";
/** An abstract 3×3 dot matrix whose motion follows the phase: a diagonal ripple while thinking, a scan while using tools. */
export function AgentLoader({ phase }: { phase: LoaderPhase }) {
  return <span className={`agent-loader is-${phase}`} aria-hidden="true">
    {Array.from({ length: 9 }, (_, i) => <i key={i} style={{ "--r": Math.floor(i / 3), "--c": i % 3, "--d": Math.abs(Math.floor(i / 3) - 1) + Math.abs((i % 3) - 1) } as React.CSSProperties} />)}
  </span>;
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
  const all = steps.filter(s => !s.hidden);
  // The plan is shown on its own, always open; the timeline holds the work itself.
  const plan = [...all].reverse().find(s => s.kind === "plan" && s.plan?.length)?.plan;
  const visible = all.filter(s => s.kind !== "plan");
  // A finished reply keeps the steps open if the reader opened them while it was working.
  const [open, setOpenState] = useState(() => live ? (liveOpen.value = false) : continued && liveOpen.value);
  const setOpen = (value: boolean) => { if (live) liveOpen.value = value; setOpenState(value); };
  const mounted = useRef(Date.now());
  const since = visible.length ? Math.min(...visible.map(s => s.startedAt)) : mounted.current;
  const elapsed = useElapsed(live, since);
  const current = [...visible].reverse().find(s => s.status === "running");
  const thinking = !current || current.kind === "think" || current.kind === "write";
  // Once the answer is streaming and nothing else is running, the text itself shows progress: settle the line.
  const settled = !live || (writing && thinking);
  const phraseSince = current?.startedAt ?? since;
  const phrases = visible.some(s => s.kind !== "think" && s.kind !== "plan") ? FOLLOW_UP_PHRASES : IDLE_PHRASES;
  const idle = phrases[Math.min(phrases.length - 1, Math.floor(Math.max(0, Date.now() - phraseSince) / PHRASE_MS))];
  const headline = thoughtHeadline(current?.kind === "think" ? current.detail || "" : "");
  const liveStatus = useSteady(!thinking ? current!.label : current?.kind === "write" ? current.label : headline || idle, 1400);
  if (!live && !visible.length && !plan) return null;

  const status = settled ? (visible.length ? summary(visible, live ? Date.now() : undefined) : "Writing") : liveStatus;
  const phase: LoaderPhase = !thinking ? "work" : current?.kind === "write" ? "write" : "think";
  const others = visible.filter(s => s.kind !== "think").length;

  return <div className={`agent-activity ${live ? "is-live" : ""} ${settled ? "is-settled" : ""} ${open ? "is-open" : ""}`}>
    <button type="button" className="agent-activity-toggle" onClick={() => setOpen(!open)} aria-expanded={open} disabled={!visible.length}
      aria-label={`${status}. ${open ? "Hide" : "Show"} steps`}>
      {settled ? <Brain size={14} aria-hidden="true" /> : <AgentLoader phase={phase} />}
      <span key={status} className={`agent-status ${settled ? "" : "agent-shimmer"}`}>{status}</span>
      {!settled && duration(elapsed) && <span className="agent-elapsed">{duration(elapsed)}</span>}
      {settled && others > 0 && <span className="agent-count">{others} step{others === 1 ? "" : "s"}</span>}
      {visible.length > 0 && <ChevronDown size={14} className="agent-chevron" aria-hidden="true" />}
    </button>
    {plan && <AgentPlan items={plan} live={live} />}
    <div className="agent-steps-wrap" aria-hidden={!open}>
      <ol className="agent-steps" aria-live={live && open ? "polite" : undefined}>
        {visible.map(step => <ActivityStep key={step.id} step={step} />)}
      </ol>
    </div>
    <span className="sr-only" role="status">{live ? status : ""}</span>
  </div>;
}

const PLAN_ICONS = { pending: Circle, in_progress: CircleDashed, done: Check, skipped: Ban, blocked: AlertCircle } as const;
const PLAN_STATUS = { pending: "Not started", in_progress: "In progress", done: "Done", skipped: "Skipped", blocked: "Blocked" } as const;

/** The assistant's plan for a multi-step request, as a checklist that fills in while it works. */
function AgentPlan({ items, live }: { items: AgentPlanItem[]; live: boolean }) {
  const done = items.filter(i => i.status === "done").length;
  return <div className="agent-plan" aria-label={`Plan, ${done} of ${items.length} done`}>
    <ol>
      {items.map((item, i) => {
        const Icon = PLAN_ICONS[item.status] || Circle;
        const running = live && item.status === "in_progress";
        return <li key={i} className={`agent-plan-item is-${item.status}`}>
          <span className="agent-plan-mark">{running ? <span className="agent-spinner" aria-hidden="true" /> : <Icon size={12} aria-hidden="true" />}</span>
          <span className="agent-plan-text"><span>{item.title}</span>{item.note && <small>{item.note}</small>}</span>
          <span className="sr-only">{PLAN_STATUS[item.status]}</span>
        </li>;
      })}
    </ol>
  </div>;
}

function ActivityStep({ step }: { step: AgentStep }) {
  const Icon = step.status === "error" ? AlertCircle : ICONS[step.kind] || Search;
  const took = step.endedAt ? duration(step.endedAt - step.startedAt) : "";
  const links = (step.items || []).map(splitStepItem);
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
    let frame = 0, last = performance.now(), paintedAt = 0, paintedLength = -1, shown = Math.min(revealed.get(id) ?? length, target.current.length);
    let budget = 0;
    const tick = (now: number) => {
      const text = target.current, goal = text.length;
      if (shown > goal) shown = goal; // The draft was cleared (it turned into tool calls).
      if (shown < goal) {
        // Steady pace that speeds up with the backlog, so it never falls far behind the model.
        budget += (70 + (goal - shown) * 4) * (now - last) / 1000;
        let next = shown + Math.floor(budget);
        if (next > shown) {
          // Reveal whole words: extend to the end of the word being cut, unless it is the very end of the stream.
          const space = text.slice(next).search(/\s/);
          if (space >= 0 && space < 24) next += space;
          else if (space < 0 && !streaming) next = goal;
          next = Math.min(goal, next);
          budget = Math.max(0, budget - (next - shown));
          shown = next;
          revealed.set(id, shown);
        }
        // Repaint at most ~30 times a second: each paint re-renders the markdown.
        if (shown !== paintedLength && (now - paintedAt > 32 || shown === goal)) { paintedAt = now; paintedLength = shown; setLength(shown); }
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

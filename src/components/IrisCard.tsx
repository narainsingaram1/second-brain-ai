import "../iris-card.css";
import { useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Check, RotateCcw, X } from "lucide-react";
import type { BrainState } from "../types";
import { habitWeeklyTarget, habitWeeks, parseIrisUi, type IrisCardState, type IrisUiSpec } from "../utils/irisUi";

export interface IrisCardActions {
  /** False while the reply is still streaming or Iris is busy; controls stay visible but can't be used. */
  interactive: boolean;
  onReply?: (text: string) => void;
  onAddTasks?: (spec: Extract<IrisUiSpec, { type: "checklist" }>, indexes: number[]) => Promise<void>;
  onChange?: (next: IrisCardState) => void;
  onOpenTask?: (id: string, title: string) => void;
}
interface CardProps<T> { spec: T; saved: IrisCardState; actions: IrisCardActions }

const dueLabel = (date?: string, time?: string) => {
  if (!date) return "";
  const day = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (!time) return day;
  const [hours, minutes] = time.split(":").map(Number);
  return `${day}, ${new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function Checklist({ spec, saved, actions }: CardProps<Extract<IrisUiSpec, { type: "checklist" }>>) {
  const added = saved.added || {};
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const remaining = spec.items.map((_, i) => i).filter(i => added[i] === undefined);
  const selected = remaining.filter(i => !unticked.has(i));
  const addedCount = spec.items.length - remaining.length;
  const destination = [spec.section, spec.subsection].filter(Boolean).join(" · ");
  const toggle = (index: number) => setUnticked(previous => {
    const next = new Set(previous);
    if (!next.delete(index)) next.add(index);
    return next;
  });
  const add = async () => {
    if (!actions.onAddTasks || saving || !selected.length) return;
    setSaving(true);
    setError("");
    try { await actions.onAddTasks(spec, selected); }
    catch (err) { setError(err instanceof Error ? err.message : "Those tasks couldn't be added. Try again."); }
    finally { setSaving(false); }
  };
  return <section className="iris-card" aria-label={spec.title}>
    <header className="iris-card-head"><h3>{spec.title}</h3>{destination && <span>{destination}</span>}</header>
    <ul className="iris-rows">{spec.items.map((item, index) => {
      const meta = [dueLabel(item.dueDate, item.dueTime), item.priority === "urgent" || item.priority === "high" ? item.priority[0].toUpperCase() + item.priority.slice(1) : ""].filter(Boolean).join(" · ");
      const taskId = added[index];
      if (taskId !== undefined) return <li key={index}>
        <button type="button" className="iris-row is-added" onClick={() => actions.onOpenTask?.(taskId, item.title)} aria-label={`Open task: ${item.title}`}>
          <span className="iris-tick is-on" aria-hidden="true"><Check size={12} strokeWidth={2.5} /></span>
          <span className="iris-row-title">{item.title}</span>
          <span className="iris-row-meta">{meta}<ArrowUpRight size={12} aria-hidden="true" /></span>
        </button>
      </li>;
      const on = !unticked.has(index);
      return <li key={index}>
        <label className="iris-row">
          <input type="checkbox" className="iris-input" checked={on} disabled={!actions.interactive || saving} onChange={() => toggle(index)} />
          <span className={`iris-tick ${on ? "is-on" : ""}`} aria-hidden="true">{on && <Check size={12} strokeWidth={2.5} />}</span>
          <span className="iris-row-title">{item.title}</span>
          {meta && <span className="iris-row-meta">{meta}</span>}
        </label>
      </li>;
    })}</ul>
    <footer className="iris-card-foot">
      {error ? <p role="alert" className="iris-error">{error}</p>
        : !remaining.length ? <p role="status" className="iris-done"><Check size={14} aria-hidden="true" />{`Added ${plural(addedCount, "task")}`}</p>
        : <p className="iris-count">{addedCount ? `${addedCount} added, ${selected.length} selected` : `${selected.length} of ${spec.items.length} selected`}</p>}
      {remaining.length > 0 && <button type="button" className="iris-primary" disabled={!actions.interactive || saving || !selected.length || !actions.onAddTasks} onClick={add}>
        {saving ? "Adding…" : `Add ${selected.length ? plural(selected.length, "task") : "tasks"}`}
      </button>}
    </footer>
  </section>;
}

function Choices({ spec, saved, actions }: CardProps<Extract<IrisUiSpec, { type: "choices" }>>) {
  const pick = (option: string) => { actions.onChange?.({ picked: option }); actions.onReply?.(option); };
  return <section className="iris-choices" aria-label={spec.question || "Choose an option"}>
    {spec.question && <p>{spec.question}</p>}
    <div role="group">{spec.options.map(option => <button type="button" key={option} className={saved.picked === option ? "is-picked" : ""} aria-pressed={saved.picked === option}
      disabled={!actions.interactive || !!saved.picked || !actions.onReply} onClick={() => pick(option)}>{saved.picked === option && <Check size={14} aria-hidden="true" />}{option}</button>)}</div>
  </section>;
}

function Quiz({ spec, saved, actions }: CardProps<Extract<IrisUiSpec, { type: "quiz" }>>) {
  const answers = saved.answers || [];
  const total = spec.questions.length;
  // After a reload, resume on the first unanswered question; a just-answered one stays up until Next.
  const [step, setStep] = useState(Math.min(answers.length, total));
  const answered = answers[step] !== undefined;
  const question = spec.questions[step];
  const score = answers.filter((answer, i) => answer === spec.questions[i]?.answer).length;
  const answer = (option: number) => actions.onChange?.({ answers: [...answers.slice(0, step), option] });
  const retry = () => { actions.onChange?.({ answers: [] }); setStep(0); };
  const review = () => {
    const missed = spec.questions.filter((q, i) => answers[i] !== q.answer);
    actions.onReply?.(`Go over what I missed in "${spec.title}":\n${missed.map((q, i) => `${i + 1}. ${q.question} (correct: ${q.options[q.answer]})`).join("\n")}`);
  };
  return <section className="iris-card" aria-label={spec.title}>
    <header className="iris-card-head"><h3>{spec.title}</h3>{question && <span className="iris-tabular">{step + 1} of {total}</span>}</header>
    <div className="iris-progress" aria-hidden="true">{spec.questions.map((q, i) => <span key={i} className={answers[i] === undefined ? "" : answers[i] === q.answer ? "is-right" : "is-wrong"} />)}</div>
    {question ? <div className="iris-quiz-body">
      <p className="iris-question">{question.question}</p>
      <div className="iris-options">{question.options.map((option, index) => {
        const right = answered && index === question.answer, wrong = answered && index === answers[step] && !right;
        return <button type="button" key={index} className={`iris-option ${right ? "is-right" : ""} ${wrong ? "is-wrong" : ""}`} disabled={answered || !actions.interactive || !actions.onChange} onClick={() => answer(index)}>
          <span>{option}</span>{right ? <Check size={16} aria-label="Correct" /> : wrong ? <X size={16} aria-label="Your answer, incorrect" /> : null}
        </button>;
      })}</div>
      {answered && <div className="iris-quiz-after" aria-live="polite">
        {question.why && <p>{question.why}</p>}
        <button type="button" className="iris-primary" onClick={() => setStep(step + 1)}>{step + 1 === total ? "See results" : "Next"}<ArrowRight size={14} aria-hidden="true" /></button>
      </div>}
    </div> : <div className="iris-quiz-result" role="status">
      <p className="iris-score iris-tabular">{score}<span>/{total}</span></p>
      <p className="iris-count">{score === total ? "Every question right" : `${plural(total - score, "question")} to go back over`}</p>
      <div className="iris-result-actions">
        {score < total && actions.onReply && <button type="button" className="iris-primary" disabled={!actions.interactive} onClick={review}>Go over what I missed</button>}
        <button type="button" className="iris-secondary" disabled={!actions.interactive} onClick={retry}><RotateCcw size={14} aria-hidden="true" />Try again</button>
      </div>
    </div>}
  </section>;
}

function HabitChart({ spec, state }: { spec: Extract<IrisUiSpec, { type: "chart" }>; state?: BrainState | null }) {
  const habit = state?.habits.find(h => h.id === spec.habitId);
  if (!habit) return <Unavailable />;
  const target = habitWeeklyTarget(habit);
  const weeks = habitWeeks(habit, spec.weeks);
  const current = weeks[weeks.length - 1];
  return <section className="iris-card iris-chart" aria-label={`${habit.name}, weekly completions`}>
    <header className="iris-chart-head">
      <div><h3>{habit.name}</h3><p>{habit.streak}-day streak · best {habit.bestStreak}</p></div>
      <p className="iris-score iris-tabular">{current.done}<span>/{target} this week</span></p>
    </header>
    <div className="iris-bars" role="img" aria-label={weeks.map(w => `Week of ${w.label}: ${w.done} of ${target}`).join(". ")}>
      {weeks.map(week => <div key={week.label} className={`iris-bar ${week.current ? "is-current" : ""}`}>
        <div className="iris-bar-track"><span style={{ height: `${Math.min(100, week.done / target * 100)}%` }} /></div>
        <small>{week.label}</small>
      </div>)}
    </div>
  </section>;
}

const Unavailable = () => <p className="iris-unavailable">This card couldn’t be displayed</p>;

/** Renders one card from the model's description, using only the components defined here. */
export function IrisCard({ code, complete, state, saved, actions }: { code: string; complete: boolean; state?: BrainState | null; saved?: IrisCardState; actions: IrisCardActions }) {
  if (!complete) return <div className="iris-skeleton" role="status" aria-label="Preparing a card"><span /><span /><span /></div>;
  const spec = parseIrisUi(code);
  if (!spec) return <Unavailable />;
  const cardProps = { saved: saved || {}, actions };
  const cards: Record<IrisUiSpec["type"], () => ReactNode> = {
    checklist: () => <Checklist spec={spec as never} {...cardProps} />,
    choices: () => <Choices spec={spec as never} {...cardProps} />,
    quiz: () => <Quiz spec={spec as never} {...cardProps} />,
    chart: () => <HabitChart spec={spec as never} state={state} />,
  };
  return <>{cards[spec.type]()}</>;
}

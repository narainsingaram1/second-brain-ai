import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coffee,
  GraduationCap,
  LockKeyhole,
  Pencil,
  Plus,
  Sparkles,
  Sun,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import type { BrainState } from "../types";
import {
  DEFAULT_PLANNER,
  fixedBlocks,
  minutes,
  overlaps,
  schedulePlan,
  shiftDate,
  upcomingTasks,
  validRange,
  type DayPlan,
  type PlanBlock,
  type PlannerData,
  type Routine,
} from "../utils/dailyPlanner";
import { getLocalDateString } from "../utils/habitStreaks";
import {
  googleEvents,
  serverFeatures,
  type GoogleCalendarEvent,
} from "../services/serverApi";
import { suggestDailyPlan } from "../services/dailyPlannerAI";
import "../planner.css";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const timeLabel = (time: string) =>
  new Date(`2000-01-01T${time}:00`).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
const durationLabel = (value: number) =>
  value >= 60
    ? `${Math.floor(value / 60)}h${value % 60 ? ` ${value % 60}m` : ""}`
    : `${value}m`;

export function DailyPlannerView({
  state,
  onChange,
  onSettings,
}: {
  state: BrainState;
  onChange: (update: (s: BrainState) => BrainState) => void;
  onSettings: () => void;
}) {
  const data = state.preferences?.planner || DEFAULT_PLANNER;
  const [date, setDate] = useState(getLocalDateString);
  const [remote, setRemote] = useState<GoogleCalendarEvent[]>([]);
  const [calendarStatus, setCalendarStatus] = useState(
    "Checking Google Calendar…",
  );
  const [loadingCalendar, setLoadingCalendar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<PlanBlock | null>(null);
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [undo, setUndo] = useState<{ date: string; plan?: DayPlan } | null>(
    null,
  );
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    let live = true;
    setRemote([]);
    setLoadingCalendar(true);
    setCalendarStatus("Checking Google Calendar…");
    serverFeatures()
      .then(async (features) => {
        if (!features.google) {
          if (live) setCalendarStatus("Using your saved events and routines");
          return [];
        }
        const events = await googleEvents(date, shiftDate(date, 1));
        if (live) setCalendarStatus("Google Calendar included");
        return events;
      })
      .then((events) => {
        if (live) setRemote(events);
      })
      .catch(() => {
        if (live)
          setCalendarStatus(
            "Google Calendar unavailable. Only saved events and routines are included.",
          );
      })
      .finally(() => {
        if (live) setLoadingCalendar(false);
      });
    return () => {
      live = false;
    };
  }, [date]);
  const events = useMemo(
    () => [
      ...(state.events || []),
      ...remote.map((e) => ({ ...e, id: `google:${e.id}` })),
    ],
    [state.events, remote],
  );
  const fixed = fixedBlocks(date, data, events);
  const plan = data.plans[date];
  const blocks = [
    ...fixed.map((b) => ({
      ...b,
      done: plan?.blocks.find((old) => old.id === b.id)?.done,
    })),
    ...(plan?.blocks || []).filter((b) => !b.sourceId),
  ].sort((a, b) => a.start.localeCompare(b.start));
  const conflicts = blocks.filter((block, index) =>
    blocks.some((other, j) => index !== j && overlaps(block, other)),
  );
  const allDay = events.filter(
    (e) =>
      e.date <= date &&
      (("endDate" in e && e.endDate) || e.date) >= date &&
      !e.startTime,
  );
  const tasks = upcomingTasks(state, date);
  const done = blocks.filter((b) => b.done).length;
  const focus = blocks
    .filter((b) => b.kind === "focus")
    .reduce((sum, b) => sum + minutes(b.end) - minutes(b.start), 0);
  const updateData = (update: (current: PlannerData) => PlannerData) =>
    onChange((s) => ({
      ...s,
      preferences: {
        ...s.preferences,
        planner: update(s.preferences?.planner || DEFAULT_PLANNER),
      },
    }));
  const savePlan = (next: DayPlan) =>
    updateData((current) => ({
      ...current,
      plans: { ...current.plans, [date]: next },
    }));
  const setBlocks = (next: PlanBlock[]) => {
    setUndo(null);
    savePlan({
      ...(plan || { summary: "", generatedAt: "", unscheduled: [] }),
      blocks: next,
    });
  };
  const moveDate = (next: string) => {
    if (busy) return;
    setDate(next);
    setEditing(null);
    setError("");
  };
  const generate = async () => {
    if (!validRange(data.start, data.end)) {
      setError("Set a day end later than the start in Your rhythm.");
      setShowSetup(true);
      return;
    }
    setBusy(true);
    setError("");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await suggestDailyPlan(
        state,
        date,
        data,
        fixed,
        abort.signal,
      );
      const next = schedulePlan(date, data, fixed, result.suggestions);
      next.summary = result.summary;
      setUndo({ date, plan });
      savePlan(next);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Could not generate your plan. Try again.",
        );
    } finally {
      setBusy(false);
      controller.current = null;
    }
  };
  const patchBlock = (block: PlanBlock, patch: Partial<PlanBlock>) =>
    setBlocks(blocks.map((b) => (b.id === block.id ? { ...b, ...patch } : b)));

  return (
    <section className="planner-page" aria-label="Daily planner">
      <header className="planner-heading">
        <div>
          <span className="planner-eyebrow">
            <Sun size={14} /> A LITTLE INTENTION GOES A LONG WAY
          </span>
          <h1>Your day, by design.</h1>
          <p>
            A realistic plan for everything on your plate. Always yours to
            change.
          </p>
        </div>
        <button
          className="planner-outline"
          onClick={() => setShowSetup((v) => !v)}
          aria-expanded={showSetup}
        >
          <Clock3 size={16} /> Your rhythm
        </button>
      </header>
      <div className="planner-datebar">
        <div className="planner-date-controls">
          <button
            className="icon-control"
            disabled={busy}
            aria-label="Previous day"
            onClick={() => moveDate(shiftDate(date, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <label>
            <CalendarDays size={17} />
            <input
              type="date"
              aria-label="Plan date"
              value={date}
              disabled={busy}
              onChange={(e) => {
                if (e.target.value) moveDate(e.target.value);
              }}
            />
          </label>
          <button
            className="icon-control"
            disabled={busy}
            aria-label="Next day"
            onClick={() => moveDate(shiftDate(date, 1))}
          >
            <ChevronRight size={18} />
          </button>
          <button
            className="text-action"
            disabled={busy}
            onClick={() => moveDate(getLocalDateString())}
          >
            Today
          </button>
        </div>
        <span>{dateLabel(date)}</span>
      </div>
      {showSetup && (
        <section className="planner-setup">
          <div className="planner-section-title">
            <h2>Your rhythm</h2>
            <span>Saved for every day</span>
          </div>
          <div className="planner-settings">
            <label>
              Day starts
              <input
                type="time"
                value={data.start}
                disabled={busy}
                onChange={(e) =>
                  updateData((d) => ({ ...d, start: e.target.value }))
                }
              />
            </label>
            <label>
              Day ends
              <input
                type="time"
                value={data.end}
                disabled={busy}
                onChange={(e) =>
                  updateData((d) => ({ ...d, end: e.target.value }))
                }
              />
            </label>
            <label>
              Focus sessions
              <select
                value={data.focusMinutes}
                disabled={busy}
                onChange={(e) =>
                  updateData((d) => ({
                    ...d,
                    focusMinutes: Number(e.target.value),
                  }))
                }
              >
                <option value={25}>25 minutes</option>
                <option value={50}>50 minutes</option>
                <option value={90}>90 minutes</option>
              </select>
            </label>
          </div>
          <label className="planner-instructions">
            Planning preferences
            <textarea
              value={data.instructions}
              disabled={busy}
              maxLength={2000}
              placeholder="Lunch around noon, gym after class, and leave time to walk between buildings…"
              onChange={(e) =>
                updateData((d) => ({ ...d, instructions: e.target.value }))
              }
            />
          </label>
          <p className="planner-caption">
            Preferences guide the AI. Add exact times below for commitments that
            must stay fixed.
          </p>
        </section>
      )}
      <div className="planner-layout">
        <div className="planner-main">
          <div className="planner-hero">
            <div className="planner-hero-icon">
              <Sparkles size={22} />
            </div>
            <div>
              <span className="planner-eyebrow">
                MAKE SPACE FOR WHAT MATTERS
              </span>
              <h2>
                {plan
                  ? "A plan, not a pressure test."
                  : "Let’s give your day some shape."}
              </h2>
              <p>
                {plan?.summary ||
                  "Iris brings together your commitments, deadlines and habits, then finds room for focused work and real breaks."}
              </p>
              <small>
                {busy ? "Finding a realistic balance…" : calendarStatus}
              </small>
            </div>
            <button
              className="workspace-primary"
              disabled={busy || loadingCalendar || !!editing || !!routine}
              onClick={() => void generate()}
            >
              <Sparkles size={16} className={busy ? "animate-pulse" : ""} />
              {busy ? "Planning…" : plan ? "Replan my day" : "Plan my day"}
            </button>
          </div>
          {error && (
            <div className="planner-alert" role="alert">
              {error}
              {!state.openRouterKey && (
                <button className="text-action" onClick={onSettings}>
                  Open AI settings
                </button>
              )}
            </div>
          )}
          {undo?.date === date && (
            <div className="planner-notice">
              New plan ready. Locked and completed blocks were kept.
              <button
                className="text-action"
                disabled={busy}
                onClick={() => {
                  updateData((d) => {
                    const plans = { ...d.plans };
                    if (undo.plan) plans[date] = undo.plan;
                    else delete plans[date];
                    return { ...d, plans };
                  });
                  setUndo(null);
                }}
              >
                Undo replan
              </button>
            </div>
          )}
          <div className="planner-stats">
            <div>
              <span className="planner-stat-dot focus" />
              <strong>{durationLabel(focus)}</strong>
              <span>focused work</span>
            </div>
            <div>
              <span className="planner-stat-dot event" />
              <strong>{fixed.length}</strong>
              <span>commitments</span>
            </div>
            <div>
              <span className="planner-stat-dot done" />
              <strong>
                {done}/{blocks.length}
              </strong>
              <span>blocks done</span>
            </div>
          </div>
          {!!blocks.length && (
            <div
              className="planner-progress"
              role="progressbar"
              aria-label="Day progress"
              aria-valuenow={done}
              aria-valuemin={0}
              aria-valuemax={blocks.length}
            >
              <span style={{ width: `${(done / blocks.length) * 100}%` }} />
            </div>
          )}
          <div className="planner-section-title">
            <h2>
              The day ahead <span>{blocks.length} blocks</span>
            </h2>
            <button
              className="text-action"
              disabled={busy}
              onClick={() => {
                setEditing({
                  id: crypto.randomUUID(),
                  title: "",
                  start: data.start,
                  end:
                    minutes(data.start) < 1380
                      ? `${String(Number(data.start.slice(0, 2)) + 1).padStart(2, "0")}:${data.start.slice(3)}`
                      : data.end,
                  kind: "personal",
                });
                setError("");
              }}
            >
              <Plus size={15} /> Add block
            </button>
          </div>
          {allDay.map((event) => (
            <div className="planner-all-day" key={event.id}>
              <CalendarDays size={14} />
              <span>All day</span>
              <strong>{event.title}</strong>
            </div>
          ))}
          {!!conflicts.length && (
            <div className="planner-alert" role="alert">
              Overlapping commitments:{" "}
              {[...new Set(conflicts.map((b) => b.title))].join(", ")}. Adjust
              their times before relying on this plan.
            </div>
          )}
          {editing && (
            <form
              className="planner-editor"
              onSubmit={(e) => {
                e.preventDefault();
                if (!validRange(editing.start, editing.end)) {
                  setError("The block must end after it starts.");
                  return;
                }
                if (
                  blocks.some(
                    (b) => b.id !== editing.id && overlaps(b, editing),
                  )
                ) {
                  setError(
                    "That time overlaps another block. Choose an open time.",
                  );
                  return;
                }
                setBlocks([
                  ...blocks.filter((b) => b.id !== editing.id),
                  { ...editing, title: editing.title.trim() },
                ]);
                setEditing(null);
                setError("");
              }}
            >
              <div className="planner-section-title">
                <h3>
                  {blocks.some((b) => b.id === editing.id)
                    ? "Edit block"
                    : "Make room for something"}
                </h3>
                <button
                  type="button"
                  className="icon-control"
                  aria-label="Close block editor"
                  onClick={() => setEditing(null)}
                >
                  <X size={16} />
                </button>
              </div>
              <label>
                Activity
                <input
                  autoFocus
                  required
                  maxLength={180}
                  value={editing.title}
                  onChange={(e) =>
                    setEditing({ ...editing, title: e.target.value })
                  }
                />
              </label>
              <div className="planner-settings">
                <label>
                  Start
                  <input
                    type="time"
                    required
                    value={editing.start}
                    onChange={(e) =>
                      setEditing({ ...editing, start: e.target.value })
                    }
                  />
                </label>
                <label>
                  End
                  <input
                    type="time"
                    required
                    value={editing.end}
                    onChange={(e) =>
                      setEditing({ ...editing, end: e.target.value })
                    }
                  />
                </label>
                <label>
                  Type
                  <select
                    value={editing.kind}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        kind: e.target.value as PlanBlock["kind"],
                      })
                    }
                  >
                    <option value="focus">Focus</option>
                    <option value="break">Break</option>
                    <option value="personal">Personal</option>
                  </select>
                </label>
              </div>
              <label>
                Notes
                <textarea
                  maxLength={500}
                  value={editing.note || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, note: e.target.value })
                  }
                />
              </label>
              <button
                className="workspace-primary"
                disabled={!editing.title.trim()}
                type="submit"
              >
                Save block
              </button>
            </form>
          )}
          {blocks.length ? (
            <div className="planner-timeline">
              {blocks.map((block) => (
                <article
                  key={block.id}
                  className={`planner-block planner-kind-${block.kind} ${block.done ? "is-done" : ""}`}
                >
                  <div className="planner-time">
                    <time>{timeLabel(block.start)}</time>
                    <span>{timeLabel(block.end)}</span>
                  </div>
                  <div className="planner-track">
                    <span />
                  </div>
                  <div className="planner-block-card">
                    <div className="planner-block-top">
                      <span className="planner-block-kind">
                        {block.kind === "routine" ? (
                          <GraduationCap size={12} />
                        ) : block.kind === "break" ? (
                          <Coffee size={12} />
                        ) : (
                          <Clock3 size={12} />
                        )}
                        {block.kind === "routine"
                          ? "Weekly routine"
                          : block.kind === "event"
                            ? "Calendar"
                            : block.kind}
                        <span>·</span>
                        {durationLabel(
                          minutes(block.end) - minutes(block.start),
                        )}
                      </span>
                      <div className="planner-block-actions">
                        {!block.sourceId && (
                          <>
                            <button
                              disabled={busy}
                              className="icon-control"
                              aria-label={`${block.locked ? "Unlock" : "Lock"} ${block.title}`}
                              title={
                                block.locked
                                  ? "Keep on replan: on"
                                  : "Keep on replan: off"
                              }
                              onClick={() =>
                                patchBlock(block, { locked: !block.locked })
                              }
                            >
                              {block.locked ? (
                                <LockKeyhole size={14} />
                              ) : (
                                <Unlock size={14} />
                              )}
                            </button>
                            <button
                              disabled={busy}
                              className="icon-control"
                              aria-label={`Edit ${block.title}`}
                              onClick={() => {
                                setEditing(block);
                                setError("");
                              }}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              disabled={busy}
                              className="icon-control"
                              aria-label={`Delete ${block.title}`}
                              onClick={() =>
                                setBlocks(
                                  blocks.filter((b) => b.id !== block.id),
                                )
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                        {block.sourceId && (
                          <span title="Fixed commitment">
                            <LockKeyhole size={13} />
                          </span>
                        )}
                        <button
                          disabled={busy}
                          className={`planner-check ${block.done ? "checked" : ""}`}
                          aria-label={`Mark ${block.title} ${block.done ? "incomplete" : "done"}`}
                          aria-pressed={!!block.done}
                          onClick={() =>
                            patchBlock(block, { done: !block.done })
                          }
                        >
                          {block.done && <Check size={13} />}
                        </button>
                      </div>
                    </div>
                    <h3>{block.title}</h3>
                    {block.note && <p>{block.note}</p>}
                    {block.taskId && (
                      <small className="planner-caption">
                        Task work session · original task status stays separate
                      </small>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="planner-empty">
              <Sun size={36} strokeWidth={1} />
              <h3>A fresh page for your day.</h3>
              <p>
                Add your weekly commitments, then let Iris connect the dots.
                <br />
                You can also build your plan one block at a time.
              </p>
            </div>
          )}
          {!!plan?.unscheduled.length && (
            <div className="planner-overflow">
              <h3>For another moment</h3>
              <p>
                These activities didn’t fit. Nothing was squeezed over your
                commitments.
              </p>
              {plan.unscheduled.map((title, i) => (
                <span key={i}>{title}</span>
              ))}
            </div>
          )}
          <p className="planner-caption planner-footer">
            Edits save automatically through your workspace. Replanning keeps
            locked and completed blocks. Fixed commitments are edited at their
            source.
          </p>
        </div>
        <aside className="planner-aside">
          <section className="planner-side-card">
            <div className="planner-section-title">
              <h2>Your weekly anchors</h2>
              <button
                className="icon-control"
                disabled={busy}
                aria-label="Add recurring commitment"
                onClick={() =>
                  setRoutine({
                    id: crypto.randomUUID(),
                    title: "",
                    start: "09:00",
                    end: "10:00",
                    days: [1, 2, 3, 4, 5],
                  })
                }
              >
                <Plus size={17} />
              </button>
            </div>
            <p>
              Classes, shifts, and the everyday essentials. Iris plans around
              these times.
            </p>
            {data.routines.map((r) => (
              <div className="planner-routine" key={r.id}>
                <button
                  disabled={busy}
                  onClick={() => {
                    setRoutine(r);
                    setError("");
                  }}
                >
                  <strong>{r.title}</strong>
                  <span>
                    {r.days.map((d) => DAY_NAMES[d].slice(0, 3)).join(", ")}
                  </span>
                  <small>
                    {timeLabel(r.start)} – {timeLabel(r.end)}
                  </small>
                </button>
                <button
                  disabled={busy}
                  className="icon-control"
                  aria-label={`Delete routine ${r.title}`}
                  onClick={() =>
                    updateData((d) => ({
                      ...d,
                      routines: d.routines.filter((v) => v.id !== r.id),
                    }))
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!data.routines.length && (
              <button
                disabled={busy}
                className="planner-add-routine"
                onClick={() =>
                  setRoutine({
                    id: crypto.randomUUID(),
                    title: "",
                    start: "09:00",
                    end: "10:00",
                    days: [1, 3, 5],
                  })
                }
              >
                <Plus size={16} /> Add a class or routine
              </button>
            )}
            {routine && (
              <form
                className="planner-routine-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    !routine.title.trim() ||
                    !validRange(routine.start, routine.end) ||
                    !routine.days.length
                  ) {
                    setError(
                      "Choose at least one day and an end time after the start.",
                    );
                    return;
                  }
                  updateData((d) => ({
                    ...d,
                    routines: [
                      ...d.routines.filter((r) => r.id !== routine.id),
                      { ...routine, title: routine.title.trim() },
                    ],
                  }));
                  setRoutine(null);
                  setError("");
                }}
              >
                <label>
                  Name
                  <input
                    required
                    maxLength={180}
                    placeholder="CS 3600 lecture"
                    value={routine.title}
                    onChange={(e) =>
                      setRoutine({ ...routine, title: e.target.value })
                    }
                  />
                </label>
                <div className="planner-weekdays">
                  {DAYS.map((d, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-label={DAY_NAMES[i]}
                      aria-pressed={routine.days.includes(i)}
                      onClick={() =>
                        setRoutine({
                          ...routine,
                          days: routine.days.includes(i)
                            ? routine.days.filter((v) => v !== i)
                            : [...routine.days, i].sort(),
                        })
                      }
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <div className="planner-settings">
                  <label>
                    From
                    <input
                      required
                      type="time"
                      value={routine.start}
                      onChange={(e) =>
                        setRoutine({ ...routine, start: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    To
                    <input
                      required
                      type="time"
                      value={routine.end}
                      onChange={(e) =>
                        setRoutine({ ...routine, end: e.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="planner-form-actions">
                  <button
                    type="submit"
                    disabled={!routine.title.trim()}
                    className="workspace-primary"
                  >
                    Save routine
                  </button>
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => setRoutine(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>
          <section className="planner-side-card">
            <div className="planner-section-title">
              <h2>On the horizon</h2>
              <span>{tasks.length}</span>
            </div>
            <p>
              Open tasks due within 7 days, overdue work, and tasks without a
              deadline.
            </p>
            {tasks.slice(0, 8).map((task) => (
              <div className="planner-deadline" key={task.id}>
                <span
                  className={`planner-priority priority-${task.priority}`}
                />
                <div>
                  <strong>{task.title}</strong>
                  <small>
                    {task.subsection || task.section} <span>·</span>{" "}
                    {task.dueDate
                      ? task.dueDate < date
                        ? `Overdue · ${task.dueDate}`
                        : task.dueDate === date
                          ? `Due today${task.dueTime ? ` at ${timeLabel(task.dueTime)}` : ""}`
                          : `Due ${new Date(`${task.dueDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                      : "No deadline"}
                  </small>
                </div>
              </div>
            ))}
            {!tasks.length && (
              <div className="planner-caption">
                No upcoming deadlines. Make room for the things you want to do.
              </div>
            )}
            {tasks.length > 8 && (
              <span className="planner-caption">
                {tasks.length > 60
                  ? "Planning considers the first 60 tasks, ordered by deadline and priority."
                  : `+${tasks.length - 8} more considered when planning`}
              </span>
            )}
          </section>
          <div className="planner-tip">
            <Sparkles size={17} />
            <p>
              <strong>Keep the parts that work.</strong>Lock a block before
              replanning. Iris will build the rest of your day around it.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Pause, Pencil, Play, Plus, Repeat, RefreshCw, X } from "lucide-react";
import type { BrainState, Routine, RoutineCondition, RoutineFrequency } from "../types";
import { routineFields } from "../services/brainTools";
import { routineRuns, runRoutineNow, serverFeatures, type RoutineRun } from "../services/serverApi";
import { REMOTE_CHANGE_EVENT } from "../services/cloudSync";
import { CONDITION_LABELS, defaultTimeZone, describeSchedule, MAX_ROUTINES, nextRun, ROUTINE_CONDITIONS, ROUTINE_INSTRUCTIONS_MAX } from "../utils/routines";
import { formatTime } from "../utils/events";
import { getLocalDateString } from "../utils/habitStreaks";
import { PageHeading } from "./workspace/PageHeading";
import { DialogBackdrop } from "./workspace/DialogBackdrop";

type Draft = Pick<Routine, "name" | "instructions" | "frequency" | "time" | "onlyIf" | "mode" | "notify"> & { days: number[]; dayOfMonth: number };

/** Ready-made routines: one click fills the editor, which the user can adjust before saving. */
const TEMPLATES: Array<{ title: string; detail: string; draft: Draft }> = [
  { title: "Morning plan", detail: "Weekdays at 7:30 AM", draft: { name: "Morning plan", frequency: "weekdays", time: "07:30", days: [1], dayOfMonth: 1, onlyIf: "always", mode: "act", notify: true,
    instructions: "Look at today's tasks, events and anything overdue. Pick the three things that matter most today and say why. Lay out a realistic schedule around my events, and flag conflicts or tight gaps." } },
  { title: "Weekly review", detail: "Sundays at 6:00 PM", draft: { name: "Weekly review", frequency: "weekly", time: "18:00", days: [0], dayOfMonth: 1, onlyIf: "always", mode: "suggest", notify: true,
    instructions: "Review my past week: what I finished, what slipped, and how my goals and habits went. Propose moving unfinished tasks to sensible days next week, and list next week's deadlines and events." } },
  { title: "Overdue cleanup", detail: "Daily at 8:00 PM, only when something is overdue", draft: { name: "Overdue cleanup", frequency: "daily", time: "20:00", days: [1], dayOfMonth: 1, onlyIf: "overdue_tasks", mode: "suggest", notify: true,
    instructions: "Go through my overdue tasks. For each, propose a realistic new due date based on its priority and what else is due, or suggest dropping it if it no longer matters." } },
  { title: "Deadline heads-up", detail: "Daily at 9:00 AM, only when something is due soon", draft: { name: "Deadline heads-up", frequency: "daily", time: "09:00", days: [1], dayOfMonth: 1, onlyIf: "due_soon", mode: "act", notify: true,
    instructions: "Check what's due in the next two days. For anything big that isn't started, break it into two or three concrete subtasks and tell me what to start first." } },
  { title: "Job search follow-ups", detail: "Mondays at 10:00 AM", draft: { name: "Job search follow-ups", frequency: "weekly", time: "10:00", days: [1], dayOfMonth: 1, onlyIf: "always", mode: "act", notify: true,
    instructions: "Look at my job applications. For any I applied to more than a week ago with no update, add a task to follow up. Summarize where each active application stands." } },
];
const EMPTY: Draft = { name: "", instructions: "", frequency: "daily", time: "08:00", days: [1], dayOfMonth: 1, onlyIf: "always", mode: "act", notify: true };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FREQUENCIES: Array<[RoutineFrequency, string]> = [["daily", "Daily"], ["weekdays", "Weekdays"], ["weekly", "Weekly"], ["monthly", "Monthly"]];

const field = "w-full bg-slate-50 dark:bg-slate-800/80 text-xs text-ink px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-white transition-all";
const label = "block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1";
const pill = (on: boolean) => `py-1.5 rounded-xl text-[11px] font-bold transition-all ${on ? "bg-white dark:bg-slate-700 text-ink shadow-xs" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`;

function whenLabel(date: string, time: string) {
  const today = getLocalDateString();
  const tomorrow = getLocalDateString(new Date(Date.now() + 86_400_000));
  const day = date === today ? "Today" : date === tomorrow ? "Tomorrow" : new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${day}, ${formatTime(time)}`;
}
const ranAt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Work the assistant does on its own on a schedule, and what each run did. */
export function RoutinesView({ state, onChange }: { state: BrainState; onChange: (update: (prev: BrainState) => BrainState) => void }) {
  const routines = state.routines || [];
  const [editing, setEditing] = useState<{ routine: Routine | null; draft: Draft } | null>(null);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [server, setServer] = useState<boolean | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadRuns = useCallback(() => routineRuns().then(setRuns).catch(() => { /* History is optional; the list still works. */ }), []);
  useEffect(() => {
    let live = true;
    serverFeatures().then(f => { if (!live) return; setServer(f.agent); if (f.agent) void loadRuns(); }).catch(() => live && setServer(false));
    return () => { live = false; };
  }, [loadRuns]);

  const save = (routine: Routine) => onChange(prev => {
    const list = prev.routines || [];
    return { ...prev, routines: list.some(r => r.id === routine.id) ? list.map(r => r.id === routine.id ? routine : r) : [...list, routine] };
  });
  const remove = (id: string) => onChange(prev => ({ ...prev, routines: (prev.routines || []).filter(r => r.id !== id) }));
  const toggle = (routine: Routine) => save({ ...routine, enabled: !routine.enabled, updatedAt: new Date().toISOString() });

  const runNow = async (routine: Routine) => {
    setError(""); setRunning(routine.id);
    try {
      const { runs: next } = await runRoutineNow(routine.id);
      setRuns(next);
      setExpanded(next[0]?.id ?? null);
      window.dispatchEvent(new Event(REMOTE_CHANGE_EVENT)); // Pick up what the run changed and its report.
    } catch (e) {
      setError(e instanceof Error ? e.message : "The routine could not run.");
    } finally { setRunning(null); }
  };

  const open = (routine: Routine | null, draft?: Draft) => setEditing({ routine, draft: draft || (routine ? {
    name: routine.name, instructions: routine.instructions, frequency: routine.frequency, time: routine.time, onlyIf: routine.onlyIf, mode: routine.mode, notify: routine.notify,
    days: routine.days?.length ? routine.days : [1], dayOfMonth: routine.dayOfMonth || 1 } : EMPTY) });
  const nameOf = (id: string) => routines.find(r => r.id === id)?.name || "Deleted routine";
  const lastRun = (id: string) => runs.find(r => r.routineId === id);
  const now = new Date();

  return <section className="events-page routines-page" aria-label="Routines">
    <PageHeading title="Routines" description="Work the assistant does for you on a schedule. Each run's report lands in its own chat.">
      <button className="workspace-primary" disabled={routines.length >= MAX_ROUTINES} onClick={() => open(null)}><Plus size={16} /> New routine</button>
    </PageHeading>

    {server === false && <p className="routines-note" role="status"><AlertTriangle size={14} /> Routines run on Synapse's server. Sign in to a hosted account and add your AI key in Settings so they can run while the app is closed.</p>}
    {error && <p className="routines-note routines-error" role="alert"><AlertTriangle size={14} /> {error}</p>}

    {routines.length > 0 ? <div className="events-day-list routines-list">{routines.map(routine => {
      const next = nextRun(routine, now);
      const last = lastRun(routine.id);
      return <article className={`events-row routines-row${routine.enabled ? "" : " is-paused"}`} key={routine.id} data-record-id={routine.id}>
        <div className="events-time"><Repeat size={14} /><span>{describeSchedule(routine)}<small>{next ? `Next: ${whenLabel(next.date, next.time)}` : "Paused"}</small></span></div>
        <div className="events-details">
          <div className="events-title-line"><button className="events-title" onClick={() => open(routine)}>{routine.name}</button>
            <span className="events-kind-label">{routine.mode === "suggest" ? "Suggests changes" : "Makes changes"}{routine.onlyIf !== "always" ? ` · ${CONDITION_LABELS[routine.onlyIf].toLocaleLowerCase()}` : ""}</span></div>
          <p className="events-notes">{routine.instructions}</p>
          {last && <div className="events-meta"><span>{last.status === "failed" ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}Last run {ranAt(last.startedAt)}: {last.status === "running" ? "running" : last.status}</span></div>}
        </div>
        <div className="events-row-actions">
          {server && <button className="icon-control" aria-label={`Run ${routine.name} now`} title="Run now" disabled={running !== null} onClick={() => runNow(routine)}>
            {running === routine.id ? <RefreshCw size={15} className="animate-spin" /> : <Play size={15} />}</button>}
          {routine.enabled
            ? <button className="icon-control" aria-label={`Pause ${routine.name}`} title="Pause" onClick={() => toggle(routine)}><Pause size={15} /></button>
            : <button className="events-link" onClick={() => toggle(routine)}>Resume<span className="sr-only"> {routine.name}</span></button>}
          <button className="icon-control" aria-label={`Edit ${routine.name}`} onClick={() => open(routine)}><Pencil size={15} /></button>
        </div>
      </article>;
    })}</div> : <div className="events-empty">
      <Repeat size={30} strokeWidth={1.25} />
      <h2>No routines yet</h2>
      <p>Pick a starting point below, or ask in chat: "every weekday at 8, plan my day".</p>
    </div>}

    <h2 className="routines-heading">Start from a template</h2>
    <div className="routines-templates">{TEMPLATES.map(t => {
      const exists = routines.some(r => r.name.toLocaleLowerCase() === t.draft.name.toLocaleLowerCase());
      return <button key={t.title} className="routines-template" disabled={exists || routines.length >= MAX_ROUTINES} onClick={() => open(null, t.draft)}>
        <strong>{t.title}</strong><span>{exists ? "Already set up" : t.detail}</span></button>;
    })}</div>

    {server && <>
      <div className="routines-heading-row"><h2 className="routines-heading">Recent runs</h2>
        <button className="icon-control" aria-label="Refresh runs" title="Refresh" onClick={() => loadRuns()}><RefreshCw size={15} /></button></div>
      {runs.length ? <div className="events-day-list">{runs.map(run => <article className={`events-row routines-run is-${run.status}`} key={run.id}>
        <div className="events-time"><Clock size={14} /><span>{ranAt(run.startedAt)}<small>{run.slot.startsWith("manual-") ? "Started by you" : "Scheduled"}</small></span></div>
        <div className="events-details">
          <div className="events-title-line"><button className="events-title" onClick={() => setExpanded(expanded === run.id ? null : run.id)} aria-expanded={expanded === run.id}>{nameOf(run.routineId)}</button>
            <span className="events-kind-label">{run.status}{run.changes ? ` · ${run.changes} change${run.changes === 1 ? "" : "s"}` : ""}{run.approvals ? ` · ${run.approvals} waiting for approval` : ""}</span></div>
          {run.summary && <p className={`events-notes${expanded === run.id ? " is-expanded" : ""}`}>{run.summary}</p>}
        </div>
        <div />
      </article>)}</div> : <p className="events-result-count">No runs yet. Scheduled runs and the ones you start appear here.</p>}
    </>}

    {editing && <RoutineEditor routine={editing.routine} initial={editing.draft} onClose={() => setEditing(null)}
      onSave={routine => { save(routine); setEditing(null); }} onDelete={editing.routine ? () => { remove(editing.routine!.id); setEditing(null); } : undefined}
      taken={name => routines.some(r => r.id !== editing.routine?.id && r.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase())} />}
  </section>;
}

function RoutineEditor({ routine, initial, onClose, onSave, onDelete, taken }: {
  routine: Routine | null; initial: Draft; onClose: () => void; onSave: (routine: Routine) => void; onDelete?: () => void; taken: (name: string) => boolean;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => ({ ...d, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (taken(draft.name)) return setError("Another routine already has this name.");
    const now = new Date().toISOString();
    const base: Routine = routine || { id: crypto.randomUUID(), enabled: true, timeZone: defaultTimeZone(), createdAt: now } as Routine;
    try {
      // The same checks the assistant's routine tools use, so both save the same shape.
      onSave({ ...routineFields(base, { ...draft, timeZone: routine?.timeZone || defaultTimeZone() }), updatedAt: now });
    } catch (err) { setError(err instanceof Error ? err.message : "Check the routine's settings."); }
  };

  return <DialogBackdrop onClose={onClose} label="Routine details" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in">
    <div className="workspace-dialog bg-panel rounded-3xl border border-line shadow-2xl w-full max-w-lg overflow-visible flex flex-col max-h-[92vh]">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <div>
          <h3 className="font-extrabold text-base tracking-tight text-ink">{routine ? "Edit routine" : "New routine"}</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">The assistant does this on its own, on schedule</p>
        </div>
        <button aria-label="Close dialog" onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"><X className="w-4 h-4" /></button>
      </div>
      <form onSubmit={submit} className="p-6 space-y-4 overflow-y-auto">
        <div>
          <label htmlFor="routine-name" className={label}>Name *</label>
          <input id="routine-name" required autoFocus maxLength={48} placeholder="e.g. Morning plan" value={draft.name} onChange={e => set("name", e.target.value)} className={`${field} font-bold`} />
        </div>
        <div>
          <label htmlFor="routine-instructions" className={label}>What should it do? *</label>
          <textarea id="routine-instructions" required rows={4} maxLength={ROUTINE_INSTRUCTIONS_MAX} placeholder="e.g. Look at what's due this week and plan my day around my classes."
            value={draft.instructions} onChange={e => set("instructions", e.target.value)} className={`${field} resize-y`} />
        </div>
        <div>
          <span className={label}>Repeats</span>
          <div className="grid grid-cols-4 gap-1.5 bg-raised p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700" role="radiogroup" aria-label="Repeats">
            {FREQUENCIES.map(([value, text]) => <button key={value} type="button" role="radio" aria-checked={draft.frequency === value} onClick={() => set("frequency", value)} className={pill(draft.frequency === value)}>{text}</button>)}
          </div>
        </div>
        {draft.frequency === "weekly" && <div>
          <span className={label}>On</span>
          <div className="grid grid-cols-7 gap-1 bg-raised p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700" role="group" aria-label="Days of the week">
            {DAYS.map((day, i) => { const on = draft.days.includes(i); return <button key={day} type="button" aria-pressed={on} className={pill(on)}
              onClick={() => set("days", on ? draft.days.filter(d => d !== i) : [...draft.days, i])}>{day}</button>; })}
          </div>
        </div>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="routine-time" className={label}>Time *</label>
            <input id="routine-time" type="time" required value={draft.time} onChange={e => set("time", e.target.value)} className={`${field} font-bold`} />
          </div>
          {draft.frequency === "monthly" && <div>
            <label htmlFor="routine-day" className={label}>Day of month</label>
            <input id="routine-day" type="number" min={1} max={31} value={draft.dayOfMonth} onChange={e => set("dayOfMonth", Number(e.target.value))} className={field} />
          </div>}
        </div>
        <div>
          <label htmlFor="routine-condition" className={label}>Run</label>
          <select id="routine-condition" value={draft.onlyIf} onChange={e => set("onlyIf", e.target.value as RoutineCondition)} className={field}>
            {ROUTINE_CONDITIONS.map(c => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
          </select>
          <p className="text-[11px] text-slate-400 mt-1">Skipped runs use no AI credits.</p>
        </div>
        <div>
          <span className={label}>Changes</span>
          <div className="grid grid-cols-2 gap-1.5 bg-raised p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700" role="radiogroup" aria-label="Changes">
            <button type="button" role="radio" aria-checked={draft.mode === "act"} onClick={() => set("mode", "act")} className={pill(draft.mode === "act")}>Make them</button>
            <button type="button" role="radio" aria-checked={draft.mode === "suggest"} onClick={() => set("mode", "suggest")} className={pill(draft.mode === "suggest")}>Ask me first</button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Deletions and changes after reading email or the web always wait for your approval.</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
          <input type="checkbox" checked={draft.notify} onChange={e => set("notify", e.target.checked)} className="accent-slate-900" /> Also send the report to Telegram when it's connected
        </label>
        {error && <p role="alert" className="text-xs font-semibold text-rose-500">{error}</p>}
        <div className="flex items-center justify-between pt-2">
          {onDelete ? (confirmDelete
            ? <span className="flex items-center gap-2 text-xs"><span className="text-slate-500">Delete this routine?</span>
                <button type="button" className="font-bold text-rose-500" onClick={onDelete}>Delete</button>
                <button type="button" className="font-bold text-slate-500" onClick={() => setConfirmDelete(false)}>Cancel</button></span>
            : <button type="button" className="text-xs font-bold text-rose-500" onClick={() => setConfirmDelete(true)}>Delete</button>) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-2xl text-xs font-bold text-slate-500 hover:text-ink">Cancel</button>
            <button type="submit" className="workspace-primary">{routine ? "Save" : "Create routine"}</button>
          </div>
        </div>
      </form>
    </div>
  </DialogBackdrop>;
}

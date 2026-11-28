import { useMemo, useState } from "react";
import { AlertTriangle, Check, Dumbbell, Lightbulb, Play, Plus, Scale, Sparkles, Trophy } from "lucide-react";
import type { PlanDay, WorkoutPlan, WorkoutSession } from "../../../types";
import { exerciseById, measureOf } from "../../../utils/exercises";
import {
  activePlan, addDays, fmtWeight, fromUnit, isFinished, personalRecords, planDayFor, sessionSets, sessionVolume, suggestNext, toUnit,
  trainingStats, weekStart, type TrainingStats,
} from "../../../utils/training";
import { ExerciseLibrary } from "./ExerciseLibrary";
import { PlanView } from "./PlanView";
import { ProgressView } from "./ProgressView";
import { WorkoutLogger } from "./WorkoutLogger";
import { compact, dayLabel, NumField, shortDate, WEEK_ORDER, WEEKDAYS, type TrainingApi } from "./shared";
import "../../../training.css";

type Tab = "overview" | "log" | "plan" | "progress" | "history" | "exercises";
const TABS: Array<[Tab, string]> = [["overview", "Overview"], ["log", "Workout"], ["plan", "Plan"], ["progress", "Progress"], ["history", "History"], ["exercises", "Exercises"]];

export function TrainingView({ api }: { api: TrainingApi }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [openId, setOpenId] = useState<string | null>(null);
  const live = api.workouts.find(w => !isFinished(w));
  const open = api.workouts.find(w => w.id === openId) || live;
  const stats = useMemo(() => trainingStats(api.workouts, api.plans, api.days, api.today, api.unit, api.goalWeightKg), [api.workouts, api.plans, api.days, api.today, api.unit, api.goalWeightKg]);

  const start = (plan?: WorkoutPlan, day?: PlanDay) => {
    if (live) { setOpenId(live.id); setTab("log"); return; }
    const now = new Date().toISOString();
    const session: WorkoutSession = {
      id: crypto.randomUUID(), date: api.today, name: day?.name || "Workout", startedAt: now, createdAt: now, updatedAt: now,
      ...(plan && day ? { planId: plan.id, planDayId: day.id } : {}),
      exercises: (day?.exercises || []).map(e => ({ id: crypto.randomUUID(), exerciseId: e.exerciseId, name: e.name, sets: Array.from({ length: e.sets }, () => ({})) })),
    };
    api.saveWorkout(session);
    setOpenId(session.id);
    setTab("log");
  };
  const logPast = () => {
    const now = new Date().toISOString();
    const session: WorkoutSession = { id: crypto.randomUUID(), date: api.today, name: "Workout", exercises: [], createdAt: now, updatedAt: now };
    api.saveWorkout(session);
    setOpenId(session.id);
    setTab("log");
  };

  return (
    <div className="tr-root">
      <div className="tr-subnav">
        <div className="hl-views" role="tablist" aria-label="Training views">
          {TABS.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); if (t === "log" && !live) setOpenId(null); }}>
              {t === "log" && live ? "Workout ●" : label}
            </button>
          ))}
        </div>
        <div className="tr-subnav-actions">
          <span className="tr-unit" role="group" aria-label="Weight unit">
            {(["lb", "kg"] as const).map(u => <button key={u} type="button" aria-pressed={api.unit === u} onClick={() => api.setUnit(u)}>{u}</button>)}
          </span>
          {!live && tab !== "log" && <button type="button" className="ws-button ws-primary" onClick={() => start()}><Play size={14} />Start workout</button>}
        </div>
      </div>

      {tab === "overview" ? <Overview api={api} stats={stats} live={live} onStart={start} onLogPast={logPast} onOpen={id => { setOpenId(id); setTab("log"); }} onTab={setTab} />
        : tab === "log" ? (open ? <WorkoutLogger key={open.id} api={api} session={open} onDone={() => { setOpenId(null); setTab("overview"); }} />
          : <div className="hl-empty"><span className="ws-icon ws-color-rose"><Dumbbell size={22} /></span><strong>No workout in progress</strong>
              <p>Start one now and log sets as you go, with a rest timer and last time's numbers beside each set. Or log a session you already did.</p>
              <div className="hl-empty-actions"><button className="ws-button ws-primary" onClick={() => start()}><Play size={15} />Start empty workout</button>
                {activePlan(api.plans) && (() => { const d = planDayFor(activePlan(api.plans), api.workouts, api.today); return d ? <button className="ws-button ws-secondary" onClick={() => start(activePlan(api.plans), d.day)}><Play size={15} />Start {d.day.name}</button> : null; })()}
                <button className="ws-button ws-secondary" onClick={logPast}><Plus size={15} />Log a past workout</button></div></div>)
        : tab === "plan" ? <PlanView api={api} onStartDay={start} />
        : tab === "progress" ? <ProgressView api={api} stats={stats} />
        : tab === "history" ? <History api={api} onOpen={id => { setOpenId(id); setTab("log"); }} onLogPast={logPast} />
        : <ExerciseLibrary workouts={api.workouts} unit={api.unit} onAddToWorkout={live ? e => {
            api.saveWorkout({ ...live, exercises: [...live.exercises, { id: crypto.randomUUID(), exerciseId: e.exerciseId, name: e.name, sets: [{}, {}, {}] }], updatedAt: new Date().toISOString() });
            setOpenId(live.id); setTab("log");
          } : undefined} />}
    </div>
  );
}

function Overview({ api, stats, live, onStart, onLogPast, onOpen, onTab }: {
  api: TrainingApi; stats: TrainingStats; live?: WorkoutSession; onStart: (plan?: WorkoutPlan, day?: PlanDay) => void; onLogPast: () => void; onOpen: (id: string) => void; onTab: (t: Tab) => void;
}) {
  const { unit } = api;
  const plan = activePlan(api.plans);
  const next = planDayFor(plan, api.workouts, api.today);
  const todays = api.workouts.filter(w => w.date === api.today && isFinished(w) && sessionSets(w) > 0);
  const doneToday = todays.length > 0;
  const recent = [...api.workouts].filter(w => isFinished(w) && sessionSets(w) > 0).reverse().slice(0, 5);
  const prsBySession = useMemo(() => {
    const map = new Map<string, number>();
    const done = api.workouts.filter(isFinished);
    for (const r of personalRecords(done)) if (r.kind === "e1rm" || r.kind === "weight" || r.kind === "reps") {
      const s = done.find(w => w.date === r.date && w.exercises.some(e => e.exerciseId === r.exerciseId));
      if (s) map.set(s.id, (map.get(s.id) || 0) + 1);
    }
    return map;
  }, [api.workouts]);

  // This week's days, Monday first.
  const monday = weekStart(api.today);
  const trained = new Set(api.workouts.filter(w => isFinished(w) && sessionSets(w) > 0).map(w => w.date));
  const planned = new Set(plan?.days.flatMap(d => d.weekdays || []) || []);

  return (
    <div className="tr-root">
      {!api.workouts.length && !api.plans.length && (
        <div className="hl-notice"><Sparkles size={15} />Pick a split like Push / Pull / Legs in Plan, or just start a workout. Every exercise you log builds your charts and records.
          <button className="ws-button ws-secondary" onClick={() => onTab("plan")}>Choose a plan</button></div>
      )}
      <div className="tr-grid3">
        <section className="hl-card">
          <header><span>{live ? "Workout in progress" : doneToday ? "Done for today" : "Today"}</span><small>{dayLabel(api.today)}</small></header>
          {live ? (
            <>
              <div><div className="tr-title">{live.name}</div><p className="tr-sub">{live.exercises.length} exercises · {live.exercises.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0)} sets done</p></div>
              <footer><button className="ws-button ws-primary" onClick={() => onOpen(live.id)}><Play size={14} />Resume</button></footer>
            </>
          ) : doneToday ? (
            <>
              <div><div className="tr-title">{todays.map(w => w.name).join(" + ")}</div>
                <p className="tr-sub">{todays.reduce((n, w) => n + sessionSets(w), 0)} working sets{todays[0].durationMin ? ` · ${todays.reduce((n, w) => n + (w.durationMin || 0), 0)} min` : ""}. Nice work.</p></div>
              <ul className="tr-plan-list">{todays.flatMap(w => w.exercises).slice(0, 7).map(e => <li key={e.id}><span>{e.name}</span><small>{e.sets.length} sets</small></li>)}</ul>
              <footer>
                <button className="ws-button ws-secondary" onClick={() => onOpen(todays[0].id)}>View workout</button>
                <button className="ws-button ws-secondary" onClick={() => onStart()}><Plus size={14} />Another workout</button>
              </footer>
            </>
          ) : next ? (
            <>
              <div><div className="tr-title">{next.day.name}</div><p className="tr-sub">{plan!.name}{next.scheduled ? "" : " · next in rotation"}</p></div>
              <ul className="tr-plan-list">
                {next.day.exercises.slice(0, 7).map(e => {
                  const s = suggestNext(api.workouts, e.exerciseId, e.reps, unit);
                  const measure = measureOf(exerciseById(e.exerciseId, e.name));
                  return <li key={e.id}><span>{e.name}</span><small>{e.sets} × {e.reps}{s?.weightKg && measure === "weight_reps" ? ` · ${fmtWeight(s.weightKg, unit)}` : ""}</small></li>;
                })}
                {next.day.exercises.length > 7 && <li><span className="hl-muted">+{next.day.exercises.length - 7} more</span></li>}
              </ul>
              <footer>
                <button className="ws-button ws-primary" onClick={() => onStart(plan, next.day)}><Play size={14} />Start {next.day.name}</button>
                <button className="ws-button ws-secondary" onClick={() => onStart()}>Empty workout</button>
              </footer>
            </>
          ) : (
            <>
              <div><div className="tr-title">{plan ? "Rest day" : "No plan yet"}</div><p className="tr-sub">{plan ? "Nothing scheduled. Recovery is where you get stronger." : "Follow a split and this shows what's next, with weights to try."}</p></div>
              <footer>
                <button className="ws-button ws-primary" onClick={() => onStart()}><Play size={14} />Start a workout</button>
                {!plan && <button className="ws-button ws-secondary" onClick={() => onTab("plan")}>Choose a plan</button>}
                <button className="ws-button ws-secondary" onClick={onLogPast}><Plus size={14} />Log past</button>
              </footer>
            </>
          )}
        </section>

        <section className="hl-card">
          <header><span>This week</span><small>{stats.weekStreak >= 2 ? `${stats.weekStreak} weeks on target` : `target ${stats.target}`}</small></header>
          <div className="hl-big">{stats.thisWeek.sessions}<small>of {stats.target} sessions</small></div>
          <div className="tr-meter"><span style={{ width: `${Math.min(100, (stats.thisWeek.sessions / Math.max(1, stats.target)) * 100)}%` }} /></div>
          <div className="tr-week">
            {WEEK_ORDER.map((wd, i) => {
              const date = addDays(monday, i);
              const done = trained.has(date);
              return (
                <span key={wd} className="tr-week-day">
                  <span className={`tr-week-dot${done ? " tr-done" : planned.has(wd) ? " tr-planned" : ""}${date === api.today ? " tr-today" : ""}`} title={`${dayLabel(date)}${done ? ": trained" : planned.has(wd) ? ": planned" : ""}`}>
                    {done ? <Check size={14} /> : ""}
                  </span>
                  {WEEKDAYS[wd][0]}
                </span>
              );
            })}
          </div>
          <dl className="hl-facts">
            <div><dt>Working sets</dt><dd>{stats.thisWeek.sets}</dd></div>
            <div><dt>Volume</dt><dd>{stats.thisWeek.volumeKg ? `${compact(toUnit(stats.thisWeek.volumeKg, unit))} ${unit}` : "—"}</dd></div>
            <div><dt>Time</dt><dd>{stats.thisWeek.minutes ? `${stats.thisWeek.minutes} min` : "—"}</dd></div>
          </dl>
        </section>

        <WeightCard api={api} stats={stats} />
      </div>

      <div className="tr-grid2">
        <section className="hl-card">
          <header><span>What your training shows</span><Lightbulb size={16} /></header>
          {stats.insights.length ? (
            <ul className="hl-insights">
              {stats.insights.slice(0, 6).map(i => (
                <li key={i.id} className={`hl-insight ${i.tone === "good" ? "hl-insight-good" : i.tone === "warn" ? "tr-insight-warn" : ""}`}>
                  <span className="hl-insight-icon">{i.tone === "good" ? <Trophy size={15} /> : i.tone === "warn" ? <AlertTriangle size={15} /> : <Lightbulb size={15} />}</span>
                  <div><strong>{i.title}</strong><p>{i.detail}</p></div>
                </li>
              ))}
            </ul>
          ) : <p className="hl-muted hl-small">Trends, plateaus, muscle balance and records show up after a few sessions. Log at least three sessions of a lift to see its trend.</p>}
          <footer>
            <button className="ws-button ws-secondary" onClick={() => api.onAsk("Look at my training with training_summary (and health_summary if I have Apple Health data). Tell me what's going well, what's stalled and why, whether my split and weekly volume make sense for each muscle, and the three most useful changes I could make. Be specific with exercises, sets and weights.")}>
              <Sparkles size={14} />Ask Iris to find trends
            </button>
            <button className="ws-button ws-secondary" onClick={() => onTab("progress")}>See charts</button>
          </footer>
        </section>
        <section className="hl-card">
          <header><span>Recent workouts</span>{recent.length > 0 && <button className="hl-link" onClick={() => onTab("history")}>All history</button>}</header>
          {recent.length ? <SessionList sessions={recent} unit={unit} prs={prsBySession} onOpen={onOpen} /> : <p className="hl-muted hl-small">Nothing logged yet.</p>}
          {stats.recentRecords.length > 0 && (
            <>
              <header><span>New records</span><small>last two weeks</small></header>
              <ul className="tr-records">
                {stats.recentRecords.filter(r => r.kind !== "volume").slice(0, 4).map((r, i) => (
                  <li key={i}><Trophy size={14} /><span><b>{r.name}</b> {r.kind === "e1rm" ? "estimated max" : r.kind === "weight" ? "heaviest" : "reps"}</span>
                    <small>{r.kind === "reps" ? r.value : r.kind === "weight" ? `${fmtWeight(r.value, unit)}${r.reps ? ` × ${r.reps}` : ""}` : fmtWeight(r.value, unit)} · {shortDate(r.date)}</small></li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function WeightCard({ api, stats }: { api: TrainingApi; stats: TrainingStats }) {
  const { unit } = api;
  const wt = stats.weight;
  const todayKg = api.days.find(d => d.date === api.today)?.metrics.weightKg;
  const [entry, setEntry] = useState<number | undefined>(undefined);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goal, setGoal] = useState<number | undefined>(api.goalWeightKg !== undefined ? toUnit(api.goalWeightKg, unit) : undefined);
  const latest = wt.points[wt.points.length - 1];
  return (
    <section className="hl-card">
      <header>
        <span>Body weight</span>
        {api.onOpenBody ? (
          <button type="button" className="hl-link" style={{ marginTop: 0 }} onClick={api.onOpenBody}>
            Graphs &amp; photos →
          </button>
        ) : (
          <Scale size={16} />
        )}
      </header>
      <div className="hl-big">{latest ? fmtWeight(latest.avg, unit) : "—"}<small>{latest ? `7-day average · last weighed ${shortDate(latest.date)}` : "no weigh-ins yet"}</small></div>
      <dl className="hl-facts">
        <div><dt>Per week</dt><dd>{wt.perWeekKg !== undefined ? `${wt.perWeekKg > 0 ? "+" : ""}${fmtWeight(wt.perWeekKg, unit)}` : "—"}</dd></div>
        <div><dt>30 days</dt><dd>{wt.change30Kg !== undefined ? `${wt.change30Kg > 0 ? "+" : ""}${fmtWeight(wt.change30Kg, unit)}` : "—"}</dd></div>
        <div><dt>Goal</dt><dd><button className="hl-link" style={{ marginTop: 0 }} onClick={() => setGoalOpen(o => !o)}>{api.goalWeightKg ? `${fmtWeight(api.goalWeightKg, unit)}${wt.goalDate ? ` by ~${shortDate(wt.goalDate)}` : ""}` : "Set a goal"}</button></dd></div>
      </dl>
      {goalOpen && (
        <form className="tr-inline-form" onSubmit={e => { e.preventDefault(); api.setGoalWeight(goal === undefined ? undefined : fromUnit(goal, unit)); setGoalOpen(false); }}>
          <NumField label={`Goal weight in ${unit}`} value={goal} placeholder={`Goal (${unit})`} onCommit={setGoal} />
          <button type="submit" className="ws-button ws-secondary">Save</button>
        </form>
      )}
      <form className="tr-inline-form" onSubmit={e => { e.preventDefault(); if (entry) { api.logWeight(api.today, fromUnit(entry, unit)); setEntry(undefined); } }}>
        <NumField label={`Today's weight in ${unit}`} value={entry} placeholder={todayKg ? `Today ${fmtWeight(todayKg, unit)}` : `Weight (${unit})`} onCommit={setEntry} />
        <button type="submit" className="ws-button ws-secondary" disabled={!entry}>Log</button>
      </form>
    </section>
  );
}

function SessionList({ sessions, unit, prs, onOpen }: { sessions: WorkoutSession[]; unit: TrainingApi["unit"]; prs: Map<string, number>; onOpen: (id: string) => void }) {
  return (
    <ul className="tr-sessions">
      {sessions.map(w => {
        const d = new Date(`${w.date}T12:00:00`);
        return (
          <li key={w.id} className="tr-session" tabIndex={0} onClick={() => onOpen(w.id)} onKeyDown={e => { if (e.key === "Enter") onOpen(w.id); }}>
            <span className="tr-session-date"><b>{d.getDate()}</b><small>{d.toLocaleDateString(undefined, { month: "short" })}</small></span>
            <span className="tr-session-main">
              <strong>{w.name}{prs.get(w.id) ? <span className="tr-badge"><Trophy size={11} />{prs.get(w.id)} PR{prs.get(w.id)! > 1 ? "s" : ""}</span> : null}</strong>
              <p>{w.exercises.map(e => e.name).join(", ")}</p>
            </span>
            <span className="tr-session-stats">
              <span>{sessionSets(w)} sets</span>
              {sessionVolume(w) > 0 && <span>{compact(toUnit(sessionVolume(w), unit))} {unit}</span>}
              {w.durationMin ? <span>{w.durationMin} min</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function History({ api, onOpen, onLogPast }: { api: TrainingApi; onOpen: (id: string) => void; onLogPast: () => void }) {
  const [filter, setFilter] = useState("");
  const done = useMemo(() => [...api.workouts].filter(w => isFinished(w)).reverse(), [api.workouts]);
  const shown = filter ? done.filter(w => w.name.toLowerCase().includes(filter.toLowerCase()) || w.exercises.some(e => e.name.toLowerCase().includes(filter.toLowerCase()))) : done;
  const prs = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of personalRecords(done)) if (r.kind !== "volume") {
      const s = done.find(w => w.date === r.date && w.exercises.some(e => e.exerciseId === r.exerciseId));
      if (s) map.set(s.id, (map.get(s.id) || 0) + 1);
    }
    return map;
  }, [done]);
  const weeks = new Map<string, WorkoutSession[]>();
  for (const w of shown) weeks.set(weekStart(w.date), [...(weeks.get(weekStart(w.date)) || []), w]);
  return (
    <section className="hl-card">
      <header>
        <span>All workouts</span>
        <span className="tr-subnav-actions">
          <input className="tr-select" placeholder="Filter by name or exercise" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter workouts" />
          <button className="ws-button ws-secondary" onClick={onLogPast}><Plus size={14} />Log past workout</button>
        </span>
      </header>
      {!shown.length && <p className="hl-muted hl-small">{done.length ? "Nothing matches." : "No workouts yet."}</p>}
      {[...weeks].map(([week, list]) => (
        <div key={week}>
          <div className="tr-week-head"><span>Week of {shortDate(week)}</span><span>{list.length} session{list.length === 1 ? "" : "s"} · {list.reduce((n, w) => n + sessionSets(w), 0)} sets</span></div>
          <SessionList sessions={list} unit={api.unit} prs={prs} onOpen={onOpen} />
        </div>
      ))}
    </section>
  );
}

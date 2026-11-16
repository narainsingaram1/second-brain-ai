import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Sparkles, Timer, Trash2, TrendingUp, X } from "lucide-react";
import type { WorkoutExercise, WorkoutSession, WorkoutSet } from "../../../types";
import { exerciseById, measureOf, titleCase, type Measure } from "../../../utils/exercises";
import { activePlan, exerciseHistory, fmtWeight, fromUnit, isFinished, isLogged, suggestNext, toUnit, type Suggestion } from "../../../utils/training";
import { ExerciseDetail, ExercisePicker } from "./ExerciseLibrary";
import { clock, NumField, TextField, type TrainingApi } from "./shared";

const KIND_LABEL: Record<NonNullable<WorkoutSet["kind"]>, string> = { working: "", warmup: "W", drop: "D", failure: "F" };
const NEXT_KIND: Record<string, WorkoutSet["kind"]> = { working: "warmup", warmup: "drop", drop: "failure", failure: "working" };

/** What a set looked like, in words: "185 lb × 8", "45s", "5.2 km · 28:00". */
export function setText(s: WorkoutSet, unit: TrainingApi["unit"], measure: Measure): string {
  if (measure === "distance_time") return [s.distanceKm ? `${s.distanceKm} km` : "", s.seconds ? clock(s.seconds) : ""].filter(Boolean).join(" · ");
  if (measure === "time" && s.seconds) return `${s.seconds}s`;
  if (s.weightKg) return `${fmtWeight(s.weightKg, unit, false)} × ${s.reps ?? "–"}`;
  return s.reps !== undefined ? `${s.reps} reps` : s.seconds ? `${s.seconds}s` : "";
}

interface Props { api: TrainingApi; session: WorkoutSession; onDone: () => void }

export function WorkoutLogger({ api, session, onDone }: Props) {
  const { unit } = api;
  const live = !isFinished(session);
  const [picker, setPicker] = useState(false);
  const [detail, setDetail] = useState<WorkoutExercise | null>(null);
  const [rest, setRest] = useState<{ until: number; total: number } | null>(null);
  const [, tick] = useState(0);
  const plan = activePlan(api.plans);
  const planDay = (api.plans.find(p => p.id === session.planId) || plan)?.days.find(d => d.id === session.planDayId);
  const others = useMemo(() => api.workouts.filter(w => w.id !== session.id), [api.workouts, session.id]);

  useEffect(() => {
    if (!live && !rest) return;
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [live, rest]);
  useEffect(() => {
    if (rest && Date.now() >= rest.until) {
      setRest(null);
      try { navigator.vibrate?.(200); } catch { /* not supported */ }
    }
  });

  const save = (patch: Partial<WorkoutSession>) => api.saveWorkout({ ...session, ...patch, updatedAt: new Date().toISOString() });
  const setExercises = (fn: (list: WorkoutExercise[]) => WorkoutExercise[]) => save({ exercises: fn(session.exercises) });
  const updateEx = (id: string, fn: (e: WorkoutExercise) => WorkoutExercise) => setExercises(list => list.map(e => e.id === id ? fn(e) : e));

  const add = (picked: Array<{ exerciseId: string; name: string }>) => {
    setPicker(false);
    setExercises(list => [...list, ...picked.map(p => {
      const last = exerciseHistory(others, p.exerciseId).pop();
      const count = Math.max(1, Math.min(6, last?.sets || 3));
      return { id: crypto.randomUUID(), exerciseId: p.exerciseId, name: p.name, sets: Array.from({ length: count }, () => ({})) };
    })]);
  };
  const finish = () => {
    const exercises = session.exercises.map(e => ({ ...e, sets: e.sets.filter(isLogged) })).filter(e => e.sets.length);
    if (!exercises.length) {
      if (!session.exercises.some(e => e.sets.length) || window.confirm("Nothing was logged. Discard this workout?")) { api.deleteWorkout(session.id); onDone(); }
      return;
    }
    const at = new Date().toISOString();
    if (!live) { api.saveWorkout({ ...session, exercises, updatedAt: at }); onDone(); return; }
    const durationMin = session.durationMin ?? (session.startedAt ? Math.max(1, Math.round((Date.parse(at) - Date.parse(session.startedAt)) / 60000)) : undefined);
    api.saveWorkout({ ...session, exercises, finishedAt: at, ...(durationMin !== undefined ? { durationMin } : {}), updatedAt: at });
    onDone();
  };
  const elapsed = session.startedAt ? (Date.now() - Date.parse(session.startedAt)) / 1000 : 0;

  return (
    <div className="tr-logger">
      <div className="tr-logger-head">
        <TextField label="Workout name" value={session.name} maxLength={120} onCommit={name => save({ name })} />
        <input type="date" aria-label="Date" value={session.date} max={api.today} onChange={e => e.target.value && save({ date: e.target.value })} />
        {live ? <span className="tr-clock"><Timer size={15} />{clock(elapsed)}</span> : (
          <label className="tr-clock">Minutes
            <NumField className="tr-inline-num" label="Duration in minutes" value={session.durationMin} decimals={0} onCommit={v => save({ durationMin: v === undefined ? undefined : Math.round(v) })} />
          </label>
        )}
        <span className="hl-left" />
        <button type="button" className="ws-button ws-secondary hl-danger" onClick={() => { if (window.confirm(live ? "Discard this workout?" : "Delete this workout?")) { api.deleteWorkout(session.id); onDone(); } }}><Trash2 size={14} />{live ? "Discard" : "Delete"}</button>
        {live ? <button type="button" className="ws-button ws-primary" onClick={finish}><Check size={15} />Finish</button>
          : <button type="button" className="ws-button ws-primary" onClick={finish}><Check size={15} />Save</button>}
      </div>

      {session.exercises.map((ex, index) => (
        <ExerciseCard key={ex.id} ex={ex} api={api} others={others} live={live} target={planDay?.exercises.find(p => p.exerciseId === ex.exerciseId)}
          first={index === 0} last={index === session.exercises.length - 1}
          onChange={fn => updateEx(ex.id, fn)}
          onMove={d => setExercises(list => { const i = list.findIndex(e => e.id === ex.id), j = i + d; if (j < 0 || j >= list.length) return list; const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; return next; })}
          onRemove={() => { if (!ex.sets.some(isLogged) || window.confirm(`Remove ${ex.name} and its sets?`)) setExercises(list => list.filter(e => e.id !== ex.id)); }}
          onOpen={() => setDetail(ex)}
          onSetDone={sec => setRest({ until: Date.now() + sec * 1000, total: sec })} />
      ))}
      <button type="button" className="tr-add-ex" onClick={() => setPicker(true)}><Plus size={16} />Add exercise</button>
      <label className="tr-sub">Notes
        <textarea className="tr-notes" rows={2} maxLength={4000} value={session.note || ""} placeholder="How it felt, what to change next time" onChange={e => save({ note: e.target.value || undefined })} />
      </label>

      {rest && (
        <div className="tr-rest" role="timer" aria-live="polite">
          <Timer size={15} /><span>Rest {clock((rest.until - Date.now()) / 1000)}</span>
          <span className="tr-rest-bar"><span style={{ width: `${Math.max(0, Math.min(100, ((rest.until - Date.now()) / 1000 / rest.total) * 100))}%` }} /></span>
          <button type="button" onClick={() => setRest(r => r && { until: r.until + 15000, total: r.total + 15 })}>+15s</button>
          <button type="button" onClick={() => setRest(null)}>Skip</button>
        </div>
      )}
      {picker && <ExercisePicker workouts={api.workouts} onClose={() => setPicker(false)} onPick={add} />}
      {detail && <ExerciseDetail exerciseId={detail.exerciseId} name={detail.name} workouts={api.workouts} unit={unit} onClose={() => setDetail(null)} />}
    </div>
  );
}

function ExerciseCard({ ex, api, others, live, target, first, last, onChange, onMove, onRemove, onOpen, onSetDone }: {
  ex: WorkoutExercise; api: TrainingApi; others: WorkoutSession[]; live: boolean; target?: { sets: number; reps: string; restSec?: number; note?: string };
  first: boolean; last: boolean; onChange: (fn: (e: WorkoutExercise) => WorkoutExercise) => void; onMove: (d: number) => void; onRemove: () => void; onOpen: () => void; onSetDone: (restSec: number) => void;
}) {
  const { unit } = api;
  const info = exerciseById(ex.exerciseId, ex.name);
  const measure = measureOf(info);
  const prior = useMemo(() => exerciseHistory(others.filter(w => isFinished(w)), ex.exerciseId), [others, ex.exerciseId]);
  const previous = prior[prior.length - 1];
  const suggestion: Suggestion | undefined = useMemo(() => target ? suggestNext(others, ex.exerciseId, target.reps, unit) : previous ? { weightKg: previous.topWeightKg, reps: previous.topReps || previous.maxReps || undefined, reason: "Match or beat last time.", last: previous } : undefined,
    [others, ex.exerciseId, target, unit, previous]);
  const best = prior.reduce((m, p) => Math.max(m, p.bestE1rm || 0), 0);
  const noteRef = useRef<HTMLInputElement>(null);

  const setSet = (i: number, patch: Partial<WorkoutSet>) => onChange(e => ({ ...e, sets: e.sets.map((s, k) => {
    if (k !== i) return s;
    const next = { ...s, ...patch };
    for (const key of Object.keys(patch) as Array<keyof WorkoutSet>) if (next[key] === undefined) delete next[key];
    return next;
  }) }));
  const placeholder = (i: number): WorkoutSet => {
    const prev = previous?.allSets[i] || previous?.allSets[previous.allSets.length - 1];
    const above = ex.sets[i - 1];
    if (above && isLogged(above)) return { weightKg: above.weightKg, reps: above.reps, seconds: above.seconds, distanceKm: above.distanceKm };
    if (suggestion?.weightKg || suggestion?.reps) return { weightKg: suggestion.weightKg, reps: suggestion.reps, seconds: prev?.seconds, distanceKm: prev?.distanceKm };
    return prev || {};
  };
  const toggleDone = (i: number) => {
    const s = ex.sets[i];
    if (s.done) return setSet(i, { done: undefined });
    const fill = isLogged(s) ? {} : placeholder(i);
    const filled = { ...fill, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) } as WorkoutSet;
    if (!isLogged(filled)) return;
    setSet(i, { ...filled, done: true });
    if (live && s.kind !== "warmup") onSetDone(target?.restSec || (measure === "weight_reps" ? 120 : 60));
  };
  const addSet = () => onChange(e => ({ ...e, sets: [...e.sets, e.sets.length ? (({ done: _d, ...rest }) => rest)(e.sets[e.sets.length - 1]) : {}] }));
  const isPr = (s: WorkoutSet) => {
    const est = s.weightKg && s.reps ? (s.reps === 1 ? s.weightKg : s.reps <= 12 ? s.weightKg * (1 + s.reps / 30) : 0) : 0;
    return prior.length > 0 && est > best * 1.0001 && s.kind !== "warmup";
  };
  const weightCol = measure === "weight_reps" || measure === "reps";

  return (
    <section className="tr-ex">
      <div className="tr-ex-head">
        <div>
          <button type="button" className="tr-ex-name" onClick={onOpen}>{ex.name}</button>
          <div className="tr-ex-meta">
            {[info?.primary.map(titleCase).join(", "), target && `Target ${target.sets} × ${target.reps}${target.restSec ? ` · rest ${clock(target.restSec)}` : ""}`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="tr-ex-tools">
          <button type="button" className="ws-icon-button" aria-label="Move up" disabled={first} onClick={() => onMove(-1)}><ArrowUp size={15} /></button>
          <button type="button" className="ws-icon-button" aria-label="Move down" disabled={last} onClick={() => onMove(1)}><ArrowDown size={15} /></button>
          <button type="button" className="ws-icon-button" aria-label={`Remove ${ex.name}`} onClick={onRemove}><X size={15} /></button>
        </div>
      </div>
      {suggestion?.last && live && (
        <div className="tr-hint">
          {suggestion.weightKg && suggestion.weightKg > (suggestion.last.topWeightKg || 0) ? <TrendingUp size={14} /> : <Sparkles size={14} />}
          <span>Last time ({new Date(`${suggestion.last.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}): {suggestion.last.allSets.map(s => setText(s, unit, measure)).join(", ")}.
            {suggestion.weightKg && measure === "weight_reps" ? <> Try <b>{fmtWeight(suggestion.weightKg, unit)}{suggestion.reps ? ` × ${suggestion.reps}` : ""}</b>. {suggestion.reason}</> : ` ${suggestion.reason}`}</span>
        </div>
      )}
      {target?.note && <div className="tr-hint"><Sparkles size={14} /><span>{target.note}</span></div>}
      <table className="tr-sets">
        <thead>
          <tr>
            <th className="tr-col-kind">Set</th>
            <th className="tr-prev-col">Previous</th>
            {measure === "distance_time" ? <><th>km</th><th>Minutes</th></> : measure === "time" ? <><th>Seconds</th>{<th>{unit} <small>(added)</small></th>}</> : <><th>{measure === "reps" ? `+${unit}` : unit}</th><th>Reps</th></>}
            <th className="tr-prev-col">RPE</th>
            <th className="tr-col-check"><span className="hl-sr">Done</span></th>
            <th className="tr-col-x"><span className="hl-sr">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {ex.sets.map((s, i) => {
            const ph = placeholder(i), prev = previous?.allSets[i];
            const n = ex.sets.slice(0, i + 1).filter(x => x.kind !== "warmup").length;
            return (
              <tr key={i} className={s.done ? "tr-set-done" : undefined}>
                <td><button type="button" className="tr-set-kind" data-kind={s.kind || "working"} title="Change set type: working, warm-up, drop, failure"
                  onClick={() => setSet(i, { kind: NEXT_KIND[s.kind || "working"] === "working" ? undefined : NEXT_KIND[s.kind || "working"] })}>{KIND_LABEL[s.kind || "working"] || n}</button></td>
                <td className="tr-prev tr-prev-col">{prev ? setText(prev, unit, measure) : "—"}</td>
                {measure === "distance_time" ? <>
                  <td><NumField label={`Set ${i + 1} distance`} value={s.distanceKm} decimals={2} placeholder={ph.distanceKm ? String(ph.distanceKm) : "km"} onCommit={v => setSet(i, { distanceKm: v })} /></td>
                  <td><NumField label={`Set ${i + 1} minutes`} value={s.seconds !== undefined ? s.seconds / 60 : undefined} decimals={1} placeholder={ph.seconds ? String(Math.round(ph.seconds / 6) / 10) : "min"} onCommit={v => setSet(i, { seconds: v === undefined ? undefined : Math.round(v * 60) })} /></td>
                </> : measure === "time" ? <>
                  <td><NumField label={`Set ${i + 1} seconds`} value={s.seconds} decimals={0} placeholder={ph.seconds ? String(ph.seconds) : "sec"} onCommit={v => setSet(i, { seconds: v === undefined ? undefined : Math.round(v) })} /></td>
                  <td><NumField label={`Set ${i + 1} added weight`} value={s.weightKg !== undefined ? toUnit(s.weightKg, unit) : undefined} placeholder="—" onCommit={v => setSet(i, { weightKg: v === undefined ? undefined : fromUnit(v, unit) })} /></td>
                </> : <>
                  <td>{weightCol && <NumField label={`Set ${i + 1} weight`} value={s.weightKg !== undefined ? toUnit(s.weightKg, unit) : undefined} placeholder={ph.weightKg ? fmtWeight(ph.weightKg, unit, false) : measure === "reps" ? "—" : unit} onCommit={v => setSet(i, { weightKg: v === undefined ? undefined : fromUnit(v, unit) })} />}</td>
                  <td><NumField label={`Set ${i + 1} reps`} value={s.reps} decimals={0} placeholder={ph.reps !== undefined ? String(ph.reps) : "reps"} onCommit={v => setSet(i, { reps: v === undefined ? undefined : Math.round(v) })} /></td>
                </>}
                <td className="tr-prev-col"><NumField label={`Set ${i + 1} RPE`} value={s.rpe} placeholder="–" onCommit={v => setSet(i, { rpe: v === undefined ? undefined : Math.min(10, Math.max(1, v)) })} /></td>
                <td>
                  {isPr(s) ? <span className="tr-badge" title="New estimated max">PR</span> : null}
                  <button type="button" className="tr-check" aria-pressed={!!s.done} aria-label={`Set ${i + 1} done`} onClick={() => toggleDone(i)}><Check size={15} /></button>
                </td>
                <td><button type="button" className="ws-icon-button" aria-label={`Remove set ${i + 1}`} onClick={() => onChange(e => ({ ...e, sets: e.sets.filter((_, k) => k !== i) }))}><X size={14} /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="tr-ex-foot">
        <button type="button" className="ws-button ws-secondary" onClick={addSet}><Plus size={14} />Add set</button>
        <input ref={noteRef} placeholder="Note (grip, seat height, how it felt)" maxLength={1000} value={ex.note || ""} onChange={e => onChange(x => ({ ...x, note: e.target.value || undefined }))} />
      </div>
    </section>
  );
}

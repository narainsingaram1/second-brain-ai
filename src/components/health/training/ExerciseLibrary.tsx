import { useEffect, useMemo, useState } from "react";
import { Check, Dumbbell, Plus, Search, Trophy, X } from "lucide-react";
import { DialogBackdrop } from "../../workspace/DialogBackdrop";
import { TimeChart } from "../HealthCharts";
import {
  CATEGORIES, customExerciseId, EQUIPMENT, exerciseById, findExercise, exerciseImage, exerciseInstructions, MUSCLES, searchExercises, titleCase, type Exercise,
} from "../../../utils/exercises";
import { exerciseHistory, fmtWeight, loggedExercises, type WeightUnit } from "../../../utils/training";
import type { WorkoutSession } from "../../../types";
import { shortDate } from "./shared";

const PAGE = 60;
const equipmentName = (e: string) => e === "body only" ? "Bodyweight" : titleCase(e);
const describe = (e: Exercise) => [e.primary.map(titleCase).join(", "), e.equipment && equipmentName(e.equipment), e.custom ? "Your exercise" : ""].filter(Boolean).join(" · ");

/** The user's own exercises (any custom name they have logged), searchable next to the library. */
function useCustom(workouts: WorkoutSession[]): Exercise[] {
  return useMemo(() => loggedExercises(workouts).filter(e => e.exerciseId.startsWith("custom-")).map(e => exerciseById(e.exerciseId, e.name)!), [workouts]);
}

function Thumb({ e }: { e: Exercise }) {
  const [failed, setFailed] = useState(false);
  const src = exerciseImage(e);
  return <span className="tr-thumb" aria-hidden="true">{src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : <Dumbbell size={18} />}</span>;
}

function Filters({ muscle, equipment, category, set }: { muscle: string; equipment: string; category: string; set: (k: "muscle" | "equipment" | "category", v: string) => void }) {
  return (
    <div className="tr-filters">
      <select aria-label="Muscle" value={muscle} onChange={e => set("muscle", e.target.value)}>
        <option value="">All muscles</option>{MUSCLES.map(m => <option key={m} value={m}>{titleCase(m)}</option>)}
      </select>
      <select aria-label="Equipment" value={equipment} onChange={e => set("equipment", e.target.value)}>
        <option value="">Any equipment</option>{EQUIPMENT.map(m => <option key={m} value={m}>{m === "body only" ? "Bodyweight" : titleCase(m)}</option>)}
      </select>
      <select aria-label="Type" value={category} onChange={e => set("category", e.target.value)}>
        <option value="">Any type</option>{CATEGORIES.map(m => <option key={m} value={m}>{titleCase(m)}</option>)}
      </select>
    </div>
  );
}

function useSearch(workouts: WorkoutSession[]) {
  const [query, setQuery] = useState("");
  const [f, setF] = useState({ muscle: "", equipment: "", category: "" });
  const [limit, setLimit] = useState(PAGE);
  const custom = useCustom(workouts);
  const results = useMemo(() => searchExercises(query, { muscle: f.muscle || undefined, equipment: f.equipment || undefined, category: f.category || undefined }, custom), [query, f, custom]);
  useEffect(() => setLimit(PAGE), [query, f]);
  return { query, setQuery, f, setFilter: (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v })), results, limit, more: () => setLimit(l => l + PAGE) };
}

/** Choose one or more exercises to add: recent ones first, then the whole library, or a name of your own. */
export function ExercisePicker({ workouts, onClose, onPick, title = "Add exercises" }: {
  workouts: WorkoutSession[]; onClose: () => void; onPick: (picked: Array<{ exerciseId: string; name: string }>) => void; title?: string;
}) {
  const s = useSearch(workouts);
  const [picked, setPicked] = useState<Array<{ exerciseId: string; name: string }>>([]);
  const recent = useMemo(() => loggedExercises(workouts).slice(0, 8).map(r => exerciseById(r.exerciseId, r.name)).filter((e): e is Exercise => !!e), [workouts]);
  const filtering = !!(s.query.trim() || s.f.muscle || s.f.equipment || s.f.category);
  const toggle = (e: { exerciseId: string; name: string }) => setPicked(list => list.some(p => p.exerciseId === e.exerciseId) ? list.filter(p => p.exerciseId !== e.exerciseId) : [...list, e]);
  const isPicked = (id: string) => picked.some(p => p.exerciseId === id);
  const exact = !!findExercise(s.query) || s.results.some(e => e.name.toLowerCase() === s.query.trim().toLowerCase());
  const row = (e: Exercise) => (
    <li key={e.id}>
      <button type="button" className="tr-ex-row" aria-pressed={isPicked(e.id)} onClick={() => toggle({ exerciseId: e.id, name: e.name })}>
        <Thumb e={e} />
        <span className="tr-ex-row-main"><b>{e.name}</b><small>{describe(e)}</small></span>
        <span className="tr-pick-mark">{isPicked(e.id) && <Check size={13} />}</span>
      </button>
    </li>
  );
  return (
    <DialogBackdrop label={title} onClose={onClose} className="ws-overlay">
      <div className="ws-dialog tr-picker">
        <div className="ws-dialog-heading">
          <div><h2>{title}</h2><p>{s.results.length.toLocaleString()} exercises: gym machines, free weights, bodyweight, cardio and stretches.</p></div>
          <button type="button" className="ws-icon-button" aria-label="Close" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="ws-form-body">
          <div className="tr-search"><Search size={16} /><input autoFocus placeholder="Search: bench, rdl, pull-up, treadmill…" value={s.query} onChange={e => s.setQuery(e.target.value)} /></div>
          <Filters {...s.f} set={s.setFilter} />
          <ul className="tr-ex-list">
            {s.query.trim() && !exact && (
              <li>
                <button type="button" className="tr-ex-row" aria-pressed={isPicked(customExerciseId(s.query))} onClick={() => toggle({ exerciseId: customExerciseId(s.query), name: s.query.trim().replace(/\s+/g, " ").slice(0, 80) })}>
                  <span className="tr-thumb"><Plus size={18} /></span>
                  <span className="tr-ex-row-main"><b>Add “{s.query.trim()}”</b><small>As your own exercise</small></span>
                  <span className="tr-pick-mark">{isPicked(customExerciseId(s.query)) && <Check size={13} />}</span>
                </button>
              </li>
            )}
            {!filtering && recent.length > 0 && <><li className="tr-list-label">Recent</li>{recent.map(row)}<li className="tr-list-label">All exercises</li></>}
            {s.results.slice(0, s.limit).map(row)}
          </ul>
          {s.results.length > s.limit && <button type="button" className="ws-button ws-secondary" onClick={s.more}>Show more</button>}
        </div>
        <div className="ws-dialog-actions">
          <button type="button" className="ws-button ws-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="ws-button ws-primary" disabled={!picked.length} onClick={() => onPick(picked)}>{picked.length ? `Add ${picked.length}` : "Add"}</button>
        </div>
      </div>
    </DialogBackdrop>
  );
}

/** One exercise: photos, muscles, how to do it, and the user's own history with it. */
export function ExerciseDetail({ exerciseId, name, workouts, unit, onClose, onAdd }: {
  exerciseId: string; name?: string; workouts: WorkoutSession[]; unit: WeightUnit; onClose: () => void; onAdd?: () => void;
}) {
  const e = exerciseById(exerciseId, name);
  const [steps, setSteps] = useState<string[] | null>(null);
  useEffect(() => { let live = true; if (e && !e.custom) exerciseInstructions(e.id).then(s => { if (live) setSteps(s); }); else setSteps([]); return () => { live = false; }; }, [exerciseId]); // eslint-disable-line react-hooks/exhaustive-deps
  const hist = useMemo(() => exerciseHistory(workouts, exerciseId), [workouts, exerciseId]);
  if (!e) return null;
  const best = hist.reduce<number | undefined>((m, p) => p.bestE1rm && (!m || p.bestE1rm > m) ? p.bestE1rm : m, undefined);
  const heaviest = hist.reduce<{ kg: number; reps?: number } | undefined>((m, p) => p.topWeightKg && (!m || p.topWeightKg > m.kg) ? { kg: p.topWeightKg, reps: p.topReps } : m, undefined);
  const images = [exerciseImage(e, 0), exerciseImage(e, 1)].filter((x): x is string => !!x);
  return (
    <DialogBackdrop label={e.name} onClose={onClose} className="ws-overlay">
      <div className="ws-dialog tr-picker">
        <div className="ws-dialog-heading">
          <div><h2>{e.name}</h2><p>{[titleCase(e.category), e.equipment && (e.equipment === "body only" ? "Bodyweight" : titleCase(e.equipment)), e.level && titleCase(e.level), e.mechanic && titleCase(e.mechanic)].filter(Boolean).join(" · ")}</p></div>
          <button type="button" className="ws-icon-button" aria-label="Close" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="ws-form-body">
          {images.length > 0 && <div className="tr-detail-images">{images.map(src => <img key={src} src={src} alt={`${e.name} position`} loading="lazy" onError={ev => { ev.currentTarget.style.display = "none"; }} />)}</div>}
          {(e.primary.length > 0 || e.secondary.length > 0) && (
            <div className="tr-chips">
              {e.primary.map(m => <span key={m} className="hl-chip"><b>{titleCase(m)}</b></span>)}
              {e.secondary.map(m => <span key={m} className="hl-chip hl-muted">{titleCase(m)}</span>)}
            </div>
          )}
          {steps === null ? <p className="hl-muted hl-small">Loading instructions…</p> : steps.length > 0 && <ol className="tr-steps">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
          {hist.length > 0 ? (
            <section className="hl-card">
              <header><span>Your history</span><small>{hist.length} session{hist.length === 1 ? "" : "s"}</small></header>
              <ul className="tr-records">
                {best !== undefined && <li><Trophy size={15} /><span>Estimated max</span><b>{fmtWeight(best, unit)}</b></li>}
                {heaviest && <li><Trophy size={15} /><span>Heaviest set</span><b>{fmtWeight(heaviest.kg, unit)} × {heaviest.reps}</b></li>}
                <li><Dumbbell size={15} /><span>Last done</span><b>{shortDate(hist[hist.length - 1].date)}</b></li>
              </ul>
              {hist.some(p => p.bestE1rm) && hist.length >= 2 && (
                <TimeChart points={hist.map(p => ({ date: p.date, value: p.bestE1rm }))} label="Estimated max" format={v => fmtWeight(v, unit)} height={140} />
              )}
            </section>
          ) : <p className="hl-muted hl-small">You haven't logged this one yet.</p>}
        </div>
        <div className="ws-dialog-actions">
          <button type="button" className="ws-button ws-secondary" onClick={onClose}>Close</button>
          {onAdd && <button type="button" className="ws-button ws-primary" onClick={onAdd}><Plus size={15} />Add to workout</button>}
        </div>
      </div>
    </DialogBackdrop>
  );
}

/** The whole library as a page. */
export function ExerciseLibrary({ workouts, unit, onAddToWorkout }: { workouts: WorkoutSession[]; unit: WeightUnit; onAddToWorkout?: (e: { exerciseId: string; name: string }) => void }) {
  const s = useSearch(workouts);
  const [open, setOpen] = useState<Exercise | null>(null);
  return (
    <div className="tr-library">
      <section className="hl-card">
        <div className="tr-search"><Search size={16} /><input placeholder={`Search ${s.results.length.toLocaleString()} exercises`} value={s.query} onChange={e => s.setQuery(e.target.value)} /></div>
        <Filters {...s.f} set={s.setFilter} />
        <ul className="tr-ex-list tr-library-grid">
          {s.results.slice(0, s.limit).map(e => (
            <li key={e.id}>
              <button type="button" className="tr-ex-row" onClick={() => setOpen(e)}>
                <Thumb e={e} /><span className="tr-ex-row-main"><b>{e.name}</b><small>{describe(e)}</small></span>
              </button>
            </li>
          ))}
        </ul>
        {!s.results.length && <p className="hl-muted hl-small">Nothing matches. Type the name in a workout to log it as your own exercise.</p>}
        {s.results.length > s.limit && <button type="button" className="ws-button ws-secondary" onClick={s.more}>Show more ({(s.results.length - s.limit).toLocaleString()} left)</button>}
        <p className="hl-muted hl-small">Library from the public-domain free-exercise-db, plus common moves added here.</p>
      </section>
      {open && <ExerciseDetail exerciseId={open.id} name={open.name} workouts={workouts} unit={unit} onClose={() => setOpen(null)}
        onAdd={onAddToWorkout ? () => { onAddToWorkout({ exerciseId: open.id, name: open.name }); setOpen(null); } : undefined} />}
    </div>
  );
}

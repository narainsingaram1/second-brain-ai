import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Play, Plus, Sparkles, Trash2, X } from "lucide-react";
import type { PlanDay, PlanExercise, WorkoutPlan } from "../../../types";
import { PLAN_TEMPLATES, planDayFor, planTarget, weekday } from "../../../utils/training";
import { ExercisePicker } from "./ExerciseLibrary";
import { NumField, TextField, WEEK_ORDER, WEEKDAYS, type TrainingApi } from "./shared";

const now = () => new Date().toISOString();
const newPlan = (fields: Pick<WorkoutPlan, "name" | "description" | "days">, active: boolean): WorkoutPlan =>
  ({ id: crypto.randomUUID(), active, createdAt: now(), updatedAt: now(), ...fields });

export function PlanView({ api, onStartDay }: { api: TrainingApi; onStartDay: (plan: WorkoutPlan, day: PlanDay) => void }) {
  const active = api.plans.find(p => p.active);
  const [editing, setEditing] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(!api.plans.length);
  const plan = api.plans.find(p => p.id === editing) || null;
  const others = api.plans.filter(p => !p.active);

  const create = (fields: Pick<WorkoutPlan, "name" | "description" | "days">) => {
    const p = newPlan(fields, true);
    api.savePlan(p);
    setChoosing(false);
    return p;
  };

  if (plan) return <PlanEditor api={api} plan={plan} onClose={() => setEditing(null)} />;

  return (
    <div className="tr-root">
      {active ? <ActivePlan api={api} plan={active} onEdit={() => setEditing(active.id)} onStartDay={onStartDay} /> : !choosing && (
        <div className="hl-notice"><Sparkles size={15} />No plan is active. Pick one below, or make one of your saved plans active.</div>
      )}
      {(choosing || !active) && (
        <section className="hl-card">
          <header><span>{active ? "Start a new plan" : "Choose a training split"}</span>{active && <button type="button" className="ws-icon-button" aria-label="Close" onClick={() => setChoosing(false)}><X size={16} /></button>}</header>
          <div className="tr-templates">
            {PLAN_TEMPLATES.map(t => {
              const sample = t.build();
              return (
                <button key={t.key} type="button" className="tr-template" onClick={() => create(t.build())}>
                  <b>{t.name}</b><small>{t.description}</small>
                  <span className="tr-template-days">{sample.days.map(d => <span key={d.id} className="hl-chip">{d.name}</span>)}</span>
                </button>
              );
            })}
            <button type="button" className="tr-template" onClick={() => { const p = create({ name: "My plan", days: [{ id: crypto.randomUUID(), name: "Day 1", exercises: [] }] }); setEditing(p.id); }}>
              <b><Plus size={14} /> Build my own</b><small>Start blank and add days and exercises.</small>
            </button>
            <button type="button" className="tr-template" onClick={() => api.onAsk("Design a training plan for me and save it with create_workout_plan. First ask me briefly about my goal (strength, muscle, fat loss, general fitness), how many days a week I can train, how long each session can be, and what equipment I have (full gym, dumbbells only, or nothing at home). Use exercises from search_exercises.")}>
              <b><Sparkles size={14} /> Ask Iris to design one</b><small>Answer a few questions about your goals, schedule and equipment.</small>
            </button>
          </div>
        </section>
      )}
      {active && !choosing && <button type="button" className="ws-button ws-secondary" style={{ alignSelf: "flex-start" }} onClick={() => setChoosing(true)}><Plus size={14} />New plan</button>}
      {others.length > 0 && (
        <section className="hl-card">
          <header><span>Saved plans</span></header>
          <ul className="tr-plan-list">
            {others.map(p => (
              <li key={p.id}>
                <span><b>{p.name}</b> <small>{p.days.map(d => d.name).join(" · ")}</small></span>
                <span className="tr-subnav-actions">
                  <button type="button" className="ws-button ws-secondary" onClick={() => api.savePlan({ ...p, active: true, updatedAt: now() })}><Check size={14} />Make active</button>
                  <button type="button" className="ws-icon-button" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p.id)}><Pencil size={14} /></button>
                  <button type="button" className="ws-icon-button" aria-label={`Delete ${p.name}`} onClick={() => { if (window.confirm(`Delete ${p.name}? Logged workouts stay.`)) api.deletePlan(p.id); }}><Trash2 size={14} /></button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ActivePlan({ api, plan, onEdit, onStartDay }: { api: TrainingApi; plan: WorkoutPlan; onEdit: () => void; onStartDay: (plan: WorkoutPlan, day: PlanDay) => void }) {
  const fixed = plan.days.some(d => d.weekdays?.length);
  const todayDay = planDayFor(plan, api.workouts, api.today);
  const todayWd = weekday(api.today);
  return (
    <>
      <section className="hl-card">
        <header>
          <span>{plan.name}</span>
          <span className="tr-subnav-actions">
            <small>{planTarget(plan)} sessions a week</small>
            <button type="button" className="ws-button ws-secondary" onClick={onEdit}><Pencil size={14} />Edit plan</button>
          </span>
        </header>
        {plan.description && <p className="tr-sub">{plan.description}</p>}
        {fixed ? (
          <div className="tr-schedule">
            {WEEK_ORDER.map(wd => {
              const days = plan.days.filter(d => d.weekdays?.includes(wd));
              return (
                <div key={wd} className={`${days.length ? "" : "tr-rest-day"}${wd === todayWd ? " tr-today-col" : ""}`}>
                  <small>{WEEKDAYS[wd]}{wd === todayWd ? " · today" : ""}</small>
                  <b>{days.length ? days.map(d => d.name).join(" + ") : "Rest"}</b>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="tr-sub">Rotates in order: {plan.days.map(d => d.name).join(" → ")}, then repeats.{todayDay ? ` Next up: ${todayDay.day.name}.` : ""}</p>
        )}
      </section>
      <div className="tr-days">
        {plan.days.map(d => (
          <section key={d.id} className="hl-card">
            <header>
              <span>{d.name}</span>
              <small>{d.weekdays?.length ? d.weekdays.map(w => WEEKDAYS[w]).join(", ") : ""}</small>
            </header>
            {d.exercises.length ? (
              <ul className="tr-plan-list">
                {d.exercises.map(e => <li key={e.id}><span>{e.name}</span><small>{e.sets} × {e.reps}</small></li>)}
              </ul>
            ) : <p className="hl-muted hl-small">No exercises yet.</p>}
            <footer><button type="button" className="ws-button ws-primary" onClick={() => onStartDay(plan, d)}><Play size={14} />Start {d.name}</button></footer>
          </section>
        ))}
      </div>
    </>
  );
}

function PlanEditor({ api, plan, onClose }: { api: TrainingApi; plan: WorkoutPlan; onClose: () => void }) {
  const [picking, setPicking] = useState<string | null>(null);
  const save = (patch: Partial<WorkoutPlan>) => api.savePlan({ ...plan, ...patch, updatedAt: now() });
  const setDay = (id: string, fn: (d: PlanDay) => PlanDay) => save({ days: plan.days.map(d => d.id === id ? fn(d) : d) });
  const setEx = (dayId: string, exId: string, patch: Partial<PlanExercise>) => setDay(dayId, d => ({ ...d, exercises: d.exercises.map(e => e.id === exId ? { ...e, ...patch } : e) }));
  const move = <T,>(list: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= list.length) return list; const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; return n; };
  return (
    <div className="tr-root">
      <div className="tr-logger-head">
        <TextField label="Plan name" value={plan.name} maxLength={80} onCommit={name => save({ name })} />
        <label className="tr-clock"><input type="checkbox" checked={plan.active} onChange={e => save({ active: e.target.checked })} /> Active</label>
        <button type="button" className="ws-button ws-secondary hl-danger" onClick={() => { if (window.confirm(`Delete ${plan.name}? Logged workouts stay.`)) { api.deletePlan(plan.id); onClose(); } }}><Trash2 size={14} />Delete</button>
        <button type="button" className="ws-button ws-primary" onClick={onClose}><Check size={15} />Done</button>
      </div>
      <input className="tr-select" style={{ width: "100%" }} aria-label="Description" placeholder="Description (optional)" maxLength={1000} value={plan.description || ""} onChange={e => save({ description: e.target.value || undefined })} />
      <p className="tr-sub">Pick weekdays for a fixed schedule, or leave them empty to rotate through the days in order.</p>
      <div className="tr-days">
        {plan.days.map((d, di) => (
          <section key={d.id} className="tr-day-edit">
            <header>
              <TextField label="Day name" value={d.name} maxLength={60} onCommit={name => setDay(d.id, x => ({ ...x, name }))} />
              <button type="button" className="ws-icon-button" aria-label="Move day earlier" disabled={di === 0} onClick={() => save({ days: move(plan.days, di, -1) })}><ArrowUp size={14} /></button>
              <button type="button" className="ws-icon-button" aria-label="Move day later" disabled={di === plan.days.length - 1} onClick={() => save({ days: move(plan.days, di, 1) })}><ArrowDown size={14} /></button>
              <button type="button" className="ws-icon-button" aria-label={`Remove ${d.name}`} disabled={plan.days.length === 1} onClick={() => { if (window.confirm(`Remove ${d.name}?`)) save({ days: plan.days.filter(x => x.id !== d.id) }); }}><Trash2 size={14} /></button>
            </header>
            <div className="tr-weekday-pick" role="group" aria-label={`${d.name} weekdays`}>
              {WEEK_ORDER.map(wd => {
                const on = !!d.weekdays?.includes(wd);
                return <button key={wd} type="button" aria-pressed={on} onClick={() => setDay(d.id, x => {
                  const next = on ? (x.weekdays || []).filter(w => w !== wd) : [...(x.weekdays || []), wd].sort();
                  const { weekdays: _w, ...rest } = x;
                  return next.length ? { ...rest, weekdays: next } : rest;
                })}>{WEEKDAYS[wd]}</button>;
              })}
            </div>
            {d.exercises.length > 0 && (
              <div className="tr-plan-ex tr-plan-ex-head"><span>Exercise</span><span>Sets</span><span>Reps</span><span className="tr-col-rest">Rest s</span><span /></div>
            )}
            {d.exercises.map((e, ei) => (
              <div key={e.id} className="tr-plan-ex">
                <span title={e.name}>{e.name}</span>
                <NumField label={`${e.name} sets`} value={e.sets} decimals={0} onCommit={v => v && setEx(d.id, e.id, { sets: Math.max(1, Math.min(20, Math.round(v))) })} />
                <TextField label={`${e.name} reps`} value={e.reps} maxLength={20} onCommit={reps => setEx(d.id, e.id, { reps: reps.trim() })} />
                <span className="tr-col-rest"><NumField label={`${e.name} rest seconds`} value={e.restSec} decimals={0} placeholder="90" onCommit={v => setEx(d.id, e.id, { restSec: v === undefined ? undefined : Math.min(1800, Math.round(v)) })} /></span>
                <span className="tr-row-tools">
                  <button type="button" className="ws-icon-button" aria-label="Move up" disabled={ei === 0} onClick={() => setDay(d.id, x => ({ ...x, exercises: move(x.exercises, ei, -1) }))}><ArrowUp size={13} /></button>
                  <button type="button" className="ws-icon-button" aria-label={`Remove ${e.name}`} onClick={() => setDay(d.id, x => ({ ...x, exercises: x.exercises.filter(y => y.id !== e.id) }))}><X size={13} /></button>
                </span>
              </div>
            ))}
            <button type="button" className="ws-button ws-secondary" onClick={() => setPicking(d.id)}><Plus size={14} />Add exercises</button>
          </section>
        ))}
      </div>
      {plan.days.length < 14 && <button type="button" className="tr-add-ex" onClick={() => save({ days: [...plan.days, { id: crypto.randomUUID(), name: `Day ${plan.days.length + 1}`, exercises: [] }] })}><Plus size={16} />Add a day</button>}
      {picking && <ExercisePicker title="Add to this day" workouts={api.workouts} onClose={() => setPicking(null)}
        onPick={picked => { setDay(picking, d => ({ ...d, exercises: [...d.exercises, ...picked.map(p => ({ id: crypto.randomUUID(), exerciseId: p.exerciseId, name: p.name, sets: 3, reps: "8-12" }))] })); setPicking(null); }} />}
    </div>
  );
}

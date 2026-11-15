import type { HealthDay, PlanDay, PlanExercise, WorkoutExercise, WorkoutPlan, WorkoutSession, WorkoutSet } from "../types";
import { exerciseById, GROUP_OF, measureOf, type Muscle, type MuscleGroup } from "./exercises";

/**
 * Strength training: sessions, plans (splits like Push / Pull / Legs) and the numbers worked out from them.
 * Pure and shared by the app and the assistant's tools. Weights are stored in kg and shown in the user's unit.
 */

export type WeightUnit = "kg" | "lb";
export const KG_PER_LB = 0.45359237;
export const toUnit = (kg: number, unit: WeightUnit) => unit === "lb" ? kg / KG_PER_LB : kg;
export const fromUnit = (value: number, unit: WeightUnit) => unit === "lb" ? value * KG_PER_LB : value;
/** A weight in the user's unit, to at most one decimal (whole numbers stay whole). */
export function fmtWeight(kg: number | undefined, unit: WeightUnit, withUnit = true): string {
  if (kg === undefined) return "—";
  const v = Math.round(toUnit(kg, unit) * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}${withUnit ? ` ${unit}` : ""}`;
}
/** The smallest jump in load most gyms allow. */
export const increment = (unit: WeightUnit) => unit === "lb" ? 5 * KG_PER_LB : 2.5;

export const MAX_SETS = 50, MAX_EXERCISES = 60, MAX_PLAN_DAYS = 14;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown, lo: number, hi: number, digits = 3) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 10 ** digits) / 10 ** digits : undefined;
const text = (v: unknown, max: number) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
const SET_KINDS = ["warmup", "working", "drop", "failure"] as const;

export function normalizeSet(value: unknown): WorkoutSet | undefined {
  if (!value || typeof value !== "object") return undefined;
  const s = value as Record<string, unknown>;
  const set: WorkoutSet = {};
  const reps = num(s.reps, 0, 1000, 0), weight = num(s.weightKg, 0, 1000), seconds = num(s.seconds, 0, 86400, 0), dist = num(s.distanceKm, 0, 1000, 3), rpe = num(s.rpe, 1, 10, 1);
  if (reps !== undefined) set.reps = reps;
  if (weight !== undefined) set.weightKg = weight;
  if (seconds !== undefined) set.seconds = seconds;
  if (dist !== undefined) set.distanceKm = dist;
  if (rpe !== undefined) set.rpe = rpe;
  if (typeof s.kind === "string" && (SET_KINDS as readonly string[]).includes(s.kind) && s.kind !== "working") set.kind = s.kind as WorkoutSet["kind"];
  if (s.done === true) set.done = true;
  return set;
}

export function normalizeWorkoutExercise(value: unknown): WorkoutExercise | undefined {
  if (!value || typeof value !== "object") return undefined;
  const e = value as Record<string, unknown>;
  const name = text(e.name, 80), exerciseId = text(e.exerciseId, 120);
  if (!name || !exerciseId) return undefined;
  const out: WorkoutExercise = { id: text(e.id, 80) || crypto.randomUUID(), exerciseId, name,
    sets: (Array.isArray(e.sets) ? e.sets : []).slice(0, MAX_SETS).map(normalizeSet).filter((s): s is WorkoutSet => !!s) };
  const note = text(e.note, 1000);
  if (note) out.note = note;
  return out;
}

export function normalizeWorkout(value: unknown): WorkoutSession | undefined {
  if (!value || typeof value !== "object") return undefined;
  const w = value as Record<string, unknown>;
  const id = text(w.id, 200), date = typeof w.date === "string" && DATE.test(w.date) ? w.date : undefined;
  if (!id || !date) return undefined;
  const now = new Date().toISOString();
  const out: WorkoutSession = {
    id, date, name: text(w.name, 120) || "Workout",
    exercises: (Array.isArray(w.exercises) ? w.exercises : []).slice(0, MAX_EXERCISES).map(normalizeWorkoutExercise).filter((e): e is WorkoutExercise => !!e),
    createdAt: text(w.createdAt, 40) || now, updatedAt: text(w.updatedAt, 40) || now,
  };
  for (const key of ["planId", "planDayId", "startedAt", "finishedAt"] as const) { const v = text(w[key], 200); if (v) out[key] = v; }
  const duration = num(w.durationMin, 0, 1440, 0), note = text(w.note, 4000);
  if (duration !== undefined) out.durationMin = duration;
  if (note) out.note = note;
  return out;
}
const byDate = (a: WorkoutSession, b: WorkoutSession) => a.date.localeCompare(b.date) || (a.startedAt || a.createdAt).localeCompare(b.startedAt || b.createdAt);
export function normalizeWorkouts(value: unknown): WorkoutSession[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map(normalizeWorkout).filter((w): w is WorkoutSession => !!w && !seen.has(w.id) && !!seen.add(w.id)).sort(byDate);
}

function normalizePlanExercise(value: unknown): PlanExercise | undefined {
  if (!value || typeof value !== "object") return undefined;
  const e = value as Record<string, unknown>;
  const name = text(e.name, 80), exerciseId = text(e.exerciseId, 120);
  if (!name || !exerciseId) return undefined;
  const out: PlanExercise = { id: text(e.id, 80) || crypto.randomUUID(), exerciseId, name, sets: num(e.sets, 1, 20, 0) ?? 3, reps: text(e.reps, 20) || "8-12" };
  const rest = num(e.restSec, 0, 1800, 0), note = text(e.note, 500);
  if (rest !== undefined) out.restSec = rest;
  if (note) out.note = note;
  return out;
}
function normalizePlanDay(value: unknown): PlanDay | undefined {
  if (!value || typeof value !== "object") return undefined;
  const d = value as Record<string, unknown>;
  const name = text(d.name, 60);
  if (!name) return undefined;
  const out: PlanDay = { id: text(d.id, 80) || crypto.randomUUID(), name,
    exercises: (Array.isArray(d.exercises) ? d.exercises : []).slice(0, 30).map(normalizePlanExercise).filter((e): e is PlanExercise => !!e) };
  if (Array.isArray(d.weekdays)) {
    const days = [...new Set(d.weekdays.filter((x): x is number => Number.isInteger(x) && x >= 0 && x <= 6))].sort();
    if (days.length) out.weekdays = days;
  }
  return out;
}
export function normalizeWorkoutPlan(value: unknown): WorkoutPlan | undefined {
  if (!value || typeof value !== "object") return undefined;
  const p = value as Record<string, unknown>;
  const id = text(p.id, 200), name = text(p.name, 80);
  if (!id || !name) return undefined;
  const now = new Date().toISOString();
  const out: WorkoutPlan = { id, name, active: p.active === true,
    days: (Array.isArray(p.days) ? p.days : []).slice(0, MAX_PLAN_DAYS).map(normalizePlanDay).filter((d): d is PlanDay => !!d),
    createdAt: text(p.createdAt, 40) || now, updatedAt: text(p.updatedAt, 40) || now };
  const description = text(p.description, 1000);
  if (description) out.description = description;
  return out;
}
export function normalizeWorkoutPlans(value: unknown): WorkoutPlan[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map(normalizeWorkoutPlan).filter((p): p is WorkoutPlan => !!p && !seen.has(p.id) && !!seen.add(p.id));
}

// ---- Numbers from sessions ----

/** Estimated one-rep max (Epley). Only sets of 1 to 12 reps give a useful estimate. */
export function e1rm(weightKg: number | undefined, reps: number | undefined): number | undefined {
  if (!weightKg || !reps || reps < 1 || reps > 12) return undefined;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}
export const isWorkingSet = (s: WorkoutSet) => s.kind !== "warmup";
/** A set counts once it has something in it. Sets left empty in the logger are ignored. */
export const isLogged = (s: WorkoutSet) => !!(s.reps || s.seconds || s.distanceKm);
export const setVolume = (s: WorkoutSet) => (s.weightKg || 0) * (s.reps || 0);

export interface ExercisePerformance {
  date: string;
  sessionId: string;
  sets: number;
  /** Heaviest working set. */
  topWeightKg?: number;
  topReps?: number;
  bestE1rm?: number;
  volumeKg: number;
  maxReps: number;
  totalReps: number;
  bestSeconds: number;
  distanceKm: number;
  allSets: WorkoutSet[];
}
export function performance(session: WorkoutSession, ex: WorkoutExercise): ExercisePerformance {
  const sets = ex.sets.filter(s => isWorkingSet(s) && isLogged(s));
  let top: WorkoutSet | undefined, best: number | undefined;
  for (const s of sets) {
    if (s.weightKg !== undefined && (!top || s.weightKg > (top.weightKg || 0) || (s.weightKg === top.weightKg && (s.reps || 0) > (top.reps || 0)))) top = s;
    const est = e1rm(s.weightKg, s.reps);
    if (est !== undefined && (best === undefined || est > best)) best = est;
  }
  return { date: session.date, sessionId: session.id, sets: sets.length, topWeightKg: top?.weightKg, topReps: top?.reps, bestE1rm: best,
    volumeKg: sets.reduce((n, s) => n + setVolume(s), 0), maxReps: Math.max(0, ...sets.map(s => s.reps || 0)), totalReps: sets.reduce((n, s) => n + (s.reps || 0), 0),
    bestSeconds: Math.max(0, ...sets.map(s => s.seconds || 0)), distanceKm: sets.reduce((n, s) => n + (s.distanceKm || 0), 0), allSets: sets };
}
/** Every logged session of one exercise, oldest first. */
export function exerciseHistory(workouts: WorkoutSession[], exerciseId: string): ExercisePerformance[] {
  const out: ExercisePerformance[] = [];
  for (const w of [...workouts].sort(byDate)) for (const ex of w.exercises) {
    if (ex.exerciseId !== exerciseId) continue;
    const p = performance(w, ex);
    if (p.sets) out.push(p);
  }
  return out;
}
export const sessionVolume = (w: WorkoutSession) => w.exercises.reduce((n, ex) => n + ex.sets.filter(s => isWorkingSet(s) && isLogged(s)).reduce((m, s) => m + setVolume(s), 0), 0);
export const sessionSets = (w: WorkoutSession) => w.exercises.reduce((n, ex) => n + ex.sets.filter(s => isWorkingSet(s) && isLogged(s)).length, 0);
export const isFinished = (w: WorkoutSession) => !!w.finishedAt || !w.startedAt;

/** The exercises the user has logged, most recent first, with how often. */
export function loggedExercises(workouts: WorkoutSession[]): Array<{ exerciseId: string; name: string; sessions: number; last: string }> {
  const map = new Map<string, { exerciseId: string; name: string; sessions: number; last: string }>();
  for (const w of workouts) for (const ex of w.exercises) {
    if (!ex.sets.some(isLogged)) continue;
    const m = map.get(ex.exerciseId) || { exerciseId: ex.exerciseId, name: ex.name, sessions: 0, last: "" };
    m.sessions++;
    if (w.date >= m.last) { m.last = w.date; m.name = ex.name; }
    map.set(ex.exerciseId, m);
  }
  return [...map.values()].sort((a, b) => b.last.localeCompare(a.last) || b.sessions - a.sessions);
}

export interface PersonalRecord { exerciseId: string; name: string; kind: "e1rm" | "weight" | "reps" | "volume"; valueKg?: number; reps?: number; value: number; date: string; previous?: number }
/** Records each session set, in order. A record needs an earlier session of the same exercise to beat. */
export function personalRecords(workouts: WorkoutSession[]): PersonalRecord[] {
  const best = new Map<string, Record<string, number>>(), out: PersonalRecord[] = [];
  for (const w of [...workouts].sort(byDate)) for (const ex of w.exercises) {
    const p = performance(w, ex);
    if (!p.sets) continue;
    const prev = best.get(ex.exerciseId);
    const now: Record<string, number> = { e1rm: p.bestE1rm || 0, weight: p.topWeightKg || 0, reps: p.maxReps, volume: p.volumeKg };
    if (prev) for (const kind of ["e1rm", "weight", "reps", "volume"] as const) {
      if (now[kind] > prev[kind] * (kind === "volume" ? 1.0001 : 1) && now[kind] > 0) {
        if (kind === "reps" && p.topWeightKg) continue; // Rep records only matter for bodyweight moves.
        out.push({ exerciseId: ex.exerciseId, name: ex.name, kind, value: now[kind], previous: prev[kind] || undefined, date: w.date,
          ...(kind === "weight" ? { valueKg: p.topWeightKg, reps: p.topReps } : {}) });
      }
    }
    best.set(ex.exerciseId, prev ? Object.fromEntries(Object.keys(now).map(k => [k, Math.max(prev[k], now[k])])) : now);
  }
  return out;
}

// ---- Weeks and schedule ----

const dayMs = 86400000;
const utc = (d: string) => Date.parse(`${d}T12:00:00Z`);
export const addDays = (d: string, n: number) => new Date(utc(d) + n * dayMs).toISOString().slice(0, 10);
export const weekday = (d: string) => new Date(utc(d)).getUTCDay();
/** Monday of the week the date is in. */
export const weekStart = (d: string) => addDays(d, -((weekday(d) + 6) % 7));
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / dayMs);

/** Hard sets per muscle: a primary muscle counts the whole set, a secondary one half. */
export function muscleSets(workouts: WorkoutSession[]): Map<Muscle, number> {
  const out = new Map<Muscle, number>();
  for (const w of workouts) for (const ex of w.exercises) {
    const e = exerciseById(ex.exerciseId, ex.name);
    const n = ex.sets.filter(s => isWorkingSet(s) && isLogged(s)).length;
    if (!e || !n) continue;
    for (const m of e.primary) out.set(m, (out.get(m) || 0) + n);
    for (const m of e.secondary) out.set(m, (out.get(m) || 0) + n / 2);
  }
  return out;
}
export function groupSets(sets: Map<Muscle, number>): Record<MuscleGroup, number> {
  const out: Record<MuscleGroup, number> = { push: 0, pull: 0, legs: 0, core: 0 };
  for (const [m, n] of sets) out[GROUP_OF[m]] += n;
  return out;
}

export interface WeekStat { week: string; sessions: number; volumeKg: number; sets: number; minutes: number }
export function weeklyStats(workouts: WorkoutSession[], today: string, weeks = 12): WeekStat[] {
  const start = weekStart(today);
  const out: WeekStat[] = Array.from({ length: weeks }, (_, i) => ({ week: addDays(start, -7 * (weeks - 1 - i)), sessions: 0, volumeKg: 0, sets: 0, minutes: 0 }));
  const index = new Map(out.map((w, i) => [w.week, i]));
  for (const w of workouts) {
    const i = index.get(weekStart(w.date));
    if (i === undefined || !sessionSets(w)) continue;
    out[i].sessions++; out[i].volumeKg += sessionVolume(w); out[i].sets += sessionSets(w); out[i].minutes += w.durationMin || 0;
  }
  return out;
}

export const activePlan = (plans: WorkoutPlan[] | undefined) => (plans || []).find(p => p.active);
/** Sessions per week the plan asks for: its scheduled weekdays, or one per day of the split. */
export const planTarget = (plan: WorkoutPlan | undefined) => !plan ? 0 : Math.min(7, plan.days.some(d => d.weekdays?.length) ? new Set(plan.days.flatMap(d => d.weekdays || [])).size : plan.days.length);

/** What the plan has for a date: the day scheduled on that weekday, or the next day in the rotation after the last one done. */
export function planDayFor(plan: WorkoutPlan | undefined, workouts: WorkoutSession[], date: string): { day: PlanDay; scheduled: boolean } | undefined {
  if (!plan?.days.length) return undefined;
  const scheduled = plan.days.find(d => d.weekdays?.includes(weekday(date)));
  if (scheduled) return { day: scheduled, scheduled: true };
  if (plan.days.some(d => d.weekdays?.length)) return undefined; // A rest day on a fixed schedule.
  const last = [...workouts].sort(byDate).reverse().find(w => w.planId === plan.id && w.date < date && w.planDayId);
  const i = last ? plan.days.findIndex(d => d.id === last.planDayId) : -1;
  return { day: plan.days[(i + 1) % plan.days.length], scheduled: false };
}

/** "8-12" → [8, 12]; "5" → [5, 5]; timed targets ("30s") → undefined. */
export function repRange(reps: string): [number, number] | undefined {
  const m = reps.match(/^\s*(\d+)\s*(?:[-–to]+\s*(\d+))?\s*$/);
  if (!m) return undefined;
  const lo = Number(m[1]), hi = Number(m[2] || m[1]);
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

export interface Suggestion { weightKg?: number; reps?: number; reason: string; last?: ExercisePerformance }
/**
 * Double progression: when every working set last time reached the top of the rep range, add the smallest jump;
 * when sets fell short twice in a row, drop about 10%; otherwise repeat the weight and add reps.
 */
export function suggestNext(workouts: WorkoutSession[], exerciseId: string, target: string, unit: WeightUnit): Suggestion | undefined {
  const hist = exerciseHistory(workouts.filter(isFinished), exerciseId);
  const last = hist[hist.length - 1];
  if (!last) return undefined;
  const range = repRange(target);
  const measure = measureOf(exerciseById(exerciseId));
  if (!range || measure !== "weight_reps" || !last.topWeightKg) {
    return { reps: last.maxReps || undefined, weightKg: last.topWeightKg, reason: "Match or beat last time.", last };
  }
  const working = last.allSets.filter(s => s.weightKg === last.topWeightKg);
  const allTop = working.length > 0 && working.every(s => (s.reps || 0) >= range[1]);
  const short = (p: ExercisePerformance) => p.allSets.filter(s => s.weightKg === p.topWeightKg).some(s => (s.reps || 0) < range[0]);
  const step = increment(unit);
  const round = (kg: number) => fromUnit(Math.round(toUnit(kg, unit) / toUnit(step, unit)) * toUnit(step, unit), unit);
  if (allTop) return { weightKg: round(last.topWeightKg + step), reps: range[0], reason: `You hit ${range[1]} reps on every set. Add weight.`, last };
  if (hist.length >= 2 && short(last) && short(hist[hist.length - 2])) return { weightKg: round(last.topWeightKg * 0.9), reps: range[1], reason: "Missed the rep range twice. Drop about 10% and build back up.", last };
  return { weightKg: last.topWeightKg, reps: Math.min(range[1], (last.topReps || range[0]) + 1), reason: `Same weight; aim for ${range[1]} reps on every set.`, last };
}

// ---- Trends and insights ----

/** Least-squares slope of value per day. */
export function slope(points: Array<{ x: number; y: number }>): number | undefined {
  if (points.length < 2) return undefined;
  const mx = points.reduce((n, p) => n + p.x, 0) / points.length, my = points.reduce((n, p) => n + p.y, 0) / points.length;
  const den = points.reduce((n, p) => n + (p.x - mx) ** 2, 0);
  return den ? points.reduce((n, p) => n + (p.x - mx) * (p.y - my), 0) / den : undefined;
}

export interface ExerciseTrend { exerciseId: string; name: string; sessions: number; latestE1rm: number; bestE1rm: number; perWeekPct: number; status: "progressing" | "plateau" | "declining" | "steady"; weeksSinceBest: number }
export function exerciseTrends(workouts: WorkoutSession[], today: string, windowDays = 84): ExerciseTrend[] {
  const out: ExerciseTrend[] = [];
  for (const { exerciseId, name } of loggedExercises(workouts)) {
    const hist = exerciseHistory(workouts, exerciseId).filter(p => p.bestE1rm && daysBetween(p.date, today) <= windowDays);
    if (hist.length < 3) continue;
    const s = slope(hist.map(p => ({ x: utc(p.date) / dayMs, y: p.bestE1rm! })));
    const mean = hist.reduce((n, p) => n + p.bestE1rm!, 0) / hist.length;
    const perWeekPct = s === undefined ? 0 : (s * 7 / mean) * 100;
    const top = Math.max(...hist.map(p => p.bestE1rm!));
    // When the best was first reached (within half a percent): matching it again is not progress.
    const bestP = hist.find(p => p.bestE1rm! >= top * 0.995)!;
    const weeksSinceBest = Math.floor(daysBetween(bestP.date, today) / 7);
    const recent = hist.slice(-3);
    const plateau = weeksSinceBest >= 3 && recent.every(p => p.bestE1rm! <= top * 1.005) && daysBetween(recent[0].date, recent[2].date) >= 7;
    const status = perWeekPct >= 0.5 && !plateau ? "progressing" : perWeekPct <= -1 ? "declining" : plateau ? "plateau" : "steady";
    out.push({ exerciseId, name, sessions: hist.length, latestE1rm: hist[hist.length - 1].bestE1rm!, bestE1rm: top, perWeekPct: Math.round(perWeekPct * 10) / 10, status, weeksSinceBest });
  }
  return out.sort((a, b) => b.sessions - a.sessions);
}

export interface WeightTrend { points: Array<{ date: string; kg: number; avg: number }>; latestKg?: number; perWeekKg?: number; change30Kg?: number; goalKg?: number; goalDate?: string }
/** Body weight from health days: a 7-day moving average and the rate over the last four weeks. */
export function weightTrend(days: HealthDay[], today: string, goalKg?: number): WeightTrend {
  const raw = days.filter(d => d.metrics.weightKg !== undefined && d.date <= today).map(d => ({ date: d.date, kg: d.metrics.weightKg! })).sort((a, b) => a.date.localeCompare(b.date));
  const points = raw.map((p, i) => {
    const win = raw.slice(0, i + 1).filter(q => daysBetween(q.date, p.date) < 7);
    return { ...p, avg: Math.round(win.reduce((n, q) => n + q.kg, 0) / win.length * 100) / 100 };
  });
  const latest = points[points.length - 1];
  const recent = points.filter(p => daysBetween(p.date, today) <= 28);
  const s = recent.length >= 3 && daysBetween(recent[0].date, recent[recent.length - 1].date) >= 7 ? slope(recent.map(p => ({ x: utc(p.date) / dayMs, y: p.kg }))) : undefined;
  const perWeekKg = s === undefined ? undefined : Math.round(s * 7 * 100) / 100;
  const before = [...points].reverse().find(p => daysBetween(p.date, today) >= 30);
  let goalDate: string | undefined;
  if (goalKg && latest && perWeekKg && Math.sign(goalKg - latest.avg) === Math.sign(perWeekKg) && Math.abs(perWeekKg) >= 0.05) {
    const weeks = (goalKg - latest.avg) / perWeekKg;
    if (weeks > 0 && weeks < 104) goalDate = addDays(today, Math.round(weeks * 7));
  }
  return { points, latestKg: latest?.kg, perWeekKg, change30Kg: latest && before ? Math.round((latest.avg - before.avg) * 100) / 100 : undefined, goalKg, goalDate };
}

export interface TrainingInsight { id: string; tone: "good" | "warn" | "info"; title: string; detail: string }
export interface TrainingStats {
  sessions: number;
  thisWeek: WeekStat;
  weeks: WeekStat[];
  target: number;
  /** Weeks in a row (ending last week, or this week if met) at or above the plan's target. */
  weekStreak: number;
  muscles: Array<{ muscle: Muscle; sets: number }>;
  groups: Record<MuscleGroup, number>;
  trends: ExerciseTrend[];
  recentRecords: PersonalRecord[];
  weight: WeightTrend;
  insights: TrainingInsight[];
}

/** Average session performance (best e1RM against that exercise's previous three sessions), for linking training to sleep. */
function sessionIndex(workouts: WorkoutSession[]): Map<string, number> {
  const out = new Map<string, number>(), hist = new Map<string, number[]>();
  for (const w of [...workouts].sort(byDate)) {
    const ratios: number[] = [];
    for (const ex of w.exercises) {
      const p = performance(w, ex);
      if (!p.bestE1rm) continue;
      const prev = hist.get(ex.exerciseId) || [];
      if (prev.length >= 2) ratios.push(p.bestE1rm / (prev.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, prev.length)));
      hist.set(ex.exerciseId, [...prev, p.bestE1rm]);
    }
    if (ratios.length) out.set(w.id, ratios.reduce((a, b) => a + b, 0) / ratios.length);
  }
  return out;
}

export function trainingStats(workouts: WorkoutSession[], plans: WorkoutPlan[] | undefined, days: HealthDay[], today: string, unit: WeightUnit, goalWeightKg?: number): TrainingStats {
  const done = workouts.filter(w => isFinished(w) && sessionSets(w) > 0);
  const weeks = weeklyStats(done, today, 12);
  const thisWeek = weeks[weeks.length - 1];
  const plan = activePlan(plans);
  const target = planTarget(plan) || 3;
  let weekStreak = thisWeek.sessions >= target ? 1 : 0;
  for (let i = weeks.length - 2; i >= 0 && weeks[i].sessions >= target; i--) weekStreak++;
  const last28 = done.filter(w => daysBetween(w.date, today) < 28 && w.date <= today);
  const sets = muscleSets(last28);
  const muscles = [...sets].map(([muscle, n]) => ({ muscle, sets: Math.round(n / 4 * 10) / 10 })).sort((a, b) => b.sets - a.sets);
  const groups = groupSets(sets);
  for (const k of Object.keys(groups) as MuscleGroup[]) groups[k] = Math.round(groups[k] / 4 * 10) / 10;
  const trends = exerciseTrends(done, today);
  const records = personalRecords(done);
  const recentRecords = records.filter(r => daysBetween(r.date, today) <= 14).reverse();
  const weight = weightTrend(days, today, goalWeightKg);
  const insights: TrainingInsight[] = [];
  const w = (kg: number) => fmtWeight(kg, unit);

  const prs = recentRecords.filter(r => r.kind === "e1rm" || r.kind === "weight" || r.kind === "reps");
  if (prs.length) {
    const names = [...new Set(prs.map(r => r.name))];
    insights.push({ id: "prs", tone: "good", title: `${prs.length} personal record${prs.length === 1 ? "" : "s"} in the last two weeks`, detail: `${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}.` });
  }
  for (const t of trends.filter(t => t.status === "progressing").slice(0, 2))
    insights.push({ id: `up-${t.exerciseId}`, tone: "good", title: `${t.name} is climbing`, detail: `Estimated max up ${t.perWeekPct}% a week over ${t.sessions} sessions, now ${w(t.latestE1rm)}.` });
  for (const t of trends.filter(t => t.status === "plateau").slice(0, 2))
    insights.push({ id: `flat-${t.exerciseId}`, tone: "warn", title: `${t.name} has stalled`, detail: `No new best in ${t.weeksSinceBest} weeks (best ${w(t.bestE1rm)} estimated). Try a new rep range, a variation, or a lighter week.` });
  for (const t of trends.filter(t => t.status === "declining").slice(0, 2))
    insights.push({ id: `down-${t.exerciseId}`, tone: "warn", title: `${t.name} is slipping`, detail: `Estimated max down ${Math.abs(t.perWeekPct)}% a week. Check sleep, food and how much you're doing overall.` });
  if (last28.length >= 4) {
    if (groups.push > 0 && groups.pull > 0) {
      const ratio = groups.push / groups.pull;
      if (ratio > 1.5) insights.push({ id: "balance-push", tone: "warn", title: "More pushing than pulling", detail: `${groups.push} pushing sets a week vs ${groups.pull} pulling. Extra rows and pulldowns keep shoulders healthy.` });
      else if (ratio < 0.67) insights.push({ id: "balance-pull", tone: "info", title: "More pulling than pushing", detail: `${groups.pull} pulling sets a week vs ${groups.push} pushing.` });
    }
    if (groups.legs < 4 && groups.push + groups.pull > 12) insights.push({ id: "legs", tone: "warn", title: "Legs are getting little work", detail: `${groups.legs} leg sets a week against ${Math.round(groups.push + groups.pull)} for the upper body.` });
    const quads = sets.get("quadriceps") || 0, hams = sets.get("hamstrings") || 0;
    if (quads > 8 && hams < quads / 3) insights.push({ id: "hams", tone: "info", title: "Hamstrings trail quads", detail: "Add Romanian deadlifts or leg curls to balance your knees." });
    const low = muscles.filter(m => ["chest", "lats", "quadriceps", "hamstrings", "shoulders", "glutes"].includes(m.muscle) && m.sets > 0 && m.sets < 6);
    if (low.length) insights.push({ id: "low-volume", tone: "info", title: "Some muscles are under 6 sets a week", detail: `${low.map(m => `${m.muscle} (${m.sets})`).join(", ")}. About 10 hard sets a week is a common target for growth.` });
  }
  if (weekStreak >= 2) insights.push({ id: "streak", tone: "good", title: `${weekStreak} weeks on target`, detail: `${target} or more sessions a week.` });
  const recentWeeks = weeks.slice(-5, -1);
  if (done.length >= 4 && recentWeeks.every(x => x.sessions < target) && thisWeek.sessions < target)
    insights.push({ id: "consistency", tone: "warn", title: "Training has been under target", detail: `${recentWeeks.map(x => x.sessions).join(", ")} sessions in the last four weeks against ${target}.` });
  const volumes = weeks.slice(-5, -1).map(x => x.volumeKg).filter(Boolean);
  if (volumes.length >= 3 && thisWeek.volumeKg > 1.5 * Math.max(...volumes))
    insights.push({ id: "spike", tone: "warn", title: "Big jump in volume this week", detail: "About 50% more than any of the last four weeks. Ramp up gradually to stay ahead of soreness." });

  // Sleep and strength, when Apple Health data is there.
  const index = sessionIndex(done), sleepBy = new Map(days.map(d => [d.date, d.metrics.sleepMin]));
  const short: number[] = [], rested: number[] = [];
  for (const s of done) {
    const v = index.get(s.id), sleep = sleepBy.get(s.date);
    if (v === undefined || sleep === undefined) continue;
    (sleep < 390 ? short : rested).push(v);
  }
  if (short.length >= 3 && rested.length >= 3) {
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const diff = (avg(rested) - avg(short)) * 100;
    if (Math.abs(diff) >= 2) insights.push({ id: "sleep", tone: diff > 0 ? "info" : "good", title: diff > 0 ? "You lift better after a full night" : "Short nights haven't hurt your lifts",
      detail: `Sessions after under 6.5 hours of sleep come in ${Math.abs(diff).toFixed(1)}% ${diff > 0 ? "weaker" : "stronger"} against your recent numbers (${short.length} short nights, ${rested.length} rested).` });
  }
  if (weight.perWeekKg !== undefined && weight.latestKg) {
    const pct = weight.perWeekKg / weight.latestKg * 100;
    if (Math.abs(pct) > 1) insights.push({ id: "weight-fast", tone: "warn", title: `Weight is ${pct > 0 ? "rising" : "dropping"} fast`, detail: `${w(Math.abs(weight.perWeekKg))} a week. Under about 1% of body weight a week keeps strength while ${pct > 0 ? "gaining" : "cutting"}.` });
  }
  return { sessions: done.length, thisWeek, weeks, target, weekStreak, muscles, groups, trends, recentRecords, weight, insights };
}

/** A compact view of training for the assistant. */
export function trainingSummaryForAssistant(workouts: WorkoutSession[], plans: WorkoutPlan[] | undefined, days: HealthDay[], today: string, unit: WeightUnit, goalWeightKg?: number) {
  const stats = trainingStats(workouts, plans, days, today, unit, goalWeightKg);
  const plan = activePlan(plans);
  const next = planDayFor(plan, workouts, today);
  const kg = (v: number | undefined) => v === undefined ? undefined : Math.round(toUnit(v, unit) * 10) / 10;
  const recent = workouts.filter(isFinished).slice(-8).reverse().map(w => ({ id: w.id, date: w.date, name: w.name, minutes: w.durationMin,
    exercises: w.exercises.map(ex => { const p = performance(w, ex); return `${ex.name}: ${p.sets} sets${p.topWeightKg ? `, top ${kg(p.topWeightKg)}×${p.topReps}` : p.maxReps ? `, best ${p.maxReps} reps` : ""}`; }) }));
  return {
    unit, totalSessions: stats.sessions, sessionsThisWeek: stats.thisWeek.sessions, weeklyTarget: stats.target, weeksOnTarget: stats.weekStreak,
    last12Weeks: stats.weeks.map(w => ({ week: w.week, sessions: w.sessions, sets: w.sets, volume: kg(w.volumeKg) })),
    hardSetsPerWeekByMuscle: Object.fromEntries(stats.muscles.map(m => [m.muscle, m.sets])), setsPerWeekByGroup: stats.groups,
    exerciseTrends: stats.trends.slice(0, 15).map(t => ({ ...t, latestE1rm: kg(t.latestE1rm), bestE1rm: kg(t.bestE1rm) })),
    recentRecords: stats.recentRecords.slice(0, 10).map(r => ({ exercise: r.name, kind: r.kind, date: r.date, value: r.kind === "reps" ? r.value : kg(r.value) })),
    bodyWeight: { latest: kg(stats.weight.latestKg), perWeek: kg(stats.weight.perWeekKg), change30Days: kg(stats.weight.change30Kg), goal: kg(goalWeightKg), projectedGoalDate: stats.weight.goalDate },
    insights: stats.insights.map(i => `${i.title}: ${i.detail}`),
    activePlan: plan ? { id: plan.id, name: plan.name, days: plan.days.map(d => ({ id: d.id, name: d.name, weekdays: d.weekdays, exercises: d.exercises.map(e => `${e.name} ${e.sets}×${e.reps}`) })) } : null,
    today: next ? { planDay: next.day.name, planDayId: next.day.id, scheduled: next.scheduled } : plan ? "rest day" : null,
    inProgress: workouts.filter(w => !isFinished(w)).map(w => ({ id: w.id, name: w.name, date: w.date })),
    recentSessions: recent,
  };
}

// ---- Plan templates ----

type T = [string, number, string, number?];
const day = (name: string, weekdays: number[] | undefined, items: T[]): PlanDay => ({ id: crypto.randomUUID(), name, ...(weekdays ? { weekdays } : {}),
  exercises: items.map(([exerciseId, sets, reps, restSec]) => ({ id: crypto.randomUUID(), exerciseId, name: exerciseById(exerciseId)?.name || exerciseId, sets, reps, ...(restSec ? { restSec } : {}) })) });

export interface PlanTemplate { key: string; name: string; description: string; build: () => Pick<WorkoutPlan, "name" | "description" | "days"> }
export const PLAN_TEMPLATES: PlanTemplate[] = [
  { key: "ppl", name: "Push / Pull / Legs", description: "Six days a week, each muscle twice. The classic split for building muscle.", build: () => ({ name: "Push / Pull / Legs", description: "Push, pull and legs, twice a week.", days: [
    day("Push", [1, 4], [["Barbell_Bench_Press_-_Medium_Grip", 4, "6-8", 150], ["x-overhead-press", 3, "6-10", 120], ["Incline_Dumbbell_Press", 3, "8-12", 90], ["x-dumbbell-lateral-raise", 4, "12-15", 60], ["x-cable-triceps-pushdown", 3, "10-12", 60], ["Cable_Rope_Overhead_Triceps_Extension", 3, "10-12", 60]]),
    day("Pull", [2, 5], [["Barbell_Deadlift", 3, "4-6", 180], ["Pullups", 3, "6-10", 120], ["Bent_Over_Barbell_Row", 3, "8-10", 120], ["Face_Pull", 3, "12-15", 60], ["Barbell_Curl", 3, "8-12", 60], ["Hammer_Curls", 3, "10-12", 60]]),
    day("Legs", [3, 6], [["Barbell_Squat", 4, "5-8", 180], ["Romanian_Deadlift", 3, "8-10", 120], ["Leg_Press", 3, "10-12", 120], ["Lying_Leg_Curls", 3, "10-12", 60], ["Standing_Calf_Raises", 4, "10-15", 60], ["Hanging_Leg_Raise", 3, "10-15", 60]]),
  ] }) },
  { key: "ppl3", name: "Push / Pull / Legs (3 days)", description: "Each day once a week. Good when you can train three days.", build: () => ({ name: "Push / Pull / Legs", description: "Three days a week.", days: [
    day("Push", [1], [["Barbell_Bench_Press_-_Medium_Grip", 4, "6-8", 150], ["x-overhead-press", 3, "6-10", 120], ["Incline_Dumbbell_Press", 3, "8-12", 90], ["x-dumbbell-lateral-raise", 3, "12-15", 60], ["x-cable-triceps-pushdown", 3, "10-12", 60]]),
    day("Pull", [3], [["Barbell_Deadlift", 3, "4-6", 180], ["x-lat-pulldown", 3, "8-12", 90], ["Seated_Cable_Rows", 3, "8-12", 90], ["Face_Pull", 3, "12-15", 60], ["Barbell_Curl", 3, "8-12", 60]]),
    day("Legs", [5], [["Barbell_Squat", 4, "5-8", 180], ["Romanian_Deadlift", 3, "8-10", 120], ["Leg_Extensions", 3, "10-15", 60], ["Seated_Leg_Curl", 3, "10-12", 60], ["Standing_Calf_Raises", 3, "10-15", 60]]),
  ] }) },
  { key: "upper-lower", name: "Upper / Lower", description: "Four days: upper and lower body twice each.", build: () => ({ name: "Upper / Lower", description: "Four days a week.", days: [
    day("Upper A", [1], [["Barbell_Bench_Press_-_Medium_Grip", 4, "5-8", 150], ["Bent_Over_Barbell_Row", 4, "6-10", 120], ["Dumbbell_Shoulder_Press", 3, "8-12", 90], ["x-lat-pulldown", 3, "8-12", 90], ["Barbell_Curl", 2, "10-12", 60], ["x-cable-triceps-pushdown", 2, "10-12", 60]]),
    day("Lower A", [2], [["Barbell_Squat", 4, "5-8", 180], ["Romanian_Deadlift", 3, "8-10", 120], ["Leg_Press", 3, "10-12", 120], ["Standing_Calf_Raises", 4, "10-15", 60], ["Plank", 3, "45s", 60]]),
    day("Upper B", [4], [["x-overhead-press", 4, "5-8", 150], ["Pullups", 4, "6-10", 120], ["Incline_Dumbbell_Press", 3, "8-12", 90], ["Seated_Cable_Rows", 3, "10-12", 90], ["x-dumbbell-lateral-raise", 3, "12-15", 60], ["Hammer_Curls", 2, "10-12", 60]]),
    day("Lower B", [5], [["Barbell_Deadlift", 3, "3-5", 180], ["x-bulgarian-split-squat", 3, "8-10", 90], ["Lying_Leg_Curls", 3, "10-12", 60], ["Leg_Extensions", 3, "12-15", 60], ["Hanging_Leg_Raise", 3, "10-15", 60]]),
  ] }) },
  { key: "full-body", name: "Full body, 3 days", description: "The whole body each session, Monday, Wednesday, Friday. Great for beginners.", build: () => ({ name: "Full body", description: "Three full-body sessions a week.", days: [
    day("Full body A", [1], [["Barbell_Squat", 3, "5-8", 150], ["Barbell_Bench_Press_-_Medium_Grip", 3, "5-8", 150], ["Bent_Over_Barbell_Row", 3, "8-10", 90], ["x-dumbbell-lateral-raise", 2, "12-15", 60], ["Plank", 3, "45s", 60]]),
    day("Full body B", [3], [["Barbell_Deadlift", 3, "4-6", 180], ["x-overhead-press", 3, "6-8", 120], ["x-lat-pulldown", 3, "8-12", 90], ["Dumbbell_Lunges", 2, "10-12", 60], ["Barbell_Curl", 2, "10-12", 60]]),
    day("Full body C", [5], [["Leg_Press", 3, "10-12", 120], ["Incline_Dumbbell_Press", 3, "8-12", 90], ["Seated_Cable_Rows", 3, "10-12", 90], ["Lying_Leg_Curls", 2, "10-12", 60], ["x-cable-triceps-pushdown", 2, "10-12", 60]]),
  ] }) },
  { key: "strength-5x5", name: "Strength 5×5", description: "Alternate two short workouts on the big barbell lifts, adding weight each session.", build: () => ({ name: "Strength 5×5", description: "Alternate A and B, three days a week.", days: [
    day("Workout A", undefined, [["Barbell_Squat", 5, "5", 180], ["Barbell_Bench_Press_-_Medium_Grip", 5, "5", 180], ["Bent_Over_Barbell_Row", 5, "5", 180]]),
    day("Workout B", undefined, [["Barbell_Squat", 5, "5", 180], ["x-overhead-press", 5, "5", 180], ["Barbell_Deadlift", 1, "5", 240]]),
  ] }) },
  { key: "bro", name: "Body-part split", description: "Five days, one muscle group each: chest, back, shoulders, legs, arms.", build: () => ({ name: "Body-part split", description: "Five days a week.", days: [
    day("Chest", [1], [["Barbell_Bench_Press_-_Medium_Grip", 4, "6-10", 120], ["Incline_Dumbbell_Press", 3, "8-12", 90], ["Cable_Crossover", 3, "12-15", 60], ["Dips_-_Chest_Version", 3, "8-12", 90]]),
    day("Back", [2], [["Barbell_Deadlift", 3, "5", 180], ["Pullups", 4, "6-10", 120], ["One-Arm_Dumbbell_Row", 3, "8-12", 90], ["Seated_Cable_Rows", 3, "10-12", 90]]),
    day("Shoulders", [3], [["x-overhead-press", 4, "6-10", 120], ["x-dumbbell-lateral-raise", 4, "12-15", 60], ["Reverse_Flyes", 3, "12-15", 60], ["Barbell_Shrug", 3, "10-12", 60]]),
    day("Legs", [4], [["Barbell_Squat", 4, "6-10", 180], ["Romanian_Deadlift", 3, "8-10", 120], ["Leg_Extensions", 3, "12-15", 60], ["Lying_Leg_Curls", 3, "10-12", 60], ["Standing_Calf_Raises", 4, "10-15", 60]]),
    day("Arms", [5], [["Barbell_Curl", 3, "8-12", 60], ["EZ-Bar_Skullcrusher", 3, "8-12", 60], ["Hammer_Curls", 3, "10-12", 60], ["x-cable-triceps-pushdown", 3, "10-12", 60], ["Preacher_Curl", 2, "10-12", 60]]),
  ] }) },
  { key: "home", name: "Home, no equipment", description: "Bodyweight only, three days a week. Push-ups, squats, lunges and core.", build: () => ({ name: "Home bodyweight", description: "No equipment needed.", days: [
    day("Upper", [1, 4], [["Pushups", 4, "8-20", 60], ["x-pike-push-up", 3, "6-12", 60], ["Inverted_Row", 3, "8-12", 60], ["x-diamond-push-up", 3, "6-15", 60], ["Plank", 3, "45s", 45]]),
    day("Lower", [2, 5], [["Bodyweight_Squat", 4, "15-25", 60], ["x-bulgarian-split-squat", 3, "8-12", 60], ["Butt_Lift_Bridge", 3, "12-20", 45], ["x-wall-sit", 3, "45s", 45], ["x-side-plank", 3, "30s", 30]]),
    day("Conditioning", [6], [["x-burpee", 4, "10", 60], ["Mountain_Climbers", 4, "30s", 30], ["x-jumping-jacks", 3, "45s", 30], ["x-hollow-body-hold", 3, "30s", 30]]),
  ] }) },
];

import type { HealthDay, HealthProfile } from "../types";
import { DEFAULT_SLEEP_GOAL_MIN, DEFAULT_STEP_GOAL, healthMetric } from "./health";

/**
 * Metrics computed from raw Apple Health days, each one measured against the user's own history rather
 * than population averages. Pure: the workspace, the assistant and the tests all call the same functions.
 *
 * - Recovery: this morning's HRV and resting heart rate as z-scores against the previous 28 days, plus last
 *   night's sleep against the sleep goal. 60 means "a normal day for you".
 * - Training load: Banister TRIMP per workout (heart-rate reserve weighted), smoothed into 7-day fatigue
 *   and 42-day fitness. Their ratio is the acute:chronic workload ratio.
 * - Sleep debt: shortfall against the goal over 14 nights, recent nights weighted most.
 * - Sleep regularity: how much bedtime and wake time vary over 14 nights.
 * - Strain signals: HRV, resting HR, breathing rate and wrist temperature moving off baseline together,
 *   which often shows up a day or two before you feel run down. Not a diagnosis.
 * - Tag effects: how the morning after a tagged day (alcohol, late meal…) differs from other mornings.
 */

export interface Baseline { mean: number; sd: number; n: number }
export interface RecoveryComponent { key: "hrv" | "restingHr" | "sleep" | "respRate"; label: string; detail: string; z: number; good: boolean }
export interface Recovery { date: string; score: number; label: string; components: RecoveryComponent[] }
export interface SeriesPoint { date: string; recovery?: number; load: number; fatigue: number; fitness: number; sleepMin?: number; hrv?: number; restingHr?: number; steps?: number }
export interface Trend { key: string; label: string; unit: string; recent: number; baseline: number; changePct: number; better?: boolean; decimals: number }
export interface TagEffect { tag: string; days: number; effects: Array<{ key: string; label: string; tagged: number; other: number; diffPct: number; better: boolean }> }
export interface HealthInsights {
  today: string;
  dayCount: number;
  latest?: HealthDay;
  lastSyncAt?: string;
  recovery?: Recovery;
  series: SeriesPoint[];
  sleep: { lastNightMin?: number; avg7Min?: number; goalMin: number; debtMin: number; regularity?: { score: number; bedtimeSdMin: number; wakeSdMin: number; avgBedtime: string; avgWake: string; nights: number } };
  training: { fatigue: number; fitness: number; form: number; ratio?: number; zone?: string; weekLoad: number; maxHr: number; maxHrSource: string; estimated: boolean };
  steps: { today?: number; goal: number; avg7?: number; streak: number };
  trends: Trend[];
  vo2?: { latest: number; perMonth?: number };
  strain: string[];
  tagEffects: TagEffect[];
  baselines: Partial<Record<"hrv" | "restingHr" | "respRate" | "wristTempC" | "sleepMin", Baseline>>;
}

const BASELINE_DAYS = 28;
const MIN_BASELINE = 7;
const addDays = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
function stats(xs: number[]): Baseline | undefined {
  if (xs.length < MIN_BASELINE) return undefined;
  const m = mean(xs);
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
  return { mean: m, sd, n: xs.length };
}
const clock = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 || 12}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const minutesOf = (stamp: string) => Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16));
/** Bedtimes after midnight count as late, not early: 1 AM is 25:00. */
const bedMinutes = (stamp: string) => { const m = minutesOf(stamp); return m < 18 * 60 ? m + 1440 : m; };

export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Maximum heart rate: the user's own number, else the highest seen in a year of workouts, else from age. */
export function maxHeartRate(days: HealthDay[], profile: HealthProfile | undefined, today: string): { value: number; source: string } {
  if (profile?.maxHr) return { value: profile.maxHr, source: "your setting" };
  const since = addDays(today, -365);
  let seen = 0;
  for (const d of days) {
    if (d.date < since) continue;
    seen = Math.max(seen, d.metrics.maxHr || 0, ...(d.workouts || []).map(w => w.maxHr || 0));
  }
  if (seen >= 150) return { value: seen, source: "highest in your workouts this year" };
  if (profile?.birthYear) return { value: Math.round(208 - 0.7 * (Number(today.slice(0, 4)) - profile.birthYear)), source: "estimated from age" };
  return { value: 190, source: "default (add your age or max HR)" };
}

/** Banister TRIMP for one workout; falls back to a moderate-effort estimate without heart rate. */
export function workoutLoad(minutes: number, avgHr: number | undefined, restHr: number, maxHr: number, sex?: "female" | "male"): number {
  if (!avgHr || maxHr <= restHr) return minutes * 0.84;
  const hrr = clamp((avgHr - restHr) / (maxHr - restHr), 0, 1);
  const [a, k] = sex === "female" ? [0.86, 1.67] : [0.64, 1.92];
  return minutes * hrr * a * Math.exp(k * hrr);
}

export function computeHealth(input: HealthDay[], profile: HealthProfile | undefined, today = localToday()): HealthInsights {
  const days = [...input].filter(d => d.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(days.map(d => [d.date, d]));
  const goalMin = profile?.sleepGoalMin || DEFAULT_SLEEP_GOAL_MIN;
  const stepGoal = profile?.stepGoal || DEFAULT_STEP_GOAL;
  const max = maxHeartRate(days, profile, today);
  const empty: HealthInsights = {
    today, dayCount: 0, series: [], sleep: { goalMin, debtMin: 0 }, steps: { goal: stepGoal, streak: 0 }, trends: [], strain: [], tagEffects: [], baselines: {},
    training: { fatigue: 0, fitness: 0, form: 0, weekLoad: 0, maxHr: max.value, maxHrSource: max.source, estimated: false },
  };
  if (!days.length) return empty;

  const first = days[0].date;
  const span = daysBetween(first, today);
  const dates = Array.from({ length: span + 1 }, (_, i) => addDays(first, i));
  const value = (date: string, key: string) => byDate.get(date)?.metrics[key];
  const window = (date: string, key: string, transform: (v: number) => number = v => v) => {
    const xs: number[] = [];
    for (let i = 1; i <= BASELINE_DAYS; i++) { const v = value(addDays(date, -i), key); if (v !== undefined) xs.push(transform(v)); }
    return xs;
  };

  // Training load, smoothed day by day across the whole history.
  const atlK = 1 - Math.exp(-1 / 7), ctlK = 1 - Math.exp(-1 / 42);
  let fatigue = 0, fitness = 0, estimated = false;
  const loads = new Map<string, number>();
  const series: SeriesPoint[] = [];
  const recoveryByDate = new Map<string, Recovery>();

  for (const date of dates) {
    const day = byDate.get(date);
    const restBase = stats(window(date, "restingHr"));
    const rest = day?.metrics.restingHr ?? restBase?.mean ?? 60;
    let load = 0;
    if (day?.workouts?.length) {
      for (const w of day.workouts) { load += workoutLoad(w.minutes, w.avgHr, rest, max.value, profile?.sex); if (!w.avgHr) estimated = true; }
    } else if (day?.metrics.exerciseMin) { load = day.metrics.exerciseMin * 0.84; estimated = true; }
    loads.set(date, load);
    fatigue += (load - fatigue) * atlK;
    fitness += (load - fitness) * ctlK;
    const recovery = day ? recoveryFor(date, day, window, goalMin) : undefined;
    if (recovery) recoveryByDate.set(date, recovery);
    series.push({ date, recovery: recovery?.score, load: round(load), fatigue: round(fatigue, 1), fitness: round(fitness, 1),
      sleepMin: day?.metrics.sleepMin, hrv: day?.metrics.hrv, restingHr: day?.metrics.restingHr, steps: day?.metrics.steps });
  }

  const latest = days[days.length - 1];
  const recovery = recoveryByDate.get(today) || (daysBetween(latest.date, today) <= 1 ? recoveryByDate.get(latest.date) : undefined);
  const ratio = fitness >= 5 ? fatigue / fitness : undefined;
  const zone = ratio === undefined ? undefined : ratio < 0.8 ? "Detraining" : ratio <= 1.3 ? "Productive" : ratio <= 1.5 ? "High" : "Spike";
  let weekLoad = 0;
  for (let i = 0; i < 7; i++) weekLoad += loads.get(addDays(today, -i)) || 0;

  // Sleep.
  let debt = 0;
  for (let i = 0; i < 14; i++) { const s = value(addDays(today, -i), "sleepMin"); if (s !== undefined) debt += 0.85 ** i * (goalMin - s); }
  const last7Sleep = Array.from({ length: 7 }, (_, i) => value(addDays(today, -i), "sleepMin")).filter((v): v is number => v !== undefined);
  const nights = Array.from({ length: 14 }, (_, i) => byDate.get(addDays(today, -i))).filter((d): d is HealthDay => !!d?.sleepStart && !!d.sleepEnd);
  let regularity: HealthInsights["sleep"]["regularity"];
  if (nights.length >= 5) {
    const beds = nights.map(n => bedMinutes(n.sleepStart!)), wakes = nights.map(n => minutesOf(n.sleepEnd!));
    const sd = (xs: number[]) => Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / (xs.length - 1));
    const bedSd = sd(beds), wakeSd = sd(wakes);
    regularity = { score: clamp(Math.round(100 - (bedSd + wakeSd) / 2 * 0.8), 0, 100), bedtimeSdMin: Math.round(bedSd), wakeSdMin: Math.round(wakeSd),
      avgBedtime: clock(mean(beds)), avgWake: clock(mean(wakes)), nights: nights.length };
  }

  // Steps.
  const stepsToday = value(today, "steps");
  let streak = 0;
  for (let i = stepsToday !== undefined && stepsToday >= stepGoal ? 0 : 1; ; i++) {
    const s = value(addDays(today, -i), "steps");
    if (s === undefined || s < stepGoal) break;
    streak++;
  }
  const steps7 = Array.from({ length: 7 }, (_, i) => value(addDays(today, -i - 1), "steps")).filter((v): v is number => v !== undefined);

  // Baselines as of today, for display and strain checks.
  const baselines: HealthInsights["baselines"] = {};
  const lnHrv = stats(window(today, "hrv", Math.log));
  if (lnHrv) baselines.hrv = { mean: round(Math.exp(lnHrv.mean)), sd: round(lnHrv.sd, 3), n: lnHrv.n };
  for (const key of ["restingHr", "respRate", "wristTempC", "sleepMin"] as const) { const b = stats(window(today, key)); if (b) baselines[key] = { mean: round(b.mean, 2), sd: round(b.sd, 2), n: b.n }; }

  return {
    today, dayCount: days.length, latest, lastSyncAt: days.reduce<string | undefined>((m, d) => d.source && d.source !== "manual" && (!m || d.updatedAt > m) ? d.updatedAt : m, undefined),
    recovery, series: series.slice(-90),
    sleep: { lastNightMin: value(today, "sleepMin"), avg7Min: last7Sleep.length ? Math.round(mean(last7Sleep)) : undefined, goalMin, debtMin: Math.max(0, Math.round(debt)), regularity },
    training: { fatigue: round(fatigue, 1), fitness: round(fitness, 1), form: round(fitness - fatigue, 1), ratio: ratio === undefined ? undefined : round(ratio, 2), zone,
      weekLoad: Math.round(weekLoad), maxHr: max.value, maxHrSource: max.source, estimated },
    steps: { today: stepsToday, goal: stepGoal, avg7: steps7.length ? Math.round(mean(steps7)) : undefined, streak },
    trends: trends(today, value),
    vo2: vo2Trend(days, today),
    strain: strainSignals(today, byDate.get(today) || (daysBetween(latest.date, today) <= 1 ? latest : undefined), window),
    tagEffects: tagEffects(days, recoveryByDate),
    baselines,
  };
}

export function recoveryFor(date: string, day: HealthDay, window: (date: string, key: string, t?: (v: number) => number) => number[], goalMin: number): Recovery | undefined {
  const parts: Array<RecoveryComponent & { weight: number }> = [];
  const hrvBase = stats(window(date, "hrv", Math.log));
  if (day.metrics.hrv && hrvBase) {
    const z = clamp((Math.log(day.metrics.hrv) - hrvBase.mean) / Math.max(hrvBase.sd, 0.05), -3, 3);
    parts.push({ key: "hrv", label: "HRV", weight: 0.45, z, good: z >= 0, detail: `${day.metrics.hrv} ms vs your usual ${Math.round(Math.exp(hrvBase.mean))} ms` });
  }
  const rhrBase = stats(window(date, "restingHr"));
  if (day.metrics.restingHr && rhrBase) {
    const z = clamp((day.metrics.restingHr - rhrBase.mean) / Math.max(rhrBase.sd, 1), -3, 3);
    parts.push({ key: "restingHr", label: "Resting HR", weight: 0.3, z: -z, good: z <= 0, detail: `${day.metrics.restingHr} bpm vs your usual ${Math.round(rhrBase.mean)} bpm` });
  }
  if (!parts.length) return undefined; // Sleep alone is not a recovery signal.
  if (day.metrics.sleepMin !== undefined) {
    const ratio = day.metrics.sleepMin / goalMin;
    const z = clamp((ratio - 1) / 0.15, -3, 1);
    parts.push({ key: "sleep", label: "Sleep", weight: 0.25, z, good: ratio >= 0.9, detail: `${hm(day.metrics.sleepMin)} of your ${hm(goalMin)} goal` });
  }
  let raw = parts.reduce((a, p) => a + p.weight * p.z, 0) / parts.reduce((a, p) => a + p.weight, 0);
  const respBase = stats(window(date, "respRate"));
  if (day.metrics.respRate && respBase) {
    const z = (day.metrics.respRate - respBase.mean) / Math.max(respBase.sd, 0.3);
    if (z > 1) {
      raw -= 0.5 * (z - 1);
      parts.push({ key: "respRate", label: "Breathing rate", weight: 0, z: -z, good: false, detail: `${day.metrics.respRate} br/min, above your usual ${round(respBase.mean, 1)}` });
    }
  }
  const score = Math.round(100 / (1 + Math.exp(-(1.3 * raw + 0.4))));
  return { date, score, label: score >= 70 ? "Primed" : score >= 45 ? "Normal" : score >= 30 ? "Strained" : "Take it easy", components: parts.map(({ weight: _w, ...p }) => ({ ...p, z: round(p.z, 2) })) };
}

export const hm = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, "0")}m`;

const TREND_KEYS: Array<{ key: string; higherIsBetter?: boolean }> = [
  { key: "restingHr", higherIsBetter: false }, { key: "hrv", higherIsBetter: true }, { key: "sleepMin", higherIsBetter: true }, { key: "steps", higherIsBetter: true },
  { key: "exerciseMin", higherIsBetter: true }, { key: "activeKcal", higherIsBetter: true }, { key: "respRate", higherIsBetter: false }, { key: "daylightMin", higherIsBetter: true },
  { key: "weightKg" },
];
function trends(today: string, value: (date: string, key: string) => number | undefined): Trend[] {
  const out: Trend[] = [];
  for (const { key, higherIsBetter } of TREND_KEYS) {
    const recent: number[] = [], base: number[] = [];
    for (let i = 0; i < 35; i++) { const v = value(addDays(today, -i), key); if (v !== undefined) (i < 7 ? recent : base).push(v); }
    if (recent.length < 3 || base.length < 7) continue;
    const r = mean(recent), b = mean(base);
    if (!b) continue;
    const changePct = round((r - b) / b * 100, 1);
    const def = healthMetric(key)!;
    out.push({ key, label: def.label, unit: def.unit, recent: round(r, def.decimals), baseline: round(b, def.decimals), changePct, decimals: def.decimals,
      better: higherIsBetter === undefined || Math.abs(changePct) < 2 ? undefined : (changePct > 0) === higherIsBetter });
  }
  return out;
}

function vo2Trend(days: HealthDay[], today: string): HealthInsights["vo2"] {
  const points = days.filter(d => d.metrics.vo2max !== undefined && d.date >= addDays(today, -120)).map(d => ({ x: daysBetween(today, d.date), y: d.metrics.vo2max! }));
  const all = days.filter(d => d.metrics.vo2max !== undefined);
  if (!all.length) return undefined;
  const latest = all[all.length - 1].metrics.vo2max!;
  if (points.length < 3 || points[points.length - 1].x - points[0].x < 14) return { latest };
  const mx = mean(points.map(p => p.x)), my = mean(points.map(p => p.y));
  const slope = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  return { latest, perMonth: round(slope * 30, 2) };
}

function strainSignals(today: string, day: HealthDay | undefined, window: (date: string, key: string, t?: (v: number) => number) => number[]): string[] {
  if (!day) return [];
  const out: string[] = [];
  const z = (key: string, floor: number, t?: (v: number) => number) => {
    const b = stats(window(day.date, key, t));
    const v = day.metrics[key];
    return b && v !== undefined ? { z: ((t ? t(v) : v) - b.mean) / Math.max(b.sd, floor), b } : undefined;
  };
  const hrv = z("hrv", 0.05, Math.log), rhr = z("restingHr", 1), resp = z("respRate", 0.3), temp = z("wristTempC", 0.1);
  if (hrv && rhr && hrv.z <= -1 && rhr.z >= 1) out.push("HRV is down and resting heart rate is up at the same time, a common sign your body is fighting something or under-recovered.");
  else if (rhr && rhr.z >= 2) out.push(`Resting heart rate is well above your usual (${day.metrics.restingHr} vs ${Math.round(rhr.b.mean)} bpm).`);
  if (resp && resp.z >= 2) out.push(`Breathing rate during sleep is higher than usual (${day.metrics.respRate} vs ${round(resp.b.mean, 1)} br/min).`);
  if (temp && day.metrics.wristTempC! - temp.b.mean >= 0.5) out.push(`Sleeping wrist temperature is ${round(day.metrics.wristTempC! - temp.b.mean, 1)} °C above your baseline.`);
  return day.date === today || out.length ? out : [];
}

const EFFECT_KEYS = [
  { key: "hrv", label: "HRV", higher: true }, { key: "restingHr", label: "Resting HR", higher: false },
  { key: "sleepMin", label: "Sleep", higher: true }, { key: "recovery", label: "Recovery", higher: true },
];
function tagEffects(days: HealthDay[], recovery: Map<string, Recovery>): TagEffect[] {
  const tagged = new Map<string, Set<string>>();
  for (const d of days) for (const t of d.tags || []) { let s = tagged.get(t); if (!s) tagged.set(t, s = new Set()); s.add(d.date); }
  const byDate = new Map(days.map(d => [d.date, d]));
  const morning = (date: string, key: string) => key === "recovery" ? recovery.get(date)?.score : byDate.get(date)?.metrics[key];
  const out: TagEffect[] = [];
  for (const [tag, dates] of tagged) {
    if (dates.size < 3) continue;
    const effects: TagEffect["effects"] = [];
    for (const { key, label, higher } of EFFECT_KEYS) {
      const after: number[] = [], other: number[] = [];
      for (const d of days) {
        const v = morning(d.date, key);
        if (v === undefined) continue;
        (dates.has(addDays(d.date, -1)) ? after : other).push(v);
      }
      if (after.length < 3 || other.length < 7) continue;
      const a = mean(after), o = mean(other);
      if (!o) continue;
      const diffPct = round((a - o) / o * 100, 1);
      if (Math.abs(diffPct) < 3) continue;
      effects.push({ key, label, tagged: round(a, 1), other: round(o, 1), diffPct, better: (diffPct > 0) === higher });
    }
    if (effects.length) out.push({ tag, days: dates.size, effects: effects.sort((x, y) => Math.abs(y.diffPct) - Math.abs(x.diffPct)) });
  }
  return out.sort((a, b) => Math.abs(b.effects[0].diffPct) - Math.abs(a.effects[0].diffPct));
}

/** A compact, readable summary for the assistant. */
export function healthSummaryForAssistant(days: HealthDay[], profile: HealthProfile | undefined, today = localToday()) {
  const h = computeHealth(days, profile, today);
  if (!h.dayCount) return { available: false, message: "No Apple Health data yet. Import an Apple Health export (Health app → profile → Export All Health Data) in the Health workspace." };
  return {
    available: true, today, daysOfData: h.dayCount, latestDay: h.latest?.date, lastImportAt: h.lastSyncAt,
    ...(h.latest && h.latest.date < today ? { dataNote: `Data ends ${h.latest.date}; newer days need a fresh Apple Health export.` } : {}),
    recovery: h.recovery ? { score: h.recovery.score, label: h.recovery.label, date: h.recovery.date, why: h.recovery.components.map(c => `${c.label}: ${c.detail}`) } : "Needs at least 7 days of HRV or resting heart rate.",
    sleep: { lastNight: h.sleep.lastNightMin !== undefined ? hm(h.sleep.lastNightMin) : undefined, average7: h.sleep.avg7Min !== undefined ? hm(h.sleep.avg7Min) : undefined,
      goal: hm(h.sleep.goalMin), debt: hm(h.sleep.debtMin), regularity: h.sleep.regularity },
    training: { ...h.training, guide: "fatigue = 7-day load, fitness = 42-day load, ratio 0.8-1.3 is the productive range, above 1.5 is a spike" },
    steps: h.steps, trends: h.trends.map(t => `${t.label}: ${t.recent} ${t.unit} over the last 7 days vs ${t.baseline} before (${t.changePct > 0 ? "+" : ""}${t.changePct}%)`),
    vo2max: h.vo2, strainSignals: h.strain, tagEffects: h.tagEffects.map(t => `After "${t.tag}" days (${t.days}): ${t.effects.map(e => `${e.label} ${e.diffPct > 0 ? "+" : ""}${e.diffPct}%`).join(", ")}`),
    note: "Personal patterns from wearable data, not medical advice. Correlations from tags are not proof of cause.",
  };
}

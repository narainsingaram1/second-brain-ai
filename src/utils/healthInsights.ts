import type { HealthDay, HealthProfile } from "../types";
import { DEFAULT_SLEEP_GOAL_MIN } from "./health";
import { hm, localToday, maxHeartRate, recoveryFor, workoutLoad, type Recovery } from "./healthMetrics";

/**
 * Deeper reading of Apple Health days. Pure, like healthMetrics: the workspace, the assistant and the tests
 * share it.
 *
 * - Sleep score: six parts, each judged against what you needed that night and against your own history.
 *   The target moves: sleep need is your goal, plus some of the debt you carry, plus extra after hard
 *   training the day before.
 * - Patterns: rank correlations between what you did (daylight, steps, training, workout timing, bedtime)
 *   and what followed (sleep score, deep sleep, HRV, recovery), kept only when the link is clear in your
 *   data. Each comes with the plain difference between your high and low days.
 * - Weekday rhythm, social jetlag (weekend shift of the sleep midpoint), the bedtime window with your best
 *   mornings, bedtime drift, personal records and how long sleep debt takes to clear.
 *
 * Patterns are associations in one person's data, not proof of cause and not medical advice.
 */

// ---- Small helpers ----
const addDays = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
const quantile = (sorted: number[], q: number) => { const p = (sorted.length - 1) * q, i = Math.floor(p); return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (p - i); };
const minutesOf = (stamp: string) => Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16));
/** Bedtimes on the evening clock: 11 PM is 23:00, 1 AM is 25:00. */
const bedMinutes = (stamp: string) => { const m = minutesOf(stamp); return m < 18 * 60 ? m + 1440 : m; };
export const clock = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 || 12}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
/** "45 min" under an hour, "1h 20m" above. */
export const dur = (minutes: number) => minutes < 60 ? `${Math.round(minutes)} min` : hm(minutes);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Value formats the UI and summaries share. */
export type ValueKind = "score" | "min" | "hm" | "count" | "kcal" | "ms" | "bpm" | "clock" | "load" | "pct";
export function formatValue(kind: ValueKind, v: number): string {
  switch (kind) {
    case "score": return `${Math.round(v)}`;
    case "min": return `${Math.round(v)} min`;
    case "hm": return hm(Math.max(0, v));
    case "count": return v >= 10000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toLocaleString();
    case "kcal": return `${Math.round(v)} kcal`;
    case "ms": return `${Math.round(v)} ms`;
    case "bpm": return `${Math.round(v)} bpm`;
    case "clock": return clock(v);
    case "load": return `${Math.round(v)}`;
    case "pct": return `${Math.round(v)}%`;
  }
}

// ---- Types ----
export type SleepPart = "duration" | "efficiency" | "restorative" | "timing" | "interruptions" | "physiology";
export interface SleepComponent { key: SleepPart; label: string; score: number; weight: number; detail: string }
export interface SleepNeed { totalMin: number; goalMin: number; debtMin: number; trainingMin: number }
export interface SleepNight {
  date: string;
  score: number;
  label: "Excellent" | "Good" | "Fair" | "Poor";
  components: SleepComponent[];
  need: SleepNeed;
  sleepMin: number;
  bedtime?: number;
  wake?: number;
  stages?: { deepMin: number; remMin: number; coreMin: number; awakeMin: number };
  efficiency?: number;
  /** The part that cost the most points, in a sentence. Absent on excellent nights. */
  topFix?: string;
}
export interface Pattern {
  id: string;
  title: string;
  body: string;
  rho: number;
  n: number;
  strength: "clear" | "strong";
  /** True when more of the factor goes with a better outcome. */
  helps: boolean;
  x: { label: string; kind: ValueKind };
  y: { label: string; kind: ValueKind };
  points: Array<{ x: number; y: number; date: string }>;
}
export interface WeekdayStat { weekday: number; night: string; day: string; sleepScore?: number; sleepMin?: number; recovery?: number; steps?: number; n: number }
export interface HealthRecord { key: string; label: string; value: string; date: string }
export interface Insight {
  id: string;
  kind: "pattern" | "timing" | "rhythm" | "trend" | "debt" | "record" | "tag";
  title: string;
  body: string;
  tone: "good" | "bad" | "neutral";
  /** Ranking weight, 0–1. */
  weight: number;
  patternId?: string;
}
export interface DeepHealth {
  date: string;
  /** Nights scored, oldest first, up to 180. */
  nights: SleepNight[];
  /** The night that ended on `date`. */
  night?: SleepNight;
  /** Sleep score and recovery per morning, up to 180 days, oldest first. */
  mornings: Array<{ date: string; sleepScore?: number; recovery?: number }>;
  usual: { sleepScore?: number; deepMin?: number; remMin?: number; coreMin?: number; awakeMin?: number; bedtime?: number; wake?: number };
  patterns: Pattern[];
  weekdays: WeekdayStat[];
  jetlag?: { minutes: number; workMid: number; freeMid: number; nights: number };
  bestBedtime?: { from: number; to: number; recovery: number; overall: number; nights: number };
  drift?: { minutes: number; recent: number; before: number };
  debt?: { min: number; nightsToClear: number };
  records: HealthRecord[];
  insights: Insight[];
}

// ---- Daily training load ----
function dailyLoads(days: HealthDay[], profile: HealthProfile | undefined, today: string): Map<string, number> {
  const max = maxHeartRate(days, profile, today).value;
  const out = new Map<string, number>();
  for (const d of days) {
    const rest = d.metrics.restingHr ?? 60;
    let load = 0;
    if (d.workouts?.length) for (const w of d.workouts) load += workoutLoad(w.minutes, w.avgHr, rest, max, profile?.sex);
    else if (d.metrics.exerciseMin) load = d.metrics.exerciseMin * 0.84;
    out.set(d.date, load);
  }
  return out;
}

// ---- Sleep score ----
const restorativeShare = (d?: HealthDay) => {
  const s = d?.metrics.sleepMin, deep = d?.metrics.deepMin, rem = d?.metrics.remMin;
  return s && deep !== undefined && rem !== undefined ? (deep + rem) / s : undefined;
};
function efficiencyOf(d: HealthDay): number | undefined {
  const s = d.metrics.sleepMin;
  if (!s) return undefined;
  if (d.metrics.inBedMin && d.metrics.inBedMin >= s) return s / d.metrics.inBedMin;
  if (d.metrics.awakeMin !== undefined) return s / (s + d.metrics.awakeMin);
  if (d.sleepStart && d.sleepEnd) {
    const span = (Date.parse(`${d.sleepEnd.replace(" ", "T")}:00Z`) - Date.parse(`${d.sleepStart.replace(" ", "T")}:00Z`)) / 60000;
    if (span >= s && span < 1440) return s / span;
  }
  return undefined;
}
const sleepLabel = (score: number): SleepNight["label"] => score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Fair" : "Poor";

/** Sleep need for the night ending on `date`: goal + part of the debt carried in + extra after hard training. */
export function sleepNeedFor(date: string, byDate: Map<string, HealthDay>, loads: Map<string, number>, goalMin: number): SleepNeed {
  let debt = 0;
  for (let i = 1; i <= 14; i++) { const s = byDate.get(addDays(date, -i))?.metrics.sleepMin; if (s !== undefined) debt += 0.85 ** (i - 1) * (goalMin - s); }
  debt = Math.max(0, debt);
  const debtMin = Math.min(45, Math.round(debt * 0.15 / 5) * 5);
  const trainingMin = Math.min(40, Math.round((loads.get(addDays(date, -1)) || 0) * 0.2 / 5) * 5);
  return { totalMin: goalMin + debtMin + trainingMin, goalMin, debtMin, trainingMin };
}

export function scoreNight(date: string, byDate: Map<string, HealthDay>, loads: Map<string, number>, goalMin: number): SleepNight | undefined {
  const day = byDate.get(date);
  const sleepMin = day?.metrics.sleepMin;
  if (!day || !sleepMin || sleepMin < 60) return undefined;
  const prior = (n: number) => Array.from({ length: n }, (_, i) => byDate.get(addDays(date, -i - 1))).filter((d): d is HealthDay => !!d);
  const prior28 = prior(28), prior14 = prior(14);
  const need = sleepNeedFor(date, byDate, loads, goalMin);
  const parts: SleepComponent[] = [];

  // Duration against tonight's need, not a fixed number.
  const ratio = sleepMin / need.totalMin;
  parts.push({ key: "duration", label: "Duration", weight: 0.3, score: Math.round(clamp(100 - 180 * (1 - ratio), 0, 100)),
    detail: ratio >= 1 ? `${hm(sleepMin)}, enough for the ${hm(need.totalMin)} you needed` : `${hm(sleepMin)} of the ${hm(need.totalMin)} you needed (${hm(need.totalMin - sleepMin)} short)` });

  const eff = efficiencyOf(day);
  if (eff !== undefined) parts.push({ key: "efficiency", label: "Efficiency", weight: 0.15, score: Math.round(clamp((eff - 0.75) / (0.93 - 0.75) * 100, 0, 100)),
    detail: `${Math.round(eff * 100)}% of time in bed asleep` });

  const share = restorativeShare(day);
  if (share !== undefined) {
    const history = prior28.map(restorativeShare).filter((v): v is number => v !== undefined);
    const absolute = clamp((share - 0.2) / (0.42 - 0.2) * 100, 0, 100);
    let score = absolute, detail = `${Math.round(share * 100)}% deep + REM`;
    if (history.length >= 7) {
      const m = mean(history), z = (share - m) / Math.max(sd(history), 0.02);
      score = 0.5 * absolute + 0.5 * clamp(70 + 15 * z, 0, 100);
      detail += `, your usual is ${Math.round(m * 100)}%`;
    }
    parts.push({ key: "restorative", label: "Deep + REM", weight: 0.2, score: Math.round(score), detail });
  }

  if (day.sleepStart) {
    const beds = prior14.filter(d => d.sleepStart).map(d => bedMinutes(d.sleepStart!));
    if (beds.length >= 4) {
      const usual = median(beds), bed = bedMinutes(day.sleepStart), dev = Math.abs(bed - usual);
      parts.push({ key: "timing", label: "Timing", weight: 0.15, score: Math.round(clamp(100 - Math.max(0, dev - 15) * 1.1, 0, 100)),
        detail: dev <= 15 ? `Asleep at ${clock(bed)}, right on your usual ${clock(usual)}` : `Asleep at ${clock(bed)}, ${Math.round(dev)} min ${bed > usual ? "later" : "earlier"} than your usual ${clock(usual)}` });
    }
  }

  if (day.metrics.awakeMin !== undefined) {
    const awake = day.metrics.awakeMin;
    parts.push({ key: "interruptions", label: "Interruptions", weight: 0.1, score: Math.round(clamp(100 - Math.max(0, awake - 10) * 1.5, 0, 100)),
      detail: `${Math.round(awake)} min awake during the night` });
  }

  const hrvHist = prior28.map(d => d.metrics.hrv).filter((v): v is number => !!v).map(Math.log);
  const rhrHist = prior28.map(d => d.metrics.restingHr).filter((v): v is number => !!v);
  const zs: number[] = [];
  const notes: string[] = [];
  if (day.metrics.hrv && hrvHist.length >= 7) {
    const z = clamp((Math.log(day.metrics.hrv) - mean(hrvHist)) / Math.max(sd(hrvHist), 0.05), -3, 3); zs.push(z);
    notes.push(`HRV ${day.metrics.hrv} ms vs ${Math.round(Math.exp(mean(hrvHist)))}`);
  }
  if (day.metrics.restingHr && rhrHist.length >= 7) {
    const z = clamp((day.metrics.restingHr - mean(rhrHist)) / Math.max(sd(rhrHist), 1), -3, 3); zs.push(-z);
    notes.push(`resting HR ${day.metrics.restingHr} vs ${Math.round(mean(rhrHist))} bpm`);
  }
  if (zs.length) parts.push({ key: "physiology", label: "Overnight recovery", weight: 0.1, score: Math.round(clamp(65 + 15 * mean(zs), 0, 100)), detail: notes.join(", ") });

  const total = parts.reduce((a, p) => a + p.weight, 0);
  const score = Math.round(parts.reduce((a, p) => a + p.weight * p.score, 0) / total);
  const night: SleepNight = { date, score, label: sleepLabel(score), components: parts.map(p => ({ ...p, weight: round(p.weight / total, 3) })), need, sleepMin };
  if (day.sleepStart) night.bedtime = bedMinutes(day.sleepStart);
  if (day.sleepEnd) night.wake = minutesOf(day.sleepEnd);
  if (eff !== undefined) night.efficiency = round(eff, 3);
  if (day.metrics.deepMin !== undefined || day.metrics.remMin !== undefined)
    night.stages = { deepMin: day.metrics.deepMin || 0, remMin: day.metrics.remMin || 0, coreMin: day.metrics.coreMin || 0, awakeMin: day.metrics.awakeMin || 0 };

  if (score < 85) {
    const worst = [...night.components].sort((a, b) => b.weight * (100 - b.score) - a.weight * (100 - a.score))[0];
    const timing = night.components.find(c => c.key === "timing");
    night.topFix = {
      duration: `Duration cost the most: another ${hm(Math.max(0, need.totalMin - sleepMin))} would have covered what you needed.`,
      efficiency: "Time lying awake in bed cost the most points.",
      restorative: "Less deep and REM sleep than usual cost the most points.",
      timing: timing ? `Bedtime cost the most. ${timing.detail}.` : "Bedtime cost the most points.",
      interruptions: `Waking up during the night cost the most (${Math.round(day.metrics.awakeMin || 0)} min awake).`,
      physiology: "Your heart didn't settle overnight (HRV low or resting heart rate up), which can mean stress, illness, alcohol or a late meal.",
    }[worst.key];
  }
  return night;
}

// ---- Pattern discovery ----
function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
export const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));

interface Row {
  date: string;
  sleepScore?: number; sleepMin?: number; deepMin?: number; hrv?: number; restingHr?: number; recovery?: number; steps?: number;
  prevSteps?: number; prevDaylight?: number; prevExercise?: number; prevKcal?: number; prevLoad?: number; prevWorkoutEnd?: number;
  bedtime?: number; bedShift?: number;
}
type RowKey = Exclude<keyof Row, "date">;
interface Variable { key: RowKey; label: string; kind: ValueKind; high: (v: string) => string; low: (v: string) => string; more: string; higherIsBetter?: boolean; short?: string }

const FACTORS: Record<string, Variable> = {
  prevDaylight: { key: "prevDaylight", label: "Daylight the day before", kind: "min", more: "More daylight", high: v => `after days with at least ${v} of daylight`, low: v => `after days under ${v}` },
  prevSteps: { key: "prevSteps", label: "Steps the day before", kind: "count", more: "Moving more", high: v => `after days of ${v}+ steps`, low: v => `after days under ${v}` },
  prevExercise: { key: "prevExercise", label: "Exercise the day before", kind: "min", more: "More exercise", high: v => `after at least ${v} of exercise`, low: v => `after days under ${v}` },
  prevKcal: { key: "prevKcal", label: "Active energy the day before", kind: "kcal", more: "More active days", high: v => `after days burning at least ${v}`, low: v => `after days under ${v}` },
  prevLoad: { key: "prevLoad", label: "Training load the day before", kind: "load", more: "Harder training", high: v => `after a training load of ${v} or more`, low: v => `after days under ${v}` },
  prevWorkoutEnd: { key: "prevWorkoutEnd", label: "When your last workout ended", kind: "clock", more: "Later workouts", high: v => `when your workout ends after ${v}`, low: v => `when it ends before ${v}` },
  bedtime: { key: "bedtime", label: "Bedtime", kind: "clock", more: "Later bedtimes", high: v => `on nights you fall asleep after ${v}`, low: v => `on nights you're asleep before ${v}` },
  bedShift: { key: "bedShift", label: "Bedtime off your usual", kind: "min", more: "Irregular bedtimes", high: v => `when bedtime is at least ${v} off your usual`, low: v => `when it's within ${v}` },
  sleepMin: { key: "sleepMin", label: "Sleep", kind: "hm", more: "Longer sleep", high: v => `after nights of at least ${v}`, low: v => `after nights under ${v}` },
};
const OUTCOMES: Record<string, Variable> = {
  sleepScore: { key: "sleepScore", label: "sleep score", short: "sleep score", kind: "score", higherIsBetter: true, more: "", high: v => v, low: v => v },
  deepMin: { key: "deepMin", label: "deep sleep", short: "deep sleep", kind: "min", higherIsBetter: true, more: "", high: v => v, low: v => v },
  hrv: { key: "hrv", label: "HRV next morning", short: "HRV", kind: "ms", higherIsBetter: true, more: "", high: v => v, low: v => v },
  recovery: { key: "recovery", label: "recovery", short: "recovery", kind: "score", higherIsBetter: true, more: "", high: v => v, low: v => v },
  sleepMinOut: { key: "sleepMin", label: "sleep", short: "sleep", kind: "hm", higherIsBetter: true, more: "", high: v => v, low: v => v },
  bedtimeOut: { key: "bedtime", label: "bedtime", short: "bedtime", kind: "clock", more: "", high: v => v, low: v => v },
  steps: { key: "steps", label: "steps that day", short: "activity", kind: "count", higherIsBetter: true, more: "", high: v => v, low: v => v },
};
const PAIRS: Array<[keyof typeof FACTORS, keyof typeof OUTCOMES]> = [
  ["prevDaylight", "sleepScore"], ["prevDaylight", "bedtimeOut"], ["prevSteps", "sleepScore"], ["prevExercise", "deepMin"], ["prevKcal", "sleepMinOut"],
  ["prevLoad", "hrv"], ["prevWorkoutEnd", "sleepScore"], ["bedtime", "recovery"], ["bedtime", "deepMin"], ["bedShift", "hrv"],
  ["sleepMin", "hrv"], ["sleepMin", "steps"],
];
const MIN_PAIRS = 14;

function discover(rows: Row[]): Pattern[] {
  const out: Pattern[] = [];
  for (const [fk, ok] of PAIRS) {
    const f = FACTORS[fk], o = OUTCOMES[ok];
    const pts = rows.filter(r => r[f.key] !== undefined && r[o.key] !== undefined).map(r => ({ x: r[f.key]!, y: r[o.key]!, date: r.date }));
    if (pts.length < MIN_PAIRS) continue;
    const xs = pts.map(p => p.x);
    if (sd(xs) === 0) continue;
    const rho = spearman(xs, pts.map(p => p.y));
    const n = pts.length;
    const t = Math.abs(rho) * Math.sqrt((n - 2) / Math.max(1e-6, 1 - rho * rho));
    if (Math.abs(rho) < 0.22 || t < 2.1) continue;
    const sorted = [...xs].sort((a, b) => a - b);
    const lo = quantile(sorted, 1 / 3), hi = quantile(sorted, 2 / 3);
    const low = pts.filter(p => p.x <= lo), high = pts.filter(p => p.x >= hi);
    if (low.length < 4 || high.length < 4 || hi === lo) continue;
    const hy = mean(high.map(p => p.y)), ly = mean(low.map(p => p.y));
    // Ignore links too small to matter even when they are consistent.
    const gap = Math.abs(hy - ly);
    const minGap = { score: 3, min: 5, hm: 10, ms: 2, count: 500, clock: 10, kcal: 30, bpm: 1, load: 5, pct: 2 }[o.kind];
    if (gap < minGap) continue;
    const up = hy > ly;
    const helps = o.higherIsBetter === undefined ? !up : up === o.higherIsBetter; // For bedtime, earlier is better.
    const fmtX = (v: number) => formatValue(f.kind, f.kind === "count" ? Math.round(v / 500) * 500 : f.kind === "clock" || f.kind === "min" ? Math.round(v / 5) * 5 : v);
    const fmtY = (v: number) => formatValue(o.kind, v);
    const dir = o.kind === "clock" ? (up ? "later" : "earlier") : o.kind === "min" || o.kind === "hm" ? (up ? "more" : "less") : up ? "higher" : "lower";
    const title = `${f.more} → ${dir} ${o.short}`;
    const body = `${cap(f.high(fmtX(hi)))}, your ${o.label} averages ${fmtY(hy)}, vs ${fmtY(ly)} ${f.low(fmtX(lo))}.`;
    out.push({ id: `${fk}-${ok}`, title, body, rho: round(rho, 2), n, strength: Math.abs(rho) >= 0.4 ? "strong" : "clear", helps,
      x: { label: f.label, kind: f.kind }, y: { label: cap(o.label), kind: o.kind }, points: pts });
  }
  return out.sort((a, b) => Math.abs(b.rho) * Math.sqrt(b.n) - Math.abs(a.rho) * Math.sqrt(a.n));
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- Main ----
export function computeDeepHealth(input: HealthDay[], profile: HealthProfile | undefined, date = localToday()): DeepHealth {
  const days = input.filter(d => d.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  const empty: DeepHealth = { date, nights: [], mornings: [], usual: {}, patterns: [], weekdays: [], records: [], insights: [] };
  if (!days.length) return empty;
  const byDate = new Map(days.map(d => [d.date, d]));
  const goalMin = profile?.sleepGoalMin || DEFAULT_SLEEP_GOAL_MIN;
  const loads = dailyLoads(days, profile, date);
  const since = addDays(date, -179);
  const recent = days.filter(d => d.date >= since);

  // Recovery per morning, for patterns and the best-bedtime window.
  const window = (d: string, key: string, t: (v: number) => number = v => v) => {
    const xs: number[] = [];
    for (let i = 1; i <= 28; i++) { const v = byDate.get(addDays(d, -i))?.metrics[key]; if (v !== undefined) xs.push(t(v)); }
    return xs;
  };
  const recovery = new Map<string, Recovery>();
  for (const d of recent) { const r = recoveryFor(d.date, d, window, goalMin); if (r) recovery.set(d.date, r); }

  const nights: SleepNight[] = [];
  const nightBy = new Map<string, SleepNight>();
  for (const d of recent) { const n = scoreNight(d.date, byDate, loads, goalMin); if (n) { nights.push(n); nightBy.set(d.date, n); } }

  // Usual (28 nights before the selected one, or the latest 28).
  const last28 = nights.filter(n => n.date < date && n.date >= addDays(date, -28));
  const avgOf = (xs: Array<number | undefined>) => { const v = xs.filter((x): x is number => x !== undefined); return v.length >= 5 ? mean(v) : undefined; };
  const usual: DeepHealth["usual"] = {
    sleepScore: avgOf(last28.map(n => n.score)), deepMin: avgOf(last28.map(n => n.stages?.deepMin)), remMin: avgOf(last28.map(n => n.stages?.remMin)),
    coreMin: avgOf(last28.map(n => n.stages?.coreMin)), awakeMin: avgOf(last28.map(n => n.stages?.awakeMin)),
    bedtime: avgOf(last28.map(n => n.bedtime)), wake: avgOf(last28.map(n => n.wake)),
  };

  // One row per morning: what happened the day before, what the night looked like, how the morning went.
  const rows: Row[] = recent.map(d => {
    const prev = byDate.get(addDays(d.date, -1));
    const night = nightBy.get(d.date);
    const ends = (prev?.workouts || []).map(w => minutesOf(w.start) + w.minutes);
    const beds = Array.from({ length: 14 }, (_, i) => byDate.get(addDays(d.date, -i - 1))?.sleepStart).filter((s): s is string => !!s).map(bedMinutes);
    const bedtime = d.sleepStart ? bedMinutes(d.sleepStart) : undefined;
    return {
      date: d.date, sleepScore: night?.score, sleepMin: d.metrics.sleepMin, deepMin: d.metrics.deepMin, hrv: d.metrics.hrv, restingHr: d.metrics.restingHr,
      recovery: recovery.get(d.date)?.score, steps: d.metrics.steps,
      prevSteps: prev?.metrics.steps, prevDaylight: prev?.metrics.daylightMin, prevExercise: prev?.metrics.exerciseMin, prevKcal: prev?.metrics.activeKcal,
      prevLoad: prev ? loads.get(prev.date) : undefined, prevWorkoutEnd: ends.length ? Math.max(...ends) : undefined,
      bedtime, bedShift: bedtime !== undefined && beds.length >= 4 ? Math.abs(bedtime - median(beds)) : undefined,
    };
  });
  const patterns = discover(rows);

  // Weekday rhythm. A night is named by the evening it started: the night ending Monday is "Sunday night".
  const weekdays: WeekdayStat[] = WEEKDAYS.map((name, i) => {
    const mornings = rows.filter(r => weekdayOf(r.date) === i);
    const nightsHere = rows.filter(r => weekdayOf(r.date) === (i + 1) % 7);
    const avg = (xs: Array<number | undefined>) => { const v = xs.filter((x): x is number => x !== undefined); return v.length >= 2 ? Math.round(mean(v)) : undefined; };
    return { weekday: i, night: `${name} night`, day: name, n: nightsHere.filter(r => r.sleepScore !== undefined).length,
      sleepScore: avg(nightsHere.map(r => r.sleepScore)), sleepMin: avg(nightsHere.map(r => r.sleepMin)), recovery: avg(mornings.map(r => r.recovery)), steps: avg(mornings.map(r => r.steps)) };
  });

  // Social jetlag: weekend sleep midpoint vs weekday, last 6 weeks.
  let jetlag: DeepHealth["jetlag"];
  const timed = nights.filter(n => n.date >= addDays(date, -42) && n.bedtime !== undefined && n.wake !== undefined);
  const mid = (n: SleepNight) => { const wake = n.wake! + 1440; return wake > n.bedtime! ? (n.bedtime! + wake) / 2 : undefined; };
  const free = timed.filter(n => [0, 6].includes(weekdayOf(n.date))).map(mid).filter((v): v is number => v !== undefined);
  const work = timed.filter(n => ![0, 6].includes(weekdayOf(n.date))).map(mid).filter((v): v is number => v !== undefined);
  if (free.length >= 3 && work.length >= 6) {
    const f = mean(free), w = mean(work);
    jetlag = { minutes: Math.round(f - w), workMid: w, freeMid: f, nights: free.length + work.length };
  }

  // The 30-minute bedtime window with your best mornings.
  let bestBedtime: DeepHealth["bestBedtime"];
  const bedRec = rows.filter(r => r.bedtime !== undefined && r.recovery !== undefined);
  if (bedRec.length >= 14) {
    const bins = new Map<number, number[]>();
    for (const r of bedRec) { const b = Math.floor(r.bedtime! / 30) * 30; (bins.get(b) || bins.set(b, []).get(b)!).push(r.recovery!); }
    const usable = [...bins].filter(([, v]) => v.length >= 3);
    if (usable.length >= 3) {
      const [from, v] = usable.sort((a, b) => mean(b[1]) - mean(a[1]))[0];
      const overall = mean(bedRec.map(r => r.recovery!));
      if (mean(v) - overall >= 3) bestBedtime = { from, to: from + 30, recovery: Math.round(mean(v)), overall: Math.round(overall), nights: v.length };
    }
  }

  // Bedtime drift: last 14 nights vs the 28 before.
  let drift: DeepHealth["drift"];
  const bedsIn = (a: number, b: number) => nights.filter(n => n.bedtime !== undefined && n.date > addDays(date, -b) && n.date <= addDays(date, -a)).map(n => n.bedtime!);
  const r14 = bedsIn(0, 14), b28 = bedsIn(14, 42);
  if (r14.length >= 7 && b28.length >= 10) { const r = median(r14), b = median(b28); drift = { minutes: Math.round(r - b), recent: r, before: b }; }

  // Sleep debt as of this morning and how long a 30-minute-longer night takes to clear it.
  let debtTotal = 0;
  for (let i = 0; i < 14; i++) { const s = byDate.get(addDays(date, -i))?.metrics.sleepMin; if (s !== undefined) debtTotal += 0.85 ** i * (goalMin - s); }
  const debt = debtTotal >= 30 ? { min: Math.round(debtTotal), nightsToClear: Math.ceil(debtTotal / 30) } : undefined;

  const records = personalRecords(days, nights, goalMin);
  const night = nightBy.get(date);
  const insights = rank({ date, nights, night, usual, patterns, weekdays, jetlag, bestBedtime, drift, debt, records, days: recent, recovery });
  const mornings = recent.map(d => ({ date: d.date, sleepScore: nightBy.get(d.date)?.score, recovery: recovery.get(d.date)?.score }));
  return { date, nights, night, mornings, usual, patterns, weekdays, jetlag, bestBedtime, drift, debt, records, insights };
}

function personalRecords(days: HealthDay[], nights: SleepNight[], goalMin: number): HealthRecord[] {
  const out: HealthRecord[] = [];
  const best = (key: string, label: string, fmt: (v: number) => string, low = false) => {
    let pick: HealthDay | undefined;
    for (const d of days) { const v = d.metrics[key]; if (v === undefined) continue; if (!pick || (low ? v < pick.metrics[key] : v > pick.metrics[key])) pick = d; }
    if (pick) out.push({ key, label, value: fmt(pick.metrics[key]), date: pick.date });
  };
  const topNight = nights.reduce<SleepNight | undefined>((m, n) => !m || n.score > m.score ? n : m, undefined);
  if (topNight) out.push({ key: "sleepScore", label: "Best sleep score", value: `${topNight.score}`, date: topNight.date });
  best("hrv", "Highest HRV", v => `${Math.round(v)} ms`);
  best("restingHr", "Lowest resting HR", v => `${Math.round(v)} bpm`, true);
  best("steps", "Most steps", v => Math.round(v).toLocaleString());
  best("vo2max", "Best cardio fitness", v => v.toFixed(1));
  // Longest run of nights at or above the goal.
  let run = 0, bestRun = 0, end = "";
  let prev = "";
  for (const d of days) {
    const ok = (d.metrics.sleepMin || 0) >= goalMin;
    run = ok ? (prev && addDays(prev, 1) === d.date ? run + 1 : 1) : 0;
    if (ok) prev = d.date; else prev = "";
    if (run > bestRun) { bestRun = run; end = d.date; }
  }
  if (bestRun >= 2) out.push({ key: "sleepStreak", label: "Longest run at your sleep goal", value: `${bestRun} nights`, date: end });
  return out;
}

function rank(ctx: {
  date: string; nights: SleepNight[]; night?: SleepNight; usual: DeepHealth["usual"]; patterns: Pattern[]; weekdays: WeekdayStat[];
  jetlag?: DeepHealth["jetlag"]; bestBedtime?: DeepHealth["bestBedtime"]; drift?: DeepHealth["drift"]; debt?: DeepHealth["debt"];
  records: HealthRecord[]; days: HealthDay[]; recovery: Map<string, Recovery>;
}): Insight[] {
  const out: Insight[] = [];
  for (const p of ctx.patterns.slice(0, 6)) out.push({ id: `p-${p.id}`, kind: "pattern", title: p.title, body: `${p.body} Seen across ${p.n} days.`, tone: p.helps ? "good" : "bad",
    weight: clamp(Math.abs(p.rho) * 1.4, 0.3, 0.95), patternId: p.id });

  if (ctx.bestBedtime) {
    const b = ctx.bestBedtime;
    out.push({ id: "best-bedtime", kind: "timing", title: `Your best mornings follow a ${clock(b.from)} bedtime`, tone: "good", weight: 0.8,
      body: `Falling asleep between ${clock(b.from)} and ${clock(b.to)} is followed by recovery of ${b.recovery} on average, vs ${b.overall} overall (${b.nights} nights).` });
  }
  if (ctx.jetlag && Math.abs(ctx.jetlag.minutes) >= 45) {
    const j = ctx.jetlag;
    out.push({ id: "jetlag", kind: "rhythm", title: `${dur(Math.abs(j.minutes))} of social jetlag`, tone: Math.abs(j.minutes) >= 75 ? "bad" : "neutral", weight: clamp(Math.abs(j.minutes) / 120, 0.4, 0.85),
      body: `On weekends the middle of your sleep moves to ${clock(j.freeMid)}, vs ${clock(j.workMid)} on weekdays. Your body clock feels that like flying ${Math.max(1, Math.round(Math.abs(j.minutes) / 60))} time zone${Math.max(1, Math.round(Math.abs(j.minutes) / 60)) === 1 ? "" : "s"} every weekend and back, which tends to make Sunday and Monday nights harder.` });
  }
  const scored = ctx.weekdays.filter(w => w.sleepScore !== undefined && w.n >= 3);
  if (scored.length >= 5) {
    const avg = mean(scored.map(w => w.sleepScore!));
    const worst = scored.reduce((m, w) => w.sleepScore! < m.sleepScore! ? w : m);
    const bestW = scored.reduce((m, w) => w.sleepScore! > m.sleepScore! ? w : m);
    if (avg - worst.sleepScore! >= 6) out.push({ id: "weekday-worst", kind: "rhythm", title: `${worst.night} is your weakest`, tone: "bad", weight: clamp((avg - worst.sleepScore!) / 20, 0.4, 0.8),
      body: `${worst.night} sleep scores ${worst.sleepScore} on average, vs ${Math.round(avg)} across the week and ${bestW.sleepScore} on ${bestW.night}${worst.sleepMin ? ` (${hm(worst.sleepMin)} of sleep)` : ""}.` });
  }
  if (ctx.drift && Math.abs(ctx.drift.minutes) >= 25) {
    const d = ctx.drift;
    out.push({ id: "drift", kind: "trend", title: `Bedtime has drifted ${Math.abs(d.minutes)} min ${d.minutes > 0 ? "later" : "earlier"}`, tone: d.minutes > 0 ? "bad" : "good", weight: clamp(Math.abs(d.minutes) / 70, 0.4, 0.8),
      body: `Over the last two weeks you've usually fallen asleep around ${clock(d.recent)}, vs ${clock(d.before)} in the month before.` });
  }
  // Sleep score trend: last 14 nights vs the 28 before.
  const s14 = ctx.nights.filter(n => n.date > addDays(ctx.date, -14)).map(n => n.score);
  const s28 = ctx.nights.filter(n => n.date <= addDays(ctx.date, -14) && n.date > addDays(ctx.date, -42)).map(n => n.score);
  if (s14.length >= 7 && s28.length >= 10) {
    const diff = Math.round(mean(s14) - mean(s28));
    if (Math.abs(diff) >= 4) out.push({ id: "sleep-trend", kind: "trend", title: `Sleep score ${diff > 0 ? "up" : "down"} ${Math.abs(diff)} points`, tone: diff > 0 ? "good" : "bad", weight: clamp(Math.abs(diff) / 15, 0.35, 0.8),
      body: `Your last two weeks average ${Math.round(mean(s14))}, vs ${Math.round(mean(s28))} in the month before.` });
  }
  if (ctx.debt && ctx.debt.min >= 90) out.push({ id: "debt", kind: "debt", title: `${dur(ctx.debt.min)} of sleep debt`, tone: "bad", weight: clamp(ctx.debt.min / 400, 0.4, 0.85),
    body: `About ${ctx.debt.nightsToClear} night${ctx.debt.nightsToClear === 1 ? "" : "s"} of 30 extra minutes would clear it. Recent nights count most, so tonight matters more than last week.` });

  // How tags change the sleep score that night.
  const tagged = new Map<string, Set<string>>();
  for (const d of ctx.days) for (const t of d.tags || []) (tagged.get(t) || tagged.set(t, new Set()).get(t)!).add(d.date);
  for (const [tag, dates] of tagged) {
    const after: number[] = [], other: number[] = [];
    for (const n of ctx.nights) (dates.has(addDays(n.date, -1)) ? after : other).push(n.score);
    if (after.length < 3 || other.length < 7) continue;
    const diff = Math.round(mean(after) - mean(other));
    if (Math.abs(diff) < 5) continue;
    out.push({ id: `tag-${tag}`, kind: "tag", title: `"${tag}" ${diff < 0 ? "costs" : "adds"} ${Math.abs(diff)} sleep points`, tone: diff < 0 ? "bad" : "good", weight: clamp(Math.abs(diff) / 20, 0.4, 0.9),
      body: `Nights after "${tag}" days score ${Math.round(mean(after))}, vs ${Math.round(mean(other))} otherwise (${after.length} times).` });
  }

  // A fresh personal best in the last week.
  for (const r of ctx.records) if (r.date > addDays(ctx.date, -7) && r.date <= ctx.date) out.push({ id: `rec-${r.key}`, kind: "record", title: `New record: ${r.label}`, tone: "good", weight: 0.6, body: `${r.value} on ${new Date(`${r.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}.` });

  return out.sort((a, b) => b.weight - a.weight);
}

/** A compact version for the assistant. */
export function deepHealthForAssistant(days: HealthDay[], profile: HealthProfile | undefined, date = localToday()) {
  const d = computeDeepHealth(days, profile, date);
  if (!d.nights.length) return undefined;
  const n = d.night;
  return {
    sleepScore: n ? { date: n.date, score: n.score, label: n.label, need: `${hm(n.need.totalMin)} (goal ${hm(n.need.goalMin)} + debt ${n.need.debtMin} min + training ${n.need.trainingMin} min)`,
      parts: n.components.map(c => `${c.label} ${c.score}/100: ${c.detail}`), biggestCost: n.topFix } : "No scored sleep for that night.",
    usualSleepScore: d.usual.sleepScore !== undefined ? Math.round(d.usual.sleepScore) : undefined,
    insights: d.insights.slice(0, 8).map(i => `${i.title}. ${i.body}`),
    weekdays: d.weekdays.filter(w => w.sleepScore !== undefined).map(w => `${w.night}: sleep score ${w.sleepScore}${w.sleepMin ? `, ${hm(w.sleepMin)}` : ""}`),
    bestBedtime: d.bestBedtime ? `${clock(d.bestBedtime.from)}–${clock(d.bestBedtime.to)} (recovery ${d.bestBedtime.recovery} vs ${d.bestBedtime.overall})` : undefined,
    socialJetlagMin: d.jetlag?.minutes,
    records: d.records.map(r => `${r.label}: ${r.value} (${r.date})`),
  };
}

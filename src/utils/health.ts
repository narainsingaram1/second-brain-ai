import type { HealthDay, HealthProfile, HealthWorkout } from "../types";

/**
 * Apple Health data as day records. Pure and shared by the app, the assistant's tools and the server that
 * receives automatic syncs from the phone, so every path reads and merges data the same way.
 */

export type HealthAgg = "sum" | "avg" | "last" | "max" | "min";
export interface HealthMetricDef {
  key: string;
  label: string;
  unit: string;
  /** How samples within one day combine. */
  agg: HealthAgg;
  /** Plausible range; values outside it are dropped as bad samples. */
  min: number;
  max: number;
  decimals: number;
  /** Metric names used by the Health Auto Export app. */
  hae: string[];
  description: string;
}

export const HEALTH_METRICS: HealthMetricDef[] = [
  { key: "steps", label: "Steps", unit: "steps", agg: "sum", min: 0, max: 150000, decimals: 0, hae: ["step_count"], description: "Steps walked." },
  { key: "activeKcal", label: "Active energy", unit: "kcal", agg: "sum", min: 0, max: 10000, decimals: 0, hae: ["active_energy"], description: "Active calories burned." },
  { key: "basalKcal", label: "Resting energy", unit: "kcal", agg: "sum", min: 0, max: 6000, decimals: 0, hae: ["basal_energy_burned"], description: "Resting calories burned." },
  { key: "exerciseMin", label: "Exercise", unit: "min", agg: "sum", min: 0, max: 1440, decimals: 0, hae: ["apple_exercise_time"], description: "Apple Watch exercise minutes." },
  { key: "standHours", label: "Stand hours", unit: "h", agg: "sum", min: 0, max: 24, decimals: 0, hae: ["apple_stand_hour"], description: "Hours with at least a minute of standing." },
  { key: "distanceKm", label: "Walking + running", unit: "km", agg: "sum", min: 0, max: 300, decimals: 1, hae: ["walking_running_distance"], description: "Walking and running distance in km." },
  { key: "flights", label: "Flights climbed", unit: "floors", agg: "sum", min: 0, max: 500, decimals: 0, hae: ["flights_climbed"], description: "Flights of stairs climbed." },
  { key: "daylightMin", label: "Time in daylight", unit: "min", agg: "sum", min: 0, max: 1440, decimals: 0, hae: ["time_in_daylight"], description: "Minutes spent in daylight." },
  { key: "restingHr", label: "Resting heart rate", unit: "bpm", agg: "avg", min: 25, max: 150, decimals: 0, hae: ["resting_heart_rate"], description: "Resting heart rate in beats per minute." },
  { key: "hrv", label: "HRV", unit: "ms", agg: "avg", min: 3, max: 300, decimals: 0, hae: ["heart_rate_variability"], description: "Heart rate variability (SDNN) in milliseconds." },
  { key: "walkingHr", label: "Walking heart rate", unit: "bpm", agg: "avg", min: 40, max: 200, decimals: 0, hae: ["walking_heart_rate_average"], description: "Average heart rate while walking." },
  { key: "maxHr", label: "Highest heart rate", unit: "bpm", agg: "max", min: 60, max: 230, decimals: 0, hae: [], description: "Highest heart rate recorded that day." },
  { key: "respRate", label: "Respiratory rate", unit: "br/min", agg: "avg", min: 5, max: 40, decimals: 1, hae: ["respiratory_rate"], description: "Breaths per minute, measured during sleep." },
  { key: "spo2", label: "Blood oxygen", unit: "%", agg: "avg", min: 70, max: 100, decimals: 0, hae: ["blood_oxygen_saturation"], description: "Blood oxygen saturation in percent." },
  { key: "wristTempC", label: "Sleeping wrist temperature", unit: "°C", agg: "avg", min: 25, max: 42, decimals: 2, hae: ["apple_sleeping_wrist_temperature"], description: "Wrist temperature during sleep in °C." },
  { key: "vo2max", label: "Cardio fitness (VO₂ max)", unit: "ml/kg/min", agg: "last", min: 10, max: 95, decimals: 1, hae: ["vo2_max"], description: "Estimated VO2 max." },
  { key: "weightKg", label: "Weight", unit: "kg", agg: "last", min: 20, max: 400, decimals: 1, hae: ["weight_body_mass"], description: "Body weight in kg." },
  { key: "bodyFatPct", label: "Body fat", unit: "%", agg: "last", min: 2, max: 70, decimals: 1, hae: ["body_fat_percentage"], description: "Body fat percentage." },
  { key: "sleepMin", label: "Sleep", unit: "min", agg: "sum", min: 0, max: 1200, decimals: 0, hae: [], description: "Minutes asleep in the night that ended this morning." },
  { key: "inBedMin", label: "Time in bed", unit: "min", agg: "sum", min: 0, max: 1440, decimals: 0, hae: [], description: "Minutes in bed." },
  { key: "deepMin", label: "Deep sleep", unit: "min", agg: "sum", min: 0, max: 600, decimals: 0, hae: [], description: "Minutes of deep sleep." },
  { key: "remMin", label: "REM sleep", unit: "min", agg: "sum", min: 0, max: 600, decimals: 0, hae: [], description: "Minutes of REM sleep." },
  { key: "coreMin", label: "Core sleep", unit: "min", agg: "sum", min: 0, max: 1000, decimals: 0, hae: [], description: "Minutes of core (light) sleep." },
  { key: "awakeMin", label: "Awake in bed", unit: "min", agg: "sum", min: 0, max: 600, decimals: 0, hae: [], description: "Minutes awake during the night." },
];
export const HEALTH_METRIC_KEYS = HEALTH_METRICS.map(m => m.key);
const METRIC_BY_KEY = new Map(HEALTH_METRICS.map(m => [m.key, m]));
export const healthMetric = (key: string) => METRIC_BY_KEY.get(key);

export const DEFAULT_SLEEP_GOAL_MIN = 480;
export const DEFAULT_STEP_GOAL = 8000;
export const healthDayId = (date: string) => `health-${date}`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
export const isHealthDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const time = Date.parse(`${value}T12:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value; // Rejects 2026-02-30.
};

/** A value rounded to the metric's precision, or undefined when it is not a plausible reading. */
export function cleanMetric(key: string, value: unknown): number | undefined {
  const def = METRIC_BY_KEY.get(key);
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  if (!def || typeof n !== "number" || !Number.isFinite(n) || n < def.min || n > def.max) return undefined;
  const f = 10 ** def.decimals;
  return Math.round(n * f) / f;
}

export function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
    if (tag && !seen.has(tag)) { seen.add(tag); tags.push(tag); }
    if (tags.length >= 20) break;
  }
  return tags;
}

function cleanWorkout(value: unknown): HealthWorkout | undefined {
  if (!value || typeof value !== "object") return undefined;
  const w = value as Record<string, unknown>;
  const minutes = typeof w.minutes === "number" && Number.isFinite(w.minutes) ? Math.round(w.minutes) : NaN;
  if (typeof w.start !== "string" || !LOCAL_TIME.test(w.start) || !(minutes > 0 && minutes <= 1440)) return undefined;
  const num = (v: unknown, lo: number, hi: number, d = 0) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 10 ** d) / 10 ** d : undefined;
  const workout: HealthWorkout = {
    id: typeof w.id === "string" && w.id ? w.id.slice(0, 120) : `${w.start}|${String(w.type || "")}`,
    type: typeof w.type === "string" && w.type.trim() ? w.type.trim().slice(0, 60) : "Workout",
    start: w.start, minutes,
  };
  const energy = num(w.energyKcal, 0, 10000), distance = num(w.distanceKm, 0, 500, 2), avg = num(w.avgHr, 30, 230), max = num(w.maxHr, 30, 240);
  if (energy !== undefined) workout.energyKcal = energy;
  if (distance !== undefined) workout.distanceKm = distance;
  if (avg !== undefined) workout.avgHr = avg;
  if (max !== undefined) workout.maxHr = max;
  return workout;
}

/** A stored or received day in canonical shape, or undefined if it is not a usable day. */
export function normalizeHealthDay(value: unknown): HealthDay | undefined {
  if (!value || typeof value !== "object") return undefined;
  const d = value as Record<string, unknown>;
  if (!isHealthDate(d.date)) return undefined;
  const metrics: Record<string, number> = {};
  const raw = d.metrics && typeof d.metrics === "object" ? d.metrics as Record<string, unknown> : {};
  for (const key of HEALTH_METRIC_KEYS) { const v = cleanMetric(key, raw[key]); if (v !== undefined) metrics[key] = v; }
  const day: HealthDay = { id: healthDayId(d.date), date: d.date, metrics, updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : new Date().toISOString() };
  if (typeof d.sleepStart === "string" && LOCAL_TIME.test(d.sleepStart)) day.sleepStart = d.sleepStart;
  if (typeof d.sleepEnd === "string" && LOCAL_TIME.test(d.sleepEnd)) day.sleepEnd = d.sleepEnd;
  const workouts = Array.isArray(d.workouts) ? d.workouts.map(cleanWorkout).filter((w): w is HealthWorkout => !!w).slice(0, 30) : [];
  if (workouts.length) day.workouts = workouts;
  const tags = cleanTags(d.tags);
  if (tags.length) day.tags = tags;
  if (typeof d.note === "string" && d.note.trim()) day.note = d.note.trim().slice(0, 2000);
  if (typeof d.source === "string" && d.source.trim()) day.source = d.source.trim().slice(0, 80);
  return day;
}

export function normalizeHealthDays(value: unknown): HealthDay[] {
  if (!Array.isArray(value)) return [];
  const byDate = new Map<string, HealthDay>();
  for (const item of value) { const day = normalizeHealthDay(item); if (day && !byDate.has(day.date)) byDate.set(day.date, day); }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** What one import or sync says about a day. Only the parts it mentions replace what is stored. */
export interface HealthDayPatch {
  date: string;
  metrics: Record<string, number>;
  sleepStart?: string;
  sleepEnd?: string;
  workouts?: HealthWorkout[];
}

/**
 * Applies a patch to a stored day. Metrics in the patch replace the stored ones (each sync re-sends whole
 * days, so replacing keeps repeated syncs idempotent); workouts merge by ID; tags and notes are the user's
 * and are never touched by a sync.
 */
export function mergeHealthDay(existing: HealthDay | undefined, patch: HealthDayPatch, source: string, now = new Date().toISOString()): HealthDay {
  const base: HealthDay = existing ? { ...existing, metrics: { ...existing.metrics } } : { id: healthDayId(patch.date), date: patch.date, metrics: {}, updatedAt: now };
  for (const [key, value] of Object.entries(patch.metrics)) { const v = cleanMetric(key, value); if (v !== undefined) base.metrics[key] = v; }
  if (patch.sleepStart) base.sleepStart = patch.sleepStart;
  if (patch.sleepEnd) base.sleepEnd = patch.sleepEnd;
  if (patch.workouts?.length) {
    const list = [...(base.workouts || [])];
    for (const w of patch.workouts) {
      const i = list.findIndex(x => x.id === w.id || (x.start === w.start && x.type === w.type));
      if (i >= 0) list[i] = w; else list.push(w);
    }
    base.workouts = list.sort((a, b) => a.start.localeCompare(b.start)).slice(-30);
  }
  base.source = source.slice(0, 80);
  base.updatedAt = now;
  return normalizeHealthDay(base)!;
}

/** True when merging the patch would change nothing that matters (so a sync can skip the write). */
export function sameHealthData(a: HealthDay | undefined, b: HealthDay): boolean {
  if (!a) return false;
  const strip = (d: HealthDay) => JSON.stringify({ ...d, updatedAt: undefined, source: undefined });
  return strip(a) === strip(b);
}

// ---- Reading payloads from the phone ----

/** "2026-11-08 07:15:00 -0500", "2026-11-08T07:15:00-05:00" → { date, time } in the phone's local time. */
export function localParts(value: unknown): { date: string; time: string } | undefined {
  if (typeof value !== "string") return undefined;
  const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m || !isHealthDate(m[1])) return undefined;
  return { date: m[1], time: m[2] ? `${m[2]}:${m[3]}` : "00:00" };
}
const localStamp = (value: unknown) => { const p = localParts(value); return p ? `${p.date} ${p.time}` : undefined; };
const addDays = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
/** A night counts toward the day you wake up: anything ending after 6 PM belongs to the next morning. */
export function wakeDate(stamp: string): string {
  const [date, time] = stamp.split(" ");
  return Number(time.slice(0, 2)) >= 18 ? addDays(date, 1) : date;
}
const minutesBetween = (a: string, b: string) => (Date.parse(`${b.replace(" ", "T")}:00Z`) - Date.parse(`${a.replace(" ", "T")}:00Z`)) / 60000;

const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  if (v && typeof v === "object" && "qty" in v) return num((v as { qty: unknown }).qty);
  return undefined;
};

/** Converts a reading to the unit HEALTH_METRICS uses. */
export function toUnit(key: string, value: number, units: string): number {
  const u = units.toLowerCase().replace(/\s/g, "");
  if (key.endsWith("Kcal") && (u === "kj" || u === "kilojoules")) return value / 4.184;
  if (key === "distanceKm") return u === "mi" || u === "miles" ? value * 1.609344 : u === "m" ? value / 1000 : u === "ft" ? value * 0.0003048 : u === "yd" ? value * 0.0009144 : value;
  if (key === "weightKg") return u === "lb" || u === "lbs" ? value * 0.45359237 : u === "g" ? value / 1000 : u === "st" ? value * 6.35029 : value;
  if (key === "wristTempC") return u === "degf" || u === "°f" || u === "f" ? (value - 32) * 5 / 9 : value;
  if (key === "spo2" || key === "bodyFatPct") return value <= 1 ? value * 100 : value;
  if (key === "exerciseMin" || key === "daylightMin") return u === "hr" || u === "h" ? value * 60 : u === "s" || u === "sec" ? value / 60 : value;
  return value;
}

type Acc = { sum: number; n: number; last?: { at: string; v: number }; max: number; min: number };
const fold = (acc: Acc | undefined, v: number, at: string): Acc => {
  const a = acc || { sum: 0, n: 0, max: -Infinity, min: Infinity };
  a.sum += v; a.n++; a.max = Math.max(a.max, v); a.min = Math.min(a.min, v);
  if (!a.last || at >= a.last.at) a.last = { at, v };
  return a;
};
const reduce = (agg: HealthAgg, a: Acc) => agg === "sum" ? a.sum : agg === "avg" ? a.sum / a.n : agg === "max" ? a.max : agg === "min" ? a.min : a.last!.v;

class DayBuilder {
  days = new Map<string, HealthDayPatch>();
  private acc = new Map<string, Map<string, Acc>>();
  private sleep = new Map<string, { start?: string; end?: string; stages: Record<string, number>; aggregated: boolean }>();
  day(date: string) {
    let d = this.days.get(date);
    if (!d) { d = { date, metrics: {} }; this.days.set(date, d); }
    return d;
  }
  add(date: string, key: string, value: number, at = date) {
    this.day(date);
    let m = this.acc.get(date);
    if (!m) { m = new Map(); this.acc.set(date, m); }
    m.set(key, fold(m.get(key), value, at));
  }
  night(date: string) {
    let n = this.sleep.get(date);
    if (!n) { n = { stages: {}, aggregated: false }; this.sleep.set(date, n); }
    this.day(date);
    return n;
  }
  widen(n: { start?: string; end?: string }, start?: string, end?: string) {
    if (start && (!n.start || start < n.start)) n.start = start;
    if (end && (!n.end || end > n.end)) n.end = end;
  }
  workout(date: string, w: HealthWorkout) {
    const d = this.day(date);
    (d.workouts ||= []).push(w);
  }
  build(): HealthDayPatch[] {
    for (const [date, metrics] of this.acc) {
      const d = this.day(date);
      for (const [key, a] of metrics) {
        const v = cleanMetric(key, reduce(METRIC_BY_KEY.get(key)!.agg, a));
        if (v !== undefined) d.metrics[key] = v;
      }
    }
    for (const [date, n] of this.sleep) {
      const d = this.day(date);
      for (const [key, minutes] of Object.entries(n.stages)) { const v = cleanMetric(key, minutes); if (v !== undefined) d.metrics[key] = v; }
      if (d.metrics.sleepMin === undefined) {
        const staged = (n.stages.deepMin || 0) + (n.stages.remMin || 0) + (n.stages.coreMin || 0);
        if (staged) d.metrics.sleepMin = Math.round(staged);
      }
      if (n.start) d.sleepStart = n.start;
      if (n.end) d.sleepEnd = n.end;
    }
    return [...this.days.values()].filter(d => Object.keys(d.metrics).length || d.workouts?.length || d.sleepEnd).sort((a, b) => a.date.localeCompare(b.date));
  }
}

const SLEEP_STAGE: Record<string, string> = { asleep: "sleepMin", totalsleep: "sleepMin", inbed: "inBedMin", deep: "deepMin", rem: "remMin", core: "coreMin", awake: "awakeMin" };
const HAE_KEY = new Map(HEALTH_METRICS.flatMap(m => m.hae.map(name => [name, m.key] as const)));

function readSleep(b: DayBuilder, entries: unknown[], units: string) {
  const perHour = /^(hr|h|hours?)$/i.test(units || "hr") ? 60 : /^min/i.test(units) ? 1 : /^s/i.test(units) ? 1 / 60 : 60;
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    // Aggregated by night: { date, asleep|totalSleep, inBed, core, deep, rem, awake, sleepStart, sleepEnd }.
    if (e.sleepEnd !== undefined || e.totalSleep !== undefined || e.asleep !== undefined || e.deep !== undefined) {
      const end = localStamp(e.sleepEnd) || localStamp(e.inBedEnd);
      const date = end ? wakeDate(end) : localParts(e.date)?.date;
      if (!date) continue;
      const n = b.night(date);
      n.aggregated = true;
      for (const [field, key] of Object.entries(SLEEP_STAGE)) {
        const match = Object.keys(e).find(k => k.toLowerCase() === field);
        const v = match ? num(e[match]) : undefined;
        if (v !== undefined && v > 0) n.stages[key] = Math.round(v * perHour);
      }
      b.widen(n, localStamp(e.sleepStart) || localStamp(e.inBedStart), end);
      continue;
    }
    // One sample per stage: { startDate, endDate, value: "Core" | "Deep" | "REM" | "Awake" | "In Bed" | "Asleep", qty }.
    const start = localStamp(e.startDate ?? e.start), end = localStamp(e.endDate ?? e.end);
    if (!start || !end) continue;
    const minutes = minutesBetween(start, end);
    if (!(minutes > 0 && minutes < 1440)) continue;
    const stage = String(e.value ?? e.stage ?? "").toLowerCase().replace(/\s/g, "");
    const key = stage.includes("inbed") ? "inBedMin" : stage.includes("awake") ? "awakeMin" : stage.includes("deep") ? "deepMin" : stage.includes("rem") ? "remMin" : stage.includes("core") ? "coreMin" : stage.includes("asleep") || stage.includes("unspecified") ? "sleepMin" : "";
    if (!key) continue;
    const n = b.night(wakeDate(end));
    if (n.aggregated) continue;
    n.stages[key] = (n.stages[key] || 0) + minutes;
    if (key !== "inBedMin" && key !== "awakeMin") {
      if (key !== "sleepMin") n.stages.sleepMin = (n.stages.sleepMin || 0) + minutes;
      b.widen(n, start, end);
    } else if (key === "inBedMin") b.widen(n, start, end);
  }
}

function readWorkout(b: DayBuilder, raw: unknown) {
  if (!raw || typeof raw !== "object") return;
  const w = raw as Record<string, unknown>;
  const start = localStamp(w.start ?? w.startDate);
  if (!start) return;
  const end = localStamp(w.end ?? w.endDate);
  // Health Auto Export reports duration in seconds; a Shortcut can send minutes directly.
  const seconds = num(w.duration);
  const minutes = num(w.minutes) ?? (seconds !== undefined ? seconds / 60 : end ? minutesBetween(start, end) : 0);
  const unitOf = (v: unknown) => v && typeof v === "object" && typeof (v as { units?: unknown }).units === "string" ? (v as { units: string }).units : "";
  const energyRaw = w.activeEnergyBurned ?? w.activeEnergy ?? w.energyKcal;
  const distanceRaw = w.distance ?? w.distanceKm;
  const hr = w.heartRate && typeof w.heartRate === "object" ? w.heartRate as Record<string, unknown> : {};
  const energy = num(energyRaw), distance = num(distanceRaw);
  const workout = cleanWorkout({
    id: typeof w.id === "string" ? w.id : undefined,
    type: typeof w.name === "string" ? w.name : typeof w.type === "string" ? w.type : "Workout",
    start, minutes,
    energyKcal: energy !== undefined ? toUnit("activeKcal", energy, unitOf(energyRaw) || "kcal") : undefined,
    distanceKm: distance !== undefined ? toUnit("distanceKm", distance, unitOf(distanceRaw) || "km") : undefined,
    avgHr: num(w.avgHeartRate) ?? num(hr.avg) ?? num(w.avgHr),
    maxHr: num(w.maxHeartRate) ?? num(hr.max) ?? num(w.maxHr),
  });
  if (workout) b.workout(start.slice(0, 10), workout);
}

/**
 * Reads what the phone sends: Health Auto Export's JSON (`{ data: { metrics, workouts } }`), or the simple
 * shape an iOS Shortcut can build (`{ days: [{ date, steps, restingHr, sleepMin, … }] }`, or one such day).
 * Throws when nothing in it is recognisable, so a misconfigured export fails loudly.
 */
export function parseHealthPayload(payload: unknown): HealthDayPatch[] {
  if (!payload || typeof payload !== "object") throw new Error("Expected a JSON object.");
  const body = payload as Record<string, unknown>;
  const b = new DayBuilder();
  const data = (body.data && typeof body.data === "object" ? body.data : body) as Record<string, unknown>;
  const metrics = Array.isArray(data.metrics) ? data.metrics : [];
  for (const raw of metrics) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as { name?: unknown; units?: unknown; data?: unknown };
    const name = String(m.name || "").toLowerCase();
    const units = typeof m.units === "string" ? m.units : "";
    const entries = Array.isArray(m.data) ? m.data : [];
    if (name === "sleep_analysis") { readSleep(b, entries, units); continue; }
    if (name === "heart_rate") {
      for (const e of entries as Array<Record<string, unknown>>) {
        const at = localParts(e?.date);
        const max = num(e?.Max ?? e?.max);
        if (at && max !== undefined) b.add(at.date, "maxHr", max, `${at.date} ${at.time}`);
      }
      continue;
    }
    const key = HAE_KEY.get(name);
    if (!key) continue;
    for (const e of entries as Array<Record<string, unknown>>) {
      const at = localParts(e?.date ?? e?.startDate);
      const v = num(e?.qty ?? e?.Avg ?? e?.avg);
      if (at && v !== undefined) b.add(at.date, key, toUnit(key, v, units), `${at.date} ${at.time}`);
    }
  }
  for (const w of Array.isArray(data.workouts) ? data.workouts : []) readWorkout(b, w);

  const simple = Array.isArray(body.days) ? body.days : isHealthDate(body.date) ? [body] : [];
  for (const raw of simple) {
    if (!raw || typeof raw !== "object") continue;
    const d = raw as Record<string, unknown>;
    if (!isHealthDate(d.date)) continue;
    const day = b.day(d.date);
    const src = d.metrics && typeof d.metrics === "object" ? { ...d, ...d.metrics as object } as Record<string, unknown> : d;
    for (const key of HEALTH_METRIC_KEYS) {
      const v = num(src[key]);
      if (v === undefined) continue;
      const clean = cleanMetric(key, key === "spo2" || key === "bodyFatPct" ? toUnit(key, v, "%") : v);
      if (clean !== undefined) day.metrics[key] = clean;
    }
    // Shortcuts report sleep in hours more naturally.
    const hours = num(src.sleepHours);
    if (hours !== undefined && day.metrics.sleepMin === undefined) { const v = cleanMetric("sleepMin", hours * 60); if (v !== undefined) day.metrics.sleepMin = v; }
    const start = localStamp(src.sleepStart), end = localStamp(src.sleepEnd);
    if (start) day.sleepStart = start;
    if (end) day.sleepEnd = end;
    if (Array.isArray(src.workouts)) for (const w of src.workouts) readWorkout(b, w);
  }
  const days = b.build();
  if (!days.length) throw new Error("No Apple Health data found. Send Health Auto Export JSON, or { \"days\": [{ \"date\": \"YYYY-MM-DD\", \"steps\": 1234 }] }.");
  return days;
}

/** Applies patches to a list of days and returns the new list plus how many days changed. */
export function applyHealthPatches(days: HealthDay[], patches: HealthDayPatch[], source: string, now = new Date().toISOString()): { days: HealthDay[]; changed: HealthDay[] } {
  const byDate = new Map(days.map(d => [d.date, d]));
  const changed: HealthDay[] = [];
  for (const patch of patches) {
    const before = byDate.get(patch.date);
    const after = mergeHealthDay(before, patch, source, now);
    if (sameHealthData(before, after)) continue;
    byDate.set(patch.date, after);
    changed.push(after);
  }
  return { days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), changed };
}

export function normalizeHealthProfile(value: unknown): HealthProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const p = value as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;
  const profile: HealthProfile = {};
  const sleep = int(p.sleepGoalMin, 240, 720), steps = int(p.stepGoal, 1000, 50000), maxHr = int(p.maxHr, 120, 230), born = int(p.birthYear, 1900, 2030);
  if (sleep !== undefined) profile.sleepGoalMin = sleep;
  if (steps !== undefined) profile.stepGoal = steps;
  if (maxHr !== undefined) profile.maxHr = maxHr;
  if (born !== undefined) profile.birthYear = born;
  if (p.sex === "female" || p.sex === "male") profile.sex = p.sex;
  return Object.keys(profile).length ? profile : undefined;
}

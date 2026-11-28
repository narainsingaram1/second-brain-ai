import type { BodyMeasurements, HealthDay, HealthProfile, ProgressPhoto, ProgressPhotoPose } from "../types";
import { cleanMetric, cleanTags, isHealthDate } from "./health";
import { addDays, daysBetween, slope, toUnit, weekStart, type WeightUnit } from "./training";

/**
 * Body composition, weight trend analytics, and progress photo check-in management.
 * Pure and shared across the Health Workspace, the assistant's tools, and the tests.
 */

export type LengthUnit = "cm" | "in";
export const CM_PER_IN = 2.54;
export const toLengthUnit = (cm: number, unit: LengthUnit) => (unit === "in" ? cm / CM_PER_IN : cm);
export const fromLengthUnit = (value: number, unit: LengthUnit) => (unit === "in" ? value * CM_PER_IN : value);

export function fmtLength(cm: number | undefined, unit: LengthUnit, withUnit = true): string {
  if (cm === undefined) return "—";
  const v = Math.round(toLengthUnit(cm, unit) * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}${withUnit ? ` ${unit}` : ""}`;
}

export const PROGRESS_POSES: Array<{ id: ProgressPhotoPose; label: string }> = [
  { id: "front", label: "Front" },
  { id: "side", label: "Side" },
  { id: "back", label: "Back" },
  { id: "flexed", label: "Flexed" },
  { id: "other", label: "Other" },
];
export const PROGRESS_POSE_IDS = PROGRESS_POSES.map(p => p.id);
export const poseLabel = (pose: ProgressPhotoPose) => PROGRESS_POSES.find(p => p.id === pose)?.label || "Front";

export const PHOTO_PHASES = ["Cut", "Bulk", "Recomp", "Maintenance"] as const;
export const QUICK_PHOTO_TAGS = ["fasted", "morning", "post-workout", "relaxed", "flexed", "pump", "evening", "natural light"] as const;

export const MEASUREMENT_DEFS: Array<{ key: keyof BodyMeasurements; label: string; min: number; max: number }> = [
  { key: "waistCm", label: "Waist", min: 30, max: 250 },
  { key: "chestCm", label: "Chest", min: 40, max: 250 },
  { key: "armCm", label: "Arm", min: 15, max: 100 },
  { key: "hipCm", label: "Hips", min: 40, max: 250 },
  { key: "thighCm", label: "Thigh", min: 25, max: 150 },
];

const IMAGE_REF_RE = /^synapse-img:[a-f0-9]{32}\.(?:webp|png|jpg|gif)$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function cleanMeasurements(value: unknown): BodyMeasurements | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const out: BodyMeasurements = {};
  for (const def of MEASUREMENT_DEFS) {
    const v = cleanMetric(def.key, raw[def.key]);
    if (v !== undefined) out[def.key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function normalizeProgressPhoto(value: unknown): ProgressPhoto | undefined {
  if (!value || typeof value !== "object") return undefined;
  const p = value as Record<string, unknown>;
  const id = typeof p.id === "string" && p.id.trim() ? p.id.trim().slice(0, 200) : "";
  if (!id || !isHealthDate(p.date)) return undefined;
  const imageRef = typeof p.imageRef === "string" ? p.imageRef.trim() : "";
  if (!IMAGE_REF_RE.test(imageRef)) return undefined;
  const pose = PROGRESS_POSE_IDS.includes(p.pose as ProgressPhotoPose) ? (p.pose as ProgressPhotoPose) : "front";
  const now = new Date().toISOString();
  const out: ProgressPhoto = {
    id,
    date: p.date,
    pose,
    imageRef,
    createdAt: typeof p.createdAt === "string" && p.createdAt ? p.createdAt.slice(0, 40) : now,
    updatedAt: typeof p.updatedAt === "string" && p.updatedAt ? p.updatedAt.slice(0, 40) : now,
  };
  if (typeof p.time === "string" && TIME_RE.test(p.time)) out.time = p.time;
  const dim = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 10000 ? Math.round(v) : undefined);
  const w = dim(p.width), h = dim(p.height);
  if (w !== undefined) out.width = w;
  if (h !== undefined) out.height = h;
  const weightKg = cleanMetric("weightKg", p.weightKg);
  if (weightKg !== undefined) out.weightKg = weightKg;
  const bodyFatPct = cleanMetric("bodyFatPct", p.bodyFatPct);
  if (bodyFatPct !== undefined) out.bodyFatPct = bodyFatPct;
  const measurements = cleanMeasurements(p.measurements);
  if (measurements) out.measurements = measurements;
  if (typeof p.phase === "string" && p.phase.trim()) out.phase = p.phase.trim().slice(0, 40);
  const tags = cleanTags(p.tags);
  if (tags.length) out.tags = tags;
  if (typeof p.note === "string" && p.note.trim()) out.note = p.note.trim().slice(0, 2000);
  if (p.milestone === true) out.milestone = true;
  return out;
}

const byPhotoOrder = (a: ProgressPhoto, b: ProgressPhoto) =>
  a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "") || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export function normalizeProgressPhotos(value: unknown): ProgressPhoto[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map(normalizeProgressPhoto)
    .filter((p): p is ProgressPhoto => !!p && !seen.has(p.id) && !!seen.add(p.id))
    .sort(byPhotoOrder);
}

// ---- Weight & Body Composition Analytics ----

export interface BodyWeightPoint {
  date: string;
  kg: number;
  avg7: number;
  avg30: number;
  ema7: number;
  deltaPrevKg?: number;
  deltaStartKg: number;
  bodyFatPct?: number;
  leanMassKg?: number;
  fatMassKg?: number;
  photoCount: number;
  source: string;
}

export interface WeeklyWeightChange {
  week: string;
  avgKg: number;
  minKg: number;
  maxKg: number;
  weighIns: number;
  changeKg?: number;
  changePct?: number;
}

export interface MeasurementTrend {
  key: keyof BodyMeasurements;
  label: string;
  points: Array<{ date: string; cm: number }>;
  latestCm?: number;
  startCm?: number;
  changeCm?: number;
  change30Cm?: number;
}

export interface BodyAnalytics {
  today: string;
  points: BodyWeightPoint[];
  weeklyChanges: WeeklyWeightChange[];
  bodyFatPoints: Array<{ date: string; pct: number; leanKg?: number; fatKg?: number }>;
  measurements: MeasurementTrend[];
  startKg?: number;
  startDate?: string;
  latestKg?: number;
  latestDate?: string;
  trendKg?: number;
  lowestKg?: { date: string; kg: number };
  highestKg?: { date: string; kg: number };
  totalChangeKg?: number;
  totalChangePct?: number;
  change7Kg?: number;
  change30Kg?: number;
  change90Kg?: number;
  perWeekKg?: number;
  perWeekPct?: number;
  fluctuationKg?: number;
  goalKg?: number;
  remainingKg?: number;
  goalProgressPct?: number;
  goalDate?: string;
  latestBodyFatPct?: number;
  bodyFatChange30?: number;
  latestLeanMassKg?: number;
  latestFatMassKg?: number;
  bmi?: number;
  weighInsLast30: number;
  totalWeighIns: number;
  totalPhotos: number;
  daysSinceLastPhoto?: number;
}

const dayMs = 86400000;
const utc = (d: string) => Date.parse(`${d}T12:00:00Z`);
const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Computes in-depth weight, moving averages, rate-of-change, body composition, and measurement analytics. */
export function computeBodyAnalytics(
  days: HealthDay[],
  photos: ProgressPhoto[] = [],
  profile: HealthProfile | undefined,
  today: string
): BodyAnalytics {
  const validDays = days.filter(d => d.date <= today);
  const validPhotos = photos.filter(p => p.date <= today);
  const dayByDate = new Map(validDays.map(d => [d.date, d]));
  const photosByDate = new Map<string, ProgressPhoto[]>();
  for (const p of validPhotos) {
    const list = photosByDate.get(p.date) || [];
    list.push(p);
    photosByDate.set(p.date, list);
  }

  // Merge weight entries: healthDays is primary, progressPhotos fills any date without a healthDay weight.
  const allDates = new Set<string>([...dayByDate.keys(), ...photosByDate.keys()]);
  const rawWeights: Array<{ date: string; kg: number; bodyFatPct?: number; source: string }> = [];
  const rawBodyFat: Array<{ date: string; pct: number }> = [];

  for (const date of [...allDates].sort()) {
    const d = dayByDate.get(date);
    const dayPhotos = photosByDate.get(date) || [];
    const latestPhotoWithWeight = [...dayPhotos].reverse().find(p => p.weightKg !== undefined);
    const latestPhotoWithBf = [...dayPhotos].reverse().find(p => p.bodyFatPct !== undefined);
    const kg = d?.metrics.weightKg ?? latestPhotoWithWeight?.weightKg;
    const bf = d?.metrics.bodyFatPct ?? latestPhotoWithBf?.bodyFatPct;
    if (bf !== undefined) rawBodyFat.push({ date, pct: bf });
    if (kg !== undefined) {
      rawWeights.push({
        date,
        kg,
        bodyFatPct: bf,
        source: d?.metrics.weightKg !== undefined ? (d.source || "manual") : "photo",
      });
    }
  }

  const startKg = profile?.startWeightKg ?? rawWeights[0]?.kg;
  const startDate = profile?.startWeightKg !== undefined ? (rawWeights[0]?.date ?? today) : rawWeights[0]?.date;

  // Exponential moving average calibrated to roughly a 7-day time constant, handling gaps gracefully.
  let ema = rawWeights[0]?.kg ?? 0;
  const points: BodyWeightPoint[] = rawWeights.map((entry, i) => {
    const win7 = rawWeights.slice(0, i + 1).filter(q => daysBetween(q.date, entry.date) < 7);
    const win30 = rawWeights.slice(0, i + 1).filter(q => daysBetween(q.date, entry.date) < 30);
    const avg7 = round(win7.reduce((s, q) => s + q.kg, 0) / win7.length, 2);
    const avg30 = round(win30.reduce((s, q) => s + q.kg, 0) / win30.length, 2);
    if (i === 0) ema = entry.kg;
    else {
      const gap = Math.max(1, daysBetween(rawWeights[i - 1].date, entry.date));
      const alpha = 1 - Math.exp(-gap / 7);
      ema = ema + alpha * (entry.kg - ema);
    }
    const prev = i > 0 ? rawWeights[i - 1] : undefined;
    const bf = entry.bodyFatPct;
    const fatMassKg = bf !== undefined ? round((entry.kg * bf) / 100, 2) : undefined;
    const leanMassKg = fatMassKg !== undefined ? round(entry.kg - fatMassKg, 2) : undefined;
    return {
      date: entry.date,
      kg: entry.kg,
      avg7,
      avg30,
      ema7: round(ema, 2),
      deltaPrevKg: prev ? round(entry.kg - prev.kg, 2) : undefined,
      deltaStartKg: startKg !== undefined ? round(entry.kg - startKg, 2) : 0,
      bodyFatPct: bf,
      leanMassKg,
      fatMassKg,
      photoCount: photosByDate.get(entry.date)?.length || 0,
      source: entry.source,
    };
  });

  // Weekly weight buckets and week-over-week change.
  const weekMap = new Map<string, BodyWeightPoint[]>();
  for (const p of points) {
    const wk = weekStart(p.date);
    const list = weekMap.get(wk) || [];
    list.push(p);
    weekMap.set(wk, list);
  }
  const weeklyChanges: WeeklyWeightChange[] = [];
  const sortedWeeks = [...weekMap.keys()].sort();
  for (let i = 0; i < sortedWeeks.length; i++) {
    const week = sortedWeeks[i];
    const items = weekMap.get(week)!;
    const avgKg = round(items.reduce((s, x) => s + x.kg, 0) / items.length, 2);
    const prevWeek = i > 0 ? weeklyChanges[i - 1] : undefined;
    const changeKg = prevWeek ? round(avgKg - prevWeek.avgKg, 2) : undefined;
    const changePct = prevWeek && prevWeek.avgKg ? round(((avgKg - prevWeek.avgKg) / prevWeek.avgKg) * 100, 2) : undefined;
    weeklyChanges.push({
      week,
      avgKg,
      minKg: Math.min(...items.map(x => x.kg)),
      maxKg: Math.max(...items.map(x => x.kg)),
      weighIns: items.length,
      changeKg,
      changePct,
    });
  }

  // Body fat & lean mass series (join weight on same day or nearest within 3 days).
  const bodyFatPoints = rawBodyFat.map(bf => {
    const w = points.find(p => p.date === bf.date)?.kg ?? nearestWeight(points, bf.date, 3)?.kg;
    const fatKg = w !== undefined ? round((w * bf.pct) / 100, 2) : undefined;
    const leanKg = fatKg !== undefined && w !== undefined ? round(w - fatKg, 2) : undefined;
    return { date: bf.date, pct: bf.pct, leanKg, fatKg };
  });

  // Measurements series across healthDays & progressPhotos.
  const measurements: MeasurementTrend[] = MEASUREMENT_DEFS.map(def => {
    const pts: Array<{ date: string; cm: number }> = [];
    for (const date of [...allDates].sort()) {
      const dayVal = dayByDate.get(date)?.metrics[def.key];
      const photoVal = [...(photosByDate.get(date) || [])].reverse().find(p => p.measurements?.[def.key] !== undefined)?.measurements?.[def.key];
      const cm = dayVal ?? photoVal;
      if (cm !== undefined) pts.push({ date, cm });
    }
    const latest = pts[pts.length - 1];
    const first = pts[0];
    const before30 = [...pts].reverse().find(p => daysBetween(p.date, today) >= 30);
    return {
      key: def.key,
      label: def.label,
      points: pts,
      latestCm: latest?.cm,
      startCm: first?.cm,
      changeCm: latest && first && pts.length > 1 ? round(latest.cm - first.cm, 1) : undefined,
      change30Cm: latest && before30 ? round(latest.cm - before30.cm, 1) : undefined,
    };
  });

  const latest = points[points.length - 1];
  const trendKg = latest?.avg7;
  const lowestKg = points.length ? points.reduce((m, p) => (p.kg < m.kg ? p : m), points[0]) : undefined;
  const highestKg = points.length ? points.reduce((m, p) => (p.kg > m.kg ? p : m), points[0]) : undefined;

  const findBefore = (daysAgo: number) => [...points].reverse().find(p => daysBetween(p.date, today) >= daysAgo);
  const b7 = findBefore(7), b30 = findBefore(30), b90 = findBefore(90);

  // Weekly pace from least-squares slope over last 28 days (or up to 42 if needed for >= 3 points).
  const recent28 = points.filter(p => daysBetween(p.date, today) <= 28);
  const s28 = recent28.length >= 3 && daysBetween(recent28[0].date, recent28[recent28.length - 1].date) >= 7
    ? slope(recent28.map(p => ({ x: utc(p.date) / dayMs, y: p.kg })))
    : undefined;
  const perWeekKg = s28 !== undefined ? round(s28 * 7, 2) : undefined;
  const perWeekPct = perWeekKg !== undefined && trendKg ? round((perWeekKg / trendKg) * 100, 2) : undefined;

  // Typical day-to-day noise (mean abs delta on consecutive days within 2 days apart).
  const deltas: number[] = [];
  for (let i = 1; i < points.length; i++) {
    if (daysBetween(points[i - 1].date, points[i].date) <= 2) deltas.push(Math.abs(points[i].kg - points[i - 1].kg));
  }
  const fluctuationKg = deltas.length >= 3 ? round(deltas.slice(-14).reduce((s, d) => s + d, 0) / Math.min(14, deltas.length), 2) : undefined;

  // Goal progress & ETA.
  const goalKg = profile?.goalWeightKg;
  const currentRef = trendKg ?? latest?.kg;
  let remainingKg: number | undefined;
  let goalProgressPct: number | undefined;
  let goalDate: string | undefined;
  if (goalKg !== undefined && currentRef !== undefined) {
    remainingKg = round(goalKg - currentRef, 2);
    if (startKg !== undefined && Math.abs(goalKg - startKg) >= 0.1) {
      const pct = ((currentRef - startKg) / (goalKg - startKg)) * 100;
      goalProgressPct = Math.round(Math.max(0, Math.min(100, pct)));
    }
    if (perWeekKg && Math.sign(goalKg - currentRef) === Math.sign(perWeekKg) && Math.abs(perWeekKg) >= 0.05) {
      const weeks = (goalKg - currentRef) / perWeekKg;
      if (weeks > 0 && weeks < 104) goalDate = addDays(today, Math.round(weeks * 7));
    }
  }

  const latestBf = bodyFatPoints[bodyFatPoints.length - 1];
  const beforeBf30 = [...bodyFatPoints].reverse().find(p => daysBetween(p.date, today) >= 30);
  const bmi = profile?.heightCm && latest ? round(latest.kg / (profile.heightCm / 100) ** 2, 1) : undefined;
  const lastPhoto = validPhotos[validPhotos.length - 1];

  return {
    today,
    points,
    weeklyChanges,
    bodyFatPoints,
    measurements,
    startKg,
    startDate,
    latestKg: latest?.kg,
    latestDate: latest?.date,
    trendKg,
    lowestKg: lowestKg ? { date: lowestKg.date, kg: lowestKg.kg } : undefined,
    highestKg: highestKg ? { date: highestKg.date, kg: highestKg.kg } : undefined,
    totalChangeKg: startKg !== undefined && latest ? round(latest.avg7 - startKg, 2) : undefined,
    totalChangePct: startKg && latest ? round(((latest.avg7 - startKg) / startKg) * 100, 1) : undefined,
    change7Kg: latest && b7 ? round(latest.avg7 - b7.avg7, 2) : undefined,
    change30Kg: latest && b30 ? round(latest.avg7 - b30.avg7, 2) : undefined,
    change90Kg: latest && b90 ? round(latest.avg7 - b90.avg7, 2) : undefined,
    perWeekKg,
    perWeekPct,
    fluctuationKg,
    goalKg,
    remainingKg,
    goalProgressPct,
    goalDate,
    latestBodyFatPct: latestBf?.pct,
    bodyFatChange30: latestBf && beforeBf30 ? round(latestBf.pct - beforeBf30.pct, 1) : undefined,
    latestLeanMassKg: latestBf?.leanKg,
    latestFatMassKg: latestBf?.fatKg,
    bmi,
    weighInsLast30: points.filter(p => daysBetween(p.date, today) < 30).length,
    totalWeighIns: points.length,
    totalPhotos: validPhotos.length,
    daysSinceLastPhoto: lastPhoto ? daysBetween(lastPhoto.date, today) : undefined,
  };
}

function nearestWeight<T extends { date: string; kg: number }>(points: T[], date: string, maxGapDays = 3): T | undefined {
  let best: T | undefined;
  let bestDist = Infinity;
  for (const p of points) {
    const dist = Math.abs(daysBetween(p.date, date));
    if (dist <= maxGapDays && dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}

/** Resolves a photo's weight: its own weightKg first, else the healthDay weight on that date or within ±3 days. */
export function photoWeightContext(
  photo: ProgressPhoto,
  days: HealthDay[]
): { kg?: number; exact: boolean; bodyFatPct?: number } {
  if (photo.weightKg !== undefined) {
    const dayBf = days.find(d => d.date === photo.date)?.metrics.bodyFatPct;
    return { kg: photo.weightKg, exact: true, bodyFatPct: photo.bodyFatPct ?? dayBf };
  }
  const exactDay = days.find(d => d.date === photo.date);
  if (exactDay?.metrics.weightKg !== undefined) {
    return { kg: exactDay.metrics.weightKg, exact: true, bodyFatPct: photo.bodyFatPct ?? exactDay.metrics.bodyFatPct };
  }
  const candidates = days
    .filter(d => d.metrics.weightKg !== undefined)
    .map(d => ({ date: d.date, kg: d.metrics.weightKg!, bf: d.metrics.bodyFatPct }));
  const near = nearestWeight(candidates, photo.date, 3);
  return near ? { kg: near.kg, exact: false, bodyFatPct: photo.bodyFatPct ?? near.bf } : { exact: false, bodyFatPct: photo.bodyFatPct };
}

export interface PhotoComparison {
  daysElapsed: number;
  weightDeltaKg?: number;
  perWeekKg?: number;
  bodyFatDeltaPct?: number;
  measurementDeltas: Array<{ key: keyof BodyMeasurements; label: string; beforeCm: number; afterCm: number; deltaCm: number }>;
}

/** Exact deltas between two progress photos (Before `a` -> After `b`). */
export function compareProgressPhotos(a: ProgressPhoto, b: ProgressPhoto, days: HealthDay[]): PhotoComparison {
  const daysElapsed = daysBetween(a.date, b.date);
  const wa = photoWeightContext(a, days);
  const wb = photoWeightContext(b, days);
  const weightDeltaKg = wa.kg !== undefined && wb.kg !== undefined ? round(wb.kg - wa.kg, 2) : undefined;
  const perWeekKg = weightDeltaKg !== undefined && Math.abs(daysElapsed) >= 7 ? round((weightDeltaKg / Math.abs(daysElapsed)) * 7, 2) : undefined;
  const bodyFatDeltaPct = wa.bodyFatPct !== undefined && wb.bodyFatPct !== undefined ? round(wb.bodyFatPct - wa.bodyFatPct, 1) : undefined;

  const dayA = days.find(d => d.date === a.date)?.metrics;
  const dayB = days.find(d => d.date === b.date)?.metrics;
  const measurementDeltas: PhotoComparison["measurementDeltas"] = [];
  for (const def of MEASUREMENT_DEFS) {
    const beforeCm = a.measurements?.[def.key] ?? dayA?.[def.key];
    const afterCm = b.measurements?.[def.key] ?? dayB?.[def.key];
    if (beforeCm !== undefined && afterCm !== undefined) {
      measurementDeltas.push({ key: def.key, label: def.label, beforeCm, afterCm, deltaCm: round(afterCm - beforeCm, 1) });
    }
  }
  return { daysElapsed, weightDeltaKg, perWeekKg, bodyFatDeltaPct, measurementDeltas };
}

/** Compact summary of weight, body composition, measurements, and progress photos for the assistant. */
export function bodySummaryForAssistant(
  days: HealthDay[],
  photos: ProgressPhoto[] = [],
  profile: HealthProfile | undefined,
  today: string
) {
  const unit: WeightUnit = profile?.weightUnit || "kg";
  const lengthUnit: LengthUnit = profile?.lengthUnit || (unit === "lb" ? "in" : "cm");
  const analytics = computeBodyAnalytics(days, photos, profile, today);
  const w = (kg: number | undefined) => (kg === undefined ? undefined : round(toUnit(kg, unit), 1));
  const len = (cm: number | undefined) => (cm === undefined ? undefined : round(toLengthUnit(cm, lengthUnit), 1));
  const byPose = photos.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.pose]: (acc[p.pose] || 0) + 1 }), {});

  return {
    unit,
    lengthUnit,
    weighIns: analytics.totalWeighIns,
    weighInsLast30Days: analytics.weighInsLast30,
    latestWeight: w(analytics.latestKg),
    latestWeightDate: analytics.latestDate,
    sevenDayTrendWeight: w(analytics.trendKg),
    startWeight: w(analytics.startKg),
    totalChange: w(analytics.totalChangeKg),
    totalChangePct: analytics.totalChangePct,
    change7Days: w(analytics.change7Kg),
    change30Days: w(analytics.change30Kg),
    change90Days: w(analytics.change90Kg),
    weeklyRate: w(analytics.perWeekKg),
    weeklyRatePct: analytics.perWeekPct,
    typicalDailyFluctuation: w(analytics.fluctuationKg),
    goalWeight: w(analytics.goalKg),
    remainingToGoal: w(analytics.remainingKg),
    goalProgressPct: analytics.goalProgressPct,
    projectedGoalDate: analytics.goalDate,
    bodyFatPct: analytics.latestBodyFatPct,
    leanMass: w(analytics.latestLeanMassKg),
    fatMass: w(analytics.latestFatMassKg),
    bmi: analytics.bmi,
    measurements: Object.fromEntries(
      analytics.measurements
        .filter(m => m.latestCm !== undefined)
        .map(m => [m.key, { label: m.label, latest: `${fmtLength(m.latestCm, lengthUnit)}`, change: len(m.changeCm), change30Days: len(m.change30Cm) }])
    ),
    progressPhotos: {
      total: photos.length,
      byPose,
      milestones: photos.filter(p => p.milestone).length,
      daysSinceLastPhoto: analytics.daysSinceLastPhoto,
      recent: [...photos].reverse().slice(0, 8).map(p => ({
        id: p.id,
        date: p.date,
        pose: p.pose,
        weight: w(photoWeightContext(p, days).kg),
        bodyFatPct: p.bodyFatPct,
        phase: p.phase,
        tags: p.tags,
        milestone: p.milestone,
        note: p.note,
      })),
    },
  };
}

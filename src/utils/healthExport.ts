import type { HealthWorkout } from "../types";
import { cleanMetric, localParts, toUnit, wakeDate, type HealthDayPatch } from "./health";

/**
 * Reads the export.xml inside Apple Health's "Export All Health Data" zip, a chunk at a time, into one
 * summary per day. Exports run to gigabytes, so nothing but the running daily totals is kept in memory,
 * and only those daily totals are ever stored.
 *
 * Health keeps every source's samples, so an iPhone and a Watch both count the same steps. Totals take the
 * larger source within each hour (close to Health's own de-duplication), Apple's daily Activity summary
 * wins for move/exercise/stand, and each night's sleep comes from the one source with the most detail.
 */

type Mode = "sum" | "avg" | "last" | "max";
const QUANTITY: Record<string, { key: string; mode: Mode; night?: boolean }> = {
  HKQuantityTypeIdentifierStepCount: { key: "steps", mode: "sum" },
  HKQuantityTypeIdentifierDistanceWalkingRunning: { key: "distanceKm", mode: "sum" },
  HKQuantityTypeIdentifierFlightsClimbed: { key: "flights", mode: "sum" },
  HKQuantityTypeIdentifierActiveEnergyBurned: { key: "activeKcal", mode: "sum" },
  HKQuantityTypeIdentifierBasalEnergyBurned: { key: "basalKcal", mode: "sum" },
  HKQuantityTypeIdentifierAppleExerciseTime: { key: "exerciseMin", mode: "sum" },
  HKQuantityTypeIdentifierTimeInDaylight: { key: "daylightMin", mode: "sum" },
  HKQuantityTypeIdentifierRestingHeartRate: { key: "restingHr", mode: "avg" },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { key: "hrv", mode: "avg" },
  HKQuantityTypeIdentifierWalkingHeartRateAverage: { key: "walkingHr", mode: "avg" },
  HKQuantityTypeIdentifierRespiratoryRate: { key: "respRate", mode: "avg", night: true },
  HKQuantityTypeIdentifierOxygenSaturation: { key: "spo2", mode: "avg" },
  HKQuantityTypeIdentifierAppleSleepingWristTemperature: { key: "wristTempC", mode: "avg", night: true },
  HKQuantityTypeIdentifierVO2Max: { key: "vo2max", mode: "last" },
  HKQuantityTypeIdentifierBodyMass: { key: "weightKg", mode: "last" },
  HKQuantityTypeIdentifierBodyFatPercentage: { key: "bodyFatPct", mode: "last" },
  HKQuantityTypeIdentifierHeartRate: { key: "maxHr", mode: "max" },
};
const SLEEP = "HKCategoryTypeIdentifierSleepAnalysis";
const STAND = "HKCategoryTypeIdentifierAppleStandHour";
const DISTANCE_STATS = /Distance/;

/** The value of one attribute in a tag's text, without parsing the rest. */
function attr(tag: string, name: string): string | undefined {
  const at = tag.startsWith(`${name}="`) ? -1 : tag.indexOf(` ${name}="`);
  if (at < 0 && !tag.startsWith(`${name}="`)) return undefined;
  const start = at + name.length + 3;
  return tag.slice(start, tag.indexOf('"', start));
}
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (_, e: string) =>
  e === "amp" ? "&" : e === "lt" ? "<" : e === "gt" ? ">" : e === "quot" ? '"' : e === "apos" ? "'" : String.fromCharCode(Number(e.slice(1))));
const stamp = (value: string | undefined) => { const p = localParts(value); return p ? `${p.date} ${p.time}` : undefined; };
const minutesBetween = (a: string, b: string) => (Date.parse(`${b.replace(" ", "T")}:00Z`) - Date.parse(`${a.replace(" ", "T")}:00Z`)) / 60000;
const activityName = (raw: string) => decode(raw).replace(/^HKWorkoutActivityType/, "").replace(/([a-z])([A-Z])/g, "$1 $2") || "Workout";

interface Night { stages: Record<string, number>; start?: string; end?: string }
interface OpenWorkout { date: string; workout: Partial<HealthWorkout> & { start: string; type: string }; inActivity: number }

export interface ExportProgress { records: number; days: number; firstDate?: string; lastDate?: string }

export class AppleHealthExportParser {
  private rest = "";
  /** date|key|hour → source → total */
  private hourly = new Map<string, Map<string, number>>();
  private avg = new Map<string, { sum: number; n: number }>();
  private last = new Map<string, { at: string; v: number }>();
  private max = new Map<string, number>();
  private stood = new Map<string, Set<string>>();
  private summary = new Map<string, Record<string, number>>();
  /** wake date → source → night */
  private nights = new Map<string, Map<string, Night>>();
  private workouts = new Map<string, HealthWorkout[]>();
  private open?: OpenWorkout;
  private dates = new Set<string>();
  records = 0;

  /** Feeds the next piece of text; tags split across pieces are carried over. */
  feed(text: string) {
    const body = this.rest + text;
    const cut = body.lastIndexOf(">") + 1;
    this.rest = body.slice(cut);
    // Plain string searches: a regex over every tag is several times slower on gigabyte exports.
    let pos = 0;
    for (;;) {
      const lt = body.indexOf("<", pos);
      if (lt < 0 || lt >= cut) break;
      const gt = body.indexOf(">", lt);
      if (gt < 0 || gt >= cut) break;
      pos = gt + 1;
      const c = body.charCodeAt(lt + 1);
      if (c === 82 /* R */) {
        if (body.startsWith("Record ", lt + 1)) this.record(body.slice(lt + 7, gt));
      } else if (c === 87 /* W */) {
        if (body.startsWith("WorkoutStatistics ", lt + 1)) this.statistic(body.slice(lt + 18, gt));
        else if (body.startsWith("WorkoutActivity ", lt + 1)) { if (this.open && body.charCodeAt(gt - 1) !== 47) this.open.inActivity++; }
        else if (body.startsWith("Workout ", lt + 1)) { this.openWorkout(body.slice(lt + 8, gt)); if (body.charCodeAt(gt - 1) === 47) this.closeWorkout(); }
      } else if (c === 47 /* / */) {
        if (body.startsWith("/Workout>", lt + 1)) this.closeWorkout();
        else if (body.startsWith("/WorkoutActivity>", lt + 1) && this.open) this.open.inActivity--;
      } else if (c === 65 /* A */) {
        if (body.startsWith("ActivitySummary ", lt + 1)) this.activitySummary(body.slice(lt + 16, gt));
      }
    }
  }

  progress(): ExportProgress {
    const sorted = [...this.dates].sort();
    return { records: this.records, days: sorted.length, firstDate: sorted[0], lastDate: sorted[sorted.length - 1] };
  }

  private record(tag: string) {
    const type = attr(tag, "type");
    if (!type) return;
    if (type === SLEEP) return this.sleep(tag);
    if (type === STAND) {
      const start = stamp(attr(tag, "startDate"));
      if (start && attr(tag, "value")?.endsWith("Stood")) { this.records++; this.add(this.stood, start.slice(0, 10), start.slice(11, 13)); }
      return;
    }
    const def = QUANTITY[type];
    if (!def) return;
    const start = stamp(attr(tag, "startDate")), raw = Number(attr(tag, "value"));
    if (!start || !Number.isFinite(raw)) return;
    this.records++;
    const value = toUnit(def.key, raw, attr(tag, "unit") || "");
    const date = def.night ? wakeDate(stamp(attr(tag, "endDate")) || start) : start.slice(0, 10);
    this.dates.add(date);
    const key = `${date}|${def.key}`;
    if (def.mode === "sum") {
      const bucket = `${key}|${start.slice(11, 13)}`;
      let sources = this.hourly.get(bucket);
      if (!sources) this.hourly.set(bucket, sources = new Map());
      const source = attr(tag, "sourceName") || "";
      sources.set(source, (sources.get(source) || 0) + value);
    } else if (def.mode === "avg") {
      const a = this.avg.get(key) || { sum: 0, n: 0 };
      a.sum += value; a.n++;
      this.avg.set(key, a);
    } else if (def.mode === "max") {
      if (value > (this.max.get(key) ?? -Infinity)) this.max.set(key, value);
    } else {
      const prev = this.last.get(key);
      if (!prev || start >= prev.at) this.last.set(key, { at: start, v: value });
    }
  }

  private add(map: Map<string, Set<string>>, date: string, hour: string) {
    let s = map.get(date);
    if (!s) map.set(date, s = new Set());
    s.add(hour);
    this.dates.add(date);
  }

  private sleep(tag: string) {
    const start = stamp(attr(tag, "startDate")), end = stamp(attr(tag, "endDate"));
    const value = attr(tag, "value") || "";
    if (!start || !end) return;
    const minutes = minutesBetween(start, end);
    if (!(minutes > 0 && minutes < 1440)) return;
    const stage = value.replace(/^HKCategoryValueSleepAnalysis/, "");
    const key = stage === "InBed" ? "inBedMin" : stage === "Awake" ? "awakeMin" : stage === "AsleepDeep" ? "deepMin" : stage === "AsleepREM" ? "remMin"
      : stage === "AsleepCore" ? "coreMin" : stage === "Asleep" || stage === "AsleepUnspecified" ? "unspecifiedMin" : "";
    if (!key) return;
    this.records++;
    const date = wakeDate(end);
    this.dates.add(date);
    let sources = this.nights.get(date);
    if (!sources) this.nights.set(date, sources = new Map());
    const source = decode(attr(tag, "sourceName") || "");
    let night = sources.get(source);
    if (!night) sources.set(source, night = { stages: {} });
    night.stages[key] = (night.stages[key] || 0) + minutes;
    if (key !== "awakeMin") {
      if (!night.start || start < night.start) night.start = start;
      if (!night.end || end > night.end) night.end = end;
    }
  }

  private openWorkout(tag: string) {
    const start = stamp(attr(tag, "startDate"));
    if (!start) { this.open = undefined; return; }
    const end = stamp(attr(tag, "endDate"));
    const duration = Number(attr(tag, "duration"));
    const unit = attr(tag, "durationUnit") || "min";
    const minutes = Number.isFinite(duration) ? (unit === "s" || unit === "sec" ? duration / 60 : unit === "hr" || unit === "h" ? duration * 60 : duration) : end ? minutesBetween(start, end) : 0;
    const workout: OpenWorkout["workout"] = { start, type: activityName(attr(tag, "workoutActivityType") || ""), minutes: Math.round(minutes) };
    // Exports before iOS 16 carry totals on the workout itself.
    const energy = Number(attr(tag, "totalEnergyBurned")), distance = Number(attr(tag, "totalDistance"));
    if (energy > 0) workout.energyKcal = Math.round(toUnit("activeKcal", energy, attr(tag, "totalEnergyBurnedUnit") || "kcal"));
    if (distance > 0) workout.distanceKm = Math.round(toUnit("distanceKm", distance, attr(tag, "totalDistanceUnit") || "km") * 100) / 100;
    this.open = { date: start.slice(0, 10), workout, inActivity: 0 };
    this.records++;
  }

  private statistic(tag: string) {
    // Multi-sport workouts repeat statistics per activity; the workout-level ones are the totals.
    if (!this.open || this.open.inActivity > 0) return;
    const type = attr(tag, "type") || "", w = this.open.workout, unit = attr(tag, "unit") || "";
    if (type === "HKQuantityTypeIdentifierHeartRate") {
      const avg = Number(attr(tag, "average")), mx = Number(attr(tag, "maximum"));
      if (avg > 0) w.avgHr = Math.round(avg);
      if (mx > 0) w.maxHr = Math.round(mx);
    } else if (type === "HKQuantityTypeIdentifierActiveEnergyBurned") {
      const sum = Number(attr(tag, "sum"));
      if (sum > 0) w.energyKcal = Math.round(toUnit("activeKcal", sum, unit || "kcal"));
    } else if (DISTANCE_STATS.test(type)) {
      const sum = Number(attr(tag, "sum"));
      if (sum > 0) w.distanceKm = Math.round(toUnit("distanceKm", sum, unit || "km") * 100) / 100;
    }
  }

  private closeWorkout() {
    const open = this.open;
    this.open = undefined;
    if (!open || !(open.workout.minutes! > 0 && open.workout.minutes! <= 1440)) return;
    const w = open.workout as HealthWorkout;
    w.id = `${w.start}|${w.type}`;
    const list = this.workouts.get(open.date) || [];
    if (!list.some(x => x.id === w.id)) list.push(w);
    this.workouts.set(open.date, list);
    this.dates.add(open.date);
  }

  private activitySummary(tag: string) {
    const date = attr(tag, "dateComponents");
    if (!date || !localParts(date)) return;
    const energy = Number(attr(tag, "activeEnergyBurned")), exercise = Number(attr(tag, "appleExerciseTime")), stand = Number(attr(tag, "appleStandHours"));
    const values: Record<string, number> = {};
    if (energy > 0) values.activeKcal = toUnit("activeKcal", energy, attr(tag, "activeEnergyBurnedUnit") || "kcal");
    if (exercise > 0) values.exerciseMin = exercise;
    if (stand > 0) values.standHours = stand;
    if (Object.keys(values).length) { this.summary.set(date, values); this.dates.add(date); this.records++; }
  }

  /** Daily summaries for every day in the export, oldest first. */
  finish(): HealthDayPatch[] {
    if (this.rest.trim()) this.feed(">");
    const days = new Map<string, HealthDayPatch>();
    const day = (date: string) => { let d = days.get(date); if (!d) days.set(date, d = { date, metrics: {} }); return d; };
    const set = (date: string, key: string, value: number) => { const v = cleanMetric(key, value); if (v !== undefined) day(date).metrics[key] = v; };

    const totals = new Map<string, number>();
    for (const [bucket, sources] of this.hourly) {
      const key = bucket.slice(0, bucket.lastIndexOf("|"));
      totals.set(key, (totals.get(key) || 0) + Math.max(...sources.values()));
    }
    for (const [key, v] of totals) { const [date, metric] = key.split("|"); set(date, metric, v); }
    for (const [key, a] of this.avg) { const [date, metric] = key.split("|"); set(date, metric, a.sum / a.n); }
    for (const [key, l] of this.last) { const [date, metric] = key.split("|"); set(date, metric, l.v); }
    for (const [key, v] of this.max) { const [date, metric] = key.split("|"); set(date, metric, v); }
    for (const [date, hours] of this.stood) set(date, "standHours", hours.size);
    for (const [date, values] of this.summary) for (const [key, v] of Object.entries(values)) set(date, key, v);

    for (const [date, sources] of this.nights) {
      const asleep = (n: Night) => (n.stages.coreMin || 0) + (n.stages.deepMin || 0) + (n.stages.remMin || 0);
      const nights = [...sources.values()];
      const best = nights.sort((a, b) => asleep(b) - asleep(a) || (b.stages.unspecifiedMin || 0) - (a.stages.unspecifiedMin || 0))[0];
      const staged = asleep(best);
      const total = staged || best.stages.unspecifiedMin || 0;
      if (total > 0) set(date, "sleepMin", total);
      for (const key of ["deepMin", "remMin", "coreMin", "awakeMin"]) if (best.stages[key]) set(date, key, best.stages[key]);
      const inBed = best.stages.inBedMin || Math.max(0, ...nights.map(n => n.stages.inBedMin || 0));
      if (inBed > 0) set(date, "inBedMin", inBed);
      const d = day(date);
      if (best.start && total > 0) d.sleepStart = best.start;
      if (best.end && total > 0) d.sleepEnd = best.end;
    }
    for (const [date, list] of this.workouts) day(date).workouts = list.slice(0, 30);
    return [...days.values()].filter(d => Object.keys(d.metrics).length || d.workouts?.length).sort((a, b) => a.date.localeCompare(b.date));
  }
}

// ---- Reading the file ----

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);
const u64 = (v: DataView, o: number) => Number(v.getBigUint64(o, true));
const view = async (blob: Blob, start: number, end: number) => new DataView(await blob.slice(start, end).arrayBuffer());

/**
 * One file inside a zip, decompressed as a stream. Reads only the zip's directory and that file's bytes,
 * so a multi-gigabyte export never has to fit in memory. Handles ZIP64 (exports over 4 GB).
 */
export async function zipEntry(blob: Blob, match: (name: string) => boolean): Promise<{ name: string; raw: Blob; method: number }> {
  const tailStart = Math.max(0, blob.size - 65_557);
  const tail = await view(blob, tailStart, blob.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("This is not a zip file. Choose the export.zip from the Health app, or the export.xml inside it.");
  let count = u16(tail, eocd + 10), dirSize = u32(tail, eocd + 12), dirOffset = u32(tail, eocd + 16);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || u32(tail, locator) !== 0x07064b50) throw new Error("This zip file is damaged.");
    const recordAt = u64(tail, locator + 8);
    const record = await view(blob, recordAt, recordAt + 56);
    if (u32(record, 0) !== 0x06064b50) throw new Error("This zip file is damaged.");
    count = u64(record, 32); dirSize = u64(record, 40); dirOffset = u64(record, 48);
  }
  const dir = await view(blob, dirOffset, dirOffset + dirSize);
  const names = new TextDecoder();
  for (let p = 0, i = 0; i < count && p + 46 <= dir.byteLength; i++) {
    if (u32(dir, p) !== 0x02014b50) break;
    const method = u16(dir, p + 10), nameLen = u16(dir, p + 28), extraLen = u16(dir, p + 30), commentLen = u16(dir, p + 32);
    let compressed = u32(dir, p + 20), uncompressed = u32(dir, p + 24), local = u32(dir, p + 42);
    const name = names.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
    for (let e = p + 46 + nameLen; e + 4 <= p + 46 + nameLen + extraLen;) {
      const id = u16(dir, e), size = u16(dir, e + 2);
      if (id === 0x0001) {
        let o = e + 4;
        if (uncompressed === 0xffffffff) { uncompressed = u64(dir, o); o += 8; }
        if (compressed === 0xffffffff) { compressed = u64(dir, o); o += 8; }
        if (local === 0xffffffff) { local = u64(dir, o); }
      }
      e += 4 + size;
    }
    p += 46 + nameLen + extraLen + commentLen;
    if (!match(name)) continue;
    const header = await view(blob, local, local + 30);
    if (u32(header, 0) !== 0x04034b50) throw new Error("This zip file is damaged.");
    const start = local + 30 + u16(header, 26) + u16(header, 28);
    if (method !== 0 && method !== 8) throw new Error("This zip uses a compression method the app can't read. Unzip it and choose export.xml instead.");
    return { name, raw: blob.slice(start, start + compressed), method };
  }
  throw new Error("No export.xml in this zip. Choose the export.zip made by Health → your profile → Export All Health Data.");
}

const isExportXml = (name: string) => /(^|\/)export\.xml$/i.test(name);

/**
 * Reads an Apple Health export (the zip, or the export.xml from it) into daily summaries, reporting how far
 * through the file it is. Runs in a worker in the app; plain enough to run in Node for tests.
 */
export async function readAppleHealthExport(file: Blob & { name?: string }, onProgress?: (fraction: number, p: ExportProgress) => void): Promise<{ patches: HealthDayPatch[]; records: number }> {
  const head = new DataView(await file.slice(0, 4).arrayBuffer());
  const isZip = head.byteLength === 4 && head.getUint32(0, true) === 0x04034b50;
  const entry = isZip ? await zipEntry(file, isExportXml) : { raw: file as Blob, method: 0 };
  // Progress follows the bytes read from the file itself (compressed, for a zip).
  let read = 0;
  const total = Math.max(1, entry.raw.size);
  let bytes = (entry.raw.stream() as ReadableStream<Uint8Array>).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, c) { read += chunk.byteLength; c.enqueue(chunk); } }));
  if (entry.method === 8) bytes = bytes.pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const parser = new AppleHealthExportParser();
  const reader = bytes.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(value);
    if (onProgress && read - lastReport > total / 200) { lastReport = read; onProgress(Math.min(0.99, read / total), parser.progress()); }
  }
  const patches = parser.finish();
  if (!patches.length) throw new Error("This export has no health data the app understands.");
  onProgress?.(1, parser.progress());
  return { patches, records: parser.records };
}

/** Runs readAppleHealthExport in a worker when the browser has them, otherwise on this thread. */
export function importAppleHealthExport(file: File, onProgress: (fraction: number, p: ExportProgress) => void): Promise<{ patches: HealthDayPatch[]; records: number }> {
  if (typeof Worker === "undefined") return readAppleHealthExport(file, onProgress);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/healthImport.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === "progress") onProgress(data.fraction, data.progress);
      else { worker.terminate(); if (data.type === "done") resolve({ patches: data.patches, records: data.records }); else reject(new Error(data.message)); }
    };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || "The export could not be read.")); };
    worker.postMessage({ file });
  });
}

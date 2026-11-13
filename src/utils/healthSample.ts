import type { HealthDay } from "../types";
import { healthDayId } from "./health";

/**
 * Plausible made-up days for previewing the Health workspace before any data arrives. Never saved.
 * What happens during a day shapes the night that follows (and so the next record): daylight and
 * activity help, late workouts, alcohol and late screens hurt, and weekends drift later. That gives
 * the pattern finder something real to find.
 */
export function sampleHealthDays(today: string, count = 75): HealthDay[] {
  let seed = 42;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const noise = (scale: number) => (rand() + rand() + rand() - 1.5) * scale;
  const dateAt = (i: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - i); return d; };
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const stamp = (dt: string, m: number) => `${dt} ${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;

  // Daytime behaviour for each day, oldest first (plus the day before the first record).
  const behaviour = Array.from({ length: count + 1 }, (_, k) => {
    const i = count - k;
    const date = dateAt(i);
    const workout = rand() < 0.5;
    return {
      weekend: [5, 6].includes(date.getUTCDay()), // Friday and Saturday evenings run late.
      drank: rand() < 0.12, lateScreen: rand() < 0.15,
      daylight: Math.max(5, Math.round(45 + noise(40))),
      workout, minutes: Math.round(30 + rand() * 45), late: workout && rand() < 0.3, running: rand() < 0.5,
    };
  });

  const days: HealthDay[] = [];
  for (let k = 1; k <= count; k++) {
    const i = count - k;
    const d = dateAt(i), date = iso(d), prevDate = iso(dateAt(i + 1));
    const y = behaviour[k - 1], t = behaviour[k];
    // Last night, shaped by yesterday.
    const light = (y.daylight - 45) / 40;
    const bed = 23 * 60 + 5 + Math.round(noise(25)) + (y.lateScreen ? 75 : 0) + (y.weekend ? 50 : 0) - Math.round(light * 12) + (y.late ? 35 : 0);
    const sleepMin = Math.round(445 + noise(35) + light * 18 - (y.lateScreen ? 55 : 0) - (y.drank ? 20 : 0) - (y.late ? 25 : 0) + (y.workout && !y.late ? 10 : 0));
    const awakeMin = Math.max(4, Math.round(16 + noise(10) + (y.drank ? 22 : 0) + (y.late ? 10 : 0)));
    const deepShare = 0.14 + light * 0.015 + (y.workout && !y.late ? 0.02 : 0) - (y.drank ? 0.04 : 0) + noise(0.02);
    const remShare = 0.22 - (y.drank ? 0.05 : 0) + noise(0.025);
    const wake = bed + sleepMin + awakeMin - 1440;
    const day: HealthDay = {
      id: healthDayId(date), date, source: "sample", updatedAt: new Date().toISOString(),
      metrics: {
        steps: Math.round(8500 + noise(4000) + (t.workout ? 2500 : 0)), activeKcal: Math.round(480 + noise(160) + (t.workout ? 300 : 0)),
        exerciseMin: t.workout ? t.minutes + Math.round(rand() * 10) : Math.round(8 + rand() * 15), standHours: Math.round(10 + noise(3)),
        restingHr: Math.round(56 + noise(3) + (y.drank ? 4 : 0) + (y.late ? 1.5 : 0) - i / 40),
        hrv: Math.round(62 + noise(12) - (y.drank ? 16 : 0) + (sleepMin - 445) / 12 - (y.late ? 5 : 0) - i / 15 + 4),
        respRate: Math.round((14.6 + noise(0.6)) * 10) / 10, sleepMin, awakeMin,
        deepMin: Math.round(sleepMin * deepShare), remMin: Math.round(sleepMin * remShare), coreMin: Math.round(sleepMin * (1 - deepShare - remShare)),
        daylightMin: t.daylight,
      },
      sleepStart: stamp(bed >= 1440 ? date : prevDate, bed), sleepEnd: stamp(date, wake),
      ...(t.workout ? { workouts: [{ id: `s-${date}`, type: t.running ? "Running" : "Traditional Strength Training", start: `${date} ${t.late ? "20:45" : "17:30"}`, minutes: t.minutes,
        avgHr: Math.round(135 + noise(15)), maxHr: Math.round(168 + noise(10)), energyKcal: t.minutes * 9 }] } : {}),
      // Tags describe this day; their effect shows up in the next morning's record.
      ...(t.drank ? { tags: ["alcohol"] } : t.lateScreen ? { tags: ["late screen"] } : {}),
    };
    if (i % 5 === 0) day.metrics.vo2max = Math.round((44 + (count - i) / 30 + noise(0.4)) * 10) / 10;
    days.push(day);
  }
  return days;
}

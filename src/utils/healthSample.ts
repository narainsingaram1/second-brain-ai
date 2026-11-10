import type { HealthDay } from "../types";
import { healthDayId } from "./health";

/** Plausible made-up days for previewing the Health workspace before any data arrives. Never saved. */
export function sampleHealthDays(today: string, count = 75): HealthDay[] {
  let seed = 42;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const noise = (scale: number) => (rand() + rand() + rand() - 1.5) * scale;
  const days: HealthDay[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const weekend = [0, 6].includes(d.getUTCDay());
    const drank = rand() < 0.12, lateNight = rand() < 0.15;
    const sleepMin = Math.round(430 + noise(50) - (lateNight ? 70 : 0) + (weekend ? 30 : 0));
    const bed = 23 * 60 + 15 + Math.round(noise(35)) + (lateNight ? 80 : 0) + (weekend ? 30 : 0);
    const wake = bed + sleepMin + 35 - 1440;
    const stamp = (dt: string, m: number) => `${dt} ${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
    const prev = new Date(d); prev.setUTCDate(prev.getUTCDate() - 1);
    const workout = rand() < 0.5;
    const minutes = Math.round(30 + rand() * 45);
    const day: HealthDay = {
      id: healthDayId(date), date, source: "sample", updatedAt: new Date().toISOString(),
      metrics: {
        steps: Math.round(8500 + noise(4000) + (workout ? 2500 : 0)), activeKcal: Math.round(480 + noise(160) + (workout ? 300 : 0)),
        exerciseMin: workout ? minutes + Math.round(rand() * 10) : Math.round(8 + rand() * 15), standHours: Math.round(10 + noise(3)),
        restingHr: Math.round(56 + noise(3) + (drank ? 4 : 0) - i / 40), hrv: Math.round(62 + noise(14) - (drank ? 16 : 0) + i / -15 + 4),
        respRate: Math.round((14.6 + noise(0.6)) * 10) / 10, sleepMin, deepMin: Math.round(sleepMin * 0.14), remMin: Math.round(sleepMin * 0.22), coreMin: Math.round(sleepMin * 0.64),
        vo2max: i % 5 === 0 ? Math.round((44 + (count - i) / 30 + noise(0.4)) * 10) / 10 : undefined as unknown as number,
        daylightMin: Math.round(45 + noise(30)),
      },
      sleepStart: stamp(bed >= 1440 ? date : prev.toISOString().slice(0, 10), bed), sleepEnd: stamp(date, wake),
      ...(workout ? { workouts: [{ id: `s-${date}`, type: rand() < 0.5 ? "Running" : "Traditional Strength Training", start: `${date} 17:30`, minutes, avgHr: Math.round(135 + noise(15)), maxHr: Math.round(168 + noise(10)), energyKcal: minutes * 9 }] } : {}),
      ...(drank ? { tags: ["alcohol"] } : lateNight ? { tags: ["late screen"] } : {}),
    };
    if (day.metrics.vo2max === undefined) delete day.metrics.vo2max;
    days.push(day);
  }
  // Tags describe the evening before a morning; move them a day earlier so effects show the next morning.
  for (let i = 0; i < days.length - 1; i++) { days[i].tags = days[i + 1].tags; }
  days[days.length - 1].tags = undefined;
  return days.map(d => { if (!d.tags) delete d.tags; return d; });
}

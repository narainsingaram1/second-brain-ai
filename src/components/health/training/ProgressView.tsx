import { useMemo, useState } from "react";
import { Sparkles, Trophy } from "lucide-react";
import { TimeChart, type ChartPoint } from "../HealthCharts";
import { exerciseById, measureOf, titleCase } from "../../../utils/exercises";
import { addDays, exerciseHistory, fmtWeight, isFinished, loggedExercises, personalRecords, sessionSets, toUnit, weekStart, type TrainingStats } from "../../../utils/training";
import { compact, shortDate, WEEKDAYS, type TrainingApi } from "./shared";

type Metric = "e1rm" | "top" | "volume" | "reps" | "time" | "distance";
const METRIC_LABEL: Record<Metric, string> = { e1rm: "Estimated max", top: "Heaviest set", volume: "Volume", reps: "Most reps", time: "Longest", distance: "Distance" };

export function ProgressView({ api, stats }: { api: TrainingApi; stats: TrainingStats }) {
  const { unit } = api;
  const done = useMemo(() => api.workouts.filter(w => isFinished(w) && sessionSets(w) > 0), [api.workouts]);
  const logged = useMemo(() => loggedExercises(done).sort((a, b) => b.sessions - a.sessions), [done]);
  const [exerciseId, setExerciseId] = useState<string>(logged[0]?.exerciseId || "");
  const current = logged.find(l => l.exerciseId === exerciseId) || logged[0];
  const measure = measureOf(current ? exerciseById(current.exerciseId, current.name) : undefined);
  const metrics: Metric[] = measure === "weight_reps" ? ["e1rm", "top", "volume"] : measure === "reps" ? ["reps", "volume"] : measure === "time" ? ["time"] : ["distance", "time"];
  const [metric, setMetric] = useState<Metric>("e1rm");
  const m = metrics.includes(metric) ? metric : metrics[0];
  const hist = useMemo(() => current ? exerciseHistory(done, current.exerciseId) : [], [done, current]);
  const records = useMemo(() => current ? personalRecords(done).filter(r => r.exerciseId === current.exerciseId && r.kind !== "volume").reverse().slice(0, 6) : [], [done, current]);
  const trend = stats.trends.find(t => t.exerciseId === current?.exerciseId);
  const w = (kg: number) => fmtWeight(kg, unit);
  const value = (p: typeof hist[number]): number | undefined => m === "e1rm" ? p.bestE1rm : m === "top" ? p.topWeightKg : m === "volume" ? p.volumeKg || undefined
    : m === "reps" ? p.maxReps || undefined : m === "time" ? p.bestSeconds || undefined : p.distanceKm || undefined;
  const format = (v: number) => m === "reps" ? `${Math.round(v)}` : m === "time" ? `${Math.round(v)}s` : m === "distance" ? `${v.toFixed(1)} km` : m === "volume" ? `${compact(toUnit(v, unit))} ${unit}` : w(v);
  const best = hist.reduce<number | undefined>((b, p) => { const v = value(p); return v !== undefined && (b === undefined || v > b) ? v : b; }, undefined);

  const weekPoints = (key: "sessions" | "volumeKg" | "sets"): ChartPoint[] => stats.weeks.map(x => ({ date: x.week, value: x[key] }));
  const weightPts = stats.weight.points.filter(p => p.date >= addDays(api.today, -180));
  const maxSets = Math.max(20, ...stats.muscles.map(x => x.sets));

  // 16 weeks of training days, Monday-first columns.
  const trained = new Set(done.map(x => x.date));
  const start = addDays(weekStart(api.today), -7 * 15);
  const cells = Array.from({ length: 16 * 7 }, (_, i) => addDays(start, i));

  if (!done.length) return <div className="hl-empty"><strong>Log a few workouts to see progress</strong><p>Strength trends, personal records, weekly volume and muscle balance show up here once you have sessions.</p></div>;

  return (
    <div className="tr-root">
      <section className="hl-card">
        <header>
          <span>Strength by exercise</span>
          <span className="tr-subnav-actions">
            <select className="tr-select" aria-label="Exercise" value={current?.exerciseId} onChange={e => setExerciseId(e.target.value)}>
              {logged.map(l => <option key={l.exerciseId} value={l.exerciseId}>{l.name} ({l.sessions})</option>)}
            </select>
            <span className="hl-range" role="group" aria-label="Measure">{metrics.map(x => <button key={x} type="button" aria-pressed={m === x} onClick={() => setMetric(x)}>{METRIC_LABEL[x]}</button>)}</span>
          </span>
        </header>
        <div className="tr-facts">
          <div className="tr-fact"><span>Best {METRIC_LABEL[m].toLowerCase()}</span><b>{best !== undefined ? format(best) : "—"}</b></div>
          <div className="tr-fact"><span>Sessions</span><b>{hist.length}</b><small>{hist.length ? `since ${shortDate(hist[0].date)}` : ""}</small></div>
          <div className="tr-fact"><span>Trend</span><b>{trend ? `${trend.perWeekPct > 0 ? "+" : ""}${trend.perWeekPct}%` : "—"}</b><small>{trend ? "estimated max per week" : "needs 3 sessions in 12 weeks"}</small></div>
          <div className="tr-fact"><span>Status</span><b>{trend ? <span className={`tr-status tr-status-${trend.status}`}>{titleCase(trend.status)}</span> : "—"}</b><small>{trend?.status === "plateau" ? `${trend.weeksSinceBest} weeks since a best` : ""}</small></div>
        </div>
        <TimeChart points={hist.map(p => ({ date: p.date, value: value(p) }))} label={METRIC_LABEL[m]} format={format} />
        {records.length > 0 && (
          <ul className="tr-records">
            {records.map((r, i) => <li key={i}><Trophy size={14} /><span>{r.kind === "e1rm" ? "Estimated max" : r.kind === "weight" ? "Heaviest" : r.kind === "reps" ? "Most reps" : "Volume"}</span>
              <b>{r.kind === "reps" ? r.value : r.kind === "volume" ? `${compact(toUnit(r.value, unit))} ${unit}` : r.kind === "weight" ? `${w(r.value)}${r.reps ? ` × ${r.reps}` : ""}` : w(r.value)}</b><small>{shortDate(r.date)}</small></li>)}
          </ul>
        )}
      </section>

      <div className="tr-grid2">
        <section className="hl-card"><header><span>Sessions per week</span><small>target {stats.target}</small></header>
          <TimeChart kind="bar" points={weekPoints("sessions")} label="Sessions" format={v => `${Math.round(v)}`} goal={{ value: stats.target, label: "target" }} /></section>
        <section className="hl-card"><header><span>Weekly volume</span><small>weight × reps, working sets</small></header>
          <TimeChart kind="bar" points={stats.weeks.map(x => ({ date: x.week, value: x.volumeKg ? toUnit(x.volumeKg, unit) : undefined }))} label="Volume" format={v => `${compact(v)} ${unit}`} /></section>
        <section className="hl-card">
          <header><span>Hard sets per muscle</span><small>a week, last 4 weeks</small></header>
          {stats.muscles.length ? (
            <ul className="tr-bars">
              {stats.muscles.filter(x => x.muscle !== "neck").map(x => (
                <li key={x.muscle}><span>{x.muscle}</span>
                  <span className="tr-bar-track" title="Shaded: 10 to 20 sets a week">
                    <span className="tr-bar-zone" style={{ left: `${(10 / maxSets) * 100}%`, width: `${(10 / maxSets) * 100}%` }} />
                    <span className="tr-bar-fill" style={{ width: `${Math.min(100, (x.sets / maxSets) * 100)}%` }} />
                  </span><b>{x.sets}</b></li>
              ))}
            </ul>
          ) : <p className="hl-muted hl-small">No sets in the last four weeks.</p>}
          <p className="hl-muted hl-small">Primary muscles count a full set, helpers half. The shaded band is 10–20 sets, a common range for growth.
            {" "}Push {stats.groups.push} · Pull {stats.groups.pull} · Legs {stats.groups.legs} · Core {stats.groups.core}.</p>
        </section>
        <section className="hl-card">
          <header><span>Body weight</span><small>{stats.weight.perWeekKg !== undefined ? `${stats.weight.perWeekKg > 0 ? "+" : ""}${fmtWeight(stats.weight.perWeekKg, unit)} a week` : "log it on the Overview"}</small></header>
          {weightPts.length >= 2
            ? <TimeChart points={weightPts.map(p => ({ date: p.date, value: toUnit(p.kg, unit) }))} compare={{ points: weightPts.map(p => ({ date: p.date, value: toUnit(p.avg, unit) })), label: "7-day avg" }}
                label="Weight" format={v => `${v.toFixed(1)} ${unit}`} goal={api.goalWeightKg ? { value: toUnit(api.goalWeightKg, unit), label: "goal" } : undefined} />
            : <div className="hl-chart-empty">Log your weight on two or more days to see a trend.</div>}
          {stats.weight.goalDate && <p className="hl-muted hl-small">At this rate you reach your goal around {shortDate(stats.weight.goalDate)}.</p>}
        </section>
      </div>

      <section className="hl-card">
        <header><span>Training days</span><small>last 16 weeks</small></header>
        <div style={{ display: "flex", gap: 8 }}>
          <div className="tr-heat" aria-hidden="true" style={{ gridTemplateColumns: "auto" }}>{[1, 2, 3, 4, 5, 6, 0].map(d => <small key={d} className="hl-heat-day" style={{ fontSize: 9, lineHeight: "12px" }}>{d % 2 ? WEEKDAYS[d][0] : ""}</small>)}</div>
          <div className="tr-heat" role="img" aria-label={`${cells.filter(d => trained.has(d)).length} training days in 16 weeks`}>
            {cells.map(d => <i key={d} title={`${shortDate(d)}${trained.has(d) ? ": trained" : ""}`} className={d > api.today ? "tr-heat-future" : trained.has(d) ? "tr-heat-on" : undefined} />)}
          </div>
        </div>
      </section>

      <button type="button" className="ws-button ws-secondary" style={{ alignSelf: "flex-start" }}
        onClick={() => api.onAsk(`Look at my training with training_summary${current ? `, especially ${current.name}` : ""}. Find the real trends: what is improving, what has stalled and why it might have, whether my volume and muscle balance make sense, and how sleep or body weight relate. Then give me three specific changes for the next four weeks.`)}>
        <Sparkles size={14} />Ask Iris to analyze my progress
      </button>
    </div>
  );
}

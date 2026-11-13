import { useMemo, useState } from "react";
import { ArrowRight, BatteryLow, CalendarDays, Clock, Lightbulb, Tag, TrendingUp, Trophy } from "lucide-react";
import type { HealthDay } from "../../types";
import { hm } from "../../utils/healthMetrics";
import { clock, dur, formatValue, type DeepHealth, type Insight, type Pattern, type SleepNight, type ValueKind } from "../../utils/healthInsights";
import { ScoreRing, TimeChart } from "./HealthCharts";

const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const sleepTone = (score: number) => score >= 85 ? "good" : score >= 70 ? "neutral" : score >= 50 ? "warn" : "bad";

// ---- Sleep score card (Today) ----
export function SleepScoreCard({ night, usual, onOpen }: { night?: SleepNight; usual?: number; onOpen: () => void }) {
  if (!night) return (
    <section className="hl-card">
      <header><span>Sleep score</span></header>
      <p className="hl-muted hl-pad">No sleep recorded for this night.</p>
    </section>
  );
  const top = [...night.components].sort((a, b) => b.weight - a.weight).slice(0, 4);
  return (
    <section className="hl-card hl-sleep-card">
      <header><span>Sleep score</span><small>{dayLabel(night.date)}</small></header>
      <div className="hl-sleep-head">
        <ScoreRing score={night.score} tone={sleepTone(night.score)} size={96} />
        <div>
          <strong className="hl-label">{night.label}</strong>
          <p className="hl-muted hl-small">{hm(night.sleepMin)} slept · needed {hm(night.need.totalMin)}{usual !== undefined ? ` · usual score ${Math.round(usual)}` : ""}</p>
        </div>
      </div>
      <ul className="hl-parts hl-parts-compact">
        {top.map(c => <PartBar key={c.key} label={c.label} score={c.score} />)}
      </ul>
      <footer><button className="ws-button ws-secondary" onClick={onOpen}>Full night breakdown<ArrowRight size={14} /></button></footer>
    </section>
  );
}

function PartBar({ label, score, detail }: { label: string; score: number; detail?: string }) {
  return (
    <li className="hl-part">
      <div className="hl-part-top"><span>{label}</span><b>{score}</b></div>
      <div className="hl-part-track"><span className={`hl-tone-${sleepTone(score)}`} style={{ width: `${Math.max(3, score)}%` }} /></div>
      {detail && <small>{detail}</small>}
    </li>
  );
}

// ---- Insight list ----
const KIND_ICON = { pattern: Lightbulb, timing: Clock, rhythm: CalendarDays, trend: TrendingUp, debt: BatteryLow, record: Trophy, tag: Tag } as const;

export function InsightList({ insights, patterns, limit, onMore }: { insights: Insight[]; patterns: Pattern[]; limit?: number; onMore?: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = limit ? insights.slice(0, limit) : insights;
  if (!shown.length) return null;
  return (
    <section className="hl-card">
      <header><span>What stands out</span>{onMore && insights.length > shown.length && <button className="ws-button ws-secondary" onClick={onMore}>All {insights.length} insights<ArrowRight size={14} /></button>}</header>
      <ul className="hl-insights">
        {shown.map(i => {
          const Icon = KIND_ICON[i.kind];
          const pattern = i.patternId ? patterns.find(p => p.id === i.patternId) : undefined;
          return (
            <li key={i.id} className={`hl-insight hl-insight-${i.tone}`}>
              <span className="hl-insight-icon" aria-hidden="true"><Icon size={16} /></span>
              <div>
                <strong>{i.title}</strong>
                <p>{i.body}</p>
                {pattern && (
                  <>
                    <button className="hl-link" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? "Hide chart" : "Show the data"}</button>
                    {open === i.id && <Scatter pattern={pattern} />}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="hl-muted hl-small">Patterns in your own data, not proof of cause and not medical advice.</p>
    </section>
  );
}

// ---- Scatter with trend line ----
export function Scatter({ pattern, height = 190 }: { pattern: Pattern; height?: number }) {
  const W = 420, H = height, L = 46, R = 10, T = 10, B = 30;
  const xs = pattern.points.map(p => p.x), ys = pattern.points.map(p => p.y);
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs)), [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
  const sx = (v: number) => L + (W - L - R) * (v - x0) / (x1 - x0), sy = (v: number) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / Math.max(1e-9, xs.reduce((a, x) => a + (x - mx) ** 2, 0));
  const line = (v: number) => my + slope * (v - mx);
  const fx = (v: number) => tick(pattern.x.kind, v), fy = (v: number) => tick(pattern.y.kind, v);
  const [hover, setHover] = useState<number | null>(null);
  const hp = hover !== null ? pattern.points[hover] : undefined;
  return (
    <figure className="hl-scatter">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${pattern.y.label} against ${pattern.x.label}`} onMouseLeave={() => setHover(null)}>
        {[y0, (y0 + y1) / 2, y1].map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} className="hl-grid" /><text x={L - 6} y={sy(t) + 4} textAnchor="end" className="hl-axis">{fy(t)}</text></g>)}
        {[x0, (x0 + x1) / 2, x1].map((t, i) => <text key={i} x={sx(t)} y={H - 12} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} className="hl-axis">{fx(t)}</text>)}
        <line x1={sx(x0)} x2={sx(x1)} y1={sy(clampTo(line(x0), y0, y1))} y2={sy(clampTo(line(x1), y0, y1))} className="hl-fit" />
        {pattern.points.map((p, i) => <circle key={p.date} cx={sx(p.x)} cy={sy(p.y)} r={hover === i ? 5 : 3.2} className={`hl-pt${hover === i ? " hl-pt-on" : ""}`} onMouseEnter={() => setHover(i)} />)}
        <text x={W - R} y={H - 1} textAnchor="end" className="hl-axis hl-axis-title">{pattern.x.label} →</text>
      </svg>
      <figcaption className="hl-scatter-cap">
        {hp ? <span><b>{dayLabel(hp.date)}</b> · {pattern.x.label.toLowerCase()} {formatValue(pattern.x.kind, hp.x)} · {pattern.y.label.toLowerCase()} {formatValue(pattern.y.kind, hp.y)}</span>
          : <span>{pattern.y.label} (up) against {pattern.x.label.toLowerCase()}. {pattern.n} days, correlation {pattern.rho > 0 ? "+" : ""}{pattern.rho.toFixed(2)} ({pattern.strength}).</span>}
      </figcaption>
    </figure>
  );
}
const pad = (lo: number, hi: number): [number, number] => { const s = (hi - lo) || 1; return [lo - s * 0.06, hi + s * 0.06]; };
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const tick = (kind: ValueKind, v: number) => kind === "hm" ? `${(v / 60).toFixed(1)}h` : kind === "count" ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`) : kind === "clock" ? clock(v).replace(":00", "") : `${Math.round(v)}`;

// ---- Sleep view ----
export function SleepView({ deep, days }: { deep: DeepHealth; days: HealthDay[] }) {
  const n = deep.night;
  const [range, setRange] = useState<14 | 30 | 60>(30);
  const recentNights = useMemo(() => {
    const from = shift(deep.date, -range + 1);
    return deep.nights.filter(x => x.date >= from);
  }, [deep, range]);
  return (
    <div className="hl-trends">
      <div className="hl-grid2 hl-sleep-top">
        <section className="hl-card">
          <header><span>Sleep score</span><small>{dayLabel(deep.date)}</small></header>
          {n ? (
            <>
              <div className="hl-sleep-head">
                <ScoreRing score={n.score} tone={sleepTone(n.score)} />
                <div>
                  <strong className="hl-label">{n.label}</strong>
                  {n.bedtime !== undefined && n.wake !== undefined && <p className="hl-muted hl-small">Asleep {clock(n.bedtime)} → awake {clock(n.wake)}{n.efficiency !== undefined ? ` · ${Math.round(n.efficiency * 100)}% efficient` : ""}</p>}
                  {n.topFix && <p className="hl-fix">{n.topFix}</p>}
                </div>
              </div>
              <ul className="hl-parts">
                {n.components.map(c => <PartBar key={c.key} label={`${c.label} · ${Math.round(c.weight * 100)}%`} score={c.score} detail={c.detail} />)}
              </ul>
            </>
          ) : <p className="hl-muted hl-pad">No sleep recorded for this night. Pick another day above.</p>}
        </section>
        <div className="hl-stack">
          {n && <NeedCard night={n} />}
          {n?.stages && <StagesCard night={n} usual={deep.usual} />}
          <RhythmFacts deep={deep} />
        </div>
      </div>

      <section className="hl-card">
        <header>
          <span>Sleep window</span>
          <div className="hl-range" role="group" aria-label="Nights shown">
            {([14, 30, 60] as const).map(r => <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>{r} nights</button>)}
          </div>
        </header>
        <SleepWindow nights={recentNights} from={shift(deep.date, -range + 1)} to={deep.date} usual={deep.usual} selected={deep.date} />
        <p className="hl-muted hl-small">Each bar runs from falling asleep to waking, colored by that night's score. Dashed lines are your usual times. Short, even bars at the same height are the goal.</p>
      </section>

      <div className="hl-grid2">
        <section className="hl-card"><header><span>Sleep score</span><small>dashed: your usual</small></header>
          <TimeChart kind="bar" points={fill(deep, range, x => deep.nights.find(n => n.date === x)?.score)} label="Sleep score" format={v => `${Math.round(v)}`} domain={[0, 100]}
            goal={deep.usual.sleepScore !== undefined ? { value: deep.usual.sleepScore, label: "usual" } : undefined} /></section>
        <section className="hl-card"><header><span>Sleep against need</span><small>muted: what you needed</small></header>
          <TimeChart points={fill(deep, range, x => days.find(d => d.date === x)?.metrics.sleepMin)} label="Slept" compare={{ points: fill(deep, range, x => deep.nights.find(n => n.date === x)?.need.totalMin), label: "Needed" }}
            format={v => `${(v / 60).toFixed(1)}h`} /></section>
      </div>
      <WeekdayCard deep={deep} />
    </div>
  );
}

const shift = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const fill = (deep: DeepHealth, range: number, value: (date: string) => number | undefined) =>
  Array.from({ length: range }, (_, i) => { const date = shift(deep.date, i - range + 1); return { date, value: value(date) }; });

function NeedCard({ night }: { night: SleepNight }) {
  const { goalMin, debtMin, trainingMin, totalMin } = night.need;
  const parts = [{ label: "Your goal", min: goalMin, cls: "goal" }, { label: "Paying back debt", min: debtMin, cls: "debt" }, { label: "After training", min: trainingMin, cls: "train" }].filter(p => p.min > 0);
  return (
    <section className="hl-card">
      <header><span>What you needed</span><b className="hl-num">{hm(totalMin)}</b></header>
      <div className="hl-stackbar" role="img" aria-label={parts.map(p => `${p.label} ${hm(p.min)}`).join(", ")}>
        {parts.map(p => <span key={p.cls} className={`hl-need-${p.cls}`} style={{ flexGrow: p.min }} />)}
      </div>
      <ul className="hl-legend">{parts.map(p => <li key={p.cls}><i className={`hl-need-${p.cls}`} />{p.label} <b>{dur(p.min)}</b></li>)}</ul>
      <p className="hl-muted hl-small">Need goes up when you carry debt or trained hard the day before, so the same hours can score differently.</p>
    </section>
  );
}

const STAGES = [{ key: "deepMin", label: "Deep" }, { key: "coreMin", label: "Core" }, { key: "remMin", label: "REM" }, { key: "awakeMin", label: "Awake" }] as const;
function StagesCard({ night, usual }: { night: SleepNight; usual: DeepHealth["usual"] }) {
  const s = night.stages!;
  const total = STAGES.reduce((a, x) => a + s[x.key], 0) || 1;
  const usualTotal = STAGES.reduce((a, x) => a + (usual[x.key] || 0), 0);
  return (
    <section className="hl-card">
      <header><span>Stages</span><small>this night vs your usual</small></header>
      <div className="hl-stage-rows">
        <div><small>This night</small><div className="hl-stackbar">{STAGES.map(x => <span key={x.key} className={`hl-stage-${x.key}`} style={{ flexGrow: s[x.key] }} title={`${x.label} ${s[x.key]} min`} />)}</div></div>
        {usualTotal > 0 && <div><small>Usual</small><div className="hl-stackbar hl-stackbar-muted">{STAGES.map(x => <span key={x.key} className={`hl-stage-${x.key}`} style={{ flexGrow: usual[x.key] || 0 }} />)}</div></div>}
      </div>
      <ul className="hl-legend">
        {STAGES.map(x => {
          const u = usual[x.key];
          const diff = u !== undefined ? Math.round(s[x.key] - u) : undefined;
          return <li key={x.key}><i className={`hl-stage-${x.key}`} />{x.label} <b>{Math.round(s[x.key])} min</b> <small className="hl-muted">{Math.round(s[x.key] / total * 100)}%{diff !== undefined && Math.abs(diff) >= 3 ? `, ${diff > 0 ? "+" : ""}${diff} vs usual` : ""}</small></li>;
        })}
      </ul>
    </section>
  );
}

function RhythmFacts({ deep }: { deep: DeepHealth }) {
  const rows: Array<[string, string, string?]> = [];
  if (deep.usual.bedtime !== undefined && deep.usual.wake !== undefined) rows.push(["Usual window", `${clock(deep.usual.bedtime)} → ${clock(deep.usual.wake)}`]);
  if (deep.bestBedtime) rows.push(["Best bedtime", `${clock(deep.bestBedtime.from)}–${clock(deep.bestBedtime.to)}`, `recovery ${deep.bestBedtime.recovery} vs ${deep.bestBedtime.overall}`]);
  if (deep.jetlag) rows.push(["Weekend shift", `${deep.jetlag.minutes > 0 ? "+" : ""}${dur(Math.abs(deep.jetlag.minutes))}`, "social jetlag"]);
  if (deep.drift && Math.abs(deep.drift.minutes) >= 10) rows.push(["Bedtime drift", `${deep.drift.minutes > 0 ? "+" : ""}${deep.drift.minutes} min`, "last 2 weeks vs before"]);
  if (deep.debt) rows.push(["Sleep debt", dur(deep.debt.min), `~${deep.debt.nightsToClear} nights to clear`]);
  if (!rows.length) return null;
  return (
    <section className="hl-card">
      <header><span>Rhythm</span><Clock size={16} /></header>
      <dl className="hl-facts">{rows.map(([k, v, note]) => <div key={k}><dt>{k}{note && <small className="hl-muted"> · {note}</small>}</dt><dd>{v}</dd></div>)}</dl>
    </section>
  );
}

function SleepWindow({ nights, from, to, usual, selected }: { nights: SleepNight[]; from: string; to: string; usual: DeepHealth["usual"]; selected: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const dates: string[] = [];
  for (let d = from; d <= to; d = shift(d, 1)) dates.push(d);
  const byDate = new Map(nights.map(n => [n.date, n]));
  const timed = nights.filter(n => n.bedtime !== undefined && n.wake !== undefined);
  if (timed.length < 2) return <div className="hl-chart-empty">Needs bedtimes and wake times from your watch.</div>;
  const W = 640, H = 210, L = 52, R = 10, T = 8, B = 22;
  const lo = Math.floor((Math.min(...timed.map(n => n.bedtime!)) - 30) / 60) * 60, hi = Math.ceil((Math.max(...timed.map(n => n.wake! + 1440)) + 30) / 60) * 60;
  const step = (W - L - R) / dates.length;
  const y = (m: number) => T + (H - T - B) * (m - lo) / (hi - lo);
  const ticks: number[] = []; for (let m = lo; m <= hi; m += 120) ticks.push(m);
  const h = hover ? byDate.get(hover) : undefined;
  const every = Math.ceil(dates.length / 6);
  return (
    <figure className="hl-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sleep window by night">
        {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="hl-grid" /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="hl-axis">{clock(t).replace(":00", "")}</text></g>)}
        {usual.bedtime !== undefined && <line x1={L} x2={W - R} y1={y(usual.bedtime)} y2={y(usual.bedtime)} className="hl-goal" />}
        {usual.wake !== undefined && <line x1={L} x2={W - R} y1={y(usual.wake + 1440)} y2={y(usual.wake + 1440)} className="hl-goal" />}
        {dates.map((d, i) => {
          const n = byDate.get(d);
          const x = L + step * i;
          return (
            <g key={d} onMouseEnter={() => setHover(d)}>
              <rect x={x} y={0} width={step} height={H} fill="transparent" />
              {n?.bedtime !== undefined && n.wake !== undefined && (
                <rect x={x + Math.max(1, step * 0.18)} width={Math.max(2, step * 0.64)} y={y(n.bedtime)} height={Math.max(2, y(n.wake + 1440) - y(n.bedtime))} rx={Math.min(4, step * 0.3)}
                  className={`hl-win hl-tone-${sleepTone(n.score)}${d === selected ? " hl-win-sel" : ""}${hover === d ? " hl-active" : ""}`} />
              )}
              {i % every === 0 && <text x={x + step / 2} y={H - 6} textAnchor="middle" className="hl-axis">{shortDate(d)}</text>}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="hl-tip" style={{ left: `${((L + step * (dates.indexOf(hover) + 0.5)) / W) * 100}%` }}>
          <strong>{dayLabel(hover)}</strong>
          {h?.bedtime !== undefined && h.wake !== undefined ? <><span>{clock(h.bedtime)} → {clock(h.wake)}</span><span>Score {h.score} · {hm(h.sleepMin)}</span></> : <span>No sleep times</span>}
        </div>
      )}
    </figure>
  );
}

function WeekdayCard({ deep }: { deep: DeepHealth }) {
  const [metric, setMetric] = useState<"sleepScore" | "sleepMin" | "recovery" | "steps">("sleepScore");
  // Nights start Sunday evening for a Monday-first week.
  const order = [1, 2, 3, 4, 5, 6, 0].map(i => deep.weekdays[i]).filter(Boolean);
  const vals = order.map(w => w[metric]).filter((v): v is number => v !== undefined);
  if (vals.length < 4) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals), top = metric === "sleepScore" || metric === "recovery" ? 100 : hi;
  const fmt = (v: number) => metric === "sleepMin" ? hm(v) : metric === "steps" ? Math.round(v).toLocaleString() : `${Math.round(v)}`;
  const opts = [["sleepScore", "Sleep score"], ["sleepMin", "Sleep"], ["recovery", "Recovery"], ["steps", "Steps"]] as const;
  const nightMetric = metric === "sleepScore" || metric === "sleepMin";
  return (
    <section className="hl-card">
      <header>
        <span>Your week</span>
        <div className="hl-range" role="group" aria-label="Weekday metric">{opts.map(([k, l]) => <button key={k} aria-pressed={metric === k} onClick={() => setMetric(k)}>{l}</button>)}</div>
      </header>
      <ul className="hl-week">
        {order.map(w => {
          const v = w[metric];
          const width = v === undefined ? 0 : 100 * v / top;
          return (
            <li key={w.weekday} className={v === undefined || hi === lo ? undefined : v === hi ? "hl-week-best" : v === lo ? "hl-week-worst" : undefined}>
              <span>{nightMetric ? `${w.night.slice(0, 3)} night` : w.day.slice(0, 3)}</span>
              <div className="hl-week-track"><span style={{ width: `${width}%` }} /></div>
              <b>{v === undefined ? "—" : fmt(v)}</b>
            </li>
          );
        })}
      </ul>
      <p className="hl-muted hl-small">{nightMetric ? "Nights are named by the evening they start." : "Recovery is measured each morning."} Highlighted: your best and weakest.</p>
    </section>
  );
}

// ---- Insights view ----
type HeatMetric = "sleepScore" | "recovery" | "steps" | "hrv" | "sleepMin";
export function InsightsView({ deep, days }: { deep: DeepHealth; days: HealthDay[] }) {
  return (
    <div className="hl-trends">
      <InsightList insights={deep.insights} patterns={deep.patterns} />
      {deep.patterns.length > 0 && (
        <section className="hl-card">
          <header><span>What moves what</span><small>found in your last {Math.min(180, deep.mornings.length)} days</small></header>
          <div className="hl-pattern-grid">
            {deep.patterns.map(p => (
              <article key={p.id} className={`hl-pattern hl-insight-${p.helps ? "good" : "bad"}`}>
                <strong>{p.title}</strong>
                <p>{p.body}</p>
                <Scatter pattern={p} height={170} />
              </article>
            ))}
          </div>
        </section>
      )}
      {!deep.patterns.length && (
        <section className="hl-card"><header><span>What moves what</span></header>
          <p className="hl-muted hl-pad">Patterns show up after about two weeks of data with sleep, daylight, steps and workouts. Keep syncing and tag unusual days to find what affects you.</p></section>
      )}
      <Heatmap deep={deep} days={days} />
      {deep.records.length > 0 && (
        <section className="hl-card">
          <header><span>Personal records</span><Trophy size={16} /></header>
          <div className="hl-records">
            {deep.records.map(r => <div key={r.key} className="ws-stat"><div><span>{r.label}</span></div><strong>{r.value}</strong><small>{dayLabel(r.date)}</small></div>)}
          </div>
        </section>
      )}
    </div>
  );
}

function Heatmap({ deep, days }: { deep: DeepHealth; days: HealthDay[] }) {
  const [metric, setMetric] = useState<HeatMetric>("sleepScore");
  const [hover, setHover] = useState<{ date: string; value?: number } | null>(null);
  const first = days[0]?.date || deep.date;
  const span = Math.round((Date.parse(`${deep.date}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / 86400000);
  const weeks = Math.max(8, Math.min(26, Math.ceil((span + 1) / 7) + 1));
  const byDate = useMemo(() => new Map(days.map(d => [d.date, d])), [days]);
  const morning = useMemo(() => new Map(deep.mornings.map(m => [m.date, m])), [deep]);
  const value = (date: string) => metric === "sleepScore" || metric === "recovery" ? morning.get(date)?.[metric] : byDate.get(date)?.metrics[metric];
  // Columns are weeks (Monday first), the last column holds the selected day.
  const end = deep.date, endDow = (new Date(`${end}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = shift(end, -(weeks - 1) * 7 - endDow);
  const cells: Array<{ date: string; value?: number; col: number; row: number }> = [];
  for (let i = 0; i < weeks * 7; i++) { const date = shift(start, i); if (date > end) break; cells.push({ date, value: value(date), col: Math.floor(i / 7), row: i % 7 }); }
  const vals = cells.map(c => c.value).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
  if (vals.length < 7) return null;
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  const cuts = [q(0.2), q(0.4), q(0.6), q(0.8)];
  const level = (v: number) => cuts.filter(c => v >= c).length;
  const fmt = (v: number) => metric === "sleepMin" ? hm(v) : metric === "steps" ? Math.round(v).toLocaleString() : metric === "hrv" ? `${Math.round(v)} ms` : `${Math.round(v)}`;
  const opts: Array<[HeatMetric, string]> = [["sleepScore", "Sleep score"], ["recovery", "Recovery"], ["sleepMin", "Sleep"], ["hrv", "HRV"], ["steps", "Steps"]];
  const months = cells.filter(c => c.row === 0 && c.date.slice(8) <= "07").map(c => ({ col: c.col, label: new Date(`${c.date}T12:00:00`).toLocaleDateString(undefined, { month: "short" }) }));
  return (
    <section className="hl-card">
      <header>
        <span>{weeks >= 26 ? "Six months at a glance" : `${weeks} weeks at a glance`}</span>
        <div className="hl-range" role="group" aria-label="Heatmap metric">{opts.map(([k, l]) => <button key={k} aria-pressed={metric === k} onClick={() => setMetric(k)}>{l}</button>)}</div>
      </header>
      <div className="hl-heat-wrap">
        <div className="hl-heat" style={{ gridTemplateColumns: `28px repeat(${weeks}, minmax(10px, 20px))` }}>
          <span />{Array.from({ length: weeks }, (_, c) => <span key={c} className="hl-heat-month">{months.find(m => m.col === c)?.label || ""}</span>)}
          {["Mon", "", "Wed", "", "Fri", "", "Sun"].map((d, r) => (
            <HeatRow key={r} label={d} row={r} cells={cells} weeks={weeks} level={level} onHover={setHover} />
          ))}
        </div>
      </div>
      <div className="hl-heat-foot">
        <span className="hl-muted hl-small">{hover ? `${dayLabel(hover.date)}: ${hover.value !== undefined ? fmt(hover.value) : "no data"}` : "Hover a day. Shades are fifths of your own range."}</span>
        <span className="hl-heat-scale">Lower {[0, 1, 2, 3, 4].map(l => <i key={l} className={`hl-heat-l${l}`} />)} Higher</span>
      </div>
    </section>
  );
}

function HeatRow({ label, row, cells, weeks, level, onHover }: { label: string; row: number; cells: Array<{ date: string; value?: number; col: number; row: number }>; weeks: number; level: (v: number) => number; onHover: (c: { date: string; value?: number } | null) => void }) {
  const mine = new Map(cells.filter(c => c.row === row).map(c => [c.col, c]));
  return (
    <>
      <span className="hl-heat-day">{label}</span>
      {Array.from({ length: weeks }, (_, col) => {
        const c = mine.get(col);
        if (!c) return <span key={col} />;
        return <span key={col} className={`hl-heat-cell ${c.value === undefined ? "hl-heat-none" : `hl-heat-l${level(c.value)}`}`} onMouseEnter={() => onHover(c)} onMouseLeave={() => onHover(null)} aria-label={c.date} />;
      })}
    </>
  );
}

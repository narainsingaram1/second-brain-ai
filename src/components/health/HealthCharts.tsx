import { useId, useState } from "react";
import type { BodyWeightPoint } from "../../utils/bodyProgress";
import { daysBetween, fmtWeight, toUnit, type WeightUnit } from "../../utils/training";

export interface ChartPoint { date: string; value?: number }
interface Props {
  points: ChartPoint[];
  label: string;
  format: (value: number) => string;
  kind?: "line" | "bar";
  /** A personal-normal band (e.g. baseline ± 1 SD), drawn behind the data. */
  band?: { low: number; high: number; label: string };
  /** A target line (e.g. sleep goal). */
  goal?: { value: number; label: string };
  /** A second series drawn as a muted line, labeled directly. */
  compare?: { points: ChartPoint[]; label: string };
  height?: number;
  domain?: [number, number];
}

const W = 640, PAD_L = 40, PAD_R = 12, PAD_T = 12, PAD_B = 22;
const short = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** One series over time with a hover tooltip. Gaps stay gaps: missing days are not interpolated. */
export function TimeChart({ points, label, format, kind = "line", band, goal, compare, height = 170, domain }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const H = height;
  const values = [...points, ...(compare?.points || [])].map(p => p.value).filter((v): v is number => v !== undefined);
  if (values.length < 2) return <div className="hl-chart-empty">Not enough {label.toLowerCase()} data yet.</div>;
  let lo = domain?.[0] ?? Math.min(...values, band?.low ?? Infinity, goal?.value ?? Infinity);
  let hi = domain?.[1] ?? Math.max(...values, band?.high ?? -Infinity, goal?.value ?? -Infinity);
  if (kind === "bar" && !domain) lo = 0;
  if (hi === lo) { hi += 1; lo -= 1; }
  const padSpan = (hi - lo) * 0.08;
  if (!domain) { hi += padSpan; if (kind !== "bar") lo -= padSpan; }
  const n = points.length;
  const step = (W - PAD_L - PAD_R) / Math.max(1, n);
  const x = (i: number) => PAD_L + step * i + step / 2;
  const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - (v - lo) / (hi - lo));
  const path = (pts: ChartPoint[]) => {
    let d = "", open = false;
    pts.forEach((p, i) => {
      if (p.value === undefined) { open = false; return; }
      d += `${open ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
      open = true;
    });
    return d;
  };
  const ticks = [lo, (lo + hi) / 2, hi];
  const labelEvery = Math.ceil(n / 6);
  const lastIdx = (pts: ChartPoint[]) => { for (let i = pts.length - 1; i >= 0; i--) if (pts[i].value !== undefined) return i; return -1; };
  const hp = hover !== null ? points[hover] : undefined;
  const hc = hover !== null ? compare?.points[hover] : undefined;
  const barW = Math.max(2, step - 2);

  return (
    <figure className="hl-chart" aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className="hl-sr">{label}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} className="hl-grid" />
            <text x={PAD_L - 6} y={y(t) + 4} textAnchor="end" className="hl-axis">{format(t)}</text>
          </g>
        ))}
        {band && <rect x={PAD_L} width={W - PAD_L - PAD_R} y={y(band.high)} height={Math.max(0, y(band.low) - y(band.high))} className="hl-band"><title>{band.label}</title></rect>}
        {kind === "bar"
          ? points.map((p, i) => p.value === undefined ? null : (
              <rect key={i} x={x(i) - barW / 2} width={barW} y={y(p.value)} height={Math.max(1, y(lo) - y(p.value))} rx={Math.min(4, barW / 2)}
                className={`hl-bar${goal && p.value < goal.value ? " hl-bar-under" : ""}${hover === i ? " hl-active" : ""}`} />
            ))
          : <path d={path(points)} className="hl-line" />}
        {compare && <path d={path(compare.points)} className="hl-line hl-line-muted" />}
        {goal && (
          <g>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(goal.value)} y2={y(goal.value)} className="hl-goal" />
            <text x={W - PAD_R} y={y(goal.value) - 5} textAnchor="end" className="hl-axis">{goal.label}</text>
          </g>
        )}
        {kind === "line" && compare && (() => {
          const a = lastIdx(points), b = lastIdx(compare.points);
          return <>
            {a >= 0 && <text x={x(a) - 4} y={y(points[a].value!) - 8} textAnchor="end" className="hl-direct">{label}</text>}
            {b >= 0 && <text x={x(b) - 4} y={y(compare.points[b].value!) + 16} textAnchor="end" className="hl-direct hl-direct-muted">{compare.label}</text>}
          </>;
        })()}
        {points.map((p, i) => i % labelEvery === 0 && <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="hl-axis">{short(p.date)}</text>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={H - PAD_B} className="hl-cross" />}
        {hover !== null && kind === "line" && hp?.value !== undefined && <circle cx={x(hover)} cy={y(hp.value)} r={4.5} className="hl-dot" />}
        {hover !== null && hc?.value !== undefined && <circle cx={x(hover)} cy={y(hc.value)} r={4} className="hl-dot hl-dot-muted" />}
        {points.map((_, i) => <rect key={i} x={PAD_L + step * i} width={step} y={0} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />)}
      </svg>
      {hover !== null && (
        <div className="hl-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>{short(points[hover].date)}</strong>
          <span>{hp?.value !== undefined ? format(hp.value) : "No data"}</span>
          {compare && <span className="hl-tip-muted">{compare.label}: {hc?.value !== undefined ? format(hc.value) : "—"}</span>}
        </div>
      )}
    </figure>
  );
}

export function ScoreRing({ score, tone, size = 132 }: { score: number; tone: string; size?: number }) {
  const r = size / 2 - 9, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`hl-ring hl-tone-${tone}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} className="hl-ring-track" />
      <circle cx={size / 2} cy={size / 2} r={r} className="hl-ring-value" strokeDasharray={`${(c * score) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dy="0.35em" textAnchor="middle" className="hl-ring-text">{score}</text>
    </svg>
  );
}

const LONG_DATE = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtDeltaWeight = (deltaKg: number, unit: WeightUnit) => {
  const v = toUnit(deltaKg, unit);
  const rounded = Math.round(v * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} ${unit}`;
};

export interface BodyWeightChartProps {
  points: BodyWeightPoint[];
  unit: WeightUnit;
  showRaw: boolean;
  showAvg7: boolean;
  showAvg30: boolean;
  showGoal: boolean;
  showPhotos: boolean;
  goalKg?: number;
  onSelectDate?: (date: string, hasPhotos: boolean) => void;
  height?: number;
}

/**
 * Interactive body-weight progression chart spaced by true calendar time,
 * supporting raw weigh-ins, 7d/30d moving averages, goal line, and clickable photo pins.
 */
export function BodyWeightChart({
  points,
  unit,
  showRaw,
  showAvg7,
  showAvg30,
  showGoal,
  showPhotos,
  goalKg,
  onSelectDate,
  height = 240,
}: BodyWeightChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const CW = 680, CL = 52, CR = 16, CT = 26, CB = 28;
  const H = height;

  if (!points.length) {
    return <div className="hl-chart-empty">Log your first weigh-in above to start tracking your weight trend.</div>;
  }

  const values: number[] = [];
  for (const p of points) {
    if (showRaw || (!showAvg7 && !showAvg30)) values.push(p.kg);
    if (showAvg7) values.push(p.avg7);
    if (showAvg30) values.push(p.avg30);
  }
  if (showGoal && goalKg !== undefined) values.push(goalKg);

  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const minSpanKg = unit === "lb" ? 2.2 : 1.0;
  if (hi - lo < minSpanKg) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpanKg / 2;
    hi = mid + minSpanKg / 2;
  }
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;

  const firstDate = points[0].date;
  const lastDate = points[points.length - 1].date;
  const totalDays = Math.max(0, daysBetween(firstDate, lastDate));
  const plotW = CW - CL - CR;
  const xAt = (i: number) => {
    if (points.length === 1 || totalDays === 0) return CL + plotW / 2;
    return CL + (daysBetween(firstDate, points[i].date) / totalDays) * plotW;
  };
  const y = (kg: number) => CT + (H - CT - CB) * (1 - (kg - lo) / (hi - lo));
  const bottomY = H - CB;

  const buildPath = (pick: (p: BodyWeightPoint) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join("");

  const areaPath = (() => {
    if (points.length < 2) return "";
    const pick = showAvg7 ? (p: BodyWeightPoint) => p.avg7 : (p: BodyWeightPoint) => p.kg;
    return `${buildPath(pick)}L${xAt(points.length - 1).toFixed(1)},${bottomY.toFixed(1)}L${xAt(0).toFixed(1)},${bottomY.toFixed(1)}Z`;
  })();

  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => lo + (hi - lo) * f);
  const xLabelIndices: number[] = (() => {
    if (points.length <= 6) return points.map((_, i) => i);
    const desired = 5;
    const picked: number[] = [];
    let lastPx = -Infinity;
    for (let k = 0; k <= desired; k++) {
      const targetDay = (totalDays * k) / desired;
      let best = 0, bestD = Infinity;
      for (let i = 0; i < points.length; i++) {
        const d = Math.abs(daysBetween(firstDate, points[i].date) - targetDay);
        if (d < bestD) { best = i; bestD = d; }
      }
      const px = xAt(best);
      if (px - lastPx >= 52 || best === points.length - 1) {
        if (!picked.includes(best)) { picked.push(best); lastPx = px; }
      }
    }
    return picked;
  })();

  const hp = hover !== null ? points[hover] : undefined;
  const hitColumnBounds = (i: number) => {
    const left = i === 0 ? CL : (xAt(i - 1) + xAt(i)) / 2;
    const right = i === points.length - 1 ? CW - CR : (xAt(i) + xAt(i + 1)) / 2;
    return { left, width: Math.max(4, right - left) };
  };

  return (
    <figure className="hl-chart hl-wt-chart" aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className="hl-sr">Body weight trend chart</figcaption>
      <svg viewBox={`0 0 ${CW} ${H}`} role="img" aria-label="Body weight over time" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`${id}-grad`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={CL} x2={CW - CR} y1={y(t)} y2={y(t)} className="hl-grid" />
            <text x={CL - 6} y={y(t) + 4} textAnchor="end" className="hl-axis">{fmtWeight(t, unit, false)}</text>
          </g>
        ))}
        <text x={CL - 6} y={11} textAnchor="end" className="hl-axis hl-axis-unit">{unit}</text>
        {areaPath && <path d={areaPath} fill={`url(#${id}-grad)`} className="hl-wt-area" />}
        {showGoal && goalKg !== undefined && (
          <g>
            <line x1={CL} x2={CW - CR} y1={y(goalKg)} y2={y(goalKg)} className="hl-goal hl-wt-goal" />
            <text x={CW - CR} y={Math.max(CT + 10, y(goalKg) - 5)} textAnchor="end" className="hl-axis hl-wt-goal-lbl">
              Goal {fmtWeight(goalKg, unit)}
            </text>
          </g>
        )}
        {showAvg30 && points.length >= 2 && <path d={buildPath(p => p.avg30)} className="hl-wt-avg30" />}
        {showRaw && points.length >= 2 && <path d={buildPath(p => p.kg)} className="hl-wt-raw-line" />}
        {showAvg7 && points.length >= 2 && <path d={buildPath(p => p.avg7)} className="hl-wt-avg7" />}
        {showRaw && points.map((p, i) => (
          <circle
            key={p.date}
            cx={xAt(i)}
            cy={y(p.kg)}
            r={hover === i ? 4.5 : points.length > 60 ? 2 : 3}
            className={`hl-wt-raw-dot${hover === i ? " is-active" : ""}`}
          />
        ))}
        {showPhotos && points.map((p, i) => p.photoCount > 0 ? (
          <g key={`ph-${p.date}`} className="hl-wt-photo-pin">
            <line x1={xAt(i)} x2={xAt(i)} y1={y(p.kg)} y2={bottomY - 2} className="hl-wt-photo-stem" />
            <circle cx={xAt(i)} cy={bottomY - 6} r={4.5} className="hl-wt-photo-badge" />
            <circle cx={xAt(i)} cy={y(p.kg)} r={5.5} className="hl-wt-photo-ring" />
          </g>
        ) : null)}
        {xLabelIndices.map(i => (
          <text key={points[i].date} x={xAt(i)} y={H - 7} textAnchor="middle" className="hl-axis">{short(points[i].date)}</text>
        ))}
        {hover !== null && hp && (
          <g pointerEvents="none">
            <line x1={xAt(hover)} x2={xAt(hover)} y1={CT} y2={bottomY} className="hl-cross" />
            {showAvg30 && <circle cx={xAt(hover)} cy={y(hp.avg30)} r={3.5} className="hl-wt-dot-avg30" />}
            {showAvg7 && <circle cx={xAt(hover)} cy={y(hp.avg7)} r={4.5} className="hl-dot" />}
            <circle cx={xAt(hover)} cy={y(hp.kg)} r={4.5} className="hl-wt-raw-dot is-active" />
          </g>
        )}
        {points.map((p, i) => {
          const col = hitColumnBounds(i);
          return (
            <rect
              key={`hit-${p.date}`}
              x={col.left}
              width={col.width}
              y={0}
              height={H}
              fill="transparent"
              style={{ cursor: onSelectDate ? "pointer" : "default" }}
              onMouseEnter={() => setHover(i)}
              onTouchStart={() => setHover(i)}
              onClick={() => onSelectDate?.(p.date, p.photoCount > 0)}
            />
          );
        })}
      </svg>
      {hover !== null && hp && (
        <div
          className="hl-tip hl-tip-wide"
          style={{ left: `${Math.min(86, Math.max(14, (xAt(hover) / CW) * 100))}%` }}
        >
          <strong>{LONG_DATE(hp.date)}</strong>
          <span>Scale: {fmtWeight(hp.kg, unit)}{hp.deltaPrevKg !== undefined ? ` (${fmtDeltaWeight(hp.deltaPrevKg, unit)})` : ""}</span>
          {showAvg7 && <span className="hl-tip-muted">7d trend: {fmtWeight(hp.avg7, unit)}</span>}
          {showAvg30 && <span className="hl-tip-muted">30d avg: {fmtWeight(hp.avg30, unit)}</span>}
          {hp.bodyFatPct !== undefined && <span className="hl-tip-muted">Body fat: {hp.bodyFatPct.toFixed(1)}%</span>}
          {hp.photoCount > 0 && (
            <span className="hl-tip-photo">{hp.photoCount} progress photo{hp.photoCount === 1 ? "" : "s"} · click to view</span>
          )}
        </div>
      )}
    </figure>
  );
}

export interface WeightChangeBarItem {
  id: string;
  label: string;
  tooltipTitle: string;
  deltaKg: number;
  meta?: string;
}

/** Signed +/- bar chart around a zero baseline for weekly, cumulative, or daily weight shifts. */
export function WeightChangeBarChart({
  items,
  unit,
  label,
  preferLoss,
  height = 175,
}: {
  items: WeightChangeBarItem[];
  unit: WeightUnit;
  label: string;
  /** When true, negative deltas get positive styling (cutting). Undefined keeps directional teal/amber styling. */
  preferLoss?: boolean;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const CW = 640, CL = 52, CR = 14, CT = 14, CB = 26;
  const H = height;

  if (!items.length) {
    return <div className="hl-chart-empty">Not enough weigh-ins across intervals for {label.toLowerCase()} yet.</div>;
  }

  const maxAbs = Math.max(unit === "lb" ? 0.5 : 0.25, ...items.map(it => Math.abs(it.deltaKg)));
  const hi = maxAbs * 1.15;
  const lo = -hi;
  const plotW = CW - CL - CR;
  const step = plotW / Math.max(1, items.length);
  const x = (i: number) => CL + step * i + step / 2;
  const y = (v: number) => CT + (H - CT - CB) * (1 - (v - lo) / (hi - lo));
  const y0 = y(0);
  const barW = Math.max(4, Math.min(34, step - 4));
  const labelEvery = Math.ceil(items.length / 7);
  const hiItem = hover !== null ? items[hover] : undefined;

  const toneClass = (deltaKg: number) => {
    if (Math.abs(deltaKg) < 0.03) return "is-flat";
    if (preferLoss === undefined) return deltaKg < 0 ? "is-down" : "is-up";
    const good = preferLoss ? deltaKg < 0 : deltaKg > 0;
    return good ? "is-good" : "is-warn";
  };

  return (
    <figure className="hl-chart" aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className="hl-sr">{label}</figcaption>
      <svg viewBox={`0 0 ${CW} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {[lo, 0, hi].map((t, i) => (
          <g key={i}>
            <line x1={CL} x2={CW - CR} y1={y(t)} y2={y(t)} className={t === 0 ? "hl-zero-line" : "hl-grid"} />
            <text x={CL - 6} y={y(t) + 4} textAnchor="end" className="hl-axis">
              {t === 0 ? "0" : fmtDeltaWeight(t, unit).replace(` ${unit}`, "")}
            </text>
          </g>
        ))}
        {items.map((it, i) => {
          const top = it.deltaKg >= 0 ? y(it.deltaKg) : y0;
          const barH = Math.max(2, Math.abs(y(it.deltaKg) - y0));
          return (
            <rect
              key={it.id}
              x={x(i) - barW / 2}
              width={barW}
              y={top}
              height={barH}
              rx={Math.min(4, barW / 2)}
              className={`hl-chg-bar ${toneClass(it.deltaKg)}${hover === i ? " hl-active" : ""}`}
            />
          );
        })}
        {items.map((it, i) => i % labelEvery === 0 && (
          <text key={it.id} x={x(i)} y={H - 7} textAnchor="middle" className="hl-axis">{it.label}</text>
        ))}
        {items.map((it, i) => (
          <rect
            key={`hit-${it.id}`}
            x={CL + step * i}
            width={step}
            y={0}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onTouchStart={() => setHover(i)}
          />
        ))}
      </svg>
      {hover !== null && hiItem && (
        <div className="hl-tip" style={{ left: `${Math.min(86, Math.max(14, (x(hover) / CW) * 100))}%` }}>
          <strong>{hiItem.tooltipTitle}</strong>
          <span>{fmtDeltaWeight(hiItem.deltaKg, unit)}</span>
          {hiItem.meta && <span className="hl-tip-muted">{hiItem.meta}</span>}
        </div>
      )}
    </figure>
  );
}

import { useId, useState } from "react";

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

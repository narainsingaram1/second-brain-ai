import { useMemo, useRef, useState } from "react";
import { MessageCircle, Plus, Settings2, Sparkles, Trash2, X } from "lucide-react";
import type { BrainState, Course } from "../../types";
import { getLocalDateString } from "../../utils/habitStreaks";
import { courseLabel, studyOf, upsert, withStudy } from "../../utils/study";
import {
  applyCategories, CourseGrading, DEFAULT_SCALE, formatPercent, GradeItem, GradeScaleStep, gradeInsights, gradeTrend,
  isGraded, letterFor, neededFor, neededOnItem, ParsedCategory, parseWeights, pct, scaleOf, summarize,
} from "../../utils/grades";
import { DialogBackdrop } from "../workspace/DialogBackdrop";

interface Props {
  state: BrainState;
  course: Course;
  onChange: (update: (prev: BrainState) => BrainState) => void;
  onAsk: (prompt: string) => void;
}

const PLUS_MINUS: GradeScaleStep[] = [
  { letter: "A", min: 93 }, { letter: "A-", min: 90 }, { letter: "B+", min: 87 }, { letter: "B", min: 83 }, { letter: "B-", min: 80 },
  { letter: "C+", min: 77 }, { letter: "C", min: 73 }, { letter: "C-", min: 70 }, { letter: "D", min: 60 }, { letter: "F", min: 0 },
];
const scaleText = (scale: GradeScaleStep[]) => scale.filter((s) => s.min > 0).map((s) => `${s.letter} ${s.min}`).join(", ");
function parseScale(text: string): GradeScaleStep[] | null {
  const steps = [...text.matchAll(/([A-Fa-f][+-]?)\s*[:=]?\s*(\d+(?:\.\d+)?)/g)].map((m) => ({ letter: m[1].toUpperCase(), min: Number(m[2]) }));
  if (!steps.length) return null;
  const sorted = steps.sort((a, b) => b.min - a.min);
  return sorted.some((s) => s.min === 0) ? sorted : [...sorted, { letter: "F", min: 0 }];
}

export function GradesPanel({ state, course, onChange, onAsk }: Props) {
  const grading = course.grading;
  const [editing, setEditing] = useState(false);
  const [whatIfMode, setWhatIfMode] = useState(false);
  const [whatIf, setWhatIf] = useState<Record<string, string>>({});

  const save = (update: (g: CourseGrading | undefined) => CourseGrading | undefined) =>
    onChange((prev) => withStudy(prev, (s) => {
      const current = s.courses.find((c) => c.id === course.id);
      if (!current) return {};
      const grading = update(current.grading);
      const { grading: _old, ...rest } = current;
      return { courses: upsert(s.courses, { ...rest, ...(grading ? { grading } : {}), updatedAt: new Date().toISOString() }) };
    }));

  const hasDocs = studyOf(state).documents.some((d) => d.courseId === course.id);
  const askToSetUp = () => onAsk(`Set up grade tracking for ${courseLabel(course)}. Read the syllabus in my course materials, find how the final grade is weighted (categories, weights, number of assignments, dropped scores, and the letter grade cutoffs), and save it with set_course_grading. Then tell me what you set up.`);

  if (!grading?.categories.length) {
    return (
      <>
        <section className="ws-panel ac-grade-empty">
          <div>
            <h3>Track your grade in {course.code || course.name}</h3>
            <p>Tell Iris how the class is weighted, then add scores as they come back. You'll see your current grade, what you need on what's left, and how you're trending.</p>
          </div>
          <div className="ac-actions">
            <button className="ws-button ws-primary" onClick={() => setEditing(true)}><Plus size={15} />Set up grading</button>
            {hasDocs && <button className="ws-button ws-secondary" onClick={askToSetUp}><Sparkles size={15} />Read it from my syllabus</button>}
          </div>
        </section>
        {editing && <GradingEditor grading={grading} onClose={() => setEditing(false)} onSave={(g) => { save(() => g); setEditing(false); }} />}
      </>
    );
  }

  const scale = scaleOf(grading);
  const hypothetical: CourseGrading = whatIfMode
    ? { ...grading, items: grading.items.map((i) => (!isGraded(i) && whatIf[i.id] !== undefined && whatIf[i.id] !== "" && Number.isFinite(Number(whatIf[i.id])) ? { ...i, score: Number(whatIf[i.id]) } : i)) }
    : grading;
  const actual = summarize(grading);
  const summary = summarize(hypothetical);
  const usingWhatIf = whatIfMode && Object.values(whatIf).some((v) => v !== "");
  const target = grading.target ?? scale.find((s) => s.min > 0)?.min ?? 90;
  const need = neededFor(summary, target);
  const insights = gradeInsights(grading, target);

  return (
    <div className="ac-grades">
      <section className="ws-panel ac-grade-summary" aria-label="Grade summary">
        <div className="ac-grade-hero">
          <span className="ac-grade-label">{usingWhatIf ? "With what-ifs" : "Current grade"}</span>
          <div className="ac-grade-figure">
            <strong>{formatPercent(summary.current)}</strong>
            <span className="ac-letter">{summary.letter}</span>
          </div>
          <span className="ac-grade-sub">{Math.round(summary.completed)}% of the course graded</span>
        </div>
        <dl className="ac-grade-stats">
          <div><dt>Projected final</dt><dd>{formatPercent(summary.projected)}<small>{summary.projected !== null ? letterFor(summary.projected, scale) : ""}</small></dd></div>
          <div><dt>Possible range</dt><dd>{summary.minPossible}–{summary.maxPossible}%</dd></div>
          <div>
            <dt>
              <label htmlFor={`target-${course.id}`}>Aiming for</label>
            </dt>
            <dd>
              <select id={`target-${course.id}`} className="ac-target" value={target} onChange={(e) => save((g) => g && { ...g, target: Number(e.target.value) })}>
                {scale.filter((s) => s.min > 0).map((s) => <option key={s.letter} value={s.min}>{s.letter} · {s.min}%</option>)}
              </select>
            </dd>
          </div>
          <div>
            <dt>Needed on the rest</dt>
            <dd className={need !== null && need > 100 ? "is-bad" : need !== null && need <= 0 ? "is-good" : ""}>
              {need === null ? "Done" : need <= 0 ? "Locked in" : need > 100 ? "Out of reach" : `${need}%`}
            </dd>
          </div>
        </dl>
      </section>

      <div className="ac-grade-grid">
        <section className="ws-panel ac-grade-trend">
          <div className="ac-panel-head">
            <h3>Trend</h3>
            <span className="meta">Running grade after each score</span>
          </div>
          <TrendChart grading={grading} scale={scale} />
        </section>
        <section className="ws-panel ac-grade-insights">
          <div className="ac-panel-head"><h3>What stands out</h3></div>
          {insights.length ? (
            <ul>{insights.map((i) => <li key={i.text} className={`is-${i.tone}`}>{i.text}</li>)}</ul>
          ) : <p className="ac-hint">Add a few scores to see what's helping and what's hurting.</p>}
          <button className="ws-button ws-secondary" onClick={() => onAsk(`Look at my grades in ${courseLabel(course)} and give me a plan: where I stand, what I need on the remaining work to get ${letterFor(target, scale)}, and what to focus on to get there.`)}>
            <MessageCircle size={15} />Ask Iris for a plan
          </button>
        </section>
      </div>

      <section className="ws-panel">
        <div className="ac-panel-head">
          <h3>Categories</h3>
          <button className="ws-button ws-secondary" onClick={() => setEditing(true)}><Settings2 size={15} />Edit weights</button>
        </div>
        {Math.round(actual.weightTotal) !== 100 && (
          <p className="ac-hint">Weights add up to {actual.weightTotal}%, so they're scaled to 100%.</p>
        )}
        <div className="ac-cat-table" role="table" aria-label="Grade categories">
          <div role="row" className="ac-cat-row is-head">
            <span role="columnheader">Category</span><span role="columnheader">Weight</span><span role="columnheader">Average</span><span role="columnheader">Graded</span>
          </div>
          {summary.categories.map((c) => (
            <div role="row" className="ac-cat-row" key={c.category.id}>
              <span role="cell">{c.category.name}{c.category.dropLowest ? <small> · lowest {c.category.dropLowest} dropped</small> : null}</span>
              <span role="cell" className="num">{Math.round(c.weight * 10) / 10}%</span>
              <span role="cell" className="ac-cat-avg">
                <span className="ac-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, c.average ?? 0)}%` }} /></span>
                <span className="num">{formatPercent(c.average)}</span>
              </span>
              <span role="cell" className="num">{c.graded.length}{c.category.count ? ` of ${c.category.count}` : c.upcoming.length ? ` of ${c.graded.length + c.upcoming.length}` : c.graded.length ? <abbr title="Total not set. Set how many in Edit weights, or add upcoming items."> of ?</abbr> : ""}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ws-panel">
        <div className="ac-panel-head">
          <h3>Scores</h3>
          <div className="ac-actions">
            {usingWhatIf && <button className="ws-button ws-secondary" onClick={() => setWhatIf({})}>Clear what-ifs</button>}
            <button className="ws-button ws-secondary" aria-pressed={whatIfMode} onClick={() => { setWhatIfMode(!whatIfMode); setWhatIf({}); }}>
              {whatIfMode ? "Done with what-ifs" : "What if…"}
            </button>
          </div>
        </div>
        {whatIfMode && <p className="ac-hint">Type hypothetical scores on upcoming work to see where you'd land. Nothing is saved.</p>}
        <AddScore grading={grading} onAdd={(item) => save((g) => g && { ...g, items: [...g.items, item] })} />
        {summary.categories.map((c) => {
          const items = grading.items.filter((i) => i.categoryId === c.category.id)
            .sort((a, b) => Number(isGraded(b)) - Number(isGraded(a)) || (a.date || "").localeCompare(b.date || ""));
          if (!items.length) return null;
          return (
            <div key={c.category.id} className="ac-score-group">
              <h4>{c.category.name}</h4>
              <ul>
                {items.map((item) => (
                  <ScoreRow
                    key={`${item.id}:${item.score ?? ""}`}
                    item={item}
                    dropped={c.droppedIds.has(item.id)}
                    needed={!isGraded(item) ? neededOnItem(actual, item, target) : null}
                    targetLetter={letterFor(target, scale)}
                    whatIfMode={whatIfMode}
                    whatIf={whatIf[item.id] ?? ""}
                    onWhatIf={(v) => setWhatIf((w) => ({ ...w, [item.id]: v }))}
                    onSave={(next) => save((g) => g && { ...g, items: g.items.map((i) => (i.id === item.id ? next : i)) })}
                    onDelete={() => save((g) => g && { ...g, items: g.items.filter((i) => i.id !== item.id) })}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {editing && (
        <GradingEditor
          grading={grading}
          onClose={() => setEditing(false)}
          onSave={(g) => { save(() => g); setEditing(false); }}
          onAskSyllabus={hasDocs ? () => { setEditing(false); askToSetUp(); } : undefined}
        />
      )}
    </div>
  );
}

function AddScore({ grading, onAdd }: { grading: CourseGrading; onAdd: (item: GradeItem) => void }) {
  const [categoryId, setCategoryId] = useState(grading.categories[0]?.id || "");
  const [title, setTitle] = useState("");
  const [score, setScore] = useState("");
  const [max, setMax] = useState("");
  const [date, setDate] = useState(getLocalDateString());
  const scoreRef = useRef<HTMLInputElement>(null);
  const category = grading.categories.find((c) => c.id === categoryId) || grading.categories[0];
  const inCategory = grading.items.filter((i) => i.categoryId === category?.id);
  const suggestedTitle = category ? `${category.name.replace(/s$/i, "")} ${inCategory.length + 1}` : "";
  const suggestedMax = inCategory[inCategory.length - 1]?.maxScore ?? 100;
  const scoreValue = score.trim() === "" ? undefined : Number(score);
  const maxValue = max.trim() === "" ? suggestedMax : Number(max);
  const valid = category && Number.isFinite(maxValue) && maxValue > 0 && (scoreValue === undefined || (Number.isFinite(scoreValue) && scoreValue >= 0));
  return (
    <form
      className="ac-add-score"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onAdd({ id: crypto.randomUUID(), categoryId: category.id, title: title.trim() || suggestedTitle, maxScore: maxValue,
          ...(scoreValue !== undefined ? { score: scoreValue } : {}), ...(date ? { date } : {}) });
        setTitle(""); setScore("");
        scoreRef.current?.focus(); // Ready for the next score.
      }}
    >
      <label>Category
        <select value={category?.id} onChange={(e) => setCategoryId(e.target.value)}>
          {grading.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="ac-add-title">Name<input value={title} placeholder={suggestedTitle} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Score<input ref={scoreRef} inputMode="decimal" value={score} placeholder="Upcoming" onChange={(e) => setScore(e.target.value)} /></label>
      <label>Out of<input inputMode="decimal" value={max} placeholder={String(suggestedMax)} onChange={(e) => setMax(e.target.value)} /></label>
      <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <button className="ws-button ws-primary" type="submit" disabled={!valid}><Plus size={15} />Add</button>
    </form>
  );
}

function ScoreRow({ item, dropped, needed, targetLetter, whatIfMode, whatIf, onWhatIf, onSave, onDelete }: {
  item: GradeItem; dropped: boolean; needed: number | null; targetLetter: string; whatIfMode: boolean; whatIf: string;
  onWhatIf: (v: string) => void; onSave: (item: GradeItem) => void; onDelete: () => void;
}) {
  const [score, setScore] = useState(isGraded(item) ? String(item.score) : "");
  const commit = () => {
    const value = score.trim() === "" ? undefined : Number(score);
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) return setScore(isGraded(item) ? String(item.score) : "");
    if (value === item.score) return;
    const { score: _s, ...rest } = item;
    onSave(value === undefined ? rest : { ...rest, score: value });
  };
  const graded = isGraded(item);
  const percent = graded ? Math.round(pct(item.score!, item.maxScore) * 10) / 10 : null;
  return (
    <li className={`ac-score-row${dropped ? " is-dropped" : ""}${graded ? "" : " is-upcoming"}`}>
      <div className="ac-score-name">
        <span>{item.title}</span>
        <small>
          {item.date ? new Date(`${item.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No date"}
          {dropped ? " · dropped" : ""}
          {!graded && needed !== null ? ` · ${needed <= 0 ? `${targetLetter} is safe regardless` : needed > 100 ? `${targetLetter} needs more than 100%` : `needs ${needed}% for ${targetLetter}`}` : ""}
        </small>
      </div>
      <div className="ac-score-entry">
        {whatIfMode && !graded ? (
          <input aria-label={`What-if score for ${item.title}`} className="is-whatif" inputMode="decimal" value={whatIf} placeholder="What if?" onChange={(e) => onWhatIf(e.target.value)} />
        ) : (
          <input
            aria-label={`Score for ${item.title}`}
            inputMode="decimal"
            value={score}
            placeholder="—"
            onChange={(e) => setScore(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }}
          />
        )}
        <span className="ac-score-max">/ {item.maxScore}</span>
        <span className="ac-score-pct num">{percent === null ? "" : `${percent}%`}</span>
        <button className="ws-icon-button" aria-label={`Delete ${item.title}`} onClick={onDelete}><Trash2 size={14} /></button>
      </div>
    </li>
  );
}

function TrendChart({ grading, scale }: { grading: CourseGrading; scale: GradeScaleStep[] }) {
  const points = useMemo(() => gradeTrend(grading), [grading]);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="ac-hint ac-trend-empty">The trend appears after two graded scores.</p>;
  const W = 560, H = 260, L = 40, R = 16, T = 12, B = 28;
  const values = points.flatMap((p) => [p.grade, p.score]);
  const lo = Math.max(0, Math.floor((Math.min(...values) - 5) / 10) * 10);
  const x = (i: number) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v: number) => T + ((100 - v) * (H - T - B)) / (100 - lo);
  const thresholds = scale.filter((s) => s.min > lo && s.min < 100);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.grade).toFixed(1)}`).join(" ");
  const active = hover !== null ? points[hover] : null;
  return (
    <div className="ac-trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Running grade went from ${points[0].grade}% to ${points[points.length - 1].grade}% over ${points.length} scores`} onMouseLeave={() => setHover(null)}>
        {thresholds.map((s) => (
          <g key={s.letter}>
            <line x1={L} x2={W - R} y1={y(s.min)} y2={y(s.min)} className="ac-trend-grid" />
            <text x={L - 8} y={y(s.min) + 4} textAnchor="end" className="ac-trend-axis">{s.letter}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(100)} y2={y(100)} className="ac-trend-grid" />
        <text x={L - 8} y={y(100) + 4} textAnchor="end" className="ac-trend-axis">100</text>
        {points.map((p, i) => <circle key={`s-${p.id}`} cx={x(i)} cy={y(p.score)} r={3} className="ac-trend-score" />)}
        <path d={line} className="ac-trend-line" />
        {points.map((p, i) => <circle key={p.id} cx={x(i)} cy={y(p.grade)} r={hover === i ? 5 : 4} className="ac-trend-point" />)}
        {active && <line x1={x(hover!)} x2={x(hover!)} y1={T} y2={H - B} className="ac-trend-cross" />}
        {points.map((p, i) => (
          <rect key={`h-${p.id}`} x={x(i) - (W - L - R) / (points.length - 1) / 2} y={0} width={(W - L - R) / (points.length - 1)} height={H} fill="transparent"
            onMouseEnter={() => setHover(i)} />
        ))}
        {[0, points.length - 1].map((i) => (
          <text key={`d-${i}`} x={x(i)} y={H - 8} textAnchor={i ? "end" : "start"} className="ac-trend-axis">
            {points[i].date ? new Date(`${points[i].date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : points[i].title}
          </text>
        ))}
      </svg>
      {active && (
        <div className="ac-trend-tip" style={{ left: `${(x(hover!) / W) * 100}%` }} role="status">
          <strong>{active.title}</strong>
          <span>Scored {active.score}%</span>
          <span>Grade after: {active.grade}% · {letterFor(active.grade, scale)}</span>
        </div>
      )}
      <div className="ac-trend-legend" aria-hidden="true">
        <span><i className="is-line" />Running grade</span>
        <span><i className="is-dot" />Individual score</span>
      </div>
    </div>
  );
}

function GradingEditor({ grading, onSave, onClose, onAskSyllabus }: {
  grading?: CourseGrading; onSave: (g: CourseGrading) => void; onClose: () => void; onAskSyllabus?: () => void;
}) {
  type Row = { key: string; name: string; weight: string; count: string; drop: string };
  const toRows = (cats: ParsedCategory[]): Row[] => cats.map((c) => ({ key: crypto.randomUUID(), name: c.name, weight: String(c.weight), count: c.count ? String(c.count) : "", drop: c.dropLowest ? String(c.dropLowest) : "" }));
  const [rows, setRows] = useState<Row[]>(grading?.categories.length
    ? toRows(grading.categories.map((c) => ({ name: c.name, weight: c.weight, count: c.count, dropLowest: c.dropLowest })))
    : [{ key: crypto.randomUUID(), name: "", weight: "", count: "", drop: "" }]);
  const [text, setText] = useState("");
  const [parseNote, setParseNote] = useState("");
  const [scale, setScale] = useState(scaleText(scaleOf(grading)));
  const total = rows.reduce((n, r) => n + (Number(r.weight) || 0), 0);
  const filled = rows.filter((r) => r.name.trim() && Number(r.weight) > 0);
  const parsedScale = parseScale(scale);
  const removedWithScores = (grading?.categories || []).filter((c) =>
    !filled.some((r) => r.name.trim().toLowerCase() === c.name.toLowerCase()) && grading!.items.some((i) => i.categoryId === c.id));
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <DialogBackdrop label="Grade weights" onClose={onClose} className="ws-overlay">
      <form
        className="ws-dialog ac-grading-editor"
        onSubmit={(e) => {
          e.preventDefault();
          if (!filled.length || !parsedScale) return;
          const parsed: ParsedCategory[] = filled.map((r) => ({
            name: r.name.trim().replace(/\s+/g, " "), weight: Number(r.weight),
            ...(Number(r.count) > 1 ? { count: Math.round(Number(r.count)) } : {}), ...(Number(r.drop) >= 1 ? { dropLowest: Math.round(Number(r.drop)) } : {}),
          }));
          const next = applyCategories(grading, parsed, () => crypto.randomUUID());
          onSave({ ...next, scale: parsedScale });
        }}
      >
        <div className="ws-dialog-heading">
          <div>
            <h2>How is this class graded?</h2>
            <p>Paste the grading section of your syllabus or type it out, then check the categories below.</p>
          </div>
          <button className="ws-icon-button" type="button" aria-label="Close" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="ws-form-body">
          <label>Describe the breakdown
            <textarea rows={3} value={text} placeholder="Exams 40%, homework 20% (10 assignments, lowest dropped), projects 30%, quizzes 10%" onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="ac-actions">
            <button type="button" className="ws-button ws-secondary" disabled={!text.trim()} onClick={() => {
              const parsed = parseWeights(text);
              if (!parsed.length) return setParseNote("Couldn't find any percentages. Try lines like \"Exams 40%\".");
              setRows(toRows(parsed));
              const sum = parsed.reduce((n, p) => n + p.weight, 0);
              setParseNote(`Found ${parsed.length} ${parsed.length === 1 ? "category" : "categories"} adding up to ${sum}%.`);
            }}>Fill in categories</button>
            {onAskSyllabus && <button type="button" className="ws-button ws-secondary" onClick={onAskSyllabus}><Sparkles size={15} />Have Iris read my syllabus</button>}
            {parseNote && <span className="ac-hint" role="status">{parseNote}</span>}
          </div>

          <div className="ac-weight-table" role="group" aria-label="Categories">
            <div className="ac-weight-row is-head" aria-hidden="true"><span>Category</span><span>Weight %</span><span>How many</span><span>Drop lowest</span><span /></div>
            {rows.map((r) => (
              <div className="ac-weight-row" key={r.key}>
                <input aria-label="Category name" value={r.name} placeholder="Exams" onChange={(e) => update(r.key, { name: e.target.value })} />
                <input aria-label={`${r.name || "Category"} weight percent`} inputMode="decimal" value={r.weight} placeholder="40" onChange={(e) => update(r.key, { weight: e.target.value })} />
                <input aria-label={`${r.name || "Category"} number of items`} inputMode="numeric" value={r.count} placeholder="Any" onChange={(e) => update(r.key, { count: e.target.value })} />
                <input aria-label={`${r.name || "Category"} lowest scores dropped`} inputMode="numeric" value={r.drop} placeholder="0" onChange={(e) => update(r.key, { drop: e.target.value })} />
                <button type="button" className="ws-icon-button" aria-label={`Remove ${r.name || "category"}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="ac-weight-foot">
              <button type="button" className="ws-button ws-secondary" onClick={() => setRows((rs) => [...rs, { key: crypto.randomUUID(), name: "", weight: "", count: "", drop: "" }])}><Plus size={15} />Add category</button>
              <span className={`num ${Math.round(total) === 100 ? "" : "is-warn"}`}>Total {Math.round(total * 10) / 10}%{Math.round(total) === 100 ? "" : " · will be scaled to 100%"}</span>
            </div>
          </div>
          <p className="ac-hint">"How many" lets ungraded work count as still ahead, e.g. 10 homeworks when only 3 are graded.</p>

          <label>Letter cutoffs
            <input value={scale} onChange={(e) => setScale(e.target.value)} aria-invalid={!parsedScale || undefined} />
          </label>
          <div className="ac-actions">
            <button type="button" className="ws-button ws-secondary" onClick={() => setScale(scaleText(DEFAULT_SCALE))}>A/B/C/D</button>
            <button type="button" className="ws-button ws-secondary" onClick={() => setScale(scaleText(PLUS_MINUS))}>Plus/minus</button>
          </div>
          {removedWithScores.length > 0 && (
            <p className="ac-error" role="alert">Removing {removedWithScores.map((c) => c.name).join(", ")} also removes the scores in {removedWithScores.length === 1 ? "it" : "them"}.</p>
          )}
        </div>
        <div className="ws-dialog-actions">
          <button type="button" className="ws-button ws-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="ws-button ws-primary" disabled={!filled.length || !parsedScale}>Save</button>
        </div>
      </form>
    </DialogBackdrop>
  );
}

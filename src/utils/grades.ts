/**
 * Course grade tracking: weighted categories, scores, letter scale, and the math behind
 * "what's my grade", "what do I need" and "how is it trending". Pure functions, shared by the UI and Iris.
 */

export interface GradeCategory {
  id: string;
  name: string;
  /** Share of the final grade, in percent. Weights are normalized if they don't sum to 100. */
  weight: number;
  /** How many items this category will have in total (e.g. 10 homeworks), so ungraded ones count as remaining. */
  count?: number;
  /** Lowest N scores dropped. */
  dropLowest?: number;
}

export interface GradeItem {
  id: string;
  categoryId: string;
  title: string;
  /** Points earned. Missing means the item is still upcoming. */
  score?: number;
  maxScore: number;
  date?: string; // YYYY-MM-DD
}

export interface GradeScaleStep { letter: string; min: number }

export interface CourseGrading {
  categories: GradeCategory[];
  items: GradeItem[];
  scale?: GradeScaleStep[];
  /** Target final percentage. */
  target?: number;
}

export const DEFAULT_SCALE: GradeScaleStep[] = [
  { letter: "A", min: 90 },
  { letter: "B", min: 80 },
  { letter: "C", min: 70 },
  { letter: "D", min: 60 },
  { letter: "F", min: 0 },
];

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const round1 = (n: number) => Math.round(n * 10) / 10;
export const pct = (score: number, max: number) => (max > 0 ? (score / max) * 100 : 0);
export const isGraded = (item: GradeItem) => finite(item.score);

/** Validates grading data from storage or sync; returns undefined when there is nothing usable. */
export function normalizeGrading(raw: unknown): CourseGrading | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, any>;
  const seen = new Set<string>();
  const categories: GradeCategory[] = (Array.isArray(r.categories) ? r.categories : [])
    .filter((c: any) => c && typeof c.id === "string" && !seen.has(c.id) && seen.add(c.id) && clean(c.name, 60) && finite(c.weight) && c.weight >= 0)
    .slice(0, 30)
    .map((c: any) => ({
      id: c.id, name: clean(c.name, 60), weight: Math.min(100, c.weight),
      ...(finite(c.count) && c.count >= 1 ? { count: Math.min(200, Math.round(c.count)) } : {}),
      ...(finite(c.dropLowest) && c.dropLowest >= 1 ? { dropLowest: Math.min(50, Math.round(c.dropLowest)) } : {}),
    }));
  const categoryIds = new Set(categories.map((c) => c.id));
  const itemIds = new Set<string>();
  const items: GradeItem[] = (Array.isArray(r.items) ? r.items : [])
    .filter((i: any) => i && typeof i.id === "string" && !itemIds.has(i.id) && itemIds.add(i.id) && categoryIds.has(i.categoryId) && finite(i.maxScore) && i.maxScore > 0)
    .slice(0, 500)
    .map((i: any) => ({
      id: i.id, categoryId: i.categoryId, title: clean(i.title, 120) || "Untitled", maxScore: i.maxScore,
      ...(finite(i.score) && i.score >= 0 ? { score: i.score } : {}),
      ...(typeof i.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(i.date) ? { date: i.date } : {}),
    }));
  const scale = Array.isArray(r.scale)
    ? r.scale.filter((s: any) => s && clean(s.letter, 4) && finite(s.min)).map((s: any) => ({ letter: clean(s.letter, 4), min: s.min })).sort((a: GradeScaleStep, b: GradeScaleStep) => b.min - a.min).slice(0, 15)
    : [];
  if (!categories.length && !items.length) return undefined;
  return { categories, items, ...(scale.length ? { scale } : {}), ...(finite(r.target) && r.target > 0 && r.target <= 100 ? { target: r.target } : {}) };
}

export const scaleOf = (g?: CourseGrading) => (g?.scale?.length ? g.scale : DEFAULT_SCALE);
export function letterFor(percent: number | null, scale: GradeScaleStep[] = DEFAULT_SCALE): string {
  if (percent === null) return "—";
  return [...scale].sort((a, b) => b.min - a.min).find((s) => percent >= s.min - 1e-9)?.letter ?? scale[scale.length - 1]?.letter ?? "—";
}

export interface CategoryResult {
  category: GradeCategory;
  /** Normalized weight, percent of the course (sums to 100 across categories). */
  weight: number;
  graded: GradeItem[];
  upcoming: GradeItem[];
  droppedIds: Set<string>;
  /** Average of kept graded items, 0-100, or null when nothing is graded. */
  average: number | null;
  /** Share of this category that is already graded, 0-1. */
  gradedFraction: number;
  /** Course percent points from this category that are locked in. */
  earned: number;
  /** Course percent points from this category still to be graded. */
  remaining: number;
  /** Course weight carried by one upcoming item, in percent points. */
  weightPerUpcoming: (item: GradeItem) => number;
}

export interface GradeSummary {
  categories: CategoryResult[];
  /** Weighted average of what has been graded so far. */
  current: number | null;
  letter: string;
  /** Percent points of the course already locked in. */
  earned: number;
  /** Percent of the course graded so far (0-100). */
  completed: number;
  /** Percent of the course still ahead. */
  remaining: number;
  /** Final grade if you keep performing at your current average. */
  projected: number | null;
  /** Best and worst finals still possible. */
  maxPossible: number;
  minPossible: number;
  /** Raw weights don't add up to 100 (they're normalized). */
  weightTotal: number;
}

export function summarize(grading: CourseGrading | undefined): GradeSummary {
  const scale = scaleOf(grading);
  const cats = grading?.categories || [];
  const items = grading?.items || [];
  const weightTotal = cats.reduce((n, c) => n + c.weight, 0);
  const categories: CategoryResult[] = cats.map((category) => {
    const weight = weightTotal > 0 ? (category.weight / weightTotal) * 100 : 0;
    const mine = items.filter((i) => i.categoryId === category.id);
    const graded = mine.filter(isGraded);
    const upcoming = mine.filter((i) => !isGraded(i));
    const drop = category.dropLowest || 0;
    // Drops apply only once there are more graded scores than drops, like most syllabi.
    const droppedIds = new Set(
      graded.length > drop ? [...graded].sort((a, b) => pct(a.score!, a.maxScore) - pct(b.score!, b.maxScore)).slice(0, drop).map((i) => i.id) : [],
    );
    const kept = graded.filter((i) => !droppedIds.has(i.id));
    const points = kept.reduce((n, i) => n + i.maxScore, 0);
    const average = kept.length ? (kept.reduce((n, i) => n + i.score!, 0) / points) * 100 : null;

    let gradedFraction: number;
    let weightPerUpcoming: (item: GradeItem) => number;
    if (category.count) {
      // Known number of items, assumed equal weight within the category.
      const slots = Math.max(1, category.count - drop);
      gradedFraction = Math.min(1, kept.length / slots);
      weightPerUpcoming = () => weight / slots;
    } else {
      const upcomingPoints = upcoming.reduce((n, i) => n + i.maxScore, 0);
      const total = points + upcomingPoints;
      gradedFraction = total > 0 ? points / total : 0;
      weightPerUpcoming = (item) => (total > 0 ? (weight * item.maxScore) / total : 0);
    }
    const earned = average === null ? 0 : (weight * gradedFraction * average) / 100;
    return { category, weight, graded, upcoming, droppedIds, average, gradedFraction, earned, remaining: weight * (1 - gradedFraction), weightPerUpcoming };
  });

  const completed = categories.reduce((n, c) => n + (c.average === null ? 0 : c.weight * c.gradedFraction), 0);
  const earned = categories.reduce((n, c) => n + c.earned, 0);
  const remaining = categories.reduce((n, c) => n + (c.average === null ? c.weight : c.remaining), 0);
  const current = completed > 0 ? (earned / completed) * 100 : null;
  return {
    categories,
    current: current === null ? null : round1(current),
    letter: letterFor(current === null ? null : round1(current), scale),
    earned,
    completed,
    remaining,
    projected: current === null ? null : round1(earned + (remaining * current) / 100),
    maxPossible: round1(earned + remaining),
    minPossible: round1(earned),
    weightTotal,
  };
}

/** Average needed on all remaining work to finish at `target`. Null when nothing is left to grade. */
export function neededFor(summary: GradeSummary, target: number): number | null {
  if (summary.remaining < 0.01) return null;
  return round1(((target - summary.earned) / summary.remaining) * 100);
}

/**
 * Score needed on one upcoming item to finish at `target`, assuming everything else left
 * goes at your current average.
 */
export function neededOnItem(summary: GradeSummary, item: GradeItem, target: number): number | null {
  const cat = summary.categories.find((c) => c.category.id === item.categoryId);
  if (!cat) return null;
  const itemWeight = cat.weightPerUpcoming(item);
  if (itemWeight < 0.01) return null;
  const pace = summary.current ?? 100;
  const others = Math.max(0, summary.remaining - itemWeight);
  return round1(((target - summary.earned - (others * pace) / 100) / itemWeight) * 100);
}

/** Running course grade after each graded item, oldest first. */
export function gradeTrend(grading: CourseGrading | undefined): Array<{ id: string; title: string; date?: string; grade: number; score: number }> {
  if (!grading) return [];
  const graded = grading.items.filter(isGraded);
  const order = new Map(grading.items.map((item, index) => [item.id, index]));
  const sorted = [...graded].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || order.get(a.id)! - order.get(b.id)!);
  const points: Array<{ id: string; title: string; date?: string; grade: number; score: number }> = [];
  const shown = new Set<string>();
  for (const item of sorted) {
    shown.add(item.id);
    const subset = { ...grading, items: grading.items.filter((i) => !isGraded(i) || shown.has(i.id)) };
    const s = summarize(subset);
    if (s.current !== null) points.push({ id: item.id, title: item.title, date: item.date, grade: s.current, score: round1(pct(item.score!, item.maxScore)) });
  }
  return points;
}

export interface GradeInsight { tone: "good" | "warn" | "info"; text: string }

/** Plain-language observations, most useful first. */
export function gradeInsights(grading: CourseGrading | undefined, target?: number): GradeInsight[] {
  const s = summarize(grading);
  const out: GradeInsight[] = [];
  if (s.current === null) return out;
  const scale = scaleOf(grading);
  const goal = target ?? grading?.target;
  if (goal !== undefined) {
    const need = neededFor(s, goal);
    const label = `${letterFor(goal, scale)} (${goal}%)`;
    if (need === null) out.push({ tone: s.current >= goal ? "good" : "warn", text: s.current >= goal ? `You finished at or above ${label}.` : `Everything is graded; you finished below ${label}.` });
    else if (need <= 0) out.push({ tone: "good", text: `${label} is locked in, even with zeros on everything left.` });
    else if (need > 100) out.push({ tone: "warn", text: `${label} is out of reach: it would take ${need}% on all remaining work. The best you can finish is ${s.maxPossible}%.` });
    else out.push({ tone: need > s.current + 5 ? "warn" : "info", text: `For ${label}, average ${need}% on the remaining ${round1(s.remaining)}% of the grade.` });
  }
  const scored = s.categories.filter((c) => c.average !== null);
  if (scored.length > 1) {
    // The category costing the most points relative to the current average.
    const drag = scored.map((c) => ({ c, cost: (c.weight * c.gradedFraction * (s.current! - c.average!)) / 100 })).sort((a, b) => b.cost - a.cost)[0];
    if (drag.cost > 0.5) out.push({ tone: "warn", text: `${drag.c.category.name} is pulling you down: ${round1(drag.c.average!)}% average on ${round1(drag.c.weight)}% of the grade.` });
    const best = [...scored].sort((a, b) => b.average! - a.average!)[0];
    if (best.average! >= s.current + 3) out.push({ tone: "good", text: `${best.category.name} is your strongest area at ${round1(best.average!)}%.` });
  }
  const unknownSize = s.categories.filter((c) => !c.category.count && c.graded.length > 0 && !c.upcoming.length && c.graded.length < 3);
  if (unknownSize.length) out.push({ tone: "info", text: `${unknownSize.map((c) => c.category.name).join(" and ")} ${unknownSize.length === 1 ? "counts" : "count"} as finished because no more work is listed. Set how many there will be, or add upcoming items, for an accurate "needed".` });
  const biggest = [...s.categories].sort((a, b) => b.remaining - a.remaining)[0];
  if (biggest && biggest.remaining >= 15) out.push({ tone: "info", text: `${biggest.category.name} still carries ${round1(biggest.remaining)}% of your grade, the most of anything left.` });
  const trend = gradeTrend(grading);
  if (trend.length >= 4) {
    const recent = trend.slice(-3).reduce((n, p) => n + p.score, 0) / 3;
    const before = trend.slice(0, -3).reduce((n, p) => n + p.score, 0) / (trend.length - 3);
    if (recent >= before + 4) out.push({ tone: "good", text: `Your last 3 scores average ${round1(recent)}%, up from ${round1(before)}% before.` });
    else if (recent <= before - 4) out.push({ tone: "warn", text: `Your last 3 scores average ${round1(recent)}%, down from ${round1(before)}% before.` });
  }
  return out;
}

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const toNumber = (v: string) => (/^\d+$/.test(v) ? Number(v) : WORD_NUMBERS[v.toLowerCase()]);

export interface ParsedCategory { name: string; weight: number; count?: number; dropLowest?: number }

/**
 * Reads a grading breakdown from free text, like "Exams are 40%, homework 20% (10 assignments, lowest dropped),
 * projects 30%, quizzes 10%" or a pasted syllabus table. Returns nothing it can't read confidently.
 */
export function parseWeights(text: string): ParsedCategory[] {
  const FILLER = /\b(?:are|is|was|=|worth|counts?|count for|for|of|the|a|an|final grade|your grade|grade|total|weighted|weight|each|combined|together|but|and|while|plus|then|with|also|make up|makes up|accounts? for)\b/gi;
  const COUNT = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:of\s+them|assignments?|homeworks?|hws?|quizzes|quizes|quiz|labs?|exams?|tests?|midterms?|projects?|problem sets?|psets?|items?|total)\b/i;
  const DROP = /\b(?:drop(?:s|ped|ping)?\s+(?:the\s+)?(?:lowest|worst)?\s*(\d+|one|two|three)?|(?:lowest|worst)\s+(\d+|one|two|three)?\s*(?:\w+\s+)?(?:is\s+|are\s+|gets?\s+)?dropped)/i;
  const PERCENT = /(\d+(?:\.\d+)?)\s*(?:%|percent\b)/gi;
  const out: ParsedCategory[] = [];
  for (const rawLine of text.replace(/\r/g, "").split(/\n|;/)) {
    const line = rawLine.replace(/^[\s\-–—*•\d.)]*(?=\D)/, (m) => (/\d+(?:\.\d+)?\s*%/.test(m) ? m : m.replace(/[\-–—*•]/g, " "))).trim();
    const matches = [...line.matchAll(PERCENT)];
    if (!matches.length) continue;
    // "20% Exams, 30% Projects" puts the name after the number; "Exams 20%" puts it before.
    const percentFirst = /^\s*\d+(?:\.\d+)?\s*(?:%|percent\b)/i.test(line);
    matches.forEach((m, k) => {
      const weight = Number(m[1]);
      if (!(weight > 0 && weight <= 100)) return;
      const start = m.index!;
      const end = start + m[0].length;
      const prevEnd = k > 0 ? matches[k - 1].index! + matches[k - 1][0].length : 0;
      const nextStart = k + 1 < matches.length ? matches[k + 1].index! : line.length;
      const before = line.slice(prevEnd, start);
      const after = line.slice(end, nextStart);
      const trailingDetail = after.match(/^\s*\(([^)]*)\)/)?.[1] || "";
      let raw = percentFirst ? after : before;
      if (!percentFirst && k > 0) raw = raw.replace(/^\s*\([^)]*\)/, ""); // the previous category's detail
      const context = `${raw} ${percentFirst ? "" : trailingDetail}`;
      const countMatch = context.match(COUNT);
      const dropMatch = context.match(DROP);
      let name = (percentFirst ? raw.split(/,|\band\b|\bbut\b/i)[0] : raw.split(/,(?![^(]*\))/).pop() || raw)
        .replace(/\([^)]*\)/g, " ")
        .replace(/\b(?:drop\w*|lowest|worst|dropped)\b.*$/i, " ")
        .replace(FILLER, " ")
        .replace(/[:\-–—=|•*.,]+/g, " ")
        .replace(/\d+(?:\.\d+)?/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!name || name.length > 40) return;
      name = name.replace(/^./, (c) => c.toUpperCase());
      const count = countMatch ? toNumber(countMatch[1]) : undefined;
      const drop = dropMatch ? toNumber(dropMatch[1] || dropMatch[2] || "1") : undefined;
      out.push({ name, weight, ...(count && count > 1 ? { count } : {}), ...(drop ? { dropLowest: drop } : {}) });
    });
  }
  // Merge duplicates by name.
  const merged = new Map<string, ParsedCategory>();
  for (const c of out) {
    const key = c.name.toLowerCase();
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, weight: prev.weight + c.weight } : c);
  }
  return [...merged.values()];
}

/** Applies a new set of categories, keeping IDs (and grades) of categories whose names still match. */
export function applyCategories(grading: CourseGrading | undefined, parsed: ParsedCategory[], newId: () => string): CourseGrading {
  const existing = grading?.categories || [];
  const categories = parsed.map((p) => {
    const match = existing.find((c) => c.name.toLowerCase() === p.name.toLowerCase());
    return { id: match?.id || newId(), name: p.name, weight: p.weight, ...(p.count ? { count: p.count } : {}), ...(p.dropLowest ? { dropLowest: p.dropLowest } : {}) };
  });
  const ids = new Set(categories.map((c) => c.id));
  return { ...(grading || {}), categories, items: (grading?.items || []).filter((i) => ids.has(i.categoryId)) };
}

/** Finds a category by name, case-insensitively, also matching simple singular/plural forms. */
export function findCategory(grading: CourseGrading | undefined, name: string): GradeCategory | undefined {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(zes|es|s)$/, "");
  const wanted = key(name);
  return grading?.categories.find((c) => key(c.name) === wanted)
    || grading?.categories.find((c) => key(c.name).startsWith(wanted) || wanted.startsWith(key(c.name)));
}

export function formatPercent(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${round1(n)}%`;
}

/** Compact grade context for Iris. */
export function gradingForAssistant(grading: CourseGrading | undefined) {
  if (!grading?.categories.length) return undefined;
  const s = summarize(grading);
  const scale = scaleOf(grading);
  const target = grading.target;
  return {
    currentGrade: s.current, letter: s.letter, completedPercentOfCourse: round1(s.completed), remainingPercentOfCourse: round1(s.remaining),
    projectedFinal: s.projected, bestPossibleFinal: s.maxPossible, worstPossibleFinal: s.minPossible,
    ...(target !== undefined ? { target, averageNeededOnRemainingForTarget: neededFor(s, target) } : {}),
    neededForEachLetter: scale.filter((st) => st.min > 0).map((st) => ({ letter: st.letter, min: st.min, averageNeeded: neededFor(s, st.min) })),
    scale,
    categories: s.categories.map((c) => ({
      id: c.category.id, name: c.category.name, weight: round1(c.weight), average: c.average === null ? null : round1(c.average),
      graded: c.graded.length, upcoming: c.upcoming.length, ...(c.category.count ? { expectedItems: c.category.count } : {}),
      ...(c.category.dropLowest ? { dropLowest: c.category.dropLowest } : {}),
    })),
    items: grading.items.map((i) => ({ id: i.id, category: grading.categories.find((c) => c.id === i.categoryId)?.name, title: i.title,
      ...(isGraded(i) ? { score: i.score, maxScore: i.maxScore, percent: round1(pct(i.score!, i.maxScore)) } : { maxScore: i.maxScore, upcoming: true,
        ...(target !== undefined ? { neededForTarget: neededOnItem(s, i, target) } : {}) }), ...(i.date ? { date: i.date } : {}) })),
    insights: gradeInsights(grading).map((x) => x.text),
  };
}

import type { BrainState } from "../types";

export type BlockKind = "focus" | "routine" | "event" | "break" | "personal";
export interface PlanBlock {
  id: string;
  title: string;
  start: string;
  end: string;
  kind: BlockKind;
  note?: string;
  taskId?: string;
  sourceId?: string;
  locked?: boolean;
  done?: boolean;
}
export interface Routine {
  id: string;
  title: string;
  start: string;
  end: string;
  days: number[];
}
export interface DayPlan {
  blocks: PlanBlock[];
  summary: string;
  generatedAt: string;
  unscheduled: string[];
}
export interface PlannerData {
  start: string;
  end: string;
  focusMinutes: number;
  instructions: string;
  routines: Routine[];
  plans: Record<string, DayPlan>;
}
export const DEFAULT_PLANNER: PlannerData = {
  start: "08:00",
  end: "21:00",
  focusMinutes: 50,
  instructions: "",
  routines: [],
  plans: {},
};
export const minutes = (time: string) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
    ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
    : NaN;
export const clockTime = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
export const validRange = (start: string, end: string) =>
  Number.isFinite(minutes(start)) && minutes(end) > minutes(start);
export const overlaps = (
  a: Pick<PlanBlock, "start" | "end">,
  b: Pick<PlanBlock, "start" | "end">,
) => minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
export const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function upcomingTasks(state: BrainState, date: string) {
  const rank = { urgent: 0, high: 1, medium: 2, low: 3 };
  return state.tasks
    .filter(
      (t) =>
        !t.completed &&
        t.status !== "completed" &&
        (!t.dueDate || t.dueDate <= shiftDate(date, 7)),
    )
    .sort(
      (a, b) =>
        (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
        rank[a.priority] - rank[b.priority],
    );
}
export interface PlannerEvent {
  id: string;
  title: string;
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
}
export function fixedBlocks(
  date: string,
  data: PlannerData,
  events: PlannerEvent[],
): PlanBlock[] {
  const day = new Date(`${date}T12:00:00`).getDay();
  return [
    ...data.routines
      .filter((r) => r.days.includes(day) && validRange(r.start, r.end))
      .map((r) => ({
        id: `routine:${r.id}`,
        sourceId: r.id,
        title: r.title,
        start: r.start,
        end: r.end,
        kind: "routine" as const,
        locked: true,
      })),
    ...events
      .filter(
        (e) => e.date <= date && (e.endDate || e.date) >= date && e.startTime,
      )
      .map((e) => {
        const start = e.date < date ? "00:00" : e.startTime!;
        const end =
          e.endDate && e.endDate > date
            ? "23:59"
            : e.endTime || clockTime(Math.min(1439, minutes(start) + 60));
        return {
          id: `event:${e.id}`,
          sourceId: e.id,
          title: e.title,
          start,
          end,
          note: [
            e.location,
            !e.endTime
              ? "End time estimated: 1 hour. Set an end time in Events for accuracy."
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
          kind: "event" as const,
          locked: true,
        };
      })
      .filter((e) => validRange(e.start, e.end)),
  ].sort((a, b) => a.start.localeCompare(b.start));
}
export interface PlanSuggestion {
  title: string;
  minutes: number;
  kind: "focus" | "break" | "personal";
  taskId?: string;
  note?: string;
  latestEnd?: string;
  preferredStart?: string;
}
/** AI chooses priorities; this scheduler enforces fixed commitments and day boundaries. */
export function schedulePlan(
  date: string,
  data: PlannerData,
  fixed: PlanBlock[],
  suggestions: PlanSuggestion[],
  now = new Date(),
): DayPlan {
  if (!validRange(data.start, data.end))
    throw new Error("Your day must end after it starts.");
  const kept = (data.plans[date]?.blocks || []).filter(
    (b) => !b.sourceId && (b.locked || b.done),
  );
  const blocks = [
    ...fixed.map((b) => ({
      ...b,
      done: data.plans[date]?.blocks.find((old) => old.id === b.id)?.done,
    })),
    ...kept,
  ];
  const unscheduled: string[] = [];
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const earliest = Math.max(
    minutes(data.start),
    date === today
      ? Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5
      : 0,
  );
  const seenTasks = new Set(kept.map((b) => b.taskId).filter(Boolean));
  for (const item of suggestions) {
    if (item.taskId && seenTasks.has(item.taskId)) continue;
    const duration = Math.max(
      5,
      Math.min(180, Math.round(item.minutes / 5) * 5),
    );
    let cursor = Math.max(
      earliest,
      item.preferredStart ? minutes(item.preferredStart) : 0,
    );
    for (const busy of [...blocks].sort((a, b) =>
      a.start.localeCompare(b.start),
    )) {
      if (minutes(busy.end) <= cursor) continue;
      if (cursor + duration <= minutes(busy.start)) break;
      cursor = Math.max(cursor, minutes(busy.end));
    }
    if (
      cursor + duration >
      Math.min(
        minutes(data.end),
        item.latestEnd ? minutes(item.latestEnd) : 1440,
      )
    ) {
      unscheduled.push(item.title);
      continue;
    }
    blocks.push({
      id: crypto.randomUUID(),
      title: item.title,
      start: clockTime(cursor),
      end: clockTime(cursor + duration),
      kind: item.kind,
      note: item.note,
      taskId: item.taskId,
    });
    if (item.taskId) seenTasks.add(item.taskId);
  }
  return {
    blocks: blocks.sort((a, b) => a.start.localeCompare(b.start)),
    unscheduled,
    summary: "",
    generatedAt: new Date().toISOString(),
  };
}

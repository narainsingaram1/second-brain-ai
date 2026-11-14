import type { CalendarEvent, Routine, RoutineCondition, RoutineFrequency, Task } from "../types";

/**
 * When routines run, and whether a run is worth its AI usage. Pure: the scheduler, the app and the tests share it.
 *
 * The scheduler wakes every 15 minutes. A routine is due from its time until CATCH_UP_MINUTES later, so a late or
 * missed wake still runs it, while a routine created in the afternoon for 8:00 waits for tomorrow. Each run has a
 * slot (its local date), and a slot runs at most once.
 */
export const ROUTINE_FREQUENCIES: RoutineFrequency[] = ["daily", "weekdays", "weekly", "monthly"];
export const ROUTINE_CONDITIONS: RoutineCondition[] = ["always", "overdue_tasks", "due_today", "due_soon", "events_today"];
export const CATCH_UP_MINUTES = 180;
export const MAX_ROUTINES = 20;
export const ROUTINE_INSTRUCTIONS_MAX = 4000;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const CONDITION_LABELS: Record<RoutineCondition, string> = {
  always: "Every time",
  overdue_tasks: "Only when tasks are overdue",
  due_today: "Only when something is due that day",
  due_soon: "Only when something is due in the next 2 days",
  events_today: "Only when there are events that day",
};

export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}
export const defaultTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

interface LocalClock { date: string; weekday: number; day: number; lastDay: number; minutes: number }
/** The wall clock in a time zone. */
export function localClock(now: Date, timeZone: string): LocalClock {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
    .formatToParts(now).map(p => [p.type, p.value]));
  const [y, mo, d] = [parts.year, parts.month, parts.day].map(Number);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
    day: d, lastDay: new Date(Date.UTC(y, mo, 0)).getUTCDate(), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const timeMinutes = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };

/** Whether the routine runs at all on this local day. */
export function runsOn(routine: Pick<Routine, "frequency" | "days" | "dayOfMonth">, weekday: number, day: number, lastDay: number): boolean {
  switch (routine.frequency) {
    case "daily": return true;
    case "weekdays": return weekday >= 1 && weekday <= 5;
    case "weekly": return (routine.days?.length ? routine.days : [1]).includes(weekday);
    case "monthly": return day === Math.min(routine.dayOfMonth || 1, lastDay);
  }
}

export const routineZone = (routine: Pick<Routine, "timeZone">) => isTimeZone(routine.timeZone) ? routine.timeZone : "UTC";

/** The slot to run now, or null if the routine is not due. */
export function dueSlot(routine: Routine, now: Date): string | null {
  if (!routine.enabled) return null;
  const clock = localClock(now, routineZone(routine));
  if (!runsOn(routine, clock.weekday, clock.day, clock.lastDay)) return null;
  const late = clock.minutes - timeMinutes(routine.time);
  return late >= 0 && late < CATCH_UP_MINUTES ? clock.date : null;
}

/** When the routine next runs, as a local date and time, or null if it is paused. */
export function nextRun(routine: Routine, now: Date): { date: string; time: string } | null {
  if (!routine.enabled) return null;
  const zone = routineZone(routine);
  for (let i = 0; i < 62; i++) {
    const clock = localClock(new Date(now.getTime() + i * 86_400_000), zone);
    if (i === 0 && clock.minutes >= timeMinutes(routine.time)) continue;
    if (runsOn(routine, clock.weekday, clock.day, clock.lastDay)) return { date: clock.date, time: routine.time };
  }
  return null;
}

const isOpen = (t: Task) => t.status !== "completed" && !t.completed;
function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Whether the routine's condition holds on `date`. Plain rules over the records, so skipping a run costs nothing. */
export function conditionHolds(condition: RoutineCondition, tasks: Task[], events: CalendarEvent[], date: string): boolean {
  const open = tasks.filter(t => isOpen(t) && t.dueDate);
  switch (condition) {
    case "always": return true;
    case "overdue_tasks": return open.some(t => t.dueDate < date);
    case "due_today": return open.some(t => t.dueDate === date);
    case "due_soon": return open.some(t => t.dueDate >= date && t.dueDate <= addDays(date, 2));
    case "events_today": return events.some(e => e.date === date);
  }
}

function clock12(time: string) {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
/** "Weekdays at 8:00 AM", "Sundays and Wednesdays at 6:00 PM", "Monthly on the 1st at 9:00 AM". */
export function describeSchedule(routine: Pick<Routine, "frequency" | "days" | "dayOfMonth" | "time">): string {
  const at = `at ${clock12(routine.time)}`;
  switch (routine.frequency) {
    case "daily": return `Every day ${at}`;
    case "weekdays": return `Weekdays ${at}`;
    case "weekly": {
      const days = [...new Set(routine.days?.length ? routine.days : [1])].sort().map(d => `${DAY_NAMES[d]}s`);
      return `${days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}` : days[0]} ${at}`;
    }
    case "monthly": return `Monthly on the ${ordinal(routine.dayOfMonth || 1)} ${at}`;
  }
}

/** The conversation a routine's runs are kept in, so the user can read them and reply. */
export const routineThread = (routine: Pick<Routine, "id" | "name">) => ({ id: `routine-${routine.id}`, title: `Routine: ${routine.name}` });

/** Tells the assistant it is running unattended. */
export const ROUTINE_CHANNEL_NOTE = `## Scheduled routine
This turn is a scheduled run of one of the user's routines. The user is not watching and cannot answer questions now.
- Do the work in the routine's instructions to the end, using the snapshot and tools. Make sensible default choices instead of asking.
- Changes that need approval wait for the user; that is expected. Never claim a change was made unless a tool result confirmed it.
- Reply with a short report the user will read later: what you found, what you changed, and anything waiting for their approval or decision. No questions, no choices cards.`;

/** The message a run sends as the user's request. */
export function routinePrompt(routine: Routine, date: string): string {
  return `Run my routine "${routine.name}" for ${date}.\n\n${routine.instructions}`;
}

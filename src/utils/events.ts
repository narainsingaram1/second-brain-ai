import type { CalendarEvent, EventKind, Task } from "../types";

export const EVENT_KINDS: { id: EventKind; label: string }[] = [
  { id: "meeting", label: "Meeting" },
  { id: "event", label: "Event" },
  { id: "class", label: "Class" },
  { id: "appointment", label: "Appointment" },
];
export const MAX_EVENTS = 2000;

/** 24-hour "HH:MM", 00:00–23:59. */
export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
/** "23:59" → "11:59 PM". */
export function formatTime(time?: string): string {
  if (!isValidTime(time)) return "";
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
/** "9:00 AM – 10:30 AM", "From 9:00 AM", or "All day". */
export function eventTimeLabel(event: Pick<CalendarEvent, "startTime" | "endTime">): string {
  if (!event.startTime) return "All day";
  return event.endTime ? `${formatTime(event.startTime)} – ${formatTime(event.endTime)}` : formatTime(event.startTime);
}
export function safeEventLink(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
/** Sort key within a day: all-day first, then by start time. */
export const eventSortKey = (e: Pick<CalendarEvent, "date" | "startTime">) => `${e.date} ${e.startTime || "00:00-"}`;
export const sortEvents = <T extends Pick<CalendarEvent, "date" | "startTime">>(events: T[]) =>
  [...events].sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));
/** Tasks without a time sort after timed ones on the same day (due "by end of day"). */
export const taskSortKey = (t: Pick<Task, "dueDate" | "dueTime">) => `${t.dueDate} ${t.dueTime || "24:00"}`;

const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);

/** Validates stored or synced events; malformed entries are dropped rather than crashing the calendar. */
export function normalizeEvents(value: unknown): CalendarEvent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const now = new Date().toISOString();
  return value.flatMap((raw): CalendarEvent[] => {
    if (!raw || typeof raw !== "object") return [];
    const e = raw as Record<string, unknown>;
    if (typeof e.id !== "string" || !e.id || e.id.length > 100 || seen.has(e.id) || !text(e.title, 300) || !isValidDate(e.date)) return [];
    seen.add(e.id);
    const startTime = isValidTime(e.startTime) ? e.startTime : undefined;
    const endTime = startTime && isValidTime(e.endTime) && e.endTime > startTime ? e.endTime : undefined;
    const attendees = Array.isArray(e.attendees)
      ? e.attendees.flatMap((a) => (text(a, 120) ? [text(a, 120)!] : [])).slice(0, 50)
      : [];
    const link = safeEventLink(typeof e.link === "string" ? e.link : undefined);
    return [{
      id: e.id,
      title: text(e.title, 300)!,
      kind: EVENT_KINDS.some((k) => k.id === e.kind) ? (e.kind as EventKind) : "event",
      date: e.date,
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
      ...(text(e.location, 300) ? { location: text(e.location, 300) } : {}),
      ...(link ? { link } : {}),
      ...(attendees.length ? { attendees } : {}),
      ...(text(e.notes, 20000) ? { notes: text(e.notes, 20000) } : {}),
      createdAt: typeof e.createdAt === "string" ? e.createdAt : now,
      updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : now,
    }];
  }).slice(0, MAX_EVENTS);
}

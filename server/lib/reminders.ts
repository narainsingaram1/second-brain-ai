import type { CalendarEvent, Task } from "../../src/types";
import { formatTime } from "../../src/utils/events";
import type { AdminStore, TelegramAccount } from "./admin";
import type { TelegramClient } from "./telegram";

export const TASK_LEAD_MINUTES = 120;
export const EVENT_LEAD_MINUTES = 30;
/** Alerts wait until morning; a brief is only ever sent at the hour the user picked. */
const QUIET_UNTIL_HOUR = 7;
const ALERTS_PER_DAY = 12;
const BRIEF_ITEMS = 6;
const KEEP_MS = 14 * 86_400_000;

export interface Reminder { key: string; text: string; brief?: boolean }
type ReminderPrefs = Pick<TelegramAccount, "timeZone" | "briefEnabled" | "briefHour" | "alertsEnabled">;

const wallMinutes = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h, mi) / 60_000;
function localClock(now: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(now).map(p => [p.type, p.value]));
  const [y, mo, d, h, mi] = [parts.year, parts.month, parts.day, parts.hour, parts.minute].map(Number);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: h, minutes: wallMinutes(y, mo, d, h, mi) };
}
function minutesOf(date: string, time: string) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return wallMinutes(y, mo, d, h, mi);
}
const isOpen = (t: Task) => t.status !== "completed" && !t.completed;
const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
function until(minutes: number) {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = Math.floor(minutes / 60), rest = Math.round(minutes % 60);
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
function list(title: string, lines: string[]) {
  if (!lines.length) return "";
  return `${title}\n${lines.slice(0, BRIEF_ITEMS).map(l => `• ${l}`).join("\n")}${lines.length > BRIEF_ITEMS ? `\n• and ${lines.length - BRIEF_ITEMS} more` : ""}`;
}

/** What should go out right now. Plain rules over the user's own records, so reminders cost no AI usage. */
export function dueReminders(tasks: Task[], events: CalendarEvent[], prefs: ReminderPrefs, now: Date): Reminder[] {
  const clock = localClock(now, prefs.timeZone);
  const open = tasks.filter(t => isOpen(t) && t.dueDate);
  const reminders: Reminder[] = [];
  if (prefs.briefEnabled && clock.hour === prefs.briefHour) {
    const today = open.filter(t => t.dueDate === clock.date).sort((a, b) => (a.dueTime || "99").localeCompare(b.dueTime || "99"));
    const overdue = open.filter(t => t.dueDate < clock.date).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const todayEvents = events.filter(e => e.date === clock.date).sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
    const sections = [
      list("Due today", today.map(t => t.dueTime ? `${t.title} (${formatTime(t.dueTime)})` : t.title)),
      list("Overdue", overdue.map(t => `${t.title} (${shortDate(t.dueDate)})`)),
      list("On your calendar", todayEvents.map(e => e.startTime ? `${e.title}, ${formatTime(e.startTime)}` : e.title)),
    ].filter(Boolean);
    reminders.push({ key: `brief:${clock.date}`, brief: true, text: sections.length ? `Good morning. Here's your day.\n\n${sections.join("\n\n")}` : "Good morning. Nothing due today and nothing overdue." });
  }
  if (prefs.alertsEnabled && clock.hour >= QUIET_UNTIL_HOUR) {
    for (const task of open) {
      if (!task.dueTime) continue;
      const left = minutesOf(task.dueDate, task.dueTime) - clock.minutes;
      if (left > 0 && left <= TASK_LEAD_MINUTES) reminders.push({ key: `task:${task.id}:${task.dueDate}:${task.dueTime}`, text: `Due in ${until(left)}: ${task.title}` });
    }
    for (const event of events) {
      if (!event.startTime) continue;
      const left = minutesOf(event.date, event.startTime) - clock.minutes;
      if (left > 0 && left <= EVENT_LEAD_MINUTES) reminders.push({ key: `event:${event.id}:${event.date}:${event.startTime}`, text: `Starting in ${until(left)}: ${event.title}${event.location ? ` at ${event.location}` : ""}` });
    }
  }
  return reminders;
}

/** One pass of the scheduled job. Each reminder is recorded before it is sent, so a retry can never send it twice. */
export async function runReminders(telegram: TelegramClient, admin: AdminStore, now = new Date()): Promise<{ accounts: number; sent: number }> {
  const accounts = await admin.linkedAccounts();
  let sent = 0;
  for (const account of accounts) {
    try {
      const { tasks, events } = await admin.reminderData(account.userId);
      const due = dueReminders(tasks, events, account, now);
      if (!due.length) continue;
      let alertsLeft = ALERTS_PER_DAY - await admin.countNotifications(account.userId, new Date(now.getTime() - 86_400_000).toISOString());
      for (const reminder of due) {
        if (!reminder.brief && alertsLeft <= 0) continue;
        if (!await admin.claimNotification(account.userId, reminder.key, reminder.text)) continue;
        await telegram.send(account.chatId, reminder.text);
        sent++;
        alertsLeft--;
      }
    } catch (error) {
      // One account's failure (for example a blocked bot) must not stop everyone else's reminders.
      console.error("[reminders] account failed", error instanceof Error ? error.message : "unknown error");
    }
  }
  await admin.pruneNotifications(new Date(now.getTime() - KEEP_MS).toISOString());
  return { accounts: accounts.length, sent };
}

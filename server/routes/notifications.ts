import { productionDeps, type Deps } from "../lib/context";
import { HttpError, json, route } from "../lib/http";
import { runReminders } from "../lib/reminders";
import { sameSecret, telegramClient } from "../lib/telegram";

/** The scheduled job that sends reminders. Only the scheduler, holding CRON_SECRET, can run it. */
export function notificationsHandlers(deps: Deps = productionDeps) {
  const run = route(async request => {
    const expected = deps.cronSecret?.() || "";
    const header = request.headers.get("Authorization") || "";
    if (!expected || !sameSecret(header, `Bearer ${expected}`)) throw new HttpError(401, "Unauthorized.");
    const telegram = deps.telegram?.(), admin = deps.admin?.();
    if (!telegram || !admin) throw new HttpError(503, "Telegram is not set up on this server yet.");
    return json(await runReminders(telegramClient(telegram.token, deps.telegramFetch), admin));
  });
  return { GET: run, POST: run };
}

export const { GET, POST } = notificationsHandlers();

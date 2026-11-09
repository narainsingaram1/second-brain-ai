import { productionDeps, secretsAvailable, type Deps } from "../lib/context";
import { validTimeZone } from "../lib/googleApi";
import { HttpError, json, readJson, route } from "../lib/http";
import { sameSecret, sha256Hex, telegramClient, webhookSecret } from "../lib/telegram";
import { handleTelegramUpdate, type TelegramUpdate } from "../lib/telegramBot";
import type { TelegramPrefs } from "../lib/store";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * Telegram for the assistant. Signed-in requests manage the link and its settings; updates from Telegram
 * are told apart by the secret header set when the webhook was registered, and answered immediately
 * because Telegram resends anything that takes too long.
 */
export function telegramHandlers(deps: Deps = productionDeps) {
  const config = async () => {
    const telegram = deps.telegram?.();
    if (!telegram || !await secretsAvailable(deps)) throw new HttpError(503, "Telegram is not set up on this server yet.");
    return telegram;
  };
  const client = (token: string) => telegramClient(token, deps.telegramFetch);
  const view = (row: Awaited<ReturnType<import("../lib/store").ServerStore["getTelegramLink"]>>) => row?.linked
    ? { linked: true, username: row.username, briefEnabled: row.briefEnabled, briefHour: row.briefHour, alertsEnabled: row.alertsEnabled } : { linked: false };
  return {
    GET: route(async request => {
      const { store } = await deps.caller(request);
      return json({ configured: !!deps.telegram?.(), ...view(await store.getTelegramLink()) });
    }),
    POST: route(async request => {
      const secret = request.headers.get(SECRET_HEADER);
      if (secret !== null) {
        const telegram = deps.telegram?.(), admin = deps.admin?.();
        if (!telegram || !admin || !sameSecret(secret, await webhookSecret(telegram.token))) throw new HttpError(401, "Unauthorized.");
        const update = await readJson<TelegramUpdate>(request, 1_000_000);
        const work = handleTelegramUpdate(deps, client(telegram.token), admin, update).catch(error => console.error("[telegram] update failed", error instanceof Error ? error.message : "unknown error"));
        if (deps.background) deps.background(work); else await work;
        return json({ ok: true });
      }
      const telegram = await config();
      const { store } = await deps.caller(request);
      if (!telegram.webhookUrl) throw new HttpError(503, "Set PUBLIC_APP_URL so Telegram can reach this server.");
      const body = await readJson<{ timeZone?: unknown }>(request, 10_000);
      const bot = client(telegram.token);
      await bot.setWebhook(telegram.webhookUrl, await webhookSecret(telegram.token));
      const code = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_");
      await store.beginTelegramLink(await sha256Hex(code), validTimeZone(body.timeZone));
      await store.appendAudit({ actor: "user", action: "started telegram link", entityType: "connection", entityId: "telegram", title: "Telegram" });
      return json({ url: `https://t.me/${await bot.username()}?start=${code}` });
    }),
    PATCH: route(async request => {
      const { store } = await deps.caller(request);
      const body = await readJson<Record<string, unknown>>(request, 10_000);
      const prefs: TelegramPrefs = {};
      if (body.timeZone !== undefined) prefs.timeZone = validTimeZone(body.timeZone);
      if (typeof body.briefEnabled === "boolean") prefs.briefEnabled = body.briefEnabled;
      if (typeof body.alertsEnabled === "boolean") prefs.alertsEnabled = body.alertsEnabled;
      if (body.briefHour !== undefined) {
        if (!Number.isInteger(body.briefHour) || (body.briefHour as number) < 0 || (body.briefHour as number) > 23) throw new HttpError(400, "Choose an hour of the day.");
        prefs.briefHour = body.briefHour as number;
      }
      await store.setTelegramPrefs(prefs);
      return json({ configured: !!deps.telegram?.(), ...view(await store.getTelegramLink()) });
    }),
    DELETE: route(async request => {
      const { store } = await deps.caller(request);
      await store.deleteTelegramLink();
      await store.appendAudit({ actor: "user", action: "disconnected telegram", entityType: "connection", entityId: "telegram", title: "Telegram" });
      return json({ configured: !!deps.telegram?.(), linked: false });
    }),
  };
}

export const { GET, POST, PATCH, DELETE } = telegramHandlers();

import { waitUntil } from "@vercel/functions";
import { authenticate } from "./auth";
import { supabaseAdminStore, type AdminStore } from "./admin";
import { keyring, openSecret } from "./crypto";
import { serverEnv } from "./env";
import { HttpError } from "./http";
import { supabaseStore, type ServerStore } from "./store";
import { serverWebAccess } from "./webAccess";
import type { WebAccess } from "../../src/services/webTools";

/** What a route needs from the outside world; tests swap in an in-memory store and a fixed key. */
export interface GoogleConfig { clientId: string; clientSecret: string; redirectUri: string }
export interface Deps {
  caller(request: Request): Promise<{ userId: string; store: ServerStore }>;
  secretsKey(): string;
  /** Google OAuth client, or null when not configured. */
  google?(): Omit<GoogleConfig, "redirectUri"> & { redirectUri?: string } | null;
  /** Network access to Google's APIs (mocked in tests). */
  googleFetch?: typeof fetch;
  /** Network access for opening links the user shares; without it the assistant has no web tools. */
  web?: () => WebAccess;
  /** Telegram bot, or null when not configured. */
  telegram?(): { token: string; webhookUrl: string } | null;
  telegramFetch?: typeof fetch;
  /** Server-only database access for webhooks and scheduled jobs, which arrive without a signed-in user. */
  admin?(): AdminStore | null;
  /** Keeps work running after the response has been sent. */
  background?(work: Promise<unknown>): void;
  cronSecret?(): string;
}

export const productionDeps: Deps = {
  async caller(request) {
    const caller = await authenticate(request);
    return { userId: caller.userId, store: supabaseStore(caller.userId, caller.client) };
  },
  secretsKey: () => serverEnv().secretsKey,
  google: () => {
    const env = serverEnv();
    return env.googleClientId && env.googleClientSecret ? { clientId: env.googleClientId, clientSecret: env.googleClientSecret, redirectUri: env.googleRedirectUri || undefined } : null;
  },
  googleFetch: (...args) => fetch(...args),
  web: () => serverWebAccess(),
  telegram: () => {
    const env = serverEnv();
    return env.telegramBotToken && env.supabaseServiceRoleKey ? { token: env.telegramBotToken, webhookUrl: env.publicAppUrl ? `${env.publicAppUrl.replace(/\/$/, "")}/api/telegram` : "" } : null;
  },
  telegramFetch: (...args) => fetch(...args),
  admin: () => {
    const env = serverEnv();
    return env.supabaseServiceRoleKey ? supabaseAdminStore(env.supabaseUrl, env.supabaseAnonKey, env.supabaseServiceRoleKey) : null;
  },
  background: work => waitUntil(work),
  cronSecret: () => serverEnv().cronSecret,
};

export async function secretsAvailable(deps: Deps): Promise<boolean> {
  try { await keyring(deps.secretsKey()); return true; } catch { return false; }
}

/** The caller's decrypted provider key, or a 412 telling them to add one. Never logged or returned. */
export async function providerKey(deps: Deps, store: ServerStore): Promise<string> {
  const sealed = await store.getSecret("openrouter");
  if (!sealed) throw new HttpError(412, "Add your AI provider key in Settings so the assistant can run on the server.");
  return openSecret(deps.secretsKey(), store.userId, "openrouter", sealed);
}

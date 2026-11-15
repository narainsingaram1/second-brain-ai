import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, Routine, Task } from "../../src/types";
import { supabaseStore, type ServerStore } from "./store";

export interface TelegramAccount { userId: string; chatId: number; timeZone: string; briefEnabled: boolean; briefHour: number; alertsEnabled: boolean }
export interface UserSession { store: ServerStore; close(): Promise<void> }

/**
 * The only code that uses the service role. Webhooks and scheduled jobs arrive with no signed-in user, so this
 * finds the linked account, keeps the delivery ledger, and opens a short session as that user. Everything the
 * assistant then reads or changes goes through `session().store`, under the same row-level security as the app.
 */
export interface AdminStore {
  /** Binds a chat to whoever created this one-time code. Returns that account, or null if the code is invalid or expired. */
  consumeLinkCode(codeHash: string, chatId: number, username: string | null): Promise<string | null>;
  /** The account for this chat if this update is new; null if the chat is unlinked or the update was already handled. */
  claimUpdate(chatId: number, updateId: number): Promise<TelegramAccount | null>;
  accountForChat(chatId: number): Promise<TelegramAccount | null>;
  setNotifications(userId: string, enabled: boolean): Promise<void>;
  linkedAccounts(): Promise<TelegramAccount[]>;
  reminderData(userId: string): Promise<{ tasks: Task[]; events: CalendarEvent[] }>;
  /** Records a notification. False means it was already sent. */
  claimNotification(userId: string, key: string, body: string): Promise<boolean>;
  recentNotifications(userId: string, sinceIso: string): Promise<string[]>;
  countNotifications(userId: string, sinceIso: string): Promise<number>;
  pruneNotifications(beforeIso: string): Promise<void>;
  session(userId: string): Promise<UserSession>;
  /** Every account with enabled routines, with its Telegram chat when one is linked. */
  routineOwners(): Promise<Array<{ userId: string; routines: Routine[]; chatId: number | null }>>;
  /** The account a phone sync token belongs to, or null. */
  healthAccount(tokenHash: string): Promise<string | null>;
  /** Stored health days with their revisions, for merging a sync into them. */
  healthDays(userId: string, ids: string[]): Promise<Array<{ id: string; data: Record<string, unknown>; revision: number }>>;
  markHealthSync(userId: string, days: number, source: string): Promise<void>;
}

const LINK_COLUMNS = "user_id,chat_id,time_zone,brief_enabled,brief_hour,alerts_enabled";
type LinkRow = { user_id: string; chat_id: number | string; time_zone: string; brief_enabled: boolean; brief_hour: number; alerts_enabled: boolean };
const account = (r: LinkRow): TelegramAccount => ({ userId: r.user_id, chatId: Number(r.chat_id), timeZone: r.time_zone, briefEnabled: r.brief_enabled, briefHour: r.brief_hour, alertsEnabled: r.alerts_enabled });
const AUTH_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
/** PostgREST returns at most this many rows per request by default; larger lists are read page by page. */
const PAGE = 1000;
/** How long a scheduler session token lives: one account's routines run one after another within it. */
const SESSION_SECONDS = 15 * 60;

/** Reads every row of a query, a page at a time. `query` must have a stable order. */
async function allRows<T>(what: string, query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = check(await query(from, from + PAGE - 1), what);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/**
 * An access token for this user, signed with the project's JWT secret: the same claims Supabase Auth puts in a
 * session (role and audience "authenticated", the user as subject), so row-level security applies exactly as for
 * the app. Used instead of creating a sign-in session, which costs four Auth requests per account.
 */
export async function userAccessToken(userId: string, secret: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const text = new TextEncoder();
  const part = (value: object) => base64url(text.encode(JSON.stringify(value)));
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: userId, role: "authenticated", aud: "authenticated", iat: now, exp: now + SESSION_SECONDS })}`;
  const key = await crypto.subtle.importKey("raw", text.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${body}.${base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, text.encode(body))))}`;
}

function check<T extends { error: { message: string } | null }>(result: T, what: string): T {
  if (result.error) throw new Error(`Could not ${what}: ${result.error.message}`);
  return result;
}

export function supabaseAdminStore(url: string, anonKey: string, serviceKey: string, jwtSecret = ""): AdminStore {
  const admin: SupabaseClient = createClient(url, serviceKey, AUTH_OPTIONS);
  const links = () => admin.from("telegram_links");
  return {
    async consumeLinkCode(codeHash, chatId, username) {
      const now = new Date().toISOString();
      const pending = check(await links().select("user_id").eq("link_code_hash", codeHash).gt("link_code_expires_at", now).maybeSingle(), "check the link code");
      if (!pending.data) return null;
      // A chat belongs to one account at a time; linking it elsewhere releases the old link.
      check(await links().update({ chat_id: null, linked_at: null }).eq("chat_id", chatId).neq("user_id", pending.data.user_id), "release the previous link");
      const bound = check(await links().update({ chat_id: chatId, username, linked_at: now, link_code_hash: null, link_code_expires_at: null })
        .eq("link_code_hash", codeHash).gt("link_code_expires_at", now).select("user_id").maybeSingle(), "link the chat");
      return bound.data?.user_id ?? null;
    },
    async claimUpdate(chatId, updateId) {
      const { data } = check(await links().update({ last_update_id: updateId }).eq("chat_id", chatId).lt("last_update_id", updateId).select(LINK_COLUMNS).maybeSingle(), "read the chat link");
      return data ? account(data as LinkRow) : null;
    },
    async accountForChat(chatId) {
      const { data } = check(await links().select(LINK_COLUMNS).eq("chat_id", chatId).maybeSingle(), "read the chat link");
      return data ? account(data as LinkRow) : null;
    },
    async setNotifications(userId, enabled) {
      check(await links().update({ brief_enabled: enabled, alerts_enabled: enabled }).eq("user_id", userId), "update notifications");
    },
    async linkedAccounts() {
      const rows = await allRows("list linked accounts", (from, to) =>
        links().select(LINK_COLUMNS).not("chat_id", "is", null).or("brief_enabled.eq.true,alerts_enabled.eq.true").order("user_id").range(from, to));
      return rows.map(r => account(r as LinkRow));
    },
    async reminderData(userId) {
      const { data } = check(await admin.from("brain_records").select("collection,data").eq("user_id", userId).eq("deleted", false).in("collection", ["tasks", "events"]), "read reminders");
      const of = <T,>(collection: string) => (data || []).filter(r => r.collection === collection).map(r => r.data as T);
      return { tasks: of<Task>("tasks"), events: of<CalendarEvent>("events") };
    },
    async claimNotification(userId, key, body) {
      const { data } = check(await admin.from("telegram_notifications").upsert({ user_id: userId, key, body: body.slice(0, 8000) }, { onConflict: "user_id,key", ignoreDuplicates: true }).select("key"), "record the notification");
      return !!data?.length;
    },
    async recentNotifications(userId, sinceIso) {
      const { data } = check(await admin.from("telegram_notifications").select("body").eq("user_id", userId).gte("sent_at", sinceIso).order("sent_at", { ascending: false }).limit(5), "read recent notifications");
      return (data || []).map(r => r.body as string).reverse();
    },
    async countNotifications(userId, sinceIso) {
      const { count } = check(await admin.from("telegram_notifications").select("key", { count: "exact", head: true }).eq("user_id", userId).gte("sent_at", sinceIso), "count notifications");
      return count || 0;
    },
    async pruneNotifications(beforeIso) {
      check(await admin.from("telegram_notifications").delete().lt("sent_at", beforeIso), "prune notifications");
    },
    async healthAccount(tokenHash) {
      const { data } = check(await admin.from("health_sync_tokens").select("user_id").eq("token_hash", tokenHash).maybeSingle(), "check the sync token");
      return (data?.user_id as string | undefined) ?? null;
    },
    async healthDays(userId, ids) {
      const rows: Array<{ id: string; data: Record<string, unknown>; revision: number }> = [];
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = check(await admin.from("brain_records").select("id,data,revision").eq("user_id", userId).eq("collection", "healthDays").eq("deleted", false).in("id", ids.slice(i, i + 100)), "read health days");
        rows.push(...(data || []).map(r => ({ id: r.id as string, data: r.data as Record<string, unknown>, revision: Number(r.revision) })));
      }
      return rows;
    },
    async markHealthSync(userId, days, source) {
      check(await admin.from("health_sync_tokens").update({ last_sync_at: new Date().toISOString(), last_sync_days: days, last_sync_source: source.slice(0, 80) }).eq("user_id", userId), "record the sync");
    },
    async routineOwners() {
      // Served by the partial index brain_records_live_routines; paged, so no routine is silently dropped past the row limit.
      const data = await allRows("list routines", (from, to) =>
        admin.from("brain_records").select("user_id,data").eq("collection", "routines").eq("deleted", false).order("user_id").order("id").range(from, to));
      const byUser = new Map<string, Routine[]>();
      for (const row of data) {
        const routine = row.data as Routine;
        if (!routine?.enabled) continue;
        byUser.set(row.user_id as string, [...(byUser.get(row.user_id as string) || []), routine]);
      }
      if (!byUser.size) return [];
      const chats = new Map<string, number>();
      const users = [...byUser.keys()];
      for (let i = 0; i < users.length; i += 100) {
        const { data: linked } = check(await links().select("user_id,chat_id").in("user_id", users.slice(i, i + 100)).not("chat_id", "is", null), "read chat links");
        for (const r of linked || []) chats.set(r.user_id as string, Number(r.chat_id));
      }
      return users.map(userId => ({ userId, routines: byUser.get(userId)!, chatId: chats.get(userId) ?? null }));
    },
    async session(userId) {
      if (jwtSecret) {
        const token = await userAccessToken(userId, jwtSecret);
        const client = createClient(url, anonKey, { ...AUTH_OPTIONS, global: { headers: { Authorization: `Bearer ${token}` } } });
        // One cheap read confirms the project accepts the token; if it was signed with another key, fall back below.
        const probe = await client.from("brains").select("user_id").limit(1);
        if (!probe.error) return { store: supabaseStore(userId, client), close: async () => {} };
        console.warn("[admin] SUPABASE_JWT_SECRET was not accepted; using a sign-in session instead.");
      }
      const found = await admin.auth.admin.getUserById(userId);
      const email = found.data.user?.email;
      if (found.error || !email) throw new Error("Could not find the linked account.");
      const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (link.error) throw new Error(`Could not start a session: ${link.error.message}`);
      const verified = await createClient(url, anonKey, AUTH_OPTIONS).auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
      const token = verified.data.session?.access_token;
      if (verified.error || !token) throw new Error(`Could not start a session: ${verified.error?.message || "no session returned"}`);
      const client = createClient(url, anonKey, { ...AUTH_OPTIONS, global: { headers: { Authorization: `Bearer ${token}` } } });
      return { store: supabaseStore(userId, client), close: async () => { await admin.auth.admin.signOut(token, "local").catch(() => {}); } };
    },
  };
}

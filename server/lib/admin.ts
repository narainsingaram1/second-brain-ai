import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, Task } from "../../src/types";
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
}

const LINK_COLUMNS = "user_id,chat_id,time_zone,brief_enabled,brief_hour,alerts_enabled";
type LinkRow = { user_id: string; chat_id: number | string; time_zone: string; brief_enabled: boolean; brief_hour: number; alerts_enabled: boolean };
const account = (r: LinkRow): TelegramAccount => ({ userId: r.user_id, chatId: Number(r.chat_id), timeZone: r.time_zone, briefEnabled: r.brief_enabled, briefHour: r.brief_hour, alertsEnabled: r.alerts_enabled });
const AUTH_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

function check<T extends { error: { message: string } | null }>(result: T, what: string): T {
  if (result.error) throw new Error(`Could not ${what}: ${result.error.message}`);
  return result;
}

export function supabaseAdminStore(url: string, anonKey: string, serviceKey: string): AdminStore {
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
      const { data } = check(await links().select(LINK_COLUMNS).not("chat_id", "is", null).or("brief_enabled.eq.true,alerts_enabled.eq.true"), "list linked accounts");
      return (data || []).map(r => account(r as LinkRow));
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
    async session(userId) {
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

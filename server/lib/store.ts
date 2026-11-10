import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordTransport } from "../../src/services/recordSync";
import { supabaseRecordTransport } from "../../src/services/supabaseBrain";
import { HttpError } from "./http";

export type ActionTier = "internal" | "external_reversible" | "external_irreversible";
export type ActionStatus = "proposed" | "approved" | "rejected" | "executing" | "executed" | "failed";
export interface ActionRow {
  id: string; tool: string; tier: ActionTier; summary: string; reason: string; payload: Record<string, unknown>; payload_hash: string;
  status: ActionStatus; conversation_id: string | null; message_id: string | null; created_at: string; expires_at: string; result: unknown;
}
export interface SealedRow { ciphertext: string; iv: string; keyVersion: number; hint: string; updatedAt: string }
export interface ConnectionRow { provider: "google"; accountEmail: string; scopes: string[]; status: "active" | "needs_reconnect"; connectedAt: string; lastUsedAt: string | null; lastError: string | null }
export interface TelegramLinkRow { linked: boolean; username: string | null; timeZone: string; briefEnabled: boolean; briefHour: number; alertsEnabled: boolean }
export interface TelegramPrefs { timeZone?: string; briefEnabled?: boolean; briefHour?: number; alertsEnabled?: boolean }
export interface HealthSyncRow { hint: string; createdAt: string; lastSyncAt: string | null; lastSyncDays: number | null; lastSyncSource: string | null }
export interface AuditInput { actor: "user" | "assistant" | "system"; action: string; entityType?: string; entityId?: string; title?: string; actionId?: string; metadata?: Record<string, unknown> }

/** Everything the server reads or writes for one signed-in user. Supabase in production, memory in tests. */
export interface ServerStore {
  userId: string;
  records: RecordTransport;
  getSecret(name: string): Promise<SealedRow | null>;
  putSecret(name: string, row: Omit<SealedRow, "updatedAt">): Promise<void>;
  deleteSecret(name: string): Promise<void>;
  appendAudit(entry: AuditInput): Promise<void>;
  /** How many audit entries with this action were written since the given time (used for rate limits). */
  countAudit(action: string, sinceIso: string): Promise<number>;
  proposeAction(input: { tool: string; tier: ActionTier; summary: string; reason: string; payload: Record<string, unknown>; conversationId?: string; messageId?: string }): Promise<ActionRow>;
  getAction(id: string): Promise<ActionRow | null>;
  listPendingActions(): Promise<ActionRow[]>;
  decideAction(id: string, decision: "approve" | "reject", payloadHash: string): Promise<ActionRow>;
  claimAction(id: string): Promise<ActionRow>;
  completeAction(id: string, ok: boolean, result: unknown): Promise<void>;
  getEmbedding(key: string): Promise<number[] | undefined>;
  putEmbedding(key: string, vector: number[]): Promise<void>;
  documentTexts(ids: string[]): Promise<Map<string, string>>;
  getConnection(provider: "google"): Promise<ConnectionRow | null>;
  putConnection(row: Omit<ConnectionRow, "connectedAt" | "lastUsedAt" | "lastError">): Promise<void>;
  markConnection(provider: "google", patch: { status?: ConnectionRow["status"]; lastError?: string | null; used?: boolean }): Promise<void>;
  deleteConnection(provider: "google"): Promise<void>;
  getTelegramLink(): Promise<TelegramLinkRow | null>;
  beginTelegramLink(codeHash: string, timeZone: string): Promise<void>;
  setTelegramPrefs(prefs: TelegramPrefs): Promise<void>;
  deleteTelegramLink(): Promise<void>;
  getHealthSync(): Promise<HealthSyncRow | null>;
  /** Replaces the account's phone sync token (only its hash is stored). */
  setHealthSyncToken(tokenHash: string, hint: string): Promise<void>;
  deleteHealthSync(): Promise<void>;
}

/** Maps a Postgres error from one of our RPCs to a message the user can act on. */
function rpcError(error: { code?: string; message?: string } | null, fallback: string): never {
  if (error?.code === "40001") throw new HttpError(409, error.message || fallback);
  if (error?.code === "54000") throw new HttpError(429, error.message || fallback);
  if (error?.code === "22023" || error?.code === "23514") throw new HttpError(400, fallback);
  throw new HttpError(502, fallback);
}

export function supabaseStore(userId: string, client: SupabaseClient): ServerStore {
  return {
    userId,
    records: supabaseRecordTransport(userId, client),
    async getSecret(name) {
      const { data, error } = await client.from("user_secrets").select("ciphertext,iv,key_version,hint,updated_at").eq("user_id", userId).eq("name", name).maybeSingle();
      if (error) rpcError(error, "Could not read your stored credentials.");
      return data ? { ciphertext: data.ciphertext, iv: data.iv, keyVersion: data.key_version, hint: data.hint, updatedAt: data.updated_at } : null;
    },
    async putSecret(name, row) {
      const { error } = await client.from("user_secrets").upsert({ user_id: userId, name, ciphertext: row.ciphertext, iv: row.iv, key_version: row.keyVersion, hint: row.hint, updated_at: new Date().toISOString() });
      if (error) rpcError(error, "Could not store the credential.");
    },
    async deleteSecret(name) {
      const { error } = await client.from("user_secrets").delete().eq("user_id", userId).eq("name", name);
      if (error) rpcError(error, "Could not remove the credential.");
    },
    async appendAudit(e) {
      const { error } = await client.rpc("append_audit", { p_actor: e.actor, p_action: e.action, p_entity_type: e.entityType ?? null, p_entity_id: e.entityId ?? null,
        p_title: e.title ?? null, p_action_id: e.actionId ?? null, p_metadata: e.metadata ?? {} });
      if (error) rpcError(error, "Could not write the audit log.");
    },
    async countAudit(action, sinceIso) {
      const { count, error } = await client.from("audit_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("action", action).gte("at", sinceIso);
      if (error) rpcError(error, "Could not check recent activity.");
      return count || 0;
    },
    async proposeAction(input) {
      const { data, error } = await client.rpc("propose_action", { p_tool: input.tool, p_tier: input.tier, p_summary: input.summary, p_reason: input.reason,
        p_payload: input.payload, p_conversation_id: input.conversationId ?? null, p_message_id: input.messageId ?? null });
      if (error) rpcError(error, "Could not ask for your approval.");
      return data as ActionRow;
    },
    async getAction(id) {
      const { data, error } = await client.from("agent_actions").select("*").eq("id", id).maybeSingle();
      if (error) rpcError(error, "Could not load the action.");
      return data as ActionRow | null;
    },
    async listPendingActions() {
      const { data, error } = await client.from("agent_actions").select("*").eq("status", "proposed").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(50);
      if (error) rpcError(error, "Could not load actions waiting for approval.");
      return (data || []) as ActionRow[];
    },
    async decideAction(id, decision, payloadHash) {
      const { data, error } = await client.rpc("decide_action", { p_id: id, p_decision: decision, p_payload_hash: payloadHash });
      if (error) rpcError(error, "This action is no longer waiting for a decision.");
      return data as ActionRow;
    },
    async claimAction(id) {
      const { data, error } = await client.rpc("claim_action", { p_id: id });
      if (error) rpcError(error, "This action is not approved or has already run.");
      return data as ActionRow;
    },
    async completeAction(id, ok, result) {
      const { error } = await client.rpc("complete_action", { p_id: id, p_ok: ok, p_result: result ?? null });
      if (error) rpcError(error, "Could not record the action result.");
    },
    async getEmbedding(key) {
      const { data } = await client.from("passage_embeddings").select("vector").eq("user_id", userId).eq("key", key).maybeSingle();
      return data?.vector as number[] | undefined;
    },
    async putEmbedding(key, vector) {
      await client.from("passage_embeddings").upsert({ user_id: userId, key, vector });
    },
    async getConnection(provider) {
      const { data, error } = await client.from("connections").select("*").eq("user_id", userId).eq("provider", provider).maybeSingle();
      if (error) rpcError(error, "Could not read your connections.");
      return data ? { provider: data.provider, accountEmail: data.account_email, scopes: data.scopes, status: data.status, connectedAt: data.connected_at, lastUsedAt: data.last_used_at, lastError: data.last_error } : null;
    },
    async putConnection(row) {
      const { error } = await client.from("connections").upsert({ user_id: userId, provider: row.provider, account_email: row.accountEmail, scopes: row.scopes,
        status: row.status, connected_at: new Date().toISOString(), last_error: null });
      if (error) rpcError(error, "Could not save the connection.");
    },
    async markConnection(provider, patch) {
      const update: Record<string, unknown> = {};
      if (patch.status) update.status = patch.status;
      if (patch.lastError !== undefined) update.last_error = patch.lastError?.slice(0, 500) ?? null;
      if (patch.used) update.last_used_at = new Date().toISOString();
      if (Object.keys(update).length) await client.from("connections").update(update).eq("user_id", userId).eq("provider", provider);
    },
    async deleteConnection(provider) {
      const { error } = await client.from("connections").delete().eq("user_id", userId).eq("provider", provider);
      if (error) rpcError(error, "Could not remove the connection.");
    },
    async getTelegramLink() {
      const { data, error } = await client.from("telegram_links").select("chat_id,username,time_zone,brief_enabled,brief_hour,alerts_enabled").eq("user_id", userId).maybeSingle();
      if (error) rpcError(error, "Could not read your Telegram connection.");
      return data ? { linked: data.chat_id !== null, username: data.username, timeZone: data.time_zone, briefEnabled: data.brief_enabled, briefHour: data.brief_hour, alertsEnabled: data.alerts_enabled } : null;
    },
    async beginTelegramLink(codeHash, timeZone) {
      const { error } = await client.rpc("begin_telegram_link", { p_code_hash: codeHash, p_time_zone: timeZone });
      if (error) rpcError(error, "Could not start connecting Telegram.");
    },
    async setTelegramPrefs(prefs) {
      const { error } = await client.rpc("set_telegram_prefs", { p_time_zone: prefs.timeZone ?? null, p_brief_enabled: prefs.briefEnabled ?? null, p_brief_hour: prefs.briefHour ?? null, p_alerts_enabled: prefs.alertsEnabled ?? null });
      if (error) rpcError(error, "Could not save your Telegram settings.");
    },
    async deleteTelegramLink() {
      const { error } = await client.from("telegram_links").delete().eq("user_id", userId);
      if (error) rpcError(error, "Could not disconnect Telegram.");
    },
    async getHealthSync() {
      const { data, error } = await client.from("health_sync_tokens").select("hint,created_at,last_sync_at,last_sync_days,last_sync_source").eq("user_id", userId).maybeSingle();
      if (error) rpcError(error, "Could not read your health sync settings.");
      return data ? { hint: data.hint, createdAt: data.created_at, lastSyncAt: data.last_sync_at, lastSyncDays: data.last_sync_days, lastSyncSource: data.last_sync_source } : null;
    },
    async setHealthSyncToken(tokenHash, hint) {
      const { error } = await client.rpc("set_health_sync_token", { p_token_hash: tokenHash, p_hint: hint });
      if (error) rpcError(error, "Could not create a sync token.");
    },
    async deleteHealthSync() {
      const { error } = await client.from("health_sync_tokens").delete().eq("user_id", userId);
      if (error) rpcError(error, "Could not turn off health sync.");
    },
    async documentTexts(ids) {
      const texts = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 50) {
        const { data, error } = await client.from("study_documents").select("id,content").eq("user_id", userId).in("id", ids.slice(i, i + 50));
        if (error) rpcError(error, "Could not load course documents.");
        for (const row of data || []) texts.set(row.id, row.content);
      }
      return texts;
    },
  };
}

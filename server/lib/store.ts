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
export interface AuditInput { actor: "user" | "assistant" | "system"; action: string; entityType?: string; entityId?: string; title?: string; actionId?: string; metadata?: Record<string, unknown> }

/** Everything the server reads or writes for one signed-in user. Supabase in production, memory in tests. */
export interface ServerStore {
  userId: string;
  records: RecordTransport;
  getSecret(name: string): Promise<SealedRow | null>;
  putSecret(name: string, row: Omit<SealedRow, "updatedAt">): Promise<void>;
  deleteSecret(name: string): Promise<void>;
  appendAudit(entry: AuditInput): Promise<void>;
  proposeAction(input: { tool: string; tier: ActionTier; summary: string; reason: string; payload: Record<string, unknown>; conversationId?: string; messageId?: string }): Promise<ActionRow>;
  getAction(id: string): Promise<ActionRow | null>;
  listPendingActions(): Promise<ActionRow[]>;
  decideAction(id: string, decision: "approve" | "reject", payloadHash: string): Promise<ActionRow>;
  claimAction(id: string): Promise<ActionRow>;
  completeAction(id: string, ok: boolean, result: unknown): Promise<void>;
  getEmbedding(key: string): Promise<number[] | undefined>;
  putEmbedding(key: string, vector: number[]): Promise<void>;
  documentTexts(ids: string[]): Promise<Map<string, string>>;
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

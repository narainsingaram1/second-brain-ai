import type { AgentStep, AIMessage, BrainState } from "../../src/types";
import { AutonomousBrainAgent, type AgentExecutionResult, type ExternalToolset } from "../../src/services/agentDispatcher";
import { applyMutation, mutationRecords, type Mutation } from "../../src/services/brainTools";
import { applyBatch } from "../../src/services/batchChanges";
import { applyMemoryChange, normalizeAgentMemory } from "../../src/services/agentMemory";
import { learnFromTurn } from "../../src/services/memoryLearning";
import { toolTier } from "../../src/services/actionPolicy";
import { RecordSync, type SavedRecord } from "../../src/services/recordSync";
import type { PreparedImage } from "../../src/utils/imageInput";
import { HttpError } from "./http";
import type { ServerStore } from "./store";
import { combineToolsets, webToolset, type WebAccess } from "../../src/services/webTools";

/** The saved workspace, loaded as the user, with defaults for collections that have no records yet. */
export async function loadWorkspace(store: ServerStore): Promise<{ engine: RecordSync; workspace: BrainState }> {
  const engine = new RecordSync(store.records);
  const loaded = await engine.load();
  if (!loaded) throw new HttpError(409, "Cloud storage for this account has not been upgraded yet. Reload the app.");
  // Only what record storage guarantees, plus the group lists task changes extend. Preferences that were never
  // saved stay absent, so loading and saving back never writes defaults the user did not choose.
  return { engine, workspace: { ...loaded, userId: store.userId, sections: loaded.sections || [], subsections: loaded.subsections || {} } as BrainState };
}

/** Saves `next` per record. Refuses if any record changed elsewhere; returns what was saved for the browser to adopt. */
export async function saveWorkspace(engine: RecordSync, next: BrainState): Promise<{ records: SavedRecord[]; preferences: Record<string, unknown> }> {
  await engine.save(next);
  if (engine.pendingConflicts) throw new Error("This record was changed on another device in the meantime. Ask again to work from its current version.");
  return { records: engine.takeSaved(), preferences: engine.takeSavedPreferences() };
}

export interface AgentRequest {
  message: AIMessage;
  chatHistory: AIMessage[];
  conversationId?: string;
  model?: string;
  visionModel?: string;
  temporary?: boolean;
  images?: PreparedImage[];
  /** The user's IANA time zone, for dates in the prompt and in Google requests. */
  timeZone?: string;
  /** Keep this conversation on the server, for channels with no browser to hold it. `chatHistory` is added after it. */
  savedThread?: { id: string; title: string };
  /** How replies will be shown, when that is not the app. */
  channelNote?: string;
  /** The user's AI provider address, validated by the route; OpenRouter's default when absent. */
  providerBase?: string;
}

const SAVED_THREAD_CONTEXT = 40;
const SAVED_THREAD_LIMIT = 200;

export type AgentEvent =
  | { type: "progress"; message: string }
  | { type: "text"; text: string }
  | { type: "step"; step: AgentStep }
  | { type: "saved"; records: SavedRecord[]; preferences: Record<string, unknown>; action: string; entityType: Mutation["type"] | "memory"; title: string }
  | { type: "done"; result: AgentExecutionResult };

const recordTitle = (m: Mutation) => ("name" in m.record ? m.record.name : (m.record as { title?: string }).title) || "Note";

/**
 * Runs one assistant turn on the server for a signed-in user. Changes are saved per record with the same
 * revision checks as the browser; a record edited elsewhere during the turn is not overwritten. Each saved
 * change is audited and streamed back so the browser can show it at once.
 */
export async function runServerAgent(store: ServerStore, key: string, input: AgentRequest, emit: (event: AgentEvent) => void, signal: AbortSignal, externalTools?: ExternalToolset, web?: WebAccess): Promise<void> {
  const loading: AgentStep = { id: crypto.randomUUID(), kind: "prepare", label: "Opening your workspace", status: "running", startedAt: Date.now() };
  emit({ type: "step", step: loading });
  const { engine, workspace } = await loadWorkspace(store);
  // `stored` is the workspace as saved; the agent's own working copy also carries this conversation.
  let stored = workspace;
  const documentIds = (stored.study?.documents || []).map(d => d.id);
  const texts = documentIds.length ? await store.documentTexts(documentIds) : new Map<string, string>();
  // Only worth showing when it took a noticeable moment.
  emit({ type: "step", step: { ...loading, status: "done", endedAt: Date.now(), label: "Opened your workspace", hidden: Date.now() - loading.startedAt < 400 } });

  const state: BrainState = {
    ...stored,
    agentMemory: normalizeAgentMemory(stored.agentMemory),
    chatHistory: input.savedThread
      ? [...((stored.conversations || []).find(t => t.id === input.savedThread!.id)?.messages.slice(-SAVED_THREAD_CONTEXT) || []), ...input.chatHistory]
      : input.chatHistory,
    conversationId: input.conversationId,
    openRouterKey: key,
    selectedModel: input.model || stored.selectedModel || "",
    theme: stored.theme || "light",
  };

  const persist = async (next: BrainState, action: string, entityType: Mutation["type"] | "memory", title: string) => {
    const saved = await saveWorkspace(engine, next);
    stored = next;
    emit({ type: "saved", ...saved, action, entityType, title });
  };

  const result = await AutonomousBrainAgent.execute(input.message.content, state, key, state.selectedModel, {
    signal,
    temporary: input.temporary,
    currentMessage: input.message,
    images: input.images,
    visionModel: input.visionModel,
    timeZone: input.timeZone,
    channelNote: input.channelNote,
    providerBase: input.providerBase,
    externalTools: combineToolsets(web ? webToolset(web, key, state.selectedModel, input.providerBase) : undefined, externalTools),
    retrieval: {
      documentText: id => texts.get(id),
      embeddingCache: { get: k => store.getEmbedding(k), put: (k, v) => store.putEmbedding(k, v) },
      providerBase: input.providerBase,
    },
    onProgress: message => emit({ type: "progress", message }),
    onText: text => emit({ type: "text", text }),
    onStep: step => emit({ type: "step", step }),
    propose: async change => {
      const tier = toolTier(change.tool);
      const row = await store.proposeAction({
        tool: change.tool, tier: tier === "read" ? "internal" : tier, summary: change.summary.slice(0, 2000), reason: change.reason.slice(0, 500),
        payload: { tool: change.tool, args: change.args,
          // A batch keeps what each of its changes expects to find, in order.
          expected: change.mutations ? change.mutations.map(m => m.expected ?? null) : change.mutation?.expected ?? null, details: change.details, ...(input.timeZone ? { timeZone: input.timeZone } : {}),
          ...(change.preview ? { preview: change.preview } : {}), ...(change.warnings?.length ? { warnings: change.warnings } : {}) },
        conversationId: input.conversationId, messageId: input.message.id,
      });
      return { id: row.id, tool: change.tool, summary: change.summary, details: change.details, reason: change.reason, status: "pending", remote: true, payloadHash: row.payload_hash,
        ...(change.preview ? { preview: change.preview } : {}), ...(change.warnings?.length ? { warnings: change.warnings } : {}) };
    },
    getMemory: () => normalizeAgentMemory(stored.agentMemory),
    commitMemory: async change => {
      const memory = applyMemoryChange(normalizeAgentMemory(stored.agentMemory), change);
      await persist({ ...stored, agentMemory: memory }, "memory", "memory", change.kind === "remember" ? change.entry.topic : "Memory");
      return memory;
    },
    commitBatch: async mutations => {
      const next = applyBatch(stored, mutations); // Refuses the whole batch if any record changed during the turn.
      const n = mutations.length;
      await persist(next, n === 1 ? mutations[0].action : "apply_changes", mutations[0].type, n === 1 ? recordTitle(mutations[0]) : `${n} changes`);
      for (const mutation of mutations)
        await store.appendAudit({ actor: "assistant", action: mutation.action, entityType: mutation.type, entityId: mutation.record.id, title: recordTitle(mutation),
          metadata: { conversationId: input.conversationId ?? null, batch: true } });
    },
    commit: async mutation => {
      if (mutation.expected) {
        const current = mutationRecords(stored, mutation.type).find(r => r.id === mutation.record.id);
        if (JSON.stringify(current) !== JSON.stringify(mutation.expected))
          throw new Error("This record changed during the conversation. Start a new turn to review its current state.");
      }
      await persist(applyMutation(stored, mutation), mutation.action, mutation.type, recordTitle(mutation));
      await store.appendAudit({ actor: "assistant", action: mutation.action, entityType: mutation.type, entityId: mutation.record.id, title: recordTitle(mutation),
        metadata: { conversationId: input.conversationId ?? null } });
    },
  });
  emit({ type: "done", result });
  if (input.savedThread) await finishSavedThread(input.savedThread, result).catch(error => console.error("[agent] saving the conversation failed", error instanceof Error ? error.message : error));

  /** Stores the exchange and learns from it. The reply has already gone out, so a failure here costs nothing visible. */
  async function finishSavedThread(thread: NonNullable<AgentRequest["savedThread"]>, outcome: AgentExecutionResult) {
    const existing = (stored.conversations || []).find(t => t.id === thread.id);
    const reply: AIMessage = { id: crypto.randomUUID(), role: "assistant", content: outcome.queryAnswer, timestamp: new Date().toISOString(), ...(outcome.approvals?.length ? { approvals: outcome.approvals } : {}) };
    const updated = { id: thread.id, title: thread.title, messages: [...(existing?.messages || []), input.message, reply].slice(-SAVED_THREAD_LIMIT), updatedAt: new Date().toISOString() };
    await persist({ ...stored, conversations: [updated, ...(stored.conversations || []).filter(t => t.id !== thread.id)] }, "conversation", "memory", thread.title);
    const changes = await learnFromTurn({ ...stored, agentMemory: normalizeAgentMemory(stored.agentMemory), openRouterKey: key, conversationId: thread.id, chatHistory: [] }, input.message, outcome.queryAnswer, signal, input.providerBase);
    if (changes.length) await persist({ ...stored, agentMemory: applyMemoryChange(normalizeAgentMemory(stored.agentMemory), { kind: "batch", changes }) }, "memory", "memory", "Memory");
  }
}

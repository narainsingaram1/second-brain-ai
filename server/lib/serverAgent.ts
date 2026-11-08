import type { AIMessage, BrainState } from "../../src/types";
import { AutonomousBrainAgent, type AgentExecutionResult, type ExternalToolset } from "../../src/services/agentDispatcher";
import { applyMutation, mutationRecords, type Mutation } from "../../src/services/brainTools";
import { applyMemoryChange, normalizeAgentMemory } from "../../src/services/agentMemory";
import { toolTier } from "../../src/services/actionPolicy";
import { RecordSync, type SavedRecord } from "../../src/services/recordSync";
import type { PreparedImage } from "../../src/utils/imageInput";
import { HttpError } from "./http";
import type { ServerStore } from "./store";

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
}

export type AgentEvent =
  | { type: "progress"; message: string }
  | { type: "text"; text: string }
  | { type: "saved"; records: SavedRecord[]; preferences: Record<string, unknown>; action: string; entityType: Mutation["type"] | "memory"; title: string }
  | { type: "done"; result: AgentExecutionResult };

const recordTitle = (m: Mutation) => ("name" in m.record ? m.record.name : (m.record as { title?: string }).title) || "Note";

/**
 * Runs one assistant turn on the server for a signed-in user. Changes are saved per record with the same
 * revision checks as the browser; a record edited elsewhere during the turn is not overwritten. Each saved
 * change is audited and streamed back so the browser can show it at once.
 */
export async function runServerAgent(store: ServerStore, key: string, input: AgentRequest, emit: (event: AgentEvent) => void, signal: AbortSignal, externalTools?: ExternalToolset): Promise<void> {
  const { engine, workspace } = await loadWorkspace(store);
  // `stored` is the workspace as saved; the agent's own working copy also carries this conversation.
  let stored = workspace;
  const documentIds = (stored.study?.documents || []).map(d => d.id);
  const texts = documentIds.length ? await store.documentTexts(documentIds) : new Map<string, string>();

  const state: BrainState = {
    ...stored,
    agentMemory: normalizeAgentMemory(stored.agentMemory),
    chatHistory: input.chatHistory,
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
    externalTools,
    retrieval: {
      documentText: id => texts.get(id),
      embeddingCache: { get: k => store.getEmbedding(k), put: (k, v) => store.putEmbedding(k, v) },
    },
    onProgress: message => emit({ type: "progress", message }),
    onText: text => emit({ type: "text", text }),
    propose: async change => {
      const tier = toolTier(change.tool);
      const row = await store.proposeAction({
        tool: change.tool, tier: tier === "read" ? "internal" : tier, summary: change.summary.slice(0, 2000), reason: change.reason.slice(0, 500),
        payload: { tool: change.tool, args: change.args, expected: change.mutation?.expected ?? null, details: change.details, ...(input.timeZone ? { timeZone: input.timeZone } : {}),
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
}

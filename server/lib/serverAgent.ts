import type { AIMessage, BrainState } from "../../src/types";
import { AutonomousBrainAgent, type AgentExecutionResult } from "../../src/services/agentDispatcher";
import { applyMutation, mutationRecords, type Mutation } from "../../src/services/brainTools";
import { applyMemoryChange, normalizeAgentMemory } from "../../src/services/agentMemory";
import { preferencesOf } from "../../src/services/brainRecords";
import { RecordSync, type SavedRecord } from "../../src/services/recordSync";
import type { PreparedImage } from "../../src/utils/imageInput";
import { HttpError } from "./http";
import type { ServerStore } from "./store";

export interface AgentRequest {
  message: AIMessage;
  chatHistory: AIMessage[];
  conversationId?: string;
  model?: string;
  visionModel?: string;
  temporary?: boolean;
  images?: PreparedImage[];
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
export async function runServerAgent(store: ServerStore, key: string, input: AgentRequest, emit: (event: AgentEvent) => void, signal: AbortSignal): Promise<void> {
  const engine = new RecordSync(store.records);
  const loaded = await engine.load();
  if (!loaded) throw new HttpError(409, "Cloud storage for this account has not been upgraded yet. Reload the app.");
  // `stored` is the workspace as saved; the agent's own working copy also carries this conversation.
  let stored = { ...loaded, userId: store.userId } as BrainState;
  const documentIds = (stored.study?.documents || []).map(d => d.id);
  const texts = documentIds.length ? await store.documentTexts(documentIds) : new Map<string, string>();

  const state: BrainState = {
    ...stored,
    tasks: stored.tasks || [], goals: stored.goals || [], habits: stored.habits || [], journalEntries: stored.journalEntries || [],
    knowledgeItems: stored.knowledgeItems || [], trackerItems: stored.trackerItems || [], sections: stored.sections || [], subsections: stored.subsections || {},
    agentMemory: normalizeAgentMemory(stored.agentMemory),
    chatHistory: input.chatHistory,
    conversationId: input.conversationId,
    openRouterKey: key,
    selectedModel: input.model || stored.selectedModel || "",
    theme: stored.theme || "light",
  };

  const persist = async (next: BrainState, action: string, entityType: Mutation["type"] | "memory", title: string) => {
    const before = preferencesOf(stored);
    await engine.save(next);
    if (engine.pendingConflicts) throw new Error("This record was changed on another device during the conversation. Ask again to work from its current version.");
    stored = next;
    const after = preferencesOf(next);
    const preferences = Object.fromEntries(Object.entries(after).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])));
    emit({ type: "saved", records: engine.takeSaved(), preferences, action, entityType, title });
  };

  const result = await AutonomousBrainAgent.execute(input.message.content, state, key, state.selectedModel, {
    signal,
    temporary: input.temporary,
    currentMessage: input.message,
    images: input.images,
    visionModel: input.visionModel,
    retrieval: {
      documentText: id => texts.get(id),
      embeddingCache: { get: k => store.getEmbedding(k), put: (k, v) => store.putEmbedding(k, v) },
    },
    onProgress: message => emit({ type: "progress", message }),
    onText: text => emit({ type: "text", text }),
    getMemory: () => stored.agentMemory,
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

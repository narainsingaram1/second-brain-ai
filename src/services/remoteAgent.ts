import type { AgentStep, AIMessage } from "../types";
import type { AgentExecutionResult } from "./agentDispatcher";
import type { SavedRecord } from "./recordSync";
import { apiFetch } from "./serverApi";
import type { PreparedImage } from "../utils/imageInput";

export interface RemoteTurn {
  message: AIMessage;
  chatHistory: AIMessage[];
  conversationId?: string;
  model?: string;
  visionModel?: string;
  temporary?: boolean;
  images?: PreparedImage[];
  timeZone?: string;
}
export interface RemoteHandlers {
  signal: AbortSignal;
  onProgress: (message: string) => void;
  onText: (text: string) => void;
  onStep?: (step: AgentStep) => void;
  /** A change the server saved: records with their new revisions, plus any changed preferences. */
  onSaved: (records: SavedRecord[], preferences: Record<string, unknown>, action: string, entityType: string, title: string) => void;
  /** An action waiting for the user's approval (set in a later step). */
  onApproval?: (action: unknown) => void;
}

/** Turns larger than this run in the browser instead (the hosting platform caps request bodies). */
export const MAX_REMOTE_TURN_BYTES = 4_300_000;

/** Parses a server-sent event stream into `{ type, ...data }` objects as they arrive. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, any>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = done ? "" : blocks.pop() || "";
    for (const block of blocks) {
      const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (data) yield JSON.parse(data);
    }
    if (done) return;
  }
}

/** Runs one assistant turn on the server. Saved changes are reported as they happen; the result arrives last. */
export async function runRemoteTurn(turn: RemoteTurn, handlers: RemoteHandlers): Promise<AgentExecutionResult> {
  const body = JSON.stringify(turn);
  const response = await apiFetch("/api/agent", { method: "POST", body, signal: handlers.signal });
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error || `The assistant is unavailable (HTTP ${response.status}).`);
  }
  for await (const event of readEvents(response.body)) {
    if (event.type === "progress") handlers.onProgress(event.message);
    else if (event.type === "text") handlers.onText(event.text);
    else if (event.type === "step") handlers.onStep?.(event.step);
    else if (event.type === "saved") handlers.onSaved(event.records, event.preferences, event.action, event.entityType, event.title);
    else if (event.type === "approval") handlers.onApproval?.(event.action);
    else if (event.type === "error") throw new Error(event.message);
    else if (event.type === "done") return event.result as AgentExecutionResult;
  }
  throw new Error("The connection to the assistant closed before it finished. Any changes it reported are saved.");
}

import type { AIMessage } from "../../src/types";
import { productionDeps, providerKey, type Deps } from "../lib/context";
import { HttpError, readJson, route } from "../lib/http";
import { runServerAgent, type AgentEvent, type AgentRequest } from "../lib/serverAgent";
import { googleSession } from "../lib/google";
import { validTimeZone } from "../lib/googleApi";
import { googleToolset } from "../lib/googleTools";

// Vercel rejects request bodies over 4.5 MB; the browser runs larger (image-heavy) turns itself.
const MAX_BODY = 4_400_000;

function validMessage(value: unknown): value is AIMessage {
  const m = value as AIMessage;
  return !!m && typeof m === "object" && typeof m.id === "string" && m.id.length <= 200 && (m.role === "user" || m.role === "assistant" || m.role === "system")
    && typeof m.content === "string" && m.content.length <= 200_000;
}

/** Parses and bounds the turn the browser sends. Everything else is loaded from the database as the user. */
export function parseAgentRequest(body: Record<string, unknown>): AgentRequest {
  const message = body.message;
  if (!validMessage(message) || message.role !== "user" || (!message.content.trim() && !Array.isArray(body.images))) throw new HttpError(400, "Message cannot be empty.");
  const history = Array.isArray(body.chatHistory) ? body.chatHistory : [];
  if (history.length > 400 || !history.every(validMessage)) throw new HttpError(400, "Conversation history is invalid or too long.");
  const images = Array.isArray(body.images) ? body.images : [];
  if (images.length > 6 || !images.every(i => i && typeof i.dataUrl === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(i.dataUrl) && typeof i.name === "string"))
    throw new HttpError(400, "Images are invalid.");
  const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max ? v : undefined;
  return {
    message, chatHistory: history as AIMessage[], images,
    conversationId: text(body.conversationId, 200), model: text(body.model, 200), visionModel: text(body.visionModel, 200),
    temporary: body.temporary === true,
    timeZone: validTimeZone(body.timeZone),
  };
}

/**
 * Runs an assistant turn on the server and streams it as server-sent events: progress, text as it is
 * written, each saved change, and the final result. Closing the connection stops the turn.
 */
export function agentHandlers(deps: Deps = productionDeps) {
  return {
    POST: route(async request => {
      const { store } = await deps.caller(request);
      const input = parseAgentRequest(await readJson<Record<string, unknown>>(request, MAX_BODY));
      const key = await providerKey(deps, store);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          let open = true;
          const send = (event: AgentEvent | { type: "error"; message: string; status: number }) => {
            if (open) controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
          };
          try {
            // Google tools are offered only when connected and only for the access granted.
            const google = await googleSession(deps, store).catch(() => null);
            const tools = google ? googleToolset(google, store, input.timeZone || "UTC") : undefined;
            await runServerAgent(store, key, input, send, request.signal, tools);
          } catch (error) {
            const status = error instanceof HttpError ? error.status : 500;
            if (!(error instanceof HttpError)) console.error("[api/agent] turn failed", error);
            send({ type: "error", status, message: error instanceof HttpError ? error.message : "The assistant failed on the server. Try again." });
          } finally {
            open = false;
            controller.close();
          }
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
    }),
  };
}

export const { POST } = agentHandlers();

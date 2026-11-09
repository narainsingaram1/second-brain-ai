import { DEFAULT_PROVIDER_BASE } from "../../src/services/providerTransport";
import { productionDeps, providerKey, type Deps } from "../lib/context";
import { HttpError, readJson, route, safeProviderBase } from "../lib/http";

const ENDPOINTS = new Set(["chat/completions", "embeddings"]);

/**
 * Forwards the app's AI requests to the user's provider (OpenRouter by default) with the caller's stored
 * key, so features that run in the browser (journal insights, flashcards, search) work without the key
 * ever being sent to the browser. Only the chat and embedding endpoints are reachable, and responses
 * (including streams) pass through.
 */
export function aiHandlers(deps: Deps = productionDeps, upstream: typeof fetch = (...args) => fetch(...args)) {
  return {
    POST: route(async request => {
      const params = new URL(request.url).searchParams;
      const endpoint = params.get("endpoint") || "";
      if (!ENDPOINTS.has(endpoint)) throw new HttpError(400, "Unsupported AI endpoint.");
      const baseParam = params.get("base") || "";
      const base = baseParam ? safeProviderBase(baseParam) : undefined;
      if (baseParam && !base) throw new HttpError(400, "The AI provider address is not allowed.");
      const { store } = await deps.caller(request);
      const body = await readJson<Record<string, unknown>>(request, 8_000_000);
      if (!body || typeof body !== "object" || typeof body.model !== "string" || body.model.length > 200) throw new HttpError(400, "Choose a model.");
      const key = await providerKey(deps, store);
      const response = await upstream(`${base || DEFAULT_PROVIDER_BASE}/${endpoint}`, {
        method: "POST",
        signal: request.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://synapse-second-brain.local", "X-Title": "Synapse Second Brain" },
        body: JSON.stringify(body),
      });
      return new Response(response.body, {
        status: response.status,
        headers: { "Content-Type": response.headers.get("content-type") || "application/json", "Cache-Control": "no-store" },
      });
    }),
  };
}

export const { POST } = aiHandlers();

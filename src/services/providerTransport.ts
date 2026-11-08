/**
 * Every request to the AI provider goes through here. With a key held in the browser (desktop or local
 * mode) it calls OpenRouter directly. When the key is stored encrypted on the server, the browser only
 * knows SERVER_HELD_KEY and requests go through the authenticated /api/ai proxy, which adds the key
 * server-side, so the key never reaches the browser.
 */
export const SERVER_HELD_KEY = "server-held-key";
export type ProviderEndpoint = "chat/completions" | "embeddings";

let accessToken: (() => Promise<string>) | null = null;
/** Registers how to obtain the signed-in user's access token for proxied requests. */
export function setProviderProxyAuth(getToken: (() => Promise<string>) | null) { accessToken = getToken; }

export const isServerHeldKey = (key: string | undefined) => key === SERVER_HELD_KEY;

export async function providerFetch(endpoint: ProviderEndpoint, apiKey: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  if (isServerHeldKey(apiKey)) {
    if (!accessToken) throw new Error("Sign in again to use the AI provider key stored on the server.");
    return fetch(`/api/ai?endpoint=${encodeURIComponent(endpoint)}`, {
      method: "POST", signal,
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  return fetch(`https://openrouter.ai/api/v1/${endpoint}`, {
    method: "POST", signal,
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://synapse-second-brain.local",
      "X-Title": "Synapse Second Brain",
    },
    body: JSON.stringify(body),
  });
}

/**
 * Every request to the AI provider goes through here. The default provider is OpenRouter; the user can
 * point any call at another OpenAI-compatible address with the "API address" setting (this device's
 * preference). With a key held in the browser (desktop or local mode) the provider is called directly.
 * When the key is stored encrypted on the server, the browser only knows SERVER_HELD_KEY and requests
 * go through the authenticated /api/ai proxy, which adds the key server-side, so the key never reaches
 * the browser.
 */
export const DEFAULT_PROVIDER_BASE = "https://openrouter.ai/api/v1";
export const HAI_PROVIDER_BASE = "https://hai.mehapps.com/v1";
/** Suggested alias; the authenticated model catalog is authoritative. */
export const HAI_DEFAULT_MODEL = "qwen3.8-27b";
export function isHaiProvider(base = providerBase()): boolean {
  try { return new URL(base).origin === "https://hai.mehapps.com"; } catch { return false; }
}
export function validProviderModel(model: string, base: string): boolean {
  return base === DEFAULT_PROVIDER_BASE ? /^[^\s/]+\/[^\s]+$/.test(model) : /^[^\s]+$/.test(model);
}
export const SERVER_HELD_KEY = "server-held-key";
export type ProviderEndpoint = "chat/completions" | "embeddings" | "models";

const BASE_STORAGE_KEY = "synapse.providerBase";

/** Normalizes an AI provider address; anything unusable falls back to OpenRouter's default. */
export function normalizeProviderBase(value?: string): string {
  const raw = (value || "").trim();
  if (!raw || raw === DEFAULT_PROVIDER_BASE) return DEFAULT_PROVIDER_BASE;
  let url: URL;
  try { url = new URL(raw); } catch { return DEFAULT_PROVIDER_BASE; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_PROVIDER_BASE;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** The AI provider address this device is pointed at (a per-device preference, like the model choices). */
export function providerBase(): string {
  try { return normalizeProviderBase(window.localStorage.getItem(BASE_STORAGE_KEY) || ""); } catch { return DEFAULT_PROVIDER_BASE; }
}

/** Sets the AI provider address ("" restores OpenRouter); returns the address that will be used. */
export function setProviderBase(value?: string): string {
  const next = normalizeProviderBase(value);
  try {
    if (next === DEFAULT_PROVIDER_BASE) window.localStorage.removeItem(BASE_STORAGE_KEY);
    else window.localStorage.setItem(BASE_STORAGE_KEY, next);
  } catch { /* Preference only. */ }
  return next;
}

/** The full URL of a provider endpoint under the given address (defaulting to this device's). */
export function providerUrl(base: string | undefined, endpoint: string): string {
  return `${(base || providerBase()).replace(/\/+$/, "")}/${endpoint}`;
}

let accessToken: (() => Promise<string>) | null = null;
/** Registers how to obtain the signed-in user's access token for proxied requests. */
export function setProviderProxyAuth(getToken: (() => Promise<string>) | null) { accessToken = getToken; }

export const isServerHeldKey = (key: string | undefined) => key === SERVER_HELD_KEY;

/**
 * `base` is the provider address for this call (the server passes the user's per-request setting);
 * without it the device's preference is used.
 */
export async function providerFetch(endpoint: ProviderEndpoint, apiKey: string, body: unknown, signal?: AbortSignal, base?: string): Promise<Response> {
  const target = base || providerBase();
  // Background jobs still pass OpenRouter defaults; HAI needs its own model alias.
  if (isHaiProvider(target) && endpoint === "chat/completions" && body && typeof body === "object") {
    const payload = body as Record<string, unknown>;
    if (typeof payload.model === "string" && new Set(["anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "anthropic/claude-haiku-5.5", "google/gemini-3.8-flash", "deepseek/deepseek-v4.1-flash", "nvidia/nemotron-3.5-super-vl", "nvidia/nemotron-3.5-super-vl:free"]).has(payload.model)) {
      let model = HAI_DEFAULT_MODEL;
      try { model = window.localStorage.getItem("synapse.haiModel") || model; } catch { /* Server uses the default alias. */ }
      body = { ...payload, model };
    }
  }
  if (isServerHeldKey(apiKey)) {
    if (!accessToken) throw new Error("Sign in again to use the AI provider key stored on the server.");
    const baseParam = target === DEFAULT_PROVIDER_BASE ? "" : `&base=${encodeURIComponent(target)}`;
    return fetch(`/api/ai?endpoint=${encodeURIComponent(endpoint)}${baseParam}`, {
      method: "POST", signal,
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  return fetch(`${target.replace(/\/+$/, "")}/${endpoint}`, {
    method: endpoint === "models" ? "GET" : "POST", signal,
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://synapse-second-brain.local",
      "X-Title": "Synapse Second Brain",
    },
    ...(endpoint === "models" ? {} : { body: JSON.stringify(body) }),
  });
}

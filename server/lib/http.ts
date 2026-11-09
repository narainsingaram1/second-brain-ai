import { isPrivateAddress } from "../../src/services/webTools";

/** An error whose message is safe to show the user. Anything else becomes a generic 500. */
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * The user's AI provider address, when the server is allowed to call it on the user's behalf: it must be
 * a plain http(s) URL on a public host, because the server would never reach the user's own machine from
 * here. Returns the normalized address (origin plus path, no trailing slash), or null when the value is
 * present but unusable.
 */
export function safeProviderBase(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return undefined; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const host = url.hostname;
  if (!host || host === "localhost" || /\.local$/i.test(host) || /\.internal$/i.test(host)) return undefined;
  try { if (isPrivateAddress(host)) return undefined; } catch { return undefined; }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

/** Wraps a route handler: maps HttpError to its status and hides unexpected errors behind a generic message. */
export function route(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error("[api] unexpected error", error);
      return json({ error: "Something went wrong on the server. Try again." }, 500);
    }
  };
}

export async function readJson<T>(request: Request, maxBytes = 1_000_000): Promise<T> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request is too large.");
  try { return JSON.parse(text) as T; } catch { throw new HttpError(400, "Request body must be JSON."); }
}

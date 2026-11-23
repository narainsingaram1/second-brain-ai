import { cleanDomains, MAX_LIMIT, readUrl, SearchLimitError } from "../../src/services/webTools";
import { productionDeps, type Deps } from "../lib/context";
import { HttpError, json, readJson, route } from "../lib/http";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The app's own dev server (`vite` on this computer) answers without a sign-in; anywhere else the caller
 * must be signed in, so a deployed copy can't be used as an open proxy.
 */
async function allowed(request: Request, deps: Deps) {
  const url = new URL(request.url);
  // A JSON body forces browsers to ask first, so other websites can't make the dev server fetch for them.
  if (!(request.headers.get("content-type") || "").includes("application/json")) throw new HttpError(415, "Send JSON.");
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) throw new HttpError(403, "Not allowed.");
  if (!LOOPBACK.has(url.hostname)) await deps.caller(request);
}

/**
 * Opens a link for the assistant when the turn runs in the browser. Browsers can't read most sites
 * (they don't allow cross-origin reads), so the page is fetched here with the same checks the server
 * assistant uses: private and local addresses are refused at every redirect.
 */
export function readHandlers(deps: Deps = productionDeps) {
  return {
    POST: route(async request => {
      await allowed(request, deps);
      const web = deps.web?.();
      if (!web) throw new HttpError(503, "Opening links isn't available on this server.");
      const body = await readJson<{ url?: unknown; offset?: unknown; limit?: unknown; query?: unknown; domains?: unknown; excludeDomains?: unknown }>(request, 10_000);
      if (body.query !== undefined) {
        if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 400) throw new HttpError(400, "Enter a search query of up to 400 characters.");
        if (!web.search) throw new HttpError(503, "Web search isn't available on this server.");
        try {
          const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
          return json({ results: await web.search(body.query, {
            domains: cleanDomains(body.domains), excludeDomains: cleanDomains(body.excludeDomains),
          }, signal) });
        } catch (error) {
          if (request.signal.aborted) throw error;
          if (error instanceof SearchLimitError) throw new HttpError(429, error.message);
          throw new HttpError(502, "The search provider did not respond.");
        }
      }
      const limit = Math.min(Math.max(Number(body.limit) || 0, 0), MAX_LIMIT) || undefined;
      try {
        return json(await readUrl(String(body.url || ""), Number(body.offset) || 0, web, request.signal, limit));
      } catch (error) {
        if (request.signal.aborted) throw error;
        // readUrl's messages say why the page couldn't be read, in words meant for the user.
        throw new HttpError(422, error instanceof Error ? error.message : "The page couldn't be read.");
      }
    }),
  };
}

export const { POST } = readHandlers();

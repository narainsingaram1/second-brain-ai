import { productionDeps, type Deps } from "../lib/context";
import { serverEnv } from "../lib/env";
import { HttpError, json, readJson, route } from "../lib/http";
import { healthTokenHash, ingestHealth, looksLikeHealthToken, newHealthToken, payloadSource } from "../lib/healthSync";

const TOKEN_HEADER = "x-health-token";

/**
 * Automatic Apple Health sync. The phone (Health Auto Export or an iOS Shortcut) POSTs its data here with
 * the account's sync token; signed-in requests show the status, create or replace the token, and revoke it.
 */
export function healthSyncHandlers(deps: Deps = productionDeps, publicUrl: () => string = () => serverEnv().publicAppUrl) {
  const endpoint = (request: Request) => `${(publicUrl() || new URL(request.url).origin).replace(/\/$/, "")}/api/healthsync`;
  const view = async (request: Request, store: Awaited<ReturnType<Deps["caller"]>>["store"]) => {
    const row = await store.getHealthSync();
    return { available: !!deps.admin?.(), endpoint: endpoint(request), connected: !!row, ...(row ? row : {}) };
  };
  const phoneToken = (request: Request) => {
    const header = request.headers.get(TOKEN_HEADER)?.trim();
    if (header) return header;
    const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    return looksLikeHealthToken(bearer) ? bearer : null;
  };
  return {
    GET: route(async request => {
      const { store } = await deps.caller(request);
      return json(await view(request, store));
    }),
    POST: route(async request => {
      const token = phoneToken(request);
      if (token !== null) {
        const admin = deps.admin?.();
        if (!admin) throw new HttpError(503, "Health sync is not set up on this server yet.");
        if (!looksLikeHealthToken(token)) throw new HttpError(401, "This sync token is not valid. Create a new one in the Health workspace.");
        const payload = await readJson<unknown>(request, 4_000_000);
        return json(await ingestHealth(admin, token, payload, payloadSource(payload, request.headers.get("x-health-source"))));
      }
      if (!deps.admin?.()) throw new HttpError(503, "Health sync needs SUPABASE_SERVICE_ROLE_KEY on the server.");
      const { store } = await deps.caller(request);
      const fresh = newHealthToken();
      await store.setHealthSyncToken(await healthTokenHash(fresh), fresh.slice(-4));
      await store.appendAudit({ actor: "user", action: "created health sync token", entityType: "connection", entityId: "apple-health", title: "Apple Health" });
      return json({ ...(await view(request, store)), token: fresh });
    }),
    DELETE: route(async request => {
      const { store } = await deps.caller(request);
      await store.deleteHealthSync();
      await store.appendAudit({ actor: "user", action: "revoked health sync token", entityType: "connection", entityId: "apple-health", title: "Apple Health" });
      return json(await view(request, store));
    }),
  };
}

export const { GET, POST, DELETE } = healthSyncHandlers();

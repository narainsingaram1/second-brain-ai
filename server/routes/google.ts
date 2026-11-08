import { productionDeps, secretsAvailable, type Deps } from "../lib/context";
import { completeGoogleConnection, connectionStatus, disconnectGoogle, googleSession, startGoogleConnection, type GoogleAccess } from "../lib/google";
import { listEvents, validTimeZone } from "../lib/googleApi";
import { HttpError, json, readJson, route } from "../lib/http";

/**
 * Connecting Google Calendar and Gmail. The browser starts the flow, Google redirects back to the app, and
 * the signed-in app posts the code here, so every step runs as the user. Also lists calendar events for
 * the app's calendar view.
 */
export function googleHandlers(deps: Deps = productionDeps) {
  const requireConfigured = async () => {
    if (!deps.google?.()) throw new HttpError(503, "Google connections are not set up on this server yet.");
    if (!await secretsAvailable(deps)) throw new HttpError(503, "Secure storage is not set up on this server yet.");
  };
  return {
    GET: route(async request => {
      const params = new URL(request.url).searchParams;
      const action = params.get("action") || "status";
      const { userId, store } = await deps.caller(request);
      if (action === "status") return json({ configured: !!deps.google?.(), ...connectionStatus(await store.getConnection("google")) });
      await requireConfigured();
      if (action === "start") {
        const access = params.get("access") === "gmail" ? "gmail" : params.get("access") === "calendar" ? "calendar" : null;
        if (!access) throw new HttpError(400, "Choose Calendar or Calendar and Gmail.");
        return json(await startGoogleConnection(deps, request, userId, access as GoogleAccess));
      }
      if (action === "events") {
        const google = await googleSession(deps, store);
        if (!google) return json({ connected: false, events: [] });
        const events = await listEvents(google, params.get("from") || "", params.get("to") || "", validTimeZone(params.get("timeZone")));
        return json({ connected: true, events });
      }
      throw new HttpError(400, "Unknown request.");
    }),
    POST: route(async request => {
      await requireConfigured();
      const { store } = await deps.caller(request);
      const body = await readJson<{ code?: unknown; state?: unknown; verifier?: unknown }>(request, 10_000);
      const text = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max ? v : "";
      const input = { code: text(body.code, 2000), state: text(body.state, 2000), verifier: text(body.verifier, 200) };
      if (!input.code || !input.state || !input.verifier) throw new HttpError(400, "This connection link is incomplete. Start again from Settings.");
      return json(await completeGoogleConnection(deps, request, store, input));
    }),
    DELETE: route(async request => {
      const { store } = await deps.caller(request);
      await disconnectGoogle(deps, store);
      return json({ connected: false });
    }),
  };
}

export const { GET, POST, DELETE } = googleHandlers();

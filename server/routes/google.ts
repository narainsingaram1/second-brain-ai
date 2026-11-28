import { describeExternal, toolTier } from "../../src/services/actionPolicy";
import { productionDeps, secretsAvailable, type Deps } from "../lib/context";
import { completeGoogleConnection, connectionStatus, disconnectGoogle, googleSession, startGoogleConnection, type GoogleAccess } from "../lib/google";
import { listEvents, validTimeZone } from "../lib/googleApi";
import { googleToolset } from "../lib/googleTools";
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
      if (action === "tools") {
        if (!deps.google?.() || !(await secretsAvailable(deps))) return json({ connected: false, definitions: [], instructions: "" });
        const google = await googleSession(deps, store);
        const tools = google && googleToolset(google, store, validTimeZone(params.get("timeZone")) || "UTC");
        if (!tools) return json({ connected: false, definitions: [], instructions: "" });
        return json({ connected: true, definitions: tools.definitions, instructions: tools.instructions });
      }
      await requireConfigured();
      if (action === "start") {
        const requested = params.get("access");
        const access = requested === "calendar" || requested === "gmail" || requested === "send" ? requested : null;
        if (!access) throw new HttpError(400, "Choose Calendar, Calendar and Gmail, or Gmail with sending.");
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
      const action = new URL(request.url).searchParams.get("action") || "complete";
      const { store } = await deps.caller(request);
      const text = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max ? v : "";
      if (action === "tool" || action === "propose") {
        const body = await readJson<{ tool?: unknown; args?: unknown; timeZone?: unknown; conversationId?: unknown; messageId?: unknown; reason?: unknown; summary?: unknown; details?: unknown }>(request, 100_000);
        const toolName = text(body.tool, 100);
        const toolArgs = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? (body.args as Record<string, unknown>) : {};
        const timeZone = validTimeZone(body.timeZone) || "UTC";
        const google = await googleSession(deps, store);
        const tools = google && googleToolset(google, store, timeZone);
        if (!tools?.definitions.some(t => t.function.name === toolName)) throw new HttpError(403, "Connect Google in Settings to use this tool.");
        if (action === "tool") {
          if (toolName === "send_email" || toolName === "send_draft") throw new HttpError(403, "Sending email needs the user's approval.");
          return json(await tools.execute(toolName, toolArgs, request.signal));
        }
        const prepared = await tools.prepare?.(toolName, toolArgs, request.signal);
        const finalArgs = prepared?.args ?? toolArgs;
        const described = describeExternal(toolName, finalArgs);
        const summary = prepared?.summary ?? (text(body.summary, 2000) || described.summary);
        const details = prepared?.details ?? (Array.isArray(body.details) ? body.details.slice(0, 20).map(v => String(v)) : described.details);
        const reason = text(body.reason, 500) || "This external action waits for your approval.";
        const tier = toolTier(toolName, finalArgs);
        const row = await store.proposeAction({
          tool: toolName,
          tier: tier === "read" ? "internal" : tier === "browser" ? "external_irreversible" : tier,
          summary: summary.slice(0, 2000),
          reason: reason.slice(0, 500),
          payload: {
            tool: toolName, args: finalArgs, expected: null, details, timeZone,
            ...(prepared?.preview ? { preview: prepared.preview } : {}),
            ...(prepared?.warnings?.length ? { warnings: prepared.warnings } : {}),
          },
          conversationId: text(body.conversationId, 200) || undefined,
          messageId: text(body.messageId, 200) || undefined,
        });
        return json({
          id: row.id, tool: toolName, summary, details, reason, status: "pending", remote: true, payloadHash: row.payload_hash,
          ...(prepared?.preview ? { preview: prepared.preview } : {}),
          ...(prepared?.warnings?.length ? { warnings: prepared.warnings } : {}),
        });
      }
      const body = await readJson<{ code?: unknown; state?: unknown; verifier?: unknown }>(request, 10_000);
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

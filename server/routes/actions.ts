import { applyMutation, prepareMutation } from "../../src/services/brainTools";
import { toolTier } from "../../src/services/actionPolicy";
import { productionDeps, type Deps } from "../lib/context";
import { HttpError, json, readJson, route } from "../lib/http";
import { loadWorkspace, saveWorkspace } from "../lib/serverAgent";
import type { ServerStore } from "../lib/store";

/** JSON with object keys sorted, so records compare equal regardless of how the database ordered them. */
const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

/**
 * Runs an action the user just approved. The change is prepared again from current data and refused if the
 * target record changed since the user saw the proposal. The database allows each approval to run once.
 */
export async function executeApproved(store: ServerStore, id: string) {
  const action = await store.claimAction(id);
  const payload = action.payload as { tool?: string; args?: Record<string, unknown>; expected?: unknown };
  try {
    const tool = String(payload.tool || "");
    if (toolTier(tool) !== "internal") throw new Error("This kind of action cannot run yet.");
    const { engine, workspace } = await loadWorkspace(store);
    const mutation = prepareMutation(tool, payload.args || {}, workspace);
    if (canonical(mutation.expected ?? null) !== canonical(payload.expected ?? null))
      throw new Error("The record changed after this was proposed, so it was not applied. Ask again to work from its current version.");
    const saved = await saveWorkspace(engine, applyMutation(workspace, mutation));
    const title = ("name" in mutation.record ? mutation.record.name : (mutation.record as { title?: string }).title) || "Note";
    await store.completeAction(id, true, { type: mutation.type, recordId: mutation.record.id });
    await store.appendAudit({ actor: "assistant", action: mutation.action, entityType: mutation.type, entityId: mutation.record.id, title, actionId: id, metadata: { approved: true } });
    return { status: "executed" as const, ...saved, action: mutation.action, entityType: mutation.type, title };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The action failed.";
    await store.completeAction(id, false, { error: message });
    return { status: "failed" as const, error: message };
  }
}

/** The user's decisions on actions the assistant proposed. Only the signed-in user can approve, never the model. */
export function actionsHandlers(deps: Deps = productionDeps) {
  return {
    GET: route(async request => {
      const { store } = await deps.caller(request);
      const pending = await store.listPendingActions();
      return json({ pending: pending.map(a => ({ id: a.id, tool: a.tool, summary: a.summary, reason: a.reason, payloadHash: a.payload_hash, expiresAt: a.expires_at })) });
    }),
    POST: route(async request => {
      const { store } = await deps.caller(request);
      const body = await readJson<{ id?: unknown; decision?: unknown; payloadHash?: unknown }>(request, 10_000);
      const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : "";
      const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : null;
      const payloadHash = typeof body.payloadHash === "string" ? body.payloadHash : "";
      if (!id || !decision || !/^[0-9a-f]{64}$/.test(payloadHash)) throw new HttpError(400, "Invalid decision.");
      await store.decideAction(id, decision, payloadHash);
      if (decision === "reject") return json({ status: "rejected" });
      return json(await executeApproved(store, id));
    }),
  };
}

export const { GET, POST } = actionsHandlers();

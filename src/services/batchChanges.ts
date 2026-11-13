import type { BrainState } from "../types";
import type { OpenRouterTool } from "./openrouter";
import { applyMutation, MUTATION_TOOLS, mutationRecords, parseToolArguments, prepareMutation, type Mutation } from "./brainTools";
import { approvalReason, describeMutation, type TurnContext } from "./actionPolicy";

/**
 * Many changes as one transaction: "move every overdue CS task to Friday", "mark these six done",
 * "rename the section and file these notes under it".
 *
 * Every change is checked and prepared before anything is saved, each against the state the changes
 * before it leave behind. If any one of them is invalid, none is saved and the assistant is told exactly
 * which one failed and why. A batch is saved in a single write, so it lands whole or not at all, makes one
 * undo point, and when it needs the user's approval it asks once for the whole batch.
 */
export const BATCH_TOOL_NAME = "apply_changes";
export const MAX_BATCH = 50;
const CHANGE_TOOLS = new Map(MUTATION_TOOLS.map(t => [t.function.name, t]));

export const APPLY_CHANGES_TOOL: OpenRouterTool = { type: "function", function: { name: BATCH_TOOL_NAME,
  description: `Make several changes in one step, all or nothing: use it instead of calling change tools one at a time whenever a request needs two or more changes (up to ${MAX_BATCH}). Each change names a change tool (create_task, update_task, delete_task, update_goal, create_event, …) and the exact arguments that tool takes. The changes run in order, so a later change sees the earlier ones (create a section, then put tasks in it), but a change cannot use the ID of a record created in the same batch: create it first, then change it in a later call. If any change is invalid nothing is saved, and the error says which one to fix.`,
  parameters: { type: "object", additionalProperties: false, required: ["changes"], properties: {
    changes: { type: "array", minItems: 1, maxItems: MAX_BATCH, items: { type: "object", additionalProperties: false, required: ["tool", "args"], properties: {
      tool: { type: "string", enum: [...CHANGE_TOOLS.keys()] },
      args: { type: "object", description: "The arguments for that tool, exactly as the tool itself takes them." },
    } } },
  } } } };

export interface BatchChange { tool: string; args: Record<string, unknown> }

/**
 * Reads apply_changes arguments. Each change's own arguments are checked later against that tool's schema;
 * here only the envelope is checked. Arguments a provider sent as a JSON string are accepted.
 */
export function parseBatchArguments(raw: string): { changes: BatchChange[] } {
  let value: any;
  try { value = JSON.parse(raw); } catch { throw new Error("apply_changes arguments are not valid JSON."); }
  if (!value || typeof value !== "object" || !Array.isArray(value.changes)) throw new Error("apply_changes needs a changes array.");
  const extra = Object.keys(value).filter(k => k !== "changes");
  if (extra.length) throw new Error(`Unknown apply_changes argument ${extra[0]}.`);
  return { changes: value.changes.map((change: any) => {
    if (change && typeof change === "object" && typeof change.args === "string") {
      try { return { ...change, args: JSON.parse(change.args) }; } catch { return change; }
    }
    return change;
  }) };
}
export interface PreparedBatch { changes: BatchChange[]; mutations: Mutation[] }

/** Thrown when a batch cannot run; lists every failing change by its position. */
export class BatchError extends Error {
  constructor(readonly failures: Array<{ index: number; tool: string; error: string }>) {
    super(`Nothing was saved. Fix ${failures.length === 1 ? "this change" : "these changes"} and send the whole batch again: ${failures.map(f => `#${f.index + 1} ${f.tool}: ${f.error}`).join(" | ")}`);
  }
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Validates and prepares every change in order against a working copy of the state. Throws BatchError,
 * with every failure, if any change is invalid. Nothing is saved here.
 */
export function prepareBatch(raw: unknown, state: BrainState): PreparedBatch {
  if (!Array.isArray(raw) || !raw.length) throw new BatchError([{ index: 0, tool: BATCH_TOOL_NAME, error: "Send at least one change." }]);
  if (raw.length > MAX_BATCH) throw new BatchError([{ index: MAX_BATCH, tool: BATCH_TOOL_NAME, error: `At most ${MAX_BATCH} changes per batch; split the rest into another call.` }]);
  const failures: BatchError["failures"] = [];
  const changes: BatchChange[] = [], mutations: Mutation[] = [];
  let working = state;
  raw.forEach((entry, index) => {
    const tool = entry && typeof entry === "object" ? String((entry as BatchChange).tool || "") : "";
    try {
      const definition = CHANGE_TOOLS.get(tool);
      if (!definition) throw new Error(tool ? `"${tool}" is not a change tool that can run in a batch.` : "Name the change tool.");
      const given = (entry as BatchChange).args;
      if (!given || typeof given !== "object" || Array.isArray(given)) throw new Error("args must be an object.");
      const args = parseToolArguments(JSON.stringify(given), definition.function.parameters);
      const mutation = prepareMutation(tool, args, working);
      working = applyMutation(working, mutation);
      changes.push({ tool, args });
      mutations.push(mutation);
    } catch (error) {
      failures.push({ index, tool: tool || "?", error: message(error) });
    }
  });
  if (failures.length) throw new BatchError(failures);
  return { changes, mutations };
}

/** JSON with object keys sorted, so records compare equal however they were stored. */
export const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

/** Refuses a change whose target record is no longer the one that was read when it was prepared. */
export function assertUnchanged(state: BrainState, mutation: Mutation): void {
  if (!mutation.expected) return;
  const current = mutationRecords(state, mutation.type).find(r => r.id === mutation.record.id);
  if (canonical(current ?? null) !== canonical(mutation.expected))
    throw new Error("A record in this change was edited in the meantime, so nothing was saved. Ask again to work from its current version.");
}

/** Applies prepared changes in order, all or nothing. Each is checked against the state the ones before it left. */
export function applyBatch(state: BrainState, mutations: Mutation[]): BrainState {
  return mutations.reduce((next, mutation) => { assertUnchanged(next, mutation); return applyMutation(next, mutation); }, state);
}

/** Why the batch must wait for approval, or null. One reason covers the whole batch. */
export function batchApprovalReason(changes: BatchChange[], ctx: TurnContext): string | null {
  const reasons = new Set<string>();
  changes.forEach((change, i) => {
    const reason = approvalReason(change.tool, { ...ctx, changes: ctx.changes + i }, change.args);
    if (reason) reasons.add(reason);
  });
  return reasons.size ? [...reasons].join(" ") : null;
}

/** The approval card's summary and one line per change. */
export function describeBatch(batch: PreparedBatch): { summary: string; details: string[] } {
  const lines = batch.mutations.map((m, i) => {
    const { summary, details } = describeMutation(batch.changes[i].tool, m);
    return details.length && details.length <= 2 ? `${summary} (${details.join("; ")})` : summary;
  });
  const deletes = batch.mutations.filter(m => m.remove).length;
  const n = batch.mutations.length;
  return { summary: `Apply ${n} change${n === 1 ? "" : "s"}${deletes ? `, including ${deletes} deletion${deletes === 1 ? "" : "s"}` : ""}`, details: lines };
}

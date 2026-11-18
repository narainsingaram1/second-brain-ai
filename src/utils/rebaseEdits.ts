import type { BrainState } from "../types";
import { applyStoredRecord, collectionRecords, RECORD_COLLECTIONS } from "../services/brainRecords";

// Top-level fields that hold records; everything else (preferences, the key marker) is compared as a whole.
const RECORD_FIELDS = new Set<string>(RECORD_COLLECTIONS.map(c => (c === "memory" ? "agentMemory" : c.split(".")[0])));

/**
 * Carries the edits made to `base` (giving `current`) over to `fresh`, a newer copy of the same workspace.
 * Used when the app opened from this device's cached copy and the cloud copy arrived after the user had
 * already changed something. State is immutable, so an unchanged record keeps its object identity and only
 * records the user actually added, edited or deleted are carried over. Other fields are carried over only
 * when they changed.
 */
export function rebaseEdits(base: BrainState, current: BrainState, fresh: BrainState): BrainState {
  if (current === base) return fresh;
  let next = fresh;
  for (const collection of RECORD_COLLECTIONS) {
    const before = new Map(collectionRecords(base, collection).map(r => [r.id, r.data] as const));
    for (const { id, data } of collectionRecords(current, collection)) {
      if (before.get(id) !== data) next = applyStoredRecord(next, collection, id, data);
      before.delete(id);
    }
    for (const id of before.keys()) next = applyStoredRecord(next, collection, id, null);
  }
  const was = base as unknown as Record<string, unknown>;
  const now = current as unknown as Record<string, unknown>;
  for (const key of Object.keys(now)) {
    if (RECORD_FIELDS.has(key) || key === "userId") continue;
    if (now[key] !== was[key]) next = { ...next, [key]: now[key] };
  }
  return next;
}

import { healthDayId, mergeHealthDay, normalizeHealthDay, parseHealthPayload, sameHealthData } from "../../src/utils/health";
import type { AdminStore } from "./admin";
import { HttpError } from "./http";
import { sha256Hex } from "./telegram";

export const HEALTH_TOKEN_PREFIX = "hs_";
const MAX_DAYS = 400;

export function newHealthToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return HEALTH_TOKEN_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const healthTokenHash = (token: string) => sha256Hex(token);
export const looksLikeHealthToken = (value: string) => value.startsWith(HEALTH_TOKEN_PREFIX) && /^hs_[A-Za-z0-9_-]{40,60}$/.test(value);

/** Which app sent the data, for the "last synced from" line. */
export function payloadSource(payload: unknown, header: string | null): string {
  const named = header?.trim().slice(0, 80);
  if (named) return named;
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : undefined;
  return data && typeof data === "object" ? "Health Auto Export" : "Shortcut";
}

/**
 * Merges one push from the phone into the account's health days. Runs as the account (through a short
 * session) so the same record rules apply as in the app. Repeated pushes of the same data write nothing.
 */
export async function ingestHealth(admin: AdminStore, token: string, payload: unknown, source: string, now = new Date().toISOString()) {
  const userId = await admin.healthAccount(await healthTokenHash(token));
  if (!userId) throw new HttpError(401, "This sync token is not valid. Create a new one in the Health workspace.");
  let patches;
  try { patches = parseHealthPayload(payload); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Unreadable health data."); }
  if (patches.length > MAX_DAYS) throw new HttpError(413, `Send at most ${MAX_DAYS} days at a time.`);

  const write = async (attempt: number): Promise<number> => {
    const stored = new Map((await admin.healthDays(userId, patches.map(p => healthDayId(p.date)))).map(r => [r.id, r]));
    const changes = patches.flatMap(patch => {
      const row = stored.get(healthDayId(patch.date));
      const before = row ? normalizeHealthDay(row.data) : undefined;
      const after = mergeHealthDay(before, patch, source, now);
      return sameHealthData(before, after) ? [] : [{ collection: "healthDays", id: after.id, data: after, baseRevision: row?.revision ?? 0 }];
    });
    if (!changes.length) return 0;
    const session = await admin.session(userId);
    try {
      const result = await session.store.records.saveRecords(changes);
      // The app saved a tag or note on one of these days at the same moment: merge onto its version.
      if (result.conflicts.length && attempt === 0) return result.saved.length + await write(1);
      return result.saved.length;
    } finally {
      await session.close();
    }
  };
  const updated = await write(0);
  await admin.markHealthSync(userId, patches.length, source);
  return { ok: true, days: patches.length, updated, from: patches[0].date, to: patches[patches.length - 1].date };
}

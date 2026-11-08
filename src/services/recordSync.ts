import type { BrainState } from "../types";
import {
  applyStoredRecord, assembleState, collectionRecords, createSerializer, diffRecords, preferencesOf, RECORD_COLLECTIONS, recordKey,
  type RecordChange, type RecordCollection, type StoredRecord, type SyncedRecord,
} from "./brainRecords";

export class PreferencesConflict extends Error {}

/** Storage operations the sync engine needs; implemented over Supabase, and over PGlite in tests. */
export interface RecordTransport {
  /** Moves the account to per-record storage if needed; "unsupported" when the database has no records support yet. */
  migrate(): Promise<"records" | "unsupported">;
  readPreferences(): Promise<{ state: Record<string, unknown>; revision: number }>;
  preferencesRevision(): Promise<number>;
  /** Live records, or every change (including deletions) after `sinceSeq`. Implementations page internally. */
  readRecords(sinceSeq?: number): Promise<StoredRecord[]>;
  saveRecords(changes: Array<{ collection: string; id: string; data: object | null; baseRevision: number }>): Promise<{
    saved: Array<{ collection: string; id: string; revision: number; seq: number; deleted: boolean }>;
    conflicts: Array<{ collection: string; id: string; current: { data: Record<string, unknown> | null; revision: number; seq: number; deleted: boolean } | null }>;
  }>;
  /** Throws PreferencesConflict when another device saved preferences first. */
  savePreferences(state: Record<string, unknown>, revision: number): Promise<number>;
}

const BATCH_RECORDS = 200;
const BATCH_BYTES = 1_500_000;

/**
 * Keeps a workspace in sync with per-record cloud storage. Saves send only records that changed since the
 * server last confirmed them, one save at a time. When two devices edit the same record, the version
 * already on the server is kept and the local copy is replaced on the next refresh. Preferences merge per
 * field: a field changed on this device wins, everything else follows the server.
 */
export class RecordSync {
  private synced = new Map<string, SyncedRecord>();
  private conflicted = new Map<string, { collection: RecordCollection; id: string; current: StoredRecord | null }>();
  private ownSeqs = new Set<number>();
  private prefsJson = new Map<string, string>();
  private remotePrefs: Record<string, unknown> | null = null;
  private prefsRevision = 0;
  private lastSeq = 0;
  private serialize = createSerializer();
  private queued: Partial<BrainState> | undefined;
  private running: Promise<void> | undefined;
  /** Records replaced by another device's version during the last refresh. */
  lastRefreshConflicts = 0;

  constructor(private transport: RecordTransport, private onRemoteChange: () => void = () => {}) {}

  get saving() { return !!this.running; }
  get pendingConflicts() { return this.conflicted.size; }

  /** Loads the workspace, or returns null if the database does not support records yet. */
  async load(): Promise<Partial<BrainState> | null> {
    if (await this.transport.migrate() === "unsupported") return null;
    const prefs = await this.transport.readPreferences();
    const rows = await this.transport.readRecords();
    this.synced.clear(); this.conflicted.clear(); this.ownSeqs.clear(); this.prefsJson.clear();
    this.prefsRevision = prefs.revision;
    for (const [key, value] of Object.entries(prefs.state)) this.prefsJson.set(key, JSON.stringify(value));
    for (const row of rows) {
      this.lastSeq = Math.max(this.lastSeq, row.seq);
      if (row.data) this.synced.set(recordKey(row.collection, row.id), { revision: row.revision, json: this.serialize(row.data) });
    }
    return assembleState(prefs.state, rows);
  }

  /** Saves the latest state. Calls made while a save is running are coalesced into one follow-up save. */
  save(state: Partial<BrainState>): Promise<void> {
    this.queued = state;
    return this.running ??= this.drain().finally(() => { this.running = undefined; });
  }

  private async drain() {
    while (this.queued) {
      const state = this.queued;
      this.queued = undefined;
      try { await this.saveOnce(state); }
      catch (error) { this.queued ??= state; throw error; }
    }
  }

  private async saveOnce(state: Partial<BrainState>) {
    const changes = diffRecords(state, this.synced, this.serialize).filter(c => !this.conflicted.has(recordKey(c.collection, c.id)));
    for (const batch of batches(changes)) {
      const result = await this.transport.saveRecords(batch.map(({ collection, id, data, baseRevision }) => ({ collection, id, data, baseRevision })));
      const byKey = new Map(batch.map(c => [recordKey(c.collection, c.id), c]));
      for (const saved of result.saved) {
        const key = recordKey(saved.collection, saved.id);
        this.synced.set(key, { revision: saved.revision, json: saved.deleted ? null : byKey.get(key)?.json ?? null });
        this.ownSeqs.add(saved.seq);
      }
      for (const conflict of result.conflicts) {
        const key = recordKey(conflict.collection, conflict.id);
        if (!conflict.current) {
          // The record vanished from the server without a tombstone; save it again as new.
          this.synced.delete(key);
          this.queued ??= state;
          continue;
        }
        this.conflicted.set(key, { collection: conflict.collection as RecordCollection, id: conflict.id,
          current: { collection: conflict.collection as RecordCollection, id: conflict.id, ...conflict.current } });
      }
    }
    // Saves are not reported back for deletions of records the server never had.
    for (const change of changes) if (change.baseRevision === 0 && change.data === null) this.synced.delete(recordKey(change.collection, change.id));
    if (this.conflicted.size) this.onRemoteChange();
    await this.savePreferences(state);
  }

  private async savePreferences(state: Partial<BrainState>) {
    const prefs = preferencesOf(state);
    const json = new Map(Object.entries(prefs).map(([key, value]) => [key, JSON.stringify(value)]));
    const changed = [...json].filter(([key, value]) => this.prefsJson.get(key) !== value).map(([key]) => key);
    if (!changed.length) return;
    let base = this.prefsRevision;
    let payload: Record<string, unknown> = prefs;
    for (let attempt = 0; ; attempt++) {
      try {
        this.prefsRevision = await this.transport.savePreferences(payload, base);
        for (const [key, value] of Object.entries(payload)) this.prefsJson.set(key, JSON.stringify(value));
        return;
      } catch (error) {
        if (!(error instanceof PreferencesConflict) || attempt > 0) throw error;
        // Keep this device's changed fields, take everything else from the server.
        const remote = await this.transport.readPreferences();
        payload = { ...remote.state, ...Object.fromEntries(changed.map(key => [key, prefs[key as keyof typeof prefs]])) };
        base = remote.revision;
        this.remotePrefs = remote.state;
        this.onRemoteChange();
      }
    }
  }

  /**
   * Applies changes saved by other devices. `latest` is read after the network calls, and everything after
   * that is synchronous, so edits made while changes were downloading are never overwritten.
   * Returns the updated state, or null if nothing changed.
   */
  async refresh<T extends Partial<BrainState>>(latest: () => T | null | undefined): Promise<T | null> {
    if (this.running) return null;
    const rows = await this.transport.readRecords(this.lastSeq);
    let prefsRemote = this.remotePrefs;
    this.remotePrefs = null;
    const revision = await this.transport.preferencesRevision();
    if (revision !== this.prefsRevision) {
      const remote = await this.transport.readPreferences();
      prefsRemote = remote.state;
      this.prefsRevision = remote.revision;
    }
    const current = latest();
    if (this.running || !current) return null; // A save started while reading; refresh again later.
    let next = current;
    this.lastRefreshConflicts = 0;
    const local = new Map<string, object>();
    for (const row of rows) {
      this.lastSeq = Math.max(this.lastSeq, row.seq);
      if (this.ownSeqs.delete(row.seq)) continue;
      const key = recordKey(row.collection, row.id);
      if (!local.size) indexLocal(next, local); // Rebuilt lazily after each applied change.
      const item = local.get(key);
      const known = this.synced.get(key)?.json ?? null;
      const localJson = item ? this.serialize(item) : null;
      // An unsaved local edit is left alone; saving it conflicts, and the server version is applied then.
      const wasConflict = this.conflicted.has(key);
      if (!wasConflict && known !== localJson) continue;
      if (wasConflict) this.lastRefreshConflicts++;
      next = this.applyRow(next, row);
      local.clear();
    }
    for (const [key, conflict] of this.conflicted) {
      if (conflict.current) next = this.applyRow(next, conflict.current);
      this.conflicted.delete(key);
      this.lastRefreshConflicts++;
    }
    if (prefsRemote) {
      for (const [key, value] of Object.entries(prefsRemote)) {
        const remoteJson = JSON.stringify(value);
        const localJson = JSON.stringify((next as Record<string, unknown>)[key]);
        if (localJson === remoteJson) { this.prefsJson.set(key, remoteJson); continue; }
        if (localJson !== this.prefsJson.get(key)) continue; // Changed here too: this device's value is saved next.
        next = { ...next, [key]: value };
        this.prefsJson.set(key, remoteJson);
      }
    }
    return next === current ? null : next;
  }

  private applyRow<T extends Partial<BrainState>>(state: T, row: StoredRecord): T {
    const key = recordKey(row.collection, row.id);
    const data = row.deleted ? null : row.data;
    this.synced.set(key, { revision: row.revision, json: data ? this.serialize(data) : null });
    this.conflicted.delete(key);
    return applyStoredRecord(state, row.collection, row.id, data);
  }

  /** True when the state has record or preference edits the server has not confirmed. */
  hasUnsavedChanges(state: Partial<BrainState>): boolean {
    if (this.running || this.queued || this.conflicted.size) return true;
    if (diffRecords(state, this.synced, this.serialize).length) return true;
    return Object.entries(preferencesOf(state)).some(([key, value]) => this.prefsJson.get(key) !== JSON.stringify(value));
  }
}

function indexLocal(state: Partial<BrainState>, into: Map<string, object>) {
  for (const collection of RECORD_COLLECTIONS)
    for (const { id, data } of collectionRecords(state, collection)) into.set(recordKey(collection, id), data);
}

function batches(changes: RecordChange[]): RecordChange[][] {
  const result: RecordChange[][] = [];
  let current: RecordChange[] = [], bytes = 0;
  for (const change of changes) {
    const size = change.json?.length || 0;
    if (current.length && (current.length >= BATCH_RECORDS || bytes + size > BATCH_BYTES)) { result.push(current); current = []; bytes = 0; }
    current.push(change);
    bytes += size;
  }
  if (current.length) result.push(current);
  return result;
}

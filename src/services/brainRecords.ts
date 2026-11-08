import type { BrainState, StudyState } from "../types";

/**
 * How a workspace maps onto per-record cloud storage. Shared by the browser sync engine and the
 * server agent, so both read and write records the same way. Pure: no I/O.
 */
export const RECORD_COLLECTIONS = [
  "tasks", "goals", "habits", "journalEntries", "knowledgeItems", "events", "trackerItems", "workspaces",
  "noteFolders", "conversations", "study.courses", "study.folders", "study.documents", "study.decks", "study.quizzes", "memory",
] as const;
export type RecordCollection = typeof RECORD_COLLECTIONS[number];

/** Lists the app shows newest first: new records go to the front. Matches newest_first_collections() in SQL. */
export const NEWEST_FIRST = new Set<RecordCollection>(["tasks", "goals", "journalEntries", "knowledgeItems", "conversations"]);

/** Small fields that stay in the `brains` row. Matches preference_keys() in SQL. */
export const PREFERENCE_KEYS = ["chatHistory", "sections", "subsections", "conversationId", "selectedModel", "theme",
  "taskAppearance", "dailyBrief", "auditLog", "preferences"] as const;

const STUDY_KEYS = ["courses", "folders", "documents", "decks", "quizzes"] as const;
type StudyKey = typeof STUDY_KEYS[number];
export const MEMORY_RECORD_ID = "agent";

export interface StoredRecord { collection: RecordCollection; id: string; data: Record<string, unknown> | null; revision: number; seq: number; ord?: number; deleted?: boolean }
export const recordKey = (collection: string, id: string) => `${collection}\u0000${id}`;

const studyKey = (collection: RecordCollection): StudyKey | undefined =>
  collection.startsWith("study.") ? collection.slice(6) as StudyKey : undefined;

/** The records of one collection, as `{ id, data }` in display order. */
export function collectionRecords(state: Partial<BrainState>, collection: RecordCollection): Array<{ id: string; data: object }> {
  if (collection === "memory") return state.agentMemory ? [{ id: MEMORY_RECORD_ID, data: state.agentMemory }] : [];
  const key = studyKey(collection);
  const list = (key ? state.study?.[key] : (state as Record<string, unknown>)[collection]) as Array<{ id?: unknown }> | undefined;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is { id: string } => !!item && typeof item === "object" && typeof item.id === "string" && !!item.id)
    .map(item => ({ id: item.id, data: item }));
}

export function preferencesOf(state: Partial<BrainState>): Record<string, unknown> {
  const prefs: Record<string, unknown> = {};
  for (const key of PREFERENCE_KEYS) {
    const value = (state as Record<string, unknown>)[key];
    if (value !== undefined) prefs[key] = value;
  }
  return prefs;
}

/** Builds the stored part of a workspace from its preferences and live records (sorted by creation order). */
export function assembleState(prefs: Record<string, unknown>, rows: StoredRecord[]): Partial<BrainState> {
  const state: Record<string, unknown> = { ...prefs };
  const study: Partial<StudyState> = {};
  const grouped = new Map<RecordCollection, StoredRecord[]>();
  for (const row of rows) {
    if (row.deleted || !row.data) continue;
    const list = grouped.get(row.collection) || [];
    list.push(row);
    grouped.set(row.collection, list);
  }
  for (const collection of RECORD_COLLECTIONS) {
    const list = (grouped.get(collection) || []).sort((a, b) => (a.ord ?? a.seq) - (b.ord ?? b.seq));
    if (NEWEST_FIRST.has(collection)) list.reverse();
    const items = list.map(r => r.data);
    if (collection === "memory") { if (items[0]) state.agentMemory = items[0]; continue; }
    const key = studyKey(collection);
    if (key) (study as Record<string, unknown>)[key] = items;
    else state[collection] = items;
  }
  state.study = { courses: [], folders: [], documents: [], decks: [], quizzes: [], ...study };
  return state as Partial<BrainState>;
}

/** Replaces, inserts or removes one record in a workspace, keeping every other list and object identical. */
export function applyStoredRecord<T extends Partial<BrainState>>(state: T, collection: RecordCollection, id: string, data: object | null): T {
  if (collection === "memory") return { ...state, agentMemory: data ?? undefined } as T;
  const key = studyKey(collection);
  const list = ((key ? state.study?.[key] : (state as Record<string, unknown>)[collection]) || []) as Array<{ id: string }>;
  const index = list.findIndex(item => item?.id === id);
  let next: Array<object>;
  if (!data) next = index < 0 ? list : list.filter((_, i) => i !== index);
  else if (index >= 0) next = list.map((item, i) => i === index ? data : item);
  else next = NEWEST_FIRST.has(collection) ? [data, ...list] : [...list, data];
  if (next === list) return state;
  if (key) return { ...state, study: { courses: [], folders: [], documents: [], decks: [], quizzes: [], ...state.study, [key]: next } } as T;
  return { ...state, [collection]: next } as T;
}

export interface RecordChange { collection: RecordCollection; id: string; data: object | null; baseRevision: number; json: string | null }
export interface SyncedRecord { revision: number; json: string | null }

/**
 * Records that differ from what the server last confirmed. Unchanged objects are recognised by identity
 * (React state is immutable), so only edited records are serialized.
 */
export function diffRecords(state: Partial<BrainState>, synced: Map<string, SyncedRecord>, serialize: (value: object) => string): RecordChange[] {
  const changes: RecordChange[] = [];
  const present = new Set<string>();
  for (const collection of RECORD_COLLECTIONS) {
    for (const { id, data } of collectionRecords(state, collection)) {
      const key = recordKey(collection, id);
      if (present.has(key)) continue; // Duplicate IDs: the first copy wins, as in the database.
      present.add(key);
      const json = serialize(data);
      const known = synced.get(key);
      if (known?.json !== json) changes.push({ collection, id, data, baseRevision: known?.revision ?? 0, json });
    }
  }
  for (const [key, known] of synced) {
    if (known.json === null || present.has(key)) continue;
    const [collection, id] = key.split("\u0000") as [RecordCollection, string];
    changes.push({ collection, id, data: null, baseRevision: known.revision, json: null });
  }
  return changes;
}

/** Serializes each object once; edits create new objects, so cached strings never go stale. */
export function createSerializer(): (value: object) => string {
  const cache = new WeakMap<object, string>();
  return value => {
    let json = cache.get(value);
    if (json === undefined) { json = JSON.stringify(value); cache.set(value, json); }
    return json;
  };
}

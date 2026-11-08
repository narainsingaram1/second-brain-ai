import { getManagedSession, getSupabase } from "./managedAuth";
import type { BrainState } from "../types";
import type { RecordCollection, StoredRecord } from "./brainRecords";
import { PreferencesConflict, type RecordTransport } from "./recordSync";

export async function readManagedBrain(knownRevision?: number) {
  const session = await getManagedSession();
  const user = session.currentUser!;
  const client = getSupabase();
  if (knownRevision !== undefined) {
    const { data, error } = await client.from("brains").select("revision").eq("user_id", user.id).maybeSingle();
    if (error) throw new Error("Could not check cloud records. Try again.");
    if ((data?.revision || 0) === knownRevision) return { unchanged: true as const, user, revision: knownRevision, state: null };
  }
  const { data, error } = await client.from("brains").select("state,revision").eq("user_id", user.id).maybeSingle();
  if (error) throw new Error("Could not load cloud records. Try again.");
  return { user, state: data?.state as Partial<BrainState> | null, revision: Number(data?.revision || 0) };
}
export async function writeManagedBrain(state: unknown, revision: number, ownerId: string) {
  const { data, error } = await getSupabase().rpc("save_brain", { p_state: state, p_revision: revision, p_owner_id: ownerId });
  if (error?.code === "40001") throw new Error("Another device saved changes. Export your work, then reload before editing again.");
  if (error?.code === "42501") throw new Error("Your account changed. Reload and sign in again before saving.");
  if (error) throw new Error(error.code === "22023" ? "This backup is invalid or exceeds the 2 MB cloud limit." : "Cloud save failed. Keep this tab open and retry.");
  return { revision: Number(data) };
}

const PAGE = 1000;
/** Per-record storage over Supabase. Every call runs as the signed-in user, so row-level security applies. */
export function supabaseRecordTransport(userId: string): RecordTransport {
  const client = getSupabase();
  const fail = (what: string) => new Error(`Could not ${what}. Check your connection and try again.`);
  return {
    async migrate() {
      const { error } = await client.rpc("migrate_brain_to_records");
      // PostgREST reports a function that is not in the schema as PGRST202: the migration is not applied yet.
      if (error?.code === "PGRST202" || error?.code === "42883") return "unsupported";
      if (error) throw fail("upgrade cloud storage");
      return "records";
    },
    async readPreferences() {
      const { data, error } = await client.from("brains").select("state,revision").eq("user_id", userId).single();
      if (error || !data) throw fail("load your preferences");
      return { state: (data.state || {}) as Record<string, unknown>, revision: Number(data.revision) };
    },
    async preferencesRevision() {
      const { data, error } = await client.from("brains").select("revision").eq("user_id", userId).single();
      if (error || !data) throw fail("check for changes");
      return Number(data.revision);
    },
    async readRecords(sinceSeq) {
      const rows: StoredRecord[] = [];
      for (let from = 0; ; from += PAGE) {
        let query = client.from("brain_records").select("collection,id,data,revision,seq,ord,deleted").eq("user_id", userId);
        query = sinceSeq === undefined ? query.eq("deleted", false) : query.gt("seq", sinceSeq);
        const { data, error } = await query.order("seq").range(from, from + PAGE - 1);
        if (error) throw fail("load your records");
        rows.push(...(data || []).map(r => ({ ...r, collection: r.collection as RecordCollection, revision: Number(r.revision), seq: Number(r.seq), ord: Number(r.ord) })));
        if (!data || data.length < PAGE) return rows;
      }
    },
    async saveRecords(changes) {
      const { data, error } = await client.rpc("save_records", { p_changes: changes });
      if (error?.code === "22023") throw new Error("A record could not be saved because it is invalid or too large.");
      if (error) throw fail("save your changes");
      return data as Awaited<ReturnType<RecordTransport["saveRecords"]>>;
    },
    async savePreferences(state, revision) {
      const { data, error } = await client.rpc("save_brain_prefs", { p_state: state, p_revision: revision });
      if (error?.code === "40001") throw new PreferencesConflict("Preferences changed on another device.");
      if (error) throw fail("save your preferences");
      return Number(data);
    },
  };
}

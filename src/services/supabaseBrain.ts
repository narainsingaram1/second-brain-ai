import { getManagedSession, getSupabase } from "./managedAuth";
import type { BrainState } from "../types";

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

import type { Mutation } from "./brainTools";

/**
 * Which assistant actions may run on their own and which wait for the user. The model cannot approve
 * anything itself: a gated call becomes a proposal, and only the user's decision in the app runs it.
 */
export type ToolTier = "read" | "internal" | "external_reversible" | "external_irreversible";

const READ = new Set(["query_records", "read_record", "read_records", "search_records", "search_conversations", "recall_conversation", "search_memories"]);
const MEMORY = new Set(["remember_memory", "update_memory", "forget_memory"]);
const INTERNAL = new Set(["create_task", "update_task", "delete_task", "complete_habit", "create_habit", "create_goal", "update_goal", "log_journal",
  "create_note", "update_note", "create_event", "update_event", "delete_event", "create_tracker_item", "update_tracker_item", "create_course",
  "set_course_grading", "record_grade", "create_flashcard_deck", "create_quiz"]);

/** Unknown tools are treated as the riskiest tier, so a new integration is gated until it is classified. */
export function toolTier(name: string): ToolTier {
  if (READ.has(name)) return "read";
  if (MEMORY.has(name) || INTERNAL.has(name)) return "internal";
  return "external_irreversible";
}

/** Reads whose content came from somewhere other than the user's own words in this conversation. */
export function readsUntrustedContent(tool: string, sourceTypes: string[]): boolean {
  return tool === "recall_conversation" || tool === "search_conversations" || sourceTypes.includes("document");
}

export interface TurnContext {
  /** This turn already read uploaded documents or past conversations, which could carry injected instructions. */
  untrustedRead: boolean;
  /** Changes saved so far in this turn. */
  changes: number;
  /** The user's "Ask before every change" setting. */
  askBeforeChanges: boolean;
}
export const BULK_CHANGE_LIMIT = 5;

/** Why this call must wait for approval, or null if it may run now. */
export function approvalReason(tool: string, ctx: TurnContext): string | null {
  const tier = toolTier(tool);
  if (tier === "read" || MEMORY.has(tool)) return null; // Memory has its own review controls.
  if (tier === "external_irreversible") return "Actions outside Synapse always need your approval.";
  if (tool.startsWith("delete_")) return "Deleting needs your approval.";
  if (ctx.askBeforeChanges) return "You asked to approve every change.";
  // After reading content the user did not write, the model may only add records, not change or remove them.
  if (ctx.untrustedRead && !tool.startsWith("create_") && tool !== "log_journal") return "This change came after reading an uploaded document or a past conversation, which could contain instructions that are not yours.";
  if (ctx.changes >= BULK_CHANGE_LIMIT) return `This would be more than ${BULK_CHANGE_LIMIT} changes in one request.`;
  return null;
}

const LABELS: Record<string, string> = {
  title: "Title", name: "Name", status: "Status", dueDate: "Due date", dueTime: "Due time", description: "Description", section: "Section",
  subsection: "Subsection", priority: "Priority", date: "Date", startTime: "Start", endTime: "End", location: "Location", content: "Content",
  progress: "Progress", targetDate: "Target date", completed: "Completed", notes: "Notes",
};
const show = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
};
const recordName = (m: Mutation) => ("name" in m.record ? m.record.name : (m.record as { title?: string }).title) || "Untitled";
const NOUNS: Record<string, string> = { task: "task", goal: "goal", habit: "habit", journal: "journal entry", knowledge: "note", tracker: "tracker entry", event: "event", course: "course", deck: "flashcard deck", quiz: "quiz", document: "document" };

/** One-line summary and field-level details of exactly what a change will do. */
export function describeMutation(tool: string, m: Mutation): { summary: string; details: string[] } {
  const noun = NOUNS[m.type] || m.type;
  if (m.remove) return { summary: `Delete ${noun} "${recordName(m)}"`, details: ["Removes it from your workspace. You can restore it with Undo in the activity log until you reload."] };
  if (!m.expected) return { summary: `Create ${noun} "${recordName(m)}"`, details: [] };
  const before = m.expected as unknown as Record<string, unknown>, after = m.record as unknown as Record<string, unknown>;
  const details = Object.keys({ ...before, ...after })
    .filter(key => key !== "updatedAt" && key !== "createdAt" && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(key => `${LABELS[key] || key}: ${show(before[key])} → ${show(after[key])}`);
  const verb = tool === "record_grade" ? "Record a grade in" : tool === "set_course_grading" ? "Change grading for" : "Update";
  return { summary: `${verb} ${noun} "${recordName({ ...m, record: m.expected } as Mutation)}"`, details };
}

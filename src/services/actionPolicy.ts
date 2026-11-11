import type { Mutation } from "./brainTools";

/**
 * Which assistant actions may run on their own and which wait for the user. The model cannot approve
 * anything itself: a gated call becomes a proposal, and only the user's decision in the app runs it.
 */
export type ToolTier = "read" | "internal" | "external_reversible" | "external_irreversible";

const READ = new Set(["list_resume_versions", "health_summary", "query_records", "read_record", "read_records", "search_records", "search_conversations", "recall_conversation", "search_memories",
  "list_calendar_events", "search_email", "read_email", "read_url", "web_search"]);
/** Actions outside Synapse that can be undone there (a draft is not sent; an event without guests notifies no one). */
const EXTERNAL_REVERSIBLE = new Set(["create_email_draft", "create_calendar_event"]);
const MEMORY = new Set(["remember_memory", "update_memory", "forget_memory", "organize_memory"]);
const INTERNAL = new Set(["create_task", "update_task", "delete_task", "complete_habit", "create_habit", "create_goal", "update_goal", "log_journal",
  "create_note", "update_note", "create_event", "update_event", "delete_event", "create_tracker_item", "update_tracker_item", "create_course",
  "set_course_grading", "record_grade", "create_flashcard_deck", "create_quiz", "delete_tracker_item", "log_practice",
  "create_workspace", "update_workspace", "delete_workspace", "create_section", "rename_section", "delete_section", "rename_subsection", "delete_subsection",
  "delete_goal", "update_habit", "delete_habit", "update_journal_entry", "delete_journal_entry", "delete_note", "create_note_folder", "update_note_folder",
  "delete_note_folder", "update_course", "delete_course", "update_flashcard_deck", "delete_flashcard_deck", "update_quiz", "delete_quiz",
  "log_health_day", "update_health_day", "delete_health_day", "update_health_profile"]);
/** Every tool that changes the user's own data, for the coverage check. */
export const INTERNAL_TOOLS: ReadonlySet<string> = INTERNAL;

/**
 * Unknown tools are treated as the riskiest tier, so a new integration is gated until it is classified.
 * Some tiers depend on the arguments: an event with guests makes Google email invitations.
 */
export function toolTier(name: string, args: Record<string, unknown> = {}): ToolTier {
  if (READ.has(name)) return "read";
  if (MEMORY.has(name) || INTERNAL.has(name)) return "internal";
  if (name === "create_calendar_event" && Array.isArray(args.attendees) && args.attendees.length) return "external_irreversible";
  if (EXTERNAL_REVERSIBLE.has(name)) return "external_reversible";
  return "external_irreversible";
}

/** Reads whose content came from somewhere other than the user's own words in this conversation. */
export function readsUntrustedContent(tool: string, sourceTypes: string[]): boolean {
  return tool === "recall_conversation" || tool === "search_conversations" || tool === "search_email" || tool === "read_email" || tool === "read_url" || tool === "web_search" || sourceTypes.includes("document");
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
export function approvalReason(tool: string, ctx: TurnContext, args: Record<string, unknown> = {}): string | null {
  const tier = toolTier(tool, args);
  if (tier === "read" || MEMORY.has(tool)) return null; // Memory has its own review controls.
  if (tool === "create_calendar_event" && tier === "external_irreversible") return "Google will email invitations to the guests.";
  if (tool === "send_email" || tool === "send_draft") return "Sending email always needs your approval. It cannot be unsent.";
  if (tier === "external_irreversible") return "Actions outside Synapse always need your approval.";
  if (tool.startsWith("delete_")) return "Deleting needs your approval.";
  if (ctx.askBeforeChanges) return "You asked to approve every change.";
  // After reading content the user did not write, the model may only add records, not change or remove them.
  if (ctx.untrustedRead && !tool.startsWith("create_") && tool !== "log_journal") return "This change came after reading an email, a web page, an uploaded document or a past conversation, which could contain instructions that are not yours.";
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
const recordName = (m: Mutation) => ("name" in m.record ? m.record.name : (m.record as { title?: string }).title) || (m.record as { date?: string }).date || "Untitled";
const NOUNS: Record<string, string> = { task: "task", goal: "goal", habit: "habit", journal: "journal entry", knowledge: "note", tracker: "tracker entry", event: "event", health: "health day", course: "course", deck: "flashcard deck", quiz: "quiz", document: "document",
  workspace: "workspace", folder: "note folder", section: "section" };
const SECTION_SUMMARIES: Record<string, (before: string, after: string) => string> = {
  create_section: (_, a) => `Add section "${a}"`, rename_section: (b, a) => `Rename section "${b}" to "${a}"`, delete_section: b => `Delete section "${b}"`,
  rename_subsection: b => `Rename a subsection in "${b}"`, delete_subsection: b => `Delete a subsection in "${b}"`,
};

/** One-line summary and field-level details of exactly what a change will do. */
export function describeMutation(tool: string, m: Mutation): { summary: string; details: string[] } {
  const noun = NOUNS[m.type] || m.type;
  if (m.type === "section") {
    const before = (m.expected || m.record) as unknown as { name: string; subsections: string[] }, after = m.record as unknown as { name: string; subsections: string[] };
    const details = tool === "delete_section" ? ["Its tasks move to the first remaining section."]
      : tool === "delete_subsection" ? [`Removes "${before.subsections.find(s => !after.subsections.includes(s))}"; its tasks move to "${after.subsections[0]}".`]
      : tool === "rename_subsection" ? before.subsections.map((s, i) => s !== after.subsections[i] ? `"${s}" → "${after.subsections[i]}"` : "").filter(Boolean) : [];
    return { summary: SECTION_SUMMARIES[tool]?.(before.name, after.name) || `Change section "${before.name}"`, details };
  }
  if (m.remove && m.type === "workspace") return { summary: `Delete workspace "${recordName(m)}"`, details: ["Removes the workspace with all of its tracker entries, or its courses with their decks, quizzes and grades."] };
  if (m.remove && m.type === "course") return { summary: `Delete course "${recordName(m)}"`, details: ["Removes the course with its flashcard decks, quizzes and grades. Tasks stay."] };
  if (m.remove && m.type === "folder") return { summary: `Delete note folder "${recordName(m)}"`, details: ["Its notes and subfolders move up a level; no notes are deleted."] };
  if (m.remove) return { summary: `Delete ${noun} "${recordName(m)}"`, details: ["Removes it from your workspace. You can restore it with Undo in the activity log until you reload."] };
  if (!m.expected) return { summary: `Create ${noun} "${recordName(m)}"`, details: [] };
  const before = m.expected as unknown as Record<string, unknown>, after = m.record as unknown as Record<string, unknown>;
  const details = Object.keys({ ...before, ...after })
    .filter(key => key !== "updatedAt" && key !== "createdAt" && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(key => `${LABELS[key] || key}: ${show(before[key])} → ${show(after[key])}`);
  const verb = tool === "record_grade" ? "Record a grade in" : tool === "set_course_grading" ? "Change grading for" : tool === "update_health_profile" ? "Change health targets in" : "Update";
  return { summary: `${verb} ${noun} "${recordName({ ...m, record: m.expected } as Mutation)}"`, details };
}

const list = (value: unknown) => Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(",").map(v => v.trim()).filter(Boolean) : [];
const clock = (time: unknown) => {
  const [h, m] = String(time).split(":").map(Number);
  return Number.isFinite(h) ? `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}` : "";
};
/** Summary and details for a proposed action outside Synapse, as shown on its approval card. */
export function describeExternal(tool: string, args: Record<string, unknown>): { summary: string; details: string[] } {
  if (tool === "create_calendar_event") {
    const guests = list(args.attendees);
    const when = args.startTime ? `${args.date} ${clock(args.startTime)}–${clock(args.endTime)}` : `${args.date} (all day)`;
    return { summary: `Create event "${String(args.title || "Untitled")}" on ${when}${guests.length ? `, invites ${guests.length} ${guests.length === 1 ? "person" : "people"}` : ""}`,
      details: [...(guests.length ? [`Guests: ${guests.join(", ")}`] : []), ...(args.location ? [`Location: ${args.location}`] : [])] };
  }
  if (tool === "create_email_draft") {
    const to = list(args.to);
    const body = String(args.body || "");
    return { summary: `Save a draft${to.length ? ` to ${to.join(", ")}` : " reply"}${args.subject ? `: "${args.subject}"` : ""}`,
      details: ["Saved to Gmail Drafts; nothing is sent.", body.length > 160 ? `${body.slice(0, 157)}…` : body] };
  }
  return { summary: `Run ${tool}`, details: Object.entries(args).slice(0, 6).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`.slice(0, 160)) };
}

import type { AgentStep, AgentStepKind } from "../types";

/**
 * Turns what the assistant is doing into steps a person can follow: "Searching your notes for “heaps”",
 * "Reading “Lecture 4”", "Searching the web…". Each step is reported as it starts and again when it ends.
 */
export class ActivityTracker {
  private steps: AgentStep[] = [];
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private emit?: (step: AgentStep) => void) {}

  start(kind: AgentStepKind, label: string, extra: Partial<AgentStep> = {}): string {
    const step: AgentStep = { id: crypto.randomUUID(), kind, label, status: "running", startedAt: Date.now(), ...extra };
    this.steps.push(step);
    this.send(step);
    return step.id;
  }
  /** Changes a step. Frequent updates (streamed reasoning) are coalesced so they don't flood the connection. */
  update(id: string, patch: Partial<AgentStep>, coalesce = false) {
    const step = this.get(id);
    if (!step) return;
    Object.assign(step, patch);
    if (!coalesce) { this.flush(id); this.send(step); return; }
    if (!this.pending.has(id)) this.pending.set(id, setTimeout(() => { this.pending.delete(id); this.send(step); }, 120));
  }
  finish(id: string, patch: Partial<AgentStep> = {}) {
    this.flush(id);
    this.update(id, { status: "done", endedAt: Date.now(), ...patch });
  }
  fail(id: string, message: string) {
    this.flush(id);
    this.update(id, { status: "error", endedAt: Date.now(), detail: message });
  }
  hide(id: string) { this.finish(id, { hidden: true }); }
  get(id: string) { return this.steps.find(s => s.id === id); }
  /** The visible steps, bounded, to keep with the finished reply. */
  list(): AgentStep[] {
    for (const id of [...this.pending.keys()]) this.flush(id);
    return this.steps.filter(s => !s.hidden).map(s => ({
      ...s, status: s.status === "running" ? "done" : s.status, endedAt: s.endedAt ?? Date.now(),
      ...(s.detail ? { detail: s.detail.length > 8000 ? `${s.detail.slice(0, 7999)}…` : s.detail } : {}),
      ...(s.items ? { items: s.items.slice(0, 12) } : {}),
    }));
  }
  private flush(id: string) {
    const timer = this.pending.get(id);
    if (timer) { clearTimeout(timer); this.pending.delete(id); }
  }
  private send(step: AgentStep) { this.emit?.({ ...step, ...(step.items ? { items: [...step.items] } : {}) }); }
}

const NOUN: Record<string, [string, string]> = {
  task: ["task", "tasks"], goal: ["goal", "goals"], habit: ["habit", "habits"], journal: ["journal entry", "journal entries"], knowledge: ["note", "notes"],
  tracker: ["tracker entry", "tracker entries"], event: ["event", "events"], course: ["course", "courses"], document: ["course document", "course documents"],
  deck: ["flashcard deck", "flashcard decks"], quiz: ["quiz", "quizzes"],
};
const noun = (type: unknown, many = false) => NOUN[String(type)]?.[many ? 1 : 0] || (many ? "records" : "record");
const quote = (text: unknown) => `“${String(text).trim().slice(0, 80)}”`;
const host = (url: unknown) => { try { return new URL(String(url)).hostname.replace(/^www\./, ""); } catch { return "a web page"; } };
const VERBS: Record<string, string> = { create: "Adding", update: "Updating", delete: "Deleting", log: "Logging", complete: "Checking off", rename: "Renaming",
  set: "Setting", record: "Recording", remember: "Remembering", forget: "Forgetting" };
const PAST: Record<string, string> = { Adding: "Added", Updating: "Updated", Deleting: "Deleted", Logging: "Logged", "Checking off": "Checked off", Renaming: "Renamed",
  Setting: "Set", Recording: "Recorded", Remembering: "Remembered", Forgetting: "Forgot", Searching: "Searched", Reading: "Read", "Looking through": "Looked through",
  Checking: "Checked", Drafting: "Drafted", Rereading: "Reread" };
/** "Searching the web for …" → "Searched the web for …", for a finished step. */
export const pastTense = (label: string) => {
  const word = Object.keys(PAST).find(w => label.startsWith(`${w} `));
  return word ? PAST[word] + label.slice(word.length) : label;
};

/** What a tool call is about to do, in plain words. */
export function describeCall(name: string, args: Record<string, any>): { kind: AgentStepKind; label: string } {
  switch (name) {
    case "query_records": {
      const range = args.dateFrom && args.dateTo ? ` from ${args.dateFrom} to ${args.dateTo}` : args.dateFrom ? ` from ${args.dateFrom}` : args.dateTo ? ` through ${args.dateTo}` : "";
      return { kind: "records", label: `Looking through your ${noun(args.type, true)}${range}${args.text ? ` mentioning ${quote(args.text)}` : ""}` };
    }
    case "search_records": return { kind: "records", label: `Searching your ${args.type ? noun(args.type, true) : "records"} for ${quote(args.query)}` };
    case "read_record": return { kind: "records", label: `Reading a ${noun(args.type)}` };
    case "read_records": return { kind: "records", label: `Reading ${args.ids?.length || "several"} ${noun(args.type, (args.ids?.length || 2) > 1)}` };
    case "search_memories": return { kind: "memory", label: "Checking what I remember about you" };
    case "search_conversations": return { kind: "memory", label: `Searching past chats for ${quote(args.query)}` };
    case "recall_conversation": return { kind: "memory", label: "Rereading an earlier message" };
    case "organize_memory": return { kind: "memory", label: "Organizing a memory" };
    case "web_search": return { kind: "web", label: `Searching the web for ${quote(args.query)}` };
    case "read_url": return { kind: "web", label: `Reading ${host(args.url)}` };
    case "list_calendar_events": return { kind: "calendar", label: `Checking your Google Calendar, ${args.from} to ${args.to}` };
    case "create_calendar_event": return { kind: "calendar", label: `Adding ${quote(args.title)} to Google Calendar` };
    case "search_email": return { kind: "email", label: `Searching your email for ${quote(args.query)}` };
    case "read_email": return { kind: "email", label: "Reading an email" };
    case "create_email_draft": return { kind: "email", label: "Drafting an email" };
    case "show_card": return { kind: "records", label: "Preparing a card" };
    case "send_email": case "send_draft": return { kind: "email", label: "Preparing an email to send" };
  }
  const [verb, ...rest] = name.split("_");
  const target = args.title || args.name || args.newTitle || args.section || args.topic;
  const thing = rest.join(" ").replace(/\bitem\b/, "entry").replace("knowledge", "note");
  return { kind: name.endsWith("_memory") ? "memory" : "change", label: `${VERBS[verb] || "Updating"} ${thing}${target ? ` ${quote(target)}` : ""}` };
}

const titles = (list: unknown, key = "title") => Array.isArray(list) ? list.map((r: any) => r?.[key]).filter((t: unknown): t is string => typeof t === "string" && !!t.trim()) : [];
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A short summary of what a finished tool call found or did. */
export function describeResult(name: string, args: Record<string, any>, output: any): Partial<AgentStep> {
  if (!output || typeof output !== "object") return {};
  if (output.status === "awaiting_approval") return { kind: "approval", label: `Asked for your approval: ${output.summary}` };
  switch (name) {
    case "query_records": return { detail: output.countOnly ? undefined : `Found ${count(output.total ?? 0, noun(args.type), noun(args.type, true))}`, items: titles(output.records) };
    case "search_records": return { detail: `${count(output.results?.length ?? 0, "match", "matches")}`, items: titles(output.results) };
    case "read_record": return output.title ? { label: `Read ${quote(output.title)}` } : {};
    case "read_records": return { items: titles(output.records) };
    case "search_conversations": return { detail: `${count(output.results?.length ?? 0, "message", "messages")} found` };
    case "web_search": return { detail: Array.isArray(output.sources) && output.sources.length ? `${count(output.sources.length, "source", "sources")}` : undefined,
      items: (output.sources || []).map((s: any) => `${s.title}|${s.url}`) };
    case "read_url": return { label: `Read ${output.title ? quote(output.title) : host(output.url)}`, items: [`${output.title || host(output.url)}|${output.url}`] };
    case "list_calendar_events": return { detail: count(output.events?.length ?? 0, "event", "events"), items: titles(output.events) };
    case "search_email": return { detail: count(output.results?.length ?? 0, "email", "emails"), items: titles(output.results, "subject") };
    case "read_email": return output.email?.subject ? { label: `Read ${quote(output.email.subject)}` } : {};
  }
  return {};
}

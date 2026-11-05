import { AIMessage, BrainState } from "../types";

export type ChatSource = NonNullable<AIMessage["sources"]>[number];
export const REFERENCE_PATTERN = /\[(task|goal|habit|journal|knowledge|event|tracker):([^\]\n]+)\]/g;
export function findRecord(state: BrainState | null | undefined, type: string, id: string) {
  if (!state) return undefined;
  switch (type) {
    case "task": return state.tasks.find(r => r.id === id);
    case "goal": return state.goals.find(r => r.id === id);
    case "habit": return state.habits.find(r => r.id === id);
    case "journal": return state.journalEntries.find(r => r.id === id);
    case "knowledge": return state.knowledgeItems.find(r => r.id === id);
    case "event": return state.events?.find(r => r.id === id);
    case "tracker": return state.trackerItems?.find(r => r.id === id);
    default: return undefined;
  }
}
export function referenceTitle(type: string, id: string, sources?: AIMessage["sources"], state?: BrainState | null): string {
  const record = findRecord(state, type, id);
  if (record) return "name" in record ? record.name : record.title || ("subject" in record ? record.subject : "Untitled");
  return sources?.find(s => s.type === type && s.id === id)?.title || `Unavailable ${type === "knowledge" ? "note" : type}`;
}
export function readableMessage(message: Pick<AIMessage, "content" | "sources">, state?: BrainState | null): string {
  return message.content.replace(REFERENCE_PATTERN, (_, type: string, id: string) => referenceTitle(type, id, message.sources, state));
}
export function conversationTitle(messages: AIMessage[]): string {
  const first = messages.find(m => m.role === "user");
  return first?.content.trim().replace(/\s+/g, " ").slice(0, 72)
    || (first?.attachments?.length ? `Image: ${first.attachments[0].name}` : "New conversation");
}
export function isNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight < 100;
}
export function formatRecordDate(value?: string): string {
  if (!value) return "No due date";
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : value;
}

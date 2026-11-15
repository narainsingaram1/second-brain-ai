import type { AIMessage, ConversationThread } from "../types";

/** Bound archived chats to keep loading and serialization costs manageable. */
export const MAX_ARCHIVED_CONVERSATIONS = 60;
export const ARCHIVE_CHAR_BUDGET = 700_000;
const MAX_SOURCES_PER_MESSAGE = 40;

function compactMessage(message: AIMessage): AIMessage {
  return message.sources && message.sources.length > MAX_SOURCES_PER_MESSAGE
    ? { ...message, sources: message.sources.slice(0, MAX_SOURCES_PER_MESSAGE) }
    : message;
}

/**
 * Keeps the most recent archived conversations within a count and size budget so the
 * workspace stays responsive. Newest threads are kept first.
 */
// Every save bounds the archive. Threads are immutable, so a thread's compacted form and size are computed
// once, and an unchanged archive array returns its earlier result without re-serializing up to the budget.
const compacted = new WeakMap<ConversationThread, { compact: ConversationThread; size: number }>();
const bounded = new WeakMap<ConversationThread[], ConversationThread[]>();
function compactOf(thread: ConversationThread) {
  let known = compacted.get(thread);
  if (!known) {
    const compact = thread.messages.some(m => (m.sources?.length || 0) > MAX_SOURCES_PER_MESSAGE)
      ? { ...thread, messages: thread.messages.map(compactMessage) }
      : thread;
    known = { compact, size: JSON.stringify(compact).length };
    compacted.set(thread, known);
  }
  return known;
}

export function boundConversations(threads: ConversationThread[] | undefined): ConversationThread[] {
  if (!threads?.length) return [];
  const known = bounded.get(threads);
  if (known) return known;
  const result = boundUncached(threads);
  bounded.set(threads, result);
  return result;
}

function boundUncached(threads: ConversationThread[]): ConversationThread[] {
  const sorted = [...threads].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const kept: ConversationThread[] = [];
  let used = 0;
  for (const thread of sorted) {
    if (kept.length >= MAX_ARCHIVED_CONVERSATIONS) break;
    const { compact, size } = compactOf(thread);
    if (used + size > ARCHIVE_CHAR_BUDGET) {
      if (kept.length) break;
      // The newest thread alone is too large: keep its most recent messages that fit.
      const messages: AIMessage[] = [];
      let tail = 0;
      for (const message of [...compact.messages].reverse()) {
        const length = JSON.stringify(message).length;
        if (tail + length > ARCHIVE_CHAR_BUDGET) break;
        messages.unshift(message);
        tail += length;
      }
      if (messages.length) kept.push({ ...compact, messages });
      break;
    }
    kept.push(compact);
    used += size;
  }
  // Return the original array when nothing changed so React and save checks see no difference.
  return kept.length === threads.length && kept.every((t, i) => t === threads[i]) ? threads : kept;
}

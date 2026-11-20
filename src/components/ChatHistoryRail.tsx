import { MessageCircle, Plus, X } from "lucide-react";
import type { AIMessage, ConversationThread } from "../types";
import { conversationTitle } from "../utils/chatPresentation";

interface ChatHistoryRailProps {
  openId?: string;
  openMessages: AIMessage[];
  archives: ConversationThread[];
  runningIds: string[];
  temporary?: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

/** A short date for a thread: the time today, the weekday this week, otherwise the date. */
export function threadDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 6) return date.toLocaleDateString("en-US", { weekday: "short" });
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** A small spinner shown on a conversation that is still answering. */
export function ChatRunningDot({ label = "Answering" }: { label?: string }) {
  return <span className="chat-running-dot" role="status" aria-label={label} title={label} />;
}

/** Every conversation, scrollable, beside the open one. Conversations still answering show a spinner. */
export function ChatHistoryRail({ openId, openMessages, archives, runningIds, temporary, onOpen, onNew, onClose }: ChatHistoryRailProps) {
  const running = new Set(runningIds);
  const items = [
    ...(openId && !temporary && openMessages.some(m => m.role === "user") ? [{ id: openId, title: conversationTitle(openMessages), date: "", current: true }] : []),
    ...archives.filter(thread => thread.id !== openId).map(thread => ({ id: thread.id, title: thread.title, date: threadDate(thread.updatedAt), current: false })),
  ];
  const busyElsewhere = runningIds.filter(id => id !== openId).length;
  return <aside className="chat-history-rail" aria-label="Chat history">
    <div className="chat-history-head">
      <h2>Chats{busyElsewhere > 0 && <span className="chat-history-busy">{busyElsewhere} answering</span>}</h2>
      <div className="flex items-center gap-1">
        <button type="button" className="chat-icon-button" onClick={onNew} aria-label="New chat" title="New chat"><Plus size={15} strokeWidth={2} /></button>
        <button type="button" className="chat-icon-button chat-history-close" onClick={onClose} aria-label="Hide chat history" title="Hide chat history"><X size={15} strokeWidth={2} /></button>
      </div>
    </div>
    <nav className="chat-history-list">
      {items.map(item => <button type="button" key={item.id} className={`chat-history-item ${item.current ? "is-current" : ""}`} aria-current={item.current ? "page" : undefined}
        onClick={() => { if (!item.current) onOpen(item.id); }}>
        <span className="chat-history-title">{item.title}</span>
        {running.has(item.id) ? <ChatRunningDot /> : item.date ? <span className="chat-history-date">{item.date}</span> : null}
      </button>)}
      {items.length === 0 && <p className="chat-history-empty"><MessageCircle size={14} strokeWidth={1.5} /> No past chats yet</p>}
    </nav>
  </aside>;
}

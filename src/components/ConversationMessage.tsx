import { useState } from "react";
import { ArrowUpRight, BookmarkPlus, Check, Copy, Sparkles } from "lucide-react";
import { AIMessage, BrainState, KnowledgeItem } from "../types";
import { ChatSource, conversationTitle, readableMessage, referenceTitle } from "../utils/chatPresentation";
import { getLocalDateString } from "../utils/habitStreaks";
import { MarkdownView } from "./MarkdownView";
import { RecordIcon, RecordPreview, SourceReferences } from "./SourceReferences";

export function ConversationMessage({ message, state, onSaveNote }: { message: AIMessage; state?: BrainState | null; onSaveNote?: (note: KnowledgeItem) => void }) {
  const [selected, setSelected] = useState<ChatSource | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const humanContent = () => readableMessage(message, state);
  const copy = async () => {
    try { await navigator.clipboard.writeText(humanContent()); setCopied(true); } catch { setError("Copy failed. Select the text to copy it."); }
  };
  const save = () => {
    if (!onSaveNote || saved) return;
    const content = humanContent(), title = conversationTitle(state?.chatHistory || []) === "New conversation" ? "Conversation note" : conversationTitle(state?.chatHistory || []);
    const today = getLocalDateString();
    onSaveNote({ id: crypto.randomUUID(), subject: title, title, content, summary: content.slice(0, 180), status: "Synthesized", startDate: today, endDate: today, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    setSaved(true);
  };
  if (message.role === "user") return <article data-message-id={message.id} className="chat-user-message"><div>{message.content}</div></article>;
  return <article data-message-id={message.id} className="chat-assistant-message">
    <div className="chat-assistant-avatar"><Sparkles size={16} aria-hidden="true" /></div>
    <div className="chat-answer min-w-0">
      <span className="chat-assistant-name">Synapse</span>
      <MarkdownView className="chat-prose" content={message.content} renderReference={(type, id, before) => {
        const source = message.sources?.find(s => s.type === type && s.id === id) || { type, id, title: referenceTitle(type, id, message.sources, state) };
        const title = referenceTitle(type, id, message.sources, state);
        const repeatsTitle = before.replace(/[*`_]/g, "").trimEnd().toLocaleLowerCase().endsWith(title.toLocaleLowerCase());
        return <button type="button" className={`chat-inline-reference ${repeatsTitle ? "is-citation" : ""}`} aria-label={`Open ${type === "knowledge" ? "note" : type}: ${title}`} title={title} onClick={() => setSelected(source)}><RecordIcon type={type} />{!repeatsTitle && <span>{title}</span>}<ArrowUpRight size={12} className="shrink-0 opacity-60" /></button>;
      }} />
      <SourceReferences sources={message.sources} state={state} onSelect={setSelected} />
      <div className="chat-message-actions">
        <button type="button" onClick={copy} className="chat-icon-button" aria-label={copied ? "Copied response" : "Copy response"} title={copied ? "Copied" : "Copy response"}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
        {onSaveNote && <button type="button" onClick={save} disabled={saved} className="chat-icon-button" aria-label={saved ? "Saved to notes" : "Save response as note"} title={saved ? "Saved to notes" : "Save as note"}>{saved ? <Check size={15} /> : <BookmarkPlus size={15} />}</button>}
        {error && <span role="alert" className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
    {selected && <RecordPreview key={`${selected.type}:${selected.id}`} source={selected} state={state} onClose={() => setSelected(null)} />}
  </article>;
}

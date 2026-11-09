import { useState } from "react";
import { ApprovalCard } from "./ApprovalCard";
import { Brain, ArrowUpRight, BookmarkPlus, Check, Copy } from "lucide-react";
import { AIMessage, BrainState, KnowledgeItem } from "../types";
import { ChatSource, conversationTitle, readableMessage, referenceTitle } from "../utils/chatPresentation";
import { getLocalDateString } from "../utils/habitStreaks";
import { MarkdownView } from "./MarkdownView";
import { RecordIcon, RecordPreview, SourceReferences } from "./SourceReferences";
import { MessageImages } from "./ImageAttachments";
import { AgentActivity, useSmoothText, wasStreaming } from "./AgentActivity";

export function ConversationMessage({ message, state, onSaveNote, streaming, onDecide, followUps, onFollowUp }: { followUps?: { items: string[]; loading: boolean }; onFollowUp?: (text: string) => void; message: AIMessage; state?: BrainState | null; onSaveNote?: (note: KnowledgeItem) => void; streaming?: boolean; onDecide?: (approvalId: string, decision: "approve" | "reject") => Promise<void> }) {
  const [selected, setSelected] = useState<ChatSource | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const humanContent = () => readableMessage(message, state);
  const [continued] = useState(() => !streaming && wasStreaming(message.id));
  const shown = useSmoothText(message.id, message.content, !!streaming);
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
  if (message.role === "user") return <article data-message-id={message.id} className="chat-user-message">
    {message.attachments?.length ? <MessageImages attachments={message.attachments} /> : null}
    {message.content && <div>{message.content}</div>}
  </article>;
  return <article data-message-id={message.id} className={`chat-assistant-message ${streaming ? "is-streaming" : ""} ${continued ? "is-continued" : ""}`} aria-busy={streaming || undefined}>
    <div className="chat-assistant-avatar" aria-hidden="true" />
    <div className="chat-answer min-w-0">
      <span className="chat-assistant-name">Iris</span>
      {(streaming || message.activity?.length) && <AgentActivity steps={message.activity || []} live={streaming} writing={!!message.content} continued={continued} />}
      {shown && <MarkdownView className={`chat-prose ${streaming || shown.length < message.content.length ? "is-revealing" : ""}`} content={shown} renderReference={(type, id, before) => {
        const source = message.sources?.find(s => s.type === type && s.id === id) || { type, id, title: referenceTitle(type, id, message.sources, state) };
        const title = referenceTitle(type, id, message.sources, state);
        const repeatsTitle = before.replace(/[*`_]/g, "").trimEnd().toLocaleLowerCase().endsWith(title.toLocaleLowerCase());
        return <button type="button" className={`chat-inline-reference ${repeatsTitle ? "is-citation" : ""}`} aria-label={`Open ${type === "knowledge" ? "note" : type}: ${title}`} title={title} onClick={() => setSelected(source)}><RecordIcon type={type} />{!repeatsTitle && <span>{title}</span>}<ArrowUpRight size={12} className="shrink-0 opacity-60" /></button>;
      }} />}
      {!streaming && message.external?.length ? <ul className="chat-external">{message.external.map((item, i) => <li key={i}>
        <Check size={13} aria-hidden="true" />{item.link ? <a href={item.link} target="_blank" rel="noreferrer">{item.summary}<ArrowUpRight size={12} aria-hidden="true" /></a> : item.summary}
      </li>)}</ul> : null}
      {!streaming && message.approvals?.map(approval => <ApprovalCard key={approval.id} approval={approval} onDecide={onDecide ? decision => onDecide(approval.id, decision) : undefined} />)}
      {!streaming && <SourceReferences sources={message.sources} state={state} onSelect={setSelected} />}
      {message.rememberedIds?.length ? <button type="button" className="memory-remembered" onClick={() => window.dispatchEvent(new CustomEvent("synapse-open-memory", { detail: { id: message.rememberedIds![0] } }))}><Brain size={12} />Remembered{message.rememberedIds.length > 1 ? ` ${message.rememberedIds.length} facts` : ""}<ArrowUpRight size={11}/></button> : null}
      {message.memoryNotice && <p className="memory-chat-notice" role="status">Memory: {message.memoryNotice}</p>}
      {!streaming && <div className="chat-message-actions">
        <button type="button" onClick={copy} className="chat-icon-button" aria-label={copied ? "Copied response" : "Copy response"} title={copied ? "Copied" : "Copy response"}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
        {onSaveNote && <button type="button" onClick={save} disabled={saved} className="chat-icon-button" aria-label={saved ? "Saved to notes" : "Save response as note"} title={saved ? "Saved to notes" : "Save as note"}>{saved ? <Check size={15} /> : <BookmarkPlus size={15} />}</button>}
        {error && <span role="alert" className="text-xs text-red-500">{error}</span>}
      </div>}
      {!streaming && followUps?.loading && <div className="chat-follow-ups" aria-hidden="true">{[148, 196, 124].map(width => <span key={width} className="chat-follow-up-placeholder" style={{ width }} />)}</div>}
      {!streaming && !!followUps?.items.length && <div className="chat-follow-ups" role="group" aria-label="Suggested replies">
        {followUps.items.map((text, index) => <button type="button" key={text} className="chat-follow-up" style={{ animationDelay: `${index * 50}ms` }} onClick={() => onFollowUp?.(text)}>{text}</button>)}
      </div>}
    </div>
    {selected && <RecordPreview key={`${selected.type}:${selected.id}`} source={selected} state={state} onClose={() => setSelected(null)} />}
  </article>;
}

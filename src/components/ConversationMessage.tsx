import { useState } from "react";
import { ApprovalCard } from "./ApprovalCard";
import {
  ArrowUpRight,
  ArrowRight,
  Bookmark,
  CheckSquare,
  Check,
  Copy,
  ThumbsUp,
  ThumbsDown,
  Database,
  Cpu,
  Target,
  ListChecks,
  GraduationCap,
  Briefcase,
  Lightbulb,
  Sparkles,
  Compass,
  Calculator,
  Search,
  Code2,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";
import { AIMessage, BrainState, KnowledgeItem } from "../types";
import { ChatSource, conversationTitle, readableMessage, referenceTitle } from "../utils/chatPresentation";
import { getLocalDateString } from "../utils/habitStreaks";
import { MarkdownView } from "./MarkdownView";
import { RecordIcon, RecordPreview, SourceReferences } from "./SourceReferences";
import { MessageImages } from "./ImageAttachments";
import { AgentActivity, useSmoothText, wasStreaming } from "./AgentActivity";
import { IrisCard } from "./IrisCard";
import { IRIS_UI_FENCE, type IrisCardState, type IrisUiSpec } from "../utils/irisUi";
import type { CardChange } from "../services/irisCards";

/** How interactive cards in a reply reach the conversation. */
export interface CardHandlers {
  busy: boolean;
  addTasks: (messageId: string, block: number, spec: Extract<IrisUiSpec, { type: "checklist" }>, indexes: number[]) => Promise<void>;
  setState: (messageId: string, block: number, next: IrisCardState) => void;
  change: (changes: CardChange[]) => Promise<void>;
}

function getFollowUpIcon(text: string, index: number): LucideIcon {
  const lower = text.toLowerCase();
  if (/\b(dataset|csv|json|data|sql|database|table|extract|pipeline)\b/.test(lower)) return Database;
  if (/\b(code|function|algorithm|script|program|implement|bug|repo)\b/.test(lower)) return Code2;
  if (/\b(regime|physics|transition|model|neural|train|parameter|features?)\b/.test(lower)) return Cpu;
  if (/\b(point|points|value|values|exact|number|rate|metrics?|score)\b/.test(lower)) return Calculator;
  if (/\b(task|step|steps|todo|checklist|action|break down|process)\b/.test(lower)) return ListChecks;
  if (/\b(goal|milestone|target|objective|vision|aim)\b/.test(lower)) return Target;
  if (/\b(class|course|ta|exam|grade|quiz|lecture|student|study|academic)\b/.test(lower)) return GraduationCap;
  if (/\b(job|career|interview|resume|company|hire|intern)\b/.test(lower)) return Briefcase;
  if (/\b(why|how|what if|explain|explore|deep dive|analyze|analysis)\b/.test(lower)) return Lightbulb;
  if (/\b(search|find|lookup|source|reference|web)\b/.test(lower)) return Search;

  const fallbacks: LucideIcon[] = [Sparkles, Compass, HelpCircle];
  return fallbacks[index % fallbacks.length];
}

export function ConversationMessage({ message, state, onSaveNote, streaming, onDecide, followUps, onFollowUp, cards }: { cards?: CardHandlers; followUps?: { items: string[]; loading: boolean }; onFollowUp?: (text: string) => void; message: AIMessage; state?: BrainState | null; onSaveNote?: (note: KnowledgeItem) => void; streaming?: boolean; onDecide?: (approvalId: string, decision: "approve" | "reject") => Promise<void> }) {
  const [selected, setSelected] = useState<ChatSource | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [feedback, setFeedback] = useState<"like" | "dislike" | null>(null);
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
    <header className="chat-assistant-header">
      <div className={`chat-assistant-avatar-wrap ${streaming ? "is-typing" : ""}`} title="Iris">
        <span className="chat-assistant-avatar" aria-hidden="true" />
      </div>
      <div className="chat-assistant-meta">
        <span className="chat-assistant-name">Iris</span>
        {streaming && (
          <span className="chat-typing-status">
            <span>typing</span>
            <span className="chat-typing-dots">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
            </span>
          </span>
        )}
      </div>
    </header>
    <div className="chat-answer min-w-0">
      {(streaming || message.activity?.length) && <AgentActivity steps={message.activity || []} live={streaming} writing={!!message.content} continued={continued} />}
      {shown && <MarkdownView className={`chat-prose ${streaming || shown.length < message.content.length ? "is-revealing" : ""}`} content={shown} renderFence={(language, code, complete, block) => language !== IRIS_UI_FENCE ? undefined : <IrisCard code={code} complete={complete} state={state} saved={message.cardState?.[block]} actions={{
        interactive: !streaming && !cards?.busy,
        onReply: onFollowUp,
        onAddTasks: cards ? (spec, indexes) => cards.addTasks(message.id, block, spec, indexes) : undefined,
        onChange: cards ? next => cards.setState(message.id, block, next) : undefined,
        onChangeRecords: cards?.change,
        onOpenRecord: (type, id, title) => setSelected({ type, id, title }),
      }} />} renderReference={(type, id, before) => {
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
      {!streaming && (followUps?.items.length || followUps?.loading) ? (
        <div className="chat-follow-ups-section">
          <div className="chat-follow-ups-divider" />
          <div className="chat-follow-ups-header">
            <CheckSquare size={16} strokeWidth={1.8} />
            <span>Follow-Ups</span>
          </div>
          <div className="chat-follow-ups-list" role="group" aria-label="Next steps and questions you might have">
            {followUps?.loading ? (
              [1, 2, 3].map(num => (
                <div key={num} className="chat-follow-up-item is-loading">
                  <span className="chat-follow-up-icon-badge" aria-hidden="true">
                    <Sparkles size={13} strokeWidth={1.8} className="opacity-40" />
                  </span>
                  <span className="chat-follow-up-placeholder-bar" />
                </div>
              ))
            ) : (
              followUps?.items.map((text, index) => {
                const Icon = getFollowUpIcon(text, index);
                return (
                  <button
                    type="button"
                    key={text}
                    className="chat-follow-up chat-follow-up-item"
                    style={{ animationDelay: `${index * 40}ms` }}
                    onClick={() => onFollowUp?.(text)}
                  >
                    <span className="chat-follow-up-icon-badge" aria-hidden="true">
                      <Icon size={13} strokeWidth={2} />
                    </span>
                    <span className="chat-follow-up-text">{text}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
      {message.rememberedIds?.length ? (
        <button
          type="button"
          className="memory-remembered"
          onClick={() => window.dispatchEvent(new CustomEvent("synapse-open-memory", { detail: { id: message.rememberedIds![0] } }))}
        >
          <Bookmark size={13} strokeWidth={1.8} />
          <span>Remembered{message.rememberedIds.length > 1 ? ` ${message.rememberedIds.length} facts` : ""}</span>
          <ArrowRight size={12} strokeWidth={1.8} />
        </button>
      ) : null}
      {message.memoryNotice && <p className="memory-chat-notice" role="status">Memory: {message.memoryNotice}</p>}
      {!streaming && (
        <div className="chat-message-actions">
          <button type="button" onClick={copy} className="chat-icon-button" aria-label={copied ? "Copied response" : "Copy response"} title={copied ? "Copied" : "Copy response"}>
            {copied ? <Check size={15} /> : <Copy size={15} strokeWidth={1.6} />}
          </button>
          {onSaveNote && (
            <button type="button" onClick={save} disabled={saved} className="chat-icon-button" aria-label={saved ? "Saved to notes" : "Save response as note"} title={saved ? "Saved to notes" : "Save as note"}>
              {saved ? <Check size={15} /> : <Bookmark size={15} strokeWidth={1.6} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setFeedback(f => f === "like" ? null : "like")}
            className={`chat-icon-button ${feedback === "like" ? "is-active text-zinc-900 dark:text-zinc-100" : ""}`}
            aria-label="Good response"
            title="Good response"
          >
            <ThumbsUp size={15} strokeWidth={1.6} fill={feedback === "like" ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            onClick={() => setFeedback(f => f === "dislike" ? null : "dislike")}
            className={`chat-icon-button ${feedback === "dislike" ? "is-active text-zinc-900 dark:text-zinc-100" : ""}`}
            aria-label="Poor response"
            title="Poor response"
          >
            <ThumbsDown size={15} strokeWidth={1.6} fill={feedback === "dislike" ? "currentColor" : "none"} />
          </button>
          {error && <span role="alert" className="text-xs text-red-500">{error}</span>}
        </div>
      )}
    </div>
    {selected && <RecordPreview key={`${selected.type}:${selected.id}`} source={selected} state={state} onClose={() => setSelected(null)} />}
  </article>;
}

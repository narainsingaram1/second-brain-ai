import { FormEvent, KeyboardEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApprovalCard } from "./ApprovalCard";
import { ActionPreviewCard } from "./ActionPreviewCard";
import {
  ArrowUpRight,
  ArrowRight,
  Bookmark,
  CheckSquare,
  Check,
  Copy,
  GitBranch,
  Pencil,
  Quote,
  RotateCcw,
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
import { MessageFiles, MessageImages } from "./ImageAttachments";
import { AgentActivity, useSmoothText, wasStreaming } from "./AgentActivity";
import { IrisCard } from "./IrisCard";
import { IRIS_UI_FENCE, repairLeakedToolCalls, type IrisCardState, type IrisUiSpec } from "../utils/irisUi";
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

/** What the reader can do with a message: copy, quote into the composer, edit and resend, regenerate. */
export interface MessageActions {
  /** Puts a Markdown quote of this text into the composer. */
  onQuote?: (text: string) => void;
  /** User messages: resend with new text. `branch` keeps the original conversation. */
  onEdit?: (text: string, branch: boolean) => Promise<void> | void;
  /** Assistant messages: answer the question again. */
  onRegenerate?: () => void;
  /** Branching keeps a copy in Recent conversations, which temporary chats do not have. */
  canBranch?: boolean;
  /** A reply is in progress, so edits and regeneration wait. */
  busy?: boolean;
  /** Later messages exist and would be replaced. */
  hasLater?: boolean;
}

/** Copies text, falling back to a hidden text field where the Clipboard API is blocked (some webviews). */
export async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return; } catch { /* Try the older way below. */ }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(field);
  const selection = document.getSelection(), previous = selection?.rangeCount ? selection.getRangeAt(0) : null;
  field.select();
  const ok = document.execCommand("copy");
  field.remove();
  if (previous) { selection?.removeAllRanges(); selection?.addRange(previous); }
  if (!ok) throw new Error("Copy failed");
}

/** The selected text when the selection lies inside `root`, else "". */
export function selectionWithin(root: HTMLElement | null): string {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  if (!root || !selection || selection.isCollapsed || !selection.rangeCount) return "";
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer) ? selection.toString().trim() : "";
}

/** A user's message as typed, with Markdown quote lines ("> …") shown as quotes. */
export function UserText({ text }: { text: string }) {
  const groups: { quote: boolean; lines: string[] }[] = [];
  for (const line of text.split("\n")) {
    const quote = /^>\s?/.test(line);
    const last = groups[groups.length - 1];
    const value = quote ? line.replace(/^>\s?/, "") : line;
    if (last && last.quote === quote) last.lines.push(value); else groups.push({ quote, lines: [value] });
  }
  return <>{groups.map((group, index) => group.quote
    ? <blockquote key={index} className="chat-user-quote">{group.lines.join("\n")}</blockquote>
    : <span key={index}>{group.lines.join("\n").replace(/^\n+|\n+$/g, "")}</span>)}</>;
}

function MessageEditor({ initial, canBranch, onCancel, onSubmit }: { initial: string; canBranch?: boolean; onCancel: () => void; onSubmit: (text: string, branch: boolean) => void }) {
  const [text, setText] = useState(initial);
  const [branch, setBranch] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 320)}px`;
  }, [text]);
  useLayoutEffect(() => { const element = area.current; element?.focus(); element?.setSelectionRange(element.value.length, element.value.length); }, []);
  const submit = (event?: FormEvent) => { event?.preventDefault(); if (text.trim()) onSubmit(text.trim(), branch); };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
  };
  return <form className="chat-message-editor" onSubmit={submit}>
    <textarea ref={area} value={text} onChange={event => setText(event.target.value)} onKeyDown={keyDown} aria-label="Edit message" rows={1} />
    <div className="chat-message-editor-bar">
      {canBranch ? <label className="chat-branch-toggle" title="Keep the original conversation in Recent conversations and continue from here in a new one">
        <input type="checkbox" checked={branch} onChange={event => setBranch(event.target.checked)} />
        <GitBranch size={13} aria-hidden="true" />
        <span>Branch chat</span>
      </label> : <span />}
      <div className="flex items-center gap-2">
        <button type="button" className="chat-editor-cancel" onClick={onCancel}>Cancel</button>
        <button type="submit" className="chat-editor-send" disabled={!text.trim()}>{branch ? "Send in new chat" : "Send"}</button>
      </div>
    </div>
    <p className="chat-message-editor-hint">{branch ? "The original conversation stays in Recent conversations." : "Messages after this one are replaced by the new answer."}</p>
  </form>;
}

export function ConversationMessage({ message, state, onSaveNote, streaming, onDecide, followUps, onFollowUp, cards, actions }: { cards?: CardHandlers; actions?: MessageActions; followUps?: { items: string[]; loading: boolean }; onFollowUp?: (text: string) => void; message: AIMessage; state?: BrainState | null; onSaveNote?: (note: KnowledgeItem) => void; streaming?: boolean; onDecide?: (approvalId: string, decision: "approve" | "reject") => Promise<void> }) {
  const root = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<ChatSource | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [feedback, setFeedback] = useState<"like" | "dislike" | null>(null);
  const [error, setError] = useState("");
  const humanContent = () => readableMessage(message, state);
  const [continued] = useState(() => !streaming && wasStreaming(message.id));
  // Older replies may hold tool calls the model wrote as text; show them as cards, never as raw markup.
  const content = useMemo(() => message.role === "assistant" ? repairLeakedToolCalls(message.content) : message.content, [message.role, message.content]);
  const shown = useSmoothText(message.id, content, !!streaming);
  const copy = async () => {
    try {
      await copyText(message.role === "user" ? message.content : humanContent());
      setCopied(true);
      setError("");
      setTimeout(() => setCopied(false), 1600);
    } catch { setError("Copy failed. Select the text to copy it."); }
  };
  /** Quotes the selected part of this message, or all of it. */
  const quote = () => actions?.onQuote?.(selectionWithin(root.current) || (message.role === "user" ? message.content : humanContent()));
  // Keeps the text selection when the quote button is pressed.
  const keepSelection = (event: { preventDefault: () => void }) => event.preventDefault();
  const save = () => {
    if (!onSaveNote || saved) return;
    const content = humanContent(), title = conversationTitle(state?.chatHistory || []) === "New conversation" ? "Conversation note" : conversationTitle(state?.chatHistory || []);
    const today = getLocalDateString();
    onSaveNote({ id: crypto.randomUUID(), subject: title, title, content, summary: content.slice(0, 180), status: "Synthesized", startDate: today, endDate: today, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    setSaved(true);
  };
  if (message.role === "user") return <article ref={root} data-message-id={message.id} className={`chat-user-message ${editing ? "is-editing" : ""}`}>
    {message.attachments?.length ? <MessageImages attachments={message.attachments} /> : null}
    {message.files?.length ? <MessageFiles files={message.files} /> : null}
    {editing && actions?.onEdit ? <MessageEditor initial={message.content} canBranch={actions.canBranch} onCancel={() => setEditing(false)}
      onSubmit={(text, branch) => { setEditing(false); void actions.onEdit!(text, branch); }} />
      : message.content && <div className="chat-user-bubble"><UserText text={message.content} /></div>}
    {!editing && <div className="chat-user-actions">
      {message.content && <button type="button" onClick={copy} className="chat-icon-button" aria-label={copied ? "Copied prompt" : "Copy prompt"} title={copied ? "Copied" : "Copy prompt"}>
        {copied ? <Check size={14} /> : <Copy size={14} strokeWidth={1.6} />}
      </button>}
      {actions?.onQuote && message.content && <button type="button" onMouseDown={keepSelection} onClick={quote} className="chat-icon-button" aria-label="Quote in reply" title="Quote in reply (or select part of the message first)">
        <Quote size={14} strokeWidth={1.6} />
      </button>}
      {actions?.onEdit && <button type="button" onClick={() => setEditing(true)} disabled={actions.busy} className="chat-icon-button" aria-label="Edit message" title={actions.busy ? "Wait for the reply to finish" : "Edit and resend"}>
        <Pencil size={14} strokeWidth={1.6} />
      </button>}
      {error && <span role="alert" className="text-xs text-red-500">{error}</span>}
    </div>}
  </article>;
  return <article ref={root} data-message-id={message.id} className={`chat-assistant-message ${streaming ? "is-streaming" : ""} ${continued ? "is-continued" : ""}`} aria-busy={streaming || undefined}>
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
      {shown && <MarkdownView className={`chat-prose ${streaming || shown.length < content.length ? "is-revealing" : ""}`} content={shown} renderFence={(language, code, complete, block) => language !== IRIS_UI_FENCE ? undefined : <IrisCard code={code} complete={complete} state={state} saved={message.cardState?.[block]} actions={{
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
      {!streaming && message.actions?.length ? (
        <ActionPreviewCard
          actions={message.actions}
          state={state}
          onOpenRecord={(type, id, title) => setSelected({ type, id, title })}
        />
      ) : null}
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
          {actions?.onQuote && message.content && (
            <button type="button" onMouseDown={keepSelection} onClick={quote} className="chat-icon-button" aria-label="Quote in reply" title="Quote in reply (or select part of the answer first)">
              <Quote size={15} strokeWidth={1.6} />
            </button>
          )}
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
          {actions?.onRegenerate && (
            <button type="button" onClick={actions.onRegenerate} disabled={actions.busy} className="chat-icon-button" aria-label="Regenerate response"
              title={actions.busy ? "Wait for the reply to finish" : actions.hasLater ? "Regenerate (replaces the messages after it)" : "Regenerate response"}>
              <RotateCcw size={15} strokeWidth={1.6} />
            </button>
          )}
          {error && <span role="alert" className="text-xs text-red-500">{error}</span>}
        </div>
      )}
    </div>
    {selected && <RecordPreview key={`${selected.type}:${selected.id}`} source={selected} state={state} onClose={() => setSelected(null)} />}
  </article>;
}

import "../memory.css";
import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Briefcase, CalendarDays, CheckSquare, Clock3, Flame, GraduationCap, Lightbulb, Mail, MessageCircle, Mic, MicOff, Plus, RefreshCw, Settings2, PenLine, Square, Target, type LucideIcon } from "lucide-react";
import { googleStatus, serverFeatures } from "../services/serverApi";
import { AIMessage, BrainState, KnowledgeItem } from "../types";
import { BrainConversation } from "../hooks/useBrainConversation";
import { conversationTitle, isNearBottom } from "../utils/chatPresentation";
import { ConversationMessage } from "./ConversationMessage";
import { useConversationStarters } from "../hooks/useConversationStarters";
import type { StarterKind } from "../services/chatSuggestions";
import { AttachButton, AttachmentTray, useImageAttachments } from "./ImageAttachments";

interface ChatWorkspaceProps {
  conversation: BrainConversation;
  state?: BrainState | null;
  messages: AIMessage[];
  onSaveNote?: (note: KnowledgeItem) => void;
  onOpenSettings?: () => void;
  compact?: boolean;
  externalError?: string;
}
const STARTER_ICONS: Record<StarterKind, LucideIcon> = { task: CheckSquare, class: GraduationCap, goal: Target, career: Briefcase, habit: Flame, calendar: CalendarDays, email: Mail, idea: Lightbulb };
export function ChatWorkspace({ conversation, state, messages, onSaveNote, onOpenSettings, compact = false, externalError }: ChatWorkspaceProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setError(externalError || ""); }, [externalError]);
  const [showJump, setShowJump] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const attachments = useImageAttachments(setError);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const scrollingToBottom = useRef(false);
  const previousMessage = useRef<string | undefined>(undefined);
  const speech = useRef<{ stop: () => void; abort: () => void } | null>(null);
  const active = messages.some(m => m.role === "user");
  const visible = active ? messages.filter(m => m.role !== "system") : [];
  const last = visible[visible.length - 1];
  const draft = conversation.draft && !visible.some(m => m.id === conversation.draft!.id) ? conversation.draft : null;
  // A reply the reader watched stream in should not jump back to its beginning when it completes.
  const streamedId = useRef<string | undefined>(undefined);
  if (draft) streamedId.current = draft.id;
  const title = conversationTitle(messages);
  const archives = conversation.temporary ? [] : state?.conversations || [];
  const [google, setGoogle] = useState<{ calendar: boolean; gmail: boolean }>({ calendar: false, gmail: false });
  useEffect(() => {
    let live = true;
    serverFeatures().then(f => f.google ? googleStatus() : null)
      .then(s => { if (live && s?.connected && s.status === "active") setGoogle({ calendar: !!s.calendar, gmail: !!s.gmail }); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const { starters, refreshing, canRefresh, refresh } = useConversationStarters(state, !active, !conversation.temporary, google);
  const bottom = (smooth = false) => {
    if (!active) return;
    pinned.current = true;
    setShowJump(false);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollingToBottom.current = smooth && !reduced;
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: smooth && !reduced ? "smooth" : "auto" });
  };
  useLayoutEffect(() => {
    pinned.current = true;
    previousMessage.current = undefined;
    setShowJump(false);
    setInput("");
    setError("");
    if (active) bottom();
    else viewport.current?.scrollTo({ top: 0 });
  }, [state?.conversationId]);
  useLayoutEffect(() => {
    const element = viewport.current;
    const changed = previousMessage.current !== last?.id;
    previousMessage.current = last?.id;
    if (!element) return;
    if (pinned.current && changed && last?.role === "assistant" && last.id !== streamedId.current) {
      const answer = Array.from(element.querySelectorAll<HTMLElement>("[data-message-id]")).find(node => node.dataset.messageId === last.id);
      if (answer) {
        // Non-streamed long answers open at their beginning, rather than hiding it above the fold.
        element.scrollTop += answer.getBoundingClientRect().top - element.getBoundingClientRect().top - 20;
        const near = isNearBottom(element.scrollHeight, element.scrollTop, element.clientHeight);
        pinned.current = near;
        setShowJump(!near);
      }
    } else if (pinned.current) bottom();
    else setShowJump(!isNearBottom(element.scrollHeight, element.scrollTop, element.clientHeight));
  }, [last?.id, last?.content, conversation.busy]);
  useEffect(() => {
    if (!viewport.current || !content.current) return;
    const observer = new ResizeObserver(() => { if (pinned.current) bottom(); });
    observer.observe(viewport.current);
    observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (element) { element.style.height = "0px"; element.style.height = `${Math.min(element.scrollHeight, 160)}px`; }
  }, [input]);
  useEffect(() => () => speech.current?.abort(), []);
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = input.trim();
    const images = attachments.images;
    if ((!prompt && !images.length) || conversation.busy || attachments.processing) return;
    setError("");
    setInput("");
    attachments.clear();
    pinned.current = true;
    try { await conversation.run(prompt, images.length ? { images } : undefined); }
    catch (err) { setError(err instanceof Error ? err.message : "The request failed. Try again."); setInput(prompt); attachments.restore(images); }
  };
  /** Sends a tapped starter or suggested reply as if it had been typed. */
  const send = async (text: string) => {
    if (conversation.busy) return;
    setError("");
    pinned.current = true;
    try { await conversation.run(text); }
    catch (err) { setError(err instanceof Error ? err.message : "The request failed. Try again."); setInput(text); }
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
  };
  const dictate = () => {
    if (recording) { speech.current?.stop(); setRecording(false); return; }
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) { setError("Voice input isn’t available in this browser. You can type your message below."); return; }
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.onresult = (event: any) => setInput(previous => `${previous}${previous ? " " : ""}${event.results[0][0].transcript}`);
    recognition.onend = () => setRecording(false);
    recognition.onerror = () => { setRecording(false); setError("Voice input stopped. Check microphone access or type your message."); };
    speech.current = recognition;
    try { recognition.start(); setRecording(true); } catch { setError("Could not start voice input."); }
  };
  const composer = (
    <div className="chat-composer-dock">
      <div className="chat-composer-width">
        {conversation.temporary && !active && <p className="chat-composer-hint">Temporary chat: saved memory is off and this transcript is not saved.</p>}{error && <p role="alert" className="chat-error">{error}</p>}
        <form onSubmit={submit} className={`chat-composer ${attachments.dragging ? "is-dragging" : ""}`} {...attachments.dropProps}>
          {attachments.picker}
          <AttachmentTray images={attachments.images} processing={attachments.processing} onRemove={attachments.remove} />
          <textarea ref={textarea} rows={1} value={input} onChange={event => setInput(event.target.value)} onKeyDown={keyDown} onPaste={attachments.onPaste} aria-label="Message Iris" placeholder={attachments.images.length ? "Ask about the image, or send to analyze / add as tasks…" : active ? "Ask a follow-up…" : "Ask about your tasks, notes or courses"} />
          <div className="chat-composer-toolbar">
            <div className="flex items-center gap-2 min-w-0"><PenLine size={14} className="text-muted shrink-0" /><span className="chat-model" title={state?.selectedModel}>{state?.selectedModel?.split("/").pop() || "Iris"}</span>{onOpenSettings && <button type="button" className="chat-icon-button" onClick={onOpenSettings} aria-label="Configure AI provider"><Settings2 size={15} /></button>}</div>
            <div className="flex items-center gap-1.5"><AttachButton onClick={attachments.openPicker} disabled={conversation.busy} />{conversation.setTemporary && <button type="button" className="chat-temporary" disabled={conversation.busy} aria-label="Temporary chat" aria-pressed={conversation.temporary || false} onClick={() => conversation.setTemporary?.(!conversation.temporary)} title="Temporary chats do not use saved memory or save their transcript">{conversation.temporary ? "Temporary on" : "Temporary"}</button>}<button type="button" onClick={dictate} className={`chat-icon-button ${recording ? "text-red-500" : ""}`} aria-label={recording ? "Stop dictation" : "Voice input"} aria-pressed={recording}>{recording ? <MicOff size={17} /> : <Mic size={17} />}</button>
              {conversation.busy ? <button type="button" onClick={conversation.stop} className="chat-send is-stop" aria-label="Stop response"><Square size={13} fill="currentColor" /></button> : <button type="submit" className="chat-send" disabled={(!input.trim() && !attachments.images.length) || attachments.processing} aria-label="Send message"><ArrowUp size={19} /></button>}
            </div>
          </div>
        </form>
        <p className="chat-composer-hint">{conversation.busy ? "Working with your records. You can stop at any time." : "Enter to send · Shift + Enter for a new line · Paste or drop images"}</p>
      </div>
    </div>
  );
  return <section className={`chat-workspace ${active ? "is-conversation" : "is-welcome"} ${compact ? "is-compact" : ""}`} aria-label="AI conversation">
    {active && <header className="chat-toolbar">
      <div className="min-w-0"><h1 className="truncate text-sm font-semibold" title={title}>{title}</h1><p className="text-[11px] text-slate-400 mt-0.5">{conversation.temporary ? "Temporary · memory off · transcript not saved" : "Iris"}</p></div>
      <div className="flex items-center gap-2 shrink-0"><button type="button" onClick={conversation.startNew} disabled={conversation.busy} className="chat-new-button" aria-label="New chat"><Plus size={15} /><span>New chat</span></button>{onOpenSettings && <button type="button" onClick={onOpenSettings} className="chat-icon-button" aria-label="AI settings"><Settings2 size={17} /></button>}</div>
    </header>}
    <div className="chat-message-region">
      <div ref={viewport} className="chat-scroll" data-testid="chat-scroll" tabIndex={0} aria-label={active ? "Conversation messages" : "Welcome"}
        onWheel={() => { scrollingToBottom.current = false; }} onTouchStart={() => { scrollingToBottom.current = false; }} onPointerDown={() => { scrollingToBottom.current = false; }} onKeyDown={() => { scrollingToBottom.current = false; }}
        onScroll={event => { const element = event.currentTarget; const near = isNearBottom(element.scrollHeight, element.scrollTop, element.clientHeight); if (scrollingToBottom.current && !near) return; scrollingToBottom.current = false; pinned.current = near; setShowJump(!near); }}>
        <div ref={content} className={active ? "chat-transcript" : "chat-welcome-content"}>
          {active ? <>
            {visible.map(message => <ConversationMessage key={message.id} message={message} state={state} onSaveNote={onSaveNote} onDecide={message.approvals?.length ? (approvalId, decision) => conversation.decideApproval(message.id, approvalId, decision) : undefined} followUps={message.id === last?.id && !conversation.busy && conversation.followUps?.messageId === message.id ? conversation.followUps : undefined} onFollowUp={text => void send(text)} cards={{ busy: conversation.busy, addTasks: conversation.addCardTasks, setState: conversation.setCardState }} />)}
            {/* The reply in progress: live steps first, then its text as it streams in. One stable element for the whole turn. */}
            {conversation.busy && last?.role === "user" && <ConversationMessage key="live-turn" state={state} streaming
              message={{ id: draft?.id || "live-turn", role: "assistant", content: draft?.content || "", timestamp: "", activity: conversation.activity }} />}
          </> : <div className="chat-welcome-inner">
            <span className="chat-welcome-mark" aria-hidden="true" />
            <h1>Ask Iris</h1>
            <p className="chat-welcome-subtitle">Iris has read your tasks, notes, goals, journal and course materials, and can change them when you ask</p>
            {composer}
            <section className="chat-starters" aria-label="Conversation starters">
              <div className="chat-starters-head">
                <h2>For you</h2>
                {canRefresh && <button type="button" onClick={refresh} disabled={refreshing} aria-label="Suggest something else" title="Suggest something else"><RefreshCw size={13} className={refreshing ? "is-spinning" : ""} /></button>}
              </div>
              <div className="chat-suggestions" key={starters.map(s => s.title).join("|")}>{starters.map((starter, index) => {
                const Icon = STARTER_ICONS[starter.kind];
                return <button type="button" key={starter.title} data-kind={starter.kind} style={{ animationDelay: `${index * 40}ms` }} onClick={() => void send(starter.prompt)} className="chat-suggestion">
                  <span className="chat-suggestion-icon"><Icon size={15} aria-hidden="true" /></span>
                  <strong>{starter.title}</strong>
                  <span className="chat-suggestion-detail">{starter.detail}</span>
                </button>;
              })}</div>
            </section>
            <section className="chat-recents" aria-label="Recent conversations"><div className="flex items-center justify-between mb-3"><h2 className="text-[15px] font-medium">Recent conversations</h2>{archives.length > 3 && <button type="button" className="text-xs text-muted" onClick={() => setShowAllRecent(!showAllRecent)}>{showAllRecent ? "Show less" : "View all"}</button>}</div><div className="chat-recent-list">{archives.slice(0, showAllRecent ? archives.length : 3).map(thread => <button type="button" key={thread.id} onClick={() => conversation.resume(thread.id)} className="chat-recent"><span className="chat-recent-icon"><Clock3 size={16} strokeWidth={1.5} /></span><span className="min-w-0 flex-1"><strong>{thread.title}</strong><span>{thread.messages.filter(m => m.role === "user").length} messages · {new Date(thread.updatedAt).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}</span></span><ArrowUpRight size={16} className="text-slate-400 shrink-0" /></button>)}{archives.length === 0 && <div className="chat-empty-recents"><MessageCircle size={16} strokeWidth={1.5} /><div><strong>No past conversations</strong><p>Finished chats are kept here so you can pick them up again</p></div></div>}</div></section>
          </div>}
        </div>
      </div>
      {active && showJump && <button type="button" className="chat-jump" onClick={() => bottom(true)} aria-label="Jump to latest message"><ArrowDown size={15} />Latest</button>}
    </div>
    {active && composer}
  </section>;
}

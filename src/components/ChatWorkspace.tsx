import "../memory.css";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Box, Briefcase, CalendarDays, CheckSquare, ChevronDown, Clock3, Flame, GraduationCap, Image as ImageIcon, Lightbulb, Mail, MessageCircle, Mic, MicOff, PanelLeft, Paperclip, Plus, Quote, RefreshCw, SlidersHorizontal, Square, type LucideIcon } from "lucide-react";
import { googleStatus, serverFeatures } from "../services/serverApi";
import { OPENROUTER_MODELS, resolveModel } from "../services/openrouter";
import { AIMessage, BrainState, KnowledgeItem } from "../types";
import { BrainConversation } from "../hooks/useBrainConversation";
import { BrowserConfirmCard } from "./BrowserConfirmCard";
import { AskUserCard } from "./AskUserCard";
import { AgentToasts } from "./AgentToasts";
import { conversationTitle, isNearBottom } from "../utils/chatPresentation";
import { ConversationMessage } from "./ConversationMessage";
import { useConversationStarters } from "../hooks/useConversationStarters";
import type { StarterKind } from "../services/chatSuggestions";
import { AttachmentTray, useImageAttachments } from "./ImageAttachments";
import { withQuote } from "../utils/chatFiles";
import { ChatHistoryRail, ChatRunningDot } from "./ChatHistoryRail";

const RAIL_KEY = "synapse.chatHistoryRail";
const readRail = () => { try { const saved = localStorage.getItem(RAIL_KEY); return saved ? saved === "1" : window.innerWidth >= 1100; } catch { return true; } };

interface ChatWorkspaceProps {
  conversation: BrainConversation;
  state?: BrainState | null;
  messages: AIMessage[];
  onSaveNote?: (note: KnowledgeItem) => void;
  onOpenSettings?: () => void;
  compact?: boolean;
  externalError?: string;
}
const STARTER_ICONS: Record<StarterKind, LucideIcon> = { task: CheckSquare, class: GraduationCap, career: Briefcase, habit: Flame, calendar: CalendarDays, email: Mail, idea: Lightbulb };
export function ChatWorkspace({ conversation, state, messages, onSaveNote, onOpenSettings, compact = false, externalError }: ChatWorkspaceProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setError(externalError || ""); }, [externalError]);
  const [showJump, setShowJump] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [railOpen, setRailOpen] = useState(readRail);
  const toggleRail = (open: boolean) => { setRailOpen(open); try { localStorage.setItem(RAIL_KEY, open ? "1" : "0"); } catch { /* Only a convenience. */ } };
  const runningIds = conversation.runningIds || [];
  const attachments = useImageAttachments(setError, { documents: true });
  const [selectionQuote, setSelectionQuote] = useState<{ text: string; top: number; left: number } | null>(null);
  const region = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const scrollingToBottom = useRef(false);
  const previousMessage = useRef<string | undefined>(undefined);
  const speech = useRef<{ stop: () => void; abort: () => void } | null>(null);
  const active = messages.some(m => m.role === "user");
  const visible = useMemo(() => (active ? messages.filter(m => m.role !== "system") : []), [active, messages]);
  const firstUserIndex = useMemo(() => visible.findIndex(m => m.role === "user"), [visible]);
  const last = visible[visible.length - 1];
  const draft = conversation.draft && !visible.some(m => m.id === conversation.draft!.id) ? conversation.draft : null;
  const activeModelId = resolveModel(state?.selectedModel);
  const activeModelLabel = OPENROUTER_MODELS.find(m => m.id === activeModelId)?.name || activeModelId.split("/").pop() || activeModelId;
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
    const { images, files } = attachments;
    if ((!prompt && !images.length && !files.length) || conversation.busy || attachments.processing) return;
    setError("");
    setInput("");
    attachments.clear();
    pinned.current = true;
    try { await conversation.run(prompt, images.length || files.length ? { ...(images.length ? { images } : {}), ...(files.length ? { files } : {}) } : undefined); }
    catch (err) { setError(err instanceof Error ? err.message : "The request failed. Try again."); setInput(prompt); attachments.restore(images, files); }
  };
  /** Adds a Markdown quote to the composer and puts the cursor under it. */
  const quoteIntoComposer = useCallback((text: string) => {
    if (!text.trim()) return;
    setInput(previous => withQuote(previous, text));
    setSelectionQuote(null);
    window.getSelection()?.removeAllRanges();
    requestAnimationFrame(() => { const element = textarea.current; if (element) { element.focus(); element.setSelectionRange(element.value.length, element.value.length); } });
  }, []);
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  /** Edit & resend, or regenerate: both trim the conversation back to that turn and answer again. */
  const resubmit = useCallback(async (messageId: string, text?: string, branch = false) => {
    const current = conversationRef.current;
    if (current.busy || !current.resubmit) return;
    setError("");
    pinned.current = true;
    try { await current.resubmit(messageId, text, { branch }); }
    catch (err) { setError(err instanceof Error ? err.message : "The request failed. Try again."); }
  }, []);
  const handleSendFollowUp = useCallback((text: string) => {
    const current = conversationRef.current;
    if (current.busy) return;
    setError("");
    pinned.current = true;
    void current.run(text).catch(err => {
      setError(err instanceof Error ? err.message : "The request failed. Try again.");
      setInput(text);
    });
  }, []);
  const handleCardAddTasks = useCallback((messageId: string, block: number, spec: any, indexes: number[]) =>
    conversationRef.current.addCardTasks(messageId, block, spec, indexes), []);
  const handleCardSetState = useCallback((messageId: string, block: number, next: any) =>
    conversationRef.current.setCardState(messageId, block, next), []);
  const handleCardChange = useCallback((changes: any) =>
    conversationRef.current.changeFromCard(changes), []);
  const cardsHandlers = useMemo(() => ({
    busy: conversation.busy,
    addTasks: handleCardAddTasks,
    setState: handleCardSetState,
    change: handleCardChange,
  }), [conversation.busy, handleCardAddTasks, handleCardSetState, handleCardChange]);
  const handleDecideApproval = useCallback((messageId: string, approvalId: string, decision: "approve" | "reject") =>
    conversationRef.current.decideApproval(messageId, approvalId, decision), []);
  const handleFeedback = useCallback((messageId: string, feedback: "like" | "dislike" | null) =>
    conversationRef.current.setMessageFeedback?.(messageId, feedback ?? undefined), []);
  // A small "Quote" button over text selected in a message.
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = window.getSelection();
        const box = region.current?.getBoundingClientRect();
        if (!selection || selection.isCollapsed || !selection.rangeCount || !box) { setSelectionQuote(null); return; }
        const range = selection.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const message = (node instanceof Element ? node : node.parentElement)?.closest("[data-message-id]");
        const text = selection.toString().trim();
        if (!message || !content.current?.contains(message) || message.querySelector(".chat-message-editor") || !text) { setSelectionQuote(null); return; }
        const rect = range.getBoundingClientRect();
        setSelectionQuote({ text, top: Math.max(4, rect.top - box.top - 38), left: Math.min(Math.max(48, rect.left + rect.width / 2 - box.left), box.width - 48) });
      });
    };
    document.addEventListener("selectionchange", update);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("selectionchange", update); };
  }, [active]);
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
          <AttachmentTray images={attachments.images} files={attachments.files} processing={attachments.processing} onRemove={attachments.remove} />
          <textarea ref={textarea} rows={1} value={input} onChange={event => setInput(event.target.value)} onKeyDown={keyDown} onPaste={attachments.onPaste} aria-label="Message Iris" placeholder={attachments.files.length ? "Ask about the file, or send to get a summary…" : attachments.images.length ? "Ask about the image, or send to analyze / add as tasks…" : active ? "Ask a follow-up…" : "Ask about your tasks, notes or courses"} />
          <div className="chat-composer-toolbar">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                className="chat-icon-button"
                onClick={attachments.openPicker}
                disabled={conversation.busy}
                aria-label="Attach file"
                title="Attach a PDF, Word, Excel, PowerPoint, CSV, text file or image"
              >
                <Paperclip size={17} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="chat-model-pill"
                onClick={onOpenSettings}
                title={activeModelId}
              >
                <Box size={13} className="text-zinc-500 shrink-0" strokeWidth={1.8} />
                <span className="chat-model-name truncate">
                  {activeModelLabel}
                </span>
                <ChevronDown size={12} className="text-zinc-400 shrink-0" />
              </button>
              {onOpenSettings && (
                <button
                  type="button"
                  className="chat-icon-button"
                  onClick={onOpenSettings}
                  aria-label="Configure AI parameters"
                  title="Configure AI parameters"
                >
                  <SlidersHorizontal size={15} strokeWidth={1.8} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="chat-icon-button"
                onClick={attachments.openImagePicker}
                disabled={conversation.busy}
                aria-label="Attach images"
                title="Attach images"
              >
                <ImageIcon size={17} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={dictate}
                className={`chat-icon-button ${recording ? "text-red-500" : ""}`}
                aria-label={recording ? "Stop dictation" : "Voice input"}
                aria-pressed={recording}
              >
                {recording ? <MicOff size={17} strokeWidth={1.8} /> : <Mic size={17} strokeWidth={1.8} />}
              </button>
              {conversation.busy ? (
                <button type="button" onClick={conversation.stop} className="chat-send is-stop" aria-label="Stop response">
                  <Square size={13} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="chat-send"
                  disabled={(!input.trim() && !attachments.images.length && !attachments.files.length) || attachments.processing}
                  aria-label="Send message"
                >
                  <ArrowUp size={18} strokeWidth={2.4} />
                </button>
              )}
            </div>
          </div>
        </form>
        <p className="chat-composer-hint">{conversation.busy ? "Working with your records. You can stop at any time." : "Enter to send · Shift + Enter for a new line · Paste or drop images and files"}</p>
      </div>
    </div>
  );
  return <section className={`chat-workspace ${active ? "is-conversation" : "is-welcome"} ${compact ? "is-compact" : ""} ${active && railOpen ? "has-rail" : ""}`} aria-label="AI conversation">
    {active && railOpen && <ChatHistoryRail openId={conversation.openId || state?.conversationId} openMessages={messages} archives={archives}
      runningIds={runningIds} temporary={conversation.temporary} onOpen={conversation.resume} onNew={conversation.startNew} onClose={() => toggleRail(false)} />}
    <div className="chat-main">
    {active && <header className="chat-toolbar">
      <div className="flex items-center gap-2 min-w-0">
      {!railOpen && <button type="button" className="chat-icon-button shrink-0" onClick={() => toggleRail(true)} aria-label="Show chat history" title="Show chat history">
        <PanelLeft size={16} strokeWidth={1.8} />
        {runningIds.some(id => id !== conversation.openId) && <span className="chat-rail-badge" aria-hidden="true" />}
      </button>}
      <div className="min-w-0">
        <h1 className="chat-thread-title truncate" title={title}>{title}</h1>
        <p className="chat-thread-sub">{conversation.temporary ? "Temporary · memory off · transcript not saved" : "Iris"}</p>
      </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button type="button" onClick={conversation.startNew} disabled={conversation.temporary && conversation.busy} className="chat-new-button" aria-label="New chat">
          <Plus size={14} strokeWidth={2} />
          <span>New chat</span>
        </button>
        {onOpenSettings && (
          <button type="button" onClick={onOpenSettings} className="chat-icon-button" aria-label="AI settings" title="AI settings">
            <SlidersHorizontal size={16} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </header>}
    <div ref={region} className="chat-message-region">
      <div ref={viewport} className="chat-scroll" data-testid="chat-scroll" tabIndex={0} aria-label={active ? "Conversation messages" : "Welcome"}
        onWheel={() => { scrollingToBottom.current = false; }} onTouchStart={() => { scrollingToBottom.current = false; }} onPointerDown={() => { scrollingToBottom.current = false; }} onKeyDown={() => { scrollingToBottom.current = false; }}
        onScroll={event => { setSelectionQuote(null); const element = event.currentTarget; const near = isNearBottom(element.scrollHeight, element.scrollTop, element.clientHeight); if (scrollingToBottom.current && !near) return; scrollingToBottom.current = false; pinned.current = near; setShowJump(!near); }}>
        <div ref={content} className={active ? "chat-transcript" : "chat-welcome-content"}>
          {active ? <>
            {visible.map((message, index) => <ConversationMessage key={message.id} message={message} state={state} onSaveNote={onSaveNote}
              actions={{
                busy: conversation.busy,
                canBranch: !conversation.temporary,
                hasLater: index < visible.length - 1,
                onQuote: quoteIntoComposer,
                ...(conversation.resubmit ? message.role === "user"
                  ? { onEdit: (text: string, branch: boolean) => resubmit(message.id, text, branch) }
                  : firstUserIndex >= 0 && index > firstUserIndex ? { onRegenerate: () => void resubmit(message.id) } : {} : {}),
              }} onDecide={message.approvals?.length ? (approvalId, decision) => handleDecideApproval(message.id, approvalId, decision) : undefined}
              onFeedback={conversation.setMessageFeedback ? handleFeedback : undefined}
              followUps={message.id === last?.id && !conversation.busy && conversation.followUps?.messageId === message.id ? conversation.followUps : undefined}
              onFollowUp={handleSendFollowUp} cards={cardsHandlers} />)}
            {/* The reply in progress: live steps first, then its text as it streams in. One stable element for the whole turn. */}
            {conversation.busy && last?.role === "user" && <ConversationMessage key="live-turn" state={state} streaming
              message={{ id: draft?.id || "live-turn", role: "assistant", content: draft?.content || "", timestamp: "", activity: conversation.activity }} />}
            {conversation.busy && conversation.browserConfirm && conversation.answerBrowserConfirm &&
              <BrowserConfirmCard request={conversation.browserConfirm} onAnswer={conversation.answerBrowserConfirm} />}
            {conversation.busy && conversation.userQuestion && conversation.answerUserQuestion &&
              <AskUserCard request={conversation.userQuestion} onAnswer={conversation.answerUserQuestion} />}
            {conversation.busy && !!conversation.agentToasts?.length &&
              <AgentToasts toasts={conversation.agentToasts} onDismiss={id => conversation.dismissAgentToast?.(id)} onStop={conversation.stop} />}
          </> : <div className="chat-welcome-inner">
            <span className="chat-welcome-mark" aria-hidden="true" />
            <h1>Ask Iris</h1>
            <p className="chat-welcome-subtitle">Iris has read your tasks, notes, journal and course materials, and can change them when you ask</p>
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
            <section className="chat-recents" aria-label="Recent conversations"><div className="flex items-center justify-between mb-3"><h2 className="text-[15px] font-medium">Recent conversations</h2>{archives.length > 3 && <button type="button" className="text-xs text-muted" onClick={() => setShowAllRecent(!showAllRecent)}>{showAllRecent ? "Show less" : "View all"}</button>}</div><div className="chat-recent-list">{archives.slice(0, showAllRecent ? archives.length : 3).map(thread => <button type="button" key={thread.id} onClick={() => conversation.resume(thread.id)} className="chat-recent"><span className="chat-recent-icon">{runningIds.includes(thread.id) ? <ChatRunningDot /> : <Clock3 size={16} strokeWidth={1.5} />}</span><span className="min-w-0 flex-1"><strong>{thread.title}</strong><span>{runningIds.includes(thread.id) ? "Answering… · " : ""}{thread.messages.filter(m => m.role === "user").length} messages · {new Date(thread.updatedAt).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}</span></span><ArrowUpRight size={16} className="text-slate-400 shrink-0" /></button>)}{archives.length === 0 && <div className="chat-empty-recents"><MessageCircle size={16} strokeWidth={1.5} /><div><strong>No past conversations</strong><p>Finished chats are kept here so you can pick them up again</p></div></div>}</div></section>
          </div>}
        </div>
      </div>
      {active && selectionQuote && (
        <button type="button" className="chat-selection-quote" style={{ top: selectionQuote.top, left: selectionQuote.left }}
          onMouseDown={event => event.preventDefault()} onClick={() => quoteIntoComposer(selectionQuote.text)} aria-label="Quote selection in reply">
          <Quote size={13} strokeWidth={2} />
          <span>Quote</span>
        </button>
      )}
      {active && showJump && (
        <button type="button" className="chat-jump" onClick={() => bottom(true)} aria-label="Jump to latest message">
          <ArrowDown size={13} strokeWidth={2} />
          <span>Latest</span>
        </button>
      )}
    </div>
    {active && composer}
    </div>
  </section>;
}

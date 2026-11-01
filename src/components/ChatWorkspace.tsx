import "../memory.css";
import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, CheckSquare, Clock3, Lightbulb, MessageCircle, Mic, MicOff, Plus, Settings2, Sparkles, Square, Target } from "lucide-react";
import { AIMessage, BrainState, KnowledgeItem } from "../types";
import { BrainConversation } from "../hooks/useBrainConversation";
import { conversationTitle, isNearBottom } from "../utils/chatPresentation";
import { ConversationMessage } from "./ConversationMessage";

interface ChatWorkspaceProps {
  conversation: BrainConversation;
  state?: BrainState | null;
  messages: AIMessage[];
  onSaveNote?: (note: KnowledgeItem) => void;
  onOpenSettings?: () => void;
  compact?: boolean;
}
const suggestions = [
  { icon: MessageCircle, title: "Explore a thought", detail: "Find a little clarity", prompt: "Help me think through " },
  { icon: CheckSquare, title: "Plan my day", detail: "Turn ideas into action", prompt: "Help me plan today using my tasks, goals, and habits. Include overdue tasks separately and suggest a realistic order." },
  { icon: Target, title: "Review my goals", detail: "Find a clearer next step", prompt: "Review all my goals and suggest concrete improvements based on their current progress and milestones." },
  { icon: Lightbulb, title: "Connect ideas", detail: "Explore your notes", prompt: "Help me find connections between my recent notes and goals." },
];
export function ChatWorkspace({ conversation, state, messages, onSaveNote, onOpenSettings, compact = false }: ChatWorkspaceProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [showJump, setShowJump] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
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
  const title = conversationTitle(messages);
  const archives = conversation.temporary ? [] : state?.conversations || [];
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
    if (pinned.current && changed && last?.role === "assistant") {
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
    if (!prompt || conversation.busy) return;
    setError("");
    setInput("");
    pinned.current = true;
    try { await conversation.run(prompt); }
    catch (err) { setError(err instanceof Error ? err.message : "The request failed. Try again."); setInput(prompt); }
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
        <form onSubmit={submit} className="chat-composer">
          <textarea ref={textarea} rows={1} value={input} onChange={event => setInput(event.target.value)} onKeyDown={keyDown} aria-label="Message Synapse" placeholder={active ? "Ask a follow-up…" : "Ask Synapse anything…"} />
          <div className="chat-composer-toolbar">
            <div className="flex items-center gap-2 min-w-0"><Sparkles size={14} className="text-indigo-500 shrink-0" /><span className="chat-model" title={state?.selectedModel}>{state?.selectedModel?.split("/").pop() || "Synapse"}</span>{onOpenSettings && <button type="button" className="chat-icon-button" onClick={onOpenSettings} aria-label="Configure AI provider"><Settings2 size={15} /></button>}</div>
            <div className="flex items-center gap-1.5">{conversation.setTemporary && <button type="button" className="chat-temporary" disabled={conversation.busy} aria-label="Temporary chat" aria-pressed={conversation.temporary || false} onClick={() => conversation.setTemporary?.(!conversation.temporary)} title="Temporary chats do not use saved memory or save their transcript">{conversation.temporary ? "Temporary on" : "Temporary"}</button>}<button type="button" onClick={dictate} className={`chat-icon-button ${recording ? "text-red-500" : ""}`} aria-label={recording ? "Stop dictation" : "Voice input"} aria-pressed={recording}>{recording ? <MicOff size={17} /> : <Mic size={17} />}</button>
              {conversation.busy ? <button type="button" onClick={conversation.stop} className="chat-send is-stop" aria-label="Stop response"><Square size={13} fill="currentColor" /></button> : <button type="submit" className="chat-send" disabled={!input.trim()} aria-label="Send message"><ArrowUp size={19} /></button>}
            </div>
          </div>
        </form>
        <p className="chat-composer-hint">{conversation.busy ? "Working with your records. You can stop at any time." : "Enter to send · Shift + Enter for a new line"}</p>
      </div>
    </div>
  );
  return <section className={`chat-workspace ${active ? "is-conversation" : "is-welcome"} ${compact ? "is-compact" : ""}`} aria-label="AI conversation">
    {active && <header className="chat-toolbar">
      <div className="min-w-0"><h1 className="truncate text-sm font-semibold" title={title}>{title}</h1><p className="text-[11px] text-slate-400 mt-0.5">{conversation.temporary ? "Temporary · memory off · transcript not saved" : "Your second brain"}</p></div>
      <div className="flex items-center gap-2 shrink-0"><button type="button" onClick={conversation.startNew} disabled={conversation.busy} className="chat-new-button" aria-label="New chat"><Plus size={15} /><span>New chat</span></button>{onOpenSettings && <button type="button" onClick={onOpenSettings} className="chat-icon-button" aria-label="AI settings"><Settings2 size={17} /></button>}</div>
    </header>}
    <div className="chat-message-region">
      <div ref={viewport} className="chat-scroll" data-testid="chat-scroll" tabIndex={0} aria-label={active ? "Conversation messages" : "Welcome"}
        onWheel={() => { scrollingToBottom.current = false; }} onTouchStart={() => { scrollingToBottom.current = false; }} onPointerDown={() => { scrollingToBottom.current = false; }} onKeyDown={() => { scrollingToBottom.current = false; }}
        onScroll={event => { const element = event.currentTarget; const near = isNearBottom(element.scrollHeight, element.scrollTop, element.clientHeight); if (scrollingToBottom.current && !near) return; scrollingToBottom.current = false; pinned.current = near; setShowJump(!near); }}>
        <div ref={content} className={active ? "chat-transcript" : "chat-welcome-content"}>
          {active ? <>
            {visible.map(message => <ConversationMessage key={message.id} message={message} state={state} onSaveNote={onSaveNote} />)}
            {conversation.busy && <div className="chat-thinking" role="status"><span className="chat-thinking-dot" /><span>{conversation.progress || "Thinking…"}</span></div>}
          </> : <div className="chat-welcome-inner">
            <p className="chat-eyebrow">A little clarity. A little momentum.</p>
            <h1>What’s on <span>your mind?</span></h1>
            <p className="chat-welcome-subtitle">Think deeper. Plan smarter. Do more.</p>
            {composer}
            <div className="chat-suggestions">{suggestions.map(({ icon: Icon, ...suggestion }) => <button type="button" key={suggestion.title} onClick={() => { setInput(suggestion.prompt); textarea.current?.focus(); }} className="chat-suggestion"><Icon size={18} /><strong>{suggestion.title}</strong><span>{suggestion.detail}</span></button>)}</div>
            <section className="chat-recents" aria-label="Recent conversations"><div className="flex items-center justify-between mb-3"><h2 className="text-sm font-semibold">Recent conversations</h2>{archives.length > 3 && <button type="button" className="text-xs text-indigo-500" onClick={() => setShowAllRecent(!showAllRecent)}>{showAllRecent ? "Show less" : "View all"}</button>}</div><div className="chat-recent-list">{archives.slice(0, showAllRecent ? archives.length : 3).map(thread => <button type="button" key={thread.id} onClick={() => conversation.resume(thread.id)} className="chat-recent"><span className="chat-recent-icon"><Clock3 size={17} /></span><span className="min-w-0 flex-1"><strong>{thread.title}</strong><span>{thread.messages.filter(m => m.role === "user").length} messages</span></span><ArrowUpRight size={16} className="text-slate-400 shrink-0" /></button>)}{archives.length === 0 && <div className="chat-empty-recents"><MessageCircle size={20} /><div><strong>Space for your next idea</strong><p>Your conversations will find a home here.</p></div></div>}</div></section>
          </div>}
        </div>
      </div>
      {active && showJump && <button type="button" className="chat-jump" onClick={() => bottom(true)} aria-label="Jump to latest message"><ArrowDown size={15} />Latest</button>}
    </div>
    {active && composer}
  </section>;
}

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, CalendarClock, CheckSquare, FileText, Target, X } from "lucide-react";
import { AIMessage, BrainState } from "../types";
import { ChatSource, findRecord, referenceTitle } from "../utils/chatPresentation";
import { MarkdownView } from "./MarkdownView";
import { RecordUiPreview } from "./RecordUiPreview";
import { navigateToRecord } from "../utils/recordNavigation";

export function RecordIcon({ type, className = "h-3.5 w-3.5 shrink-0" }: { type: string; className?: string }) {
  const Icon = type === "task" ? CheckSquare : type === "goal" ? Target : type === "event" ? CalendarClock : FileText;
  return <Icon className={className} aria-hidden="true" />;
}
export function RecordPreview({ source, state, onClose }: { source: ChatSource; state?: BrainState | null; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key === "Tab") {
        const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); if (previous?.isConnected) previous.focus(); };
  }, []);
  const record = findRecord(state, source.type, source.id);
  const title = referenceTitle(source.type, source.id, [source], state);
  const content = record && "content" in record ? record.content || ("summary" in record ? record.summary : "") : record && "description" in record ? record.description || "" : record && source.type === "event" && "notes" in record ? record.notes || "" : record && "summary" in record ? record.summary || "" : "";
  const event = source.type === "event" ? state?.events?.find(e => e.id === source.id) : undefined;

  const handleGoTo = () => {
    onClose();
    navigateToRecord(source.type, source.id, title, state);
  };

  return createPortal(<div className="record-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="record-preview-title" className="record-dialog record-dialog-enhanced">
      <div className="record-dialog-header">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-muted capitalize mb-1">
            <RecordIcon type={source.type} />
            <span>{source.type === "knowledge" ? "Note" : source.type === "deck" ? "Flashcards" : event ? event.kind : source.type}</span>
          </div>
          <h2 id="record-preview-title" className="text-lg font-semibold leading-snug break-words">{title}</h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="record-popup-goto-btn"
            onClick={handleGoTo}
            title="Go directly to this record in the application"
          >
            <span>Go to in application</span>
            <ArrowUpRight size={13} />
          </button>
          <button ref={closeButton} type="button" onClick={onClose} className="chat-icon-button shrink-0" aria-label="Close source"><X size={18} /></button>
        </div>
      </div>
      <div className="record-dialog-body">
        {!record ? <p className="text-sm text-slate-500">This record is no longer available in your workspace.</p> : <>
          <RecordUiPreview
            type={source.type}
            id={source.id}
            title={title}
            state={state}
            onNavigate={handleGoTo}
          />
          {content && (
            <div className="record-content-section mt-4 pt-4 border-t border-[var(--workspace-line)]">
              <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Detailed Notes</h3>
              <MarkdownView className="chat-prose" content={expanded ? content : content.slice(0, 16000)} />
              {content.length > 16000 && !expanded && <button type="button" className="text-sm text-muted mt-3" onClick={() => setExpanded(true)}>Read full note</button>}
            </div>
          )}
          {"milestones" in record && record.milestones.length > 0 && <div className="mt-5"><h3 className="text-sm font-semibold mb-3">Milestones</h3><ul className="space-y-3">{record.milestones.map(m => <li key={m.id} className="text-sm flex gap-2"><span className={m.completed ? "text-[var(--workspace-success)]" : "text-slate-400"}>{m.completed ? "✓" : "○"}</span><span>{m.title}</span></li>)}</ul></div>}
          {"subtasks" in record && !!record.subtasks?.length && <ul className="mt-5 space-y-3">{record.subtasks.map(s => <li key={s.id} className="text-sm flex gap-2"><span>{s.completed ? "✓" : "○"}</span>{s.title}</li>)}</ul>}
        </>}
      </div>
    </div>
  </div>, document.body);
}
export function SourceReferences({ sources, state, onSelect }: { sources?: AIMessage["sources"]; state?: BrainState | null; onSelect?: (source: ChatSource) => void }) {
  const [selected, setSelected] = useState<ChatSource | null>(null);
  if (!sources?.length) return null;
  const unique = sources.filter((source, i) => sources.findIndex(s => s.id === source.id && s.type === source.type) === i);
  return <div className="chat-sources">
    <details><summary>Sources <span>{unique.length}</span></summary><div className="flex flex-wrap gap-2 pt-3">
      {unique.map(source => <button type="button" key={`${source.type}:${source.id}`} className="chat-source-chip" onClick={() => onSelect ? onSelect(source) : setSelected(source)}><RecordIcon type={source.type} /><span className="truncate">{referenceTitle(source.type, source.id, [source], state)}</span><ArrowUpRight size={12} /></button>)}
    </div></details>
    {selected && <RecordPreview source={selected} state={state} onClose={() => setSelected(null)} />}
  </div>;
}

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, CalendarClock, CalendarDays, CheckSquare, Clock, FileText, MapPin, Target, Users, X } from "lucide-react";
import { eventTimeLabel, formatTime } from "../utils/events";
import { AIMessage, BrainState } from "../types";
import { ChatSource, findRecord, formatRecordDate, referenceTitle } from "../utils/chatPresentation";
import { MarkdownView } from "./MarkdownView";

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
  const status = record && "status" in record ? record.status.replace(/_/g, " ") : undefined;
  const event = source.type === "event" ? state?.events?.find(e => e.id === source.id) : undefined;
  const date = record && "dueDate" in record ? record.dueDate : record && "targetDate" in record ? record.targetDate : record && "date" in record ? record.date : undefined;
  return createPortal(<div className="record-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="record-preview-title" className="record-dialog">
      <div className="record-dialog-header">
        <div className="min-w-0"><div className="flex items-center gap-2 text-xs font-medium text-muted capitalize mb-2"><RecordIcon type={source.type} />{source.type === "knowledge" ? "Note" : source.type === "deck" ? "Flashcards" : event ? event.kind : source.type}</div><h2 id="record-preview-title" className="text-lg font-semibold leading-snug break-words">{title}</h2></div>
        <button ref={closeButton} type="button" onClick={onClose} className="chat-icon-button shrink-0" aria-label="Close source"><X size={18} /></button>
      </div>
      <div className="record-dialog-body">
        {!record ? <p className="text-sm text-slate-500">This record is no longer available in your workspace.</p> : <>
          <div className="flex flex-wrap gap-2 mb-5 text-xs">
            {status && <span className="record-meta capitalize">{status}</span>}
            {(date || source.type === "task") && <span className="record-meta"><CalendarDays size={13} />{formatRecordDate(date)}</span>}
            {"dueTime" in record && record.dueTime && <span className="record-meta"><Clock size={13} />Due {formatTime(record.dueTime)}</span>}
            {event && <span className="record-meta"><Clock size={13} />{eventTimeLabel(event)}</span>}
            {event?.location && <span className="record-meta"><MapPin size={13} />{event.location}</span>}
            {event?.attendees?.length ? <span className="record-meta"><Users size={13} />{event.attendees.join(", ")}</span> : null}
            {"priority" in record && <span className="record-meta capitalize">{record.priority} priority</span>}
            {"section" in record && <span className="record-meta">{record.section}{record.subsection ? ` / ${record.subsection}` : ""}</span>}
          </div>
          {"progress" in record && <div className="mb-5"><div className="flex justify-between text-xs text-slate-500 mb-2"><span>Progress</span><span>{record.progress}%</span></div><progress className="w-full h-2 accent-indigo-500" value={record.progress} max={100} /></div>}
          {"why" in record && record.why && <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">{record.why}</p>}
          {"metrics" in record && record.metrics && <p className="text-sm mb-4"><strong>Target:</strong> {record.metrics}</p>}
          {content && <MarkdownView className="chat-prose" content={expanded ? content : content.slice(0, 16000)} />}
          {content.length > 16000 && !expanded && <button type="button" className="text-sm text-muted mt-3" onClick={() => setExpanded(true)}>Read full note</button>}
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

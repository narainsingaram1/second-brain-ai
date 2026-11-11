import { useRef, useState, type CSSProperties } from "react";
import { ExternalLink, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

export function ApplicationActions({ title, url, onEdit, onDelete }: { title: string; url?: string; onEdit: () => void; onDelete: () => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const close = () => { if (menu.current) menu.current.open = false; };
  return <details className="career-row-menu" ref={menu} onToggle={() => {
    if (menu.current?.open) { const rect = menu.current.getBoundingClientRect(); setPosition({ right: Math.max(8, window.innerWidth - rect.right), ...(rect.bottom + 150 < window.innerHeight ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }) }); }
  }} onKeyDown={event => { if (event.key === "Escape") { close(); menu.current?.querySelector("summary")?.focus(); } }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}>
    <summary aria-label={`Actions for ${title}`} title={`Actions for ${title}`}><MoreHorizontal size={17} /></summary>
    <div className="career-row-menu-items" style={position}>
      <button onClick={() => { close(); onEdit(); }}><Pencil size={14} />Edit application</button>
      {url && <a href={url} target="_blank" rel="noopener noreferrer" onClick={close}><ExternalLink size={14} />View job posting</a>}
      <button onClick={() => { close(); onDelete(); }}><Trash2 size={14} />Delete application</button>
    </div>
  </details>;
}

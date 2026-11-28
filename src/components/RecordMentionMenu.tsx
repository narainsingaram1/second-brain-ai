import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  Briefcase,
  CalendarDays,
  CheckSquare,
  Code2,
  FilePlus2,
  FileText,
  Flame,
  GraduationCap,
  Layers,
  ListChecks,
} from "lucide-react";
import type { BrainState } from "../types";
import { searchLinkCandidates, type LinkCandidate, type LinkTargetType } from "../utils/noteLinks";

interface RecordMentionMenuProps {
  open: boolean;
  trigger: "[[" | "@";
  query: string;
  position: { top: number; left: number; caretTop?: number };
  state: BrainState | null | undefined;
  excludeNoteId?: string;
  onSelect: (candidate: LinkCandidate) => void;
  onClose: () => void;
}

const FILTERS: Array<{ id: LinkTargetType | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "knowledge", label: "Notes" },
  { id: "task", label: "Tasks" },
  { id: "course", label: "Courses" },
  { id: "event", label: "Events" },
  { id: "tracker", label: "Career" },
  { id: "journal", label: "Journal" },
];

export function RecordTypeIcon({
  type,
  subkind,
  size = 14,
}: {
  type: LinkTargetType | "memory" | "tag";
  subkind?: "job_application" | "leetcode";
  size?: number;
}) {
  switch (type) {
    case "knowledge":
      return <FileText size={size} />;
    case "task":
      return <CheckSquare size={size} />;
    case "course":
      return <GraduationCap size={size} />;
    case "event":
      return <CalendarDays size={size} />;
    case "tracker":
      return subkind === "leetcode" ? <Code2 size={size} /> : <Briefcase size={size} />;
    case "journal":
      return <BookOpen size={size} />;
    case "habit":
      return <Flame size={size} />;
    case "deck":
      return <Layers size={size} />;
    case "quiz":
      return <ListChecks size={size} />;
    default:
      return <FileText size={size} />;
  }
}

/**
 * Floating autocomplete palette for `[[` wiki-links and `@` record mentions.
 * Shared across Tiptap (`NoteRichText`) and `JournalView`.
 */
export const RecordMentionMenu: React.FC<RecordMentionMenuProps> = ({
  open,
  trigger,
  query,
  position,
  state,
  excludeNoteId,
  onSelect,
  onClose,
}) => {
  const [filterType, setFilterType] = useState<LinkTargetType | "all">("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setFilterType("all");
      setActiveIndex(0);
    }
  }, [open, trigger]);

  const items = useMemo(
    () =>
      open
        ? searchLinkCandidates(state, query, trigger, {
            excludeNoteId,
            filterType,
            limit: 10,
          })
        : [],
    [open, state, query, trigger, excludeNoteId, filterType],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query, filterType]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex(i => (items.length ? (i + 1) % items.length : 0));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex(i => (items.length ? (i - 1 + items.length) % items.length : 0));
      } else if ((event.key === "Enter" || event.key === "Tab") && items.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        onSelect(items[Math.min(activeIndex, items.length - 1)]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, items, activeIndex, onSelect, onClose]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const menuWidth = 376;
  const menuHeight = 326;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const clampedLeft = Math.max(12, Math.min(position.left, vw - menuWidth - 16));
  const fitsBelow = position.top + menuHeight <= vh - 20;
  const rawTop = fitsBelow
    ? position.top
    : position.caretTop !== undefined
      ? position.caretTop - menuHeight - 8
      : vh - menuHeight - 24;
  const clampedTop = Math.max(12, Math.min(rawTop, vh - menuHeight - 16));

  const menu = (
    <div
      ref={menuRef}
      role="listbox"
      aria-label={trigger === "[[" ? "Link a note or record" : "Mention a record"}
      className="nx-mention-menu"
      style={{ top: clampedTop, left: clampedLeft }}
      onMouseDown={e => e.preventDefault()}
    >
      <div className="nx-mention-head">
        <span className="nx-mention-trigger">{trigger === "[[" ? "Link note" : "Mention record"}</span>
        {query && <span className="nx-mention-query">“{query}”</span>}
      </div>

      <div className="nx-mention-filters" role="tablist" aria-label="Filter record types">
        {FILTERS.map(f => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filterType === f.id}
            className={filterType === f.id ? "is-active" : ""}
            onClick={() => setFilterType(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="nx-mention-list">
        {items.length > 0 ? (
          items.map((item, idx) => {
            const active = idx === activeIndex;
            return (
              <button
                key={`${item.type}:${item.id || item.label}:${idx}`}
                type="button"
                role="option"
                aria-selected={active}
                className={`nx-mention-item ${active ? "is-active" : ""}`}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => onSelect(item)}
              >
                <span className={`nx-mention-icon nx-type-${item.type}`}>
                  {item.unresolved ? <FilePlus2 size={14} /> : <RecordTypeIcon type={item.type} subkind={item.subkind} />}
                </span>
                <span className="nx-mention-body">
                  <strong>{item.unresolved ? `Create “${item.label}”` : item.label}</strong>
                  {item.subtitle && <small>{item.subtitle}</small>}
                </span>
                <span className="nx-mention-badge">{item.badge}</span>
              </button>
            );
          })
        ) : (
          <div className="nx-mention-empty">No matching records. Keep typing to create or refine.</div>
        )}
      </div>

      <div className="nx-mention-foot">
        <span>↑↓ navigate</span>
        <span>↵ link</span>
        <span>esc close</span>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(menu, document.body) : menu;
};

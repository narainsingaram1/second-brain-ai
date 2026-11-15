import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Folder, Home, MoreHorizontal } from "lucide-react";
import type { NoteFolder } from "../../types";

export type MenuPage = "main" | "move";
interface MenuApi { close: () => void; page: MenuPage; setPage: (page: MenuPage) => void }

/** A "more" button with a popover that closes on outside click, Escape, or after a choice. */
export function Menu({ label, children, className = "" }: { label: string; children: (api: MenuApi) => React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<MenuPage>("main");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const close = () => { setOpen(false); setPage("main"); };
  return (
    <div ref={ref} className={`nx-menu ${open ? "is-open" : ""} ${className}`} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      <button type="button" className="nx-icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => { setPage("main"); setOpen(v => !v); }}>
        <MoreHorizontal size={16} />
      </button>
      {open && <div className="nx-menu-pop" role="menu">{children({ close, page, setPage })}</div>}
    </div>
  );
}

export function MenuItem({ icon: Icon, children, onSelect, danger, disabled }: {
  icon: React.ComponentType<{ size?: number }>; children: React.ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button type="button" role="menuitem" disabled={disabled} className={`nx-menu-item ${danger ? "is-danger" : ""}`} onClick={onSelect}>
      <Icon size={15} />
      <span>{children}</span>
    </button>
  );
}

export const MenuDivider = () => <div className="nx-menu-divider" role="separator" />;

/** Folder picker used by "Move to…": every reachable folder, indented by depth. */
export function MoveToList({ folders, rootId, rootLabel, currentId, blocked, onBack, onPick }: {
  folders: NoteFolder[]; rootId: string | null; rootLabel: string; currentId: string | null;
  blocked: (folderId: string | null) => boolean; onBack: () => void; onPick: (folderId: string | null) => void;
}) {
  const rows: { folder: NoteFolder; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of folders.filter(x => (x.parentId || null) === parent).sort(byName)) {
      rows.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(rootId, 1);
  const option = (id: string | null, name: string, depth: number, icon: React.ReactNode, color?: string) => {
    const here = id === currentId;
    const disabled = here || blocked(id);
    return (
      <button key={id || "root"} type="button" role="menuitem" className="nx-menu-item nx-move-row" disabled={disabled}
        style={{ paddingLeft: 10 + depth * 14 }} onClick={() => onPick(id)}>
        <span className={`nx-dot-icon ${color ? `nx-c-${color}` : ""}`}>{icon}</span>
        <span className="nx-move-name">{name}</span>
        {here && <Check size={14} className="nx-move-here" />}
      </button>
    );
  };
  return (
    <div className="nx-move">
      <button type="button" className="nx-menu-back" onClick={onBack}><ArrowLeft size={14} /> Move to</button>
      <div className="nx-move-list">
        {option(rootId, rootLabel, 0, <Home size={14} />)}
        {rows.map(r => option(r.folder.id, r.folder.name, r.depth, <Folder size={14} />, r.folder.color))}
      </div>
    </div>
  );
}

export const byName = (a: NoteFolder, b: NoteFolder) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

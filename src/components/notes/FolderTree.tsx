import React, { useEffect, useRef } from "react";
import { Briefcase, ChevronRight, Folder, FolderOpen, GraduationCap, HeartPulse, Plus } from "lucide-react";
import type { NoteFolder, Workspace } from "../../types";
import { byName } from "./Menu";

export interface DropBinding {
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  "data-drop"?: "ok" | "no";
}

interface TreeProps {
  folders: NoteFolder[];
  parentId: string | null;
  /** Only these top-level folders (by ID); undefined means every child of parentId. */
  only?: (folder: NoteFolder) => boolean;
  depth?: number;
  activeId: string | null;
  expanded: Set<string>;
  counts: Map<string, number>;
  workspaces: Workspace[];
  renamingId: string | null;
  onToggle: (id: string, open?: boolean) => void;
  onOpen: (id: string) => void;
  onNewSubfolder: (parentId: string) => void;
  onRenameStart: (id: string) => void;
  onRenameDone: (id: string, name: string | null) => void;
  drop: (targetId: string) => DropBinding;
  drag: (kind: "folder", id: string) => { draggable: boolean; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void };
}

export function WorkspaceGlyph({ workspace, size = 15 }: { workspace?: Workspace; size?: number }) {
  if (!workspace) return <Folder size={size} />;
  if (workspace.template === "career") return <Briefcase size={size} />;
  if (workspace.template === "academic") return <GraduationCap size={size} />;
  if (workspace.template === "health") return <HeartPulse size={size} />;
  return <FolderOpen size={size} />;
}

export function FolderTree(props: TreeProps) {
  const { folders, parentId, only, depth = 0 } = props;
  const children = folders.filter(f => (f.parentId || null) === parentId && (!only || only(f))).sort(byName);
  if (!children.length) return null;
  return (
    <ul className="nx-tree" role={depth ? "group" : "tree"}>
      {children.map(f => <TreeRow key={f.id} folder={f} {...props} depth={depth} />)}
    </ul>
  );
}

function TreeRow({ folder, ...props }: TreeProps & { folder: NoteFolder }) {
  const { folders, depth = 0, activeId, expanded, counts, workspaces, renamingId, onToggle, onOpen, onNewSubfolder, onRenameStart, onRenameDone, drop, drag } = props;
  const hasChildren = folders.some(f => f.parentId === folder.id);
  const open = expanded.has(folder.id);
  const workspace = folder.workspaceId ? workspaces.find(w => w.id === folder.workspaceId) : undefined;
  const binding = drop(folder.id);
  const hoverTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  // Hovering a closed folder while dragging opens it, so you can drop deeper.
  const dropBinding: DropBinding = {
    ...binding,
    onDragOver: e => {
      binding.onDragOver(e);
      if (hasChildren && !open && !hoverTimer.current) hoverTimer.current = window.setTimeout(() => { onToggle(folder.id, true); hoverTimer.current = undefined; }, 650);
    },
    onDragLeave: e => { binding.onDragLeave(e); window.clearTimeout(hoverTimer.current); hoverTimer.current = undefined; },
    onDrop: e => { window.clearTimeout(hoverTimer.current); hoverTimer.current = undefined; binding.onDrop(e); },
  };
  const dragBinding = folder.workspaceId ? {} : drag("folder", folder.id);
  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={activeId === folder.id}>
      <div className={`nx-tree-row ${activeId === folder.id ? "is-active" : ""}`} style={{ paddingLeft: 6 + depth * 14 }}
        {...dropBinding} {...dragBinding}
        tabIndex={0}
        onClick={() => onOpen(folder.id)}
        onKeyDown={e => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter") onOpen(folder.id);
          if (e.key === "ArrowRight" && hasChildren) onToggle(folder.id, true);
          if (e.key === "ArrowLeft" && hasChildren) onToggle(folder.id, false);
          if (e.key === "F2" && !folder.workspaceId) onRenameStart(folder.id);
        }}
        onDoubleClick={() => { if (!folder.workspaceId) onRenameStart(folder.id); }}>
        <button type="button" className={`nx-tree-chevron ${hasChildren ? "" : "is-empty"} ${open ? "is-open" : ""}`}
          aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`} tabIndex={hasChildren ? 0 : -1}
          onClick={e => { e.stopPropagation(); if (hasChildren) onToggle(folder.id); }}>
          <ChevronRight size={13} />
        </button>
        <span className={`nx-tree-icon nx-c-${folder.color || "slate"}`}>
          {workspace ? <WorkspaceGlyph workspace={workspace} size={14} /> : open && hasChildren ? <FolderOpen size={14} /> : <Folder size={14} />}
        </span>
        {renamingId === folder.id
          ? <RenameInput initial={folder.name} onDone={name => onRenameDone(folder.id, name)} />
          : <span className="nx-tree-name" title={folder.name}>{folder.name}</span>}
        <span className="nx-tree-count">{counts.get(folder.id) || ""}</span>
        <button type="button" className="nx-tree-add" aria-label={`New folder in ${folder.name}`}
          onClick={e => { e.stopPropagation(); onNewSubfolder(folder.id); }}>
          <Plus size={13} />
        </button>
      </div>
      {open && hasChildren && <FolderTree {...props} only={undefined} parentId={folder.id} depth={depth + 1} />}
    </li>
  );
}

export function RenameInput({ initial, onDone, className = "nx-rename" }: { initial: string; onDone: (name: string | null) => void; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (name: string | null) => { if (done.current) return; done.current = true; onDone(name); };
  return (
    <input ref={ref} className={className} defaultValue={initial} aria-label="Folder name" maxLength={80}
      onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === "Enter") finish(e.currentTarget.value.trim() || null);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={e => finish(e.currentTarget.value.trim() || null)} />
  );
}

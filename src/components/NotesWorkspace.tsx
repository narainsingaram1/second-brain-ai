import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight, ChevronRight, Clock, Copy, FileText, Folder, FolderInput, FolderPlus, Home, LayoutGrid,
  List as ListIcon, Palette, PanelLeft, Pencil, Pin, PinOff, Plus, Search, Trash2, X,
} from "lucide-react";
import type { KnowledgeItem, NoteFolder, Workspace } from "../types";
import { NoteEditor } from "./NoteEditor";
import { FolderModal } from "./FolderModal";
import { FolderTree, RenameInput, WorkspaceGlyph, type DropBinding } from "./notes/FolderTree";
import { Menu, MenuDivider, MenuItem, MoveToList, byName } from "./notes/Menu";
import { folderMoveBlocked, folderPath, subtreeIds } from "../utils/noteFolders";
import "../notes.css";
import { stripNoteImages } from "../utils/noteImages";

interface NotesWorkspaceProps {
  items: KnowledgeItem[];
  folders: NoteFolder[];
  workspaces?: Workspace[];
  /** Show only this folder and what's inside it (a workspace's Notes tab). */
  rootFolderId?: string;
  /** Folder to open first. */
  initialFolderId?: string | null;
  onOpenWorkspace?: (workspaceId: string) => void;
  onOpenInNotes?: (folderId: string) => void;
  onSaveNote: (note: KnowledgeItem) => void;
  onDeleteNote: (id: string) => void;
  onSaveFolder: (folder: NoteFolder) => void;
  onDeleteFolder: (id: string) => void;
  openRouterKey?: string;
  selectedModel?: string;
  onGenerateTasks?: (tasks: { title: string; priority?: string }[]) => void;
  initialSelectedNote?: KnowledgeItem | null;
  onClearInitialSelectedNote?: () => void;
}

type View = { kind: "folder"; id: string | null } | { kind: "all" } | { kind: "pinned" };
type Sort = "updated" | "created" | "title";
type DragItem = { kind: "note" | "folder"; id: string };
interface Toast { message: string; undo?: () => void }

const ROOT_KEY = "__root__";
const store = {
  get<T>(key: string, fallback: T): T {
    try { const raw = localStorage.getItem(`synapse.notes.${key}`); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
  },
  set(key: string, value: unknown) { try { localStorage.setItem(`synapse.notes.${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ } },
};

const titleOf = (n: KnowledgeItem) => n.title || n.subject || "Untitled";
const plainText = (n: KnowledgeItem) =>
  stripNoteImages(n.content || (n.summary && n.summary !== titleOf(n) ? n.summary : ""))
    .replace(/<\/(p|h\d|li|div|blockquote)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/^\s*(#{1,6}|>|[-*+]\s\[[ x]\]|[-*+]|\d+\.)\s+/gm, "").replace(/(\*\*|__|`{1,3}|~~)/g, "")
    .replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
const wordCount = (text: string) => (text ? text.split(/\s+/).filter(Boolean).length : 0);
function when(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const NotesWorkspace: React.FC<NotesWorkspaceProps> = ({
  items, folders, workspaces = [], rootFolderId, initialFolderId, onOpenWorkspace, onOpenInNotes,
  onSaveNote, onDeleteNote, onSaveFolder, onDeleteFolder, openRouterKey, selectedModel, onGenerateTasks,
  initialSelectedNote, onClearInitialSelectedNote,
}) => {
  const scopeRoot = rootFolderId ?? null;
  const rootFolder = rootFolderId ? folders.find(f => f.id === rootFolderId) : undefined;
  const scoped = !!rootFolderId;
  const prefix = scoped ? "ws." : "";

  const [view, setView] = useState<View>({ kind: "folder", id: initialFolderId ?? scopeRoot });
  const [selectedNote, setSelectedNote] = useState<KnowledgeItem | null>(initialSelectedNote || null);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<"grid" | "list">(() => store.get(`${prefix}layout`, "grid"));
  const [sort, setSort] = useState<Sort>(() => store.get(`${prefix}sort`, "updated"));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(store.get<string[]>("expanded", [])));
  const [sideOpen, setSideOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; where: "tree" | "grid" } | null>(null);
  const renamingId = renaming?.id ?? null;
  const setRenamingId = (id: string | null, where: "tree" | "grid" = "grid") => setRenaming(id ? { id, where } : null);
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [folderModal, setFolderModal] = useState<{ folder: NoteFolder | null; parentId: string | null } | null>(null);
  const itemsRef = useRef(items); itemsRef.current = items;
  const foldersRef = useRef(folders); foldersRef.current = folders;
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => store.set(`${prefix}layout`, layout), [layout, prefix]);
  useEffect(() => store.set(`${prefix}sort`, sort), [sort, prefix]);
  useEffect(() => store.set("expanded", [...expanded]), [expanded]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  useEffect(() => {
    if (!initialSelectedNote) return;
    setSelectedNote(initialSelectedNote);
    if (initialSelectedNote.folderId) setView({ kind: "folder", id: initialSelectedNote.folderId });
  }, [initialSelectedNote]);

  // ---- Scope ------------------------------------------------------------------------------------
  const folderIds = useMemo(() => new Set(folders.map(f => f.id)), [folders]);
  const inScope = useMemo(() => (scoped ? subtreeIds(folders, rootFolderId!) : null), [folders, rootFolderId, scoped]);
  const scopeFolders = useMemo(() => (inScope ? folders.filter(f => inScope.has(f.id)) : folders), [folders, inScope]);
  /** A note's folder, treating a missing folder as "no folder". */
  const folderOfNote = (n: KnowledgeItem) => (n.folderId && folderIds.has(n.folderId) ? n.folderId : null);
  const scopeNotes = useMemo(
    () => (inScope ? items.filter(n => n.folderId && inScope.has(n.folderId)) : items),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, inScope, folderIds],
  );

  // Notes per folder, counting everything inside its subfolders too.
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    const parent = new Map(folders.map(f => [f.id, f.parentId || null]));
    for (const n of items) {
      const seen = new Set<string>();
      for (let p = n.folderId && parent.has(n.folderId) ? n.folderId : null; p && !seen.has(p); p = parent.get(p) || null) {
        seen.add(p);
        map.set(p, (map.get(p) || 0) + 1);
      }
    }
    return map;
  }, [items, folders]);

  const currentId = view.kind === "folder" ? view.id : null;
  const currentFolder = currentId ? folders.find(f => f.id === currentId) : undefined;
  const workspaceOf = (f?: NoteFolder) => (f?.workspaceId ? workspaces.find(w => w.id === f.workspaceId) : undefined);
  const nameOf = (id: string | null) => (id ? folders.find(f => f.id === id)?.name || "folder" : "Notes");

  // If the open folder disappears (deleted elsewhere), fall back to the scope's top.
  useEffect(() => {
    if (view.kind === "folder" && view.id && !folderIds.has(view.id)) setView({ kind: "folder", id: scopeRoot });
  }, [view, folderIds, scopeRoot]);

  // Keep the open folder visible in the tree.
  useEffect(() => {
    if (!currentId) return;
    const ancestors = folderPath(folders, currentId).slice(0, -1).map(f => f.id);
    if (ancestors.some(id => !expanded.has(id))) setExpanded(prev => new Set([...prev, ...ancestors]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const crumbs = useMemo(() => {
    if (!currentId) return [];
    const path = folderPath(folders, currentId);
    return scoped ? path.slice(Math.max(0, path.findIndex(f => f.id === rootFolderId))) : path;
  }, [folders, currentId, scoped, rootFolderId]);

  const subfolders = useMemo(
    () => (view.kind === "folder" && !query ? scopeFolders.filter(f => (f.parentId || null) === currentId && f.id !== rootFolderId).sort(byName) : []),
    [scopeFolders, currentId, view.kind, query, rootFolderId],
  );
  const matchingFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? scopeFolders.filter(f => f.id !== rootFolderId && f.name.toLowerCase().includes(q)).sort(byName) : [];
  }, [scopeFolders, query, rootFolderId]);

  const notes = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list: KnowledgeItem[];
    if (q) list = scopeNotes.filter(n => `${titleOf(n)}\n${plainText(n)}\n${(n.tags || []).join(" ")}`.toLowerCase().includes(q));
    else if (view.kind === "all") list = scopeNotes;
    else if (view.kind === "pinned") list = scopeNotes.filter(n => n.pinned);
    else list = items.filter(n => folderOfNote(n) === currentId);
    const key = (n: KnowledgeItem) => (sort === "created" ? n.createdAt || "" : n.updatedAt || n.createdAt || "");
    return [...list].sort((a, b) => {
      if (view.kind !== "pinned" && !!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      if (sort === "title") return titleOf(a).localeCompare(titleOf(b), undefined, { numeric: true, sensitivity: "base" });
      return key(b).localeCompare(key(a));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, scopeNotes, view, currentId, query, sort, folderIds]);

  const pinnedCount = scopeNotes.filter(n => n.pinned).length;
  const looseCount = scoped ? items.filter(n => n.folderId === rootFolderId).length : items.filter(n => !folderOfNote(n)).length;

  // ---- Actions ----------------------------------------------------------------------------------
  const showToast = (message: string, undo?: () => void) => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  };
  const go = (next: View) => { setView(next); setQuery(""); setSideOpen(false); };
  const toggle = (id: string, open?: boolean) =>
    setExpanded(prev => { const s = new Set(prev); (open ?? !s.has(id)) ? s.add(id) : s.delete(id); return s; });

  const createNote = () => {
    const now = new Date().toISOString();
    const folderId = view.kind === "folder" ? currentId : scopeRoot;
    const note: KnowledgeItem = {
      id: `note-${Date.now()}`, title: "Untitled", subject: "Untitled", content: "", summary: "", folderId,
      status: "Synthesized", startDate: now.slice(0, 10), endDate: now.slice(0, 10), domain: nameOf(folderId),
      createdAt: now, updatedAt: now, tags: [], pinned: false, favorite: false,
    };
    onSaveNote(note);
    setSelectedNote(note);
  };

  const createFolder = (parentId: string | null) => {
    const siblings = new Set(folders.filter(f => (f.parentId || null) === parentId).map(f => f.name.toLowerCase()));
    let name = "New folder";
    for (let i = 2; siblings.has(name.toLowerCase()); i++) name = `New folder ${i}`;
    const now = new Date().toISOString();
    const parent = folders.find(f => f.id === parentId);
    const folder: NoteFolder = { id: `folder-${Date.now()}`, name, parentId, color: parent?.workspaceId ? "slate" : parent?.color || "slate", createdAt: now, updatedAt: now };
    onSaveFolder(folder);
    if (parentId) toggle(parentId, true);
    setView({ kind: "folder", id: parentId });
    setQuery("");
    setRenamingId(folder.id);
  };

  const renameFolder = (id: string, name: string | null) => {
    setRenamingId(null);
    const f = foldersRef.current.find(x => x.id === id);
    if (f && name && name !== f.name && !f.workspaceId) onSaveFolder({ ...f, name, updatedAt: new Date().toISOString() });
  };

  const deleteFolder = (f: NoteFolder) => {
    const n = counts.get(f.id) || 0;
    const subs = folders.filter(x => x.parentId === f.id).length;
    const inside = [n && plural(n, "note"), subs && plural(subs, "subfolder")].filter(Boolean).join(" and ");
    if (!confirm(`Delete “${f.name}”?${inside ? ` Its ${inside} move up to ${nameOf(f.parentId || null)}.` : ""}`)) return;
    if (currentId === f.id) setView({ kind: "folder", id: f.parentId || scopeRoot });
    onDeleteFolder(f.id);
  };

  const deleteNote = (n: KnowledgeItem) => {
    if (confirm(`Delete “${titleOf(n)}”? This can't be undone.`)) onDeleteNote(n.id);
  };

  const duplicateNote = (n: KnowledgeItem) => {
    const now = new Date().toISOString();
    onSaveNote({ ...n, id: `note-${Date.now()}`, title: `${titleOf(n)} copy`, subject: `${titleOf(n)} copy`, createdAt: now, updatedAt: now, pinned: false });
    showToast(`Duplicated “${titleOf(n)}”`);
  };

  const togglePin = (n: KnowledgeItem) => onSaveNote({ ...n, pinned: !n.pinned, updatedAt: new Date().toISOString() });

  // ---- Moving (drag and drop, or "Move to…") -----------------------------------------------------
  const canMove = (item: DragItem, target: string | null) => {
    if (item.kind === "note") {
      const n = items.find(x => x.id === item.id);
      return !!n && folderOfNote(n) !== target;
    }
    const f = folders.find(x => x.id === item.id);
    return !!f && item.id !== target && (f.parentId || null) !== target && !folderMoveBlocked(folders, item.id, target);
  };

  const move = (item: DragItem, target: string | null) => {
    if (!canMove(item, target)) return;
    const where = target === null ? "Notes" : nameOf(target);
    if (item.kind === "note") {
      const n = items.find(x => x.id === item.id)!;
      const from = n.folderId || null;
      onSaveNote({ ...n, folderId: target });
      showToast(`Moved “${titleOf(n)}” to ${where}`, () => {
        const latest = itemsRef.current.find(x => x.id === n.id);
        if (latest) onSaveNote({ ...latest, folderId: from });
      });
    } else {
      const f = folders.find(x => x.id === item.id)!;
      const from = f.parentId || null;
      onSaveFolder({ ...f, parentId: target, updatedAt: new Date().toISOString() });
      if (target) toggle(target, true);
      showToast(`Moved “${f.name}” to ${where}`, () => {
        const latest = foldersRef.current.find(x => x.id === f.id);
        if (latest && !folderMoveBlocked(foldersRef.current, f.id, from)) onSaveFolder({ ...latest, parentId: from, updatedAt: new Date().toISOString() });
      });
    }
  };

  const targetOf = (key: string) => (key === ROOT_KEY ? scopeRoot : key);
  const drop = (key: string): DropBinding => ({
    onDragOver: e => {
      if (!drag) return;
      if (canMove(drag, targetOf(key))) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }
      if (over !== key) setOver(key);
    },
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(o => (o === key ? null : o)); },
    onDrop: e => {
      e.preventDefault();
      e.stopPropagation();
      const item = drag;
      setOver(null);
      setDrag(null);
      if (item) move(item, targetOf(key));
    },
    "data-drop": drag && over === key ? (canMove(drag, targetOf(key)) ? "ok" : "no") : undefined,
  });
  const dragSource = (kind: DragItem["kind"], id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = "move";
      const label = kind === "note" ? titleOf(items.find(n => n.id === id)!) : folders.find(f => f.id === id)?.name || "";
      e.dataTransfer.setData("text/plain", label);
      // Changing the page during dragstart can cancel the drag in some browsers, so mark it a tick later.
      window.setTimeout(() => setDrag({ kind, id }), 0);
    },
    onDragEnd: () => { setDrag(null); setOver(null); },
  });

  const moveMenu = (item: DragItem, current: string | null, close: () => void, back: () => void) => (
    <MoveToList folders={scopeFolders} rootId={scopeRoot} rootLabel={scoped ? rootFolder?.name || "Workspace" : "Notes (no folder)"}
      currentId={current} blocked={target => !canMove(item, target)} onBack={back}
      onPick={target => { close(); move(item, target); }} />
  );

  // ---- Open note -----------------------------------------------------------------------------------
  if (selectedNote) {
    return (
      <div className="note-page">
        <NoteEditor
          key={selectedNote.id}
          note={selectedNote}
          folders={scopeFolders}
          onSave={updated => { onSaveNote(updated); setSelectedNote(updated); }}
          onDelete={id => { onDeleteNote(id); setSelectedNote(null); onClearInitialSelectedNote?.(); }}
          onBack={() => { setSelectedNote(null); onClearInitialSelectedNote?.(); }}
          openRouterKey={openRouterKey}
          selectedModel={selectedModel}
          onGenerateTasks={onGenerateTasks}
        />
      </div>
    );
  }

  // ---- Pieces ------------------------------------------------------------------------------------
  const folderMenu = (f: NoteFolder) => (
    <Menu label={`Options for ${f.name}`}>
      {({ close, page, setPage }) => page === "move" ? moveMenu({ kind: "folder", id: f.id }, f.parentId || null, close, () => setPage("main")) : (
        <>
          {f.workspaceId && onOpenWorkspace && !scoped && <MenuItem icon={ArrowUpRight} onSelect={() => { close(); onOpenWorkspace(f.workspaceId!); }}>Open workspace</MenuItem>}
          <MenuItem icon={FolderPlus} onSelect={() => { close(); createFolder(f.id); }}>New folder inside</MenuItem>
          {!f.workspaceId && <>
            <MenuItem icon={Pencil} onSelect={() => { close(); setRenamingId(f.id); }}>Rename</MenuItem>
            <MenuItem icon={Palette} onSelect={() => { close(); setFolderModal({ folder: f, parentId: f.parentId || null }); }}>Color & location</MenuItem>
            <MenuItem icon={FolderInput} onSelect={() => setPage("move")}>Move to…</MenuItem>
            <MenuDivider />
            <MenuItem icon={Trash2} danger onSelect={() => { close(); deleteFolder(f); }}>Delete folder</MenuItem>
          </>}
        </>
      )}
    </Menu>
  );

  const noteMenu = (n: KnowledgeItem) => (
    <Menu label={`Options for ${titleOf(n)}`}>
      {({ close, page, setPage }) => page === "move" ? moveMenu({ kind: "note", id: n.id }, folderOfNote(n), close, () => setPage("main")) : (
        <>
          <MenuItem icon={n.pinned ? PinOff : Pin} onSelect={() => { close(); togglePin(n); }}>{n.pinned ? "Unpin" : "Pin to top"}</MenuItem>
          <MenuItem icon={FolderInput} onSelect={() => setPage("move")}>Move to…</MenuItem>
          <MenuItem icon={Copy} onSelect={() => { close(); duplicateNote(n); }}>Duplicate</MenuItem>
          <MenuDivider />
          <MenuItem icon={Trash2} danger onSelect={() => { close(); deleteNote(n); }}>Delete note</MenuItem>
        </>
      )}
    </Menu>
  );

  const folderChip = (n: KnowledgeItem) => {
    const id = folderOfNote(n);
    if (!id || id === rootFolderId) return null;
    const f = folders.find(x => x.id === id)!;
    return <span className="nx-chip"><span className={`nx-dot nx-c-${f.color || "slate"}`} />{f.name}</span>;
  };
  const showLocation = view.kind !== "folder" || !!query;

  const folderTile = (f: NoteFolder) => {
    const ws = workspaceOf(f);
    const subs = folders.filter(x => x.parentId === f.id).length;
    const n = counts.get(f.id) || 0;
    return (
      <div key={f.id} className={`nx-folder ${drag?.id === f.id ? "is-dragging" : ""}`} role="button" tabIndex={0}
        {...drop(f.id)} {...(f.workspaceId ? {} : dragSource("folder", f.id))}
        onClick={() => renamingId !== f.id && go({ kind: "folder", id: f.id })}
        onKeyDown={e => { if (e.key === "Enter" && renamingId !== f.id) go({ kind: "folder", id: f.id }); }}>
        <span className={`nx-folder-icon nx-c-${f.color || "slate"}`}>{ws ? <WorkspaceGlyph workspace={ws} size={18} /> : <Folder size={18} />}</span>
        <div className="nx-folder-text">
          {renaming?.id === f.id && renaming.where === "grid"
            ? <RenameInput initial={f.name} onDone={name => renameFolder(f.id, name)} className="nx-rename nx-rename-tile" />
            : <strong title={f.name}>{f.name}</strong>}
          <span>{[plural(n, "note"), subs ? plural(subs, "folder") : ""].filter(Boolean).join(" · ")}</span>
        </div>
        {folderMenu(f)}
      </div>
    );
  };

  const noteCard = (n: KnowledgeItem) => {
    const text = plainText(n);
    return (
      <article key={n.id} className={`nx-card ${drag?.id === n.id ? "is-dragging" : ""}`} tabIndex={0} {...dragSource("note", n.id)}
        onClick={() => setSelectedNote(n)} onKeyDown={e => { if (e.key === "Enter") setSelectedNote(n); }}>
        <div className="nx-card-top">
          <h3>{titleOf(n)}</h3>
          {n.pinned && <Pin size={13} className="nx-pin" aria-label="Pinned" />}
          {noteMenu(n)}
        </div>
        <p className={text ? "" : "is-empty"}>{text || "Empty note"}</p>
        <footer>
          {showLocation && folderChip(n)}
          {(n.tags || []).slice(0, 2).map(t => <span key={t} className="nx-tag">#{t}</span>)}
          <time>{when(n.updatedAt || n.createdAt)}</time>
        </footer>
      </article>
    );
  };

  const noteRow = (n: KnowledgeItem) => {
    const text = plainText(n);
    return (
      <div key={n.id} className={`nx-row ${drag?.id === n.id ? "is-dragging" : ""}`} role="button" tabIndex={0} {...dragSource("note", n.id)}
        onClick={() => setSelectedNote(n)} onKeyDown={e => { if (e.key === "Enter") setSelectedNote(n); }}>
        <FileText size={16} className="nx-row-icon" />
        <div className="nx-row-main">
          <strong>{titleOf(n)}{n.pinned && <Pin size={12} className="nx-pin" aria-label="Pinned" />}</strong>
          <span>{text.split("\n")[0] || "Empty note"}</span>
        </div>
        <div className="nx-row-meta">
          {showLocation && folderChip(n)}
          <span className="nx-row-words">{plural(wordCount(text), "word")}</span>
          <time>{when(n.updatedAt || n.createdAt)}</time>
        </div>
        {noteMenu(n)}
      </div>
    );
  };

  const treeProps = {
    folders: scopeFolders, activeId: currentId, expanded, counts, workspaces, renamingId: renaming?.where === "tree" ? renaming.id : null,
    onToggle: toggle, onOpen: (id: string) => go({ kind: "folder", id }), onNewSubfolder: createFolder,
    onRenameStart: (id: string) => setRenamingId(id, "tree"), onRenameDone: renameFolder, drop, drag: dragSource,
  };
  const workspaceFolders = scoped ? [] : folders.filter(f => f.workspaceId && !f.parentId);

  // ---- Heading text ------------------------------------------------------------------------------
  const currentWs = workspaceOf(currentFolder);
  const atScopeRoot = view.kind === "folder" && currentId === scopeRoot;
  const title = query ? "Search" : view.kind === "all" ? "All notes" : view.kind === "pinned" ? "Pinned" : scoped && atScopeRoot ? "Notes" : currentFolder?.name || "Notes";
  const subtitle = query
    ? `${plural(notes.length, "note")}${matchingFolders.length ? ` and ${plural(matchingFolders.length, "folder")}` : ""} match “${query.trim()}”`
    : view.kind === "folder"
      ? [subfolders.length ? plural(subfolders.length, "folder") : "", plural(notes.length, "note")].filter(Boolean).join(" · ")
      : plural(notes.length, "note");

  const empty = !notes.length && !subfolders.length && !matchingFolders.length;

  return (
    <div className={`nx ${scoped ? "nx-scoped" : ""} ${drag ? "is-dragging" : ""}`}>
      <aside className={`nx-side ${sideOpen ? "is-open" : ""}`} aria-label="Folders">
        <label className="nx-search">
          <Search size={15} />
          <input type="search" placeholder={scoped ? "Search these notes" : "Search notes"} value={query} onChange={e => setQuery(e.target.value)} />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}
        </label>

        <nav className="nx-nav">
          <button type="button" className={`nx-nav-row ${atScopeRoot && !query ? "is-active" : ""}`} {...drop(ROOT_KEY)} onClick={() => go({ kind: "folder", id: scopeRoot })}>
            <Home size={15} /><span>{scoped ? rootFolder?.name || "Notes" : "Notes"}</span><em>{looseCount || ""}</em>
          </button>
          <button type="button" className={`nx-nav-row ${view.kind === "all" && !query ? "is-active" : ""}`} onClick={() => go({ kind: "all" })}>
            <Clock size={15} /><span>All notes</span><em>{scopeNotes.length || ""}</em>
          </button>
          <button type="button" className={`nx-nav-row ${view.kind === "pinned" && !query ? "is-active" : ""}`} onClick={() => go({ kind: "pinned" })}>
            <Pin size={15} /><span>Pinned</span><em>{pinnedCount || ""}</em>
          </button>
        </nav>

        {workspaceFolders.length > 0 && (
          <section className="nx-side-group">
            <h2>Workspaces</h2>
            <FolderTree {...treeProps} parentId={null} only={f => !!f.workspaceId} />
          </section>
        )}
        <section className="nx-side-group">
          <h2>
            Folders
            <button type="button" className="nx-icon-btn" aria-label="New folder" onClick={() => createFolder(scopeRoot)}><Plus size={14} /></button>
          </h2>
          {scopeFolders.some(f => (f.parentId || null) === scopeRoot && !f.workspaceId)
            ? <FolderTree {...treeProps} parentId={scopeRoot} only={f => !f.workspaceId} />
            : <p className="nx-side-empty">No folders yet</p>}
        </section>
        {scoped && rootFolderId && onOpenInNotes && (
          <button type="button" className="nx-side-link" onClick={() => onOpenInNotes(currentId || rootFolderId)}>
            Open in Notes <ArrowUpRight size={14} />
          </button>
        )}
      </aside>

      <main className="nx-main">
        <header className="nx-head">
          <div className="nx-head-text">
            {crumbs.length > (scoped ? 1 : 0) && !query && view.kind === "folder" && (
              <nav className="nx-crumbs" aria-label="Folder path">
                {!scoped && <><button type="button" {...drop(ROOT_KEY)} onClick={() => go({ kind: "folder", id: null })}>Notes</button><ChevronRight size={13} /></>}
                {crumbs.slice(0, -1).map((f, i) => (
                  <React.Fragment key={f.id}>
                    <button type="button" {...drop(scoped && i === 0 ? ROOT_KEY : f.id)} onClick={() => go({ kind: "folder", id: f.id })}>{scoped && i === 0 ? "Notes" : f.name}</button>
                    <ChevronRight size={13} />
                  </React.Fragment>
                ))}
              </nav>
            )}
            <h1>
              {view.kind === "folder" && currentFolder && !atScopeRoot && <span className={`nx-title-dot nx-c-${currentFolder.color || "slate"}`} />}
              {title}
            </h1>
            <p>
              {subtitle}
              {currentWs && !scoped && onOpenWorkspace && !query && view.kind === "folder" && (
                <button type="button" className="nx-inline-link" onClick={() => onOpenWorkspace(currentWs.id)}>
                  Open {currentWs.name} workspace <ArrowUpRight size={13} />
                </button>
              )}
            </p>
          </div>
          <div className="nx-head-actions">
            <button type="button" className="nx-btn nx-side-toggle" aria-expanded={sideOpen} onClick={() => setSideOpen(v => !v)}>
              <PanelLeft size={15} /> Folders
            </button>
            {view.kind === "folder" && !query && (
              <button type="button" className="nx-btn" onClick={() => createFolder(currentId)}><FolderPlus size={15} /> New folder</button>
            )}
            <button type="button" className="nx-btn nx-btn-primary" onClick={createNote}><Plus size={15} /> New note</button>
          </div>
        </header>

        <div className="nx-toolbar">
          <span className="nx-hint">{drag ? "Drop on a folder to move it there" : "Drag notes and folders onto a folder to move them"}</span>
          <label className="nx-sort">
            <span className="sr-only">Sort notes</span>
            <select value={sort} onChange={e => setSort(e.target.value as Sort)}>
              <option value="updated">Last edited</option>
              <option value="created">Date created</option>
              <option value="title">Title</option>
            </select>
          </label>
          <div className="nx-seg" role="group" aria-label="Layout">
            <button type="button" aria-pressed={layout === "grid"} aria-label="Cards" onClick={() => setLayout("grid")}><LayoutGrid size={15} /></button>
            <button type="button" aria-pressed={layout === "list"} aria-label="List" onClick={() => setLayout("list")}><ListIcon size={15} /></button>
          </div>
        </div>

        {!query && view.kind === "folder" && currentId === null && !scoped && subfolders.some(f => f.workspaceId) && (
          <section className="nx-section">
            <h2>Workspaces</h2>
            <div className="nx-folders">{subfolders.filter(f => f.workspaceId).map(folderTile)}</div>
          </section>
        )}
        {(query ? matchingFolders : subfolders.filter(f => !f.workspaceId)).length > 0 && (
          <section className="nx-section">
            <h2>Folders</h2>
            <div className="nx-folders">{(query ? matchingFolders : subfolders.filter(f => !f.workspaceId)).map(folderTile)}</div>
          </section>
        )}

        {notes.length > 0 && (
          <section className="nx-section">
            {(subfolders.length > 0 || matchingFolders.length > 0) && <h2>Notes</h2>}
            {layout === "grid"
              ? <div className="nx-cards">{notes.map(noteCard)}</div>
              : <div className="nx-rows">{notes.map(noteRow)}</div>}
          </section>
        )}

        {empty && (
          <div className="nx-empty" {...(view.kind === "folder" && !query ? drop(currentId === scopeRoot ? ROOT_KEY : currentId!) : {})}>
            <span className="nx-empty-icon">{query ? <Search size={20} /> : view.kind === "pinned" ? <Pin size={20} /> : <FileText size={20} />}</span>
            <h3>{query ? "Nothing matches" : view.kind === "pinned" ? "No pinned notes" : view.kind === "all" ? "No notes yet" : "This folder is empty"}</h3>
            <p>{query ? "Try a different word, or check the spelling." : view.kind === "pinned" ? "Pin a note from its menu to keep it here." : "Write a note here, or drop notes onto this folder in the sidebar."}</p>
            {!query && view.kind !== "pinned" && (
              <div className="nx-empty-actions">
                <button type="button" className="nx-btn nx-btn-primary" onClick={createNote}><Plus size={15} /> New note</button>
                {view.kind === "folder" && <button type="button" className="nx-btn" onClick={() => createFolder(currentId)}><FolderPlus size={15} /> New folder</button>}
              </div>
            )}
          </div>
        )}
      </main>

      {toast && (
        <div className="nx-toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && <button type="button" onClick={() => { toast.undo!(); setToast(null); }}>Undo</button>}
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      )}

      <FolderModal
        isOpen={!!folderModal}
        onClose={() => setFolderModal(null)}
        folder={folderModal?.folder || null}
        folders={scopeFolders}
        rootId={scopeRoot}
        rootLabel={scoped ? rootFolder?.name || "Workspace" : "Top level"}
        defaultParentId={folderModal?.parentId ?? scopeRoot}
        onSave={onSaveFolder}
        onDelete={id => { const f = folders.find(x => x.id === id); if (f) deleteFolder(f); }}
      />
    </div>
  );
};

import React, { useState, useMemo } from "react";
import { KnowledgeItem, NoteFolder, NoteFolderColor } from "../types";
import { NoteEditor } from "./NoteEditor";
import { FolderModal } from "./FolderModal";
import {
  Folder,
  FolderPlus,
  Plus,
  Search,
  ChevronRight,
  ArrowLeft,
  Grid,
  List as ListIcon,
  Pin,
  MoreHorizontal,
  FileText,
  Trash2,
  Copy,
  Edit2,
  FolderOpen,
} from "lucide-react";

interface NotesWorkspaceProps {
  items: KnowledgeItem[];
  folders: NoteFolder[];
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

export const NotesWorkspace: React.FC<NotesWorkspaceProps> = ({
  items,
  folders,
  onSaveNote,
  onDeleteNote,
  onSaveFolder,
  onDeleteFolder,
  openRouterKey,
  selectedModel,
  onGenerateTasks,
  initialSelectedNote,
  onClearInitialSelectedNote,
}) => {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<KnowledgeItem | null>(initialSelectedNote || null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Folder modal state
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<NoteFolder | null>(null);
  const [folderModalParentId, setFolderModalParentId] = useState<string | null>(null);

  // Active note menu dropdown state
  const [openNoteMenuId, setOpenNoteMenuId] = useState<string | null>(null);
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);

  // Sync initialSelectedNote prop if passed
  React.useEffect(() => {
    if (initialSelectedNote) {
      setSelectedNote(initialSelectedNote);
      if (initialSelectedNote.folderId) {
        setCurrentFolderId(initialSelectedNote.folderId);
      }
    }
  }, [initialSelectedNote]);

  // Folder styling helper
  const getFolderColorClass = (color?: NoteFolderColor) => {
    switch (color) {
      case "amber":
        return "bg-raised0/10 text-muted dark:text-slate-400 border-line";
      case "emerald":
        return "bg-raised0/10 text-[var(--workspace-success)] border-line";
      case "purple":
        return "bg-raised0/10 text-muted dark:text-slate-400 border-line";
      case "rose":
        return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
      case "cyan":
        return "bg-raised0/10 text-muted dark:text-slate-400 border-line";
      case "indigo":
        return "bg-raised0/10 text-muted dark:text-slate-400 border-line";
      case "slate":
        return "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20";
      default:
        return "bg-raised0/10 text-muted dark:text-slate-400 border-line";
    }
  };

  // Compute breadcrumb trail for navigation
  const breadcrumbs = useMemo(() => {
    const trail: { id: string | null; name: string }[] = [{ id: null, name: "Notes" }];
    let curr = folders.find((f) => f.id === currentFolderId);
    const parentList: { id: string; name: string }[] = [];
    while (curr) {
      parentList.unshift({ id: curr.id, name: curr.name });
      curr = folders.find((f) => f.id === curr?.parentId);
    }
    return [...trail, ...parentList];
  }, [currentFolderId, folders]);

  // Current folder object
  const currentFolder = folders.find((f) => f.id === currentFolderId);

  // Filter subfolders of current folder
  const currentSubfolders = useMemo(() => {
    return folders.filter((f) => f.parentId === currentFolderId);
  }, [folders, currentFolderId]);

  // Filter notes in current folder (or search across all notes)
  const currentNotes = useMemo(() => {
    let filtered = items;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (n) =>
          (n.title || n.subject || "").toLowerCase().includes(q) ||
          (n.content || "").toLowerCase().includes(q) ||
          (n.summary || "").toLowerCase().includes(q) ||
          (n.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    } else {
      filtered = filtered.filter((n) => (n.folderId || null) === currentFolderId);
    }

    // Sort: pinned first, then newest updated
    return [...filtered].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      const dateA = a.updatedAt || a.createdAt || "";
      const dateB = b.updatedAt || b.createdAt || "";
      return dateB.localeCompare(dateA);
    });
  }, [items, currentFolderId, searchQuery]);

  // Create new note directly in current folder
  const handleCreateNewNote = () => {
    const today = new Date().toISOString().split("T")[0];
    const newNote: KnowledgeItem = {
      id: `note-${Date.now()}`,
      title: "Untitled Note",
      subject: "Untitled Note",
      content: "",
      summary: "",
      folderId: currentFolderId,
      status: "Synthesized",
      startDate: today,
      endDate: today,
      domain: currentFolder ? currentFolder.name : "General",
      coverGradient: "bg-blue-600",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: [],
      pinned: false,
      favorite: false,
    };

    onSaveNote(newNote);
    setSelectedNote(newNote);
  };

  // Duplicate a note
  const handleDuplicateNote = (noteToDup: KnowledgeItem) => {
    const dup: KnowledgeItem = {
      ...noteToDup,
      id: `note-${Date.now()}`,
      title: `${noteToDup.title || noteToDup.subject} (Copy)`,
      subject: `${noteToDup.title || noteToDup.subject} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pinned: false,
    };
    onSaveNote(dup);
    setOpenNoteMenuId(null);
  };

  // Toggle Pin on a note
  const handleTogglePin = (noteToPin: KnowledgeItem) => {
    const updated: KnowledgeItem = {
      ...noteToPin,
      pinned: !noteToPin.pinned,
      updatedAt: new Date().toISOString(),
    };
    onSaveNote(updated);
  };

  // If a note is selected, render the rich NoteEditor!
  if (selectedNote) {
    return (
      <div className="note-page">
        <NoteEditor
          key={selectedNote.id}
          note={selectedNote}
          folders={folders}
          onSave={(updated) => {
            onSaveNote(updated);
            setSelectedNote(updated);
          }}
          onDelete={(id) => {
            onDeleteNote(id);
            setSelectedNote(null);
            if (onClearInitialSelectedNote) onClearInitialSelectedNote();
          }}
          onBack={() => {
            setSelectedNote(null);
            if (onClearInitialSelectedNote) onClearInitialSelectedNote();
          }}
          openRouterKey={openRouterKey}
          selectedModel={selectedModel}
          onGenerateTasks={onGenerateTasks}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto space-y-8 animate-fade-in pb-16">
      {/* Top Header & Breadcrumbs */}
      <div className="page-heading">
        <div>
          {/* Breadcrumb Navigation */}
          {breadcrumbs.length > 1 && <div className="flex items-center gap-1.5 flex-wrap text-[13px] text-slate-400 mb-2">
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <React.Fragment key={crumb.id || "root"}>
                  <button
                    onClick={() => {
                      setCurrentFolderId(crumb.id);
                      setSearchQuery("");
                    }}
                    className={`hover:text-ink dark:hover:text-white transition-colors flex items-center gap-1 ${
                      isLast
                        ? "text-ink font-extrabold"
                        : "text-slate-400 dark:text-slate-500"
                    }`}
                  >
                    {idx === 0 && <FolderOpen className="w-3.5 h-3.5 text-muted inline mr-0.5" />}
                    <span>{crumb.name}</span>
                  </button>
                  {!isLast && <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600" />}
                </React.Fragment>
              );
            })}
          </div>}

          <h1 className="page-title flex items-center gap-2">
            <span>{currentFolder ? currentFolder.name : "Notes"}</span>
          </h1>
          <p className="text-sm text-secondary mt-2">
            {currentNotes.length} notes {currentSubfolders.length > 0 ? `· ${currentSubfolders.length} folders` : ""}
          </p>
        </div>

        {/* Right Search, View Toggle, New Folder, New Note */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search Bar */}
          <div className="flex items-center bg-raised rounded-full px-3 py-1.5 text-xs text-slate-500 border border-slate-200/50 dark:border-slate-700/50">
            <Search className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search notes"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent focus:outline-none text-ink w-28 sm:w-36 text-xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-1 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Grid vs List View */}
          <div className="flex items-center bg-raised p-0.5 rounded-full border border-slate-200/50 dark:border-slate-700/50">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-full transition-colors ${
                viewMode === "grid"
                  ? "bg-white dark:bg-slate-700 text-ink shadow-xs"
                  : "text-slate-400 hover:text-slate-700"
              }`}
              title="Grid View"
            >
              <Grid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-full transition-colors ${
                viewMode === "list"
                  ? "bg-white dark:bg-slate-700 text-ink shadow-xs"
                  : "text-slate-400 hover:text-slate-700"
              }`}
              title="List View"
            >
              <ListIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* New Folder Button */}
          <button
            onClick={() => {
              setEditingFolder(null);
              setFolderModalParentId(currentFolderId);
              setIsFolderModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all border border-slate-200 dark:border-slate-700"
            title="New folder"
          >
            <FolderPlus className="w-3.5 h-3.5 text-muted" />
            <span className="hidden sm:inline">New folder</span>
          </button>

          {/* New Note Button */}
          <button
            onClick={handleCreateNewNote}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary hover:opacity-90 text-white text-xs font-bold shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New note</span>
          </button>
        </div>
      </div>

      {/* Up Level Button (if inside a subfolder) */}
      {currentFolder && (
        <div className="flex items-center justify-between pb-1">
          <button
            onClick={() => setCurrentFolderId(currentFolder.parentId)}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-ink dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Up one level</span>
          </button>

          {/* Quick Folder Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setEditingFolder(currentFolder);
                setFolderModalParentId(currentFolder.parentId);
                setIsFolderModalOpen(true);
              }}
              className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Edit2 className="w-3 h-3" />
              <span>Rename folder</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* SECTION 1: SUBFOLDERS ("put multiple folders in each")    */}
      {/* ========================================================= */}
      {!searchQuery && currentSubfolders.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
              Folders
            </h3>
            <span className="text-[11px] font-mono text-slate-400">
              {currentSubfolders.length}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {currentSubfolders.map((folder) => {
              const notesCount = items.filter((n) => n.folderId === folder.id).length;
              const subCount = folders.filter((f) => f.parentId === folder.id).length;
              const colorCls = getFolderColorClass(folder.color);

              return (
                <div
                  key={folder.id}
                  onClick={() => setCurrentFolderId(folder.id)}
                  className="group relative flex items-center justify-between p-3.5 rounded-2xl bg-panel border border-line shadow-xs hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-transform ${colorCls}`}
                    >
                      <Folder className="w-4 h-4 fill-current/20" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-ink truncate">
                        {folder.name}
                      </h4>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {notesCount} {notesCount === 1 ? "note" : "notes"}
                        {subCount > 0 ? ` · ${subCount} folders` : ""}
                      </p>
                    </div>
                  </div>

                  {/* Folder Options Menu */}
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenFolderMenuId(openFolderMenuId === folder.id ? null : folder.id);
                      }}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>

                    {openFolderMenuId === folder.id && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 mt-1 w-44 bg-panel rounded-2xl border border-line shadow-xl p-1 z-30 flex flex-col gap-0.5 text-xs font-semibold animate-fade-in"
                      >
                        <button
                          onClick={() => {
                            setOpenFolderMenuId(null);
                            setEditingFolder(folder);
                            setFolderModalParentId(folder.parentId);
                            setIsFolderModalOpen(true);
                          }}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-left"
                        >
                          <Edit2 className="w-3 h-3 text-slate-400" />
                          <span>Rename / color</span>
                        </button>

                        <button
                          onClick={() => {
                            setOpenFolderMenuId(null);
                            setEditingFolder(null);
                            setFolderModalParentId(folder.id);
                            setIsFolderModalOpen(true);
                          }}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-left"
                        >
                          <FolderPlus className="w-3 h-3 text-muted" />
                          <span>New subfolder</span>
                        </button>

                        <button
                          onClick={() => {
                            setOpenFolderMenuId(null);
                            if (confirm(`Delete folder "${folder.name}"? Notes inside will be moved to root.`)) {
                              onDeleteFolder(folder.id);
                            }
                          }}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-500 text-left"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Delete folder</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* SECTION 2: NOTES LIST OR GRID                            */}
      {/* ========================================================= */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
            {searchQuery ? `Search Results for "${searchQuery}"` : "Notes"}
          </h3>
          <span className="text-[11px] font-mono text-slate-400">
            {currentNotes.length}
          </span>
        </div>

        {/* Empty State */}
        {currentNotes.length === 0 && currentSubfolders.length === 0 && (
          <div className="p-12 text-center rounded-3xl border border-dashed border-line bg-slate-50/50 dark:bg-slate-900/20 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-raised text-muted mx-auto flex items-center justify-center">
              <FileText className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-ink">
              {searchQuery ? "No notes found matching your search" : "This folder is empty"}
            </h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {searchQuery
                ? "Try searching for a different keyword or create a new note."
                : "Create a note to start writing ideas, code, or study guides in this folder."}
            </p>
            <div className="pt-2 flex items-center justify-center gap-2">
              <button
                onClick={handleCreateNewNote}
                className="px-4 py-2 rounded-full bg-blue-600 hover:bg-slate-1000 text-white text-xs font-bold shadow-md transition-all"
              >
                + Create Note
              </button>
              <button
                onClick={() => {
                  setEditingFolder(null);
                  setFolderModalParentId(currentFolderId);
                  setIsFolderModalOpen(true);
                }}
                className="px-4 py-2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-bold transition-all"
              >
                + Create Subfolder
              </button>
            </div>
          </div>
        )}

        {/* GRID VIEW: Sleek Note Cards */}
        {viewMode === "grid" && currentNotes.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
            {currentNotes.map((note) => {
              const noteTitle = note.title || note.subject || "Untitled Note";
              const noteText = note.content ?? note.summary ?? "No content yet...";
              const noteFolderObj = folders.find((f) => f.id === note.folderId);
              const previewLines = noteText.replace(/^[#\-*>\s`]+/gm, "").slice(0, 140);
              const isPinned = Boolean(note.pinned);

              return (
                <div
                  key={note.id}
                  onClick={() => setSelectedNote(note)}
                  className="group relative flex flex-col justify-between p-5 rounded-3xl bg-panel border border-line shadow-xs hover:shadow-lg hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer transition-all min-h-[170px]"
                >
                  <div className="space-y-2.5">
                    {/* Top Row: Folder Badge & Pin / Menu */}
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500 bg-raised px-2.5 py-0.5 rounded-full">
                        <Folder className="w-2.5 h-2.5 text-muted" />
                        <span>{noteFolderObj ? noteFolderObj.name : "Root"}</span>
                      </span>

                      <div className="flex items-center gap-1">
                        {isPinned && (
                          <span className="p-1 text-muted" title="Pinned Note">
                            <Pin className="w-3 h-3 " />
                          </span>
                        )}

                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenNoteMenuId(openNoteMenuId === note.id ? null : note.id);
                            }}
                            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </button>

                          {openNoteMenuId === note.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 mt-1 w-44 bg-panel rounded-2xl border border-line shadow-xl p-1 z-30 flex flex-col gap-0.5 text-xs font-semibold animate-fade-in"
                            >
                              <button
                                onClick={() => {
                                  setOpenNoteMenuId(null);
                                  handleTogglePin(note);
                                }}
                                className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-left"
                              >
                                <Pin className="w-3 h-3 text-muted" />
                                <span>{isPinned ? "Unpin Note" : "Pin Note"}</span>
                              </button>

                              <button
                                onClick={() => handleDuplicateNote(note)}
                                className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-left"
                              >
                                <Copy className="w-3 h-3 text-muted" />
                                <span>Duplicate</span>
                              </button>

                              <button
                                onClick={() => {
                                  setOpenNoteMenuId(null);
                                  if (confirm(`Delete note "${noteTitle}"?`)) {
                                    onDeleteNote(note.id);
                                  }
                                }}
                                className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-500 text-left"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Delete note</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Title */}
                    <h4 className="text-sm font-extrabold text-ink line-clamp-1 group-hover:text-ink dark:group-hover:text-slate-900 transition-colors">
                      {noteTitle}
                    </h4>

                    {/* Preview Text */}
                    <p className="text-xs text-muted line-clamp-3 leading-relaxed font-normal">
                      {previewLines || "No content typed yet. Click to start writing..."}
                    </p>
                  </div>

                  {/* Bottom Metadata: Tags & Date */}
                  <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                    <div className="flex items-center gap-1 overflow-hidden">
                      {note.tags && note.tags.length > 0 ? (
                        note.tags.slice(0, 2).map((t) => (
                          <span
                            key={t}
                            className="bg-raised px-2 py-0.5 rounded-md text-[11px] font-medium truncate max-w-[80px]"
                          >
                            #{t}
                          </span>
                        ))
                      ) : (
                        <span>Markdown</span>
                      )}
                    </div>
                    <span className="shrink-0">
                      {note.updatedAt
                        ? new Date(note.updatedAt).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                          })
                        : "Today"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* LIST VIEW: Compact File Manager Table */}
        {viewMode === "list" && currentNotes.length > 0 && (
          <div className="bg-panel rounded-3xl border border-line overflow-hidden shadow-xs">
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {currentNotes.map((note) => {
                const noteTitle = note.title || note.subject || "Untitled Note";
                const noteText = note.content ?? note.summary ?? "";
                const noteFolderObj = folders.find((f) => f.id === note.folderId);
                const words = noteText.trim().split(/\s+/).filter(Boolean).length;

                return (
                  <div
                    key={note.id}
                    onClick={() => setSelectedNote(note)}
                    className="group flex items-center justify-between p-3.5 sm:px-5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <FileText className="w-4 h-4 text-slate-400 group-hover:text-ink shrink-0 transition-colors" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-ink truncate">
                            {noteTitle}
                          </h4>
                          {note.pinned && (
                            <Pin className="w-2.5 h-2.5 text-muted  shrink-0" />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 truncate max-w-md">
                          {noteText.slice(0, 80) || "Empty note"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-slate-400 shrink-0">
                      <span className="hidden md:inline text-[11px] bg-raised px-2 py-0.5 rounded-full font-medium">
                        {noteFolderObj ? noteFolderObj.name : "Root"}
                      </span>
                      <span className="hidden sm:inline text-[11px] font-mono">
                        {words} words
                      </span>
                      <span className="text-[11px]">
                        {note.updatedAt
                          ? new Date(note.updatedAt).toLocaleDateString([], {
                              month: "short",
                              day: "numeric",
                            })
                          : "Today"}
                      </span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete note "${noteTitle}"?`)) {
                            onDeleteNote(note.id);
                          }
                        }}
                        className="p-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete note"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Folder Creation / Edit Modal */}
      <FolderModal
        isOpen={isFolderModalOpen}
        onClose={() => {
          setIsFolderModalOpen(false);
          setEditingFolder(null);
        }}
        folder={editingFolder}
        folders={folders}
        defaultParentId={folderModalParentId}
        onSave={onSaveFolder}
        onDelete={onDeleteFolder}
      />
    </div>
  );
};

import { DialogBackdrop } from "./workspace/DialogBackdrop";
import React, { useState, useEffect } from "react";
import { NoteFolder, NoteFolderColor } from "../types";
import { Folder, X, Trash2, FolderPlus, Palette } from "lucide-react";

interface FolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  folder: NoteFolder | null;
  folders: NoteFolder[];
  defaultParentId?: string | null;
  onSave: (folder: NoteFolder) => void;
  onDelete?: (id: string) => void;
}

const COLOR_OPTIONS: { id: NoteFolderColor; label: string; bg: string; border: string }[] = [
  { id: "blue", label: "Blue", bg: "bg-raised0", border: "border-line" },
  { id: "amber", label: "Amber", bg: "bg-raised0", border: "border-line" },
  { id: "emerald", label: "Emerald", bg: "bg-raised0", border: "border-line" },
  { id: "purple", label: "Purple", bg: "bg-raised0", border: "border-line" },
  { id: "rose", label: "Rose", bg: "bg-rose-500", border: "border-rose-500" },
  { id: "cyan", label: "Cyan", bg: "bg-raised0", border: "border-line" },
  { id: "indigo", label: "Indigo", bg: "bg-raised0", border: "border-line" },
  { id: "slate", label: "Slate", bg: "bg-slate-500", border: "border-slate-500" },
];

export const FolderModal: React.FC<FolderModalProps> = ({
  isOpen,
  onClose,
  folder,
  folders,
  defaultParentId = null,
  onSave,
  onDelete,
}) => {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [color, setColor] = useState<NoteFolderColor>("blue");

  useEffect(() => {
    if (isOpen) {
      if (folder) {
        setName(folder.name);
        setParentId(folder.parentId);
        setColor(folder.color || "blue");
      } else {
        setName("");
        setParentId(defaultParentId);
        setColor("blue");
      }
    }
  }, [isOpen, folder, defaultParentId]);

  if (!isOpen) return null;

  // Build eligible parent options (exclude the folder itself and its descendants to avoid circular loops)
  const isDescendant = (candidateParentId: string | null, targetId: string): boolean => {
    if (!candidateParentId) return false;
    if (candidateParentId === targetId) return true;
    const parent = folders.find((f) => f.id === candidateParentId);
    if (!parent || !parent.parentId) return false;
    return isDescendant(parent.parentId, targetId);
  };

  const eligibleParents = folders.filter((f) => {
    if (!folder) return true;
    if (f.id === folder.id) return false;
    return !isDescendant(f.id, folder.id);
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const updated: NoteFolder = {
      id: folder?.id || `folder-${Date.now()}`,
      name: name.trim(),
      parentId: parentId || null,
      color,
      createdAt: folder?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSave(updated);
    onClose();
  };

  return (
    <DialogBackdrop onClose={onClose} label="Folder details" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="workspace-dialog bg-panel rounded-3xl border border-line shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-raised flex items-center justify-center text-muted dark:text-slate-400">
              {folder ? <Folder className="w-4 h-4" /> : <FolderPlus className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-ink">
                {folder ? "Edit folder" : "New folder"}
              </h3>
              <p className="text-[11px] text-slate-400">
                Organize your notes into nested hierarchies
              </p>
            </div>
          </div>
          <button aria-label="Close dialog" onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              Folder Name *
            </label>
            <input
              type="text"
              autoFocus
              required
              placeholder="e.g. CS 1332, Exams, Research, Architecture"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-raised text-xs font-semibold text-ink px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700/80 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              Parent folder location
            </label>
            <select
              value={parentId || ""}
              onChange={(e) => setParentId(e.target.value ? e.target.value : null)}
              className="w-full bg-raised text-xs font-semibold text-slate-800 dark:text-slate-200 px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700/80 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">📁 Root (Top-level folder)</option>
              {eligibleParents.map((p) => {
                const parentObj = folders.find((f) => f.id === p.parentId);
                const prefix = parentObj ? `${parentObj.name} / ` : "";
                return (
                  <option key={p.id} value={p.id}>
                    📁 {prefix}{p.name}
                  </option>
                );
              })}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Select a parent folder to nest this folder inside it, or choose Root.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-slate-400" />
              <span>Folder color</span>
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColor(c.id)}
                  className={`w-7 h-7 rounded-full ${c.bg} transition-all flex items-center justify-center ${
                    color === c.id
                      ? "ring-2 ring-offset-2 ring-blue-600 dark:ring-offset-[#141721] scale-110"
                      : "opacity-80 hover:opacity-100"
                  }`}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            {folder && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Are you sure you want to delete folder "${folder.name}"? Notes inside will be moved to root.`)) {
                    onDelete(folder.id);
                    onClose();
                  }
                }}
                className="flex items-center gap-1.5 text-xs font-bold text-rose-500 hover:text-rose-600 px-3 py-2 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete folder</span>
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-slate-1000 text-white shadow-md transition-all"
              >
                {folder ? "Save changes" : "Create folder"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </DialogBackdrop>
  );
};

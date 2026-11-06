import { DialogBackdrop } from "./workspace/DialogBackdrop";
import React, { useState, useEffect } from "react";
import { KnowledgeItem, NoteFolder } from "../types";
import { X, FileText, Trash2, Folder as FolderIcon, Tag } from "lucide-react";

interface KnowledgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: KnowledgeItem | null;
  folders?: NoteFolder[];
  onSave: (item: KnowledgeItem) => void;
  onDelete?: (id: string) => void;
}

export const KnowledgeModal: React.FC<KnowledgeModalProps> = ({
  isOpen,
  onClose,
  item,
  folders = [],
  onSave,
  onDelete,
}) => {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    if (isOpen) {
      if (item) {
        setTitle(item.title || item.subject || "");
        setContent(item.content || item.summary || "");
        setFolderId(item.folderId || null);
        setTags(item.tags || []);
      } else {
        setTitle("");
        setContent("");
        setFolderId(null);
        setTags([]);
      }
      setTagInput("");
    }
  }, [isOpen, item]);

  if (!isOpen) return null;

  const handleAddTag = () => {
    const trimmed = tagInput.trim().replace(/^#/, "");
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (t: string) => {
    setTags(tags.filter((tag) => tag !== t));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !content.trim()) return;

    const finalTitle = title.trim() || "Untitled Note";
    const snippet =
      content.trim().length > 200
        ? content.trim().slice(0, 197) + "..."
        : content.trim() || finalTitle;

    const updated: KnowledgeItem = {
      ...(item || {}),
      id: item?.id || `note-${Date.now()}`,
      title: finalTitle,
      subject: finalTitle,
      content: content.trim(),
      summary: snippet,
      folderId,
      status: item?.status || "Synthesized",
      startDate: item?.startDate || new Date().toISOString().split("T")[0],
      endDate: item?.endDate || new Date().toISOString().split("T")[0],
      domain: item?.domain || "General",
      coverGradient: item?.coverGradient || "bg-blue-600",
      itemCount: item?.itemCount || 1,
      tags,
      pinned: item?.pinned || false,
      favorite: item?.favorite || false,
      createdAt: item?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSave(updated);
    onClose();
  };

  return (
    <DialogBackdrop onClose={onClose} label="Note details" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="workspace-dialog bg-panel rounded-3xl border border-line shadow-2xl w-full max-w-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-raised flex items-center justify-center text-muted dark:text-slate-400">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-ink">
                {item ? "Edit note" : "New note"}
              </h3>
              <p className="text-[11px] text-slate-400">
                Write ideas, technical notes, or study guides
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
              Note Title *
            </label>
            <input
              type="text"
              autoFocus
              required
              placeholder="e.g. Distributed Systems Raft Consensus, CS 2110 Lab 1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-raised text-xs font-bold text-ink px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700/80 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1">
                <FolderIcon className="w-3.5 h-3.5 text-muted" />
                <span>Folder location</span>
              </label>
              <select
                value={folderId || ""}
                onChange={(e) => setFolderId(e.target.value ? e.target.value : null)}
                className="w-full bg-raised text-xs font-semibold text-slate-800 dark:text-slate-200 px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700/80 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">📁 Root / Unfiled</option>
                {folders.map((f) => {
                  const parent = folders.find((p) => p.id === f.parentId);
                  const label = parent ? `${parent.name} / ${f.name}` : f.name;
                  return (
                    <option key={f.id} value={f.id}>
                      📁 {label}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5 text-slate-400" />
                <span>Tags</span>
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  placeholder="e.g. exam, algo"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  className="w-full bg-raised text-xs font-medium text-ink px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700/80 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="px-2.5 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {tags.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 bg-raised text-slate-700 dark:text-slate-300 px-2.5 py-0.5 rounded-full text-[11px] font-medium"
                >
                  <span>#{t}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(t)}
                    className="text-slate-400 hover:text-rose-500"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              Note Content (Markdown supported) *
            </label>
            <textarea
              rows={8}
              required
              placeholder="Type your notes here... You can use markdown like ## Headings, - Lists, - [ ] Checkboxes, ```code, etc."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full bg-raised text-xs text-ink p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700/80 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-sans leading-relaxed"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            {item && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete note "${title}"?`)) {
                    onDelete(item.id);
                    onClose();
                  }
                }}
                className="flex items-center gap-1.5 text-xs font-bold text-rose-500 hover:text-rose-600 px-3 py-2 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete note</span>
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
                {item ? "Save note" : "Create note"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </DialogBackdrop>
  );
};

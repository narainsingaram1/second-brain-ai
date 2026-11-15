import React, { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { DialogBackdrop } from "./workspace/DialogBackdrop";
import type { NoteFolder, NoteFolderColor } from "../types";
import { folderPath, isWithin } from "../utils/noteFolders";
import "../notes.css";

interface FolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  folder: NoteFolder | null;
  folders: NoteFolder[];
  defaultParentId?: string | null;
  /** The top of the tree this folder can live in (a workspace's folder, or null for all of Notes). */
  rootId?: string | null;
  rootLabel?: string;
  onSave: (folder: NoteFolder) => void;
  onDelete?: (id: string) => void;
}

export const FOLDER_COLORS: { id: NoteFolderColor; label: string }[] = [
  { id: "slate", label: "Graphite" },
  { id: "blue", label: "Blue" },
  { id: "purple", label: "Violet" },
  { id: "emerald", label: "Green" },
  { id: "amber", label: "Amber" },
  { id: "rose", label: "Rose" },
  { id: "cyan", label: "Teal" },
  { id: "indigo", label: "Indigo" },
];

export const FolderModal: React.FC<FolderModalProps> = ({
  isOpen, onClose, folder, folders, defaultParentId = null, rootId = null, rootLabel = "Top level", onSave, onDelete,
}) => {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [color, setColor] = useState<NoteFolderColor>("slate");

  useEffect(() => {
    if (!isOpen) return;
    setName(folder?.name || "");
    setParentId(folder ? folder.parentId : defaultParentId);
    setColor(folder?.color || "slate");
  }, [isOpen, folder, defaultParentId]);

  if (!isOpen) return null;

  // A folder can't go inside itself or its own subfolders; a workspace's folder is never a parent option here.
  const parents = folders
    .filter(f => f.id !== rootId && (!folder || !isWithin(folders, f.id, folder.id)))
    .map(f => ({ id: f.id, label: folderPath(folders, f.id).filter(p => p.id !== rootId).map(p => p.name).join(" / ") }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const now = new Date().toISOString();
    onSave({ ...folder, id: folder?.id || `folder-${Date.now()}`, name: name.trim().slice(0, 80), parentId: parentId || null, color, createdAt: folder?.createdAt || now, updatedAt: now });
    onClose();
  };

  return (
    <DialogBackdrop onClose={onClose} label={folder ? "Edit folder" : "New folder"} className="nx-overlay">
      <form className="nx-dialog" onSubmit={submit}>
        <div className="nx-dialog-head">
          <h2>{folder ? "Edit folder" : "New folder"}</h2>
          <button type="button" className="nx-icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>

        <label className="nx-field">
          <span>Name</span>
          <input autoFocus required maxLength={80} placeholder="e.g. Research, CS 1332, Interview prep" value={name} onChange={e => setName(e.target.value)} />
        </label>

        <label className="nx-field">
          <span>Inside</span>
          <select value={parentId === rootId ? "" : parentId || ""} onChange={e => setParentId(e.target.value || rootId)}>
            <option value="">{rootLabel}</option>
            {parents.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>

        <fieldset className="nx-field">
          <span>Color</span>
          <div className="nx-swatches">
            {FOLDER_COLORS.map(c => (
              <button key={c.id} type="button" className={`nx-swatch nx-c-${c.id}`} aria-label={c.label} aria-pressed={color === c.id} onClick={() => setColor(c.id)} />
            ))}
          </div>
        </fieldset>

        <div className="nx-dialog-foot">
          {folder && onDelete && !folder.workspaceId
            ? <button type="button" className="nx-btn nx-btn-danger" onClick={() => { onClose(); onDelete(folder.id); }}><Trash2 size={15} /> Delete</button>
            : <span />}
          <div>
            <button type="button" className="nx-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="nx-btn nx-btn-primary">{folder ? "Save" : "Create folder"}</button>
          </div>
        </div>
      </form>
    </DialogBackdrop>
  );
};

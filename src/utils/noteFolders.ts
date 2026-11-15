import type { BrainState, KnowledgeItem, NoteFolder, NoteFolderColor, Workspace, WorkspaceColor } from "../types";

/**
 * Note folders form a tree (parentId). Every workspace owns one top-level folder, linked by workspaceId,
 * whose name and color follow the workspace. That folder is what the workspace's Notes tab shows.
 */
export const WORKSPACE_FOLDER_PREFIX = "folder-ws-";
export const workspaceFolderId = (workspaceId: string) => `${WORKSPACE_FOLDER_PREFIX}${workspaceId}`;
export const workspaceNoteId = (workspaceId: string) => `note-ws-${workspaceId}`;

const FOLDER_COLOR: Record<WorkspaceColor, NoteFolderColor> = { purple: "purple", blue: "blue", green: "emerald", amber: "amber", rose: "rose" };
export const workspaceFolderColor = (color: WorkspaceColor): NoteFolderColor => FOLDER_COLOR[color] || "blue";

/** The folder a workspace owns, if it exists. */
export const folderOfWorkspace = (folders: NoteFolder[], workspaceId: string) =>
  folders.find(f => f.workspaceId === workspaceId);

/** True when `id` is `ancestorId` or sits somewhere inside it. */
export function isWithin(folders: NoteFolder[], id: string | null, ancestorId: string): boolean {
  const seen = new Set<string>();
  for (let p = id; p && !seen.has(p); p = folders.find(f => f.id === p)?.parentId || null) {
    if (p === ancestorId) return true;
    seen.add(p);
  }
  return false;
}

/** Folders from the top level down to `id`, inclusive. */
export function folderPath(folders: NoteFolder[], id: string | null): NoteFolder[] {
  const path: NoteFolder[] = [];
  const seen = new Set<string>();
  for (let f = folders.find(x => x.id === id); f && !seen.has(f.id); f = folders.find(x => x.id === f!.parentId)) {
    seen.add(f.id);
    path.unshift(f);
  }
  return path;
}

/** IDs of `id` and every folder nested under it. */
export function subtreeIds(folders: NoteFolder[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
  }
  return ids;
}

/** Why a folder can't move under `parentId`, or null when it can. */
export function folderMoveBlocked(folders: NoteFolder[], folderId: string, parentId: string | null): string | null {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return "Folder not found.";
  if (folder.workspaceId) return "A workspace's folder stays at the top level.";
  if (parentId && !folders.some(f => f.id === parentId)) return "Folder not found.";
  if (parentId && isWithin(folders, parentId, folderId)) return "A folder can't be moved inside itself.";
  return null;
}

export function moveNotes(state: BrainState, noteIds: string[], folderId: string | null): BrainState {
  const ids = new Set(noteIds);
  const now = new Date().toISOString();
  let changed = false;
  const knowledgeItems = state.knowledgeItems.map(n => {
    if (!ids.has(n.id) || (n.folderId || null) === folderId) return n;
    changed = true;
    return { ...n, folderId, updatedAt: now };
  });
  return changed ? { ...state, knowledgeItems } : state;
}

export function moveFolder(state: BrainState, folderId: string, parentId: string | null): BrainState {
  const folders = state.noteFolders || [];
  const folder = folders.find(f => f.id === folderId);
  if (!folder || (folder.parentId || null) === parentId || folderMoveBlocked(folders, folderId, parentId)) return state;
  const now = new Date().toISOString();
  return { ...state, noteFolders: folders.map(f => (f.id === folderId ? { ...f, parentId, updatedAt: now } : f)) };
}

/** Deletes a folder without losing anything: its notes and subfolders move up a level. */
export function removeFolder(state: BrainState, folderId: string): BrainState {
  const folders = state.noteFolders || [];
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return state;
  const parent = folder.parentId || null;
  return {
    ...state,
    knowledgeItems: state.knowledgeItems.map(n => (n.folderId === folderId ? { ...n, folderId: parent } : n)),
    noteFolders: folders.filter(f => f.id !== folderId).map(f => (f.parentId === folderId ? { ...f, parentId: parent } : f)),
  };
}

/** When a workspace goes away its folder becomes an ordinary folder, so no notes are lost. */
export function unlinkWorkspaceFolder(folders: NoteFolder[] | undefined, workspaceId: string): NoteFolder[] | undefined {
  if (!folders?.some(f => f.workspaceId === workspaceId)) return folders;
  return folders.map(f => {
    if (f.workspaceId !== workspaceId) return f;
    const { workspaceId: _, ...rest } = f;
    return rest;
  });
}

function folderFor(workspace: Workspace, existing: NoteFolder | undefined, now: string): NoteFolder {
  return {
    ...existing,
    id: existing?.id || workspaceFolderId(workspace.id),
    name: workspace.name,
    parentId: null,
    color: workspaceFolderColor(workspace.color),
    workspaceId: workspace.id,
    createdAt: existing?.createdAt || now,
    updatedAt: existing?.updatedAt || now,
  };
}

/**
 * Gives every workspace its folder and keeps the folder's name and color in step with it. Older workspaces kept
 * their notes as one block of text; that text moves into a note inside the folder once. Returns the same state
 * object when nothing needed to change.
 */
export function syncWorkspaceFolders(state: BrainState): BrainState {
  const workspaces = state.workspaces || [];
  let folders = state.noteFolders || [];
  let notes = state.knowledgeItems || [];
  let nextWorkspaces = workspaces;
  let changed = false;
  const now = new Date().toISOString();
  const live = new Set(workspaces.map(w => w.id));

  // A folder that points at a workspace which no longer exists becomes a normal folder.
  if (folders.some(f => f.workspaceId && !live.has(f.workspaceId))) {
    folders = folders.map(f => {
      if (!f.workspaceId || live.has(f.workspaceId)) return f;
      const { workspaceId: _, ...rest } = f;
      return rest;
    });
    changed = true;
  }

  for (const workspace of workspaces) {
    const existing = folderOfWorkspace(folders, workspace.id);
    const wanted = folderFor(workspace, existing, now);
    if (!existing) {
      folders = [...folders, wanted];
      changed = true;
    } else if (existing.name !== wanted.name || existing.color !== wanted.color || existing.parentId !== null) {
      folders = folders.map(f => (f.id === existing.id ? { ...wanted, updatedAt: now } : f));
      changed = true;
    }
    const legacy = (workspace.notes || "").trim();
    if (legacy) {
      const noteId = workspaceNoteId(workspace.id);
      const prior = notes.find(n => n.id === noteId);
      const today = now.slice(0, 10);
      const note: KnowledgeItem = prior
        ? { ...prior, content: [prior.content?.trimEnd(), legacy].filter(Boolean).join("\n\n"), updatedAt: now }
        : { id: noteId, title: `${workspace.name} notes`, subject: `${workspace.name} notes`, content: legacy, summary: legacy.slice(0, 180),
            folderId: wanted.id, status: "Synthesized", startDate: today, endDate: today, domain: workspace.name, tags: [], pinned: true,
            favorite: false, createdAt: now, updatedAt: now };
      notes = prior ? notes.map(n => (n.id === noteId ? note : n)) : [note, ...notes];
      nextWorkspaces = nextWorkspaces.map(w => (w.id === workspace.id ? { ...w, notes: "" } : w));
      changed = true;
    }
  }
  return changed ? { ...state, noteFolders: folders, knowledgeItems: notes, workspaces: nextWorkspaces } : state;
}

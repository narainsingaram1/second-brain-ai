import type { AIMessage, BrainState } from "../types";
import { sessionFileBlob } from "../utils/chatFiles";
import { resumeBlob } from "./resumeFiles";

/** A file of the user's that the assistant may attach to a web form (a job application's résumé or transcript). */
export interface AttachableFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: "résumé" | "chat attachment";
  /** The résumé marked current in its Career workspace. */
  current?: boolean;
  addedAt?: string;
  workspace?: string;
}

export interface BrowserFiles {
  list(): AttachableFile[];
  load(id: string): Promise<{ file: AttachableFile; blob: Blob }>;
}

/**
 * The files the browser agent can attach: every résumé version in the user's Career workspaces (stored originals)
 * and documents the user attached in this chat session (kept in memory until reload).
 */
export function browserFiles(getState: () => BrainState | null | undefined, current?: () => AIMessage | undefined): BrowserFiles {
  const resumes = () => {
    const state = getState();
    return (state?.workspaces || []).filter(w => w.template === "career").flatMap(w => (w.resumes || []).map(resume => ({ resume, workspace: w })))
      .sort((a, b) => Date.parse(b.resume.uploadedAt) - Date.parse(a.resume.uploadedAt));
  };
  const chatFiles = () => {
    const state = getState();
    const messages = [...(state?.chatHistory || []), ...(current?.() ? [current()!] : [])];
    const seen = new Set<string>();
    return messages.filter(m => m.role === "user").flatMap(m => m.files || []).reverse()
      .filter(f => !seen.has(f.id) && seen.add(f.id) && sessionFileBlob(f.id));
  };
  const list = (): AttachableFile[] => [
    ...resumes().map(({ resume, workspace }) => ({
      id: `resume-${resume.id}`, name: resume.name, mime: resume.mime, size: resume.size, kind: "résumé" as const,
      ...(workspace.currentResumeId === resume.id ? { current: true } : {}), addedAt: resume.uploadedAt, workspace: workspace.name,
    })),
    ...chatFiles().map(f => ({ id: `chat-${f.id}`, name: f.name, mime: f.mimeType, size: f.size, kind: "chat attachment" as const })),
  ];
  return {
    list,
    async load(id) {
      const file = list().find(f => f.id === id);
      if (!file) throw new Error(`No file with id "${id}". Call browser_files to see the files you can attach.`);
      if (file.kind === "résumé") {
        const found = resumes().find(r => `resume-${r.resume.id}` === id)!;
        return { file, blob: await resumeBlob(getState()?.userId || "guest", found.resume) };
      }
      const blob = sessionFileBlob(id.replace(/^chat-/, ""));
      if (!blob) throw new Error("That attachment is no longer available. Ask the user to attach it in the chat again.");
      return { file, blob };
    },
  };
}

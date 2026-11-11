import type { ResumeVersion, TrackerItem, Workspace } from "../types";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const PDF_MIME = "application/pdf";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function normalizeResumes(value: unknown): ResumeVersion[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap(raw => {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(raw.id)
      || ids.has(raw.id) || typeof raw.name !== "string" || !raw.name.trim() || !Number.isInteger(raw.size) || raw.size < 1 || raw.size > MAX_RESUME_BYTES
      || ![PDF_MIME, DOCX_MIME].includes(raw.mime) || typeof raw.uploadedAt !== "string" || !Number.isFinite(Date.parse(raw.uploadedAt))) return [];
    ids.add(raw.id);
    return [{ id: raw.id, name: raw.name.slice(0, 200), size: raw.size, mime: raw.mime, uploadedAt: raw.uploadedAt } as ResumeVersion];
  });
}

/** Captures an explicit version; changing the default never rewrites application history. */
export function withApplicationResume(item: TrackerItem, resume?: ResumeVersion): TrackerItem {
  const { resumeId: _id, resumeName: _name, resumeUploadedAt: _at, ...fields } = item.fields;
  return { ...item, fields: { ...fields, resumeId: resume?.id || "", ...(resume ? { resumeName: resume.name, resumeUploadedAt: resume.uploadedAt } : {}) } };
}

export function currentResume(workspace: Workspace): ResumeVersion | undefined {
  return workspace.resumes?.find(resume => resume.id === workspace.currentResumeId);
}

export function resumeVersionLabel(resume: ResumeVersion): string {
  return `${resume.name} · ${new Date(resume.uploadedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

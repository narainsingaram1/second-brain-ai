import { getSupabase, managedAuthEnabled } from "./managedAuth";
import type { ResumeVersion } from "../types";
import { DOCX_MIME, MAX_RESUME_BYTES, PDF_MIME } from "../utils/resumes";

const BUCKET = "career-resumes";
let database: Promise<IDBDatabase> | undefined;
function localDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("iris_resume_files_v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
async function localFile(account: string, id: string, file?: Blob): Promise<Blob | undefined> {
  const db = await localDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", file ? "readwrite" : "readonly");
    const store = tx.objectStore("files"), key = `${account}|${id}`;
    const request = file ? store.put(file, key) : store.get(key);
    tx.oncomplete = () => resolve(file || request.result);
    tx.onerror = () => reject(tx.error || new Error("Could not store the résumé on this device."));
    tx.onabort = () => reject(tx.error || new Error("Résumé storage was interrupted."));
  });
}
const objectPath = (account: string, resume: ResumeVersion) => `${account}/${resume.id}.${resume.mime === PDF_MIME ? "pdf" : "docx"}`;

/** Store immutable originals outside the workspace JSON; metadata is published only after success. */
export async function uploadResume(account: string, file: File): Promise<ResumeVersion> {
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension !== "pdf" && extension !== "docx") throw new Error("Choose a PDF or DOCX résumé.");
  if (!file.size || file.size > MAX_RESUME_BYTES) throw new Error("Choose a non-empty résumé up to 5 MB.");
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (extension === "pdf" ? String.fromCharCode(...header) !== "%PDF-" : header[0] !== 0x50 || header[1] !== 0x4b) throw new Error("This file does not match its PDF or DOCX extension.");
  const resume: ResumeVersion = { id: crypto.randomUUID(), name: file.name.slice(0, 200), size: file.size, mime: extension === "pdf" ? PDF_MIME : DOCX_MIME, uploadedAt: new Date().toISOString() };
  if (managedAuthEnabled) {
    const { data: { user }, error: authError } = await getSupabase().auth.getUser();
    if (authError || !user || user.id !== account) throw new Error("Your account changed. Sign in again before uploading.");
    const { error } = await getSupabase().storage.from(BUCKET).upload(objectPath(account, resume), file, { contentType: resume.mime, upsert: false });
    if (error) throw new Error(/bucket.*not found/i.test(error.message) ? "Résumé storage needs its database update before uploads can work." : "Could not upload your résumé. Please retry.");
    await localFile(account, resume.id, file).catch(() => {}); // Cache failure must not undo a confirmed cloud upload.
  } else await localFile(account || "guest", resume.id, file);
  return resume;
}

export async function downloadResume(account: string, resume: ResumeVersion): Promise<void> {
  let blob = await localFile(account || "guest", resume.id).catch(() => undefined);
  if (!blob && managedAuthEnabled) {
    const { data, error } = await getSupabase().storage.from(BUCKET).download(objectPath(account, resume));
    if (error || !data) throw new Error("Could not download this résumé. Check your connection and retry.");
    blob = data;
    await localFile(account, resume.id, blob).catch(() => {});
  }
  if (!blob) throw new Error("This résumé is not available on this device.");
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = resume.name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

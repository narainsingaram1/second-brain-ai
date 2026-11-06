import { useEffect, useRef, useState } from "react";
import type { DragEvent, ReactElement } from "react";
import { AlertCircle, Check, ChevronRight, File, FileImage, FileText, Folder, FolderPlus, Layers, ListChecks, Loader2, MessageCircle, Pencil, Presentation, Search, Trash2, Upload, X } from "lucide-react";
import type { Course, StudyDocument, StudyFolder } from "../../types";
import { courseLabel, folderSubtree, removeFolder, studyOf, upsert, withStudy } from "../../utils/study";
import { ACCEPTED_UPLOADS, extractDocument } from "../../services/studyExtract";
import { deleteDocumentTexts, loadDocumentText, saveDocumentText } from "../../services/studyDocuments";
import { summarizeDocument } from "../../services/studyAI";
import { digest } from "../../services/brainRetrieval";
import { getVisionModel } from "../../services/openrouter";
import { DialogBackdrop } from "../workspace/DialogBackdrop";
import type { StudyProps } from "./AcademicWorkspace";
import type { GenerateRequest } from "./GenerateDialog";

type Scope = "all" | "unfiled" | string; // string = folder ID
interface Upload { id: string; name: string; status: string; error?: string }

const KIND_ICON = { pdf: FileText, docx: FileText, pptx: Presentation, text: File, image: FileImage } as const;
const sizeLabel = (bytes: number) => bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

export function MaterialsPanel({ state, course, onChange, onAsk, onGenerate }: StudyProps & { course: Course; onGenerate: (r: GenerateRequest) => void }) {
  const study = studyOf(state);
  const userId = state.userId || "guest";
  const folders = study.folders.filter((f) => f.courseId === course.id);
  const docs = study.documents.filter((d) => d.courseId === course.id);
  const [scope, setScope] = useState<Scope>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [folderEditor, setFolderEditor] = useState<{ folder?: StudyFolder; parentId: string | null } | null>(null);
  const [preview, setPreview] = useState<StudyDocument | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const inScope = scope === "all" ? () => true : scope === "unfiled" ? (d: StudyDocument) => !d.folderId
    : ((ids) => (d: StudyDocument) => !!d.folderId && ids.has(d.folderId))(folderSubtree(folders, scope));
  const visible = docs.filter((d) => inScope(d) && `${d.name} ${d.summary || ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const chosen = [...selected].filter((id) => docs.some((d) => d.id === id));
  const targetFolder = scope === "all" || scope === "unfiled" ? null : scope;
  const setUpload = (id: string, change: Partial<Upload>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...change } : x)));

  async function upload(files: File[]) {
    const known = new Set(docs.map((d) => d.hash));
    for (const file of files) {
      const id = crypto.randomUUID();
      setUploads((u) => [...u, { id, name: file.name, status: "Reading…" }]);
      try {
        const out = await extractDocument(file, { apiKey: state.openRouterKey, visionModel: getVisionModel(), progress: (status) => setUpload(id, { status }) });
        const hash = await digest(out.text);
        if (known.has(hash)) throw new Error(`${file.name} is already in this course.`);
        known.add(hash);
        setUpload(id, { status: "Saving…" });
        await saveDocumentText(userId, id, hash, out.text);
        const doc: StudyDocument = { id, courseId: course.id, folderId: targetFolder, name: file.name, kind: out.kind, size: file.size,
          ...(out.pages ? { pages: out.pages } : {}), chars: out.text.length, hash, createdAt: new Date().toISOString() };
        onChange((prev) => withStudy(prev, (s) => ({ documents: [...s.documents, doc] })));
        setUploads((u) => u.filter((x) => x.id !== id));
        if (out.truncated) setUploads((u) => [...u, { id: crypto.randomUUID(), name: file.name, status: "", error: "Very long document: only the first 1,000,000 characters were kept." }]);
        if (state.openRouterKey) summarizeDocument(file.name, out.text, state.openRouterKey)
          .then((summary) => onChange((prev) => withStudy(prev, (s) => ({ documents: s.documents.map((d) => (d.id === id ? { ...d, summary } : d)) }))))
          .catch(() => { /* A summary is a convenience; the document is already saved. */ });
      } catch (err) {
        setUpload(id, { status: "", error: err instanceof Error ? err.message : "Could not read this file." });
      }
    }
  }
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) upload([...event.dataTransfer.files]);
  };
  const deleteDocs = (ids: string[]) => {
    onChange((prev) => withStudy(prev, (s) => ({ documents: s.documents.filter((d) => !ids.includes(d.id)) })));
    deleteDocumentTexts(userId, ids).catch(() => {});
    setSelected(new Set());
  };
  const moveDoc = (id: string, folderId: string | null) =>
    onChange((prev) => withStudy(prev, (s) => ({ documents: s.documents.map((d) => (d.id === id ? { ...d, folderId } : d)) })));

  const tree = (parentId: string | null, depth: number): ReactElement[] => folders.filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name)).flatMap((f) => {
      const count = docs.filter((d) => d.folderId && folderSubtree(folders, f.id).has(d.folderId)).length;
      return [
        <div key={f.id} className={`ac-folder ${scope === f.id ? "is-active" : ""}`} style={{ paddingLeft: 10 + depth * 14 }}>
          <button className="ac-folder-name" onClick={() => setScope(f.id)}><Folder size={14} /><span>{f.name}</span><small>{count}</small></button>
          <span className="ac-folder-tools">
            <button aria-label={`New folder inside ${f.name}`} onClick={() => setFolderEditor({ parentId: f.id })}><FolderPlus size={13} /></button>
            <button aria-label={`Rename ${f.name}`} onClick={() => setFolderEditor({ folder: f, parentId: f.parentId })}><Pencil size={12} /></button>
            <button aria-label={`Delete ${f.name}`} onClick={() => {
              onChange((prev) => withStudy(prev, (s) => removeFolder(s, f.id)));
              if (scope === f.id || folderSubtree(folders, f.id).has(scope)) setScope("all");
            }}><Trash2 size={12} /></button>
          </span>
        </div>,
        ...tree(f.id, depth + 1),
      ];
    });

  return (
    <div className="ac-materials">
      <aside className="ac-folders ws-panel">
        <div className="ac-folders-heading">
          <strong>Folders</strong>
          <button className="ws-icon-button" aria-label="New folder" onClick={() => setFolderEditor({ parentId: targetFolder })}><FolderPlus size={15} /></button>
        </div>
        <button className={`ac-folder-name ac-folder ${scope === "all" ? "is-active" : ""}`} onClick={() => setScope("all")}><FileText size={14} /><span>All materials</span><small>{docs.length}</small></button>
        <button className={`ac-folder-name ac-folder ${scope === "unfiled" ? "is-active" : ""}`} onClick={() => setScope("unfiled")}><File size={14} /><span>Unfiled</span><small>{docs.filter((d) => !d.folderId).length}</small></button>
        {tree(null, 0)}
        {!folders.length && <p className="ac-hint">Try folders like Lectures, Homework, Exams.</p>}
      </aside>
      <section className="ws-panel ac-docs" onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }} onDrop={onDrop}>
        <div className="ac-toolbar">
          <label className="ac-search"><Search size={14} /><input value={query} placeholder="Search materials" onChange={(e) => setQuery(e.target.value)} aria-label="Search materials" /></label>
          <div className="ac-actions">
            {chosen.length > 0 && <>
              <button className="ws-button ws-secondary" onClick={() => onGenerate({ kind: "flashcards", documentIds: chosen })}><Layers size={15} />Flashcards</button>
              <button className="ws-button ws-secondary" onClick={() => onGenerate({ kind: "quiz", documentIds: chosen })}><ListChecks size={15} />Quiz</button>
              <button className="ws-icon-button" aria-label="Delete selected" onClick={() => deleteDocs(chosen)}><Trash2 size={15} /></button>
            </>}
            <button className="ws-button ws-primary" onClick={() => fileInput.current?.click()}><Upload size={15} />Upload</button>
            <input ref={fileInput} type="file" multiple hidden accept={ACCEPTED_UPLOADS} onChange={(e) => { if (e.target.files?.length) upload([...e.target.files]); e.target.value = ""; }} />
          </div>
        </div>
        {uploads.map((u) => (
          <div key={u.id} className={`ac-upload ${u.error ? "is-error" : ""}`}>
            {u.error ? <AlertCircle size={15} /> : <Loader2 size={15} className="ac-spin" />}
            <span><strong>{u.name}</strong> {u.error || u.status}</span>
            {u.error && <button className="ws-icon-button" aria-label="Dismiss" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}><X size={14} /></button>}
          </div>
        ))}
        {visible.length ? (
          <ul className="ac-doc-list">
            {visible.map((d) => {
              const Icon = KIND_ICON[d.kind];
              const isSelected = selected.has(d.id);
              return (
                <li key={d.id} className={isSelected ? "is-selected" : ""}>
                  <button className={`ac-check ${isSelected ? "is-on" : ""}`} aria-pressed={isSelected} aria-label={`Select ${d.name}`}
                    onClick={() => setSelected((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })}>
                    {isSelected && <Check size={12} />}
                  </button>
                  <span className={`ac-doc-icon ac-kind-${d.kind}`}><Icon size={16} /></span>
                  <button className="ac-doc-main" onClick={() => setPreview(d)}>
                    <strong>{d.name}</strong>
                    <small>{[d.kind.toUpperCase(), d.pages ? `${d.pages} ${d.kind === "pptx" ? "slides" : "pages"}` : "", sizeLabel(d.size), new Date(d.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })].filter(Boolean).join(" · ")}</small>
                    {d.summary && <p>{d.summary}</p>}
                  </button>
                  <select className="ac-move" aria-label={`Move ${d.name} to folder`} value={d.folderId || ""} onChange={(e) => moveDoc(d.id, e.target.value || null)}>
                    <option value="">Unfiled</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </li>
              );
            })}
          </ul>
        ) : (
          <button className={`ac-dropzone ${dragging ? "is-dragging" : ""}`} onClick={() => fileInput.current?.click()}>
            <Upload size={22} />
            <strong>{docs.length ? "No materials here yet" : "Drop course materials here"}</strong>
            <span>PDF, Word, PowerPoint, text, markdown or images of slides and notes</span>
          </button>
        )}
        {visible.length > 0 && dragging && <div className="ac-drop-overlay"><Upload size={22} />Drop to upload{targetFolder ? ` into ${folders.find((f) => f.id === targetFolder)?.name}` : ""}</div>}
      </section>
      {folderEditor && (
        <FolderEditor folder={folderEditor.folder} onClose={() => setFolderEditor(null)} onSave={(name) => {
          const folder: StudyFolder = folderEditor.folder ? { ...folderEditor.folder, name }
            : { id: crypto.randomUUID(), courseId: course.id, parentId: folderEditor.parentId, name, createdAt: new Date().toISOString() };
          onChange((prev) => withStudy(prev, (s) => ({ folders: upsert(s.folders, folder) })));
          setFolderEditor(null);
          setScope(folder.id);
        }} />
      )}
      {preview && <DocumentPreview doc={preview} userId={userId} onClose={() => setPreview(null)}
        onAsk={() => { onAsk(`Help me study "${preview.name}" from ${courseLabel(course)}. Read it and walk me through the key ideas, then quiz me with a couple of questions.`); setPreview(null); }}
        onGenerate={(kind) => { onGenerate({ kind, documentIds: [preview.id] }); setPreview(null); }}
        onDelete={() => { deleteDocs([preview.id]); setPreview(null); }} />}
    </div>
  );
}

function FolderEditor({ folder, onSave, onClose }: { folder?: StudyFolder; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(folder?.name || "");
  return (
    <DialogBackdrop label={folder ? "Rename folder" : "New folder"} onClose={onClose} className="ws-overlay">
      <form className="ws-dialog ac-small-dialog" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
        <div className="ws-form-body">
          <label>{folder ? "Folder name" : "New folder"}<input autoFocus required maxLength={80} value={name} placeholder="Lectures" onChange={(e) => setName(e.target.value)} /></label>
        </div>
        <div className="ws-dialog-actions">
          <button type="button" className="ws-button ws-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="ws-button ws-primary" disabled={!name.trim()}>{folder ? "Rename" : "Create folder"}</button>
        </div>
      </form>
    </DialogBackdrop>
  );
}

function DocumentPreview({ doc, userId, onClose, onAsk, onGenerate, onDelete }: { doc: StudyDocument; userId: string; onClose: () => void; onAsk: () => void; onGenerate: (k: "flashcards" | "quiz") => void; onDelete: () => void }) {
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [limit, setLimit] = useState(20000);
  useEffect(() => {
    let live = true;
    loadDocumentText(userId, doc.id).then((t) => live && setText(t ?? null)).catch(() => live && setText(null));
    return () => { live = false; };
  }, [doc.id, userId]);
  return (
    <DialogBackdrop label={`Preview ${doc.name}`} onClose={onClose} className="ws-overlay">
      <div className="ws-dialog ac-preview">
        <div className="ws-dialog-heading">
          <div>
            <h2>{doc.name}</h2>
            <p>{doc.summary || `${doc.chars.toLocaleString()} characters of extracted text`}</p>
          </div>
          <button className="ws-icon-button" aria-label="Close preview" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="ac-preview-body">
          {text === undefined ? <p className="ac-hint"><Loader2 size={14} className="ac-spin" /> Loading…</p>
            : text === null ? <p className="ac-hint">The text for this document isn’t on this device yet. It was uploaded on another device; sign in there or upload it again.</p>
            : <>
              <pre>{text.slice(0, limit)}</pre>
              {text.length > limit && <button className="ws-text-button" onClick={() => setLimit((l) => l + 40000)}>Show more<ChevronRight size={13} /></button>}
            </>}
        </div>
        <div className="ws-dialog-actions ac-preview-actions">
          <button className="ws-icon-button" aria-label="Delete document" onClick={onDelete}><Trash2 size={15} /></button>
          <span />
          <button className="ws-button ws-secondary" onClick={onAsk}><MessageCircle size={15} />Ask Synapse</button>
          <button className="ws-button ws-secondary" onClick={() => onGenerate("quiz")}><ListChecks size={15} />Quiz</button>
          <button className="ws-button ws-primary" onClick={() => onGenerate("flashcards")}><Layers size={15} />Flashcards</button>
        </div>
      </div>
    </DialogBackdrop>
  );
}

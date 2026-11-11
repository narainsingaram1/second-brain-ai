import { useRef, useState } from "react";
import { CalendarDays, Check, Download, FileText, Send, Star, Upload } from "lucide-react";
import type { BrainState, ResumeVersion, TrackerItem, Workspace } from "../../types";
import { currentResume, resumeVersionLabel } from "../../utils/resumes";
import { downloadResume, uploadResume } from "../../services/resumeFiles";

type Update = (change: (state: BrainState) => BrainState) => void;

export function ResumeDownload({ account, resume, compact = false }: { account: string; resume: ResumeVersion; compact?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div className="career-resume-download">
    <button type="button" disabled={busy} title={resumeVersionLabel(resume)} className={compact ? "career-resume-file" : "ws-button ws-secondary"}
      onClick={async () => { setBusy(true); setError(""); try { await downloadResume(account, resume); } catch (e) { setError(e instanceof Error ? e.message : "Download failed."); } finally { setBusy(false); } }}>
      <Download size={14} /><span className={compact ? "sr-only" : ""}>{busy ? "Downloading…" : compact ? `Download ${resume.name}` : "Download"}</span>
    </button>
    {error && <p role="alert" className="career-file-error">{error}</p>}
  </div>;
}

export function ApplicationOverview({ workspace, applications, account, onChange }: {
  workspace: Workspace; applications: TrackerItem[]; account: string; onChange: Update;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false), [error, setError] = useState("");
  const current = currentResume(workspace), versions = workspace.resumes || [];
  const setCurrent = (id: string) => onChange(state => state.userId !== account && !(account === "guest" && !state.userId) ? state : ({ ...state,
    workspaces: state.workspaces?.map(item => item.id === workspace.id ? { ...item, currentResumeId: id || undefined } : item),
  }));
  return <>
    <div className="career-application-stats" aria-label="Application summary">
      {[
        { label: "Total applications", value: applications.length, Icon: FileText },
        { label: "Applied", value: applications.filter(item => item.status === "applied").length, Icon: Send },
        { label: "Interviews", value: applications.filter(item => item.status === "screening" || item.status === "onsite").length, Icon: CalendarDays },
        { label: "Offers", value: applications.filter(item => item.status === "offer").length, Icon: Star },
      ].map(({ label, value, Icon }) => <div key={label}><span className="career-stat-icon"><Icon size={20} strokeWidth={1.5} /></span><div><strong>{value}</strong><span>{label}</span></div></div>)}
    </div>
    <section className="career-resume-panel" aria-label="Résumé library">
      <div className="career-resume-current">
        <FileText size={21} strokeWidth={1.5} />
        <div className="career-resume-description"><h3>Current résumé</h3><p>{current ? resumeVersionLabel(current) : "Upload a résumé to use as the default for new applications."}</p></div>
        {current && <ResumeDownload account={account} resume={current} />}
        <button className="ws-button ws-secondary" disabled={uploading} onClick={() => input.current?.click()}><Upload size={15} />{uploading ? "Uploading…" : versions.length ? "Upload new version" : "Upload résumé"}</button>
        <input ref={input} type="file" className="sr-only" tabIndex={-1} accept=".pdf,.docx" aria-label="Upload résumé file" disabled={uploading} onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
          setUploading(true); setError("");
          try {
            const resume = await uploadResume(account, file);
            onChange(state => state.userId !== account && !(account === "guest" && !state.userId) ? state : ({ ...state,
              workspaces: state.workspaces?.map(item => item.id === workspace.id ? { ...item, resumes: [...(item.resumes || []), resume], currentResumeId: resume.id } : item),
            }));
          } catch (e) { setError(e instanceof Error ? e.message : "Could not upload the résumé."); }
          finally { setUploading(false); }
        }} />
      </div>
      <div className="career-resume-help"><span>PDF or DOCX · up to 5 MB · Past applications keep the version you selected.</span>
        {versions.length > 0 && <details><summary>{versions.length} saved {versions.length === 1 ? "version" : "versions"}</summary>
          <div className="career-resume-versions">{[...versions].reverse().map(resume => <div key={resume.id}>
            <div><strong>{resume.name}</strong><small>{new Date(resume.uploadedAt).toLocaleString()} · {(resume.size / 1024).toFixed(0)} KB</small></div>
            <ResumeDownload account={account} resume={resume} />
            <button className="ws-button ws-secondary" disabled={current?.id === resume.id} onClick={() => setCurrent(resume.id)}>{current?.id === resume.id ? <><Check size={14} />Current</> : "Use as current"}</button>
          </div>)}<button className="ws-button ws-secondary" disabled={!current} onClick={() => setCurrent("")}>No default résumé</button></div>
        </details>}
      </div>
      {error && <p role="alert" className="career-file-error">{error}</p>}
    </section>
  </>;
}

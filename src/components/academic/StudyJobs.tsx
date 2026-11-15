import { useEffect, useState } from "react";
import { AlertCircle, Check, Layers, ListChecks, RotateCcw, X } from "lucide-react";
import { cancelStudyJob, dismissStudyJob, retryStudyJob, setJobOnScreen, type StudyJob } from "../../services/studyJobs";

const noun = (job: StudyJob, plural = true) => job.kind === "quiz" ? (plural ? "questions" : "question") : (plural ? "cards" : "card");
export const isRunning = (job: StudyJob) => job.status !== "done" && job.status !== "error";

/** What the job is doing, in a few words. */
export function jobLabel(job: StudyJob): string {
  switch (job.status) {
    case "reading": return "Reading your materials";
    case "writing": return job.written ? `Writing ${noun(job)} · ${job.written} of ${job.count}` : `Writing ${job.count} ${noun(job)}`;
    case "checking": return "Checking every answer";
    case "saving": return "Saving";
    case "done": return `${job.written || job.count} ${noun(job, (job.written || job.count) !== 1)} ready`;
    case "error": return job.error || "Generation failed";
  }
}

/** 0–1 when known; null while the model is writing but its progress can't be counted. */
export function jobProgress(job: StudyJob): number | null {
  if (job.status === "reading") return 0.06;
  if (job.status === "saving" || job.status === "done") return 1;
  if (job.status === "checking") return 0.95;
  if (job.status === "writing") return job.written ? 0.1 + 0.85 * (job.written / Math.max(1, job.count)) : null;
  return 0;
}

function useElapsed(since: number, live: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  const s = Math.max(0, Math.round((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A thin bar: fills with real progress, or glides when progress can't be measured yet. */
export function JobBar({ job }: { job: StudyJob }) {
  const value = jobProgress(job);
  return <span className={`ac-job-bar ${value === null ? "is-indeterminate" : ""} is-${job.status}`} role="progressbar"
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(value * 100)} aria-label={jobLabel(job)}>
    <span style={value === null ? undefined : { transform: `scaleX(${value})` }} />
  </span>;
}

/** A generation in progress (or failed), shown at the top of the quiz or deck list it will join. */
export function StudyJobRow({ job }: { job: StudyJob }) {
  const live = isRunning(job);
  const elapsed = useElapsed(job.startedAt, live);
  const Icon = job.kind === "quiz" ? ListChecks : Layers;
  const failed = job.status === "error";
  useEffect(() => { setJobOnScreen(job.id, true); return () => setJobOnScreen(job.id, false); }, [job.id]);
  return (
    <li className={`ac-job ${failed ? "is-error" : ""}`} aria-live="polite">
      <div className="ac-deck-row">
        <div className="ac-deck-main">
          <span className={`ac-doc-icon ac-job-icon ${job.kind === "quiz" ? "ac-kind-quiz" : "ac-kind-deck"} ${live ? "is-live" : ""}`}>
            {failed ? <AlertCircle size={15} /> : <Icon size={15} />}
          </span>
          <span>
            <strong>{job.title}</strong>
            <small key={job.status} className="ac-job-status">{jobLabel(job)}{live && <span className="ac-job-time">{elapsed}</span>}</small>
          </span>
        </div>
        <div className="ac-actions">
          {failed && <button className="ws-button ws-secondary" onClick={() => retryStudyJob(job.id)}><RotateCcw size={14} />Try again</button>}
          <button className="ws-icon-button" aria-label={failed ? "Dismiss" : `Cancel ${job.title}`} title={failed ? "Dismiss" : "Cancel"}
            onClick={() => (failed ? dismissStudyJob(job.id) : cancelStudyJob(job.id))}><X size={15} /></button>
        </div>
      </div>
      {!failed && <JobBar job={job} />}
    </li>
  );
}

/** Tells the user a background generation finished (or failed), wherever they are in the academic workspace. */
export function StudyJobToasts({ jobs, courseName, onOpen }: { jobs: StudyJob[]; courseName: (courseId: string) => string; onOpen: (job: StudyJob) => void }) {
  // A failure the user is already looking at (its row is on screen) needs no second notice.
  const finished = jobs.filter((j) => j.status === "done" || (j.status === "error" && !j.onScreen));
  useEffect(() => {
    // Successes clear themselves; failures stay until handled.
    const timers = finished.filter((j) => j.status === "done").map((j) => setTimeout(() => dismissStudyJob(j.id), 12000));
    return () => timers.forEach(clearTimeout);
  }, [finished.filter((j) => j.status === "done").map((j) => j.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!finished.length) return null;
  return (
    <div className="ac-toasts" role="status">
      {finished.slice(-3).map((job) => {
        const ok = job.status === "done";
        return (
          <div key={job.id} className={`ac-toast ${ok ? "is-done" : "is-error"}`}>
            <span className="ac-toast-icon">{ok ? <Check size={14} /> : <AlertCircle size={14} />}</span>
            <span className="ac-toast-text">
              <strong>{ok ? `${job.kind === "quiz" ? "Quiz" : "Flashcards"} ready` : `Couldn't create ${job.kind === "quiz" ? "the quiz" : "the deck"}`}</strong>
              <small>{job.title} · {ok ? jobLabel(job) : courseName(job.courseId)}</small>
            </span>
            <button className="ac-toast-action" onClick={() => onOpen(job)}>{ok ? (job.kind === "quiz" ? "Start" : "Open") : "View"}</button>
            <button className="ws-icon-button ac-toast-close" aria-label="Dismiss" onClick={() => dismissStudyJob(job.id)}><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}

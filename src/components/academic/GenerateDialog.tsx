import { useState } from "react";
import { Check, Layers, ListChecks, PenLine, X } from "lucide-react";
import type { BrainState, Course } from "../../types";
import { studyOf } from "../../utils/study";
import { startStudyJob } from "../../services/studyJobs";
import type { StudyOptions } from "../../services/studyAI";
import { DialogBackdrop } from "../workspace/DialogBackdrop";
import type { StudyUpdate } from "./AcademicWorkspace";

export interface GenerateRequest { kind: "flashcards" | "quiz"; documentIds: string[] }

export function GenerateDialog({ state, course, request, onChange, onClose, onStarted }: {
  state: BrainState; course: Course; request: GenerateRequest; onChange: StudyUpdate; onClose: () => void; onStarted: (kind: GenerateRequest["kind"]) => void;
}) {
  const docs = studyOf(state).documents.filter((d) => d.courseId === course.id);
  const isQuiz = request.kind === "quiz";
  const [picked, setPicked] = useState<Set<string>>(new Set(request.documentIds.length ? request.documentIds : docs.map((d) => d.id)));
  const [count, setCount] = useState(isQuiz ? 10 : 20);
  const [difficulty, setDifficulty] = useState<NonNullable<StudyOptions["difficulty"]>>("exam");
  const [format, setFormat] = useState<"mcq" | "mixed">("mixed");
  const [focus, setFocus] = useState("");
  const firstName = docs.find((d) => picked.has(d.id))?.name.replace(/\.[^.]+$/, "");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const defaultTitle = focus.trim() ? focus.trim().slice(0, 80) : picked.size === 1 && firstName ? firstName : `${course.code || course.name} ${isQuiz ? "practice quiz" : "review"}`;

  /** Hands the work to the background and closes: progress shows in the course while the user carries on. */
  function run() {
    if (!state.openRouterKey) return setError("Connect an AI provider in Settings first.");
    startStudyJob({
      kind: request.kind, userId: state.userId || "guest", course, docs: docs.filter((d) => picked.has(d.id)),
      title: title.trim() || defaultTitle, count, options: { focus: focus.trim() || undefined, difficulty, format },
      apiKey: state.openRouterKey, model: state.selectedModel, onChange,
    });
    onStarted(request.kind);
  }
  const close = onClose;

  return (
    <DialogBackdrop label={isQuiz ? "Create a practice quiz" : "Create flashcards"} onClose={close} className="ws-overlay">
      <form className="ws-dialog ac-generate" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <div className="ws-dialog-heading">
          <div>
            <span className="ws-icon ws-color-purple">{isQuiz ? <ListChecks size={22} /> : <Layers size={22} />}</span>
            <h2>{isQuiz ? "Create a practice quiz" : "Create flashcards"}</h2>
            <p>Generated only from the materials you choose, with each item linked to its source. It runs in the background, so you can keep working.</p>
          </div>
          <button className="ws-icon-button" type="button" aria-label="Close" onClick={close}><X size={19} /></button>
        </div>
        <div className="ws-form-body">
          {docs.length ? (
            <fieldset>
              <legend>From these materials ({picked.size})</legend>
              <div className="ac-pick-list">
                {docs.map((d) => (
                  <label key={d.id} className={picked.has(d.id) ? "is-on" : ""}>
                    <input type="checkbox" checked={picked.has(d.id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })} />
                    <span className="ac-check">{picked.has(d.id) && <Check size={12} />}</span>{d.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : <p className="ac-hint">Upload materials to this course first.</p>}
          <label>Focus <small>optional</small><input value={focus} maxLength={200} placeholder="e.g. AVL rotations, chapter 4, things likely on the midterm" onChange={(e) => setFocus(e.target.value)} /></label>
          <div className="ac-form-row">
            <label>{isQuiz ? "Questions" : "Cards"}
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {(isQuiz ? [5, 10, 15, 20] : [10, 20, 30, 40]).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label>Level
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}>
                <option value="intro">Fundamentals</option>
                <option value="exam">Exam prep</option>
                <option value="challenge">Challenge</option>
              </select>
            </label>
            {isQuiz && <label>Format
              <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                <option value="mixed">Mixed</option>
                <option value="mcq">Multiple choice</option>
              </select>
            </label>}
          </div>
          <label>Title <small>optional</small><input value={title} maxLength={120} placeholder={defaultTitle} onChange={(e) => setTitle(e.target.value)} /></label>
          {error && <p className="ac-error">{error}</p>}
        </div>
        <div className="ws-dialog-actions">
          <button type="button" className="ws-button ws-secondary" onClick={close}>Cancel</button>
          <button type="submit" className="ws-button ws-primary" disabled={!picked.size}><PenLine size={15} />Generate</button>
        </div>
      </form>
    </DialogBackdrop>
  );
}

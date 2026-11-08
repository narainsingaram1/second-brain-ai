import { useState } from "react";
import { ArrowRight, BookOpen, Check, FileText, GraduationCap, Layers, ListChecks, Plus, X } from "lucide-react";
import type { BrainState, Course, Workspace } from "../../types";
import { getLocalDateString } from "../../utils/habitStreaks";
import { bestScore, courseTasks, dueCards, linkCourseToTasks, studyOf, upsert, withStudy } from "../../utils/study";
import { DialogBackdrop } from "../workspace/DialogBackdrop";
import { formatPercent, summarize } from "../../utils/grades";
import { CourseView } from "./CourseView";
import type { TaskActions } from "./TasksPanel";
import "../../academic.css";

export type StudyUpdate = (update: (state: BrainState) => BrainState) => void;
export interface StudyProps {
  state: BrainState;
  onChange: StudyUpdate;
  /** Opens the main assistant with this message. */
  onAsk: (prompt: string) => void;
}

export function AcademicWorkspace({ state, workspace, onChange, onAsk, taskActions }: StudyProps & { workspace: Workspace; taskActions: TaskActions }) {
  const study = studyOf(state);
  const courses = study.courses.filter((c) => c.workspaceId === workspace.id);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Course | "new" | null>(null);
  const course = courses.find((c) => c.id === courseId);
  const today = getLocalDateString();
  const courseIds = new Set(courses.map((c) => c.id));
  const decks = study.decks.filter((d) => courseIds.has(d.courseId));
  const due = decks.reduce((n, d) => n + dueCards(d, today).length, 0);
  const attempts = study.quizzes.filter((q) => courseIds.has(q.courseId)).reduce((n, q) => n + q.attempts.length, 0);

  const saveCourse = (next: Course) => {
    onChange((prev) => linkCourseToTasks(withStudy(prev, (s) => ({ courses: upsert(s.courses, next) })), next, studyOf(prev).courses.find((c) => c.id === next.id)));
    setEditor(null);
    setCourseId(next.id);
  };

  if (course)
    return (
      <>
        <CourseView state={state} course={course} onChange={onChange} onAsk={onAsk} taskActions={taskActions} onBack={() => setCourseId(null)} onEdit={() => setEditor(course)} />
        {editor && <CourseEditor course={editor === "new" ? undefined : editor} workspaceId={workspace.id} onSave={saveCourse} onClose={() => setEditor(null)} />}
      </>
    );

  return (
    <div className="ac-root">
      <div className="ws-stats">
        {[
          { label: "Courses", value: courses.length, detail: "this workspace", icon: GraduationCap, color: "purple" },
          { label: "Materials", value: study.documents.filter((d) => courseIds.has(d.courseId)).length, detail: "documents uploaded", icon: FileText, color: "blue" },
          { label: "Cards due", value: due, detail: `${decks.reduce((n, d) => n + d.cards.length, 0)} flashcards total`, icon: Layers, color: "amber" },
          { label: "Quizzes taken", value: attempts, detail: "practice attempts", icon: ListChecks, color: "green" },
        ].map((stat) => (
          <div className="ws-stat" key={stat.label}>
            <div><span>{stat.label}</span><stat.icon size={17} className={`ws-text-${stat.color}`} /></div>
            <strong>{stat.value}</strong>
            <small>{stat.detail}</small>
          </div>
        ))}
      </div>
      <div className="ws-panel">
        <div className="ws-panel-heading">
          <div>
            <h2>Your courses</h2>
            <p>Upload lecture notes, slides and readings, then turn them into flashcards and practice quizzes. Synapse can read everything here.</p>
          </div>
          <button className="ws-button ws-primary" onClick={() => setEditor("new")}><Plus size={15} />New course</button>
        </div>
        {courses.length ? (
          <div className="ac-course-grid">
            {courses.map((c) => {
              const docs = study.documents.filter((d) => d.courseId === c.id).length;
              const courseDecks = study.decks.filter((d) => d.courseId === c.id);
              const dueHere = courseDecks.reduce((n, d) => n + dueCards(d, today).length, 0);
              const quizzes = study.quizzes.filter((q) => q.courseId === c.id);
              const scores = quizzes.map(bestScore).filter((s): s is number => s !== null);
              const openTasks = courseTasks(state, c).filter((t) => t.status !== "completed").length;
              const grade = c.grading?.categories.length ? summarize(c.grading) : null;
              return (
                <button key={c.id} className="ac-course-card" onClick={() => setCourseId(c.id)}>
                  <div className="ac-course-top">
                    <span className="ac-course-code">{c.code || "Course"}</span>
                    {grade?.current != null ? <span className="ac-card-grade"><strong>{formatPercent(grade.current)}</strong> {grade.letter}</span> : <ArrowRight size={16} />}
                  </div>
                  <h3>{c.name}</h3>
                  <p>{[c.term, c.instructor].filter(Boolean).join(" · ") || "No term set"}</p>
                  <div className="ac-course-meta">
                    <span><FileText size={13} />{docs} {docs === 1 ? "doc" : "docs"}</span>
                    <span className={dueHere ? "ac-due" : ""}><Layers size={13} />{dueHere ? `${dueHere} due` : `${courseDecks.length} decks`}</span>
                    <span><ListChecks size={13} />{scores.length ? `best ${Math.max(...scores)}%` : `${quizzes.length} quizzes`}</span>
                    {openTasks > 0 && <span><Check size={13} />{openTasks} open tasks</span>}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="ac-empty">
            <BookOpen size={26} />
            <strong>Add your first course</strong>
            <p>Each course gets folders for materials, flashcard decks and practice quizzes. Its code also becomes a task subsection under Academic.</p>
            <button className="ws-button ws-primary" onClick={() => setEditor("new")}><Plus size={15} />New course</button>
          </div>
        )}
      </div>
      {editor && <CourseEditor course={editor === "new" ? undefined : editor} workspaceId={workspace.id} onSave={saveCourse} onClose={() => setEditor(null)} />}
    </div>
  );
}

export function CourseEditor({ course, workspaceId, onSave, onClose }: { course?: Course; workspaceId: string; onSave: (c: Course) => void; onClose: () => void }) {
  const [code, setCode] = useState(course?.code || "");
  const [name, setName] = useState(course?.name || "");
  const [term, setTerm] = useState(course?.term || "");
  const [instructor, setInstructor] = useState(course?.instructor || "");
  return (
    <DialogBackdrop label={course ? "Edit course" : "New course"} onClose={onClose} className="ws-overlay">
      <form
        className="ws-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          const now = new Date().toISOString();
          onSave({ ...(course || {}), id: course?.id || crypto.randomUUID(), workspaceId: course?.workspaceId || workspaceId, code: code.trim(), name: name.trim(),
            ...(term.trim() ? { term: term.trim() } : {}), ...(instructor.trim() ? { instructor: instructor.trim() } : {}),
            createdAt: course?.createdAt || now, updatedAt: now });
        }}
      >
        <div className="ws-dialog-heading">
          <div>
            <span className="ws-icon ws-color-blue"><GraduationCap size={22} /></span>
            <h2>{course ? "Edit course" : "Add a course"}</h2>
            <p>Materials, flashcards and quizzes stay organized by course.</p>
          </div>
          <button className="ws-icon-button" type="button" aria-label="Close" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="ws-form-body">
          <div className="ac-form-row">
            <label>Course code <small>optional</small><input maxLength={40} value={code} placeholder="CS 1332" onChange={(e) => setCode(e.target.value)} /></label>
            <label>Term <small>optional</small><input maxLength={60} value={term} placeholder="Fall 2026" onChange={(e) => setTerm(e.target.value)} /></label>
          </div>
          <label>Course name<input autoFocus required maxLength={120} value={name} placeholder="Data Structures & Algorithms" onChange={(e) => setName(e.target.value)} /></label>
          <label>Instructor <small>optional</small><input maxLength={80} value={instructor} onChange={(e) => setInstructor(e.target.value)} /></label>
        </div>
        <div className="ws-dialog-actions">
          <button type="button" className="ws-button ws-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="ws-button ws-primary" disabled={!name.trim()}>{course ? "Save changes" : "Create course"}<ArrowRight size={15} /></button>
        </div>
      </form>
    </DialogBackdrop>
  );
}

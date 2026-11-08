import { useState } from "react";
import { ArrowLeft, CalendarClock, CheckSquare, FileText, GraduationCap, Layers, ListChecks, MessageCircle, Settings2, Trash2 } from "lucide-react";
import type { Course } from "../../types";
import { getLocalDateString } from "../../utils/habitStreaks";
import { courseLabel, courseTasks, dueCards, removeCourse, studyOf } from "../../utils/study";
import { deleteDocumentTexts } from "../../services/studyDocuments";
import { DialogBackdrop } from "../workspace/DialogBackdrop";
import type { StudyProps } from "./AcademicWorkspace";
import { MaterialsPanel } from "./MaterialsPanel";
import { DecksPanel } from "./DecksPanel";
import { QuizzesPanel } from "./QuizzesPanel";
import { GradesPanel } from "./GradesPanel";
import { TasksPanel, type TaskActions } from "./TasksPanel";
import { formatPercent, summarize } from "../../utils/grades";
import { GenerateDialog, type GenerateRequest } from "./GenerateDialog";

type Tab = "materials" | "tasks" | "flashcards" | "quizzes" | "grades";

export function CourseView({ state, course, onChange, onAsk, taskActions, onBack, onEdit }: StudyProps & { course: Course; taskActions: TaskActions; onBack: () => void; onEdit: () => void }) {
  const study = studyOf(state);
  const [tab, setTab] = useState<Tab>("materials");
  const [generate, setGenerate] = useState<GenerateRequest | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Set after generation so the new deck or quiz opens immediately. */
  const [opened, setOpened] = useState<{ kind: "deck" | "quiz"; id: string } | null>(null);
  const today = getLocalDateString();
  const docs = study.documents.filter((d) => d.courseId === course.id);
  const decks = study.decks.filter((d) => d.courseId === course.id);
  const quizzes = study.quizzes.filter((q) => q.courseId === course.id);
  const due = decks.reduce((n, d) => n + dueCards(d, today).length, 0);
  const openTasks = courseTasks(state, course).filter((t) => t.status !== "completed");
  const upcoming = openTasks.filter((t) => t.dueDate && t.dueDate >= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3);

  return (
    <div className="ac-root">
      <div className="ac-course-header">
        <button className="ws-back" onClick={onBack}><ArrowLeft size={14} />All courses</button>
        <div className="ac-course-title">
          <div>
            {course.code && <span className="ac-course-code">{course.code}</span>}
            <h2>{course.name}</h2>
            <p>{[course.term, course.instructor].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="ac-actions">
            <button className="ws-button ws-secondary" onClick={() => onAsk(`Let's study ${courseLabel(course)}. Look through my course materials and give me a quick map of the key topics, then suggest what I should review first.`)}>
              <MessageCircle size={15} />Ask Iris
            </button>
            <button className="ws-icon-button" aria-label="Edit course" onClick={onEdit}><Settings2 size={16} /></button>
            <button className="ws-icon-button" aria-label="Delete course" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /></button>
          </div>
        </div>
        {upcoming.length > 0 && (
          <div className="ac-upcoming">
            <CalendarClock size={14} />
            {upcoming.map((t) => <span key={t.id}>{t.title} <small>{new Date(`${t.dueDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></span>)}
          </div>
        )}
      </div>
      <div className="ws-tabs" role="tablist" aria-label="Course pages">
        {([
          { id: "materials", label: "Materials", icon: FileText, count: docs.length },
          { id: "tasks", label: "Tasks", icon: CheckSquare, count: openTasks.length },
          { id: "flashcards", label: "Flashcards", icon: Layers, count: due || decks.length },
          { id: "quizzes", label: "Quizzes", icon: ListChecks, count: quizzes.length },
          { id: "grades", label: "Grades", icon: GraduationCap, count: course.grading?.categories.length ? formatPercent(summarize(course.grading).current) : null },
        ] as const).map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            <t.icon size={16} />{t.label}{t.count !== null && <span className={t.id === "flashcards" && due ? "ac-due" : ""}>{t.count}</span>}
          </button>
        ))}
      </div>
      {tab === "materials" && <MaterialsPanel state={state} course={course} onChange={onChange} onAsk={onAsk} onGenerate={setGenerate} />}
      {tab === "tasks" && <TasksPanel state={state} course={course} onChange={onChange} actions={taskActions} />}
      {tab === "flashcards" && <DecksPanel state={state} course={course} onChange={onChange} onAsk={onAsk} onGenerate={() => setGenerate({ kind: "flashcards", documentIds: [] })} openDeckId={opened?.kind === "deck" ? opened.id : undefined} onOpened={() => setOpened(null)} />}
      {tab === "quizzes" && <QuizzesPanel state={state} course={course} onChange={onChange} onAsk={onAsk} onGenerate={() => setGenerate({ kind: "quiz", documentIds: [] })} openQuizId={opened?.kind === "quiz" ? opened.id : undefined} onOpened={() => setOpened(null)} />}
      {tab === "grades" && <GradesPanel state={state} course={course} onChange={onChange} onAsk={onAsk} />}
      {generate && (
        <GenerateDialog state={state} course={course} request={generate} onChange={onChange} onClose={() => setGenerate(null)}
          onCreated={(kind, id) => { setGenerate(null); setTab(kind === "deck" ? "flashcards" : "quizzes"); setOpened({ kind, id }); }} />
      )}
      {confirmDelete && (
        <DialogBackdrop label="Delete course" onClose={() => setConfirmDelete(false)} className="ws-overlay">
          <div className="ws-dialog ws-confirm">
            <span className="ws-confirm-icon"><Trash2 size={24} /></span>
            <h2>Delete {courseLabel(course)}?</h2>
            <p>This removes its {docs.length} documents, {decks.length} flashcard decks and {quizzes.length} quizzes. Tasks under this course stay.</p>
            <div className="ws-dialog-actions">
              <button className="ws-button ws-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="ws-button ws-danger" onClick={() => {
                const ids = docs.map((d) => d.id);
                onChange((prev) => ({ ...prev, study: removeCourse(studyOf(prev), course.id).study }));
                deleteDocumentTexts(state.userId || "guest", ids).catch(() => {});
                onBack();
              }}>Delete course</button>
            </div>
          </div>
        </DialogBackdrop>
      )}
    </div>
  );
}

import { useState } from "react";
import { Check, CheckSquare, Plus } from "lucide-react";
import type { BrainState, Course, Task } from "../../types";
import { formatTime } from "../../utils/events";
import { getLocalDateString } from "../../utils/habitStreaks";
import { ACADEMIC_SECTION, courseSubsection, courseTasks, linkCourseToTasks } from "../../utils/study";
import { isTaskDone } from "../../utils/taskState";

/** The app's own task actions, so a change here is the same change as on the Tasks page. */
export interface TaskActions {
  onToggle: (taskId: string) => void;
  onEdit: (task: Task) => void;
  onNew: (section: string, subsection: string) => void;
}

const byDueDate = (a: Task, b: Task) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || (a.dueTime || "").localeCompare(b.dueTime || "");

function dueLabel(task: Task, today: string) {
  if (!task.dueDate) return "No date";
  const day = task.dueDate === today ? "Today" : new Date(`${task.dueDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return task.dueTime ? `${day}, ${formatTime(task.dueTime)}` : day;
}

export function TasksPanel({ state, course, onChange, actions }: {
  state: BrainState;
  course: Course;
  onChange: (update: (prev: BrainState) => BrainState) => void;
  actions: TaskActions;
}) {
  const [showDone, setShowDone] = useState(false);
  const today = getLocalDateString();
  const tasks = courseTasks(state, course);
  const open = tasks.filter((t) => !isTaskDone(t)).sort(byDueDate);
  const done = tasks.filter(isTaskDone).sort((a, b) => byDueDate(b, a));
  const addTask = () => {
    onChange((prev) => linkCourseToTasks(prev, course)); // The subsection may have been deleted on the Tasks page.
    actions.onNew(ACADEMIC_SECTION, courseSubsection(state, course));
  };
  const row = (task: Task) => <TaskRow key={task.id} task={task} today={today} actions={actions} />;

  return (
    <section className="ws-panel">
      <div className="ac-panel-head">
        <h3>{open.length} open</h3>
        <button className="ws-button ws-primary" onClick={addTask}><Plus size={15} />New task</button>
      </div>
      {open.length > 0 && <ul className="ac-tasks">{open.map(row)}</ul>}
      {!tasks.length && (
        <div className="ac-empty">
          <CheckSquare size={26} />
          <strong>No tasks for {course.code || course.name} yet</strong>
          <p>Tasks you add here also appear under Academic on your Tasks page, and tasks added there appear here.</p>
        </div>
      )}
      {tasks.length > 0 && !open.length && <p className="ac-hint">Everything for this class is done.</p>}
      {done.length > 0 && (
        <>
          <button className="ws-text-button ac-tasks-toggle" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            {showDone ? "Hide" : "Show"} {done.length} completed
          </button>
          {showDone && <ul className="ac-tasks">{done.map(row)}</ul>}
        </>
      )}
    </section>
  );
}

function TaskRow({ task, today, actions }: { task: Task; today: string; actions: TaskActions }) {
  const done = isTaskDone(task);
  const overdue = !done && !!task.dueDate && task.dueDate < today;
  const finished = task.subtasks?.filter((s) => s.completed).length || 0;
  const details = [
    task.status === "in_progress" ? "In progress" : "",
    task.priority === "urgent" || task.priority === "high" ? `${task.priority[0].toUpperCase()}${task.priority.slice(1)} priority` : "",
    task.subtasks?.length ? `${finished} of ${task.subtasks.length} steps` : "",
  ].filter(Boolean).join(" · ");
  return (
    <li className={`ac-task${done ? " is-done" : ""}`}>
      <button role="checkbox" aria-checked={done} aria-label={task.title} className="ac-task-check" onClick={() => actions.onToggle(task.id)}>
        {done && <Check size={13} />}
      </button>
      <button className="ac-task-open" onClick={() => actions.onEdit(task)}>
        <span className="ac-task-title">{task.title}</span>
        {details && <small>{details}</small>}
      </button>
      <span className={`ac-task-due${overdue ? " is-overdue" : ""}`}>{dueLabel(task, today)}</span>
    </li>
  );
}

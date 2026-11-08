import { DialogBackdrop } from "./workspace/DialogBackdrop";
import React, { useEffect, useId, useRef, useState } from "react";
import { Task, TaskStatus } from "../types";
import { normalizeTask } from "../utils/taskState";
import { X, Trash2 } from "lucide-react";
import { formatTime } from "../utils/events";
import { getLocalDateString } from "../utils/habitStreaks";
import { CustomDatePicker } from "./CustomDatePicker";

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  sections: string[];
  subsections: Record<string, string[]>;
  defaultSection?: string;
  defaultSubsection?: string;
  defaultDueDate?: string;
  onSave: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onAddSubsection?: (section: string, subsectionName: string) => void;
  openRouterKey?: string;
  selectedModel?: string;
  onOpenSettings?: () => void;
}

const STATUSES: Array<{ id: TaskStatus; label: string }> = [
  { id: "not_started", label: "Not started" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Done" },
];
const PRIORITIES: Array<{ id: Task["priority"]; label: string }> = [
  { id: "urgent", label: "Urgent" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];
// Half-hour slots plus end of day, which is how most deadlines are written.
const TIME_OPTIONS = [
  ...Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`),
  "23:59",
];

const dateFromToday = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return getLocalDateString(d);
};

/** A single-choice row of buttons that behaves as a radio group for keyboard and screen reader users. */
function ChoiceGroup<T extends string>({ label, options, value, onChange, dot }: {
  label: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  dot: string;
}) {
  const labelId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div className="task-field">
      <span id={labelId} className="task-label">{label}</span>
      <div role="radiogroup" aria-labelledby={labelId} className="task-choice">
        {options.map((option, index) => (
          <button
            key={option.id}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            tabIndex={value === option.id ? 0 : -1}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => move(event, index)}
          >
            <span aria-hidden="true" className={`task-dot ${dot}-${option.id}`} />
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  onClose,
  task,
  sections,
  subsections,
  defaultSection,
  defaultSubsection,
  defaultDueDate,
  onSave,
  onDelete,
  onAddSubsection,
}) => {
  const today = getLocalDateString();
  const ids = useId();
  const field = (name: string) => `${ids}-${name}`;

  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState(false);
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(today);
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [status, setStatus] = useState<TaskStatus>("not_started");
  const [section, setSection] = useState("");
  const [subsection, setSubsection] = useState("");
  const [addingSub, setAddingSub] = useState(false);
  const [newSub, setNewSub] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form whenever the dialog opens or targets another task.
  useEffect(() => {
    if (!isOpen) return;
    const sec = task?.section || defaultSection || sections[0] || "Academic";
    setTitle(task?.title || "");
    setDescription(task?.description || "");
    setDueDate(task ? task.dueDate || "" : defaultDueDate || today);
    setDueTime(task?.dueTime || "");
    setPriority(task?.priority || "medium");
    setStatus(task?.status || (task?.completed ? "completed" : "not_started"));
    setSection(sec);
    setSubsection(task?.subsection || defaultSubsection || subsections[sec]?.[0] || "General");
    setTitleError(false);
    setAddingSub(false);
    setNewSub("");
    setConfirmDelete(false);
    // Section lists change identity on unrelated edits; only reopen or retarget resets the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, task?.id]);

  useEffect(() => {
    if (!confirmDelete) return;
    const timer = window.setTimeout(() => setConfirmDelete(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);

  if (!isOpen) return null;

  const availableSubs = subsections[section] || ["General"];
  const subOptions = availableSubs.includes(subsection) ? availableSubs : [...availableSubs, subsection];
  const timeOptions = dueTime && !TIME_OPTIONS.includes(dueTime) ? [...TIME_OPTIONS, dueTime].sort() : TIME_OPTIONS;

  const changeSection = (next: string) => {
    setSection(next);
    setSubsection(subsections[next]?.[0] || "General");
  };

  const addSubsection = () => {
    const name = newSub.trim().replace(/\s+/g, " ");
    if (!name) return;
    const existing = availableSubs.find((s) => s.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!existing) onAddSubsection?.(section, name);
    setSubsection(existing || name);
    setNewSub("");
    setAddingSub(false);
  };

  const save = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!title.trim()) {
      setTitleError(true);
      document.getElementById(field("title"))?.focus();
      return;
    }
    onSave(normalizeTask({
      id: task?.id || `task-${Date.now()}`,
      title: title.trim(),
      description: description.trim() || undefined,
      dueDate,
      dueTime: dueDate && dueTime ? dueTime : undefined,
      priority,
      section,
      subsection,
      status,
      subtasks: task?.subtasks || [],
    }));
    onClose();
  };

  const quickDates = [
    { label: "Today", date: dateFromToday(0) },
    { label: "Tomorrow", date: dateFromToday(1) },
    { label: "Next week", date: dateFromToday(7) },
  ];

  return (
    <DialogBackdrop
      onClose={onClose}
      label={task ? "Edit task" : "New task"}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          save();
        }
      }}
    >
      <div className="workspace-dialog task-dialog">
        <header className="task-dialog-head">
          <h2>{task ? "Edit task" : "New task"}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="task-icon-button">
            <X aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={save} noValidate className="task-form">
          <div className="task-form-body">
            <div className="task-field">
              <label htmlFor={field("title")} className="task-label">Title</label>
              <input
                id={field("title")}
                type="text"
                autoFocus
                autoComplete="off"
                placeholder="What needs doing"
                value={title}
                aria-invalid={titleError || undefined}
                aria-describedby={titleError ? field("title-error") : undefined}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (titleError && e.target.value.trim()) setTitleError(false);
                }}
                className="task-input task-input-title"
              />
              {titleError && <p id={field("title-error")} className="task-error" role="alert">Add a title to save this task</p>}
            </div>

            <div className="task-field">
              <label htmlFor={field("notes")} className="task-label">Notes</label>
              <textarea
                id={field("notes")}
                rows={3}
                placeholder="Links, requirements, anything worth remembering"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="task-input task-textarea"
              />
            </div>

            <div className="task-pair">
              <div className="task-field">
                <label htmlFor={field("section")} className="task-label">Section</label>
                <select id={field("section")} value={section} onChange={(e) => changeSection(e.target.value)} className="task-input task-picker">
                  {sections.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="task-field">
                <div className="task-label-row">
                  <label htmlFor={field(addingSub ? "new-sub" : "subsection")} className="task-label">Subsection</label>
                  <button type="button" className="task-link" onClick={() => { setAddingSub(!addingSub); setNewSub(""); }}>
                    {addingSub ? "Cancel" : "New"}
                  </button>
                </div>
                {addingSub ? (
                  <div className="task-inline-add">
                    <input
                      id={field("new-sub")}
                      type="text"
                      autoFocus
                      placeholder="Name"
                      value={newSub}
                      onChange={(e) => setNewSub(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); addSubsection(); }
                        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAddingSub(false); }
                      }}
                      className="task-input"
                    />
                    <button type="button" onClick={addSubsection} disabled={!newSub.trim()} className="task-button task-button-secondary">Add</button>
                  </div>
                ) : (
                  <select id={field("subsection")} value={subsection} onChange={(e) => setSubsection(e.target.value)} className="task-input task-picker">
                    {subOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
            </div>

            <ChoiceGroup label="Status" options={STATUSES} value={status} onChange={setStatus} dot="status" />
            <ChoiceGroup label="Priority" options={PRIORITIES} value={priority} onChange={setPriority} dot="priority" />

            <div className="task-pair">
              <div className="task-field">
                <label htmlFor={field("date")} className="task-label">Due date</label>
                <CustomDatePicker id={field("date")} value={dueDate} onChange={(d) => { setDueDate(d); if (!d) setDueTime(""); }} placeholder="No due date" />
              </div>
              <div className="task-field">
                <label htmlFor={field("time")} className="task-label">Time</label>
                <select
                  id={field("time")}
                  value={dueTime}
                  disabled={!dueDate}
                  aria-describedby={!dueDate ? field("time-hint") : undefined}
                  onChange={(e) => setDueTime(e.target.value)}
                  className="task-input task-picker"
                >
                  <option value="">Any time</option>
                  {timeOptions.map((t) => <option key={t} value={t}>{formatTime(t)}</option>)}
                </select>
                {!dueDate && <span id={field("time-hint")} className="sr-only">Pick a due date to set a time</span>}
              </div>
            </div>

            <div className="task-quick" role="group" aria-label="Quick due dates">
              {quickDates.map((q) => (
                <button key={q.label} type="button" aria-pressed={dueDate === q.date} onClick={() => setDueDate(q.date)}>{q.label}</button>
              ))}
              <button type="button" aria-pressed={!dueDate} onClick={() => { setDueDate(""); setDueTime(""); }}>No date</button>
            </div>
          </div>

          <footer className="task-dialog-foot">
            {task && onDelete ? (
              <button
                type="button"
                className={`task-button task-button-danger${confirmDelete ? " is-confirming" : ""}`}
                onClick={() => {
                  if (!confirmDelete) return setConfirmDelete(true);
                  onDelete(task.id);
                  onClose();
                }}
              >
                <Trash2 aria-hidden="true" />
                {confirmDelete ? "Confirm delete" : "Delete"}
              </button>
            ) : <span />}
            <div className="task-dialog-actions">
              <span className="task-shortcut" aria-hidden="true"><kbd>⌘</kbd><kbd>↵</kbd></span>
              <button type="button" onClick={onClose} className="task-button task-button-ghost">Cancel</button>
              <button type="submit" className="task-button task-button-primary">{task ? "Save" : "Add task"}</button>
            </div>
          </footer>
        </form>
      </div>
    </DialogBackdrop>
  );
};

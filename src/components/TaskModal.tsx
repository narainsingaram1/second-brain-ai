import { DialogBackdrop } from "./workspace/DialogBackdrop";
import React, { useState, useEffect } from "react";
import { Task, TaskStatus } from "../types";
import { normalizeTask } from "../utils/taskState";
import { X, Trash2, Clock } from "lucide-react";
import { formatTime } from "../utils/events";
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
  const todayStr = new Date().toISOString().split("T")[0];

  const initialSec = task?.section || defaultSection || sections[0] || "Academic";
  const initialSubs = subsections[initialSec] || ["General"];
  const initialSub = task?.subsection || defaultSubsection || initialSubs[0] || "General";

  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [dueDate, setDueDate] = useState(task?.dueDate || defaultDueDate || todayStr);
  const [dueTime, setDueTime] = useState(task?.dueTime || "");
  const [priority, setPriority] = useState<Task["priority"]>(task?.priority || "medium");
  const [status, setStatus] = useState<TaskStatus>(
    task?.status || (task?.completed ? "completed" : "not_started")
  );
  const [section, setSection] = useState<string>(initialSec);
  const [subsection, setSubsection] = useState<string>(initialSub);
  const [isAddingNewSub, setIsAddingNewSub] = useState(false);
  const [customSubName, setCustomSubName] = useState("");

  // Synchronize state when opening or task changes
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || "");
      setDueDate(task.dueDate || todayStr);
      setDueTime(task.dueTime || "");
      setPriority(task.priority || "medium");
      setStatus(task.status || (task.completed ? "completed" : "not_started"));
      setSection(task.section || defaultSection || sections[0] || "Academic");
      setSubsection(task.subsection || defaultSubsection || "General");
    } else {
      const sec = defaultSection || sections[0] || "Academic";
      const subs = subsections[sec] || ["General"];
      setTitle("");
      setDescription("");
      setDueDate(defaultDueDate || todayStr);
      setDueTime("");
      setPriority("medium");
      setStatus("not_started");
      setSection(sec);
      setSubsection(defaultSubsection || subs[0] || "General");
    }
    setIsAddingNewSub(false);
    setCustomSubName("");
  }, [task, defaultSection, defaultSubsection, defaultDueDate, sections, subsections, isOpen, todayStr]);

  if (!isOpen) return null;

  const currentAvailableSubs = subsections[section] || ["General"];

  const handleSectionChange = (newSec: string) => {
    setSection(newSec);
    const available = subsections[newSec] || ["General"];
    setSubsection(available[0] || "General");
  };

  const handleCreateNewSub = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customSubName.trim()) return;
    if (onAddSubsection) {
      onAddSubsection(section, customSubName.trim());
    }
    setSubsection(customSubName.trim());
    setCustomSubName("");
    setIsAddingNewSub(false);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const updatedTask = normalizeTask({
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
    });

    onSave(updatedTask);
    onClose();
  };

  const setPresetDate = (daysAhead: number) => {
    const d = new Date(Date.now() + daysAhead * 86400000);
    setDueDate(d.toISOString().split("T")[0]);
  };

  return (
    <DialogBackdrop onClose={onClose} label="Task details" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in">
      <div className="workspace-dialog bg-panel rounded-3xl border border-line shadow-2xl w-full max-w-lg overflow-visible flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="font-extrabold text-base tracking-tight text-ink">
              {task ? "Edit Task" : "New Task"}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {task ? "Update task details and due date" : "Add an actionable item to your second brain"}
            </p>
          </div>
          <button aria-label="Close dialog" onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Title *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. CS 1332 Homework or Job Application"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-ink px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-white transition-all"
            />
          </div>

          {/* Description / Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Notes
            </label>
            <textarea
              rows={2}
              placeholder="Optional notes or details..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs text-ink p-3 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-white resize-none transition-all"
            />
          </div>

          {/* Section & Subsection Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Section
              </label>
              <select
                value={section}
                onChange={(e) => handleSectionChange(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none cursor-pointer"
              >
                {sections.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Subsection
                </label>
                <button
                  type="button"
                  onClick={() => setIsAddingNewSub(!isAddingNewSub)}
                  className="text-[11px] text-blue-600 dark:text-blue-400 font-bold hover:underline"
                >
                  {isAddingNewSub ? "Select" : "+ New"}
                </button>
              </div>

              {isAddingNewSub ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    placeholder="New sub name..."
                    value={customSubName}
                    onChange={(e) => setCustomSubName(e.target.value)}
                    className="w-full text-xs bg-slate-50 dark:bg-slate-800 px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCreateNewSub}
                    className="px-2.5 py-2 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-bold shrink-0 hover:bg-slate-800"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <select
                  value={subsection}
                  onChange={(e) => setSubsection(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none cursor-pointer"
                >
                  {currentAvailableSubs.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Progress / Status Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              Progress Status
            </label>
            <div className="grid grid-cols-3 gap-2 bg-raised p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setStatus("not_started")}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  status === "not_started"
                    ? "bg-white dark:bg-slate-700 text-ink shadow-xs"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                <span>⚪</span>
                <span>Not Started</span>
              </button>
              <button
                type="button"
                onClick={() => setStatus("in_progress")}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  status === "in_progress"
                    ? "bg-blue-600 text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                <span>🟡</span>
                <span>In Progress</span>
              </button>
              <button
                type="button"
                onClick={() => setStatus("completed")}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  status === "completed"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                <span>🟢</span>
                <span>Complete</span>
              </button>
            </div>
          </div>

          {/* Priority & Due Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Due Date
              </label>
              <CustomDatePicker
                value={dueDate}
                onChange={(newDate) => setDueDate(newDate)}
                placeholder="Choose due date"
              />
            </div>
          </div>

          {/* Due Time */}
          <div>
            <label htmlFor="task-due-time" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Due Time <span className="font-semibold text-slate-400">(optional)</span>
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Clock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="task-due-time"
                  type="time"
                  value={dueTime}
                  disabled={!dueDate}
                  onChange={(e) => setDueTime(e.target.value)}
                  className="bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-800 dark:text-slate-200 pl-8 pr-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-white disabled:opacity-50"
                />
              </div>
              {["09:00", "12:00", "17:00", "23:59"].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={!dueDate}
                  aria-pressed={dueTime === preset}
                  onClick={() => setDueTime(preset)}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors disabled:opacity-50 ${
                    dueTime === preset
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                      : "bg-raised hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {formatTime(preset)}
                </button>
              ))}
              {dueTime && (
                <button
                  type="button"
                  onClick={() => setDueTime("")}
                  className="text-[11px] font-semibold text-slate-400 hover:text-rose-500 transition-colors"
                >
                  No time
                </button>
              )}
            </div>
          </div>

          {/* Quick Date Presets */}
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-[11px] text-slate-400 font-semibold">Quick pick:</span>
            <button
              type="button"
              onClick={() => setPresetDate(0)}
              className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-raised hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setPresetDate(1)}
              className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-raised hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
            >
              Tomorrow
            </button>
            <button
              type="button"
              onClick={() => setPresetDate(7)}
              className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-raised hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
            >
              In 7 Days
            </button>
            {dueDate && (
              <button
                type="button"
                onClick={() => { setDueDate(""); setDueTime(""); }}
                className="text-[11px] font-semibold text-slate-400 hover:text-rose-500 ml-auto transition-colors"
              >
                Clear date
              </button>
            )}
          </div>

          {/* Footer */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            {task && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  onDelete(task.id);
                  onClose();
                }}
                className="text-xs font-bold text-rose-500 hover:text-rose-600 flex items-center gap-1 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Task</span>
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-full text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-full bg-slate-950 dark:bg-white text-white dark:text-slate-950 text-xs font-bold shadow-sm hover:opacity-90 active:scale-95 transition-all"
              >
                Save Task
              </button>
            </div>
          </div>
        </form>
      </div>
    </DialogBackdrop>
  );
};

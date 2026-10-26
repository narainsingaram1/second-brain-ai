import React, { useState, useEffect } from "react";
import { Task } from "../types";
import { X, Sparkles, Check, Trash2, Plus, FolderTree } from "lucide-react";
import { breakdownTaskWithAI } from "../services/openrouter";

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  sections: string[];
  subsections: Record<string, string[]>;
  defaultSection?: string;
  defaultSubsection?: string;
  onSave: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onAddSubsection?: (section: string, subsectionName: string) => void;
  openRouterKey: string;
  selectedModel: string;
  onOpenSettings: () => void;
}

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  onClose,
  task,
  sections,
  subsections,
  defaultSection,
  defaultSubsection,
  onSave,
  onDelete,
  onAddSubsection,
  openRouterKey,
  selectedModel,
  onOpenSettings,
}) => {
  const todayStr = new Date().toISOString().split("T")[0];

  const initialSec = task?.section || defaultSection || sections[0] || "Academic";
  const initialSubs = subsections[initialSec] || ["General"];
  const initialSub = task?.subsection || defaultSubsection || initialSubs[0] || "General";

  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [dueDate, setDueDate] = useState(task?.dueDate || todayStr);
  const [priority, setPriority] = useState<Task["priority"]>(task?.priority || "medium");
  const [section, setSection] = useState<string>(initialSec);
  const [subsection, setSubsection] = useState<string>(initialSub);
  const [subtasks, setSubtasks] = useState<{ id: string; title: string; completed: boolean }[]>(
    task?.subtasks || []
  );
  const [newSubtask, setNewSubtask] = useState("");
  const [isDecomposing, setIsDecomposing] = useState(false);
  const [isAddingNewSub, setIsAddingNewSub] = useState(false);
  const [customSubName, setCustomSubName] = useState("");

  // Synchronize state when opening or task changes
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || "");
      setDueDate(task.dueDate || todayStr);
      setPriority(task.priority || "medium");
      setSection(task.section || defaultSection || sections[0] || "Academic");
      setSubsection(task.subsection || defaultSubsection || "General");
      setSubtasks(task.subtasks || []);
    } else {
      const sec = defaultSection || sections[0] || "Academic";
      const subs = subsections[sec] || ["General"];
      setTitle("");
      setDescription("");
      setDueDate(todayStr);
      setPriority("medium");
      setSection(sec);
      setSubsection(defaultSubsection || subs[0] || "General");
      setSubtasks([]);
    }
    setIsAddingNewSub(false);
    setCustomSubName("");
  }, [task, defaultSection, defaultSubsection, sections, subsections, isOpen]);

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

    const updatedTask: Task = {
      id: task?.id || `task-${Date.now()}`,
      title: title.trim(),
      description: description.trim() || undefined,
      dueDate,
      priority,
      section,
      subsection,
      completed: task?.completed || false,
      subtasks,
    };

    onSave(updatedTask);
    onClose();
  };

  const handleAIDecompose = async () => {
    if (!title.trim()) return;
    if (!openRouterKey) {
      onOpenSettings();
      return;
    }

    setIsDecomposing(true);
    try {
      const generated = await breakdownTaskWithAI(title, openRouterKey, selectedModel);
      const newSubs = generated.map((t, idx) => ({
        id: `sub-${Date.now()}-${idx}`,
        title: t,
        completed: false,
      }));
      setSubtasks((prev) => [...prev, ...newSubs]);
    } catch (err: any) {
      alert("AI breakdown error: " + err.message);
    } finally {
      setIsDecomposing(false);
    }
  };

  const handleAddSubtask = () => {
    if (!newSubtask.trim()) return;
    setSubtasks((prev) => [
      ...prev,
      { id: `sub-${Date.now()}`, title: newSubtask.trim(), completed: false },
    ]);
    setNewSubtask("");
  };

  const toggleSubtask = (id: string) => {
    setSubtasks((prev) =>
      prev.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s))
    );
  };

  const removeSubtask = (id: string) => {
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
  };

  const setPresetDate = (daysAhead: number) => {
    const d = new Date(Date.now() + daysAhead * 86400000);
    setDueDate(d.toISOString().split("T")[0]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-[#141721] rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
            {task ? "Edit Task" : "New Task"}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto max-h-[540px]">
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
              className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-900 dark:text-slate-100 px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-white"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Notes
            </label>
            <textarea
              rows={2}
              placeholder="Optional notes or details..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs text-slate-900 dark:text-slate-100 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-white resize-none"
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
                className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
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
                  className="text-[10px] text-blue-600 dark:text-blue-400 font-bold hover:underline"
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
                    className="w-full text-xs bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCreateNewSub}
                    className="p-1.5 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-bold shrink-0"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <select
                  value={subsection}
                  onChange={(e) => setSubsection(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
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

          {/* Priority & Due Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
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
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs font-semibold text-slate-800 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
              />
            </div>
          </div>

          {/* Date presets */}
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-[10px] text-slate-400 font-semibold">Preset:</span>
            <button
              type="button"
              onClick={() => setPresetDate(0)}
              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setPresetDate(1)}
              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300"
            >
              Tomorrow
            </button>
            <button
              type="button"
              onClick={() => setPresetDate(7)}
              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300"
            >
              In 7 Days
            </button>
          </div>

          {/* Subtasks */}
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5 text-purple-500" />
                Action Steps ({subtasks.length})
              </span>
              <button
                type="button"
                onClick={handleAIDecompose}
                disabled={isDecomposing || !title}
                className="flex items-center gap-1 text-[11px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 px-2.5 py-1 rounded-full border border-purple-200 dark:border-purple-800/60 transition-colors disabled:opacity-40"
              >
                <Sparkles className="w-3 h-3" />
                <span>{isDecomposing ? "Breaking down..." : "AI Breakdown"}</span>
              </button>
            </div>

            <div className="space-y-1.5">
              {subtasks.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between bg-slate-50 dark:bg-slate-900/40 p-2 rounded-xl text-xs"
                >
                  <div
                    onClick={() => toggleSubtask(sub.id)}
                    className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
                  >
                    <div
                      className={`w-4 h-4 rounded-md flex items-center justify-center transition-colors ${
                        sub.completed ? "bg-emerald-500 text-white" : "border border-slate-300"
                      }`}
                    >
                      {sub.completed && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                    <span
                      className={`truncate ${
                        sub.completed ? "line-through text-slate-400" : "text-slate-800 dark:text-slate-200"
                      }`}
                    >
                      {sub.title}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSubtask(sub.id)}
                    className="text-slate-400 hover:text-rose-500 p-1"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}

              <div className="flex items-center gap-1 pt-1">
                <input
                  type="text"
                  placeholder="Add manual step..."
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddSubtask())}
                  className="flex-1 text-xs bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddSubtask}
                  className="p-1.5 rounded-full bg-slate-900 text-white hover:bg-slate-800"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            {task && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  onDelete(task.id);
                  onClose();
                }}
                className="text-xs font-bold text-rose-500 hover:underline"
              >
                Delete Task
              </button>
            ) : (
              <div></div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-full text-xs font-semibold text-slate-500 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-full bg-slate-950 dark:bg-white text-white dark:text-slate-950 text-xs font-bold shadow-sm hover:scale-105 active:scale-95 transition-all"
              >
                Save Task
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

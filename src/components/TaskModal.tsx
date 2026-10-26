import React, { useState } from "react";
import { Task, LifeDomain } from "../types";
import { X, Calendar, Sparkles, Check, Trash2, Plus, FolderTree } from "lucide-react";
import { breakdownTaskWithAI } from "../services/openrouter";

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  onSave: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  defaultStage?: Task["stage"];
  openRouterKey: string;
  selectedModel: string;
  onOpenSettings: () => void;
}

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  onClose,
  task,
  onSave,
  onDelete,
  defaultStage = "intake",
  openRouterKey,
  selectedModel,
  onOpenSettings,
}) => {
  const todayStr = new Date().toISOString().split("T")[0];

  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [dueDate, setDueDate] = useState(task?.dueDate || todayStr);
  const [priority, setPriority] = useState<Task["priority"]>(task?.priority || "medium");
  const [domain, setDomain] = useState<LifeDomain>(task?.domain || "career");
  const [stage, setStage] = useState<Task["stage"]>(task?.stage || defaultStage);
  const [subtasks, setSubtasks] = useState<{ id: string; title: string; completed: boolean }[]>(
    task?.subtasks || []
  );
  const [newSubtask, setNewSubtask] = useState("");
  const [isDecomposing, setIsDecomposing] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const updatedTask: Task = {
      id: task?.id || `task-${Date.now()}`,
      title: title.trim(),
      description: description.trim() || undefined,
      dueDate,
      priority,
      domain,
      stage,
      completed: task?.completed || false,
      subtasks,
      assignedAvatar: task?.assignedAvatar,
      assignedName: task?.assignedName,
      connectedTo: task?.connectedTo,
      isFocusPill: task?.isFocusPill,
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
      alert("AI decomposition error: " + err.message);
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

  // Preset Date buttons
  const setPresetDate = (daysAhead: number) => {
    const d = new Date(Date.now() + daysAhead * 86400000);
    setDueDate(d.toISOString().split("T")[0]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-[#141721] rounded-4xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <h3 className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
            {task ? "Edit Task Deliverable" : "Create New Task"}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto max-h-[520px]">
          {/* Title */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Task Title *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Design Architecture Review & Benchmark"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-100 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Description & Context
            </label>
            <textarea
              rows={2}
              placeholder="Optional notes, requirements or acceptance criteria..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-100 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Due Date & Quick Presets */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-blue-500" />
                Due Date
              </label>
              <div className="flex items-center gap-1">
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
                  Next Week
                </button>
              </div>
            </div>
            <input
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 px-4 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
            />
          </div>

          {/* Priority & Domain & Stage Grid */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
              >
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Life Domain
              </label>
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value as any)}
                className="w-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
              >
                <option value="career">Career</option>
                <option value="health">Health</option>
                <option value="mindset">Mindset</option>
                <option value="learning">Learning</option>
                <option value="ai">AI Agent</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Journey Stage
              </label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as any)}
                className="w-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
              >
                <option value="intake">Intake</option>
                <option value="execution">Execution</option>
                <option value="resolution">Resolution</option>
                <option value="next-actions">Next Actions</option>
              </select>
            </div>
          </div>

          {/* AI Subtask Decomposition */}
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5 text-purple-500" />
                Action Subtasks ({subtasks.length})
              </span>
              <button
                type="button"
                onClick={handleAIDecompose}
                disabled={isDecomposing || !title}
                className="flex items-center gap-1 text-[11px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 px-2.5 py-1 rounded-full border border-purple-200 dark:border-purple-800/60 transition-colors disabled:opacity-40"
              >
                <Sparkles className="w-3 h-3" />
                <span>{isDecomposing ? "Breaking down..." : "AI Auto-Breakdown"}</span>
              </button>
            </div>

            {/* Subtask list */}
            <div className="space-y-1.5">
              {subtasks.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 p-2 rounded-xl text-xs"
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
                  className="flex-1 text-xs bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddSubtask}
                  className="p-1.5 rounded-full bg-slate-800 text-white hover:bg-slate-900"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
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
                className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-full bg-[#0d0f14] dark:bg-white text-white dark:text-slate-900 text-xs font-bold shadow-md hover:scale-105 active:scale-95 transition-all"
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

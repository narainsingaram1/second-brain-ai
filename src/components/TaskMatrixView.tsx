import React, { useState } from "react";
import { Task } from "../types";
import {
  Calendar,
  Plus,
  Check,
  Trash2,
  FolderPlus,
  FolderMinus,
  Pencil,
  Folder,
  X,
} from "lucide-react";
import confetti from "canvas-confetti";

interface TaskMatrixViewProps {
  tasks: Task[];
  sections: string[];
  subsections: Record<string, string[]>;
  onToggleTask: (taskId: string) => void;
  onStatusChange?: (taskId: string, status: Task["status"]) => void;
  onAddTask: (section?: string, subsection?: string) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onAIBreakdown?: (task: Task) => void;
  onAddSection: (sectionName: string) => void;
  onDeleteSection: (sectionName: string) => void;
  onAddSubsection: (section: string, subsectionName: string) => void;
  onDeleteSubsection: (section: string, subsectionName: string) => void;
  onRenameSubsection: (section: string, oldName: string, newName: string) => void;
  onMoveTask: (taskId: string, targetSection: string, targetSubsection?: string) => void;
}

export const TaskMatrixView: React.FC<TaskMatrixViewProps> = ({
  tasks,
  sections,
  subsections,
  onToggleTask,
  onStatusChange,
  onAddTask,
  onEditTask,
  onDeleteTask,
  onAddSection,
  onDeleteSection,
  onAddSubsection,
  onDeleteSubsection,
  onRenameSubsection,
  onMoveTask,
}) => {
  const [filterMode, setFilterMode] = useState<"all" | "in_progress" | "today" | "upcoming" | "completed">("all");
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [activeAddingSubFor, setActiveAddingSubFor] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState("");

  // Subsection inline rename state: key is `${section}::${subName}`
  const [editingSubKey, setEditingSubKey] = useState<string | null>(null);
  const [editingSubValue, setEditingSubValue] = useState("");

  const todayStr = new Date().toISOString().split("T")[0];

  const handleCreateSection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSectionName.trim()) return;
    onAddSection(newSectionName.trim());
    setNewSectionName("");
    setIsAddingSection(false);
  };

  const handleCreateSubsection = (section: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubName.trim()) return;
    onAddSubsection(section, newSubName.trim());
    setNewSubName("");
    setActiveAddingSubFor(null);
  };

  const handleSaveRename = (section: string, oldSub: string) => {
    const trimmed = editingSubValue.trim();
    if (trimmed && trimmed !== oldSub) {
      onRenameSubsection(section, oldSub, trimmed);
    }
    setEditingSubKey(null);
  };

  const handleCycleStatus = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    const current = task.status || (task.completed ? "completed" : "not_started");
    let next: Task["status"];
    if (current === "not_started") {
      next = "in_progress";
    } else if (current === "in_progress") {
      next = "completed";
      confetti({
        particleCount: 30,
        spread: 50,
        origin: { y: 0.6 },
        colors: ["#10b981", "#3b82f6", "#f59e0b"],
      });
    } else {
      next = "not_started";
    }

    if (onStatusChange) {
      onStatusChange(task.id, next);
    } else {
      onToggleTask(task.id);
    }
  };

  const filterTask = (task: Task) => {
    const status = task.status || (task.completed ? "completed" : "not_started");
    if (filterMode === "completed") return status === "completed";
    if (filterMode === "in_progress") return status === "in_progress";
    if (status === "completed") return false;
    if (filterMode === "today") return task.dueDate === todayStr;
    if (filterMode === "upcoming") return task.dueDate > todayStr;
    return true;
  };

  const pendingCount = tasks.filter((t) => !t.completed).length;
  const inProgressCount = tasks.filter(
    (t) => (t.status || (t.completed ? "completed" : "not_started")) === "in_progress"
  ).length;

  return (
    <div className="w-full max-w-5xl mx-auto space-y-8 animate-fade-in pb-16">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/70 dark:border-slate-800">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Tasks
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {pendingCount} active ({inProgressCount} in progress) across {sections.length} core life areas
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAddingSection(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors shadow-2xs"
          >
            <FolderPlus className="w-3.5 h-3.5 text-slate-500" />
            <span>New Section</span>
          </button>

          <button
            onClick={() => onAddTask(sections[0] || "Academic")}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-950 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-100 dark:text-slate-950 text-xs font-semibold shadow-xs transition-all hover:scale-102 active:scale-98"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Task</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {[
          { id: "all", label: "All Tasks", count: pendingCount },
          { id: "in_progress", label: "In Progress", count: inProgressCount },
          { id: "today", label: "Due Today" },
          { id: "upcoming", label: "Upcoming" },
          { id: "completed", label: "Completed" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilterMode(tab.id as any)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
              filterMode === tab.id
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-xs"
                : "text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60"
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  filterMode === tab.id
                    ? "bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900"
                    : "bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Add Section Form */}
      {isAddingSection && (
        <form
          onSubmit={handleCreateSection}
          className="bg-slate-50 dark:bg-[#141721] p-4 rounded-3xl border border-slate-200 dark:border-slate-800 flex items-center gap-3 animate-fade-in shadow-xs"
        >
          <input
            type="text"
            autoFocus
            placeholder="Enter section name (e.g. Side Projects, Thesis, Personal)..."
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            className="flex-1 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-100 px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-slate-950 text-xs font-bold hover:opacity-90"
          >
            Create Section
          </button>
          <button
            type="button"
            onClick={() => setIsAddingSection(false)}
            className="px-3 py-2 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Sections and Subsections */}
      <div className="space-y-8">
        {sections.map((section) => {
          const sectionSubs = subsections[section] || ["General"];
          const sectionTasks = tasks
            .filter((t) => (t.section || "Academic") === section)
            .filter(filterTask);

          return (
            <div
              key={section}
              className="bg-slate-50/60 dark:bg-[#12151e] rounded-3xl p-6 sm:p-7 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-6"
            >
              {/* Main Section Header */}
              <div className="flex items-center justify-between pb-3.5 border-b border-slate-200/80 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                    {section}
                  </h2>
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 px-2.5 py-0.5 rounded-full shadow-2xs">
                    {sectionTasks.length} {sectionTasks.length === 1 ? "task" : "tasks"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Add Subsection button */}
                  <button
                    onClick={() => {
                      setActiveAddingSubFor(section);
                      setNewSubName("");
                    }}
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/60 px-3 py-1.5 rounded-xl transition-all shadow-2xs"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-blue-500" />
                    <span>Subsection</span>
                  </button>

                  {/* Add Task button */}
                  <button
                    onClick={() => onAddTask(section, sectionSubs[0])}
                    className="flex items-center gap-1.5 text-xs font-bold text-white bg-slate-950 dark:bg-white dark:text-slate-950 px-3 py-1.5 rounded-xl hover:opacity-90 transition-all shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Task</span>
                  </button>

                  {/* Delete Section button */}
                  {sections.length > 1 && (
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `Delete the "${section}" section? All tasks inside will be moved to another section.`
                          )
                        ) {
                          onDeleteSection(section);
                        }
                      }}
                      title="Delete section"
                      className="p-1.5 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors ml-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Add Subsection Inline Form */}
              {activeAddingSubFor === section && (
                <form
                  onSubmit={(e) => handleCreateSubsection(section, e)}
                  className="bg-white dark:bg-slate-900/80 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center gap-2 animate-fade-in shadow-xs"
                >
                  <input
                    type="text"
                    autoFocus
                    placeholder={`New subsection in ${section} (e.g. CS 1332, Workouts, Taxes)...`}
                    value={newSubName}
                    onChange={(e) => setNewSubName(e.target.value)}
                    className="flex-1 bg-slate-50 dark:bg-slate-800 text-xs font-semibold px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-950 text-xs font-bold hover:opacity-90"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveAddingSubFor(null)}
                    className="px-3 py-2 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    Cancel
                  </button>
                </form>
              )}

              {/* Subsections Stack */}
              <div className="space-y-6">
                {sectionSubs.map((sub) => {
                  const subTasks = sectionTasks.filter(
                    (t) => (t.subsection || "General") === sub
                  );
                  const subKey = `${section}::${sub}`;
                  const isEditingThisSub = editingSubKey === subKey;

                  return (
                    <div
                      key={sub}
                      className="space-y-3 bg-white/70 dark:bg-[#151923]/60 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800/80 shadow-2xs"
                    >
                      {/* Subsection Sub-header */}
                      <div className="flex items-center justify-between px-1">
                        {isEditingThisSub ? (
                          /* Inline Rename Form */
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              handleSaveRename(section, sub);
                            }}
                            className="flex items-center gap-1.5"
                          >
                            <input
                              type="text"
                              autoFocus
                              value={editingSubValue}
                              onChange={(e) => setEditingSubValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setEditingSubKey(null);
                              }}
                              className="text-xs font-bold px-2.5 py-1 rounded-xl border border-blue-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none shadow-xs"
                            />
                            <button
                              type="submit"
                              title="Save name"
                              className="p-1 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                            >
                              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSubKey(null)}
                              title="Cancel"
                              className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </form>
                        ) : (
                          /* Display Subsection Header with Rename Icon */
                          <div className="flex items-center gap-2 group/sub">
                            <Folder className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                            <h3
                              onDoubleClick={() => {
                                setEditingSubKey(subKey);
                                setEditingSubValue(sub);
                              }}
                              title="Double-click to rename"
                              className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white cursor-pointer select-none"
                            >
                              {sub}
                            </h3>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-full">
                              {subTasks.length}
                            </span>

                            {/* Rename Action Button */}
                            <button
                              onClick={() => {
                                setEditingSubKey(subKey);
                                setEditingSubValue(sub);
                              }}
                              title="Rename subsection"
                              className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors opacity-70 group-hover/sub:opacity-100"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        )}

                        <div className="flex items-center gap-1">
                          {/* Quick add into this subsection */}
                          <button
                            onClick={() => onAddTask(section, sub)}
                            title={`Add task into ${section} > ${sub}`}
                            className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add</span>
                          </button>

                          {/* Delete subsection */}
                          {sectionSubs.length > 1 && (
                            <button
                              onClick={() => {
                                if (
                                  confirm(
                                    `Delete the "${sub}" subsection? Tasks inside will move to ${sectionSubs.find(
                                      (s) => s !== sub
                                    )}.`
                                  )
                                ) {
                                  onDeleteSubsection(section, sub);
                                }
                              }}
                              title={`Delete subsection ${sub}`}
                              className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                            >
                              <FolderMinus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Tasks in this Subsection */}
                      {subTasks.length === 0 ? (
                        <div className="py-3 px-4 rounded-xl bg-white/70 dark:bg-slate-900/30 border border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-400">
                          <span>No tasks in this subsection yet</span>
                          <button
                            onClick={() => onAddTask(section, sub)}
                            className="font-bold text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1 transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add task</span>
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {subTasks.map((task) => {
                            const taskStatus = task.status || (task.completed ? "completed" : "not_started");
                            const isOverdue = taskStatus !== "completed" && task.dueDate < todayStr;
                            const isToday = taskStatus !== "completed" && task.dueDate === todayStr;

                            return (
                              <div
                                key={task.id}
                                onClick={() => onEditTask(task)}
                                className={`group p-3.5 sm:p-4 rounded-2xl border transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                                  taskStatus === "completed"
                                    ? "bg-slate-50/50 dark:bg-slate-900/20 border-slate-200/50 dark:border-slate-800/50 opacity-60"
                                    : taskStatus === "in_progress"
                                    ? "bg-white dark:bg-[#161a25] border-blue-400/80 dark:border-blue-700/80 shadow-xs ring-1 ring-blue-500/15"
                                    : "bg-white dark:bg-[#161a25] border-slate-200/80 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs hover:shadow-xs"
                                }`}
                              >
                                {/* Checkbox / Progress State & Title */}
                                <div className="flex items-center gap-3 min-w-0">
                                  {taskStatus === "completed" ? (
                                    <button
                                      onClick={(e) => handleCycleStatus(e, task)}
                                      title="Completed — click to reset to Not Started"
                                      className="w-5 h-5 rounded-full flex items-center justify-center transition-all shrink-0 bg-emerald-500 text-white shadow-2xs hover:scale-110 active:scale-95"
                                    >
                                      <Check className="w-3 h-3 stroke-[3]" />
                                    </button>
                                  ) : taskStatus === "in_progress" ? (
                                    <button
                                      onClick={(e) => handleCycleStatus(e, task)}
                                      title="In Progress — click to mark Complete"
                                      className="w-5 h-5 rounded-full flex items-center justify-center transition-all shrink-0 border-2 border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:scale-110 active:scale-95 shadow-2xs"
                                    >
                                      <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                                    </button>
                                  ) : (
                                    <button
                                      onClick={(e) => handleCycleStatus(e, task)}
                                      title="Not Started — click to start In Progress"
                                      className="w-5 h-5 rounded-full flex items-center justify-center transition-all shrink-0 border-2 border-slate-300 dark:border-slate-600 hover:border-blue-400 group-hover:border-slate-400 hover:scale-110 active:scale-95"
                                    />
                                  )}

                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`text-xs font-bold leading-tight truncate block ${
                                          taskStatus === "completed"
                                            ? "line-through text-slate-400"
                                            : "text-slate-800 dark:text-slate-100"
                                        }`}
                                      >
                                        {task.title}
                                      </span>
                                    </div>
                                    {task.description && (
                                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                        {task.description}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* Badges & Selectors */}
                                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                                  {/* Interactive Progress Selector Dropdown */}
                                  <div
                                    className="relative flex items-center"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <select
                                      value={taskStatus}
                                      onChange={(e) => {
                                        const newStatus = e.target.value as Task["status"];
                                        if (newStatus === "completed") {
                                          confetti({
                                            particleCount: 25,
                                            spread: 45,
                                            origin: { y: 0.6 },
                                            colors: ["#10b981", "#3b82f6", "#f59e0b"],
                                          });
                                        }
                                        if (onStatusChange) {
                                          onStatusChange(task.id, newStatus);
                                        } else {
                                          onToggleTask(task.id);
                                        }
                                      }}
                                      title="Change progress status"
                                      className={`text-[10px] font-extrabold px-2.5 py-1 rounded-xl border focus:outline-none cursor-pointer transition-all shadow-2xs ${
                                        taskStatus === "completed"
                                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                                          : taskStatus === "in_progress"
                                          ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800 ring-1 ring-blue-400/30"
                                          : "bg-slate-100 text-slate-600 border-slate-200/90 dark:bg-slate-800/90 dark:text-slate-300 dark:border-slate-700"
                                      }`}
                                    >
                                      <option value="not_started">⚪ Not Started</option>
                                      <option value="in_progress">🟡 In Progress</option>
                                      <option value="completed">🟢 Complete</option>
                                    </select>
                                  </div>

                                  {/* Quick Subsection / Section Selector (Clean & Compact) */}
                                  <div
                                    className="relative flex items-center"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <select
                                      value={`${task.section}::${task.subsection || "General"}`}
                                      onChange={(e) => {
                                        const [sec, subSec] = e.target.value.split("::");
                                        onMoveTask(task.id, sec, subSec);
                                      }}
                                      title="Move task to another area"
                                      className="text-[10px] font-semibold bg-slate-100/90 dark:bg-slate-800/90 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 px-2.5 py-1 rounded-xl border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:outline-none cursor-pointer transition-colors max-w-[130px] truncate"
                                    >
                                      {sections.map((s) => {
                                        const subs = subsections[s] || ["General"];
                                        return (
                                          <optgroup key={s} label={s}>
                                            {subs.map((sb) => (
                                              <option key={`${s}::${sb}`} value={`${s}::${sb}`}>
                                                {s === section ? `↳ ${sb}` : `${s} → ${sb}`}
                                              </option>
                                            ))}
                                          </optgroup>
                                        );
                                      })}
                                    </select>
                                  </div>

                                  {/* Due Date Badge */}
                                  {task.dueDate && (
                                    <span
                                      className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
                                        isOverdue
                                          ? "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-100 dark:border-rose-900/40"
                                          : isToday
                                          ? "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-100 dark:border-blue-900/40 font-bold"
                                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/60"
                                      }`}
                                    >
                                      <Calendar className="w-2.5 h-2.5" />
                                      {task.dueDate}
                                    </span>
                                  )}

                                  {/* Priority Pill */}
                                  <span
                                    className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                      task.priority === "urgent"
                                        ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                                        : task.priority === "high"
                                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                                        : task.priority === "medium"
                                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
                                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                    }`}
                                  >
                                    {task.priority}
                                  </span>

                                  {/* Delete task on hover */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onDeleteTask(task.id);
                                    }}
                                    title="Delete task"
                                    className="p-1 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors opacity-0 group-hover:opacity-100"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

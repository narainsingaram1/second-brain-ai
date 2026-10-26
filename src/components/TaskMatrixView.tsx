import React, { useState } from "react";
import { Task } from "../types";
import {
  Calendar,
  Plus,
  Sparkles,
  Check,
  Trash2,
  FolderPlus,
  FolderMinus,
} from "lucide-react";
import confetti from "canvas-confetti";

interface TaskMatrixViewProps {
  tasks: Task[];
  sections: string[];
  subsections: Record<string, string[]>;
  onToggleTask: (taskId: string) => void;
  onAddTask: (section?: string, subsection?: string) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onAIBreakdown: (task: Task) => void;
  onAddSection: (sectionName: string) => void;
  onDeleteSection: (sectionName: string) => void;
  onAddSubsection: (section: string, subsectionName: string) => void;
  onDeleteSubsection: (section: string, subsectionName: string) => void;
  onMoveTask: (taskId: string, targetSection: string, targetSubsection?: string) => void;
}

export const TaskMatrixView: React.FC<TaskMatrixViewProps> = ({
  tasks,
  sections,
  subsections,
  onToggleTask,
  onAddTask,
  onEditTask,
  onDeleteTask,
  onAIBreakdown,
  onAddSection,
  onDeleteSection,
  onAddSubsection,
  onDeleteSubsection,
  onMoveTask,
}) => {
  const [filterMode, setFilterMode] = useState<"all" | "today" | "upcoming" | "completed">("all");
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [activeAddingSubFor, setActiveAddingSubFor] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState("");

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

  const handleToggle = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    if (!task.completed) {
      confetti({
        particleCount: 30,
        spread: 50,
        origin: { y: 0.6 },
        colors: ["#10b981", "#3b82f6", "#f59e0b"],
      });
    }
    onToggleTask(task.id);
  };

  const filterTask = (task: Task) => {
    if (filterMode === "completed") return task.completed;
    if (task.completed) return false;
    if (filterMode === "today") return task.dueDate === todayStr;
    if (filterMode === "upcoming") return task.dueDate > todayStr;
    return true;
  };

  const pendingCount = tasks.filter((t) => !t.completed).length;

  return (
    <div className="w-full max-w-5xl mx-auto space-y-8 animate-fade-in">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/60 dark:border-slate-800">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Tasks
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {pendingCount} active {pendingCount === 1 ? "task" : "tasks"} across {sections.length} core life areas
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAddingSection(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5 text-slate-500" />
            <span>New Section</span>
          </button>

          <button
            onClick={() => onAddTask(sections[0] || "Academic")}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-950 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-100 dark:text-slate-950 text-xs font-semibold shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Task</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {[
          { id: "all", label: "All Tasks" },
          { id: "today", label: "Due Today" },
          { id: "upcoming", label: "Upcoming" },
          { id: "completed", label: "Completed" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilterMode(tab.id as any)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              filterMode === tab.id
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-xs"
                : "text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Add Section Form */}
      {isAddingSection && (
        <form
          onSubmit={handleCreateSection}
          className="bg-slate-50 dark:bg-[#141721] p-4 rounded-3xl border border-slate-200 dark:border-slate-800 flex items-center gap-3 animate-fade-in"
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
            className="px-4 py-2 rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-slate-950 text-xs font-bold"
          >
            Create Section
          </button>
          <button
            type="button"
            onClick={() => setIsAddingSection(false)}
            className="px-3 py-2 text-xs text-slate-500 hover:text-slate-800"
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
              className="bg-white dark:bg-[#141721] rounded-3xl p-6 border border-slate-200/70 dark:border-slate-800 shadow-xs space-y-6"
            >
              {/* Main Section Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800/80">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                    {section}
                  </h2>
                  <span className="text-[11px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                    {sectionTasks.length}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Add Subsection button */}
                  <button
                    onClick={() => {
                      setActiveAddingSubFor(section);
                      setNewSubName("");
                    }}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white px-2.5 py-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Subsection</span>
                  </button>

                  {/* Add Task button */}
                  <button
                    onClick={() => onAddTask(section, sectionSubs[0])}
                    className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>

                  {/* Delete Section button */}
                  {sections.length > 1 && (
                    <button
                      onClick={() => {
                        if (confirm(`Delete the "${section}" section? All tasks inside will be moved to another section.`)) {
                          onDeleteSection(section);
                        }
                      }}
                      title="Delete section"
                      className="p-1.5 rounded-full hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-500 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Add Subsection Inline Form */}
              {activeAddingSubFor === section && (
                <form
                  onSubmit={(e) => handleCreateSubsection(section, e)}
                  className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center gap-2 animate-fade-in"
                >
                  <input
                    type="text"
                    autoFocus
                    placeholder={`New subsection in ${section} (e.g. CS 1332, Workouts, Taxes)...`}
                    value={newSubName}
                    onChange={(e) => setNewSubName(e.target.value)}
                    className="flex-1 bg-white dark:bg-slate-800 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-950 text-xs font-bold"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveAddingSubFor(null)}
                    className="px-2 py-1 text-xs text-slate-500 hover:text-slate-800"
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

                  return (
                    <div key={sub} className="space-y-2.5">
                      {/* Subsection Sub-header */}
                      <div className="flex items-center justify-between px-1">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500"></span>
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {sub}
                          </h3>
                          <span className="text-[10px] text-slate-400 font-medium">
                            ({subTasks.length})
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          {/* Quick add into this subsection */}
                          <button
                            onClick={() => onAddTask(section, sub)}
                            title={`Add task into ${section} > ${sub}`}
                            className="p-1 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>

                          {/* Delete subsection */}
                          {sectionSubs.length > 1 && (
                            <button
                              onClick={() => {
                                if (confirm(`Delete the "${sub}" subsection? Tasks inside will move to ${sectionSubs.find(s => s !== sub)}.`)) {
                                  onDeleteSubsection(section, sub);
                                }
                              }}
                              title={`Delete subsection ${sub}`}
                              className="p-1 rounded-md text-slate-300 hover:text-rose-500 transition-colors"
                            >
                              <FolderMinus className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Tasks in this Subsection */}
                      {subTasks.length === 0 ? (
                        <div className="p-3 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-[11px] text-slate-400">
                          Empty subsection. <button onClick={() => onAddTask(section, sub)} className="text-slate-800 dark:text-slate-200 font-bold hover:underline">+ Add task</button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {subTasks.map((task) => {
                            const isOverdue = !task.completed && task.dueDate < todayStr;
                            const isToday = !task.completed && task.dueDate === todayStr;

                            return (
                              <div
                                key={task.id}
                                onClick={() => onEditTask(task)}
                                className={`group p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                                  task.completed
                                    ? "bg-slate-50/50 dark:bg-slate-900/20 border-slate-200/50 dark:border-slate-800/50 opacity-60"
                                    : "bg-white dark:bg-[#181d29] border-slate-200/70 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-xs"
                                }`}
                              >
                                {/* Checkbox & Title */}
                                <div className="flex items-center gap-3 min-w-0">
                                  <button
                                    onClick={(e) => handleToggle(e, task)}
                                    className={`w-5 h-5 rounded-full flex items-center justify-center transition-all shrink-0 ${
                                      task.completed
                                        ? "bg-emerald-500 text-white shadow-xs"
                                        : "border-2 border-slate-300 dark:border-slate-600 hover:border-emerald-500"
                                    }`}
                                  >
                                    {task.completed && <Check className="w-3 h-3 stroke-[3]" />}
                                  </button>

                                  <div className="min-w-0">
                                    <span
                                      className={`text-xs font-bold leading-tight truncate block ${
                                        task.completed
                                          ? "line-through text-slate-400"
                                          : "text-slate-800 dark:text-slate-100"
                                      }`}
                                    >
                                      {task.title}
                                    </span>
                                    {task.description && (
                                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                        {task.description}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* Badges, Reassignment & Actions */}
                                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                                  {/* AI Task Breakdown */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onAIBreakdown(task);
                                    }}
                                    title="AI Task Breakdown"
                                    className="p-1 rounded-lg text-slate-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40 transition-colors"
                                  >
                                    <Sparkles className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Quick Subsection / Section Selector */}
                                  <div
                                    className="relative flex items-center"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <select
                                      value={`${task.section}::${task.subsection || "General"}`}
                                      onChange={(e) => {
                                        const [sec, sub] = e.target.value.split("::");
                                        onMoveTask(task.id, sec, sub);
                                      }}
                                      className="text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700 focus:outline-none cursor-pointer max-w-[150px] truncate"
                                    >
                                      {sections.map((s) => {
                                        const subs = subsections[s] || ["General"];
                                        return (
                                          <optgroup key={s} label={s}>
                                            {subs.map((sb) => (
                                              <option key={`${s}::${sb}`} value={`${s}::${sb}`}>
                                                {s} → {sb}
                                              </option>
                                            ))}
                                          </optgroup>
                                        );
                                      })}
                                    </select>
                                  </div>

                                  {/* Due Date Badge */}
                                  <span
                                    className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
                                      isOverdue
                                        ? "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400"
                                        : isToday
                                        ? "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
                                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                                    }`}
                                  >
                                    <Calendar className="w-2.5 h-2.5" />
                                    {task.dueDate}
                                  </span>

                                  {/* Priority Pill */}
                                  <span
                                    className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                      task.priority === "urgent"
                                        ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                                        : task.priority === "high"
                                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                    }`}
                                  >
                                    {task.priority}
                                  </span>

                                  {/* Delete task */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onDeleteTask(task.id);
                                    }}
                                    className="p-1 rounded-lg text-slate-400 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                                  >
                                    <Trash2 className="w-3 h-3" />
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

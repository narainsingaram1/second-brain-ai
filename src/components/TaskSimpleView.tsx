import React, { useState } from "react";
import { formatTime } from "../utils/events";
import { Task, TaskStatus } from "../types";
import { normalizeTask } from "../utils/taskState";
import {
  Plus,
  Check,
  ChevronDown,
  ChevronRight,
  Calendar,
  Trash2,
} from "lucide-react";
import { getLocalDateString } from "../utils/habitStreaks";

interface TaskSimpleViewProps {
  tasks: Task[];
  sections: string[];
  subsections: Record<string, string[]>;
  onToggleTask: (taskId: string) => void;
  onStatusChange?: (taskId: string, status: TaskStatus) => void;
  onAddTask: (section?: string, subsection?: string, defaultDueDate?: string) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onSaveTask: (task: Task) => void;
}

export const TaskSimpleView: React.FC<TaskSimpleViewProps> = ({
  tasks,
  sections,
  subsections,
  onToggleTask,
  onStatusChange,
  onAddTask,
  onEditTask,
  onDeleteTask,
  onSaveTask,
}) => {
  const todayStr = getLocalDateString();

  const [groupBy, setGroupBy] = useState<"section" | "status" | "date">("section");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [quickAddSection, setQuickAddSection] = useState(sections[0] || "Academic");
  const [showCompleted, setShowCompleted] = useState(false);

  // Toggle collapse state for a group
  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  // Cycle status
  const handleCycleStatus = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    const current = task.status || (task.completed ? "completed" : "not_started");
    let next: TaskStatus;
    if (current === "not_started") {
      next = "in_progress";
    } else if (current === "in_progress") {
      next = "completed";
    } else {
      next = "not_started";
    }

    if (onStatusChange) {
      onStatusChange(task.id, next);
    } else {
      onToggleTask(task.id);
    }
  };

  // Inline Quick Add submit
  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddTitle.trim()) return;

    const availableSubs = subsections[quickAddSection] || ["General"];
    const newTask: Task = normalizeTask({
      id: `task-${Date.now()}`,
      title: quickAddTitle.trim(),
      dueDate: todayStr,
      priority: "medium",
      section: quickAddSection,
      subsection: availableSubs[0] || "General",
      status: "not_started",
    });

    onSaveTask(newTask);
    setQuickAddTitle("");
  };

  const activeTasks = tasks.filter((t) => t.status !== "completed");
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;

  // Build groups based on groupBy
  let groups: { id: string; title: string; tasks: Task[]; badge?: string }[] = [];

  if (groupBy === "section") {
    groups = sections.map((sec) => {
      const secTasks = tasks.filter((t) => (t.section || "Academic") === sec);
      const visible = showCompleted ? secTasks : secTasks.filter((t) => !t.completed && t.status !== "completed");
      return {
        id: sec,
        title: sec,
        tasks: visible,
        badge: `${visible.length}`,
      };
    });
  } else if (groupBy === "status") {
    const inProgress = tasks.filter((t) => (t.status || (t.completed ? "completed" : "not_started")) === "in_progress");
    const notStarted = tasks.filter((t) => (t.status || (t.completed ? "completed" : "not_started")) === "not_started");
    const done = tasks.filter((t) => (t.status || (t.completed ? "completed" : "not_started")) === "completed");

    groups = [
      { id: "in_progress", title: "In progress", tasks: inProgress, badge: `${inProgress.length}` },
      { id: "not_started", title: "Not started", tasks: notStarted, badge: `${notStarted.length}` },
    ];
    if (showCompleted) {
      groups.push({ id: "completed", title: "Completed", tasks: done, badge: `${done.length}` });
    }
  } else {
    // Group by Date: Overdue, Today, Upcoming, Someday
    const overdue = activeTasks.filter((t) => t.dueDate && t.dueDate < todayStr);
    const todayList = activeTasks.filter((t) => t.dueDate === todayStr);
    const upcoming = activeTasks.filter((t) => t.dueDate && t.dueDate > todayStr);
    const noDate = activeTasks.filter((t) => !t.dueDate);

    groups = [
      { id: "today", title: "Due Today", tasks: todayList, badge: `${todayList.length}` },
      { id: "upcoming", title: "Upcoming", tasks: upcoming, badge: `${upcoming.length}` },
      { id: "overdue", title: "Overdue", tasks: overdue, badge: `${overdue.length}` },
      { id: "no_date", title: "No Due Date", tasks: noDate, badge: `${noDate.length}` },
    ];
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 animate-fade-in pb-16">
      {/* Top Simple Header & Controls */}
      <div className="bg-panel backdrop-blur-xl rounded-4xl p-5 border border-line shadow-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-ink tracking-tight flex items-center gap-2">
            <span>Simple list view</span>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-raised text-[var(--workspace-success)] dark:bg-raised dark:text-[var(--workspace-success)] border border-line">
              {activeTasks.length} active ({inProgressCount} in progress)
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Minimalist checklist layout for rapid focus and execution
          </p>
        </div>

        {/* Group By & Completed Toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-raised p-1 rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
            <span className="text-[11px] font-bold text-slate-400 uppercase px-2">Group:</span>
            {(
              [
                { id: "section", label: "Section" },
                { id: "status", label: "Status" },
                { id: "date", label: "Date" },
              ] as const
            ).map((g) => (
              <button
                key={g.id}
                onClick={() => setGroupBy(g.id)}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                  groupBy === g.id
                    ? "bg-white dark:bg-slate-700 text-ink shadow-xs"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className={`px-3 py-1.5 rounded-2xl text-xs font-bold transition-all border ${
              showCompleted
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 border-transparent shadow-xs"
                : "bg-raised text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200"
            }`}
          >
            {showCompleted ? "Hiding Completed" : "Show Completed"}
          </button>
        </div>
      </div>

      {/* Inline Quick Add Input Box */}
      <form
        onSubmit={handleQuickAdd}
        className="bg-panel rounded-3xl border border-line shadow-2xs p-3 flex items-center gap-2"
      >
        <div className="w-6 h-6 rounded-full bg-raised text-slate-400 flex items-center justify-center shrink-0 ml-1">
          <Plus className="w-3.5 h-3.5" />
        </div>
        <input
          type="text"
          placeholder="Add a new task... (press Enter to create)"
          value={quickAddTitle}
          onChange={(e) => setQuickAddTitle(e.target.value)}
          className="flex-1 bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none px-2"
        />

        <select
          value={quickAddSection}
          onChange={(e) => setQuickAddSection(e.target.value)}
          className="text-[11px] font-bold bg-raised text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-xl border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:outline-none cursor-pointer"
        >
          {sections.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="px-4 py-1.5 rounded-xl bg-slate-950 dark:bg-white text-white dark:text-slate-950 text-xs font-bold hover:opacity-90 active:scale-[0.98] transition-all shrink-0"
        >
          Add
        </button>
      </form>

      {/* Groups List */}
      <div className="space-y-4">
        {groups.map((group) => {
          const isCollapsed = !!collapsedGroups[group.id];

          return (
            <div
              key={group.id}
              className="bg-panel rounded-3xl border border-line shadow-2xs overflow-hidden transition-all"
            >
              {/* Group Header */}
              <div
                onClick={() => toggleGroup(group.id)}
                className="px-5 py-3.5 flex items-center justify-between cursor-pointer select-none hover:bg-slate-50/80 dark:hover:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800/80 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">
                    {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </span>
                  <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-800 dark:text-slate-200">
                    {group.title}
                  </h3>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-raised text-muted">
                    {group.tasks.length}
                  </span>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const targetSec = groupBy === "section" ? group.id : sections[0];
                    onAddTask(targetSec);
                  }}
                  className="flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </div>

              {/* Group Task Rows */}
              {!isCollapsed && (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {group.tasks.length === 0 ? (
                    <div className="py-4 px-6 text-xs text-slate-400 italic">
                      No tasks in this group
                    </div>
                  ) : (
                    group.tasks.map((task) => {
                      const taskStatus = task.status || (task.completed ? "completed" : "not_started");
                      const isOverdue = taskStatus !== "completed" && task.dueDate && task.dueDate < todayStr;
                      const isToday = taskStatus !== "completed" && task.dueDate === todayStr;

                      return (
                        <div
                          key={task.id}
                          onClick={() => onEditTask(task)}
                          className={`px-5 py-3 flex items-center justify-between gap-3 cursor-pointer group hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors ${
                            taskStatus === "completed" ? "opacity-50" : ""
                          }`}
                        >
                          {/* Checkbox & Title */}
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {taskStatus === "completed" ? (
                              <button
                                onClick={(e) => handleCycleStatus(e, task)}
                                title="Complete — click to reset"
                                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-raised0 text-white shadow-2xs"
                              >
                                <Check className="w-3 h-3 stroke-[3]" />
                              </button>
                            ) : taskStatus === "in_progress" ? (
                              <button
                                onClick={(e) => handleCycleStatus(e, task)}
                                title="In Progress — click to mark complete"
                                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 border-2 task-theme-border task-theme-bg task-theme-dark-bg task-theme-text"
                              >
                                <div className="w-2 h-2 rounded-full task-theme-bg-solid" />
                              </button>
                            ) : (
                              <button
                                onClick={(e) => handleCycleStatus(e, task)}
                                title="Not Started — click to set In Progress"
                                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 border-2 border-slate-300 dark:border-slate-600 task-theme-hover-border transition-all"
                              />
                            )}

                            <span
                              className={`text-xs font-bold truncate ${
                                taskStatus === "completed"
                                  ? "line-through text-slate-400"
                                  : "text-slate-800 dark:text-slate-100"
                              }`}
                            >
                              {task.title}
                            </span>
                          </div>

                          {/* Metadata Pills */}
                          <div className="flex items-center gap-2 shrink-0">
                            {/* Section Pill */}
                            {groupBy !== "section" && (
                              <span className="text-[11px] font-semibold text-muted bg-raised px-2 py-0.5 rounded-md">
                                {task.section}
                              </span>
                            )}

                            {/* Status badge */}
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                                taskStatus === "completed"
                                  ? "bg-raised text-[var(--workspace-success)] dark:bg-raised dark:text-[var(--workspace-success)]"
                                  : taskStatus === "in_progress"
                                  ? "task-theme-bg task-theme-text task-theme-dark-bg task-theme-dark-text ring-1 task-theme-ring"
                                  : "text-slate-400 bg-raised"
                              }`}
                            >
                              {taskStatus === "completed"
                                ? "Complete"
                                : taskStatus === "in_progress"
                                ? "In progress"
                                : "Not started"}
                            </span>

                            {/* Due Date */}
                            {task.dueDate && (
                              <span
                                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                                  isOverdue
                                    ? "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 font-bold"
                                    : isToday
                                    ? "task-theme-bg task-theme-text task-theme-dark-bg task-theme-dark-text font-bold"
                                    : "text-slate-400"
                                }`}
                              >
                                <Calendar className="w-2.5 h-2.5" />
                                {task.dueDate}{task.dueTime ? ` · ${formatTime(task.dueTime)}` : ""}
                              </span>
                            )}

                            {/* Priority Dot */}
                            <div
                              title={`Priority: ${task.priority}`}
                              className={`w-2 h-2 rounded-full ${
                                task.priority === "urgent"
                                  ? "bg-rose-500"
                                  : task.priority === "high"
                                  ? "bg-raised0"
                                  : task.priority === "medium"
                                  ? "bg-blue-400"
                                  : "bg-slate-300 dark:bg-slate-600"
                              }`}
                            />

                            {/* Delete on hover */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteTask(task.id);
                              }}
                              title="Delete task"
                              className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 rounded-lg transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Collapsible Completed Archive if not already shown in groups */}
        {!showCompleted && completedTasks.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setShowCompleted(true)}
              className="text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 flex items-center gap-1.5 transition-colors"
            >
              <span>Show {completedTasks.length} Completed Tasks</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

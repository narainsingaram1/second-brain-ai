import React, { useState } from "react";
import { Task, LifeDomain } from "../types";
import {
  Calendar,
  CheckCircle2,
  Plus,
  Sparkles,
  ArrowUpDown,
  AlertCircle,
  Check,
} from "lucide-react";
import confetti from "canvas-confetti";

interface TaskMatrixViewProps {
  tasks: Task[];
  onToggleTask: (taskId: string) => void;
  onAddTask: (stage?: Task["stage"]) => void;
  onEditTask: (task: Task) => void;
  onAIBreakdown: (task: Task) => void;
}

export const TaskMatrixView: React.FC<TaskMatrixViewProps> = ({
  tasks,
  onToggleTask,
  onAddTask,
  onEditTask,
  onAIBreakdown,
}) => {
  const [filterMode, setFilterMode] = useState<"all" | "today" | "upcoming" | "overdue" | "completed">("today");
  const [domainFilter, setDomainFilter] = useState<LifeDomain | "all">("all");
  const [sortBy, setSortBy] = useState<"dueDate" | "priority">("dueDate");

  const todayStr = new Date().toISOString().split("T")[0];

  const filteredTasks = tasks.filter((t) => {
    if (domainFilter !== "all" && t.domain !== domainFilter) return false;

    if (filterMode === "completed") return t.completed;
    if (filterMode === "all") return true;

    if (t.completed) return false;

    if (filterMode === "today") return t.dueDate === todayStr;
    if (filterMode === "upcoming") return t.dueDate > todayStr;
    if (filterMode === "overdue") return t.dueDate < todayStr;

    return true;
  });

  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (sortBy === "dueDate") {
      return a.dueDate.localeCompare(b.dueDate);
    }
    const priorityWeights = { urgent: 4, high: 3, medium: 2, low: 1 };
    return priorityWeights[b.priority] - priorityWeights[a.priority];
  });

  const overdueCount = tasks.filter((t) => !t.completed && t.dueDate < todayStr).length;
  const todayCount = tasks.filter((t) => !t.completed && t.dueDate === todayStr).length;

  const handleToggle = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    if (!task.completed) {
      confetti({
        particleCount: 35,
        spread: 60,
        origin: { y: 0.6 },
        colors: ["#3b82f6", "#10b981", "#8b5cf6"],
      });
    }
    onToggleTask(task.id);
  };

  const getPriorityBadge = (priority: Task["priority"]) => {
    switch (priority) {
      case "urgent":
        return "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300";
      case "high":
        return "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300";
      case "medium":
        return "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300";
      default:
        return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-slate-200";
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {/* Top Header Card */}
      <div className="bg-white/80 dark:bg-[#141721]/80 backdrop-blur-xl rounded-4xl p-6 border border-slate-300/70 dark:border-slate-800 shadow-card flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            Task Matrix & Execution Due Dates
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Prioritized timeline of all active deliverables with AI decomposition
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onAddTask()}
            className="tactile-btn flex items-center gap-2 px-4 py-2 rounded-full bg-[#0d0f14] dark:bg-white text-white dark:text-slate-900 text-xs font-bold shadow-md hover:scale-105 active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>New Task</span>
          </button>
        </div>
      </div>

      {/* Filter & Sub-Nav Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-200/50 dark:bg-slate-900/40 p-2 rounded-3xl border border-slate-300/60 dark:border-slate-800">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {[
            { id: "today", label: `Today (${todayCount})` },
            { id: "upcoming", label: "Upcoming" },
            { id: "overdue", label: `Overdue (${overdueCount})`, isAlert: overdueCount > 0 },
            { id: "all", label: "All Tasks" },
            { id: "completed", label: "Completed" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterMode(tab.id as any)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                filterMode === tab.id
                  ? "bg-[#0d0f14] dark:bg-white text-white dark:text-slate-900 shadow-sm"
                  : tab.isAlert
                  ? "text-rose-600 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-white/60 dark:hover:bg-slate-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Domain Filter */}
          <select
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value as any)}
            className="text-xs font-semibold bg-white dark:bg-[#141721] border border-slate-300/70 dark:border-slate-800 rounded-full px-3 py-1.5 text-slate-700 dark:text-slate-200 focus:outline-none"
          >
            <option value="all">All Domains</option>
            <option value="career">Career & Projects</option>
            <option value="health">Health & Vitality</option>
            <option value="mindset">Mindset & Habits</option>
            <option value="learning">Deep Learning</option>
            <option value="ai">AI Agent</option>
          </select>

          {/* Sort Switcher */}
          <button
            onClick={() => setSortBy(sortBy === "dueDate" ? "priority" : "dueDate")}
            className="flex items-center gap-1 text-xs font-semibold bg-white dark:bg-[#141721] border border-slate-300/70 dark:border-slate-800 rounded-full px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100"
          >
            <ArrowUpDown className="w-3 h-3 text-slate-400" />
            <span>Sort: {sortBy === "dueDate" ? "Due Date" : "Priority"}</span>
          </button>
        </div>
      </div>

      {/* Task List */}
      <div className="space-y-3">
        {sortedTasks.length === 0 ? (
          <div className="text-center py-16 bg-white/60 dark:bg-[#141721]/60 rounded-4xl border border-slate-200 dark:border-slate-800">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">
              Zero pending tasks in this view!
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Enjoy the clarity or create a new objective to conquer.
            </p>
          </div>
        ) : (
          sortedTasks.map((task) => {
            const isOverdue = !task.completed && task.dueDate < todayStr;
            const isToday = !task.completed && task.dueDate === todayStr;

            return (
              <div
                key={task.id}
                onClick={() => onEditTask(task)}
                className={`group bg-white dark:bg-[#141721] rounded-3xl p-4 border transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer flex items-center justify-between gap-4 ${
                  task.completed
                    ? "opacity-60 bg-slate-50/50 dark:bg-slate-900/20 border-slate-200 dark:border-slate-800"
                    : isOverdue
                    ? "border-rose-300 dark:border-rose-900/60"
                    : "border-slate-200/80 dark:border-slate-800 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <button
                    onClick={(e) => handleToggle(e, task)}
                    className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                      task.completed
                        ? "bg-emerald-500 text-white shadow-sm"
                        : "border-2 border-slate-300 dark:border-slate-600 hover:border-emerald-500 hover:bg-emerald-50"
                    }`}
                  >
                    {task.completed && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </button>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4
                        className={`text-sm font-bold truncate ${
                          task.completed
                            ? "line-through text-slate-400 dark:text-slate-500"
                            : "text-slate-900 dark:text-slate-100"
                        }`}
                      >
                        {task.title}
                      </h4>
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${getPriorityBadge(
                          task.priority
                        )}`}
                      >
                        {task.priority}
                      </span>
                    </div>
                    {task.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 max-w-xl">
                        {task.description}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {/* AI Subtask decomposition button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAIBreakdown(task);
                    }}
                    title="Ask AI to decompose into action steps"
                    className="flex items-center gap-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 px-2.5 py-1 rounded-full border border-purple-200 dark:border-purple-800/60 transition-colors"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span className="hidden sm:inline">AI Breakdown</span>
                  </button>

                  {/* Due Date Indicator */}
                  <div
                    className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border ${
                      isOverdue
                        ? "bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/50 dark:text-rose-400"
                        : isToday
                        ? "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400"
                        : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    {isOverdue && <AlertCircle className="w-3 h-3 text-rose-500" />}
                    <Calendar className="w-3 h-3 text-slate-400" />
                    <span>{task.dueDate}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

import React, { useState } from "react";
import { Task, TaskStatus } from "../types";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Check,
  Calendar as CalendarIcon,
  AlertCircle,
  Clock,
  Trash2,
} from "lucide-react";
import confetti from "canvas-confetti";
import { getLocalDateString } from "../utils/habitStreaks";

interface TaskCalendarViewProps {
  tasks: Task[];
  sections: string[];
  subsections: Record<string, string[]>;
  onToggleTask: (taskId: string) => void;
  onStatusChange?: (taskId: string, status: TaskStatus) => void;
  onAddTask: (section?: string, subsection?: string, defaultDueDate?: string) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const TaskCalendarView: React.FC<TaskCalendarViewProps> = ({
  tasks,
  sections,
  subsections,
  onToggleTask,
  onStatusChange,
  onAddTask,
  onEditTask,
  onDeleteTask,
}) => {
  const today = new Date();
  const todayStr = getLocalDateString(today);

  const [currentYear, setCurrentYear] = useState<number>(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(today.getMonth());
  const [calendarMode, setCalendarMode] = useState<"month" | "week">("month");
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [filterSection, setFilterSection] = useState<string>("all");
  const [hideCompleted, setHideCompleted] = useState<boolean>(false);

  // Month navigation
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleGoToday = () => {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
    setSelectedDate(todayStr);
  };

  // Cycle status handler with confetti
  const handleCycleStatus = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    const current = task.status;
    let next: TaskStatus;
    if (current === "not_started") {
      next = "in_progress";
    } else if (current === "in_progress") {
      next = "completed";
      confetti({
        particleCount: 25,
        spread: 45,
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

  // Filter tasks based on section and completed toggle
  const filteredTasks = tasks.filter((t) => {
    if (filterSection !== "all" && t.section !== filterSection) return false;
    if (hideCompleted && t.status === "completed") return false;
    return true;
  });

  // Calculate Overdue tasks (dueDate < todayStr and not completed)
  const overdueTasks = filteredTasks.filter(
    (t) => t.status !== "completed" && t.dueDate && t.dueDate < todayStr
  );

  // Calculate grid days for month view
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
  const startDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sun
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

  interface CalendarCell {
    dateStr: string;
    dayNum: number;
    isCurrentMonth: boolean;
    isToday: boolean;
    isSelected: boolean;
  }

  const calendarCells: CalendarCell[] = [];

  // Previous month trailing days
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const prevMonthDate = new Date(currentYear, currentMonth - 1, dayNum);
    const dateStr = getLocalDateString(prevMonthDate);
    calendarCells.push({
      dateStr,
      dayNum,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      isSelected: dateStr === selectedDate,
    });
  }

  // Current month days
  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const d = new Date(currentYear, currentMonth, dayNum);
    const dateStr = getLocalDateString(d);
    calendarCells.push({
      dateStr,
      dayNum,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
      isSelected: dateStr === selectedDate,
    });
  }

  // Next month leading days to complete 35 or 42 cells
  const remainingCells = 35 - calendarCells.length > 0 ? 35 - calendarCells.length : 42 - calendarCells.length;
  for (let dayNum = 1; dayNum <= remainingCells; dayNum++) {
    const nextMonthDate = new Date(currentYear, currentMonth + 1, dayNum);
    const dateStr = getLocalDateString(nextMonthDate);
    calendarCells.push({
      dateStr,
      dayNum,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      isSelected: dateStr === selectedDate,
    });
  }

  // Calculate Week Cells if in week mode
  const selectedD = new Date(selectedDate + "T00:00:00");
  const selectedDayOfWeek = isNaN(selectedD.getDay()) ? 0 : selectedD.getDay();
  const weekStart = new Date(selectedD);
  weekStart.setDate(selectedD.getDate() - selectedDayOfWeek);

  const weekCells: CalendarCell[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const dateStr = getLocalDateString(d);
    weekCells.push({
      dateStr,
      dayNum: d.getDate(),
      isCurrentMonth: d.getMonth() === currentMonth,
      isToday: dateStr === todayStr,
      isSelected: dateStr === selectedDate,
    });
  }

  const displayedCells = calendarMode === "week" ? weekCells : calendarCells;

  // Selected Day tasks
  const selectedDayTasks = filteredTasks.filter((t) => t.dueDate === selectedDate);
  const totalTasksThisMonth = filteredTasks.filter((t) => {
    if (!t.dueDate) return false;
    const [y, m] = t.dueDate.split("-").map(Number);
    return y === currentYear && m === currentMonth + 1;
  }).length;

  return (
    <div className="w-full space-y-6 animate-fade-in">
      {/* Calendar Top Controls Header */}
      <div className="bg-panel backdrop-blur-xl rounded-4xl p-5 border border-line shadow-card flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Month Title & Navigation */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-raised p-1 rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
            <button
              onClick={handlePrevMonth}
              title="Previous month"
              className="p-1.5 rounded-xl hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleGoToday}
              className="px-3 py-1 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 transition-colors"
            >
              Today
            </button>
            <button
              onClick={handleNextMonth}
              title="Next month"
              className="p-1.5 rounded-xl hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div>
            <h2 className="text-xl font-extrabold text-ink tracking-tight flex items-center gap-2">
              <span>
                {MONTH_NAMES[currentMonth]} {currentYear}
              </span>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full task-theme-bg task-theme-text task-theme-dark-bg task-theme-dark-text border task-theme-border task-theme-dark-border">
                {totalTasksThisMonth} {totalTasksThisMonth === 1 ? "task" : "tasks"}
              </span>
            </h2>
          </div>
        </div>

        {/* Filter controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode toggle: Month vs Week */}
          <div className="flex items-center bg-raised p-1 rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
            <button
              onClick={() => setCalendarMode("month")}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                calendarMode === "month"
                  ? "bg-white dark:bg-slate-700 text-ink shadow-xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setCalendarMode("week")}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                calendarMode === "week"
                  ? "bg-white dark:bg-slate-700 text-ink shadow-xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              Week
            </button>
          </div>

          {/* Section filter */}
          <select
            value={filterSection}
            onChange={(e) => setFilterSection(e.target.value)}
            className="text-xs font-bold bg-raised text-slate-700 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none cursor-pointer"
          >
            <option value="all">All Sections</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* Hide completed button */}
          <button
            onClick={() => setHideCompleted(!hideCompleted)}
            className={`px-3 py-2 rounded-2xl text-xs font-bold transition-all border ${
              hideCompleted
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 border-transparent shadow-xs"
                : "bg-raised text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            {hideCompleted ? "Hiding Completed" : "Show Completed"}
          </button>

          {/* Add task button with selected day */}
          <button
            onClick={() => onAddTask(sections[0], subsections[sections[0]]?.[0], selectedDate)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-slate-950 dark:bg-white text-white dark:text-slate-950 text-xs font-bold shadow-xs hover:scale-102 active:scale-98 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add on Date</span>
          </button>
        </div>
      </div>

      {/* Main Grid & Sidebar Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Calendar Month Grid */}
        <div className="lg:col-span-8 bg-panel rounded-4xl border border-line shadow-sm p-4 sm:p-6 overflow-hidden">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2 text-center text-xs font-bold text-slate-400 uppercase tracking-wider">
            {WEEKDAY_NAMES.map((day) => (
              <div key={day} className="py-1">
                {day}
              </div>
            ))}
          </div>

          {/* 35 or 42 Calendar Cells */}
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {displayedCells.map((cell) => {
              const dayTasks = filteredTasks.filter((t) => t.dueDate === cell.dateStr);
              const pendingDayTasks = dayTasks.filter((t) => t.status !== "completed");
              const isCellSelected = cell.dateStr === selectedDate;

              return (
                <div
                  key={cell.dateStr}
                  onClick={() => setSelectedDate(cell.dateStr)}
                  className={`min-h-[92px] sm:min-h-[105px] p-1.5 sm:p-2 rounded-2xl border transition-all flex flex-col justify-between cursor-pointer group relative ${
                    isCellSelected
                      ? "ring-2 task-theme-ring task-theme-bg task-theme-dark-bg task-theme-border task-theme-dark-border shadow-xs"
                      : cell.isCurrentMonth
                      ? "bg-slate-50/50 dark:bg-[#161a25]/60 border-line hover:border-slate-300 dark:hover:border-slate-700"
                      : "bg-slate-100/40 dark:bg-slate-900/20 border-slate-100 dark:border-slate-800/40 opacity-40 hover:opacity-75"
                  }`}
                >
                  {/* Cell Top Header */}
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-extrabold w-6 h-6 flex items-center justify-center rounded-full transition-all ${
                        cell.isToday
                          ? "task-theme-bg-solid text-white shadow-2xs font-black"
                          : cell.isCurrentMonth
                          ? "text-slate-800 dark:text-slate-200"
                          : "text-slate-400"
                      }`}
                    >
                      {cell.dayNum}
                    </span>

                    {/* Quick + Add Button on Hover */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddTask(sections[0], subsections[sections[0]]?.[0], cell.dateStr);
                      }}
                      title={`Add task on ${cell.dateStr}`}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-slate-400 task-theme-hover-text task-theme-hover-bg task-theme-dark-hover-bg transition-all"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Day Tasks List (Up to 3 chips visible) */}
                  <div className="space-y-1 my-1 overflow-hidden">
                    {dayTasks.slice(0, 3).map((task) => {
                      const isCompleted = task.status === "completed";
                      const isInProgress = task.status === "in_progress";

                      return (
                        <div
                          key={task.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditTask(task);
                          }}
                          className={`px-1.5 py-0.5 rounded-lg text-[11px] font-bold truncate flex items-center gap-1 transition-all ${
                            isCompleted
                              ? "bg-slate-200/60 dark:bg-slate-800/60 text-slate-400 line-through"
                              : isInProgress
                              ? "task-theme-bg task-theme-dark-bg task-theme-text task-theme-dark-text border task-theme-border task-theme-dark-border"
                              : task.priority === "urgent"
                              ? "bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300"
                              : task.priority === "high"
                              ? "bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300"
                              : "bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          <button
                            onClick={(e) => handleCycleStatus(e, task)}
                            className="shrink-0"
                            title="Cycle status"
                          >
                            {isCompleted ? (
                              <Check className="w-2.5 h-2.5 stroke-[3] text-emerald-600" />
                            ) : isInProgress ? (
                              <div className="w-2 h-2 rounded-full task-theme-bg-solid animate-pulse" />
                            ) : (
                              <div className="w-2 h-2 rounded-full border border-slate-400" />
                            )}
                          </button>
                          <span className="truncate">{task.title}</span>
                        </div>
                      );
                    })}

                    {dayTasks.length > 3 && (
                      <div className="text-[11px] font-extrabold task-theme-text task-theme-dark-text pl-1">
                        +{dayTasks.length - 3} more
                      </div>
                    )}
                  </div>

                  {/* Cell Bottom Badge */}
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    {pendingDayTasks.length > 0 ? (
                      <span className="font-semibold text-muted">
                        {pendingDayTasks.length} pending
                      </span>
                    ) : (
                      <div />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Day Agenda & Overdue Sidebar */}
        <div className="lg:col-span-4 space-y-4">
          {/* Selected Date Card */}
          <div className="bg-panel rounded-4xl border border-line shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 task-theme-text" />
                <h3 className="font-extrabold text-sm text-ink">
                  Agenda for {selectedDate}
                </h3>
              </div>
              <button
                onClick={() => onAddTask(sections[0], subsections[sections[0]]?.[0], selectedDate)}
                className="flex items-center gap-1 text-[11px] font-bold task-theme-text task-theme-dark-text hover:underline"
              >
                <Plus className="w-3 h-3" />
                <span>Add Task</span>
              </button>
            </div>

            {selectedDayTasks.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <div className="w-10 h-10 rounded-2xl bg-raised text-slate-400 flex items-center justify-center mx-auto">
                  <Clock className="w-5 h-5" />
                </div>
                <p className="text-xs font-semibold text-slate-400">
                  No tasks scheduled for this day
                </p>
                <button
                  onClick={() => onAddTask(sections[0], subsections[sections[0]]?.[0], selectedDate)}
                  className="text-xs font-bold text-slate-800 dark:text-slate-200 task-theme-hover-text task-theme-dark-hover-text"
                >
                  + Create task on {selectedDate}
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {selectedDayTasks.map((task) => {
                  const taskStatus = task.status;

                  return (
                    <div
                      key={task.id}
                      onClick={() => onEditTask(task)}
                      className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 group ${
                        taskStatus === "completed"
                          ? "bg-slate-50/50 dark:bg-slate-900/20 border-line opacity-60"
                          : taskStatus === "in_progress"
                          ? "bg-panel task-theme-border task-theme-dark-border shadow-2xs"
                          : "bg-panel border-line hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <button
                          onClick={(e) => handleCycleStatus(e, task)}
                          className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                            taskStatus === "completed"
                              ? "bg-emerald-500 text-white"
                              : taskStatus === "in_progress"
                              ? "border-2 task-theme-border task-theme-bg task-theme-dark-bg task-theme-text"
                              : "border-2 border-slate-300 dark:border-slate-600 task-theme-hover-border"
                          }`}
                        >
                          {taskStatus === "completed" && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                          {taskStatus === "in_progress" && (
                            <div className="w-1.5 h-1.5 rounded-full task-theme-bg-solid animate-pulse" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <span
                            className={`text-xs font-bold truncate block ${
                              taskStatus === "completed"
                                ? "line-through text-slate-400"
                                : "text-slate-800 dark:text-slate-100"
                            }`}
                          >
                            {task.title}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {task.section} {task.subsection ? `• ${task.subsection}` : ""}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            task.priority === "urgent"
                              ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                              : task.priority === "high"
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          {task.priority}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteTask(task.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500"
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

          {/* Overdue Tasks Strip */}
          {overdueTasks.length > 0 && (
            <div className="bg-rose-50/80 dark:bg-rose-950/30 rounded-3xl border border-rose-200 dark:border-rose-900/60 p-4 space-y-3">
              <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-bold text-xs">
                <AlertCircle className="w-4 h-4" />
                <span>{overdueTasks.length} Overdue Tasks</span>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {overdueTasks.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => onEditTask(t)}
                    className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-100 dark:border-rose-900/40 text-xs flex items-center justify-between cursor-pointer hover:border-rose-300"
                  >
                    <div className="min-w-0 pr-2">
                      <span className="font-bold text-slate-800 dark:text-slate-100 block truncate">
                        {t.title}
                      </span>
                      <span className="text-[11px] text-rose-500 font-semibold">
                        Due {t.dueDate}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        // Reschedule to today
                        onEditTask({ ...t, dueDate: todayStr });
                      }}
                      className="px-2 py-1 rounded-lg bg-rose-100 dark:bg-rose-900/50 hover:bg-rose-200 text-rose-700 dark:text-rose-300 text-[11px] font-bold shrink-0"
                    >
                      Move to Today
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

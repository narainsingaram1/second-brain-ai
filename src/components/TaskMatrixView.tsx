import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Task, TaskStatus, TaskAppearance, CalendarEvent } from "../types";
import {
  Calendar,
  CalendarPlus,
  Plus,
  Check,
  Trash2,
  FolderPlus,
  FolderMinus,
  Pencil,
  X,
  Layers,
  CheckSquare,
  Palette,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
} from "lucide-react";
import { TaskAppearanceEditor, TaskIcon } from "./TaskAppearanceEditor";
import {
  TASK_ACCENTS,
  defaultTaskIcon,
  normalizeTaskAppearance,
  taskIconKey,
  taskAccentStyle,
  subsectionStyle,
} from "../utils/taskAppearance";
import "../taskMatrix.css";
import { TaskCalendarView } from "./TaskCalendarView";
import { TaskSimpleView } from "./TaskSimpleView";

interface TaskMatrixViewProps {
  tasks: Task[];
  events?: CalendarEvent[];
  onAddEvent?: (date?: string) => void;
  onEditEvent?: (event: CalendarEvent) => void;
  appearance?: TaskAppearance;
  onAppearanceChange?: (appearance: TaskAppearance) => void;
  sections: string[];
  subsections: Record<string, string[]>;
  onToggleTask: (taskId: string) => void;
  onStatusChange?: (taskId: string, status: TaskStatus) => void;
  onAddTask: (
    section?: string,
    subsection?: string,
    defaultDueDate?: string,
  ) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onSaveTask?: (task: Task) => void;
  onAIBreakdown?: (task: Task) => void;
  onAddSection: (sectionName: string) => void;
  onDeleteSection: (sectionName: string) => void;
  onAddSubsection: (section: string, subsectionName: string) => void;
  onDeleteSubsection: (section: string, subsectionName: string) => void;
  onRenameSubsection: (
    section: string,
    oldName: string,
    newName: string,
  ) => void;
  onMoveTask: (
    taskId: string,
    targetSection: string,
    targetSubsection?: string,
  ) => void;
}

type FilterTab = "all" | "upcoming" | "in_progress" | "completed";
type SortOption = "dueDate" | "priority" | "status" | "title";

const PRIORITY_ORDER: Record<Task["priority"], number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

const STATUS_ORDER: Record<TaskStatus, number> = {
  in_progress: 1,
  not_started: 2,
  completed: 3,
};

export const formatDueDateDisplay = (dueDate?: string) => {
  if (!dueDate) return null;
  const parts = dueDate.split("-");
  if (parts.length < 3) return dueDate;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return dueDate;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  const m = months[month - 1] || "";
  const d = String(day).padStart(2, "0");
  return `${m} ${d}`;
};

export const TaskMatrixView: React.FC<TaskMatrixViewProps> = ({
  tasks,
  events = [],
  onAddEvent,
  onEditEvent,
  appearance: savedAppearance,
  onAppearanceChange,
  sections,
  subsections,
  onToggleTask,
  onStatusChange,
  onAddTask,
  onEditTask,
  onDeleteTask,
  onSaveTask,
  onAddSection,
  onDeleteSection,
  onAddSubsection,
  onDeleteSubsection,
  onRenameSubsection,
  onMoveTask: _onMoveTask,
}) => {
  const [viewMode, setViewMode] = useState<"main" | "calendar" | "simple">(
    () => {
      const saved = localStorage.getItem("synapse_task_active_view");
      return saved === "calendar" || saved === "simple" ? saved : "main";
    },
  );

  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [sortBy, setSortBy] = useState<SortOption>("dueDate");
  const [showCompleted, setShowCompleted] = useState<boolean>(() => {
    const saved = localStorage.getItem("synapse_task_show_completed");
    return saved !== null ? saved === "true" : true;
  });

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [collapsedSubsections, setCollapsedSubsections] = useState<Record<string, boolean>>({});

  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [activeAddingSubFor, setActiveAddingSubFor] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState("");

  const [editingSubKey, setEditingSubKey] = useState<string | null>(null);
  const [editingSubValue, setEditingSubValue] = useState("");

  const [openMenuSubKey, setOpenMenuSubKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [editor, setEditor] = useState<{
    section?: string;
    subsection?: string;
    tab?: "style" | "icons";
  } | null>(null);
  const closeEditor = useCallback(() => setEditor(null), []);

  const appearance = normalizeTaskAppearance(savedAppearance);
  const accent =
    TASK_ACCENTS.find((item) => item.id === appearance.accent) ||
    TASK_ACCENTS[0];

  const iconName = (section: string, sub?: string) =>
    appearance.icons[taskIconKey(section, sub)] ||
    defaultTaskIcon(sub || section);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Close dropdown menu on outside click
  useEffect(() => {
    if (!openMenuSubKey) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuSubKey(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openMenuSubKey]);

  const handleToggleShowCompleted = (checked: boolean) => {
    setShowCompleted(checked);
    localStorage.setItem("synapse_task_show_completed", String(checked));
  };

  const handleViewChange = (mode: "main" | "calendar" | "simple") => {
    setViewMode(mode);
    localStorage.setItem("synapse_task_active_view", mode);
  };

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

  const handleTaskStatusChange = (task: Task, nextStatus: TaskStatus) => {
    if (onStatusChange) {
      onStatusChange(task.id, nextStatus);
    } else if (onSaveTask) {
      onSaveTask({
        ...task,
        status: nextStatus,
        completed: nextStatus === "completed",
      });
    } else {
      onToggleTask(task.id);
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    const isCompleted = (task.status || (task.completed ? "completed" : "not_started")) === "completed";
    handleTaskStatusChange(task, isCompleted ? "not_started" : "completed");
  };

  const handlePriorityChange = (task: Task, nextPriority: Task["priority"]) => {
    if (onSaveTask) {
      onSaveTask({ ...task, priority: nextPriority });
    } else {
      onEditTask({ ...task, priority: nextPriority });
    }
  };

  // Counts for filter pills
  const upcomingCount = useMemo(() => {
    return tasks.filter((t) => {
      const isComp = (t.status || (t.completed ? "completed" : "not_started")) === "completed";
      if (isComp) return false;
      return t.dueDate ? t.dueDate >= todayStr : true;
    }).length;
  }, [tasks, todayStr]);

  const inProgressCount = useMemo(() => {
    return tasks.filter((t) => (t.status || (t.completed ? "completed" : "not_started")) === "in_progress").length;
  }, [tasks]);

  const completedCount = useMemo(() => {
    return tasks.filter((t) => (t.status || (t.completed ? "completed" : "not_started")) === "completed").length;
  }, [tasks]);

  // Subtitle courses/categories count
  const totalSubsectionsCount = useMemo(() => {
    return sections.reduce(
      (sum, s) => sum + (subsections[s]?.length || 1),
      0
    );
  }, [sections, subsections]);

  const hasAcademic = sections.some((s) => /academic/i.test(s));
  const coursesNoun = hasAcademic
    ? totalSubsectionsCount === 1 ? "course" : "courses"
    : totalSubsectionsCount === 1 ? "section" : "sections";

  // Function to filter & sort tasks for a subsection
  const processTasks = useCallback((taskList: Task[]) => {
    let filtered = taskList;

    // Filter pill
    if (activeFilter === "upcoming") {
      filtered = filtered.filter((t) => {
        const isComp = (t.status || (t.completed ? "completed" : "not_started")) === "completed";
        if (isComp) return false;
        return t.dueDate ? t.dueDate >= todayStr : true;
      });
    } else if (activeFilter === "in_progress") {
      filtered = filtered.filter(
        (t) => (t.status || (t.completed ? "completed" : "not_started")) === "in_progress"
      );
    } else if (activeFilter === "completed") {
      filtered = filtered.filter(
        (t) => (t.status || (t.completed ? "completed" : "not_started")) === "completed"
      );
    }

    // Show completed toggle (applies when filter is "all")
    if (activeFilter === "all" && !showCompleted) {
      filtered = filtered.filter(
        (t) => (t.status || (t.completed ? "completed" : "not_started")) !== "completed"
      );
    }

    // Sorting
    return [...filtered].sort((a, b) => {
      if (sortBy === "dueDate") {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      }
      if (sortBy === "priority") {
        return (PRIORITY_ORDER[a.priority] || 3) - (PRIORITY_ORDER[b.priority] || 3);
      }
      if (sortBy === "status") {
        const statusA = a.status || (a.completed ? "completed" : "not_started");
        const statusB = b.status || (b.completed ? "completed" : "not_started");
        return (STATUS_ORDER[statusA] || 2) - (STATUS_ORDER[statusB] || 2);
      }
      if (sortBy === "title") {
        return a.title.localeCompare(b.title);
      }
      return 0;
    });
  }, [activeFilter, showCompleted, sortBy, todayStr]);

  const getBadgeClass = (accentId: string, name: string) => {
    switch (accentId) {
      case "green":
      case "teal":
        return "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-100/50 dark:border-emerald-900/30";
      case "blue":
      case "indigo":
        return "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/30";
      case "purple":
        return "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400 border border-violet-100/50 dark:border-violet-900/30";
      case "rose":
        return "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-100/50 dark:border-rose-900/30";
      case "orange":
        return "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-100/50 dark:border-amber-900/30";
      default:
        if (/cs\b|comp|code|tech|neural|algo/i.test(name)) {
          return "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-100/50 dark:border-emerald-900/30";
        }
        return "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/30";
    }
  };

  return (
    <div
      className="task-workspace animate-fade-in"
      style={
        {
          "--task-accent-light": accent.light,
          "--task-accent-dark": accent.dark,
          "--task-rgb": accent.rgb,
        } as React.CSSProperties
      }
    >
      {/* ========================================================= */}
      {/* PAGE HEADER: Title, Courses Subtitle, Top Action Buttons  */}
      {/* ========================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Tasks
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 font-normal">
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"} • {totalSubsectionsCount} {coursesNoun}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/80 transition-colors shadow-2xs"
            onClick={() => setEditor({})}
          >
            <Palette size={16} className="text-zinc-500 dark:text-zinc-400" />
            <span>Appearance</span>
            <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400" />
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/80 transition-colors shadow-2xs"
            onClick={() => {
              setIsAddingSection(true);
              handleViewChange("main");
            }}
          >
            <FolderPlus size={16} className="text-zinc-500 dark:text-zinc-400" />
            <span>New section</span>
          </button>
          {onAddEvent && (
            <button
              type="button"
              className="inline-flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/80 transition-colors shadow-2xs"
              onClick={() => onAddEvent()}
            >
              <CalendarPlus size={16} className="text-zinc-500 dark:text-zinc-400" />
              <span>New event</span>
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 rounded-lg transition-colors shadow-2xs"
            onClick={() => onAddTask(sections[0] || "Academic")}
          >
            <Plus size={16} strokeWidth={2.2} />
            <span>Add task</span>
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* VIEW SWITCHER TABS: Sections | Calendar | Checklist       */}
      {/* ========================================================= */}
      <div className="mb-6">
        <div className="inline-flex p-1 bg-zinc-100 dark:bg-zinc-800/80 rounded-xl border border-zinc-200/80 dark:border-zinc-700/60" aria-label="Task view">
          {(
            [
              { id: "main", label: "Sections", Icon: Layers },
              { id: "calendar", label: "Calendar", Icon: Calendar },
              { id: "simple", label: "Checklist", Icon: CheckSquare },
            ] as const
          ).map(({ id, label, Icon }) => {
            const isActive = viewMode === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={isActive}
                onClick={() => handleViewChange(id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-lg transition-all ${
                  isActive
                    ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xs border border-zinc-200/60 dark:border-zinc-700/50"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent"
                }`}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Sections View vs Calendar vs Checklist */}
      {viewMode === "calendar" ? (
        <TaskCalendarView
          tasks={tasks}
          sections={sections}
          subsections={subsections}
          onToggleTask={onToggleTask}
          onStatusChange={onStatusChange}
          onAddTask={onAddTask}
          onEditTask={onEditTask}
          onSaveTask={onSaveTask || onEditTask}
          onDeleteTask={onDeleteTask}
          events={events}
          onAddEvent={onAddEvent}
          onEditEvent={onEditEvent}
        />
      ) : viewMode === "simple" ? (
        <TaskSimpleView
          tasks={tasks}
          sections={sections}
          subsections={subsections}
          onToggleTask={onToggleTask}
          onStatusChange={onStatusChange}
          onAddTask={onAddTask}
          onEditTask={onEditTask}
          onDeleteTask={onDeleteTask}
          onSaveTask={onSaveTask || onEditTask}
        />
      ) : (
        <div className="task-sections-container">
          {/* ========================================================= */}
          {/* FILTER & SORT BAR: Pills, Sort Dropdown, Show Completed   */}
          {/* ========================================================= */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 mb-6 border-b border-zinc-200/70 dark:border-zinc-800">
            {/* Filter Pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setActiveFilter("all")}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all flex items-center gap-1.5 ${
                  activeFilter === "all"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80 shadow-2xs"
                    : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                }`}
              >
                <span>All</span>
                <span className="font-mono">{tasks.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("upcoming")}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all flex items-center gap-1.5 ${
                  activeFilter === "upcoming"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80 shadow-2xs"
                    : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                }`}
              >
                <span>Upcoming</span>
                <span className="font-mono">{upcomingCount}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("in_progress")}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all flex items-center gap-1.5 ${
                  activeFilter === "in_progress"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80 shadow-2xs"
                    : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                }`}
              >
                <span>In progress</span>
                <span className="font-mono">{inProgressCount}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("completed")}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all flex items-center gap-1.5 ${
                  activeFilter === "completed"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80 shadow-2xs"
                    : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                }`}
              >
                <span>Completed</span>
                <span className="font-mono">{completedCount}</span>
              </button>
            </div>

            {/* Right Controls: Sort & Show Completed */}
            <div className="flex items-center gap-5">
              {/* Sort Dropdown */}
              <div className="relative inline-flex items-center gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                <span>Sort:</span>
                <span className="text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
                  {sortBy === "dueDate" && "Due date"}
                  {sortBy === "priority" && "Priority"}
                  {sortBy === "status" && "Status"}
                  {sortBy === "title" && "Title"}
                  <ChevronDown size={14} className="text-zinc-400" />
                </span>
                <select
                  aria-label="Sort tasks by"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                >
                  <option value="dueDate">Due date</option>
                  <option value="priority">Priority</option>
                  <option value="status">Status</option>
                  <option value="title">Title</option>
                </select>
              </div>

              {/* Show Completed Checkbox */}
              <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={(e) => handleToggleShowCompleted(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500 dark:bg-zinc-800 cursor-pointer"
                />
                <span>Show completed</span>
              </label>
            </div>
          </div>

          {/* New Section Inline Form */}
          {isAddingSection && (
            <form className="flex items-center gap-3 p-3 mb-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xs" onSubmit={handleCreateSection}>
              <FolderPlus size={18} className="text-zinc-500" />
              <input
                autoFocus
                aria-label="New section name"
                placeholder="New section name…"
                value={newSectionName}
                onChange={(event) => setNewSectionName(event.target.value)}
                className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Create section
              </button>
              <button
                type="button"
                onClick={() => setIsAddingSection(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg"
                aria-label="Cancel new section"
              >
                <X size={16} />
              </button>
            </form>
          )}

          {/* Empty State */}
          {sections.length === 0 && !isAddingSection && (
            <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white/50 dark:bg-zinc-900/50">
              <Layers size={36} className="text-zinc-400 mb-3" />
              <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">A little space to get organized</h4>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm">Create your first section for work, study, or life.</p>
              <button
                className="inline-flex items-center gap-1.5 mt-4 px-3.5 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50"
                onClick={() => setIsAddingSection(true)}
              >
                <Plus size={16} />
                New section
              </button>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTIONS & SUBSECTIONS LIST                               */}
          {/* ========================================================= */}
          <div className="space-y-8">
            {sections.map((section) => {
              const sectionSubs = subsections[section] || ["General"];
              const sectionTasks = tasks.filter(
                (task) => (task.section || "Academic") === section,
              );
              const isSectionCollapsed = collapsedSections[section];

              return (
                <section
                  key={section}
                  className="task-section-group"
                  aria-label={section}
                >
                  {/* LEVEL 1: Section Header (e.g. Academic 15 tasks) */}
                  <div className="flex items-center justify-between mb-4 group/section">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedSections((prev) => ({
                            ...prev,
                            [section]: !prev[section],
                          }))
                        }
                        className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors p-0.5"
                        aria-label={isSectionCollapsed ? `Expand ${section}` : `Collapse ${section}`}
                      >
                        {isSectionCollapsed ? (
                          <ChevronRight size={18} />
                        ) : (
                          <ChevronDown size={18} />
                        )}
                      </button>

                      {/* Section Icon Badge */}
                      <button
                        type="button"
                        onClick={() => setEditor({ section, tab: "icons" })}
                        className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/30 flex items-center justify-center flex-shrink-0 transition-transform active:scale-95"
                        title="Change section icon"
                        aria-label={`Change icon for ${section}`}
                      >
                        <TaskIcon name={iconName(section)} className="w-4 h-4" />
                      </button>

                      {/* Section Title */}
                      <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                        {section}
                      </h2>

                      {/* Section Task Count */}
                      <span className="text-sm text-zinc-500 dark:text-zinc-400 font-normal">
                        {sectionTasks.length} {sectionTasks.length === 1 ? "task" : "tasks"}
                      </span>
                    </div>

                    {/* Section Level Actions (Add Subsection, Delete Section) */}
                    <div className="flex items-center gap-2 opacity-0 group-hover/section:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveAddingSubFor(section);
                          setNewSubName("");
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                      >
                        <Plus size={13} />
                        <span>Subsection</span>
                      </button>
                      {sections.length > 1 && (
                        <button
                          type="button"
                          className="p-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg transition-colors"
                          aria-label={`Delete section ${section}`}
                          onClick={() => {
                            if (
                              confirm(
                                `Delete the "${section}" section? All tasks inside will be moved to another section.`,
                              )
                            )
                              onDeleteSection(section);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline Form to Add New Subsection */}
                  {activeAddingSubFor === section && (
                    <form
                      className="flex items-center gap-3 p-3 mb-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xs"
                      onSubmit={(event) => handleCreateSubsection(section, event)}
                    >
                      <input
                        autoFocus
                        aria-label={`New subsection in ${section}`}
                        placeholder="Subsection or course name…"
                        value={newSubName}
                        onChange={(event) => setNewSubName(event.target.value)}
                        className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel new subsection"
                        onClick={() => setActiveAddingSubFor(null)}
                        className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg"
                      >
                        <X size={16} />
                      </button>
                    </form>
                  )}

                  {/* LEVEL 2: Subsections / Courses Cards */}
                  {!isSectionCollapsed && (
                    <div className="space-y-4">
                      {sectionSubs.map((sub) => {
                        const localStyle = subsectionStyle(
                          appearance,
                          section,
                          sub,
                        );
                        const subTasks = sectionTasks.filter(
                          (task) => (task.subsection || "General") === sub,
                        );
                        const displayedTasks = processTasks(subTasks);
                        const subKey = `${section}::${sub}`;
                        const isSubCollapsed = collapsedSubsections[subKey];
                        const isMenuOpen = openMenuSubKey === subKey;
                        const badgeStyleClass = getBadgeClass(localStyle.accent, sub);

                        return (
                          <div
                            key={sub}
                            style={taskAccentStyle(localStyle.accent)}
                            className="bg-white dark:bg-[#19191b] border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-xs overflow-hidden transition-all"
                            aria-label={`${section} / ${sub}`}
                          >
                            {/* Course / Subsection Card Header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/80 bg-white dark:bg-[#19191b]">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCollapsedSubsections((prev) => ({
                                      ...prev,
                                      [subKey]: !prev[subKey],
                                    }))
                                  }
                                  className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors p-0.5"
                                  aria-label={isSubCollapsed ? `Expand ${sub}` : `Collapse ${sub}`}
                                >
                                  {isSubCollapsed ? (
                                    <ChevronRight size={17} />
                                  ) : (
                                    <ChevronDown size={17} />
                                  )}
                                </button>

                                {/* Course / Subsection Icon Badge */}
                                <button
                                  type="button"
                                  onClick={() => setEditor({ section, subsection: sub, tab: "icons" })}
                                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform active:scale-95 ${badgeStyleClass}`}
                                  title="Change subsection icon"
                                  aria-label={`Change icon for ${sub}`}
                                >
                                  <TaskIcon name={iconName(section, sub)} className="w-4 h-4" />
                                </button>

                                {/* Title & Inline Rename */}
                                {editingSubKey === subKey ? (
                                  <form
                                    className="flex items-center gap-1.5"
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      handleSaveRename(section, sub);
                                    }}
                                  >
                                    <input
                                      autoFocus
                                      aria-label="Subsection name"
                                      value={editingSubValue}
                                      onChange={(event) =>
                                        setEditingSubValue(event.target.value)
                                      }
                                      onKeyDown={(event) => {
                                        if (event.key === "Escape") setEditingSubKey(null);
                                      }}
                                      className="px-2 py-0.5 text-[15px] font-semibold text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none"
                                    />
                                    <button
                                      type="submit"
                                      className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                                      aria-label="Save subsection name"
                                    >
                                      <Check size={15} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingSubKey(null)}
                                      className="p-1 text-zinc-400 hover:bg-zinc-100 rounded"
                                      aria-label="Cancel rename"
                                    >
                                      <X size={15} />
                                    </button>
                                  </form>
                                ) : (
                                  <div className="flex items-baseline gap-2 min-w-0">
                                    <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight truncate">
                                      {sub}
                                    </h3>
                                    <span className="text-xs text-zinc-500 dark:text-zinc-400 font-normal">
                                      {subTasks.length} {subTasks.length === 1 ? "task" : "tasks"}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Subsection Card Actions: + Add task & ... menu */}
                              <div className="flex items-center gap-2 relative">
                                <button
                                  type="button"
                                  onClick={() => onAddTask(section, sub)}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/80 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors shadow-2xs"
                                >
                                  <Plus size={14} strokeWidth={2.2} />
                                  <span>Add task</span>
                                </button>

                                {/* More Action Menu */}
                                <div className="relative">
                                  <button
                                    type="button"
                                    onClick={() => setOpenMenuSubKey(isMenuOpen ? null : subKey)}
                                    className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 bg-white dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/80 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors shadow-2xs"
                                    aria-label={`Options for ${sub}`}
                                  >
                                    <MoreHorizontal size={16} />
                                  </button>

                                  {isMenuOpen && (
                                    <div
                                      ref={menuRef}
                                      className="absolute right-0 top-full mt-1.5 w-44 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg py-1 z-30 animate-fade-in"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingSubKey(subKey);
                                          setEditingSubValue(sub);
                                          setOpenMenuSubKey(null);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-left"
                                      >
                                        <Pencil size={13} className="text-zinc-400" />
                                        <span>Rename</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditor({
                                            section,
                                            subsection: sub,
                                            tab: "style",
                                          });
                                          setOpenMenuSubKey(null);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-left"
                                      >
                                        <Palette size={13} className="text-zinc-400" />
                                        <span>Customize appearance</span>
                                      </button>
                                      {sectionSubs.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenMenuSubKey(null);
                                            if (
                                              confirm(
                                                `Delete "${sub}"? Tasks will move to ${sectionSubs.find((name) => name !== sub)}.`,
                                              )
                                            )
                                              onDeleteSubsection(section, sub);
                                          }}
                                          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-left border-t border-zinc-100 dark:border-zinc-800"
                                        >
                                          <FolderMinus size={13} />
                                          <span>Delete subsection</span>
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* LEVEL 3: Tasks Table Inside Subsection Card */}
                            {!isSubCollapsed && (
                              <div>
                                {displayedTasks.length > 0 && (
                                  /* Column Headers */
                                  <div className="grid grid-cols-[1fr_130px_110px_100px_60px] items-center px-4 py-2 bg-zinc-50/50 dark:bg-zinc-900/40 border-b border-zinc-100 dark:border-zinc-800/60 text-xs font-medium text-zinc-400 dark:text-zinc-500">
                                    <div className="pl-8">Task</div>
                                    <div>Status</div>
                                    <div>Due</div>
                                    <div>Priority</div>
                                    <div></div>
                                  </div>
                                )}

                                {displayedTasks.length === 0 ? (
                                  <div className="px-6 py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
                                    {subTasks.length === 0 ? (
                                      <div>
                                        <p>No tasks yet for {sub}.</p>
                                        <button
                                          type="button"
                                          onClick={() => onAddTask(section, sub)}
                                          className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-100 transition-colors"
                                        >
                                          <Plus size={14} />
                                          Add first task
                                        </button>
                                      </div>
                                    ) : (
                                      <p>No tasks match the active filter.</p>
                                    )}
                                  </div>
                                ) : (
                                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                                    {displayedTasks.map((task) => {
                                      const status =
                                        task.status ||
                                        (task.completed ? "completed" : "not_started");
                                      const isCompleted = status === "completed";
                                      const overdue = Boolean(
                                        task.dueDate &&
                                          task.dueDate < todayStr &&
                                          !isCompleted,
                                      );
                                      const formattedDue = formatDueDateDisplay(task.dueDate);

                                      return (
                                        <div
                                          key={task.id}
                                          className="grid grid-cols-[1fr_130px_110px_100px_60px] items-center px-4 py-2.5 min-h-[52px] hover:bg-zinc-50/60 dark:hover:bg-zinc-800/25 transition-colors group"
                                        >
                                          {/* Column 1: Checkbox & Task Title / Subtitle */}
                                          <div className="flex items-center gap-3 min-w-0 pr-3">
                                            {/* Completion Checkbox */}
                                            <button
                                              type="button"
                                              onClick={(e) => handleCheckboxClick(e, task)}
                                              className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer ${
                                                isCompleted
                                                  ? "bg-blue-600 dark:bg-blue-500 text-white shadow-2xs"
                                                  : "border-2 border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 dark:hover:border-zinc-500"
                                              }`}
                                              aria-label={`${task.title}: mark as ${isCompleted ? "uncompleted" : "completed"}`}
                                            >
                                              {isCompleted && (
                                                <Check size={12} strokeWidth={2.8} />
                                              )}
                                            </button>

                                            {/* Title & Description Subtitle */}
                                            <button
                                              type="button"
                                              onClick={() => onEditTask(task)}
                                              className="text-left min-w-0 flex-1 truncate group-hover/title"
                                            >
                                              <span
                                                className={`text-sm truncate block transition-colors ${
                                                  isCompleted
                                                    ? "line-through text-zinc-400 dark:text-zinc-500 font-normal"
                                                    : "text-zinc-900 dark:text-zinc-100 font-medium hover:text-blue-600 dark:hover:text-blue-400"
                                                }`}
                                              >
                                                {task.title}
                                              </span>
                                              {task.description && (
                                                <span className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate block">
                                                  {task.description}
                                                </span>
                                              )}
                                            </button>
                                          </div>

                                          {/* Column 2: Status Pill Dropdown */}
                                          <div>
                                            <div className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/90 text-xs font-medium text-zinc-700 dark:text-zinc-300 shadow-2xs hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors">
                                              <span
                                                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                                  status === "in_progress"
                                                    ? "bg-emerald-500"
                                                    : status === "completed"
                                                      ? "bg-emerald-500"
                                                      : "bg-zinc-400"
                                                }`}
                                              />
                                              <span>
                                                {status === "in_progress" && "In progress"}
                                                {status === "not_started" && "Not started"}
                                                {status === "completed" && "Complete"}
                                              </span>
                                              <ChevronDown
                                                size={12}
                                                className="text-zinc-400 ml-0.5 flex-shrink-0"
                                              />
                                              <select
                                                aria-label={`Status for ${task.title}`}
                                                value={status}
                                                onChange={(e) =>
                                                  handleTaskStatusChange(
                                                    task,
                                                    e.target.value as TaskStatus,
                                                  )
                                                }
                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                              >
                                                <option value="not_started">Not started</option>
                                                <option value="in_progress">In progress</option>
                                                <option value="completed">Complete</option>
                                              </select>
                                            </div>
                                          </div>

                                          {/* Column 3: Due Date */}
                                          <div>
                                            {formattedDue ? (
                                              <button
                                                type="button"
                                                onClick={() => onEditTask(task)}
                                                className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${
                                                  overdue
                                                    ? "text-red-600 dark:text-red-400 font-semibold"
                                                    : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-900"
                                                }`}
                                              >
                                                <Calendar size={13} className="text-zinc-400 flex-shrink-0" />
                                                <span>{formattedDue}</span>
                                              </button>
                                            ) : (
                                              <button
                                                type="button"
                                                onClick={() => onEditTask(task)}
                                                className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600"
                                              >
                                                <Calendar size={13} className="text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
                                                <span>No date</span>
                                              </button>
                                            )}
                                          </div>

                                          {/* Column 4: Priority Pill Dropdown */}
                                          <div>
                                            <div className="relative inline-flex items-center justify-between gap-1.5 px-2.5 py-1 min-w-[84px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/90 text-xs font-medium text-zinc-700 dark:text-zinc-300 shadow-2xs hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors">
                                              <span>
                                                {task.priority.charAt(0).toUpperCase() +
                                                  task.priority.slice(1)}
                                              </span>
                                              <ChevronDown
                                                size={12}
                                                className="text-zinc-400 flex-shrink-0"
                                              />
                                              <select
                                                aria-label={`Priority for ${task.title}`}
                                                value={task.priority}
                                                onChange={(e) =>
                                                  handlePriorityChange(
                                                    task,
                                                    e.target.value as Task["priority"],
                                                  )
                                                }
                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                              >
                                                <option value="low">Low</option>
                                                <option value="medium">Medium</option>
                                                <option value="high">High</option>
                                                <option value="urgent">Urgent</option>
                                              </select>
                                            </div>
                                          </div>

                                          {/* Task Actions (Edit & Delete) */}
                                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                              type="button"
                                              onClick={() => onEditTask(task)}
                                              className="p-1 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded"
                                              aria-label={`Edit task ${task.title}`}
                                              title="Edit task"
                                            >
                                              <Pencil size={14} />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => onDeleteTask(task.id)}
                                              className="p-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 transition-colors rounded"
                                              aria-label={`Delete task ${task.title}`}
                                              title="Delete task"
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {/* Task Appearance Editor Modal */}
      {editor && (
        <TaskAppearanceEditor
          appearance={appearance}
          iconTarget={editor.subsection || editor.section}
          initialTab={editor.tab || "style"}
          selectedStyle={
            editor.section && editor.subsection
              ? subsectionStyle(appearance, editor.section, editor.subsection)
              : undefined
          }
          onStyleChange={(style) => {
            if (!editor.section || !editor.subsection) return;
            onAppearanceChange?.({
              ...appearance,
              subsections: {
                ...appearance.subsections,
                [taskIconKey(editor.section, editor.subsection)]: style,
              },
            });
          }}
          selectedIcon={
            editor.section
              ? iconName(editor.section, editor.subsection)
              : undefined
          }
          onChange={(next) => onAppearanceChange?.(next)}
          onIcon={(icon) => {
            if (!editor.section) return;
            const icons = { ...appearance.icons };
            const key = taskIconKey(editor.section, editor.subsection);
            if (icon) icons[key] = icon;
            else delete icons[key];
            onAppearanceChange?.({ ...appearance, icons });
          }}
          onClose={closeEditor}
        />
      )}
    </div>
  );
};

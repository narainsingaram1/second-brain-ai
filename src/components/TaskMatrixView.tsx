import React, { useState, useCallback } from "react";
import { Task, TaskStatus, TaskAppearance } from "../types";
import {
  Calendar,
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
  Clock,
  ChevronDown,
} from "lucide-react";
import { TaskHeaderVisual, TaskEmptyVisual } from "./TaskHeaderVisual";
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
import confetti from "canvas-confetti";
import { TaskCalendarView } from "./TaskCalendarView";
import { TaskSimpleView } from "./TaskSimpleView";

interface TaskMatrixViewProps {
  tasks: Task[];
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

export const TaskMatrixView: React.FC<TaskMatrixViewProps> = ({
  tasks,
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
  onMoveTask,
}) => {
  const [viewMode, setViewMode] = useState<"main" | "calendar" | "simple">(
    () => {
      const saved = localStorage.getItem("synapse_task_active_view");
      return saved === "calendar" || saved === "simple" ? saved : "main";
    },
  );

  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [activeAddingSubFor, setActiveAddingSubFor] = useState<string | null>(
    null,
  );
  const [newSubName, setNewSubName] = useState("");

  // Subsection inline rename state: key is `${section}::${subName}`
  const [editingSubKey, setEditingSubKey] = useState<string | null>(null);
  const [editingSubValue, setEditingSubValue] = useState("");

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
  const iconButton = (section: string, sub?: string) => (
    <button
      type="button"
      className="task-icon-tile"
      aria-label={`Change icon for ${sub || section}`}
      title="Change icon"
      onClick={() => setEditor({ section, subsection: sub, tab: "icons" })}
    >
      <TaskIcon name={iconName(section, sub)} />
    </button>
  );
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

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

  const handleCycleStatus = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    const current =
      task.status || (task.completed ? "completed" : "not_started");
    let next: TaskStatus;
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

  const pendingCount = tasks.filter(
    (t) =>
      (t.status || (t.completed ? "completed" : "not_started")) !== "completed",
  ).length;
  const inProgressCount = tasks.filter(
    (t) => t.status === "in_progress",
  ).length;

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
      <div className="task-page-header">
        <div>
          <span className="task-eyebrow">YOUR WORKSPACE</span>
          <h1>Tasks</h1>
          <p>
            {pendingCount} active · {inProgressCount} in progress ·{" "}
            {sections.length} {sections.length === 1 ? "area" : "areas"}
          </p>
        </div>
        <div className="task-header-actions">
          <button
            type="button"
            className="task-secondary"
            onClick={() => setEditor({})}
          >
            <Palette size={16} />
            <span>Appearance</span>
            <span className="task-accent-dot" />
          </button>
          <button
            type="button"
            className="task-secondary"
            onClick={() => {
              setIsAddingSection(true);
              handleViewChange("main");
            }}
          >
            <FolderPlus size={16} />
            <span>New section</span>
          </button>
          <button
            type="button"
            className="task-primary"
            onClick={() => onAddTask(sections[0] || "Academic")}
          >
            <Plus size={17} />
            Add task
          </button>
        </div>
      </div>
      <div className="task-view-toolbar">
        <div className="task-view-tabs" aria-label="Task view">
          {(
            [
              { id: "main", label: "Sections", Icon: Layers },
              { id: "calendar", label: "Calendar", Icon: Calendar },
              { id: "simple", label: "Checklist", Icon: CheckSquare },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={viewMode === id}
              onClick={() => handleViewChange(id)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
        <span className="task-toolbar-hint">
          {viewMode === "main"
            ? "A place for everything you’re working on"
            : viewMode === "calendar"
              ? "Plan your days, at a glance"
              : "One task at a time"}
        </span>
      </div>

      {viewMode === "calendar" ? (
        <TaskCalendarView
          tasks={tasks}
          sections={sections}
          subsections={subsections}
          onToggleTask={onToggleTask}
          onStatusChange={onStatusChange}
          onAddTask={onAddTask}
          onEditTask={onEditTask}
          onDeleteTask={onDeleteTask}
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
        <div className="task-sections">
          {isAddingSection && (
            <form className="task-inline-form" onSubmit={handleCreateSection}>
              <FolderPlus size={19} />
              <input
                autoFocus
                aria-label="New section name"
                placeholder="New section name…"
                value={newSectionName}
                onChange={(event) => setNewSectionName(event.target.value)}
              />
              <button className="task-primary" type="submit">
                Create section
              </button>
              <button
                className="task-icon-action"
                type="button"
                onClick={() => setIsAddingSection(false)}
                aria-label="Cancel new section"
              >
                <X size={17} />
              </button>
            </form>
          )}
          {sections.length === 0 && !isAddingSection && (
            <div className="task-empty">
              <Layers size={35} />
              <div>
                <h4>A little space to get organized</h4>
                <p>Create your first section for work, study, or life.</p>
                <button
                  className="task-outline"
                  onClick={() => setIsAddingSection(true)}
                >
                  <Plus size={16} />
                  New section
                </button>
              </div>
            </div>
          )}
          {sections.map((section) => {
            const sectionSubs = subsections[section] || ["General"];
            const sectionTasks = tasks.filter(
              (task) => (task.section || "Academic") === section,
            );
            return (
              <section
                key={section}
                className="task-section"
                aria-label={section}
              >
                <header className="task-section-header">
                  <div className="task-section-heading">
                    {iconButton(section)}
                    <h2>{section}</h2>
                    <span className="task-count">
                      {sectionTasks.length}{" "}
                      {sectionTasks.length === 1 ? "task" : "tasks"}
                    </span>
                  </div>
                  <div className="task-section-actions">
                    <button
                      className="task-secondary"
                      onClick={() => {
                        setActiveAddingSubFor(section);
                        setNewSubName("");
                      }}
                    >
                      <Layers size={16} />
                      <span>Subsection</span>
                    </button>
                    <button
                      className="task-primary"
                      onClick={() => onAddTask(section, sectionSubs[0])}
                    >
                      <Plus size={17} />
                      <span>Add task</span>
                    </button>
                    {sections.length > 1 && (
                      <button
                        className="task-icon-action task-danger"
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
                        <Trash2 size={17} />
                      </button>
                    )}
                  </div>
                </header>
                {activeAddingSubFor === section && (
                  <form
                    className="task-inline-form"
                    onSubmit={(event) => handleCreateSubsection(section, event)}
                  >
                    <input
                      autoFocus
                      aria-label={`New subsection in ${section}`}
                      placeholder="Subsection name…"
                      value={newSubName}
                      onChange={(event) => setNewSubName(event.target.value)}
                    />
                    <button type="submit" className="task-primary">
                      Add
                    </button>
                    <button
                      className="task-icon-action"
                      type="button"
                      aria-label="Cancel new subsection"
                      onClick={() => setActiveAddingSubFor(null)}
                    >
                      <X size={17} />
                    </button>
                  </form>
                )}
                <div className="task-subsections">
                  {sectionSubs.map((sub) => {
                    const localStyle = subsectionStyle(
                      appearance,
                      section,
                      sub,
                    );
                    const subTasks = sectionTasks.filter(
                      (task) => (task.subsection || "General") === sub,
                    );
                    const subKey = `${section}::${sub}`;
                    return (
                      <section
                        className="task-subsection"
                        style={taskAccentStyle(localStyle.accent)}
                        key={sub}
                        aria-label={`${section} / ${sub}`}
                      >
                        <header className="task-subsection-header">
                          <TaskHeaderVisual visual={localStyle.visual} />
                          <div className="task-subsection-heading">
                            {iconButton(section, sub)}
                            {editingSubKey === subKey ? (
                              <form
                                className="task-rename-form"
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
                                    if (event.key === "Escape")
                                      setEditingSubKey(null);
                                  }}
                                />
                                <button
                                  type="submit"
                                  className="task-icon-action"
                                  aria-label="Save subsection name"
                                >
                                  <Check size={16} />
                                </button>
                                <button
                                  type="button"
                                  className="task-icon-action"
                                  aria-label="Cancel rename"
                                  onClick={() => setEditingSubKey(null)}
                                >
                                  <X size={16} />
                                </button>
                              </form>
                            ) : (
                              <>
                                <h3>{sub}</h3>
                                <span className="task-count">
                                  {subTasks.length}{" "}
                                  {subTasks.length === 1 ? "task" : "tasks"}
                                </span>
                                <button
                                  className="task-icon-action task-rename"
                                  aria-label={`Rename ${sub}`}
                                  onClick={() => {
                                    setEditingSubKey(subKey);
                                    setEditingSubValue(sub);
                                  }}
                                >
                                  <Pencil size={15} />
                                </button>
                              </>
                            )}
                          </div>
                          <div className="task-subsection-actions">
                            <button
                              type="button"
                              className="task-icon-action task-customize"
                              aria-label={`Customize ${sub}`}
                              title="Customize color & artwork"
                              onClick={() =>
                                setEditor({
                                  section,
                                  subsection: sub,
                                  tab: "style",
                                })
                              }
                            >
                              <Palette size={17} />
                            </button>
                            <button
                              className="task-text-button"
                              onClick={() => onAddTask(section, sub)}
                            >
                              <Plus size={17} />
                              <span>Add task</span>
                            </button>
                            {sectionSubs.length > 1 && (
                              <button
                                className="task-icon-action task-danger task-remove-sub"
                                aria-label={`Delete subsection ${sub}`}
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Delete "${sub}"? Tasks will move to ${sectionSubs.find((name) => name !== sub)}.`,
                                    )
                                  )
                                    onDeleteSubsection(section, sub);
                                }}
                              >
                                <FolderMinus size={17} />
                              </button>
                            )}
                          </div>
                        </header>
                        {subTasks.length === 0 ? (
                          <div className="task-empty">
                            <div className="task-empty-icon">
                              <TaskEmptyVisual />
                            </div>
                            <div>
                              <h4>No tasks yet</h4>
                              <p>Add a task to get started for {sub}.</p>
                              <button
                                className="task-outline"
                                onClick={() => onAddTask(section, sub)}
                              >
                                <Plus size={16} />
                                Add task
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="task-rows">
                            {subTasks.map((task) => {
                              const status =
                                task.status ||
                                (task.completed ? "completed" : "not_started");
                              const overdue = Boolean(
                                task.dueDate &&
                                  task.dueDate < todayStr &&
                                  status !== "completed",
                              );
                              return (
                                <div
                                  className={`task-row task-row-${status}`}
                                  key={task.id}
                                >
                                  <button
                                    className={`task-completion task-completion-${status}`}
                                    onClick={(event) =>
                                      handleCycleStatus(event, task)
                                    }
                                    aria-label={`${task.title}: ${status === "completed" ? "reset to not started" : status === "in_progress" ? "mark complete" : "start task"}`}
                                  >
                                    {status === "completed" ? (
                                      <Check size={15} />
                                    ) : status === "in_progress" ? (
                                      <span />
                                    ) : null}
                                  </button>
                                  <button
                                    className="task-title-button"
                                    onClick={() => onEditTask(task)}
                                  >
                                    <span>{task.title}</span>
                                    {task.description && (
                                      <p>
                                        <Clock size={13} />
                                        <span>{task.description}</span>
                                      </p>
                                    )}
                                  </button>
                                  <div className="task-row-meta">
                                    <label
                                      className={`task-select task-status-${status}`}
                                    >
                                      <span className="task-status-dot" />
                                      <select
                                        aria-label={`Status for ${task.title}`}
                                        value={status}
                                        onChange={(event) => {
                                          if (onStatusChange)
                                            onStatusChange(
                                              task.id,
                                              event.target.value as TaskStatus,
                                            );
                                          else onToggleTask(task.id);
                                        }}
                                      >
                                        <option value="not_started">
                                          Not started
                                        </option>
                                        <option value="in_progress">
                                          In progress
                                        </option>
                                        <option value="completed">
                                          Complete
                                        </option>
                                      </select>
                                      <ChevronDown size={13} />
                                    </label>
                                    <label className="task-select task-area-select">
                                      <TaskIcon name={iconName(section, sub)} />
                                      <select
                                        aria-label={`Move ${task.title}`}
                                        value={JSON.stringify([
                                          task.section || section,
                                          task.subsection || "General",
                                        ])}
                                        onChange={(event) => {
                                          const [sec, subsection] = JSON.parse(
                                            event.target.value,
                                          );
                                          onMoveTask(task.id, sec, subsection);
                                        }}
                                      >
                                        {sections.map((sec) => (
                                          <optgroup key={sec} label={sec}>
                                            {(
                                              subsections[sec] || ["General"]
                                            ).map((item) => (
                                              <option
                                                key={item}
                                                value={JSON.stringify([
                                                  sec,
                                                  item,
                                                ])}
                                              >
                                                {sec === section
                                                  ? item
                                                  : `${sec} / ${item}`}
                                              </option>
                                            ))}
                                          </optgroup>
                                        ))}
                                      </select>
                                      <ChevronDown size={13} />
                                    </label>
                                    {task.dueDate && (
                                      <button
                                        className={`task-date ${overdue ? "task-overdue" : ""}`}
                                        onClick={() => onEditTask(task)}
                                        aria-label={`Edit due date for ${task.title}`}
                                      >
                                        <Calendar size={14} />
                                        <span>{task.dueDate}</span>
                                      </button>
                                    )}
                                    <span
                                      className={`task-priority task-priority-${task.priority}`}
                                    >
                                      {task.priority}
                                    </span>
                                    <button
                                      className="task-icon-action task-danger task-delete"
                                      aria-label={`Delete task ${task.title}`}
                                      onClick={() => onDeleteTask(task.id)}
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
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

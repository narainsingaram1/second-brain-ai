import { Task, TaskStatus } from "../types";
import { isValidTime } from "./events";

/**
 * Normalizes a Task to ensure a single, consistent source of truth.
 * The `status` field ('not_started' | 'in_progress' | 'completed') is the canonical state.
 * The `completed` boolean is always strictly synchronized: completed = (status === 'completed').
 */
export function normalizeTask(raw: Partial<Task> & { id: string; title: string }): Task {
  let status: TaskStatus;
  let completed: boolean;

  if (raw.status) {
    status = raw.status;
    completed = status === "completed";
    // Check for mismatch assertion
    if (typeof raw.completed === "boolean" && raw.completed !== completed) {
      console.warn(
        `[TaskState] Mismatch detected on task "${raw.id}" (${raw.title}): status='${raw.status}' but completed=${raw.completed}. Resolving canonically to status='${status}' (completed=${completed}).`
      );
    }
  } else if (typeof raw.completed === "boolean") {
    // Legacy store migration where only `completed` existed
    status = raw.completed ? "completed" : "not_started";
    completed = raw.completed;
  } else {
    status = "not_started";
    completed = false;
  }

  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    dueDate: raw.dueDate ?? new Date().toISOString().split("T")[0],
    // A time only means something with a date.
    ...(raw.dueDate !== "" && isValidTime(raw.dueTime) ? { dueTime: raw.dueTime } : {}),
    priority: raw.priority || "medium",
    section: raw.section || "Academic",
    subsection: raw.subsection || "General",
    status,
    completed,
    subtasks: raw.subtasks || [],
    tags: raw.tags || [],
    stage: raw.stage,
    domain: raw.domain,
  };
}

/**
 * Checks if a task is completed based on its canonical status.
 */
export function isTaskDone(task: { status?: TaskStatus; completed?: boolean }): boolean {
  if (task.status) {
    return task.status === "completed";
  }
  return !!task.completed;
}

/**
 * Sets the status of a task and synchronizes the completed flag.
 */
export function setTaskStatus(task: Task, nextStatus: TaskStatus): Task {
  return {
    ...task,
    status: nextStatus,
    completed: nextStatus === "completed",
  };
}

/**
 * Toggles a task between completed and not_started.
 */
export function toggleTaskCompleted(task: Task): Task {
  const isDone = isTaskDone(task);
  const nextStatus: TaskStatus = isDone ? "not_started" : "completed";
  return setTaskStatus(task, nextStatus);
}

/**
 * Cycles through task statuses: not_started -> in_progress -> completed -> not_started.
 */
export function cycleTaskStatus(currentStatus?: TaskStatus): TaskStatus {
  if (currentStatus === "not_started" || !currentStatus) return "in_progress";
  if (currentStatus === "in_progress") return "completed";
  return "not_started";
}

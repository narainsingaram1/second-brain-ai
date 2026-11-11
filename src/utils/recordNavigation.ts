import type { BrainState } from "../types";
import { findRecord, referenceTitle } from "./chatPresentation";

export interface RecordLocation {
  tab: string;
  workspaceId?: string;
  workspaceName?: string;
  panel?: "overview" | "tasks" | "notes" | "study" | "leetcode" | "job_application";
  panelLabel?: string;
  section?: string;
  subsection?: string;
  folderId?: string;
  folderName?: string;
  breadcrumb: string;
  label: string;
}

/**
 * Resolves the precise location within the Second Brain UI where a record lives.
 */
export function getRecordLocation(
  state: BrainState | null | undefined,
  type: string,
  id: string
): RecordLocation {
  const record = findRecord(state, type, id);

  switch (type) {
    case "tracker": {
      const tracker = record && "kind" in record ? (record as any) : undefined;
      const kind = tracker?.kind || "job_application";
      const isJob = kind === "job_application";
      const panel = isJob ? "job_application" : "leetcode";
      const panelLabel = isJob ? "Job Applications" : "LeetCode Practice";

      // Match workspace by ID, or find career template, or fallback to first workspace
      const workspace =
        (tracker?.workspaceId && state?.workspaces?.find((w) => w.id === tracker.workspaceId)) ||
        state?.workspaces?.find((w) => w.template === "career") ||
        state?.workspaces?.[0];

      const workspaceName = workspace?.name || "Career";
      const tab = workspace ? `workspace:${workspace.id}` : "workspaces";

      return {
        tab,
        workspaceId: workspace?.id,
        workspaceName,
        panel,
        panelLabel,
        breadcrumb: `${workspaceName} Workspace › ${panelLabel}`,
        label: isJob ? "Job Application" : "LeetCode Problem",
      };
    }

    case "task": {
      const task = record && "section" in record ? (record as any) : undefined;
      const section = task?.section || "Academic";
      const subsection = task?.subsection;
      const subLabel = subsection ? ` › ${subsection}` : "";

      return {
        tab: "tasks",
        section,
        subsection,
        breadcrumb: `Tasks › ${section}${subLabel}`,
        label: "Task Matrix",
      };
    }

    case "goal": {
      return {
        tab: "goals",
        breadcrumb: "Goals & Long-Term Vision",
        label: "Goal",
      };
    }

    case "habit": {
      return {
        tab: "habits",
        breadcrumb: "Daily Habits & Streaks",
        label: "Habit",
      };
    }

    case "knowledge": {
      const note = record && "folderId" in record ? (record as any) : undefined;
      const folder = note?.folderId
        ? state?.noteFolders?.find((f) => f.id === note.folderId)
        : undefined;

      return {
        tab: "knowledge",
        folderId: note?.folderId,
        folderName: folder?.name,
        breadcrumb: `Notes & Knowledge Vault${folder?.name ? ` › ${folder.name}` : ""}`,
        label: "Note",
      };
    }

    case "journal": {
      return {
        tab: "journal",
        breadcrumb: "Reflections & Journal",
        label: "Journal Entry",
      };
    }

    case "event": {
      return {
        tab: "events",
        breadcrumb: "Calendar & Events",
        label: "Event",
      };
    }

    case "course":
    case "deck":
    case "quiz": {
      const courseId =
        type === "course"
          ? id
          : (record as any)?.courseId ||
            state?.study?.decks?.find((d) => d.id === id)?.courseId ||
            state?.study?.quizzes?.find((q) => q.id === id)?.courseId;

      const course = state?.study?.courses?.find((c) => c.id === courseId);

      const workspace =
        (course?.workspaceId && state?.workspaces?.find((w) => w.id === course.workspaceId)) ||
        state?.workspaces?.find((w) => w.template === "academic") ||
        state?.workspaces?.[0];

      const workspaceName = workspace?.name || "Academic";
      const tab = workspace ? `workspace:${workspace.id}` : "workspaces";

      return {
        tab,
        workspaceId: workspace?.id,
        workspaceName,
        panel: "study",
        panelLabel: "Course Materials",
        breadcrumb: `${workspaceName} Workspace › Course Materials`,
        label: type === "course" ? "Course" : type === "deck" ? "Flashcards" : "Quiz",
      };
    }

    default: {
      return {
        tab: "home",
        breadcrumb: "Workspace",
        label: type,
      };
    }
  }
}

/**
 * Global navigation event: switches view, opens right panel/tab, and scrolls/pulses target element.
 */
export function navigateToRecord(
  type: string,
  id: string,
  title?: string,
  state?: BrainState | null
): void {
  if (typeof window === "undefined") return;

  const location = getRecordLocation(state, type, id);
  const resolvedTitle = title || referenceTitle(type, id, undefined, state);

  (window as any).__synapse_last_record_navigation = {
    type,
    id,
    title: resolvedTitle,
    location,
    time: Date.now(),
  };

  window.dispatchEvent(
    new CustomEvent("synapse-navigate-to-record", {
      detail: {
        type,
        id,
        title: resolvedTitle,
        location,
      },
    })
  );
}

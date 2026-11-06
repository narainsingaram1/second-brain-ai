import type {
  BrainState,
  TrackerItem,
  TrackerStatus,
  Workspace,
  WorkspaceColor,
} from "../types";
import { getLocalDateString } from "./habitStreaks";
import { removeWorkspaceCourses } from "./study";

export const CAREER_WORKSPACE_ID = "workspace-career";
export const WORKSPACE_COLORS: WorkspaceColor[] = [
  "purple",
  "blue",
  "green",
  "amber",
  "rose",
];
export const PROBLEM_STAGES: { id: TrackerStatus; label: string }[] = [
  { id: "not_started", label: "To do" },
  { id: "in_progress", label: "Attempting" },
  { id: "done", label: "Solved" },
  { id: "review", label: "Revisit" },
];
export const APPLICATION_STAGES: { id: TrackerStatus; label: string }[] = [
  { id: "not_started", label: "Wishlist" },
  { id: "applied", label: "Applied" },
  { id: "screening", label: "Screening" },
  { id: "onsite", label: "Interview" },
  { id: "offer", label: "Offer" },
  { id: "rejected", label: "Closed" },
];
export function normalizeWorkspaces(value: unknown): Workspace[] {
  if (!Array.isArray(value))
    return [
      {
        id: CAREER_WORKSPACE_ID,
        name: "Career",
        description:
          "Your next chapter, one step at a time. Interview practice and applications, together.",
        template: "career",
        color: "purple",
        notes: "",
        createdAt: new Date().toISOString(),
      },
    ];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !item.id ||
      seen.has(item.id)
    )
      return [];
    seen.add(item.id);
    return [
      {
        id: item.id,
        name:
          typeof item.name === "string" && item.name.trim()
            ? item.name.trim().slice(0, 80)
            : "Untitled workspace",
        description:
          typeof item.description === "string" ? item.description : "",
        template:
          item.template === "career" || item.template === "academic"
            ? (item.template as "career" | "academic")
            : ("blank" as const),
        color: WORKSPACE_COLORS.includes(item.color)
          ? (item.color as WorkspaceColor)
          : ("purple" as const),
        notes: typeof item.notes === "string" ? item.notes : "",
        createdAt:
          typeof item.createdAt === "string"
            ? item.createdAt
            : new Date().toISOString(),
      },
    ];
  });
}
export function normalizeTrackerItems(value: unknown): TrackerItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !item.id ||
      seen.has(item.id) ||
      !["leetcode", "job_application"].includes(item.kind)
    )
      return [];
    seen.add(item.id);
    const stages =
      item.kind === "leetcode" ? PROBLEM_STAGES : APPLICATION_STAGES;
    return [
      {
        ...item,
        workspaceId:
          typeof item.workspaceId === "string"
            ? item.workspaceId
            : CAREER_WORKSPACE_ID,
        title: typeof item.title === "string" ? item.title : "Untitled",
        subject: typeof item.subject === "string" ? item.subject : "",
        status: stages.some((stage) => stage.id === item.status)
          ? item.status
          : "not_started",
        fields:
          item.fields &&
          typeof item.fields === "object" &&
          !Array.isArray(item.fields)
            ? item.fields
            : {},
        history:
          item.history &&
          typeof item.history === "object" &&
          !Array.isArray(item.history)
            ? item.history
            : {},
        streak: Number.isFinite(item.streak) ? item.streak : 0,
        bestStreak: Number.isFinite(item.bestStreak) ? item.bestStreak : 0,
        notes: typeof item.notes === "string" ? item.notes : "",
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || new Date().toISOString(),
      } as TrackerItem,
    ];
  });
}
export function workspaceItems(items: TrackerItem[], workspaceId: string) {
  return items.filter(
    (item) => (item.workspaceId || CAREER_WORKSPACE_ID) === workspaceId,
  );
}
export function removeWorkspace(state: BrainState, id: string): BrainState {
  return {
    ...state,
    ...(state.study
      ? { study: removeWorkspaceCourses(state.study, id).study }
      : {}),
    workspaces: (state.workspaces || []).filter(
      (workspace) => workspace.id !== id,
    ),
    trackerItems: (state.trackerItems || []).filter(
      (item) => (item.workspaceId || CAREER_WORKSPACE_ID) !== id,
    ),
  };
}
export function field(item: TrackerItem, key: string): string {
  const value = item.fields[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
export function safeTrackerUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function logSolve(item: TrackerItem, date = new Date()): TrackerItem {
  const today = getLocalDateString(date);
  const review = new Date(date);
  review.setDate(review.getDate() + 7);
  return {
    ...item,
    status: "done",
    updatedAt: date.toISOString(),
    history: { ...item.history, [today]: Number(item.history[today] || 0) + 1 },
    fields: {
      ...item.fields,
      lastPractice: today,
      nextReview: getLocalDateString(review),
    },
  };
}
export function practiceDays(
  items: TrackerItem[],
  now = new Date(),
  count = 28,
) {
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(now);
    day.setDate(day.getDate() - (count - index - 1));
    const date = getLocalDateString(day);
    return {
      date,
      count: items.reduce(
        (total, item) => total + (Number(item.history[date]) || 0),
        0,
      ),
    };
  });
}
export function practiceStreak(items: TrackerItem[], now = new Date()) {
  const dates = new Set(
    items.flatMap((item) =>
      Object.keys(item.history).filter(
        (date) => Number(item.history[date]) > 0,
      ),
    ),
  );
  const cursor = new Date(now);
  if (!dates.has(getLocalDateString(cursor)))
    cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (dates.has(getLocalDateString(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

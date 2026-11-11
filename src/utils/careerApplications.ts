import type { TrackerItem } from "../types";
import { field } from "./workspaces";

export type ApplicationSort = "applied-newest" | "applied-oldest" | "company" | "follow-up";
export function filterApplications(items: TrackerItem[], search: string, stage: string, location: string, sort: ApplicationSort): TrackerItem[] {
  const query = search.trim().toLocaleLowerCase();
  const filtered = items.filter(item => (stage === "all" || item.status === stage)
    && (location === "all" || field(item, "location").trim().toLocaleLowerCase() === location)
    && [item.subject, item.title, item.notes, field(item, "location"), field(item, "resumeName")].some(value => value?.toLocaleLowerCase().includes(query)));
  const dateOrder = (a: TrackerItem, b: TrackerItem, name: string, descending = false) => {
    const left = field(a, name), right = field(b, name);
    if (!left || !right) return Number(!left) - Number(!right);
    return descending ? right.localeCompare(left) : left.localeCompare(right);
  };
  return filtered.sort((a, b) => (sort === "company" ? a.subject.localeCompare(b.subject)
    : dateOrder(a, b, sort === "follow-up" ? "followUpDate" : "appliedDate", sort === "applied-newest"))
    || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

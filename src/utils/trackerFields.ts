import type { TrackerKind } from "../types";

/**
 * The detail fields a Career tracker entry can carry, defined once. The edit form in the app and the
 * assistant's tracker tools both read this list, so a field added here can be set by hand and by chat.
 */
export const DIFFICULTIES = ["Easy", "Medium", "Hard"] as const;
export const JOB_TYPES = ["Internship", "Full-time", "Part-time", "Contract"] as const;

export interface TrackerFieldDef {
  key: string;
  kinds: TrackerKind[];
  type: "text" | "date" | "number" | "choice";
  options?: readonly string[];
  description: string;
}

export const TRACKER_FIELDS: TrackerFieldDef[] = [
  { key: "number", kinds: ["leetcode"], type: "number", description: "Problem number, e.g. 1 for Two Sum." },
  { key: "difficulty", kinds: ["leetcode"], type: "choice", options: DIFFICULTIES, description: "Problem difficulty." },
  { key: "topic", kinds: ["leetcode"], type: "text", description: "Problem topics, e.g. 'Arrays, Hash maps'." },
  { key: "lastPractice", kinds: ["leetcode"], type: "date", description: "YYYY-MM-DD the problem was last practiced." },
  { key: "nextReview", kinds: ["leetcode"], type: "date", description: "YYYY-MM-DD to revisit the problem." },
  { key: "location", kinds: ["job_application"], type: "text", description: "Job location, e.g. 'Atlanta, GA' or 'Remote'." },
  { key: "jobType", kinds: ["job_application"], type: "choice", options: JOB_TYPES, description: "Kind of position." },
  { key: "appliedDate", kinds: ["job_application"], type: "date", description: "YYYY-MM-DD the application was sent." },
  { key: "followUpDate", kinds: ["job_application"], type: "date", description: "YYYY-MM-DD to follow up." },
  { key: "contact", kinds: ["job_application"], type: "text", description: "Recruiter or contact: name, email or LinkedIn." },
];
export const TRACKER_FIELD_KEYS = TRACKER_FIELDS.map(f => f.key);

/** JSON schema properties for every tracker field, for the assistant's tools. */
export function trackerFieldProperties(): Record<string, unknown> {
  return Object.fromEntries(TRACKER_FIELDS.map(f => {
    const scope = f.kinds.length === 1 ? (f.kinds[0] === "leetcode" ? " Problems only." : " Applications only.") : "";
    const schema = f.type === "number" ? { type: "integer", minimum: 1 } : f.type === "choice" ? { type: "string", enum: [...f.options!] } : { type: "string" };
    return [f.key, { ...schema, description: f.description + scope }];
  }));
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;

/** Checks the tracker fields present in `args` for an entry of this kind and returns them as stored values. */
export function readTrackerFields(kind: TrackerKind, args: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const f of TRACKER_FIELDS) {
    const raw = args[f.key];
    if (raw === undefined) continue;
    if (!f.kinds.includes(kind)) throw new Error(`${f.key} doesn't apply to ${kind === "leetcode" ? "practice problems" : "job applications"}.`);
    if (f.type === "number") {
      if (!Number.isInteger(raw) || (raw as number) < 1) throw new Error(`${f.key} must be a whole number.`);
      out[f.key] = raw as number;
      continue;
    }
    const value = String(raw).trim();
    if (f.type === "date" && !isDate(value)) throw new Error(`Invalid calendar date for ${f.key}: ${value}`);
    if (f.type === "choice" && !f.options!.includes(value)) throw new Error(`${f.key} must be one of ${f.options!.join(", ")}.`);
    out[f.key] = value.slice(0, 500);
  }
  return out;
}

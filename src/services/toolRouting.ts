import type { AIMessage } from "../types";
import type { OpenRouterTool } from "./openrouter";

/**
 * Tools for areas most messages never touch are sent only when the conversation is about them. Every tool not
 * listed here is always sent, so a new tool is available everywhere unless it is added to an area.
 *
 * The chosen areas come from the whole conversation, not just the newest message, so within a conversation the
 * tool list only grows. The tool list sits at the very front of the cached prompt prefix, and a list that changed
 * from turn to turn would make every turn re-read the full prompt.
 */
export const TOOL_AREAS = {
  career: ["create_tracker_item", "update_tracker_item", "delete_tracker_item", "log_practice", "list_resume_versions"],
  study: ["create_course", "update_course", "delete_course", "set_course_grading", "record_grade", "create_flashcard_deck",
    "update_flashcard_deck", "delete_flashcard_deck", "create_quiz", "update_quiz", "delete_quiz"],
  health: ["health_summary", "log_health_day", "update_health_day", "delete_health_day", "update_health_profile"],
  organize: ["create_workspace", "update_workspace", "delete_workspace", "create_section", "rename_section", "delete_section",
    "rename_subsection", "delete_subsection", "create_note_folder", "update_note_folder", "delete_note_folder"],
} as const;
export type ToolArea = keyof typeof TOOL_AREAS;
export const AREA_NAMES = Object.keys(TOOL_AREAS) as ToolArea[];

const AREA_OF = new Map<string, ToolArea>(AREA_NAMES.flatMap(area => TOOL_AREAS[area].map(name => [name, area] as const)));
export const toolArea = (name: string): ToolArea | undefined => AREA_OF.get(name);

/** Words that mean a message is about an area. Generous on purpose: an extra area costs a little, a missing one a round. */
const AREA_WORDS: Record<ToolArea, RegExp> = {
  career: /\b(appl(y|ied|ying|ication|ications)|jobs?|intern(s|ship|ships)?|recruit\w*|interview\w*|offers?|r[eé]sum[eé]s?|cv|cover letter|leetcode|neetcode|hackerrank|practice problems?|coding problems?|solved|career|tracker|onsite|online assessment|oa|referral|rejected|rejection|hiring|company|companies)\b/i,
  study: /\b(courses?|class(es)?|lectures?|syllabus|exams?|midterms?|finals?|quiz(zes)?|flash ?cards?|decks?|study|studying|grades?|grading|gpa|homework|hw|professor|prof|semester|scored?|got \d+)\b/i,
  health: /\b(sleep|slept|asleep|naps?|steps|workouts?|exercis\w*|running|ran|gym|lift\w*|heart rate|hrv|resting hr|recovery|recovered|weigh\w*|health|tired|exhausted|vo2|calories|apple (watch|health)|training|strain)\b/i,
  organize: /\b(workspaces?|sections?|subsections?|folders?|rename|reorgani[sz]e|organi[sz]e|categor(y|ies))\b/i,
};
/** A course code such as "CS 2110" or "MATH1552". Case matters, so "in 2026" is not one. */
const COURSE_CODE = /\b[A-Z]{2,4} ?\d{3,4}\b/;
/** Record types whose earlier mention in the conversation means its area is in play ("mark it rejected"). */
const AREA_OF_RECORD: Record<string, ToolArea> = { tracker: "career", course: "study", document: "study", deck: "study", quiz: "study", health: "health", workspace: "organize", folder: "organize", section: "organize" };

/** Areas the conversation so far, plus the newest message, is about. Images may hold anything, so they open every area. */
export function conversationAreas(prompt: string, history: AIMessage[], hasImages = false): Set<ToolArea> {
  if (hasImages || history.some(m => m.role === "user" && m.attachments?.length)) return new Set(AREA_NAMES);
  const areas = new Set<ToolArea>();
  const texts = [prompt, ...history.filter(m => m.role === "user").map(m => m.content)];
  for (const area of AREA_NAMES) if (texts.some(text => AREA_WORDS[area].test(text))) areas.add(area);
  if (texts.some(text => COURSE_CODE.test(text))) areas.add("study");
  for (const message of history) for (const source of message.sources || []) {
    const area = AREA_OF_RECORD[source.type];
    if (area) areas.add(area);
  }
  return areas;
}

/** The tools to offer: always-sent tools plus the chosen areas', in the catalog's own fixed order. */
export function routeTools(catalog: OpenRouterTool[], areas: Set<ToolArea>): OpenRouterTool[] {
  return catalog.filter(tool => { const area = toolArea(tool.function.name); return !area || areas.has(area); });
}

const AREA_LABELS: Record<ToolArea, string> = {
  career: "career: job applications and coding practice in Career trackers, résumé versions",
  study: "study: courses, grading and grades, flashcard decks, quizzes",
  health: "health: the health summary, logging and correcting health days, health targets",
  organize: "organize: workspaces, task sections and subsections, note folders",
};

/** Lets the model add an area it needs that the conversation did not mention in words. */
export function useToolsTool(missing: ToolArea[]): OpenRouterTool {
  return { type: "function", function: { name: "use_tools",
    description: `Make more tools available for the rest of this conversation. Call it when you need a tool that is not in your list: ${missing.map(a => AREA_LABELS[a]).join("; ")}. The tools are usable from your next step.`,
    parameters: { type: "object", properties: { areas: { type: "array", items: { type: "string", enum: missing }, minItems: 1 } }, required: ["areas"], additionalProperties: false } } };
}

import type { AgentPlanItem, AgentPlanStatus } from "../types";
import type { OpenRouterTool } from "./openrouter";

/**
 * The assistant's working plan for a multi-step request, shown to the user as a live checklist.
 *
 * The plan is the contract for the turn: the runtime will not let the assistant end the turn with steps
 * still open. It must either do them or mark them skipped or blocked with a reason the user can read.
 * That stops the most common agent failure, quietly stopping halfway and replying as if it had finished.
 */
export const PLAN_TOOL: OpenRouterTool = { type: "function", function: { name: "update_plan",
  description: "Write or update your plan for a request that takes three or more steps (several changes, research then changes, a reorganization). Send the whole plan each time: every step with its status. Mark a step in_progress when you start it and done as soon as it is finished. A step you will not do is skipped or blocked, with a note saying why. Not needed for simple questions or a single change.",
  parameters: { type: "object", additionalProperties: false, required: ["steps"], properties: {
    steps: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["title", "status"], properties: {
      title: { type: "string", minLength: 1, maxLength: 120, description: "Short imperative step, e.g. \"Move overdue CS tasks to Friday\"" },
      status: { type: "string", enum: ["pending", "in_progress", "done", "skipped", "blocked"] },
      note: { type: "string", maxLength: 240, description: "Why a step was skipped or blocked, or a short result" },
    } } },
  } } } };

const OPEN: ReadonlySet<AgentPlanStatus> = new Set(["pending", "in_progress"]);

export class TaskPlan {
  private items: AgentPlanItem[] = [];
  private nudges = 0;

  /** Replaces the plan. A step marked done earlier cannot be reopened silently: done stays done. */
  set(steps: Array<{ title: string; status: AgentPlanStatus; note?: string }>): AgentPlanItem[] {
    const clean = steps.map(s => ({ title: s.title.trim().slice(0, 120), status: s.status, ...(s.note?.trim() ? { note: s.note.trim().slice(0, 240) } : {}) }))
      .filter(s => s.title);
    if (!clean.length) throw new Error("A plan needs at least one step with a title.");
    const titles = new Set<string>();
    for (const step of clean) {
      const key = step.title.toLowerCase();
      if (titles.has(key)) throw new Error(`The plan lists "${step.title}" twice. Give each step once.`);
      titles.add(key);
    }
    for (const step of clean) if ((step.status === "skipped" || step.status === "blocked") && !step.note)
      throw new Error(`Say why "${step.title}" is ${step.status} in its note.`);
    this.items = clean;
    return this.list();
  }
  list(): AgentPlanItem[] { return this.items.map(s => ({ ...s })); }
  get active(): boolean { return this.items.length > 0; }
  unfinished(): AgentPlanItem[] { return this.items.filter(s => OPEN.has(s.status)); }

  /**
   * When the assistant tries to end the turn with steps still open, the instruction to finish them (or
   * account for them). Given at most twice per turn, so a model that cannot finish still gets to reply.
   */
  completionNudge(): string | null {
    const open = this.unfinished();
    if (!open.length || this.nudges >= 2) return null;
    this.nudges++;
    return `Your plan still has unfinished steps: ${open.map(s => `"${s.title}"`).join(", ")}. Do them now with tools, or call update_plan marking each one skipped or blocked with a note saying why. Then write your reply. Do not tell the user a step is done unless a tool result confirmed it.`;
  }
}

/** What the turn actually did, from the runtime's own records rather than the model's account. */
export interface TurnLedger { saved: number; proposed: number; external: number; memory: number }

const DID = "(?:added|created|made|updated|changed|renamed|moved|rescheduled|pushed|marked|completed|checked off|deleted|removed|scheduled|saved|logged|recorded|set up|archived|organi[sz]ed|reorgani[sz]ed)";
const CLAIMS = [
  // "I added", "I've moved", "I have also renamed", "I went ahead and deleted"
  new RegExp(`\\bi(?:(?:'|’)ve| have)?\\s+(?:(?:also|now|just|already|went ahead and|gone ahead and)\\s+)*${DID}\\b`, "i"),
  // "Your essay has been moved", "3 tasks were rescheduled"
  new RegExp(`\\b(?:has|have|was|were) (?:now |also |all )?been ${DID}\\b|\\b(?:was|were) ${DID}\\b`, "i"),
  // "Done, moved it to Friday", "All set: added both", "Successfully saved"
  new RegExp(`\\b(?:all set|done|successfully)\\b[^.!?\\n]{0,80}\\b${DID}\\b`, "i"),
];
/** Words that mean the reply is about a change waiting for approval or one the user should make, not a claim. */
const HEDGE = /\b(approv|waiting|once you|if you|would you like|want me to|should i|shall i|can you|you can|could)\w*/i;

/**
 * True when the reply says changes were made but nothing was saved, proposed or done this turn. The
 * assistant is then asked once to either make the change or correct the reply.
 */
export function claimsUnbackedChange(answer: string, ledger: TurnLedger): boolean {
  if (ledger.saved || ledger.proposed || ledger.external || ledger.memory) return false;
  for (const sentence of answer.split(/(?<=[.!?])\s+|\n+/)) {
    if (CLAIMS.some(claim => claim.test(sentence)) && !HEDGE.test(sentence)) return true;
  }
  return false;
}
export const UNBACKED_CHANGE_NUDGE = "Your reply says a change was made, but no change was saved, proposed or done in this turn. If the user asked for a change, make it now with the right tool. Otherwise rewrite the reply so it does not say anything was changed.";

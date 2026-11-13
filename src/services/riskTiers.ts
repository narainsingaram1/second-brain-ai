/**
 * Risk tiers for anything the assistant does outside Synapse (websites now, native apps next).
 *
 *   T0 read  — observes only (look, read, list tabs). Runs.
 *   T1 soft  — reversible or local (type in a normal field, select, open a tab). Runs, with a toast the user can stop.
 *   T2 hard  — commits something for the user (send, submit, pay, delete, post, merge). Waits for the user's live go-ahead.
 *   T3 never — the user does it themselves (passwords, card numbers, one-time codes, CAPTCHAs, browser settings).
 *
 * The tier of a step on a page is decided by the extension from the element it resolves, not from the model's
 * words; these lists are the shared vocabulary. Policy can only raise a tier, never lower it.
 */
export type RiskTier = 0 | 1 | 2 | 3;
export const TIER_NAMES: Record<RiskTier, string> = { 0: "read", 1: "soft", 2: "hard", 3: "user-only" };

// These sources are copied verbatim into extension/page-agent.js (which runs inside pages and can't import);
// tests/agent-router.test.mjs fails if the two drift apart.
export const SECRET_AUTOCOMPLETE_SOURCE = String.raw`\b(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp|cc-exp-month|cc-exp-year)\b`;
export const SECRET_LABEL_SOURCE = String.raw`\b(password|passcode|card ?number|credit card|debit card|cvv|cvc|csc|security code|expir\w* date|ssn|social security|routing number|account number|iban|swift|pin)\b`;
export const CONSEQUENTIAL_SOURCE = String.raw`\b(buy|purchase|place (?:your )?order|pay(?: now)?|checkout|check out|complete (?:order|purchase|booking)|confirm|submit|send|post|publish|tweet|share|reply|comment|delete|remove|discard|cancel (?:my |your )?(?:order|subscription|account|membership|booking|reservation)|unsubscribe|transfer|withdraw|deposit|book(?: now)?|reserve|subscribe|sign up|create (?:an )?account|register|apply|donate|accept|agree|authori[sz]e|allow|grant|follow|connect|invite|upload|save changes|update (?:payment|account)|close account|merge|approve|archive|revoke|deploy|release)\b`;

export const SECRET_AUTOCOMPLETE = new RegExp(SECRET_AUTOCOMPLETE_SOURCE, "i");
export const SECRET_LABEL = new RegExp(SECRET_LABEL_SOURCE, "i");
export const CONSEQUENTIAL = new RegExp(CONSEQUENTIAL_SOURCE, "i");

export interface BrowserStep { action: string; ref?: number; text?: string; submit?: boolean; value?: string; key?: string; direction?: string }
/** What the extension learned about a step's element (its `inspect` result). */
export interface StepInspection { consequential?: boolean; submitsText?: boolean; userOnly?: string }

const READ_ONLY_STEPS = new Set(["scroll", "hover"]);

/** The tier of one step, once the element it targets is known. */
export function classifyBrowserStep(step: BrowserStep, info: StepInspection = {}): RiskTier {
  if (info.userOnly) return 3;
  if (info.consequential || info.submitsText) return 2;
  if (READ_ONLY_STEPS.has(step.action)) return 0;
  // Enter on whatever has focus can submit a form the model never named: the extension re-checks it, but
  // the floor here is soft, never read.
  return 1;
}

/** The least a browser tool call can be, before the extension looks at the page. */
export function browserCallFloor(name: string, args: Record<string, unknown> = {}): RiskTier {
  if (name === "browser_look" || name === "browser_read" || name === "browser_tabs") return 0;
  if (name === "browser_open" || name === "browser_close") return 1;
  if (name === "browser_act") {
    const steps = Array.isArray(args.steps) ? args.steps as BrowserStep[] : [];
    return steps.reduce<RiskTier>((tier, s) => Math.max(tier, classifyBrowserStep(s)) as RiskTier, 0);
  }
  return 2; // Unknown browser tool: treat as committing until it is classified.
}

export const raise = (...tiers: RiskTier[]): RiskTier => Math.max(0, ...tiers) as RiskTier;

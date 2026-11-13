import type { RiskTier } from "./riskTiers";

/**
 * Where the assistant may act outside Synapse and how carefully. The user sets one policy on this device; an
 * organization can ship a managed one. Combined, the stricter side of each setting wins, so a managed policy
 * can only tighten what the user allows, and the user can only tighten what the organization allows.
 */
export interface AgentPolicy {
  /** Sites the assistant must never act on (a host also covers its subdomains). */
  deniedHosts: string[];
  /** When non-empty, the only sites the assistant may act on. */
  allowedHosts: string[];
  /** Sites where every change, not only committing ones, waits for the user. */
  confirmHosts: string[];
  /** Steps that change a page, per site per minute. */
  maxActsPerMinute: number;
  /** Live go-aheads the assistant may ask for in one request before it must stop and report. */
  maxHardPerTurn: number;
}

export const DEFAULT_POLICY: AgentPolicy = { deniedHosts: [], allowedHosts: [], confirmHosts: [], maxActsPerMinute: 40, maxHardPerTurn: 6 };
const KEY = "synapse.agentPolicy";

const normHost = (h: string) => String(h).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
const hosts = (list: unknown) => Array.isArray(list) ? [...new Set(list.map(normHost).filter(Boolean))] : [];
const positive = (n: unknown, fallback: number) => Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : fallback;

export function normalizePolicy(raw: Partial<AgentPolicy> | null | undefined): AgentPolicy {
  return {
    deniedHosts: hosts(raw?.deniedHosts), allowedHosts: hosts(raw?.allowedHosts), confirmHosts: hosts(raw?.confirmHosts),
    maxActsPerMinute: positive(raw?.maxActsPerMinute, DEFAULT_POLICY.maxActsPerMinute),
    maxHardPerTurn: positive(raw?.maxHardPerTurn, DEFAULT_POLICY.maxHardPerTurn),
  };
}

/** The stricter of two policies, setting by setting. */
export function mergePolicies(user: AgentPolicy, managed?: Partial<AgentPolicy> | null): AgentPolicy {
  if (!managed) return user;
  const m = normalizePolicy(managed);
  const allowed = m.allowedHosts.length && user.allowedHosts.length
    ? user.allowedHosts.filter(h => m.allowedHosts.some(a => matches(h, a)))
    : m.allowedHosts.length ? m.allowedHosts : user.allowedHosts;
  // Both sides allowed something but nothing overlaps: allow nothing rather than falling back to "anything".
  const emptyIntersection = m.allowedHosts.length > 0 && user.allowedHosts.length > 0 && allowed.length === 0;
  return {
    deniedHosts: [...new Set([...user.deniedHosts, ...m.deniedHosts])],
    allowedHosts: emptyIntersection ? ["\u0000none"] : allowed,
    confirmHosts: [...new Set([...user.confirmHosts, ...m.confirmHosts])],
    maxActsPerMinute: Math.min(user.maxActsPerMinute, m.maxActsPerMinute),
    maxHardPerTurn: Math.min(user.maxHardPerTurn, m.maxHardPerTurn),
  };
}

const matches = (host: string, rule: string) => host === rule || host.endsWith(`.${rule}`);

export interface PolicyDecision { deny?: string; floor: RiskTier }
/** What the policy says about acting on `host`: refused, or the lowest tier a change there can have. */
export function decide(policy: AgentPolicy, rawHost: string): PolicyDecision {
  const host = normHost(rawHost);
  if (!host) return { floor: 0 };
  if (policy.deniedHosts.some(r => matches(host, r))) return { deny: `Acting on ${host} is turned off in your agent policy.`, floor: 3 };
  if (policy.allowedHosts.length && !policy.allowedHosts.some(r => matches(host, r))) return { deny: `${host} isn't on the list of sites the assistant may act on.`, floor: 3 };
  if (policy.confirmHosts.some(r => matches(host, r))) return { floor: 2 };
  return { floor: 0 };
}

export function loadUserPolicy(): AgentPolicy {
  try { return normalizePolicy(JSON.parse(globalThis.localStorage?.getItem(KEY) || "null")); } catch { return { ...DEFAULT_POLICY }; }
}
export function saveUserPolicy(policy: Partial<AgentPolicy>): AgentPolicy {
  const next = normalizePolicy(policy);
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(next)); } catch { /* Device preference only. */ }
  return next;
}

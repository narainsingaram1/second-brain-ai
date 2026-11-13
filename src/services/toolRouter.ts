import type { ExternalToolset } from "./agentDispatcher";
import type { AgentAuditLog, AuditApproval, AuditOutcome } from "./agentAudit";
import { decide, type AgentPolicy } from "./agentPolicy";
import { browserCallFloor, raise, type BrowserStep, type RiskTier } from "./riskTiers";

/**
 * The one place every browser action passes through on the app side, in order:
 *   classify → policy (denied / allow-list / always-confirm sites) → rate limit → taint check → go-ahead → run → audit.
 *
 * The extension still enforces its own rules (own tabs, user-only fields, one-time tokens for committing steps);
 * this layer adds what only the app knows: the user's and organization's policy, how much has happened this
 * request, and where text came from. It can only add gates, never remove the extension's.
 */
export interface GateRequest { id: string; label: string; site: string; tabId: number; reason?: string }
export interface ActivityToast { id: string; label: string; site: string }

export interface RouterOptions {
  policy: AgentPolicy;
  audit: AgentAuditLog;
  turnId: string;
  /** Asks the user, live. Resolves true only on their explicit go-ahead. */
  confirm: (request: GateRequest, signal: AbortSignal) => Promise<boolean>;
  /** A soft (T1) step ran: show it non-blockingly, with a way to stop. */
  notify?: (toast: ActivityToast) => void;
  now?: () => number;
  random?: () => string;
}

/** Text the assistant read on each site this request, to spot it being carried to another site. */
const CORPUS_LIMIT = 200_000;
const TAINT_MIN_CHARS = 24;
const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const hostOf = (url: unknown) => { try { return new URL(String(url)).hostname.replace(/^www\./, ""); } catch { return ""; } };
const quote = (text: string, max = 60) => text.length > max ? `"${text.slice(0, max - 1)}…"` : `"${text}"`;

export function describeSteps(steps: BrowserStep[]): string {
  return steps.map(s => s.action === "type" ? `type ${quote(String(s.text ?? ""))}${s.submit ? " and press Enter" : ""}`
    : s.action === "select" ? `choose ${quote(String(s.value ?? s.text ?? ""))}` : s.action === "press" ? `press ${s.key}`
    : `${s.action}${s.ref ? ` [${s.ref}]` : ""}`).join(", then ");
}

export function createAgentRouter(options: RouterOptions) {
  const { policy, audit, turnId } = options;
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? (() => crypto.randomUUID());
  const tabHosts = new Map<number, string>();
  const corpus = new Map<string, string>();
  const recent = new Map<string, number[]>(); // host -> timestamps of page-changing steps
  let hardAsks = 0;

  const remember = (output: unknown) => {
    const page = output as { tabId?: number; url?: string; site?: string; text?: string } | undefined;
    if (!page || typeof page !== "object") return;
    const host = hostOf(page.url) || page.site || "";
    if (typeof page.tabId === "number" && host) tabHosts.set(page.tabId, host);
    if (host && typeof page.text === "string" && page.text && page.text !== "(unchanged)") corpus.set(host, ((corpus.get(host) || "") + " " + norm(page.text)).slice(-CORPUS_LIMIT));
  };

  /** Hosts other than `host` whose pages contain `text`. */
  const carriedFrom = (text: string, host: string) => {
    const needle = norm(text);
    if (needle.length < TAINT_MIN_CHARS) return [];
    return [...corpus].filter(([h, body]) => h !== host && body.includes(needle)).map(([h]) => h);
  };

  const withinRate = (host: string, count: number) => {
    const t = now();
    const list = (recent.get(host) || []).filter(x => t - x < 60_000);
    if (list.length + count > policy.maxActsPerMinute) { recent.set(host, list); return false; }
    for (let i = 0; i < count; i++) list.push(t);
    recent.set(host, list);
    return true;
  };

  /** Every live go-ahead goes through here, whether this router or the extension asked for it. */
  const confirm = async (request: GateRequest, signal: AbortSignal): Promise<boolean> => {
    if (hardAsks >= policy.maxHardPerTurn) {
      await audit.append({ turnId, tool: "browser_act", tier: 2, target: request.site, summary: request.label, approval: "none", outcome: "denied", detail: "go-ahead limit for one request reached" });
      throw new Error(`This request already asked for ${policy.maxHardPerTurn} go-aheads. Stop here, report what was done, and let the user ask again for the rest.`);
    }
    hardAsks++;
    const allowed = await options.confirm(request, signal);
    await audit.append({ turnId, tool: "browser_act", tier: 2, target: request.site, summary: request.label, approval: "user", outcome: allowed ? "ran" : "declined",
      detail: allowed ? "user gave the go-ahead" : "user declined", ...(request.reason ? { payload: request.reason } : {}) });
    return allowed;
  };

  const wrap = (inner: ExternalToolset): ExternalToolset => ({
    ...inner,
    async execute(name, args, signal, context) {
      if (!name.startsWith("browser_")) return inner.execute(name, args, signal, context);
      const tabId = Number(args.tabId);
      const host = name === "browser_open" ? hostOf(args.url) : tabHosts.get(tabId) || "";
      const steps = name === "browser_act" && Array.isArray(args.steps) ? args.steps as BrowserStep[] : [];
      let tier: RiskTier = browserCallFloor(name, args);
      const log = (outcome: AuditOutcome, approval: AuditApproval, summary: string, detail?: string) =>
        audit.append({ turnId, tool: name, tier, target: host || "browser", summary, approval, outcome, payload: args, ...(detail ? { detail } : {}) });

      // Policy: denied sites are off limits for anything but closing and listing tabs.
      const decision = decide(policy, host);
      if (decision.deny && name !== "browser_close" && name !== "browser_tabs") {
        await log("denied", "none", decision.deny);
        throw new Error(`${decision.deny} Tell the user; don't try another way.`);
      }

      const gates: string[] = [];
      if (tier >= 1 && decision.floor >= 2) gates.push(`You asked to approve every change on ${host}.`);
      for (const s of steps) {
        if (s.action !== "type" || !s.text) continue;
        const sources = carriedFrom(String(s.text), host);
        if (sources.length) gates.push(`This copies text read on ${sources.join(", ")} into ${host || "another site"}.`);
      }
      tier = raise(tier, gates.length ? 2 : 0);

      const changing = steps.filter(s => s.action !== "scroll" && s.action !== "hover").length || (name === "browser_open" ? 1 : 0);
      if (changing && host && !withinRate(host, changing)) {
        await log("denied", "none", "rate limit", `more than ${policy.maxActsPerMinute} steps a minute on ${host}`);
        throw new Error(`That's more than ${policy.maxActsPerMinute} steps a minute on ${host}. Wait, look at the page, and do fewer, larger batches.`);
      }

      let approval: AuditApproval = tier === 0 ? "auto" : "toast";
      if (gates.length) {
        const label = name === "browser_act" ? describeSteps(steps) : name === "browser_open" ? `Open ${String(args.url)}` : name;
        const allowed = await confirm({ id: random(), label: label.charAt(0).toUpperCase() + label.slice(1), site: host || "a website", tabId, reason: gates.join(" ") }, signal);
        if (!allowed) {
          await log("declined", "user", "user declined", gates.join(" "));
          return { output: { tabId, confirmed: false, declined: `The user did not allow this (${gates.join(" ")}). Nothing was done. Don't try another way.` }, summary: "Not allowed" };
        }
        approval = "user";
      }

      let result;
      try { result = await inner.execute(name, args, signal, context); }
      catch (error) { await log("failed", approval, error instanceof Error ? error.message.slice(0, 200) : "failed"); throw error; }
      remember(result.output);

      const out = result.output as { userOnly?: string; confirmed?: boolean; done?: string[]; site?: string } | undefined;
      if (out?.confirmed === true) { approval = "user"; tier = raise(tier, 2); }
      const outcome: AuditOutcome = out?.userOnly ? "user_only" : out?.confirmed === false ? "declined" : "ran";
      await log(outcome, approval, result.summary || name);
      if (outcome === "ran" && approval === "toast" && tier === 1 && options.notify)
        options.notify({ id: random(), label: result.summary || describeSteps(steps) || name, site: out?.site || host });
      return result;
    },
  });

  /** The user said never on this site: refuse it for the rest of this request too. */
  const denyHost = (host: string) => { if (host && !policy.deniedHosts.includes(host)) policy.deniedHosts = [...policy.deniedHosts, host]; };

  return { confirm, wrap, denyHost, stats: () => ({ hardAsks, sites: [...tabHosts.values()] }) };
}

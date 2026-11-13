import type { RiskTier } from "./riskTiers";

/**
 * A tamper-evident record of everything the assistant did outside Synapse: each entry carries the hash of the
 * one before it, so an edited or removed entry breaks the chain. Typed text and other payloads are stored only
 * as a digest and a length, never in full: the log proves what happened without holding what was typed.
 */
export type AuditOutcome = "ran" | "denied" | "declined" | "failed" | "user_only";
export type AuditApproval = "auto" | "toast" | "user" | "none";

export interface AuditInput {
  turnId: string; tool: string; tier: RiskTier; target: string; summary: string;
  approval: AuditApproval; outcome: AuditOutcome; payload?: unknown; detail?: string;
}
export interface AuditEntry extends Omit<AuditInput, "payload"> {
  seq: number; ts: string; payloadDigest: string; payloadChars: number; prevHash: string; hash: string;
}

export interface AuditStore { load(): AuditEntry[]; save(entries: AuditEntry[]): void }
const KEY = "synapse.agentAudit";
export const AUDIT_LIMIT = 2000;
const GENESIS = "0".repeat(64);

export const localAuditStore = (): AuditStore => ({
  load() { try { return JSON.parse(globalThis.localStorage?.getItem(KEY) || "[]"); } catch { return []; } },
  save(entries) { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(entries)); } catch { /* Full or unavailable: the in-memory log still works. */ } },
});
export const memoryAuditStore = (initial: AuditEntry[] = []): AuditStore & { entries: AuditEntry[] } => {
  const box = { entries: initial, load: () => box.entries, save: (e: AuditEntry[]) => { box.entries = e; } };
  return box;
};

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const body = (e: Omit<AuditEntry, "hash">) => JSON.stringify([e.seq, e.ts, e.turnId, e.tool, e.tier, e.target, e.summary, e.approval, e.outcome, e.detail ?? "", e.payloadDigest, e.payloadChars, e.prevHash]);

export class AgentAuditLog {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private store: AuditStore = localAuditStore(), private now = () => new Date()) {}

  /** Appends one entry. Appends are serialized, so the chain stays intact under concurrent calls. */
  append(input: AuditInput): Promise<AuditEntry> {
    const next = this.queue.then(async () => {
      const entries = this.store.load();
      const last = entries[entries.length - 1];
      const payload = input.payload === undefined ? "" : typeof input.payload === "string" ? input.payload : JSON.stringify(input.payload);
      const { payload: _omit, ...rest } = input;
      const draft = { ...rest, seq: (last?.seq ?? 0) + 1, ts: this.now().toISOString(), payloadDigest: payload ? await sha256(payload) : "",
        payloadChars: payload.length, prevHash: last?.hash ?? GENESIS };
      const entry: AuditEntry = { ...draft, hash: await sha256(body(draft)) };
      // Oldest entries roll off; verification starts from the oldest kept entry's prevHash.
      this.store.save([...entries, entry].slice(-AUDIT_LIMIT));
      return entry;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  entries(): AuditEntry[] { return this.store.load(); }

  /** Checks every hash and link. Returns the first broken entry's seq, or null when the chain is intact. */
  async verify(): Promise<{ ok: true } | { ok: false; seq: number; reason: string }> {
    const entries = this.store.load();
    for (let i = 0; i < entries.length; i++) {
      const { hash, ...rest } = entries[i];
      if (i > 0 && rest.prevHash !== entries[i - 1].hash) return { ok: false, seq: rest.seq, reason: "link to the previous entry is broken" };
      if (i > 0 && rest.seq !== entries[i - 1].seq + 1) return { ok: false, seq: rest.seq, reason: "an entry is missing" };
      if (await sha256(body(rest)) !== hash) return { ok: false, seq: rest.seq, reason: "entry was changed" };
    }
    return { ok: true };
  }

  /** JSON Lines, one entry per line, for export. */
  exportJsonl(): string { return this.store.load().map(e => JSON.stringify(e)).join("\n"); }
}

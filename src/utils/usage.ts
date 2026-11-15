import type { TurnUsage } from "../types";

/** Tokens and cost of one model request, as the provider reported them. */
export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  cost?: number;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

/** Reads an OpenAI-style `usage` object (OpenRouter adds `cost` in dollars). Undefined when there is nothing usable. */
export function readUsage(raw: any): CallUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const input = num(raw.prompt_tokens) ?? num(raw.input_tokens);
  const output = num(raw.completion_tokens) ?? num(raw.output_tokens);
  if (input === undefined && output === undefined) return undefined;
  const cached = num(raw.prompt_tokens_details?.cached_tokens) ?? num(raw.input_tokens_details?.cached_tokens);
  const reasoning = num(raw.completion_tokens_details?.reasoning_tokens) ?? num(raw.output_tokens_details?.reasoning_tokens);
  const cost = num(raw.cost) ?? num(raw.total_cost);
  return {
    inputTokens: input ?? 0, outputTokens: output ?? 0,
    ...(cached ? { cachedTokens: cached } : {}), ...(reasoning ? { reasoningTokens: reasoning } : {}), ...(cost !== undefined ? { cost } : {}),
  };
}

/** Adds up everything one assistant reply spent. */
export class UsageMeter {
  private readonly started = Date.now();
  private firstText?: number;
  private calls = 0;
  private searches = 0;
  private priced = 0;
  private total: CallUsage = { inputTokens: 0, outputTokens: 0 };
  constructor(private readonly model: string) {}
  /** One model request; `usage` is undefined when the provider didn't report any. */
  add(usage: CallUsage | undefined, kind: "chat" | "search" = "chat") {
    if (kind === "search") this.searches++; else this.calls++;
    if (!usage) return;
    this.total.inputTokens += usage.inputTokens;
    this.total.outputTokens += usage.outputTokens;
    if (usage.cachedTokens) this.total.cachedTokens = (this.total.cachedTokens || 0) + usage.cachedTokens;
    if (usage.reasoningTokens) this.total.reasoningTokens = (this.total.reasoningTokens || 0) + usage.reasoningTokens;
    if (usage.cost !== undefined) { this.total.cost = (this.total.cost || 0) + usage.cost; this.priced++; }
  }
  textStarted() { this.firstText ??= Date.now() - this.started; }
  result(): TurnUsage {
    const requests = this.calls + this.searches;
    return {
      ms: Date.now() - this.started, ...(this.firstText !== undefined ? { firstTextMs: this.firstText } : {}),
      model: this.model, calls: this.calls, inputTokens: this.total.inputTokens, outputTokens: this.total.outputTokens,
      ...(this.total.cachedTokens ? { cachedTokens: this.total.cachedTokens } : {}),
      ...(this.total.reasoningTokens ? { reasoningTokens: this.total.reasoningTokens } : {}),
      ...(this.total.cost !== undefined ? { cost: this.total.cost, costComplete: this.priced === requests } : {}),
      ...(this.searches ? { webSearches: this.searches } : {}),
    };
  }
}

export const formatDuration = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
export const formatTokens = (n: number) =>
  n < 1000 ? String(n) : n < 1_000_000 ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k` : `${(n / 1_000_000).toFixed(1)}M`;
export function formatCost(dollars: number): string {
  if (dollars === 0) return "$0";
  if (dollars < 0.01) return `$${dollars.toFixed(4).replace(/0+$/, "")}`;
  return `$${dollars.toFixed(dollars < 1 ? 3 : 2)}`;
}

/** Totals across replies, e.g. a whole conversation. */
export function sumUsage(list: Array<TurnUsage | undefined>): { replies: number; ms: number; tokens: number; cost: number; costComplete: boolean } {
  const used = list.filter((u): u is TurnUsage => !!u);
  return {
    replies: used.length,
    ms: used.reduce((n, u) => n + u.ms, 0),
    tokens: used.reduce((n, u) => n + u.inputTokens + u.outputTokens, 0),
    cost: used.reduce((n, u) => n + (u.cost || 0), 0),
    costComplete: used.every(u => u.cost !== undefined && u.costComplete !== false),
  };
}

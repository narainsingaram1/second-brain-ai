import type { CallUsage } from "../utils/usage";

/**
 * Where a live turn's time and tokens go (browser and desktop steps), for measuring the agent rather than for
 * the model. Each model request is a round; the live steps it asked for are recorded under it with their phase
 * timings (inject, inspect, act, settle, load, snapshot…) and how much they sent back to the model.
 *
 * The last few traces are kept in memory as `globalThis.__synapseAgentTraces` so they can be copied out
 * (e.g. `copy(JSON.stringify(__synapseAgentTraces))` in the devtools console). Nothing is stored or sent.
 */
export interface TraceTool { tool: string; ms: number; phases?: Record<string, number>; chars: number; error?: string }
export interface TraceRound { modelMs: number; inputTokens?: number; cachedTokens?: number; outputTokens?: number; tools: TraceTool[] }
export interface TraceSummary {
  rounds: number; liveSteps: number; ms: number; modelMs: number; toolMs: number;
  /** Phase totals across every live step, in ms. */
  phases: Record<string, number>;
  inputTokens: number; cachedTokens: number; outputTokens: number;
  /** Cached input tokens ÷ input tokens, 0–1; absent when the provider reported no usage. */
  cacheRate?: number;
  /** Characters of live-step output sent to the model. */
  outputChars: number;
  errors: number;
}
export interface LiveTrace { model: string; startedAt: string; rounds: TraceRound[]; summary: TraceSummary }

const KEEP = 20;

export class TraceRecorder {
  private readonly started = Date.now();
  readonly rounds: TraceRound[] = [];
  constructor(private readonly model: string) {}

  /** One model request. Live steps recorded after it belong to this round. */
  round(ms: number, usage?: CallUsage) {
    this.rounds.push({ modelMs: Math.round(ms), ...(usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedTokens: usage.cachedTokens || 0 } : {}), tools: [] });
  }

  tool(entry: TraceTool) {
    if (!this.rounds.length) this.rounds.push({ modelMs: 0, tools: [] });
    this.rounds[this.rounds.length - 1].tools.push({ ...entry, ms: Math.round(entry.ms) });
  }

  get liveSteps() { return this.rounds.reduce((n, r) => n + r.tools.length, 0); }

  summary(): TraceSummary {
    const phases: Record<string, number> = {};
    let modelMs = 0, toolMs = 0, input = 0, cached = 0, output = 0, chars = 0, errors = 0, reported = false, steps = 0;
    for (const round of this.rounds) {
      modelMs += round.modelMs;
      if (round.inputTokens !== undefined) { reported = true; input += round.inputTokens; cached += round.cachedTokens || 0; output += round.outputTokens || 0; }
      for (const t of round.tools) {
        steps++; toolMs += t.ms; chars += t.chars; if (t.error) errors++;
        for (const [phase, ms] of Object.entries(t.phases || {})) if (phase !== "total") phases[phase] = (phases[phase] || 0) + ms;
      }
    }
    return { rounds: this.rounds.length, liveSteps: steps, ms: Date.now() - this.started, modelMs, toolMs, phases,
      inputTokens: input, cachedTokens: cached, outputTokens: output, ...(reported && input ? { cacheRate: Math.round((cached / input) * 1000) / 1000 } : {}),
      outputChars: chars, errors };
  }

  /** The finished trace, also kept in memory for export. */
  finish(): LiveTrace {
    const trace: LiveTrace = { model: this.model, startedAt: new Date(this.started).toISOString(), rounds: this.rounds, summary: this.summary() };
    const holder = globalThis as { __synapseAgentTraces?: LiveTrace[] };
    holder.__synapseAgentTraces = [...(holder.__synapseAgentTraces || []), trace].slice(-KEEP);
    return trace;
  }
}

/** "inject 40ms · act 12ms · settle 310ms …", largest first, for the activity timeline. */
export function describeTimings(phases: Record<string, number> | undefined): string {
  return Object.entries(phases || {}).filter(([phase, ms]) => phase !== "total" && ms > 0).sort((a, b) => b[1] - a[1])
    .map(([phase, ms]) => `${phase} ${ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}`).join(" · ");
}

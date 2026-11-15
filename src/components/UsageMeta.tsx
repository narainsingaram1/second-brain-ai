import { useEffect, useRef, useState } from "react";
import type { TurnUsage } from "../types";
import { formatCost, formatDuration, formatTokens } from "../utils/usage";

/** "12.4s · 18.2k tokens · $0.031" under a reply; click for the breakdown. */
export function UsageMeta({ usage }: { usage: TurnUsage }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  const tokens = usage.inputTokens + usage.outputTokens;
  const cost = usage.cost !== undefined ? `${usage.costComplete === false ? "≥" : ""}${formatCost(usage.cost)}` : "";
  const rows: Array<[string, string]> = [
    ["Total time", formatDuration(usage.ms)],
    ...(usage.firstTextMs !== undefined ? [["First words after", formatDuration(usage.firstTextMs)] as [string, string]] : []),
    ["Model", usage.model],
    ["Model requests", String(usage.calls)],
    ...(usage.webSearches ? [["Web searches", String(usage.webSearches)] as [string, string]] : []),
    ["Input tokens", usage.inputTokens.toLocaleString()],
    ...(usage.cachedTokens ? [["  of which cached", usage.cachedTokens.toLocaleString()] as [string, string]] : []),
    ["Output tokens", usage.outputTokens.toLocaleString()],
    ...(usage.reasoningTokens ? [["  of which reasoning", usage.reasoningTokens.toLocaleString()] as [string, string]] : []),
    ["Cost", cost ? `${cost}${usage.costComplete === false ? " (some requests reported no cost)" : ""}` : "Not reported by this provider"],
  ];
  return (
    <div className="chat-usage" ref={ref}>
      <button type="button" className="chat-usage-button" aria-expanded={open} aria-label="Time, tokens and cost of this reply" onClick={() => setOpen(v => !v)}>
        <span>{formatDuration(usage.ms)}</span>
        {tokens > 0 && <span>{formatTokens(tokens)} tokens</span>}
        {cost && <span>{cost}</span>}
      </button>
      {open && (
        <dl className="chat-usage-pop" role="dialog" aria-label="Reply usage">
          {rows.map(([k, v]) => <div key={k}><dt>{k.trim()}</dt><dd className={k.startsWith("  ") ? "is-sub" : ""}>{v}</dd></div>)}
        </dl>
      )}
    </div>
  );
}

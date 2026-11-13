import { MousePointerClick, Square, X } from "lucide-react";
import type { ActivityToast } from "../services/toolRouter";

/**
 * Soft steps the assistant just took on a website (typed into a field, chose an option). They ran without
 * asking because they commit nothing; this is the user's chance to see them and stop the work.
 */
export function AgentToasts({ toasts, onDismiss, onStop }: { toasts: ActivityToast[]; onDismiss: (id: string) => void; onStop: () => void }) {
  return <div className="agent-toasts" role="status" aria-live="polite">
    {toasts.map(t => <div key={t.id} className="agent-toast">
      <MousePointerClick size={14} aria-hidden="true" />
      <span><strong>{t.site}</strong> · {t.label}</span>
      <button type="button" onClick={onStop} aria-label="Stop the assistant"><Square size={12} />Stop</button>
      <button type="button" onClick={() => onDismiss(t.id)} aria-label="Dismiss"><X size={12} /></button>
    </div>)}
  </div>;
}

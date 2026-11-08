import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Send, ShieldAlert, Undo2, X } from "lucide-react";
import type { ApprovalRequest } from "../types";

const STATUS: Record<ApprovalRequest["status"], string> = {
  pending: "Waiting for your decision",
  executed: "Approved and applied", rejected: "Rejected · nothing changed", failed: "Not applied", expired: "No longer available",
};
/** Seconds between approving a message and sending it, so a mistaken click can be undone. */
export const SEND_DELAY_SECONDS = 10;
const isSend = (tool: string) => tool === "send_email" || tool === "send_draft";

/**
 * A change the assistant proposed, shown exactly as it will be applied, with the user's decision.
 * Messages to send show their full text and any warnings, and wait out a short undo window after approval.
 */
export function ApprovalCard({ approval, onDecide }: { approval: ApprovalRequest; onDecide?: (decision: "approve" | "reject") => Promise<void> }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pending = approval.status === "pending";
  const send = isSend(approval.tool);
  useEffect(() => () => window.clearInterval(timer.current), []); // Leaving the page cancels an unsent message.

  const decide = async (decision: "approve" | "reject") => {
    if (!onDecide || busy) return;
    setBusy(decision);
    try { await onDecide(decision); } finally { setBusy(null); }
  };
  const approve = () => {
    if (!send) return decide("approve");
    let left = SEND_DELAY_SECONDS;
    setCountdown(left);
    timer.current = window.setInterval(() => {
      left -= 1;
      if (left > 0) { setCountdown(left); return; }
      window.clearInterval(timer.current);
      setCountdown(null);
      void decide("approve");
    }, 1000);
  };
  const undo = () => { window.clearInterval(timer.current); setCountdown(null); };

  return <section className={`approval-card is-${approval.status}`} aria-label={`Approval request: ${approval.summary}`}>
    <header>{send ? <Send size={15} aria-hidden="true" /> : <ShieldAlert size={15} aria-hidden="true" />}<strong>{approval.summary}</strong></header>
    {approval.warnings?.length ? <ul className="approval-warnings" role="alert">{approval.warnings.map(w => <li key={w}><AlertTriangle size={13} aria-hidden="true" />{w}</li>)}</ul> : null}
    {approval.details.length > 0 && <ul className="approval-details">{approval.details.map(d => <li key={d}>{d}</li>)}</ul>}
    {approval.preview && <pre className="approval-preview" tabIndex={0} aria-label="Full message">{approval.preview}</pre>}
    <p className="approval-reason">{approval.reason}</p>
    {pending ? <div className="approval-actions" aria-live="polite">
      {countdown !== null ? <>
        <span className="approval-countdown">Sending in {countdown}s…</span>
        <button type="button" className="approval-reject" onClick={undo}><Undo2 size={14} />Undo</button>
      </> : <>
        <button type="button" className="approval-approve" disabled={!!busy || !onDecide} onClick={approve}>
          {send ? <Send size={14} /> : <Check size={14} />}{busy === "approve" ? (send ? "Sending…" : "Applying…") : send ? "Send" : "Approve"}
        </button>
        <button type="button" className="approval-reject" disabled={!!busy || !onDecide} onClick={() => decide("reject")}><X size={14} />{busy === "reject" ? "Rejecting…" : send ? "Don’t send" : "Reject"}</button>
      </>}
    </div> : <p role="status" className="approval-status">{send && approval.status === "executed" ? "Sent" : STATUS[approval.status]}{approval.error ? ` · ${approval.error}` : ""}</p>}
  </section>;
}

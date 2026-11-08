import { useState } from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import type { ApprovalRequest } from "../types";

const STATUS: Record<ApprovalRequest["status"], string> = {
  pending: "Waiting for your decision",
  executed: "Approved and applied", rejected: "Rejected · nothing changed", failed: "Not applied", expired: "No longer available",
};

/** A change the assistant proposed, shown exactly as it will be applied, with the user's decision. */
export function ApprovalCard({ approval, onDecide }: { approval: ApprovalRequest; onDecide?: (decision: "approve" | "reject") => Promise<void> }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const pending = approval.status === "pending";
  const decide = async (decision: "approve" | "reject") => {
    if (!onDecide || busy) return;
    setBusy(decision);
    try { await onDecide(decision); } finally { setBusy(null); }
  };
  return <section className={`approval-card is-${approval.status}`} aria-label={`Approval request: ${approval.summary}`}>
    <header><ShieldAlert size={15} aria-hidden="true" /><strong>{approval.summary}</strong></header>
    {approval.details.length > 0 && <ul className="approval-details">{approval.details.map(d => <li key={d}>{d}</li>)}</ul>}
    <p className="approval-reason">{approval.reason}</p>
    {pending ? <div className="approval-actions">
      <button type="button" className="approval-approve" disabled={!!busy || !onDecide} onClick={() => decide("approve")}><Check size={14} />{busy === "approve" ? "Applying…" : "Approve"}</button>
      <button type="button" className="approval-reject" disabled={!!busy || !onDecide} onClick={() => decide("reject")}><X size={14} />{busy === "reject" ? "Rejecting…" : "Reject"}</button>
    </div> : <p role="status" className="approval-status">{STATUS[approval.status]}{approval.error ? ` · ${approval.error}` : ""}</p>}
  </section>;
}

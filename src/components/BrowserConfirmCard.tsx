import { useEffect, useRef } from "react";
import { Check, MousePointerClick, X } from "lucide-react";
import type { BrowserConfirmRequest } from "../services/browserAgent";

/**
 * A step on a website that commits something for the user (buy, send, post, delete…), paused until they
 * answer. Only this answer releases the step: the assistant cannot confirm it for itself.
 */
export function BrowserConfirmCard({ request, onAnswer }: { request: BrowserConfirmRequest; onAnswer: (allow: boolean) => void }) {
  const allow = useRef<HTMLButtonElement>(null);
  useEffect(() => { allow.current?.focus({ preventScroll: true }); }, [request.id]);
  return <section className="approval-card is-pending browser-confirm" role="alertdialog" aria-label={`Allow on ${request.site}: ${request.label}`}>
    <header><MousePointerClick size={15} aria-hidden="true" /><strong>{request.label}</strong></header>
    <ul className="approval-details">
      {request.reason && <li><strong>Why you’re asked:</strong> {request.reason}</li>}
      <li>On {request.site}, in the Synapse tab group. The assistant is waiting for you.</li>
      <li>Check the tab first if you want to see exactly what will happen.</li>
    </ul>
    <div className="approval-actions">
      <button type="button" ref={allow} className="approval-approve" onClick={() => onAnswer(true)}><Check size={14} />Allow</button>
      <button type="button" className="approval-reject" onClick={() => onAnswer(false)}><X size={14} />Don’t allow</button>
    </div>
  </section>;
}

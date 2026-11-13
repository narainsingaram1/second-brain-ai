import { useEffect, useRef } from "react";
import { AppWindow, Ban, Check, MousePointerClick, X } from "lucide-react";
import type { BrowserConfirmRequest } from "../services/browserAgent";
import { showNative } from "../services/nativeApproval";

type Answer = boolean | "deny_site";

/**
 * A step on a website that commits something for the user (buy, send, post, delete…), paused until they
 * answer. Only this answer releases the step: the assistant cannot confirm it for itself. In the desktop app
 * the answer comes from the native approval window, and this card can only bring it forward or decline.
 */
export function BrowserConfirmCard({ request, onAnswer }: { request: BrowserConfirmRequest; onAnswer: (answer: Answer) => void }) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => { primary.current?.focus({ preventScroll: true }); }, [request.id]);
  return <section className="approval-card is-pending browser-confirm" role="alertdialog" aria-label={`Allow on ${request.site}: ${request.label}`}>
    <header><MousePointerClick size={15} aria-hidden="true" /><strong>{request.label}</strong></header>
    {!request.native && request.screenshot && <img className="browser-confirm-shot" src={request.screenshot} alt={`The page on ${request.site}, with the element that will be used outlined in red`} />}
    <ul className="approval-details">
      {request.reason && <li><strong>Why you’re asked:</strong> {request.reason}</li>}
      {request.native
        ? <li>Answer in the approval window on {request.site}. The assistant is waiting for you.</li>
        : <><li>On {request.site}, in the Synapse tab group. The assistant is waiting for you.</li>
          <li>Check the tab first if you want to see exactly what will happen.</li></>}
    </ul>
    <div className="approval-actions">
      {request.native
        ? <button type="button" ref={primary} className="approval-approve" onClick={() => void showNative()}><AppWindow size={14} />Show approval window</button>
        : <button type="button" ref={primary} className="approval-approve" onClick={() => onAnswer(true)}><Check size={14} />Allow</button>}
      <button type="button" className="approval-reject" onClick={() => onAnswer(false)}><X size={14} />Don’t allow</button>
      {!request.native && <button type="button" className="approval-reject" onClick={() => onAnswer("deny_site")}><Ban size={14} />Never on {request.site}</button>}
    </div>
  </section>;
}

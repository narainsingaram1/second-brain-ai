import { useMemo, useState } from "react";
import { Ban, Check, CircleSlash, Hand, History, ShieldCheck, X } from "lucide-react";
import { loadUserPolicy, saveUserPolicy } from "../services/agentPolicy";
import { AgentAuditLog, type AuditEntry } from "../services/agentAudit";

/** What always waits for the user's go-ahead, whatever the settings below say. Enforced in code, not by the model. */
const ALWAYS_ASKS = [
  "Deleting tasks, notes, courses or any other record",
  "Sending email or calendar invitations",
  "Buying, paying, sending, posting, booking or submitting on a website",
  "Sending, deleting or quitting in a Mac app, and typing in Terminal",
  "More than 5 changes in one request",
  "Changing or removing records after reading a web page, email or uploaded file",
];
const NEVER = [
  "Types passwords or card numbers. Those fields are yours",
  "Uses password managers, Keychain or System Settings",
  "Solves CAPTCHAs or bot checks for you",
];

const OUTCOME: Record<AuditEntry["outcome"], { label: string; icon: typeof Check; tone: string }> = {
  ran: { label: "Done", icon: Check, tone: "text-emerald-600 dark:text-emerald-400" },
  declined: { label: "You said no", icon: X, tone: "text-slate-500" },
  denied: { label: "Blocked", icon: Ban, tone: "text-rose-600 dark:text-rose-400" },
  failed: { label: "Failed", icon: CircleSlash, tone: "text-rose-600 dark:text-rose-400" },
  user_only: { label: "Left for you", icon: Hand, tone: "text-amber-600 dark:text-amber-400" },
};
const APPROVAL: Record<AuditEntry["approval"], string> = { user: "you approved", toast: "shown to you", auto: "looked only", none: "" };

function Toggle({ checked, onChange, title, detail }: { checked: boolean; onChange: (value: boolean) => void; title: string; detail: string }) {
  return <label className="flex items-start justify-between gap-4 py-2.5 cursor-pointer">
    <span className="text-xs">
      <strong className="block text-ink font-semibold">{title}</strong>
      <span className="text-slate-500 dark:text-slate-400 leading-normal">{detail}</span>
    </span>
    <input type="checkbox" role="switch" className="mt-0.5 shrink-0" checked={checked} onChange={e => onChange(e.target.checked)} aria-label={title} />
  </label>;
}

/**
 * One place that says what the assistant may do on its own, what always waits for the user, and what it did on
 * websites and in Mac apps lately. Every toggle here only adds confirmations; nothing can switch the built-in ones off.
 */
export function PermissionsSettings({ askBeforeChanges, onAskBeforeChanges }: { askBeforeChanges: boolean; onAskBeforeChanges?: (value: boolean) => void }) {
  const [policy, setPolicy] = useState(loadUserPolicy);
  const [showLog, setShowLog] = useState(false);
  const recent = useMemo(() => showLog ? new AgentAuditLog().entries().filter(e => e.approval !== "auto").slice(-12).reverse() : [], [showLog]);

  return <section className="p-4 rounded-2xl border border-line space-y-3" aria-labelledby="permissions-heading">
    <div>
      <h4 id="permissions-heading" className="text-sm font-bold text-ink flex items-center gap-1.5">
        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        Permissions & safety
      </h4>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal mt-1">
        Iris can read your records and look things up on its own. Anything risky stops and asks you first, in the chat or in a
        window on your screen. It can't approve anything for itself. You can stop it any time with the stop button, or <kbd>⌘⌥.</kbd> in Mac apps.
      </p>
    </div>

    <div className="divide-y divide-[var(--workspace-line,#e9e9eb)] border-y border-line">
      {onAskBeforeChanges && <Toggle checked={askBeforeChanges} onChange={onAskBeforeChanges} title="Ask before every change to my data"
        detail="Tasks, notes, goals, courses and the rest: each change waits for your approval instead of saving right away." />}
      <Toggle checked={policy.confirmEverything} onChange={value => setPolicy(saveUserPolicy({ ...policy, confirmEverything: value }))}
        title="Ask before every step on websites and in Mac apps"
        detail="Every click and every text it types waits for your go-ahead, not only the risky ones. Slower, but nothing happens without you." />
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <p className="text-[11px] font-bold text-ink mb-1.5">Always asks you first</p>
        <ul className="space-y-1">{ALWAYS_ASKS.map(item => <li key={item} className="flex gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
          <Hand className="w-3 h-3 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />{item}</li>)}</ul>
      </div>
      <div>
        <p className="text-[11px] font-bold text-ink mb-1.5">Never</p>
        <ul className="space-y-1">{NEVER.map(item => <li key={item} className="flex gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
          <Ban className="w-3 h-3 mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />{item}</li>)}</ul>
        <p className="text-[11px] text-slate-400 mt-2 leading-snug">These are built in and can't be turned off. Choose which sites and Mac apps it may use below.</p>
      </div>
    </div>

    <div>
      <button type="button" onClick={() => setShowLog(!showLog)} aria-expanded={showLog}
        className="text-[11px] font-bold text-ink inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-line">
        <History className="w-3.5 h-3.5" aria-hidden="true" />{showLog ? "Hide recent actions" : "Recent actions on websites and apps"}
      </button>
      {showLog && (recent.length ? <ol className="mt-2 space-y-1.5" aria-label="Recent actions">
        {recent.map(entry => {
          const outcome = OUTCOME[entry.outcome];
          return <li key={entry.seq} className="flex items-start gap-2 text-[11px] leading-snug">
            <outcome.icon className={`w-3.5 h-3.5 mt-px shrink-0 ${outcome.tone}`} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="text-ink">{entry.summary}</span>
              <span className="text-slate-400"> · {entry.target.replace(/^app:/, "")} · {outcome.label}{entry.outcome === "ran" && APPROVAL[entry.approval] ? `, ${APPROVAL[entry.approval]}` : ""}</span>
            </span>
            <time className="text-slate-400 shrink-0 tabular-nums" dateTime={entry.ts}>{new Date(entry.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
          </li>;
        })}
      </ol> : <p className="mt-2 text-[11px] text-slate-400">Nothing yet. Steps on websites and in Mac apps will be listed here.</p>)}
    </div>
  </section>;
}

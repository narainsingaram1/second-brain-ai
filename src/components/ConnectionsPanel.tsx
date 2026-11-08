import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Mail, RefreshCw } from "lucide-react";
import { clearGoogleEventCache, CONNECT_RESULT_KEY, disconnectGoogle, googleStatus, startGoogleConnect, type GoogleStatus } from "../services/serverApi";

/**
 * Google Calendar and Gmail for the assistant. The user picks how much to grant; tokens stay encrypted on
 * the server and can be revoked here at any time.
 */
export function ConnectionsPanel() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(() => { try { const n = sessionStorage.getItem(CONNECT_RESULT_KEY) || ""; sessionStorage.removeItem(CONNECT_RESULT_KEY); return n; } catch { return ""; } });

  useEffect(() => { googleStatus().then(setStatus).catch(e => setError(e.message)); }, []);
  const connect = async (access: "calendar" | "gmail" | "send") => {
    setBusy(true); setError("");
    try { await startGoogleConnect(access); } catch (e) { setError(e instanceof Error ? e.message : "Could not start the connection."); setBusy(false); }
  };
  const disconnect = async () => {
    if (!window.confirm("Disconnect Google? The assistant loses access to your calendar and email, and Synapse revokes its access at Google.")) return;
    setBusy(true); setError("");
    try { setStatus(await disconnectGoogle()); clearGoogleEventCache(); setNotice("Google disconnected. Access was revoked."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not disconnect."); }
    finally { setBusy(false); }
  };

  const button = "px-3 py-1.5 rounded-lg border border-line text-xs font-semibold disabled:opacity-50";
  return <section className="space-y-2" aria-label="Connections">
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-muted" />Connections</h4>
    {notice && <p role="status" className="p-3 rounded-2xl text-xs bg-raised border border-line">{notice}</p>}
    {!status && !error && <p className="text-xs text-muted flex items-center gap-2"><RefreshCw className="w-3 h-3 animate-spin" />Checking connections…</p>}
    {status && !status.connected && <div className="rounded-2xl border border-line p-3.5 space-y-3 text-xs">
      <p className="text-slate-500 dark:text-slate-400">Let the assistant see your Google Calendar, and optionally read your email and save reply drafts. It never sends email.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={button} onClick={() => connect("calendar")}><CalendarDays className="w-3.5 h-3.5 inline mr-1" />Connect Calendar</button>
        <button type="button" disabled={busy} className={`${button} bg-slate-900 text-white dark:bg-white dark:text-slate-950`} onClick={() => connect("gmail")}><Mail className="w-3.5 h-3.5 inline mr-1" />Connect Calendar + Gmail</button>
      </div>
    </div>}
    {status?.connected && <div className="rounded-2xl border border-line p-3.5 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {status.status === "active" ? <CheckCircle2 className="w-4 h-4 text-[var(--workspace-success)]" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
        <span className="mr-auto"><strong>{status.email}</strong> · {status.send ? "Calendar and Gmail (read, drafts, send with approval)" : status.gmail ? "Calendar and Gmail (read, drafts)" : "Calendar"}{status.connectedAt ? ` · since ${new Date(status.connectedAt).toLocaleDateString()}` : ""}</span>
        <button type="button" disabled={busy} className={button} onClick={disconnect}>Disconnect</button>
      </div>
      {status.status === "needs_reconnect" && <div className="flex flex-wrap items-center gap-2 text-amber-700 dark:text-amber-300">
        <span className="mr-auto">Google access expired or was revoked{status.lastError ? ` (${status.lastError})` : ""}.</span>
        <button type="button" disabled={busy} className={button} onClick={() => connect(status.send ? "send" : status.gmail ? "gmail" : "calendar")}>Reconnect</button>
      </div>}
      {status.status === "active" && !status.gmail && <button type="button" disabled={busy} className="text-xs underline text-muted" onClick={() => connect("gmail")}>Also allow Gmail</button>}
      {status.status === "active" && status.gmail && !status.send && <p className="text-slate-500 dark:text-slate-400">
        <button type="button" disabled={busy} className="underline text-ink" onClick={() => connect("send")}>Allow sending email</button>: the assistant can send email you ask for, only after you approve the full message. You get 10 seconds to undo, and at most 20 sends a day.
      </p>}
    </div>}
    {error && <p role="alert" className="p-3 rounded-2xl text-xs flex items-center gap-2 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</p>}
  </section>;
}

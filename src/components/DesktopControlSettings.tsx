import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { hasNativeApproval } from "../services/nativeApproval";
import { desktopCall, desktopStatus, type DesktopApp, type DesktopStatus } from "../services/desktopAgent";

/**
 * Desktop control (macOS app only): grant the Accessibility permission and choose, app by app, where the
 * assistant may work. Allowing an app asks again in the native approval window, so nothing on a page can
 * quietly widen the list; turning one off takes effect at once.
 */
export function DesktopControlSettings() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [apps, setApps] = useState<DesktopApp[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const refresh = async () => {
    const next = await desktopStatus();
    setStatus(next);
    if (next?.trusted) { try { setApps(await desktopCall<DesktopApp[]>("desktop_apps")); } catch (e) { setMessage(String(e)); } }
  };
  useEffect(() => { void refresh(); }, []);
  if (!hasNativeApproval() || (status && !status.supported)) return null;

  const requestAccess = async () => {
    setMessage("Turn on Synapse in the window macOS opened (Privacy & Security → Accessibility), then come back.");
    try { if (await desktopCall<boolean>("desktop_request_access")) setMessage(""); } catch (e) { setMessage(String(e)); }
    void refresh();
  };
  const toggle = async (app: DesktopApp) => {
    setBusy(app.bundleId); setMessage(app.allowed ? "" : `Confirm in the window that just opened to allow ${app.name}.`);
    try { await desktopCall("desktop_allow_app", { bundleId: app.bundleId, name: app.name, allow: !app.allowed }); setMessage(""); }
    catch (e) { setMessage(String(e)); }
    finally { setBusy(""); void refresh(); }
  };

  return <section className="p-3.5 rounded-2xl border border-line space-y-2" aria-labelledby="desktop-control-heading">
    <h4 id="desktop-control-heading" className="text-xs font-bold text-ink flex items-center gap-1.5">
      <Monitor className="w-4 h-4 text-muted" aria-hidden="true" />
      Desktop control
    </h4>
    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
      Lets the assistant work in apps on this Mac that you allow, one by one: make a note, find a file, fill in a reminder. It never touches
      password managers, Keychain or System Settings, never types passwords, and asks you first before anything that sends, deletes or quits.
      Press <kbd>⌘⌥.</kbd> to stop it at any time.
    </p>
    {status?.managedOff && <p className="text-[11px] font-bold text-ink">Turned off by your organization.</p>}
    {status && !status.trusted && !status.managedOff && <button type="button" onClick={() => void requestAccess()}
      className="px-3 py-2 rounded-xl border border-line text-xs font-bold">Give Synapse Accessibility access</button>}
    {status?.trusted && !status.managedOff && <ul className="space-y-1 max-h-56 overflow-y-auto" aria-label="Open apps">
      {apps.map(app => <li key={app.bundleId} className="flex items-center justify-between gap-3 text-xs text-ink">
        <span className="min-w-0 truncate">{app.name}{app.blocked && <span className="text-slate-400"> · never</span>}</span>
        <input type="checkbox" role="switch" checked={app.allowed} disabled={!!app.blocked || busy === app.bundleId}
          onChange={() => void toggle(app)} aria-label={`Let the assistant use ${app.name}`} title={app.blocked || ""} />
      </li>)}
      {!apps.length && <li className="text-[11px] text-slate-400">Open an app to allow it here.</li>}
    </ul>}
    {message && <p className="text-[11px] text-slate-500" role="status">{message}</p>}
  </section>;
}

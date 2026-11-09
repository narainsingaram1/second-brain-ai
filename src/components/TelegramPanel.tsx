import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, MessageCircle, RefreshCw } from "lucide-react";
import { disconnectTelegram, startTelegramLink, telegramStatus, updateTelegramPrefs, type TelegramStatus } from "../services/serverApi";
import { formatTime } from "../utils/events";

const LINK_WAIT_MS = 120_000;
const hourLabel = (hour: number) => formatTime(`${String(hour).padStart(2, "0")}:00`);

/** Text the assistant from Telegram, and get reminders there. */
export function TelegramPanel() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const poll = useRef<number | undefined>(undefined);

  useEffect(() => {
    telegramStatus().then(setStatus).catch(e => setError(e.message));
    return () => window.clearInterval(poll.current);
  }, []);

  const connect = async () => {
    setError("");
    // Opened before the request so the browser treats it as coming from this click.
    const tab = window.open("", "_blank");
    try {
      const { url } = await startTelegramLink(Intl.DateTimeFormat().resolvedOptions().timeZone);
      if (tab) tab.location.href = url; else window.location.href = url;
      setWaiting(true);
      const started = Date.now();
      window.clearInterval(poll.current);
      poll.current = window.setInterval(async () => {
        const next = await telegramStatus().catch(() => null);
        if (next?.linked) setStatus(next);
        if (next?.linked || Date.now() - started > LINK_WAIT_MS) { window.clearInterval(poll.current); setWaiting(false); }
      }, 2500);
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Could not start connecting Telegram.");
    }
  };
  const save = (prefs: Parameters<typeof updateTelegramPrefs>[0]) => {
    setError("");
    updateTelegramPrefs({ ...prefs, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).then(setStatus).catch(e => setError(e.message));
  };
  const disconnect = () => {
    if (!window.confirm("Disconnect Telegram? Iris stops replying there and reminders end.")) return;
    setError("");
    disconnectTelegram().then(setStatus).catch(e => setError(e.message));
  };

  const button = "px-3 py-1.5 rounded-lg border border-line text-xs font-semibold disabled:opacity-50";
  return <section className="space-y-2" aria-label="Telegram">
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5"><MessageCircle className="w-4 h-4 text-muted" />Telegram</h4>
    {!status && !error && <p className="text-xs text-muted flex items-center gap-2"><RefreshCw className="w-3 h-3 animate-spin" />Checking Telegram…</p>}
    {status && !status.linked && <div className="rounded-2xl border border-line p-3.5 space-y-3 text-xs">
      <p className="text-slate-500 dark:text-slate-400">Text Iris from your phone to add tasks, ask what's due or change anything here, and get reminders before deadlines.</p>
      <button type="button" disabled={waiting} className={button} onClick={connect}>{waiting ? "Waiting for Telegram…" : "Connect Telegram"}</button>
      {waiting && <p role="status" className="text-slate-500 dark:text-slate-400">Press Start in the Telegram chat that just opened.</p>}
    </div>}
    {status?.linked && <div className="rounded-2xl border border-line p-3.5 space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-[var(--workspace-success)]" />
        <span className="mr-auto"><strong>{status.username ? `@${status.username}` : "Connected"}</strong></span>
        <button type="button" className={button} onClick={disconnect}>Disconnect</button>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={status.briefEnabled} onChange={e => save({ briefEnabled: e.target.checked })} />
        <span className="mr-auto">Morning brief</span>
        <select aria-label="Morning brief time" className="px-2 py-1 rounded-lg border border-line bg-transparent" disabled={!status.briefEnabled} value={status.briefHour} onChange={e => save({ briefHour: Number(e.target.value) })}>
          {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={status.alertsEnabled} onChange={e => save({ alertsEnabled: e.target.checked })} />
        <span>Reminders before deadlines and events</span>
      </label>
    </div>}
    {error && <p role="alert" className="p-3 rounded-2xl text-xs flex items-center gap-2 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</p>}
  </section>;
}

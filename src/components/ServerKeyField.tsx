import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Lock, RefreshCw } from "lucide-react";
import { getStoredKey, removeStoredKey, storeKey, type StoredKeyStatus } from "../services/serverApi";
import { isServerHeldKey, SERVER_HELD_KEY } from "../services/providerTransport";

/**
 * Provider key stored encrypted on the server. The browser can add, replace or remove it and sees only its
 * last four characters. A key previously saved in this browser can be moved over in one step.
 */
export function ServerKeyField({ localKey, onUseKey }: { localKey: string; onUseKey: (key: string) => void }) {
  const [status, setStatus] = useState<StoredKeyStatus | null>(null);
  const [input, setInput] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const browserKey = localKey && !isServerHeldKey(localKey) ? localKey : "";

  useEffect(() => {
    let live = true;
    getStoredKey().then(s => { if (live) setStatus(s); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  const save = async (value: string) => {
    setBusy(true); setError("");
    try {
      const next = await storeKey(value);
      setStatus(next); setInput(""); setReplacing(false);
      onUseKey(SERVER_HELD_KEY); // Replaces any copy kept in this browser.
    } catch (e) { setError(e instanceof Error ? e.message : "Could not store the key."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm("Remove your AI provider key from the server? The assistant stops working until you add one again.")) return;
    setBusy(true); setError("");
    try { setStatus(await removeStoredKey()); onUseKey(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not remove the key."); }
    finally { setBusy(false); }
  };

  return <div className="space-y-2">
    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5"><Lock className="w-4 h-4 text-[var(--workspace-success)]" />OpenRouter API Key</label>
    {!status && !error && <p className="text-xs text-muted flex items-center gap-2"><RefreshCw className="w-3 h-3 animate-spin" />Checking secure storage…</p>}
    {status?.configured && !replacing && <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-raised p-3 text-xs">
      <CheckCircle2 className="w-4 h-4 text-[var(--workspace-success)]" />
      <span className="mr-auto">Stored encrypted on the server · ends in <code className="font-mono">{status.hint}</code></span>
      <button type="button" disabled={busy} onClick={() => setReplacing(true)} className="px-2.5 py-1 rounded-lg border border-line font-semibold">Replace</button>
      <button type="button" disabled={busy} onClick={remove} className="px-2.5 py-1 rounded-lg border border-line font-semibold text-rose-600">Remove</button>
    </div>}
    {status && (!status.configured || replacing) && <>
      {browserKey && !status.configured && <div className="rounded-2xl border border-line bg-raised p-3 text-xs space-y-2">
        <p>A key is saved in this browser. Move it to encrypted server storage so it is no longer kept on this device.</p>
        <button type="button" disabled={busy} onClick={() => save(browserKey)} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-950 font-semibold">{busy ? "Moving…" : "Move to secure storage"}</button>
      </div>}
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (input.trim()) save(input.trim()); }}>
        <input type="password" autoComplete="off" placeholder="sk-or-v1-…" value={input} onChange={e => { setInput(e.target.value); setError(""); }}
          aria-label="OpenRouter API key" className="flex-1 bg-raised text-xs font-mono px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button type="submit" disabled={busy || !input.trim()} className="px-3 rounded-2xl border border-line text-xs font-semibold disabled:opacity-40">{busy ? "Checking…" : "Save key"}</button>
        {replacing && <button type="button" onClick={() => { setReplacing(false); setInput(""); }} className="px-3 rounded-2xl text-xs">Cancel</button>}
      </form>
    </>}
    {error && <p role="alert" className="p-3 rounded-2xl text-xs flex items-center gap-2 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</p>}
    <p className="text-[11px] text-slate-400 leading-normal">The key is checked with OpenRouter, then encrypted on the server (AES-256-GCM). It is never sent back to any browser; AI requests use it on the server.</p>
  </div>;
}

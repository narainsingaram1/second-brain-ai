import { useEffect, useState } from "react";
import { MousePointerClick } from "lucide-react";
import { browserAgentEnabled, browserBridge, setBrowserAgentEnabled, type BrowserStatus } from "../services/browserAgent";

/** Settings for the assistant working in the user's Chrome: install, connect, and turn it on or off. */
export function BrowserAgentSettings() {
  const [status, setStatus] = useState<BrowserStatus | "checking">("checking");
  const [enabled, setEnabled] = useState(browserAgentEnabled);
  const [pairing, setPairing] = useState(false);
  const [message, setMessage] = useState("");
  const check = async () => { const bridge = browserBridge(); setStatus(bridge ? await bridge.status() : "unavailable"); };
  useEffect(() => { void check(); }, []);

  const connect = async () => {
    const bridge = browserBridge();
    if (!bridge) return;
    setPairing(true); setMessage("Approve the request in the window the extension opened.");
    try { const paired = await bridge.pair(); setMessage(paired ? "" : "Not connected. You can try again any time."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Couldn't connect."); }
    finally { setPairing(false); void check(); }
  };
  const toggle = () => { const next = !enabled; setBrowserAgentEnabled(next); setEnabled(next); };

  return <section className="p-3.5 rounded-2xl border border-line space-y-2" aria-labelledby="browser-agent-heading">
    <h4 id="browser-agent-heading" className="text-xs font-bold text-ink flex items-center gap-1.5">
      <MousePointerClick className="w-4 h-4 text-muted" aria-hidden="true" />
      Browser agent
    </h4>
    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
      Lets the assistant open sites and do things for you in Chrome, where you're already signed in: search, compare, fill in forms, add to carts.
      It works in its own tab group, never types passwords or card numbers, and asks you before buying, sending, posting or deleting anything.
    </p>
    {status === "checking" && <p className="text-[11px] text-slate-400" role="status">Checking for the extension…</p>}
    {status === "unavailable" && <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
      <p className="font-bold text-ink">The Synapse Browser Agent extension isn't installed in this browser.</p>
      <ol className="list-decimal pl-4 space-y-0.5">
        <li>In Chrome, open <code>chrome://extensions</code> and turn on Developer mode.</li>
        <li>Click <em>Load unpacked</em> and choose the <code>extension</code> folder of the Synapse project.</li>
        <li>Reload this page, then come back here and connect.</li>
      </ol>
      <button type="button" onClick={() => void check()} className="text-[11px] font-bold px-2.5 py-1 rounded-full border border-line">Check again</button>
    </div>}
    {status === "not_paired" && <button type="button" onClick={() => void connect()} disabled={pairing}
      className="px-3 py-2 rounded-xl border border-line text-xs font-bold">{pairing ? "Waiting for your approval…" : "Connect to this browser"}</button>}
    {status === "ready" && <label className="flex items-center justify-between gap-3 text-xs text-ink">
      <span><strong>Connected.</strong> Use the browser when I ask for something on a website</span>
      <input type="checkbox" role="switch" checked={enabled} onChange={toggle} aria-label="Let the assistant use this browser" />
    </label>}
    {message && <p className="text-[11px] text-slate-500" role="status">{message}</p>}
  </section>;
}

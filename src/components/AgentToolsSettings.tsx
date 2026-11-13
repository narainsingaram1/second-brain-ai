import { useEffect, useState } from "react";
import { Plug } from "lucide-react";
import { hasNativeApproval } from "../services/nativeApproval";

interface McpStatus { enabled: boolean; command: string; args: string[]; clients: string[] }

/**
 * MCP (desktop app only): lets other AI apps use Synapse's browser and Mac-app tools, through the same tiers,
 * approvals and audit log. Off by default; turning it on and each client's first connection are confirmed in
 * the native approval window.
 */
export function AgentToolsSettings() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [message, setMessage] = useState("");
  const call = async <T,>(cmd: string, args: Record<string, unknown> = {}) => (await import("@tauri-apps/api/core")).invoke<T>(cmd, args);
  const refresh = async () => { try { setStatus(await call<McpStatus>("mcp_status")); } catch { setStatus(null); } };
  useEffect(() => { void refresh(); }, []);
  if (!hasNativeApproval() || !status) return null;

  const toggle = async () => {
    setMessage(status.enabled ? "" : "Confirm in the window that just opened.");
    try { await call("mcp_set_enabled", { enabled: !status.enabled }); setMessage(""); } catch (e) { setMessage(String(e)); }
    void refresh();
  };
  const config = JSON.stringify({ mcpServers: { synapse: { command: status.command, args: status.args } } }, null, 2);

  return <section className="p-3.5 rounded-2xl border border-line space-y-2" aria-labelledby="agent-tools-heading">
    <h4 id="agent-tools-heading" className="text-xs font-bold text-ink flex items-center gap-1.5">
      <Plug className="w-4 h-4 text-muted" aria-hidden="true" />
      Agent tools for other apps (MCP)
    </h4>
    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
      Lets AI apps you connect (Claude, editors, your own agents) use Synapse to act in Chrome and in Mac apps you allowed. Each app asks you once when it
      connects, and anything that sends, pays, deletes or posts still asks you every time. Everything is in the activity log.
    </p>
    <label className="flex items-center justify-between gap-3 text-xs text-ink">
      <span>Allow MCP connections</span>
      <input type="checkbox" role="switch" checked={status.enabled} onChange={() => void toggle()} aria-label="Allow MCP connections" />
    </label>
    {status.enabled && <>
      <p className="text-[11px] text-slate-500">Add this to your MCP client's configuration:</p>
      <pre className="text-[10.5px] p-2 rounded-lg border border-line overflow-x-auto select-all">{config}</pre>
      {!!status.clients.length && <p className="text-[11px] text-slate-500">Connected this session: {status.clients.join(", ")}</p>}
    </>}
    {message && <p className="text-[11px] text-slate-500" role="status">{message}</p>}
  </section>;
}

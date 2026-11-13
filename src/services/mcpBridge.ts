import { AgentAuditLog } from "./agentAudit";
import { loadUserPolicy, saveUserPolicy } from "./agentPolicy";
import { BROWSER_TOOLS, browserAgentEnabled, browserToolset, type BrowserConfirmRequest } from "./browserAgent";
import { nativeBrowserLink } from "./browserLink";
import { DESKTOP_TOOLS, desktopReady, desktopToolset } from "./desktopAgent";
import { hasNativeApproval, nativeConfirm } from "./nativeApproval";
import { createAgentRouter } from "./toolRouter";
import { combineToolsets } from "./webTools";
import type { ExternalToolset } from "./agentDispatcher";
import type { OpenRouterTool } from "./openrouter";

/**
 * MCP clients (through `Synapse --mcp`, see src-tauri/src/hub.rs) call the same browser and Mac-app tools the
 * assistant uses, here in the main window, through the same router: policy, rate limits, text carried between
 * sources, approvals in the native window, and the audit log. Rust has already checked that MCP is on and that
 * the user allowed this client.
 */
const SESSION_IDLE_MS = 10 * 60_000;

export const mcpToolList = (tools: OpenRouterTool[]) =>
  tools.map(t => ({ name: t.function.name, description: t.function.description, inputSchema: t.function.parameters }));

interface Session { tools: ExternalToolset; last: number; controller: AbortController }

/** Handles one MCP tool call with the given toolset factory. Exported for tests. */
export function createMcpHandler(makeTools: (client: string) => Promise<ExternalToolset>, now = () => Date.now()) {
  const sessions = new Map<string, Session>();
  return async (call: { name: string; arguments: Record<string, unknown>; client: string }) => {
    let session = sessions.get(call.client);
    // A client idle for a while starts a fresh request: new per-request limits in the router.
    if (!session || now() - session.last > SESSION_IDLE_MS) {
      session = { tools: await makeTools(call.client), last: now(), controller: new AbortController() };
      sessions.set(call.client, session);
    }
    session.last = now();
    if (!session.tools.definitions.some(d => d.function.name === call.name)) throw new Error(`${call.name} isn't available right now (is Chrome connected and the app allowed?).`);
    const result = await session.tools.execute(call.name, call.arguments || {}, session.controller.signal);
    return result.output;
  };
}

let started = false;
/** Registers the tools with Rust and answers MCP calls. Desktop app only; safe to call more than once. */
export async function startMcpBridge(): Promise<void> {
  if (started || !hasNativeApproval()) return;
  started = true;
  const [{ invoke }, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]);
  await invoke("mcp_register_tools", { tools: mcpToolList([...BROWSER_TOOLS, ...DESKTOP_TOOLS]) }).catch(() => {});

  const handle = createMcpHandler(async client => {
    const link = nativeBrowserLink();
    const [browserOk, desktopOk] = await Promise.all([
      browserAgentEnabled() ? link.status().then(s => s === "ready") : Promise.resolve(false),
      desktopReady(),
    ]);
    const confirm = async (request: BrowserConfirmRequest, signal: AbortSignal) => {
      const decision = await nativeConfirm({ label: request.label, site: request.site, ...(request.reason ? { reason: `${client} asked. ${request.reason}` } : { reason: `${client} asked for this.` }),
        ...(request.screenshot ? { screenshot: request.screenshot } : {}), ...(request.grant ? { grant: request.grant } : {}) }, signal);
      if (decision === "deny_site") { const p = loadUserPolicy(); saveUserPolicy({ ...p, deniedHosts: [...p.deniedHosts, request.site] }); router.denyHost(request.site); }
      return decision === "allow";
    };
    const router = createAgentRouter({ policy: loadUserPolicy(), audit: new AgentAuditLog(), turnId: `mcp:${client}:${new Date().toISOString()}`, confirm });
    const tools = combineToolsets(
      browserOk ? router.wrap(browserToolset(link, { confirm: router.confirm })) : undefined,
      desktopOk ? router.wrap(desktopToolset()) : undefined);
    return tools ?? { definitions: [], instructions: "", execute: async () => { throw new Error("Nothing is connected."); } };
  });

  await listen<{ id: string; name: string; arguments: Record<string, unknown>; client: string }>("mcp-call", async ({ payload }) => {
    try { await invoke("mcp_result", { id: payload.id, ok: true, output: await handle(payload) }); }
    catch (error) { await invoke("mcp_result", { id: payload.id, ok: false, error: error instanceof Error ? error.message : String(error) }).catch(() => {}); }
  });
}

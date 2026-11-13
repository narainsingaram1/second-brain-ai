/**
 * The desktop app's native approval window (src-tauri/src/approval.rs). In the desktop app, a step that commits
 * something is answered there, in a separate always-on-top window, and not in the chat: this window can only
 * ask, withdraw (which denies) or bring the approval window forward.
 */
export type NativeDecision = "allow" | "deny" | "deny_site";
export interface NativeApprovalRequest { label: string; site: string; reason?: string; details?: string[]; screenshot?: string }

export function hasNativeApproval(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

const tauri = () => import("@tauri-apps/api/core");

/** Opens the approval window and resolves with the user's answer. Aborting withdraws the request (a deny). */
export async function askNative(request: NativeApprovalRequest, signal: AbortSignal, timeoutMs = 5 * 60_000): Promise<NativeDecision> {
  const { invoke } = await tauri();
  signal.throwIfAborted();
  const withdraw = () => { void invoke("approval_cancel_all").catch(() => {}); };
  const timer = setTimeout(withdraw, timeoutMs);
  signal.addEventListener("abort", withdraw, { once: true });
  try { return await invoke<NativeDecision>("approval_request", { request }); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", withdraw); }
}

/**
 * The desktop app's answer to a gate. A pause the extension raised (`grant`) is asked by Rust from its own copy of
 * the step, and approving it is what lets Rust release the extension's token; other gates (policy, text carried
 * between sites) are asked with the description given here.
 */
export async function nativeConfirm(request: NativeApprovalRequest & { grant?: string }, signal: AbortSignal): Promise<NativeDecision> {
  if (!request.grant) return askNative(request, signal);
  const { invoke } = await tauri();
  signal.throwIfAborted();
  const withdraw = () => { void invoke("approval_cancel_all").catch(() => {}); };
  const timer = setTimeout(withdraw, 5 * 60_000);
  signal.addEventListener("abort", withdraw, { once: true });
  try { return await invoke<NativeDecision>("browser_confirm", { handle: request.grant }); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", withdraw); }
}

export async function withdrawNative(): Promise<void> {
  try { await (await tauri()).invoke("approval_cancel_all"); } catch { /* Nothing open. */ }
}
export async function showNative(): Promise<void> {
  try { await (await tauri()).invoke("approval_focus"); } catch { /* Nothing open. */ }
}

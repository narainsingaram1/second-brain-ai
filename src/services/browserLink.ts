import type { BrowserLink, BrowserStatus } from "./browserAgent";

/**
 * The browser extension as the desktop app reaches it: Rust relays to Chrome through native messaging
 * (src-tauri/src/hub.rs). Rust keeps the extension's confirmation tokens; what comes back here carries only
 * opaque handles, which Rust redeems after the user allows the step in its own approval window.
 */
const tauri = () => import("@tauri-apps/api/core");

export interface LinkStatus { connected: boolean; version: string | null; hostInstalled: boolean }

export class NativeBrowserLink implements BrowserLink {
  async call<T = unknown>(request: Record<string, unknown> & { type: string }, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const { invoke } = await tauri();
    const onAbort = () => { if (request.type !== "stop") void invoke("browser_call", { request: { type: "stop" } }).catch(() => {}); };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const value = await invoke<T>("browser_call", { request });
      signal?.throwIfAborted();
      return value;
    } catch (error) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Stopped", "AbortError");
      throw error instanceof Error ? error : new Error(String(error));
    } finally { signal?.removeEventListener("abort", onAbort); }
  }
  async link(): Promise<LinkStatus> {
    return (await tauri()).invoke<LinkStatus>("browser_link_status");
  }
  async status(): Promise<BrowserStatus> {
    try {
      if (!(await this.link()).connected) return "unavailable";
      return (await this.call<{ paired: boolean }>({ type: "hello" })).paired ? "ready" : "not_paired";
    } catch { return "unavailable"; }
  }
  async pair(): Promise<boolean> {
    return (await this.call<{ paired: boolean }>({ type: "pair" })).paired;
  }
}

let shared: NativeBrowserLink | null = null;
export const nativeBrowserLink = () => (shared ??= new NativeBrowserLink());

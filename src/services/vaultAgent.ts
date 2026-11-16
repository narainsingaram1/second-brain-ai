import type { ExternalToolset } from "./agentDispatcher";
import type { OpenRouterTool } from "./openrouter";

/**
 * Saved logins (src-tauri/src/vault), as the assistant sees them: a site, a partly hidden username and a
 * nickname. Rust never returns a password to this window, so there is nothing secret here to leak. Signing in
 * with them comes later (browser_sign_in); for now the assistant can only tell what is saved.
 */
export interface SavedLogin { nickname: string; site: string; username: string; status: "saved" | "pending"; created: number; lastUsed?: number }

const tauri = () => import("@tauri-apps/api/core");
export async function vaultCall<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await tauri()).invoke<T>(command, args);
}

export const VAULT_TOOLS: OpenRouterTool[] = [
  { type: "function", function: { name: "vault_list", description: "List the logins the user saved in Synapse (Settings → Saved logins): site, partly hidden username and nickname. Never passwords.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false } } },
];

export const VAULT_INSTRUCTIONS = [
  "## Saved logins",
  "- The user can save logins in Synapse (Settings → Saved logins); vault_list shows which sites have one, with a partly hidden username. You never see or handle passwords, and must never ask the user for one in chat.",
  "- You can't sign in with a saved login yet. When a page needs signing in, tell the user whether a login for that site is saved, and ask them to sign in themselves in the tab.",
  "- To add or remove a login, the user does it in Settings → Saved logins. Don't offer to do it for them.",
].join("\n");

/** Words that mean the conversation is about signing in or saved accounts. */
const VAULT_WORDS = /\b(sign(?:ed|ing)? ?in|log(?:ged|ging)? ?in|login|logins|password|passwords|credential|credentials|saved accounts?|my accounts?)\b/i;
export function needsVault(prompt: string): boolean { return VAULT_WORDS.test(prompt); }

export function vaultToolset(call: typeof vaultCall = vaultCall): ExternalToolset {
  return {
    definitions: VAULT_TOOLS,
    instructions: VAULT_INSTRUCTIONS,
    async execute(name, _args, signal) {
      signal.throwIfAborted();
      if (name !== "vault_list") throw new Error(`Unsupported saved-login tool ${name}.`);
      const logins = await call<SavedLogin[]>("vault_list");
      // Only what the model needs; Rust already hid the usernames for this window.
      return { output: { logins: logins.map(l => ({ nickname: l.nickname, site: l.site, username: l.username, ...(l.status === "pending" ? { pending: true } : {}) })) },
        summary: `${logins.length} saved login${logins.length === 1 ? "" : "s"}` };
    },
  };
}

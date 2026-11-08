import { authenticate } from "./auth";
import { keyring, openSecret } from "./crypto";
import { serverEnv } from "./env";
import { HttpError } from "./http";
import { supabaseStore, type ServerStore } from "./store";

/** What a route needs from the outside world; tests swap in an in-memory store and a fixed key. */
export interface Deps {
  caller(request: Request): Promise<{ userId: string; store: ServerStore }>;
  secretsKey(): string;
}

export const productionDeps: Deps = {
  async caller(request) {
    const caller = await authenticate(request);
    return { userId: caller.userId, store: supabaseStore(caller.userId, caller.client) };
  },
  secretsKey: () => serverEnv().secretsKey,
};

export async function secretsAvailable(deps: Deps): Promise<boolean> {
  try { await keyring(deps.secretsKey()); return true; } catch { return false; }
}

/** The caller's decrypted provider key, or a 412 telling them to add one. Never logged or returned. */
export async function providerKey(deps: Deps, store: ServerStore): Promise<string> {
  const sealed = await store.getSecret("openrouter");
  if (!sealed) throw new HttpError(412, "Add your AI provider key in Settings so the assistant can run on the server.");
  return openSecret(deps.secretsKey(), store.userId, "openrouter", sealed);
}

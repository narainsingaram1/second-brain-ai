import { testOpenRouterKey } from "../../src/services/openrouter";
import { productionDeps, secretsAvailable, type Deps } from "../lib/context";
import { sealSecret } from "../lib/crypto";
import { HttpError, json, readJson, route } from "../lib/http";

const NAMES = new Set(["openrouter"]);

/**
 * Stores provider credentials encrypted on the server. The browser can add, replace or remove a key and
 * see its last four characters; it can never read the key back.
 */
export function secretsHandlers(deps: Deps = productionDeps, validate: (key: string) => Promise<{ success: boolean; message: string }> = testOpenRouterKey) {
  const requireStorage = async () => {
    if (!await secretsAvailable(deps)) throw new HttpError(503, "Secure key storage is not set up on this server yet.");
  };
  return {
    GET: route(async request => {
      const { store } = await deps.caller(request);
      const row = await store.getSecret("openrouter");
      return json({ openrouter: row ? { configured: true, hint: row.hint, updatedAt: row.updatedAt } : { configured: false } });
    }),
    POST: route(async request => {
      await requireStorage();
      const { userId, store } = await deps.caller(request);
      const body = await readJson<{ name?: unknown; value?: unknown }>(request, 10_000);
      const name = typeof body.name === "string" ? body.name : "";
      const value = typeof body.value === "string" ? body.value.trim() : "";
      if (!NAMES.has(name)) throw new HttpError(400, "Unknown credential.");
      if (value.length < 20 || value.length > 300 || /\s/.test(value)) throw new HttpError(400, "That does not look like a valid API key.");
      const check = await validate(value);
      if (!check.success) throw new HttpError(400, `The provider rejected this key: ${check.message}`);
      const sealed = await sealSecret(deps.secretsKey(), userId, name, value);
      await store.putSecret(name, { ...sealed, hint: value.slice(-4) });
      await store.appendAudit({ actor: "user", action: "stored credential", entityType: "secret", entityId: name, title: `AI provider key ending ${value.slice(-4)}` });
      return json({ [name]: { configured: true, hint: value.slice(-4) } });
    }),
    DELETE: route(async request => {
      const { store } = await deps.caller(request);
      const name = new URL(request.url).searchParams.get("name") || "";
      if (!NAMES.has(name)) throw new HttpError(400, "Unknown credential.");
      await store.deleteSecret(name);
      await store.appendAudit({ actor: "user", action: "removed credential", entityType: "secret", entityId: name, title: "AI provider key" });
      return json({ [name]: { configured: false } });
    }),
  };
}

export const { GET, POST, DELETE } = secretsHandlers();

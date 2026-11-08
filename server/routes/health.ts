import { productionDeps, secretsAvailable, type Deps } from "../lib/context";
import { json, route } from "../lib/http";

/** Which server features are available, so the app can fall back to running in the browser when they are not. */
export function healthHandlers(deps: Deps = productionDeps) {
  return {
    GET: route(async () => {
      const secure = await secretsAvailable(deps);
      return json({ ok: true, secrets: secure, agent: secure, approvals: secure, google: secure && !!deps.google?.() });
    }),
  };
}

export const { GET } = healthHandlers();

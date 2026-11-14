import { productionDeps, type Deps } from "../lib/context";
import { HttpError, json, readJson, route } from "../lib/http";
import { loadWorkspace } from "../lib/serverAgent";
import { runDueRoutines, runRoutine } from "../lib/routines";
import { sameSecret } from "../lib/telegram";
import { localClock, routineZone } from "../../src/utils/routines";

const RECENT_RUNS = 40;

/**
 * Routines on the server.
 *   Scheduler (Authorization: Bearer CRON_SECRET): runs every routine that is due, after answering.
 *   Signed-in user: GET lists recent runs; POST { routineId } runs one now and returns its outcome.
 */
export function routinesHandlers(deps: Deps = productionDeps) {
  const isScheduler = (request: Request) => {
    const expected = deps.cronSecret?.() || "";
    return !!expected && sameSecret(request.headers.get("Authorization") || "", `Bearer ${expected}`);
  };
  const schedule = async () => {
    const admin = deps.admin?.();
    if (!admin) throw new HttpError(503, "Routines need the server's service role key.");
    const work = runDueRoutines(deps, admin);
    // Answer the scheduler at once; the runs continue in the background for up to the function's time limit.
    if (deps.background) { deps.background(work.catch(error => console.error("[routines] tick failed", error instanceof Error ? error.message : error))); return json({ started: true }); }
    return json(await work);
  };

  return {
    GET: route(async request => {
      if (isScheduler(request)) return schedule();
      const { store } = await deps.caller(request);
      return json({ runs: await store.listRoutineRuns(RECENT_RUNS) });
    }),
    POST: route(async request => {
      if (isScheduler(request)) return schedule();
      const { store } = await deps.caller(request);
      const body = await readJson<{ routineId?: unknown }>(request, 10_000);
      if (typeof body.routineId !== "string" || !body.routineId) throw new HttpError(400, "Say which routine to run.");
      const { workspace } = await loadWorkspace(store);
      const routine = (workspace.routines || []).find(r => r.id === body.routineId);
      if (!routine) throw new HttpError(404, "That routine no longer exists.");
      const now = new Date();
      // Started by the user, so its condition is not checked and it is not sent to Telegram: they are watching.
      const outcome = await runRoutine(deps, store, routine, `manual-${now.toISOString()}`, { date: localClock(now, routineZone(routine)).date });
      return json({ outcome, runs: await store.listRoutineRuns(RECENT_RUNS) });
    }),
  };
}

export const { GET, POST } = routinesHandlers();

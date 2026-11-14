import type { AIMessage, CalendarEvent, Routine, Task } from "../../src/types";
import type { AgentExecutionResult } from "../../src/services/agentDispatcher";
import { plainIrisUi } from "../../src/utils/irisUi";
import { conditionHolds, dueSlot, localClock, ROUTINE_CHANNEL_NOTE, routinePrompt, routineThread, routineZone } from "../../src/utils/routines";
import type { AdminStore } from "./admin";
import { providerKey, type Deps } from "./context";
import { googleSession } from "./google";
import { googleToolset } from "./googleTools";
import { HttpError } from "./http";
import { runServerAgent } from "./serverAgent";
import type { ServerStore } from "./store";
import { plainText, telegramClient, type TelegramClient } from "./telegram";
import { askApproval } from "./telegramBot";

/** Runs that use the assistant per account per day, so a misconfigured routine can't run up the user's bill. */
export const ROUTINE_RUNS_PER_DAY = 24;
/** Smaller than a conversation's: a routine is a focused job, and every run of every routine shares one function. */
export const ROUTINE_BUDGET = { steps: 16, tools: 40, timeMs: 200_000 };
/** Runs started per scheduler wake. The rest stay due and run on the next wake. */
export const ROUTINE_JOBS_PER_TICK = 12;
/** A routine may not create or change routines, so one can never multiply itself. */
const ROUTINE_TOOLS = ["create_routine", "update_routine", "delete_routine"];

const SKIPPED: Record<Routine["onlyIf"], string> = { always: "nothing to do", overdue_tasks: "nothing was overdue", due_today: "nothing was due that day",
  due_soon: "nothing was due in the next 2 days", events_today: "no events that day" };

export interface RoutineOutcome { status: "done" | "skipped" | "failed" | "already_ran"; summary: string; runId?: string; changes?: number; approvals?: number }

const reportOf = (result: AgentExecutionResult) => plainText(plainIrisUi(result.queryAnswer)).trim() || "Finished with nothing to report.";
const failure = (error: unknown) => error instanceof HttpError ? error.message : error instanceof Error ? error.message : "The routine could not finish.";

/**
 * Runs one routine as the user. `check` holds the records for its condition on scheduled runs; a run the user
 * started skips the condition. The run is claimed first, so the same slot never runs twice, even on retries.
 */
export async function runRoutine(deps: Deps, store: ServerStore, routine: Routine, slot: string, options: { date: string; check?: { tasks: Task[]; events: CalendarEvent[] }; telegram?: { client: TelegramClient; chatId: number } }): Promise<RoutineOutcome> {
  const runId = await store.claimRoutineRun(routine.id, slot);
  if (!runId) return { status: "already_ran", summary: "This run already happened." };
  const finish = async (outcome: Omit<RoutineOutcome, "runId">): Promise<RoutineOutcome> => {
    await store.finishRoutineRun(runId, { status: outcome.status as "done" | "skipped" | "failed", summary: outcome.summary, changes: outcome.changes, approvals: outcome.approvals });
    return { ...outcome, runId };
  };
  try {
    if (options.check && !conditionHolds(routine.onlyIf, options.check.tasks, options.check.events, options.date))
      return await finish({ status: "skipped", summary: `Skipped: ${SKIPPED[routine.onlyIf]}.` });
    if (await store.countRoutineRuns(new Date(Date.now() - 86_400_000).toISOString()) > ROUTINE_RUNS_PER_DAY)
      return await finish({ status: "failed", summary: `Routines ran ${ROUTINE_RUNS_PER_DAY} times in the last day, the daily limit. This run was skipped.` });
    const key = await providerKey(deps, store);
    const google = await googleSession(deps, store).catch(() => null);
    const tools = google ? googleToolset(google, store, routine.timeZone) : undefined;
    const message: AIMessage = { id: crypto.randomUUID(), role: "user", content: routinePrompt(routine, options.date), timestamp: new Date().toISOString() };
    let result: AgentExecutionResult | undefined;
    await runServerAgent(store, key, {
      message, chatHistory: [], conversationId: routineThread(routine).id, savedThread: routineThread(routine), timeZone: routine.timeZone,
      channelNote: ROUTINE_CHANNEL_NOTE, askBeforeChanges: routine.mode === "suggest", excludeTools: ROUTINE_TOOLS, budget: ROUTINE_BUDGET, learn: false,
    }, event => { if (event.type === "done") result = event.result; }, AbortSignal.timeout(ROUTINE_BUDGET.timeMs + 40_000), tools, deps.web?.());
    if (!result) throw new Error("The assistant did not finish.");
    await store.appendAudit({ actor: "system", action: "routine run", entityType: "routine", entityId: routine.id, title: routine.name,
      metadata: { slot, status: result.status, changes: result.actions.length, approvals: result.approvals?.length || 0 } }).catch(() => {});
    const report = reportOf(result);
    if (options.telegram && routine.notify) {
      await options.telegram.client.send(options.telegram.chatId, `${routine.name}\n\n${report}`).catch(() => {});
      for (const approval of result.approvals || []) await askApproval(options.telegram.client, store, options.telegram.chatId, approval).catch(() => {});
    }
    return await finish({ status: result.status === "error" ? "failed" : "done", summary: report, changes: result.actions.length, approvals: result.approvals?.length || 0 });
  } catch (error) {
    if (!(error instanceof HttpError)) console.error("[routines] run failed", error instanceof Error ? error.message : "unknown error");
    return await finish({ status: "failed", summary: failure(error) }).catch(() => ({ status: "failed" as const, summary: failure(error), runId }));
  }
}

/** One scheduler wake: runs every routine that is due, one user session per account, accounts side by side. */
export async function runDueRoutines(deps: Deps, admin: AdminStore, now = new Date()): Promise<{ due: number; ran: number }> {
  const owners = await admin.routineOwners();
  const telegramConfig = deps.telegram?.();
  const client = telegramConfig ? telegramClient(telegramConfig.token, deps.telegramFetch) : undefined;
  let budget = ROUTINE_JOBS_PER_TICK, due = 0, ran = 0;
  const work: Promise<void>[] = [];
  for (const owner of owners) {
    const jobs = owner.routines.map(routine => ({ routine, slot: dueSlot(routine, now) })).filter((j): j is { routine: Routine; slot: string } => !!j.slot);
    due += jobs.length;
    const take = jobs.slice(0, Math.max(0, budget));
    budget -= take.length;
    if (!take.length) continue;
    work.push((async () => {
      const session = await admin.session(owner.userId);
      try {
        const check = await admin.reminderData(owner.userId);
        for (const { routine, slot } of take) {
          const outcome = await runRoutine(deps, session.store, routine, slot, { date: localClock(now, routineZone(routine)).date, check,
            telegram: client && owner.chatId !== null ? { client, chatId: owner.chatId } : undefined });
          if (outcome.status !== "already_ran") ran++;
        }
      } finally { await session.close(); }
    })().catch(error => console.error("[routines] account failed", error instanceof Error ? error.message : "unknown error")));
  }
  await Promise.all(work);
  return { due, ran };
}

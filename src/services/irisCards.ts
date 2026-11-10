import type { BrainState } from "../types";
import type { IrisUiSpec } from "../utils/irisUi";
import { applyMutation, MUTATION_TOOLS, parseToolArguments, prepareMutation, type Mutation } from "./brainTools";

type Checklist = Extract<IrisUiSpec, { type: "checklist" }>;

/** The only changes a card may make to existing records: ticking a task off (or back) and marking a habit done today. */
export type CardChange =
  | { tool: "update_task"; args: { taskId: string; status: "completed" | "not_started" } }
  | { tool: "complete_habit"; args: { habitId: string } };

export function prepareCardChanges(state: BrainState, changes: CardChange[]): Mutation[] {
  let working = state;
  return changes.map(change => {
    if (change.tool !== "update_task" && change.tool !== "complete_habit") throw new Error("Cards can't make that change.");
    const args = change.tool === "update_task" ? { taskId: change.args.taskId, status: change.args.status } : { habitId: change.args.habitId };
    if (change.tool === "update_task" && args.status !== "completed" && args.status !== "not_started") throw new Error("Cards can't make that change.");
    const schema = MUTATION_TOOLS.find(tool => tool.function.name === change.tool)!.function.parameters;
    const mutation = prepareMutation(change.tool, parseToolArguments(JSON.stringify(args), schema), working);
    working = applyMutation(working, mutation);
    return mutation;
  });
}

/**
 * Turns the rows a user ticked into task creations. The user reviewed exactly these rows and pressed Add,
 * so this is their own action; it still goes through the assistant's validation.
 */
export function prepareChecklistTasks(state: BrainState, spec: Checklist, indexes: number[]): { mutations: Mutation[]; added: Record<number, string> } {
  const schema = MUTATION_TOOLS.find(tool => tool.function.name === "create_task")!.function.parameters;
  const mutations: Mutation[] = [], added: Record<number, string> = {};
  let working = state;
  for (const index of indexes) {
    const item = spec.items[index];
    if (!item) continue;
    const args = parseToolArguments(JSON.stringify({
      title: item.title, priority: item.priority || "medium", section: item.section || spec.section || state.sections[0],
      subsection: item.subsection || spec.subsection, dueDate: item.dueDate, dueTime: item.dueTime,
    }), schema);
    const mutation = prepareMutation("create_task", args, working);
    working = applyMutation(working, mutation);
    mutations.push(mutation);
    added[index] = mutation.record.id;
  }
  return { mutations, added };
}

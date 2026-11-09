import type { BrainState } from "../types";
import type { IrisUiSpec } from "../utils/irisUi";
import { applyMutation, MUTATION_TOOLS, parseToolArguments, prepareMutation, type Mutation } from "./brainTools";

type Checklist = Extract<IrisUiSpec, { type: "checklist" }>;

/**
 * Turns the rows a user ticked into task creations. The user reviewed exactly these rows and pressed Add,
 * so this is their own action; it still goes through the assistant's validation. Cards can only create tasks.
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

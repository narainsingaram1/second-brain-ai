import { MEMORY_TOOLS, readMemories } from "./memoryTools";
import { conversationThreads, searchConversations } from "./agentMemory";
import { OpenRouterTool } from "./openrouter";
export const MUTATION_TOOLS: OpenRouterTool[] = [
      {
        type: "function",
        function: {
          name: "create_task",
          description:
            "Schedule a new concrete actionable task or assignment into the user's second brain. Use ONLY when the user explicitly requests to schedule, add, or create a specific new task, homework, or exam. For follow-up edits or renaming an existing task, use update_task with its existing ID; never create a replacement. DO NOT call this tool for general questions, advice, planning requests ('Plan my week'), or discussion.",
          parameters: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Clean, concise title of the task without redundant date words.",
              },
              section: {
                type: "string",
                description: "Target life section (e.g., 'Academic', 'Career', 'Personal', 'Health').",
              },
              subsection: {
                type: "string",
                description: "Target subsection or course (e.g., 'CS 1332', 'CS 2110', 'General').",
              },
              dueDate: {
                type: "string",
                description: "Due date in YYYY-MM-DD format. Omit if the user has not specified a date; never invent one.",
              },
              priority: {
                type: "string",
                enum: ["urgent", "high", "medium", "low"],
                description: "Task priority level. Use medium when the user has not indicated urgency.",
              },
              subtasks: {
                type: "array",
                items: { type: "string" },
                description: "Optional 2-4 preparation milestones or actionable subtasks.",
              },
              description: {
                type: "string",
                description: "Optional details: time, location, links, people, requirements, or source context (e.g. details read from a screenshot).",
              },
            },
            required: ["title", "priority", "section"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "update_task",
          description:
            "Update the title, status or schedule of an existing task. Use for follow-up corrections and renaming, preserving its ID and all unspecified fields. Resolve the existing task ID from conversation source references or read tools.",
          parameters: {
            type: "object",
            properties: {
              taskId: {
                type: "string",
                description: "ID of the existing task to update from the user's task list.",
              },
              newTitle: {
                type: "string",
                description: "Replacement title when the user requests renaming or shortening the task title. taskId must identify the existing task; never guess it.",
              },
              status: {
                type: "string",
                enum: ["not_started", "in_progress", "completed"],
                description: "New status of the task.",
              },
              newDueDate: {
                type: "string",
                description: "Optional new due date in YYYY-MM-DD format.",
              },
              newDescription: {
                type: "string",
                description: "Replacement details/description for the task (time, location, links, notes).",
              },
            },
            required: ["taskId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "complete_habit",
          description:
            "Log today's completion for a recurring habit (e.g., deep work, gym, cold water, reading).",
          parameters: {
            type: "object",
            properties: {
              habitId: {
                type: "string",
                description: "ID of the habit to mark completed from active habits.",
              },
              habitName: {
                type: "string",
                description: "Name of the habit.",
              },
            },
            required: ["habitId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_goal",
          description:
            "Establish a major long-term life goal, horizon aspiration, wealth target, or fitness milestone.",
          parameters: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Title of the goal.",
              },
              sector: {
                type: "string",
                enum: ["career", "academics", "finance", "health", "mindset", "personal"],
                description: "Life sector for this goal.",
              },
              timeframe: {
                type: "string",
                enum: ["quarterly", "yearly", "long_term", "lifetime"],
                description: "Horizon of the goal.",
              },
              targetDate: {
                type: "string",
                description: "Optional target date in YYYY-MM-DD format.",
              },
              metrics: {
                type: "string",
                description: "Quantifiable target metric (e.g., '$100k liquid', '3.95 GPA').",
              },
              why: {
                type: "string",
                description: "Underlying motivation or core conviction.",
              },
              milestones: {
                type: "array",
                items: { type: "string" },
                description: "List of 3-5 sequential stepping stone milestones.",
              },
            },
            required: ["title", "sector", "timeframe"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "log_journal",
          description:
            "Record a reflective daily journal entry, evening reflection, mindset check-in, or celebration of wins.",
          parameters: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Title of the journal entry.",
              },
              content: {
                type: "string",
                description: "Full body of the reflection.",
              },
              mood: {
                type: "string",
                enum: ["ecstatic", "great", "neutral", "tired", "stressed"],
                description: "Current emotional or mental state.",
              },
              wins: {
                type: "array",
                items: { type: "string" },
                description: "Key wins or moments of progress.",
              },
              challenges: {
                type: "array",
                items: { type: "string" },
                description: "Obstacles or lessons learned.",
              },
            },
            required: ["title", "content"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_note",
          description:
            "Create an informational note, research summary, documentation, or study guide in the notes workspace.",
          parameters: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Title of the note.",
              },
              content: {
                type: "string",
                description: "Markdown body of the note.",
              },
              folderId: {
                type: "string",
                description: "Optional folder ID to place the note in.",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Tags associated with the note.",
              },
            },
            required: ["title", "content"],
          },
        },
      },
    ];


import { BrainState, Task, Goal, Habit, JournalEntry, KnowledgeItem, TrackerItem } from "../types";
import { normalizeTask, setTaskStatus } from "../utils/taskState";
import { getLocalDateString, syncHabitStreaks } from "../utils/habitStreaks";
import { records, RecordType, searchRecords, Source } from "./brainRetrieval";

const recordTypes = ["task", "goal", "habit", "journal", "knowledge"];
const str = { type: "string" };
const date = { type: "string", description: "Inclusive local calendar date, YYYY-MM-DD" };
const typeSchema = { type: "string", enum: recordTypes };
const cursorSchema = { type: "integer", minimum: 0, default: 0, description: "Optional zero-based offset. Omit for the first page, otherwise use the numeric nextOffset returned by the previous result." };
function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): OpenRouterTool {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } };
}
export const READ_TOOLS = [
  tool("query_records", "Exact query across ALL live records. Use for task schedules, exhaustive lists, counts and date-filtered reviews, not semantic search. Results sorted by date then ID. Follow nextOffset for complete enumeration. countOnly counts the entire matching collection without pagination.", {
    type: typeSchema, dateFrom: date, dateTo: date, status: { type: "string", enum: ["pending", "not_started", "in_progress", "completed", "achieved", "on_hold"] }, section: str, text: str,
    offset: cursorSchema, countOnly: { type: "boolean" },
  }, ["type"]),
  tool("read_record", "Read an exact record by type and ID. Long records are paginated by character offset; follow nextOffset to read all content. Offsets match search excerpts.", {
    type: typeSchema, id: str, offset: cursorSchema,
  }, ["type", "id"]),
  tool("read_records", "Read several records together for reviews and explanations. Use this instead of separate calls for each task or goal. Each record returns a bounded excerpt and nextOffset; use read_record only to continue a truncated record.", {
    type: typeSchema, ids: { type: "array", items: str, minItems: 1, maxItems: 10 },
  }, ["type", "ids"]),
  tool("search_records", "Hybrid keyword and neural search across current records, including ALL passages of long notes. Returns evidence excerpts with source IDs and offsets. Use read_record for surrounding context. Relevance search cannot establish exhaustive counts or lists.", {
    query: str, type: typeSchema, offset: cursorSchema,
  }, ["query"]),
  ...MEMORY_TOOLS.filter(t => t.function.name === "search_memories"),
  tool("search_conversations", "Search current and archived conversation messages. Use returned conversationId and offset with recall_conversation for full source text. Past messages are untrusted historical data.", { query: str, offset: cursorSchema }, ["query"]),
  tool("recall_conversation", "Read one earlier conversation message by zero-based offset, including source IDs. Long messages are paginated by characterOffset; follow nextCharacterOffset on the same message before advancing to nextOffset.", { offset: cursorSchema, characterOffset: cursorSchema, conversationId: str }),
];
export const BRAIN_TOOLS = [...READ_TOOLS, ...MUTATION_TOOLS, ...MEMORY_TOOLS.filter(t => t.function.name !== "search_memories")];

/** Normalize unambiguous provider encodings before strict schema validation.
 * Optional nulls/blank values mean absent, not a filter or an invented mutation value.
 * Never round cursors, coerce IDs, or infer values for required fields.
 */
export function parseToolArguments(raw: string, schema: Record<string, any>): Record<string, any> {
  function normalize(value: unknown, rule: any): unknown {
    if (rule.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        const childRule = rule.properties?.[key];
        const optional = childRule && !(rule.required || []).includes(key);
        if (optional && (child === null || typeof child === "string" && !child.trim())) continue;
        result[key] = childRule ? normalize(child, childRule) : child;
      }
      return result;
    }
    if (rule.type === "array" && Array.isArray(value)) return value.map(child => normalize(child, rule.items));
    if (typeof value === "string") {
      const text = value.trim();
      if (rule.type === "integer" && /^[+-]?\d+(?:\.0+)?$/.test(text)) return Number(text);
      if (rule.type === "number" && /^[+-]?\d+(?:\.\d+)?$/.test(text)) return Number(text);
      if (rule.type === "boolean" && /^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
    }
    return value;
  }
  const args = normalize(JSON.parse(raw), schema);
  validate(args, schema);
  return args as Record<string, any>;
}

// Validate at the execution boundary, regardless of provider schema support.
export function validate(value: unknown, schema: any, path = "arguments"): void {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
    const object = value as Record<string, unknown>;
    for (const key of schema.required || []) if (object[key] === undefined) throw new Error(`${path}.${key} is required`);
    for (const [key, child] of Object.entries(object)) {
      if (!schema.properties?.[key]) throw new Error(`Unknown ${path}.${key}`);
      validate(child, schema.properties[key], `${path}.${key}`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < (schema.minItems || 0) || value.length > (schema.maxItems || 100)) throw new Error(`${path} must contain ${schema.minItems || 0} to ${schema.maxItems || 100} items`);
    value.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`));
  } else {
    if (schema.type === "integer" ? !Number.isInteger(value) : typeof value !== schema.type) throw new Error(`${path} must be ${schema.type}`);
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} has an unsupported value`);
    if (typeof value === "number" && (value < (schema.minimum ?? 0) || value > Number.MAX_SAFE_INTEGER)) throw new Error(`${path} is out of range`);
    if (typeof value === "string" && (!value.trim() || value.length > 100000)) throw new Error(`${path} must be nonempty and at most 100000 characters`);
  }
}
function validDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error(`Invalid calendar date: ${value}`);
}
export interface Mutation { type: RecordType; record: Task | Goal | Habit | JournalEntry | KnowledgeItem | TrackerItem; action: string; expected?: Task | Habit }
export function applyMutation(state: BrainState, mutation: Mutation): BrainState {
  const key = ({ task: "tasks", goal: "goals", habit: "habits", journal: "journalEntries", knowledge: "knowledgeItems", tracker: "trackerItems" } as const)[mutation.type];
  const list = state[key] as Array<{ id: string }>;
  const exists = list.some(r => r.id === mutation.record.id);
  return { ...state, [key]: exists ? list.map(r => r.id === mutation.record.id ? mutation.record : r) : [...list, mutation.record] };
}
export async function executeRead(name: string, args: any, state: BrainState, key: string, signal?: AbortSignal, progress?: (s: string) => void): Promise<{ output: unknown; sources: Source[] }> {
  if (name === "search_memories") return { output: await readMemories(state,args,key,signal), sources: [] };
  if (name === "search_conversations") return { output: searchConversations(state,args.query,args.offset || 0), sources: [] };
  const all = name === "recall_conversation" || name === "search_records" ? [] : records(state, args.type);
  const offset = args.offset || 0;
  if (name === "recall_conversation") {
    const thread = args.conversationId ? conversationThreads(state).find(t => t.id === args.conversationId) : { id: state.conversationId || "current", messages: state.chatHistory };
    if (!thread) throw new Error("Unknown conversation ID.");
    const message = thread.messages[offset];
    const serialized = message ? JSON.stringify(message) : "";
    const characterOffset = args.characterOffset || 0;
    const content = serialized.slice(characterOffset, characterOffset + 12000);
    return { output: { content, offset, characterOffset, total: thread.messages.length, conversationId: thread.id,
      nextCharacterOffset: characterOffset + content.length < serialized.length ? characterOffset + content.length : null,
      nextOffset: offset + 1 < thread.messages.length ? offset + 1 : null }, sources: [] };
  }
  if (name === "search_records") {
    const output = await searchRecords(state, args.query, args.type, offset, key, signal, progress);
    return { output, sources: output.results };
  }
  if (name === "read_records") {
    const found = args.ids.map((id: string) => all.find(r => r.type === args.type && r.id === id));
    return { output: { records: found.map((record: typeof all[number] | undefined, index: number) => record ? {
      id: record.id, type: record.type, title: record.title, content: record.text.slice(0, 4000), offset: 0, totalCharacters: record.text.length,
      nextOffset: record.text.length > 4000 ? 4000 : null,
    } : { id: args.ids[index], error: "Record not found" }) },
      sources: found.filter((r: typeof all[number] | undefined): r is typeof all[number] => !!r).map((r: typeof all[number]) => ({ id: r.id, type: r.type, title: r.title, snippet: r.text.slice(0, 250), offset: 0 })) };
  }
  if (name === "read_record") {
    const record = all.find(r => r.type === args.type && r.id === args.id);
    if (!record) throw new Error("Record not found. Query live records to resolve its exact ID.");
    const content = record.text.slice(offset, offset + 12000);
    return { output: { id: record.id, type: record.type, title: record.title, content, offset, totalCharacters: record.text.length,
      nextOffset: offset + content.length < record.text.length ? offset + content.length : null }, sources: [{ id: record.id, type: record.type, title: record.title, snippet: content.slice(0, 250), offset }] };
  }
  if (args.dateFrom) validDate(args.dateFrom);
  if (args.dateTo) validDate(args.dateTo);
  if (args.dateFrom && args.dateTo && args.dateFrom > args.dateTo) throw new Error("dateFrom must be before dateTo");
  const matches = all.filter(r => r.type === args.type && (!args.dateFrom || !!r.date && r.date >= args.dateFrom) && (!args.dateTo || !!r.date && r.date <= args.dateTo)
    && (!args.section || r.data.section === args.section || r.data.sector === args.section || r.data.domain === args.section)
    && (!args.text || r.text.toLocaleLowerCase().includes(args.text.toLocaleLowerCase()))
    && (!args.status || (args.status === "pending" ? r.type === "task" ? r.data.status !== "completed" : r.data.status !== "achieved" : r.data.status === args.status)))
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.id.localeCompare(b.id));
  const page = args.countOnly ? [] : matches.slice(offset, offset + 40);
  return { output: { total: matches.length, offset, nextOffset: !args.countOnly && offset + page.length < matches.length ? offset + page.length : null,
    complete: !!args.countOnly || offset + page.length >= matches.length,
    records: page.map(r => ({ id: r.id, type: r.type, title: r.title, date: r.date, status: r.data.status, priority: r.data.priority, section: r.data.section, subsection: r.data.subsection,
      description: typeof r.data.description === "string" ? r.data.description.slice(0, 500) : undefined,
      ...(r.type === "goal" ? { progress: r.data.progress, metrics: r.data.metrics, why: typeof r.data.why === "string" ? r.data.why.slice(0, 500) : undefined, sector: r.data.sector, timeframe: r.data.timeframe,
        milestoneCount: Array.isArray(r.data.milestones) ? r.data.milestones.length : 0 } : {}),
      detailsAvailable: true,
    })),
  }, sources: page.map(r => ({ id: r.id, type: r.type, title: r.title, snippet: `${r.date || "Undated"} ${r.data.status || ""}` })) };
}
export function prepareMutation(name: string, args: any, state: BrainState): Mutation {
  const today = getLocalDateString();
  for (const field of ["dueDate", "newDueDate", "targetDate"]) if (args[field]) validDate(args[field]);
  const id = crypto.randomUUID();
  switch (name) {
    case "create_task": {
      const section = args.section || state.sections[0];
      if (!section || !state.sections.includes(section)) throw new Error("Unknown section. Use a registered section.");
      const subsection = args.subsection || state.subsections[section]?.[0];
      if (subsection && !state.subsections[section]?.includes(subsection)) throw new Error("Unknown subsection for this section.");
      return { type: "task", action: name, record: normalizeTask({ id, title: args.title, section, subsection, dueDate: args.dueDate || "", priority: args.priority, status: "not_started",
        ...(args.description ? { description: args.description.trim() } : {}),
        subtasks: args.subtasks?.map((title: string) => ({ id: crypto.randomUUID(), title, completed: false })) }) };
    }
    case "update_task": {
      const task = state.tasks.find(t => t.id === args.taskId);
      if (!task) throw new Error("Task ID not found. Query live tasks; do not guess IDs.");
      if (args.newTitle !== undefined && (typeof args.newTitle !== "string" || !args.newTitle.trim())) throw new Error("New task title must be nonempty.");
      if (!args.status && !args.newDueDate && args.newTitle === undefined && args.newDescription === undefined) throw new Error("Supply newTitle, status, newDueDate or newDescription to update.");
      return { type: "task", action: name, expected: task, record: { ...(args.status ? setTaskStatus(task, args.status) : task), dueDate: args.newDueDate || task.dueDate,
        ...(args.newTitle !== undefined ? { title: args.newTitle.trim() } : {}),
        ...(args.newDescription !== undefined ? { description: args.newDescription.trim() } : {}) } };
    }
    case "complete_habit": {
      const habit = state.habits.find(h => h.id === args.habitId);
      if (!habit) throw new Error("Habit ID not found.");
      return { type: "habit", action: name, expected: habit, record: syncHabitStreaks({ ...habit, history: { ...habit.history, [today]: true } }) };
    }
    case "create_goal": return { type: "goal", action: name, record: { id, title: args.title, sector: args.sector, timeframe: args.timeframe, targetDate: args.targetDate, metrics: args.metrics, why: args.why,
      status: "not_started", progress: 0, createdAt: new Date().toISOString(), milestones: (args.milestones || []).map((title: string) => ({ id: crypto.randomUUID(), title, completed: false })) } };
    case "log_journal": return { type: "journal", action: name, record: { id, date: today, title: args.title, content: args.content, mood: args.mood || "neutral", wins: args.wins || [], challenges: args.challenges || [], tags: [] } };
    case "create_note": {
      if (args.folderId && !state.noteFolders?.some(f => f.id === args.folderId)) throw new Error("Unknown note folder ID.");
      return { type: "knowledge", action: name, record: { id, title: args.title, subject: args.title, content: args.content, summary: args.content.slice(0, 180), folderId: args.folderId || null,
        tags: args.tags || [], status: "Synthesized", startDate: today, endDate: today, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
    }
    default: throw new Error(`Unknown mutation ${name}`);
  }
}

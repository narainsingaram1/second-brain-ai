import { MEMORY_TOOLS, readMemories } from "./memoryTools";
import { conversationThreads, searchConversations } from "./agentMemory";
import { OpenRouterTool } from "./openrouter";
const s_ = { type: "string" };
const d_ = (description: string) => ({ type: "string", description });
const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]): OpenRouterTool =>
  ({ type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } });
const EDIT_TOOLS: OpenRouterTool[] = [
  fn("create_event", "Schedule a calendar event: a meeting, class, appointment or other happening at a time and place. Use for things the user attends (meetings, office hours, interviews, lectures, appointments, parties), not for work to be done by a deadline (use create_task with dueTime for those). Use only when the user asks to add/schedule it, or sends an image/text that is clearly an invitation or schedule to add.", {
    title: s_,
    kind: { type: "string", enum: ["meeting", "event", "class", "appointment"] },
    date: d_("YYYY-MM-DD local date."),
    startTime: d_("24-hour HH:MM local start time. Omit for an all-day event."),
    endTime: d_("24-hour HH:MM local end time, after startTime. Omit if unknown; never invent one."),
    location: d_("Room, address or place."),
    link: d_("http(s) meeting or info link."),
    attendees: { type: "array", items: s_, description: "People attending, by name." },
    notes: d_("Agenda, prep, dial-in details or other context."),
  }, ["title", "date"]),
  fn("update_event", "Change an existing calendar event (reschedule, rename, change place/link/people/notes). Preserves unspecified fields.", {
    eventId: d_("ID of the existing event."),
    newTitle: s_,
    kind: { type: "string", enum: ["meeting", "event", "class", "appointment"] },
    newDate: d_("YYYY-MM-DD"),
    newStartTime: d_("24-hour HH:MM"),
    newEndTime: d_("24-hour HH:MM"),
    allDay: { type: "boolean", description: "true removes start and end times." },
    location: s_,
    link: s_,
    attendees: { type: "array", items: s_, description: "Replacement list of attendees." },
    appendNotes: d_("Text added to the end of the notes."),
  }, ["eventId"]),
  fn("delete_event", "Remove a calendar event. Use ONLY when the user explicitly asks to delete or cancel that specific event. The user can undo it from the app.", {
    eventId: d_("ID of the existing event."),
  }, ["eventId"]),
  fn("delete_task", "Permanently remove a task. Use ONLY when the user explicitly asks to delete or remove that specific task (not when it is done: use update_task status completed). The user can undo it from the app.", {
    taskId: d_("ID of the existing task."),
  }, ["taskId"]),
  fn("update_goal", "Update an existing goal: progress, status, title, target date, metric, motivation, or milestones (complete existing ones by ID or exact title, or add new ones). Progress is recalculated from milestones when they change and progress is not given.", {
    goalId: d_("ID of the existing goal."),
    newTitle: s_,
    status: { type: "string", enum: ["not_started", "in_progress", "achieved", "on_hold"] },
    progress: { type: "integer", minimum: 0, maximum: 100, description: "Overall percent complete." },
    newTargetDate: d_("YYYY-MM-DD"),
    metrics: s_,
    why: s_,
    completeMilestones: { type: "array", items: s_, description: "Milestone IDs or exact titles to mark completed." },
    reopenMilestones: { type: "array", items: s_, description: "Milestone IDs or exact titles to mark not completed." },
    addMilestones: { type: "array", items: s_, description: "Titles of new milestones to append." },
  }, ["goalId"]),
  fn("update_note", "Edit an existing note: rename it, append text to the end, replace its whole body, move it to a folder, or set its tags. Prefer appendContent for additions so existing text is preserved.", {
    noteId: d_("ID of the existing note (knowledge record)."),
    newTitle: s_,
    appendContent: d_("Markdown to add at the end of the note."),
    replaceContent: d_("New full markdown body. Only when the user asks to rewrite the note."),
    folderId: d_("Existing folder ID to move the note into."),
    tags: { type: "array", items: s_ },
  }, ["noteId"]),
  fn("create_habit", "Create a new recurring habit to track. Use only when the user asks to start tracking a habit or routine.", {
    name: s_,
    frequency: { type: "string", enum: ["daily", "weekdays", "weekends"] },
    timeOfDay: { type: "string", enum: ["morning", "afternoon", "evening"] },
    description: s_,
  }, ["name", "frequency"]),
  fn("create_tracker_item", "Add a Career tracker entry: a job/internship application (kind job_application; title is the role, company required) or a coding practice problem (kind leetcode).", {
    kind: { type: "string", enum: ["job_application", "leetcode"] },
    title: d_("Role title for applications, problem name for practice."),
    company: d_("Company, required for job_application."),
    status: { type: "string", enum: ["not_started", "applied", "screening", "onsite", "offer", "rejected", "in_progress", "done", "review"], description: "Applications: not_started (wishlist), applied, screening, onsite (interview), offer, rejected. Problems: not_started, in_progress, done, review." },
    url: d_("http(s) link to the posting or problem."),
    appliedDate: d_("YYYY-MM-DD, applications only."),
    followUpDate: d_("YYYY-MM-DD, applications only."),
    location: s_,
    difficulty: { type: "string", enum: ["Easy", "Medium", "Hard"] },
    topic: d_("Problem topics, e.g. 'Arrays, Hash maps'."),
    notes: s_,
  }, ["kind", "title"]),
  fn("update_tracker_item", "Update an existing Career tracker entry (application stage, dates, notes, title).", {
    trackerId: d_("ID of the existing tracker record."),
    newTitle: s_,
    status: { type: "string", enum: ["not_started", "applied", "screening", "onsite", "offer", "rejected", "in_progress", "done", "review"] },
    appliedDate: d_("YYYY-MM-DD"),
    followUpDate: d_("YYYY-MM-DD"),
    location: s_,
    appendNotes: d_("Text appended to the existing notes."),
  }, ["trackerId"]),
];
const cardSchema = { type: "object", properties: { front: s_, back: s_, sourceDocumentId: d_("ID of the course document this card is based on.") }, required: ["front", "back"], additionalProperties: false };
const questionSchema = { type: "object", properties: {
  type: { type: "string", enum: ["mcq", "short"] },
  prompt: s_,
  choices: { type: "array", items: s_, minItems: 2, maxItems: 6, description: "Multiple choice only: 4 options." },
  answerIndex: { type: "integer", minimum: 0, description: "Multiple choice only: zero-based index of the correct choice." },
  answer: d_("Short answer: the model answer. Multiple choice: optional, the correct choice text."),
  explanation: d_("Why the answer is right."),
  sourceDocumentId: d_("ID of the course document this question is based on."),
}, required: ["type", "prompt"], additionalProperties: false };
const STUDY_TOOLS: OpenRouterTool[] = [
  fn("create_course", "Add a course (class) to the user's academic workspace. Its code also becomes a task subsection under Academic. Use only when the user asks to add/track a class.", {
    name: d_("Course title, e.g. 'Data Structures & Algorithms'."),
    code: d_("Course code, e.g. 'CS 1332'."),
    term: d_("e.g. 'Fall 2026'."),
    instructor: s_,
  }, ["name"]),
  fn("set_course_grading", "Save how a course's final grade is weighted (categories and weights, optional number of items and dropped scores, letter cutoffs, target). Replaces the category list; categories with the same name keep their scores. Use when the user describes their grading breakdown or asks you to read it from the syllabus (read the syllabus document first).", {
    courseId: d_("ID of the course."),
    categories: { type: "array", minItems: 1, maxItems: 30, items: { type: "object", properties: {
      name: d_("e.g. 'Exams', 'Homework', 'Projects'."),
      weight: { type: "number", description: "Percent of the final grade, e.g. 30." },
      count: { type: "integer", minimum: 1, description: "Total number of items in this category if known, e.g. 10 homeworks." },
      dropLowest: { type: "integer", minimum: 1, description: "How many lowest scores are dropped, if any." },
    }, required: ["name", "weight"], additionalProperties: false } },
    scale: { type: "array", items: { type: "object", properties: { letter: s_, min: { type: "number" } }, required: ["letter", "min"], additionalProperties: false },
      description: "Letter cutoffs if the syllabus states them, e.g. [{letter:'A',min:90},...]. Omit to keep the current scale." },
    target: { type: "number", description: "The final percentage the user is aiming for, if they said so." },
  }, ["courseId", "categories"]),
  fn("record_grade", "Add a score to a course's grade tracker, add an upcoming assignment with no score yet, or update one (gradeId). Use when the user reports a grade ('got 87/100 on the midterm') or lists upcoming graded work. The course must have grading set up.", {
    courseId: d_("ID of the course."),
    gradeId: d_("ID of an existing grade item to update. Omit to add a new one."),
    category: d_("Category name as set up for the course, e.g. 'Exams'."),
    title: d_("e.g. 'Midterm 1', 'Homework 4'."),
    score: { type: "number", description: "Points earned. Omit for upcoming work that is not graded yet." },
    maxScore: { type: "number", description: "Points possible. Defaults to 100 (use 100 when the user gives a percentage)." },
    date: d_("YYYY-MM-DD the work was due or returned."),
  }, ["courseId"]),
  fn("create_flashcard_deck", "Create a flashcard deck for a course, or add cards to an existing deck (deckId). Read the relevant course documents first and ground every card in them; link sourceDocumentId. Use when the user asks for flashcards.", {
    courseId: d_("ID of the course. Required when creating a new deck."),
    deckId: d_("Existing deck ID to append cards to instead of creating a deck."),
    title: d_("Deck title, required for a new deck."),
    cards: { type: "array", items: cardSchema, minItems: 1, maxItems: 60 },
  }, ["cards"]),
  fn("create_quiz", "Create a practice quiz for a course from its materials. Read the relevant course documents first; multiple choice questions have 4 choices with one correct answerIndex; short answer questions have a model answer. Use when the user asks for a quiz, practice test or exam prep questions.", {
    courseId: d_("ID of the course."),
    title: s_,
    questions: { type: "array", items: questionSchema, minItems: 1, maxItems: 40 },
  }, ["courseId", "title", "questions"]),
];
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
                description: "Target life section. Prefer an existing section from the context; a new name creates that section.",
              },
              subsection: {
                type: "string",
                description: "Target subsection or course within the section. Prefer an existing one; a new name (e.g. 'Projects') creates that subsection. Omit to use the section's first subsection.",
              },
              dueDate: {
                type: "string",
                description: "Due date in YYYY-MM-DD format. Omit if the user has not specified a date; never invent one.",
              },
              dueTime: {
                type: "string",
                description: "Optional due time, 24-hour HH:MM local time (e.g. '23:59' for 11:59 PM). Only with dueDate and only when the user or source states a time.",
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
            "Update the title, status, schedule or section/subsection of an existing task. Use for follow-up corrections, renaming and moving, preserving its ID and all unspecified fields. Resolve the existing task ID from conversation source references or read tools.",
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
              newDueTime: {
                type: "string",
                description: "Optional new due time, 24-hour HH:MM local time.",
              },
              clearDueTime: {
                type: "boolean",
                description: "true removes the due time (due any time that day).",
              },
              newDescription: {
                type: "string",
                description: "Replacement details/description for the task (time, location, links, notes).",
              },
              newSection: {
                type: "string",
                description: "Move the task to this section. A new name creates the section.",
              },
              newSubsection: {
                type: "string",
                description: "Move the task to this subsection (of newSection, or of its current section). A new name creates the subsection.",
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
      ...EDIT_TOOLS,
      ...STUDY_TOOLS,
    ];


import { BrainState, Task, Goal, Habit, JournalEntry, KnowledgeItem, TrackerItem, CalendarEvent, Course, FlashcardDeck, Quiz, QuizQuestion, Workspace } from "../types";
import { linkCourseToTasks, newCard, normalizeQuestion, studyOf } from "../utils/study";
import { applyCategories, findCategory, normalizeGrading } from "../utils/grades";
import { EVENT_KINDS, isValidTime, safeEventLink } from "../utils/events";
import { normalizeTask, setTaskStatus } from "../utils/taskState";
import { getLocalDateString, syncHabitStreaks } from "../utils/habitStreaks";
import { APPLICATION_STAGES, CAREER_WORKSPACE_ID, PROBLEM_STAGES, safeTrackerUrl } from "../utils/workspaces";
import { records, RecordType, searchRecords, Source } from "./brainRetrieval";

const recordTypes = ["task", "goal", "habit", "journal", "knowledge", "tracker", "event", "course", "document", "deck", "quiz"];
const str = { type: "string" };
const date = { type: "string", description: "Inclusive local calendar date, YYYY-MM-DD" };
const typeSchema = { type: "string", enum: recordTypes };
const cursorSchema = { type: "integer", minimum: 0, default: 0, description: "Optional zero-based offset. Omit for the first page, otherwise use the numeric nextOffset returned by the previous result." };
function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): OpenRouterTool {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } };
}
export const READ_TOOLS = [
  tool("query_records", "Exact query across ALL live records. Use for task schedules, exhaustive lists, counts and date-filtered reviews, not semantic search. Results sorted by date then ID. Follow nextOffset for complete enumeration. countOnly counts the entire matching collection without pagination. Course material types: course, document (uploaded files), deck (flashcards; date = next review), quiz (date = last attempt).", {
    type: typeSchema, dateFrom: date, dateTo: date, status: { type: "string", enum: ["pending", "not_started", "in_progress", "completed", "achieved", "on_hold", "applied", "screening", "onsite", "offer", "rejected", "done", "review"] },
    section: { type: "string", description: "Task section, goal sector, or course code/name for course, document, deck and quiz records." }, text: str,
    offset: cursorSchema, countOnly: { type: "boolean" },
  }, ["type"]),
  tool("read_record", "Read an exact record by type and ID. Long records are paginated by character offset; follow nextOffset to read all content. Returns the full stored record (search excerpts are readable summaries, so do not reuse their positions as offsets).", {
    type: typeSchema, id: str, offset: cursorSchema,
  }, ["type", "id"]),
  tool("read_records", "Read several records together for reviews and explanations. Use this instead of separate calls for each task or goal. Each record returns a bounded excerpt and nextOffset; use read_record only to continue a truncated record.", {
    type: typeSchema, ids: { type: "array", items: str, minItems: 1, maxItems: 10 },
  }, ["type", "ids"]),
  tool("search_records", "Hybrid keyword and neural search across current records, including ALL passages of long notes. Returns readable evidence excerpts with source IDs, best match first. Use read_record (offset 0) for the full record. Relevance search cannot establish exhaustive counts or lists.", {
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
type MutableRecord = Task | Goal | Habit | JournalEntry | KnowledgeItem | TrackerItem | CalendarEvent | Course | FlashcardDeck | Quiz;
export interface Mutation {
  type: RecordType;
  record: MutableRecord;
  action: string;
  /** The record as it was read; the save is refused if it changed in the meantime. */
  expected?: MutableRecord;
  /** Removes the record instead of inserting or replacing it. */
  remove?: boolean;
}
export const MUTATION_COLLECTIONS = { task: "tasks", goal: "goals", habit: "habits", journal: "journalEntries", knowledge: "knowledgeItems", tracker: "trackerItems", event: "events" } as const;
const STUDY_COLLECTIONS = { course: "courses", document: "documents", deck: "decks", quiz: "quizzes" } as const;
export const ACADEMIC_WORKSPACE_ID = "workspace-academic";
/** The live records a mutation of this type targets, wherever they are stored. */
export function mutationRecords(state: BrainState, type: RecordType): Array<{ id: string }> {
  if (type in STUDY_COLLECTIONS) return studyOf(state)[STUDY_COLLECTIONS[type as keyof typeof STUDY_COLLECTIONS]];
  return (state[MUTATION_COLLECTIONS[type as keyof typeof MUTATION_COLLECTIONS]] || []) as Array<{ id: string }>;
}
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
function groupName(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} name must be nonempty.`);
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length > 48) throw new Error(`${label} name must be at most 48 characters.`);
  return name;
}
/**
 * Resolves a task's section and subsection against the user's own groups, matching names
 * case-insensitively. Names that don't exist yet are kept as new groups, created when the task is saved.
 */
export function resolveTaskGroup(state: BrainState, sectionArg?: string, subsectionArg?: string): { section: string; subsection: string } {
  const requested = sectionArg === undefined ? state.sections[0] : groupName(sectionArg, "Section");
  if (!requested) throw new Error("Name a section for this task.");
  const section = state.sections.find(s => sameName(s, requested)) || requested;
  const existing = state.subsections[section] || [];
  if (subsectionArg === undefined) return { section, subsection: existing[0] || "General" };
  const wanted = groupName(subsectionArg, "Subsection");
  return { section, subsection: existing.find(s => sameName(s, wanted)) || wanted };
}
/** Adds a section and subsection to the user's task groups if they are not there yet. */
export function registerTaskGroup(state: BrainState, section: string, subsection?: string): BrainState {
  const hasSection = state.sections.includes(section);
  const subs = state.subsections[section] || ["General"];
  const sub = subsection || subs[0];
  if (hasSection && state.subsections[section]?.includes(sub)) return state;
  return {
    ...state,
    sections: hasSection ? state.sections : [...state.sections, section],
    subsections: { ...state.subsections, [section]: subs.includes(sub) ? subs : [...subs, sub] },
  };
}
export function applyMutation(state: BrainState, mutation: Mutation): BrainState {
  if (mutation.type in STUDY_COLLECTIONS) {
    const key = STUDY_COLLECTIONS[mutation.type as keyof typeof STUDY_COLLECTIONS];
    const study = studyOf(state);
    const list = study[key] as Array<{ id: string }>;
    const items = mutation.remove ? list.filter(r => r.id !== mutation.record.id)
      : list.some(r => r.id === mutation.record.id) ? list.map(r => r.id === mutation.record.id ? mutation.record : r) : [...list, mutation.record];
    let next: BrainState = { ...state, study: { ...study, [key]: items } };
    if (mutation.type === "course" && !mutation.remove) {
      const course = mutation.record as Course;
      // A course created from chat before any academic workspace exists gets a default one.
      if (!(next.workspaces || []).some(w => w.id === course.workspaceId)) {
        const workspace: Workspace = { id: course.workspaceId, name: "School", description: "Courses, materials, flashcards and practice quizzes.",
          template: "academic", color: "blue", notes: "", createdAt: new Date().toISOString() };
        next = { ...next, workspaces: [...(next.workspaces || []), workspace] };
      }
      next = linkCourseToTasks(next, course);
    }
    return next;
  }
  if (mutation.type === "task" && !mutation.remove) {
    const task = mutation.record as Task;
    state = registerTaskGroup(state, task.section, task.subsection);
  }
  const key = MUTATION_COLLECTIONS[mutation.type as keyof typeof MUTATION_COLLECTIONS];
  const list = (state[key] || []) as Array<{ id: string }>;
  if (mutation.remove) return { ...state, [key]: list.filter(r => r.id !== mutation.record.id) };
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
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")
      || String(a.data.startTime || a.data.dueTime || "24:00").localeCompare(String(b.data.startTime || b.data.dueTime || "24:00")) || a.id.localeCompare(b.id));
  const page = args.countOnly ? [] : matches.slice(offset, offset + 40);
  return { output: { total: matches.length, offset, nextOffset: !args.countOnly && offset + page.length < matches.length ? offset + page.length : null,
    complete: !!args.countOnly || offset + page.length >= matches.length,
    records: page.map(r => ({ id: r.id, type: r.type, title: r.title, date: r.date, status: r.data.status, priority: r.data.priority, section: r.data.section, subsection: r.data.subsection,
      ...(r.type === "task" && r.data.dueTime ? { dueTime: r.data.dueTime } : {}),
      ...(r.type === "event" ? { kind: r.data.kind, startTime: r.data.startTime, endTime: r.data.endTime, location: r.data.location, attendees: r.data.attendees,
        notes: typeof r.data.notes === "string" ? r.data.notes.slice(0, 500) : undefined } : {}),
      description: typeof r.data.description === "string" ? r.data.description.slice(0, 500) : undefined,
      ...(r.type === "course" ? { code: r.data.code, term: r.data.term, documents: r.data.documentCount, decks: r.data.deckCount, cardsDue: r.data.cardsDue, quizzes: r.data.quizCount, openTasks: r.data.openTasks } : {}),
      ...(r.type === "document" ? { course: r.data.course, folder: r.data.folder, kind: r.data.kind, pages: r.data.pages, characters: r.data.chars, summary: r.data.summary } : {}),
      ...(r.type === "deck" ? { course: r.data.course, cards: r.data.cardCount, cardsDue: r.data.cardsDue, nextReview: r.data.nextReview } : {}),
      ...(r.type === "quiz" ? { course: r.data.course, questions: r.data.questionCount, attempts: r.data.attemptCount, bestScore: r.data.bestScore, lastScore: r.data.lastScore } : {}),
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
      const { section, subsection } = resolveTaskGroup(state, args.section, args.subsection);
      if (args.dueTime !== undefined && !isValidTime(args.dueTime)) throw new Error("dueTime must be 24-hour HH:MM.");
      if (args.dueTime && !args.dueDate) throw new Error("A due time needs a dueDate.");
      return { type: "task", action: name, record: normalizeTask({ id, title: args.title, section, subsection, dueDate: args.dueDate || "", dueTime: args.dueTime, priority: args.priority, status: "not_started",
        ...(args.description ? { description: args.description.trim() } : {}),
        subtasks: args.subtasks?.map((title: string) => ({ id: crypto.randomUUID(), title, completed: false })) }) };
    }
    case "update_task": {
      const task = state.tasks.find(t => t.id === args.taskId);
      if (!task) throw new Error("Task ID not found. Query live tasks; do not guess IDs.");
      if (args.newTitle !== undefined && (typeof args.newTitle !== "string" || !args.newTitle.trim())) throw new Error("New task title must be nonempty.");
      if (!args.status && !args.newDueDate && args.newTitle === undefined && args.newDescription === undefined && args.newDueTime === undefined && !args.clearDueTime && !args.newSection && !args.newSubsection) throw new Error("Supply newTitle, status, newDueDate, newDueTime, clearDueTime, newDescription, newSection or newSubsection to update.");
      const moved = args.newSection || args.newSubsection
        ? resolveTaskGroup(state, args.newSection || task.section, args.newSubsection || (args.newSection ? undefined : task.subsection)) : undefined;
      if (args.newDueTime !== undefined && !isValidTime(args.newDueTime)) throw new Error("newDueTime must be 24-hour HH:MM.");
      if (args.newDueTime && !(args.newDueDate || task.dueDate)) throw new Error("This task has no due date; set newDueDate too.");
      const { dueTime: _oldTime, ...withoutTime } = args.status ? setTaskStatus(task, args.status) : task;
      const dueTime = args.clearDueTime ? undefined : args.newDueTime || task.dueTime;
      return { type: "task", action: name, expected: task, record: { ...withoutTime, ...(dueTime ? { dueTime } : {}), dueDate: args.newDueDate || task.dueDate,
        ...(args.newTitle !== undefined ? { title: args.newTitle.trim() } : {}),
        ...(moved ? moved : {}),
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
    case "create_event": {
      const kind = args.kind || "event";
      if (!EVENT_KINDS.some(k => k.id === kind)) throw new Error("Unknown event kind.");
      validDate(args.date);
      for (const field of ["startTime", "endTime"]) if (args[field] !== undefined && !isValidTime(args[field])) throw new Error(`${field} must be 24-hour HH:MM.`);
      if (args.endTime && !args.startTime) throw new Error("An end time needs a startTime.");
      if (args.endTime && args.endTime <= args.startTime) throw new Error("endTime must be after startTime.");
      const link = args.link ? safeEventLink(args.link) : undefined;
      if (args.link && !link) throw new Error("Links must be full http:// or https:// URLs.");
      const now = new Date().toISOString();
      const attendees = (args.attendees || []).map((a: string) => a.trim()).filter(Boolean);
      return { type: "event", action: name, record: { id, title: args.title.trim(), kind, date: args.date,
        ...(args.startTime ? { startTime: args.startTime } : {}), ...(args.endTime ? { endTime: args.endTime } : {}),
        ...(args.location ? { location: args.location.trim() } : {}), ...(link ? { link } : {}), ...(attendees.length ? { attendees } : {}),
        ...(args.notes ? { notes: args.notes.trim() } : {}), createdAt: now, updatedAt: now } };
    }
    case "update_event": {
      const event = (state.events || []).find(e => e.id === args.eventId);
      if (!event) throw new Error("Event ID not found. Query events; do not guess IDs.");
      const fields = ["newTitle", "kind", "newDate", "newStartTime", "newEndTime", "allDay", "location", "link", "attendees", "appendNotes"];
      if (!fields.some(k => args[k] !== undefined)) throw new Error("Supply at least one field to update.");
      if (args.kind && !EVENT_KINDS.some(k => k.id === args.kind)) throw new Error("Unknown event kind.");
      if (args.newDate) validDate(args.newDate);
      for (const field of ["newStartTime", "newEndTime"]) if (args[field] !== undefined && !isValidTime(args[field])) throw new Error(`${field} must be 24-hour HH:MM.`);
      const link = args.link ? safeEventLink(args.link) : undefined;
      if (args.link && !link) throw new Error("Links must be full http:// or https:// URLs.");
      const { startTime: _s, endTime: _e, ...base } = event;
      let startTime = args.allDay ? undefined : args.newStartTime || event.startTime;
      let endTime = args.allDay ? undefined : args.newEndTime || event.endTime;
      // Moving the start keeps the original duration when no new end is given.
      if (args.newStartTime && !args.newEndTime && event.startTime && event.endTime) {
        const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
        const end = toMin(args.newStartTime) + toMin(event.endTime) - toMin(event.startTime);
        endTime = end < 24 * 60 ? `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` : "23:59";
      }
      if (endTime && !startTime) throw new Error("An end time needs a start time.");
      if (startTime && endTime && endTime <= startTime) throw new Error("End time must be after start time.");
      const attendees = args.attendees?.map((a: string) => a.trim()).filter(Boolean);
      return { type: "event", action: name, expected: event, record: { ...base,
        ...(startTime ? { startTime } : {}), ...(endTime ? { endTime } : {}),
        ...(args.newTitle ? { title: args.newTitle.trim() } : {}), ...(args.kind ? { kind: args.kind } : {}), ...(args.newDate ? { date: args.newDate } : {}),
        ...(args.location ? { location: args.location.trim() } : {}), ...(link ? { link } : {}),
        ...(attendees ? { attendees } : {}),
        ...(args.appendNotes ? { notes: [event.notes?.trim(), args.appendNotes.trim()].filter(Boolean).join("\n") } : {}),
        updatedAt: new Date().toISOString() } };
    }
    case "delete_event": {
      const event = (state.events || []).find(e => e.id === args.eventId);
      if (!event) throw new Error("Event ID not found. Query events; do not guess IDs.");
      return { type: "event", action: name, expected: event, record: event, remove: true };
    }
    case "delete_task": {
      const task = state.tasks.find(t => t.id === args.taskId);
      if (!task) throw new Error("Task ID not found. Query live tasks; do not guess IDs.");
      return { type: "task", action: name, expected: task, record: task, remove: true };
    }
    case "update_goal": {
      const goal = state.goals.find(g => g.id === args.goalId);
      if (!goal) throw new Error("Goal ID not found. Query live goals; do not guess IDs.");
      const changes = ["newTitle", "status", "progress", "newTargetDate", "metrics", "why", "completeMilestones", "reopenMilestones", "addMilestones"].filter(k => args[k] !== undefined);
      if (!changes.length) throw new Error("Supply at least one field to update.");
      const matches = (m: { id: string; title: string }, refs: string[] = []) => refs.some(ref => ref === m.id || ref.trim().toLocaleLowerCase() === m.title.trim().toLocaleLowerCase());
      for (const ref of [...(args.completeMilestones || []), ...(args.reopenMilestones || [])])
        if (!goal.milestones.some(m => matches(m, [ref]))) throw new Error(`Milestone not found: ${ref}. Read the goal to get exact milestone IDs.`);
      const milestones = [
        ...goal.milestones.map(m => matches(m, args.completeMilestones) ? { ...m, completed: true } : matches(m, args.reopenMilestones) ? { ...m, completed: false } : m),
        ...(args.addMilestones || []).map((title: string) => ({ id: crypto.randomUUID(), title: title.trim(), completed: false })),
      ];
      const milestonesChanged = changes.some(k => k.endsWith("Milestones"));
      const progress = args.progress ?? (milestonesChanged && milestones.length ? Math.round(milestones.filter(m => m.completed).length / milestones.length * 100) : goal.progress);
      return { type: "goal", action: name, expected: goal, record: { ...goal, milestones, progress,
        status: args.status || (progress >= 100 && goal.status !== "achieved" && milestonesChanged ? "achieved" : progress > 0 && goal.status === "not_started" ? "in_progress" : goal.status),
        ...(args.newTitle ? { title: args.newTitle.trim() } : {}), ...(args.newTargetDate ? { targetDate: args.newTargetDate } : {}),
        ...(args.metrics ? { metrics: args.metrics.trim() } : {}), ...(args.why ? { why: args.why.trim() } : {}) } };
    }
    case "update_note": {
      const note = state.knowledgeItems.find(n => n.id === args.noteId);
      if (!note) throw new Error("Note ID not found. Search notes; do not guess IDs.");
      if (args.appendContent !== undefined && args.replaceContent !== undefined) throw new Error("Use appendContent or replaceContent, not both.");
      if (![args.newTitle, args.appendContent, args.replaceContent, args.folderId, args.tags].some(v => v !== undefined)) throw new Error("Supply at least one field to update.");
      if (args.folderId && !state.noteFolders?.some(f => f.id === args.folderId)) throw new Error("Unknown note folder ID.");
      const current = note.content || "";
      // Notes edited in the app may be stored as HTML; append in the same format.
      const html = /^\s*<[a-z][^>]*>/i.test(current);
      const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const appended = args.appendContent === undefined ? current
        : html ? `${current}${args.appendContent.trim().split(/\n{2,}/).map((p: string) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`).join("")}`
        : `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${args.appendContent.trim()}`;
      const content = args.replaceContent !== undefined ? args.replaceContent : appended;
      const title = args.newTitle?.trim();
      return { type: "knowledge", action: name, expected: note, record: { ...note, content,
        ...(content !== current ? { summary: content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) } : {}),
        ...(title ? { title, subject: title } : {}), ...(args.folderId ? { folderId: args.folderId } : {}), ...(args.tags ? { tags: args.tags } : {}),
        updatedAt: new Date().toISOString() } };
    }
    case "create_habit": {
      const name = args.name.trim();
      if (state.habits.some(h => h.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("A habit with this name already exists.");
      return { type: "habit", action: "create_habit", record: { id, name, frequency: args.frequency, streak: 0, bestStreak: 0, history: {},
        ...(args.timeOfDay ? { timeOfDay: args.timeOfDay } : {}), ...(args.description ? { description: args.description.trim() } : {}) } };
    }
    case "create_tracker_item": {
      const stages = args.kind === "leetcode" ? PROBLEM_STAGES : APPLICATION_STAGES;
      const status = args.status || (args.kind === "job_application" && args.appliedDate ? "applied" : "not_started");
      if (!stages.some(s => s.id === status)) throw new Error(`Status ${status} is not valid for ${args.kind}.`);
      if (args.kind === "job_application" && !args.company?.trim()) throw new Error("Company is required for a job application.");
      for (const field of ["appliedDate", "followUpDate"]) if (args[field]) validDate(args[field]);
      const url = args.url ? safeTrackerUrl(args.url.trim()) : undefined;
      if (args.url && !url) throw new Error("Links must be full http:// or https:// URLs.");
      const now = new Date().toISOString();
      const fields: Record<string, unknown> = Object.fromEntries(["appliedDate", "followUpDate", "location", "difficulty", "topic"].filter(k => args[k]).map(k => [k, String(args[k]).trim()]));
      if (args.kind === "leetcode" && !fields.difficulty) fields.difficulty = "Medium";
      const title = args.title.trim();
      return { type: "tracker", action: name, record: { id, workspaceId: CAREER_WORKSPACE_ID, kind: args.kind, title, subject: args.kind === "leetcode" ? title : args.company.trim(),
        ...(url ? { subjectUrl: url } : {}), status, fields, history: {}, streak: 0, bestStreak: 0, notes: args.notes?.trim() || "", createdAt: now, updatedAt: now } };
    }
    case "update_tracker_item": {
      const item = (state.trackerItems || []).find(t => t.id === args.trackerId);
      if (!item) throw new Error("Tracker ID not found. Query tracker records; do not guess IDs.");
      if (![args.newTitle, args.status, args.appliedDate, args.followUpDate, args.location, args.appendNotes].some(v => v !== undefined)) throw new Error("Supply at least one field to update.");
      const stages = item.kind === "leetcode" ? PROBLEM_STAGES : APPLICATION_STAGES;
      if (args.status && !stages.some(s => s.id === args.status)) throw new Error(`Status ${args.status} is not valid for ${item.kind}.`);
      for (const field of ["appliedDate", "followUpDate"]) if (args[field]) validDate(args[field]);
      const fields = { ...item.fields, ...Object.fromEntries(["appliedDate", "followUpDate", "location"].filter(k => args[k]).map(k => [k, String(args[k]).trim()])) };
      const title = args.newTitle?.trim();
      return { type: "tracker", action: name, expected: item, record: { ...item, fields, ...(args.status ? { status: args.status } : {}),
        ...(title ? { title, ...(item.kind === "leetcode" ? { subject: title } : {}) } : {}),
        ...(args.appendNotes ? { notes: [item.notes?.trim(), args.appendNotes.trim()].filter(Boolean).join("\n") } : {}), updatedAt: new Date().toISOString() } };
    }
    case "create_course": {
      const study = studyOf(state);
      const code = args.code?.trim() || "";
      const name = args.name.trim();
      if (study.courses.some(c => (code && c.code.toLocaleLowerCase() === code.toLocaleLowerCase()) || c.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
        throw new Error("This course already exists. Query courses and use its ID.");
      const workspaceId = (state.workspaces || []).find(w => w.template === "academic")?.id || ACADEMIC_WORKSPACE_ID;
      const now = new Date().toISOString();
      return { type: "course", action: "create_course", record: { id, workspaceId, code, name,
        ...(args.term ? { term: args.term.trim() } : {}), ...(args.instructor ? { instructor: args.instructor.trim() } : {}), createdAt: now, updatedAt: now } };
    }
    case "set_course_grading": {
      const course = studyOf(state).courses.find(c => c.id === args.courseId);
      if (!course) throw new Error("Course ID not found. Query course records; do not guess IDs.");
      const names = new Set<string>();
      for (const c of args.categories) {
        const key = String(c.name).trim().toLowerCase();
        if (!key) throw new Error("Category names must be nonempty.");
        if (names.has(key)) throw new Error(`Category ${c.name} is listed twice.`);
        names.add(key);
        if (!(c.weight > 0 && c.weight <= 100)) throw new Error("Category weights must be between 0 and 100.");
      }
      const lost = (course.grading?.categories || []).filter(c => !names.has(c.name.toLowerCase()) && course.grading!.items.some(i => i.categoryId === c.id));
      if (lost.length) throw new Error(`These categories have scores and would be removed: ${lost.map(c => c.name).join(", ")}. Keep them in the list (same name) unless the user asked to remove them.`);
      const next = applyCategories(course.grading, args.categories.map((c: any) => ({ name: String(c.name).trim(), weight: c.weight, ...(c.count > 1 ? { count: c.count } : {}), ...(c.dropLowest ? { dropLowest: c.dropLowest } : {}) })), () => crypto.randomUUID());
      const grading = normalizeGrading({ ...next, ...(args.scale?.length ? { scale: args.scale } : {}), ...(args.target !== undefined ? { target: args.target } : {}) });
      if (!grading) throw new Error("Could not read that grading breakdown.");
      return { type: "course", action: name, expected: course, record: { ...course, grading, updatedAt: new Date().toISOString() } };
    }
    case "record_grade": {
      const course = studyOf(state).courses.find(c => c.id === args.courseId);
      if (!course) throw new Error("Course ID not found. Query course records; do not guess IDs.");
      const grading = course.grading;
      if (!grading?.categories.length) throw new Error("This course has no grading set up. Ask the user how it is weighted (or read the syllabus) and call set_course_grading first.");
      if (args.date) validDate(args.date);
      if (args.score !== undefined && !(args.score >= 0)) throw new Error("score must be zero or more.");
      if (args.maxScore !== undefined && !(args.maxScore > 0)) throw new Error("maxScore must be more than zero.");
      const category = args.category ? findCategory(grading, args.category) : undefined;
      if (args.category && !category) throw new Error(`Unknown category. This course's categories are: ${grading.categories.map(c => c.name).join(", ")}.`);
      let items;
      if (args.gradeId) {
        const item = grading.items.find(i => i.id === args.gradeId);
        if (!item) throw new Error("Grade ID not found. Query the course record for grade item IDs.");
        const updated = { ...item, ...(category ? { categoryId: category.id } : {}), ...(args.title ? { title: args.title.trim() } : {}),
          ...(args.score !== undefined ? { score: args.score } : {}), ...(args.maxScore !== undefined ? { maxScore: args.maxScore } : {}), ...(args.date ? { date: args.date } : {}) };
        items = grading.items.map(i => i.id === item.id ? updated : i);
      } else {
        if (!category) throw new Error(`Name the category. This course's categories are: ${grading.categories.map(c => c.name).join(", ")}.`);
        if (!args.title?.trim()) throw new Error("A new grade needs a title.");
        // Fill in an existing upcoming item with the same title instead of duplicating it.
        const upcoming = grading.items.find(i => i.categoryId === category.id && i.score === undefined && i.title.toLowerCase() === args.title.trim().toLowerCase());
        const item = { ...(upcoming || {}), id: upcoming?.id || id, categoryId: category.id, title: args.title.trim(), maxScore: args.maxScore ?? upcoming?.maxScore ?? 100,
          ...(args.score !== undefined ? { score: args.score } : {}), ...(args.date ? { date: args.date } : upcoming?.date ? { date: upcoming.date } : {}) };
        items = upcoming ? grading.items.map(i => i.id === upcoming.id ? item : i) : [...grading.items, item];
      }
      if (args.score !== undefined && args.score > (args.maxScore ?? 100) * 1.5) throw new Error("That score is far above the points possible; check maxScore.");
      return { type: "course", action: name, expected: course, record: { ...course, grading: { ...grading, items }, updatedAt: new Date().toISOString() } };
    }
    case "create_flashcard_deck": {
      const study = studyOf(state);
      const docIds = new Set(study.documents.map(d => d.id));
      for (const card of args.cards) if (card.sourceDocumentId && !docIds.has(card.sourceDocumentId)) throw new Error(`Unknown document ID ${card.sourceDocumentId}. Use IDs from course document records.`);
      const cards = args.cards.map((c: { front: string; back: string; sourceDocumentId?: string }) => newCard(c.front.slice(0, 2000), c.back.slice(0, 2000), c.sourceDocumentId, today));
      const sources = (cards as Array<{ sourceDocId?: string }>).map(c => c.sourceDocId).filter((x): x is string => !!x);
      if (args.deckId) {
        const deck = study.decks.find(d => d.id === args.deckId);
        if (!deck) throw new Error("Deck ID not found. Query deck records; do not guess IDs.");
        return { type: "deck", action: "add_flashcards", expected: deck, record: { ...deck, cards: [...deck.cards, ...cards],
          sourceDocIds: [...new Set([...deck.sourceDocIds, ...sources])], updatedAt: new Date().toISOString() } };
      }
      if (!args.courseId || !study.courses.some(c => c.id === args.courseId)) throw new Error("Course ID not found. Query course records, or create the course first.");
      if (!args.title?.trim()) throw new Error("A new deck needs a title.");
      const now = new Date().toISOString();
      return { type: "deck", action: name, record: { id, courseId: args.courseId, title: args.title.trim().slice(0, 120), sourceDocIds: [...new Set(sources)], cards, createdAt: now, updatedAt: now } };
    }
    case "create_quiz": {
      const study = studyOf(state);
      if (!study.courses.some(c => c.id === args.courseId)) throw new Error("Course ID not found. Query course records, or create the course first.");
      const docIds = new Set(study.documents.map(d => d.id));
      const questions = args.questions.map((q: Record<string, unknown>, i: number) => {
        if (q.sourceDocumentId && !docIds.has(String(q.sourceDocumentId))) throw new Error(`Unknown document ID ${q.sourceDocumentId}.`);
        const question = normalizeQuestion({ ...q, sourceDocId: q.sourceDocumentId, id: crypto.randomUUID() });
        if (!question || question.type !== q.type) throw new Error(`Question ${i + 1} is invalid: multiple choice needs 2-6 choices and a valid answerIndex; short answer needs an answer.`);
        return question;
      }) as QuizQuestion[];
      return { type: "quiz", action: name, record: { id, courseId: args.courseId, title: args.title.trim().slice(0, 120),
        sourceDocIds: [...new Set(questions.map(q => q.sourceDocId).filter((x): x is string => !!x))], questions, attempts: [], createdAt: new Date().toISOString() } };
    }
    default: throw new Error(`Unknown mutation ${name}`);
  }
}

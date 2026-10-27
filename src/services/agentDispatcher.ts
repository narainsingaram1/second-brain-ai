import { BrainState, Task, Goal, Habit, JournalEntry, KnowledgeItem, GoalSector } from "../types";
import { queryOpenRouterWithTools, OpenRouterTool } from "./openrouter";
import { vectorVault } from "./vectorVault";
import { getLocalDateString, syncHabitStreaks } from "../utils/habitStreaks";
import { normalizeTask, setTaskStatus } from "../utils/taskState";

export type AgentActionType =
  | "create_task"
  | "update_task"
  | "create_goal"
  | "complete_habit"
  | "log_journal"
  | "create_note"
  | "create_section"
  | "query_brain"
  | "compound";

export interface AgentExecutionResult {
  actionType: AgentActionType;
  headline: string;
  explanation: string;
  entityType?: "task" | "goal" | "habit" | "journal" | "knowledge" | "query" | "compound";
  createdTask?: Task;
  createdGoal?: Goal;
  updatedTask?: Task;
  updatedHabit?: Habit;
  createdJournal?: JournalEntry;
  createdNote?: KnowledgeItem;
  queryAnswer?: string;
  citations?: Array<{ title: string; type: string; snippet?: string }>;
  subActions?: AgentExecutionResult[];
}

// =========================================================================
// INTELLIGENT NATURAL LANGUAGE DATE RESOLVER
// =========================================================================

export function resolveNaturalDate(text: string, refDate: Date = new Date()): {
  dateStr?: string;
  cleanedText: string;
  relativeLabel?: string;
} {
  const lower = text.toLowerCase();
  const base = new Date(refDate);

  // Day of week index: Sunday = 0, Monday = 1, ..., Saturday = 6
  const currentDay = base.getDay();

  const daysOfWeek = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  // 1. "today" / "tonight"
  if (/\b(today|tonight)\b/i.test(lower)) {
    return {
      dateStr: getLocalDateString(base),
      cleanedText: text.replace(/\b(due|by|for|on)?\s*(today|tonight)\b/gi, "").trim(),
      relativeLabel: "Today",
    };
  }

  // 2. "tomorrow"
  if (/\btomorrow\b/i.test(lower)) {
    const d = new Date(base.getTime() + 86400000);
    return {
      dateStr: getLocalDateString(d),
      cleanedText: text.replace(/\b(due|by|for|on)?\s*tomorrow\b/gi, "").trim(),
      relativeLabel: "Tomorrow",
    };
  }

  // 3. "day after tomorrow"
  if (/\bday after tomorrow\b/i.test(lower)) {
    const d = new Date(base.getTime() + 2 * 86400000);
    return {
      dateStr: getLocalDateString(d),
      cleanedText: text.replace(/\b(due|by|for|on)?\s*day after tomorrow\b/gi, "").trim(),
      relativeLabel: "In 2 days",
    };
  }

  // 4. "in X days"
  const inDaysMatch = lower.match(/\bin\s+(\d+)\s+days?\b/i);
  if (inDaysMatch) {
    const num = parseInt(inDaysMatch[1], 10);
    const d = new Date(base.getTime() + num * 86400000);
    return {
      dateStr: getLocalDateString(d),
      cleanedText: text.replace(inDaysMatch[0], "").trim(),
      relativeLabel: `In ${num} days`,
    };
  }

  // 5. "next [day of week]" vs "[day of week]"
  for (let i = 0; i < 7; i++) {
    const dayName = daysOfWeek[i];
    const nextRegex = new RegExp(`\\bnext\\s+${dayName}\\b`, "i");
    const onRegex = new RegExp(`\\b(due|by|on|this)?\\s*${dayName}\\b`, "i");

    const isNext = nextRegex.test(lower);
    const isOn = onRegex.test(lower);

    if (isNext || (isOn && !/\b(last|every)\b/i.test(lower))) {
      let daysAhead = (i - currentDay + 7) % 7;
      if (daysAhead === 0) {
        // Today is that day; "next [Day]" or "[Day]" refers to next week
        daysAhead = 7;
      }

      const target = new Date(base.getTime() + daysAhead * 86400000);
      const cleanRegex = isNext ? nextRegex : onRegex;
      return {
        dateStr: getLocalDateString(target),
        cleanedText: text.replace(cleanRegex, "").replace(/\b(due|by|on|for|this|next)\b/gi, "").trim(),
        relativeLabel: `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} (${getLocalDateString(target)})`,
      };
    }
  }

  // 6. "next week"
  if (/\bnext week\b/i.test(lower)) {
    const d = new Date(base.getTime() + 7 * 86400000);
    return {
      dateStr: getLocalDateString(d),
      cleanedText: text.replace(/\b(due|by|for|on)?\s*next week\b/gi, "").trim(),
      relativeLabel: "Next week",
    };
  }

  // 7. Explicit ISO or Month Day (e.g. "2026-11-02", "Nov 15", "December 31")
  const explicitIso = text.match(/\b(20\d\d-[01]\d-[0-3]\d)\b/);
  if (explicitIso) {
    return {
      dateStr: explicitIso[1],
      cleanedText: text.replace(explicitIso[0], "").trim(),
      relativeLabel: explicitIso[1],
    };
  }

  return {
    cleanedText: text,
  };
}

// =========================================================================
// SECTION & SUBSECTION SCHEMA MATCHER
// =========================================================================

export function matchSectionHierarchy(
  text: string,
  sections: string[],
  subsections: Record<string, string[]>
): { section: string; subsection: string; confidence: number } {
  const lower = text.toLowerCase();

  // 1. Direct subsection exact match (highest priority, e.g. "CS 1332", "Trading & Risk")
  for (const sec of sections) {
    const subs = subsections[sec] || ["General"];
    for (const sub of subs) {
      const subLower = sub.toLowerCase();
      // Check for whole words or strong containment
      if (subLower !== "general" && lower.includes(subLower)) {
        return { section: sec, subsection: sub, confidence: 0.95 };
      }
    }
  }

  // 2. Direct section exact match (e.g. "Academic", "Career", "Finance", "Health")
  for (const sec of sections) {
    const secLower = sec.toLowerCase();
    if (lower.includes(secLower)) {
      const subs = subsections[sec] || ["General"];
      return { section: sec, subsection: subs[0] || "General", confidence: 0.85 };
    }
  }

  // 3. Domain keyword heuristics
  if (/\b(exam|lab|hw|homework|cs|algorithm|class|lecture|professor|gpa|study|assignment|quiz)\b/i.test(lower)) {
    const academicSec = sections.find((s) => /academic|school|study|college/i.test(s)) || sections[0];
    const subs = subsections[academicSec] || ["General"];
    const csSub = subs.find((s) => /cs|systems|algo/i.test(s)) || subs[0];
    return { section: academicSec, subsection: csSub, confidence: 0.8 };
  }

  if (/\b(swe|interview|resume|job|internship|project|rust|github|repo|codebase|pr|deploy)\b/i.test(lower)) {
    const careerSec = sections.find((s) => /career|work|project/i.test(s)) || sections[0];
    const subs = subsections[careerSec] || ["General"];
    const sweSub = subs.find((s) => /swe|applications|projects/i.test(s)) || subs[0];
    return { section: careerSec, subsection: sweSub, confidence: 0.8 };
  }

  if (/\b(money|budget|save|saving|invest|stock|portfolio|crypto|tax|401k|roth|dollar|\$)\b/i.test(lower)) {
    const financeSec = sections.find((s) => /finance|wealth|money/i.test(s)) || sections[0];
    const subs = subsections[financeSec] || ["General"];
    return { section: financeSec, subsection: subs[0], confidence: 0.8 };
  }

  if (/\b(workout|gym|run|running|lift|sleep|cardio|protein|diet|health|marathon)\b/i.test(lower)) {
    const healthSec = sections.find((s) => /health|fitness|wellness/i.test(s)) || sections[0];
    const subs = subsections[healthSec] || ["General"];
    return { section: healthSec, subsection: subs[0], confidence: 0.8 };
  }

  // Default fallback
  const fallbackSec = sections[0] || "Academic";
  const fallbackSub = subsections[fallbackSec]?.[0] || "General";
  return { section: fallbackSec, subsection: fallbackSub, confidence: 0.5 };
}

// =========================================================================
// AUTONOMOUS AGENT DISPATCHER
// =========================================================================

export class AutonomousBrainAgent {
  /**
   * Main entrypoint: Takes freeform natural language from the user,
   * analyzes intent against the brain's schema, and executes the best action.
   */
  static async execute(
    prompt: string,
    brainState: BrainState,
    openRouterKey?: string,
    model?: string
  ): Promise<AgentExecutionResult> {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      throw new Error("Prompt cannot be empty");
    }

    // 1. If OpenRouter Key is available, try Enterprise Agentic Function Calling
    if (openRouterKey && openRouterKey.trim() !== "") {
      try {
        const agentResult = await this.executeWithLLM(cleanPrompt, brainState, openRouterKey, model);
        if (agentResult) {
          return agentResult;
        }
      } catch (err) {
        console.warn("LLM Agent execution fallback to deterministic offline engine:", err);
      }
    }

    // 2. High-Capacity Deterministic Offline Agent Engine
    return this.executeLocally(cleanPrompt, brainState);
  }

  /**
   * Enterprise LLM-Powered Agentic Router using Structured Function Tools
   */
  private static async executeWithLLM(
    prompt: string,
    brainState: BrainState,
    openRouterKey: string,
    model: string = "anthropic/claude-3.5-sonnet"
  ): Promise<AgentExecutionResult | null> {
    const today = getLocalDateString();
    const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });

    // Retrieve semantic memories from Vector Vault for RAG context
    let relevantMemories: any[] = [];
    try {
      relevantMemories = await vectorVault.search(prompt, 3, undefined, openRouterKey);
    } catch (vaultErr) {
      console.warn("Semantic memory retrieval notice:", vaultErr);
    }

    let ragContext = "";
    if (relevantMemories.length > 0) {
      ragContext =
        `\n\nRELEVANT PAST MEMORIES RETRIEVED FROM USER'S VAULT (RAG):\n` +
        relevantMemories
          .map(
            (m, idx) =>
              `[Memory #${idx + 1} - ${m.chunk.item_type.toUpperCase()}${m.chunk.date ? ` (${m.chunk.date})` : ""}] "${m.chunk.title}": ${m.chunk.content}`
          )
          .join("\n");
    }

    const contextManifest = {
      todayDate: today,
      todayDayOfWeek: dayOfWeek,
      sectionsSchema: brainState.sections.map((sec) => ({
        section: sec,
        subsections: brainState.subsections[sec] || ["General"],
      })),
      activeHabits: brainState.habits.map((h) => ({ id: h.id, name: h.name, streak: h.streak })),
      activeGoals: (brainState.goals || []).map((g) => ({
        id: g.id,
        title: g.title,
        sector: g.sector,
        timeframe: g.timeframe,
      })),
      recentPendingTasks: brainState.tasks
        .filter((t) => !t.completed)
        .slice(0, 12)
        .map((t) => ({
          id: t.id,
          title: t.title,
          section: t.section,
          subsection: t.subsection,
          dueDate: t.dueDate,
          priority: t.priority,
        })),
    };

    const systemPrompt = `You are Synapse, the Autonomous Executive AI for the user's Second Brain Operating System.
You have direct read access to the user's life context, pending tasks, active habits, goals, and system mutation tools.

CURRENT CONTEXT:
- Today: ${dayOfWeek}, ${today}
- Registered Sections & Subsections: ${JSON.stringify(contextManifest.sectionsSchema)}
- Active Habits: ${JSON.stringify(contextManifest.activeHabits)}
- Active Life Goals: ${JSON.stringify(contextManifest.activeGoals)}
- Pending Tasks (Sample): ${JSON.stringify(contextManifest.recentPendingTasks)}${ragContext}

CRITICAL RULES FOR INTENT RESOLUTION:
1. CONVERSATION, STRATEGY, REVIEW & PLANNING (DO NOT CALL MUTATION TOOLS):
   - When the user asks for planning (e.g. "Plan my week: analyze my top priorities...", "What should I focus on today?"), asks for advice, brainstorms ideas, asks questions, or reflects:
     DO NOT invoke create_task!
     Instead, provide a deeply thoughtful, beautifully formatted Markdown response with clear headings, bullet points, and prioritized action steps based on their actual tasks, habits, and goals.
   - If the user asks about past decisions or memories (e.g. "What did I decide about X?"), synthesize an articulate response using the retrieved memories.

2. EXPLICIT AGENTIC ACTION (INVOKE RELEVANT TOOL):
   - If the user explicitly asks to schedule or create a task, homework, or exam (e.g. "CS 1332 exam next monday", "buy groceries tomorrow", "schedule task: ..."):
     Call 'create_task'. Assign the right section (e.g. Academic) and subsection (e.g. CS 1332). Resolve the date relative to ${today}. Generate 2-3 preparation subtasks if appropriate.
   - If the user completes or updates a task (e.g. "mark CS 1332 lab completed", "finish X"):
     Call 'update_task' with the matching taskId.
   - If the user logs a habit (e.g. "did my 90m deep work sprint", "drank cold water"):
     Call 'complete_habit' with matching habitId.
   - If the user sets a major aspiration or milestone (e.g. "Goal: Reach $100k savings by 2028"):
     Call 'create_goal' with sector, timeframe, metrics, and milestones.
   - If the user asks to write a journal or reflect:
     Call 'log_journal'.
   - If the user asks to create an informational note:
     Call 'create_note'.

3. COMBINED RESPONSES:
   You may provide an explanatory or conversational text response in addition to calling a tool. For example, when scheduling an exam, explain how the milestones will help the user prepare.`;

    const AGENT_TOOLS: OpenRouterTool[] = [
      {
        type: "function",
        function: {
          name: "create_task",
          description:
            "Schedule a concrete actionable task or assignment into the user's second brain. Use ONLY when the user explicitly requests to schedule, add, or create a specific task, homework, or exam. DO NOT call this tool for general questions, advice, planning requests ('Plan my week'), or discussion.",
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
                description: "Due date in YYYY-MM-DD format.",
              },
              priority: {
                type: "string",
                enum: ["urgent", "high", "medium", "low"],
                description: "Task priority level.",
              },
              subtasks: {
                type: "array",
                items: { type: "string" },
                description: "Optional 2-4 preparation milestones or actionable subtasks.",
              },
            },
            required: ["title", "dueDate", "priority"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "update_task",
          description:
            "Update the status or schedule of an existing task (e.g. marking it as completed or in_progress).",
          parameters: {
            type: "object",
            properties: {
              taskId: {
                type: "string",
                description: "ID of the existing task to update from the user's task list.",
              },
              title: {
                type: "string",
                description: "Optional title or keyword to match if taskId is unsure.",
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
            },
            required: ["status"],
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

    const completion = await queryOpenRouterWithTools(
      [{ role: "user", content: prompt }],
      AGENT_TOOLS,
      openRouterKey,
      model,
      systemPrompt,
      "auto"
    );

    // Handle tool call dispatching
    if (completion.toolCalls && completion.toolCalls.length > 0) {
      const toolCall = completion.toolCalls[0];
      const fnName = toolCall.function.name;
      let args: any = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      if (fnName === "create_task") {
        const taskTitle = args.title || prompt;
        const targetSection = args.section || brainState.sections[0] || "Academic";
        const targetSubsection =
          args.subsection || brainState.subsections[targetSection]?.[0] || "General";
        const dueDate = args.dueDate || today;
        const priority = args.priority || "high";

        const task: Task = normalizeTask({
          id: `task-${Date.now()}`,
          title: taskTitle,
          dueDate,
          priority,
          section: targetSection,
          subsection: targetSubsection,
          status: "not_started",
          subtasks: Array.isArray(args.subtasks)
            ? args.subtasks.map((st: string, idx: number) => ({
                id: `sub-${Date.now()}-${idx}`,
                title: st,
                completed: false,
              }))
            : undefined,
        });

        return {
          actionType: "create_task",
          headline: `Scheduled Task: "${task.title}"`,
          explanation:
            completion.content || `Filed in ${task.section} → ${task.subsection} (Due: ${task.dueDate})`,
          entityType: "task",
          createdTask: task,
          queryAnswer: completion.content || undefined,
        };
      }

      if (fnName === "update_task") {
        let targetTask = brainState.tasks.find((t) => t.id === args.taskId);
        if (!targetTask && args.title) {
          targetTask = brainState.tasks.find((t) =>
            t.title.toLowerCase().includes(args.title.toLowerCase())
          );
        }

        if (targetTask) {
          const updatedTask = setTaskStatus(targetTask, args.status || "completed");
          if (args.newDueDate) updatedTask.dueDate = args.newDueDate;

          return {
            actionType: "update_task",
            headline: `Updated Task: "${updatedTask.title}"`,
            explanation: completion.content || `Status changed to ${updatedTask.status}`,
            entityType: "task",
            updatedTask,
            queryAnswer: completion.content || undefined,
          };
        }
      }

      if (fnName === "complete_habit") {
        let habit = brainState.habits.find((h) => h.id === args.habitId);
        if (!habit && args.habitName) {
          habit = brainState.habits.find((h) =>
            h.name.toLowerCase().includes(args.habitName.toLowerCase())
          );
        }

        if (habit) {
          const updatedHabit = syncHabitStreaks({
            ...habit,
            history: { ...habit.history, [today]: true },
          });

          return {
            actionType: "complete_habit",
            headline: `Extended Habit Streak: "${habit.name}"`,
            explanation:
              completion.content || `Streak extended to ${updatedHabit.streak} days!`,
            entityType: "habit",
            updatedHabit,
            queryAnswer: completion.content || undefined,
          };
        }
      }

      if (fnName === "create_goal") {
        const goal: Goal = {
          id: `goal-${Date.now()}`,
          title: args.title || prompt,
          sector: args.sector || "career",
          timeframe: args.timeframe || "yearly",
          targetDate: args.targetDate || undefined,
          metrics: args.metrics || undefined,
          why: args.why || "High-leverage life improvement commitment",
          status: "in_progress",
          progress: 0,
          milestones: Array.isArray(args.milestones)
            ? args.milestones.map((m: string, idx: number) => ({
                id: `gm-${Date.now()}-${idx}`,
                title: m,
                completed: false,
              }))
            : [
                { id: `gm-${Date.now()}-1`, title: "Define roadmap and timeline", completed: false },
                { id: `gm-${Date.now()}-2`, title: "Build weekly execution habit", completed: false },
                { id: `gm-${Date.now()}-3`, title: "Review milestone progress", completed: false },
              ],
          createdAt: new Date().toISOString(),
        };

        return {
          actionType: "create_goal",
          headline: `Established Goal: "${goal.title}"`,
          explanation:
            completion.content || `Tracked in ${goal.sector.toUpperCase()} (${goal.timeframe} horizon)`,
          entityType: "goal",
          createdGoal: goal,
          queryAnswer: completion.content || undefined,
        };
      }

      if (fnName === "log_journal") {
        const entry: JournalEntry = {
          id: `journal-${Date.now()}`,
          date: today,
          title: args.title || "Daily Reflection",
          content: args.content || prompt,
          mood: args.mood || "great",
          wins: args.wins || [],
          challenges: args.challenges || [],
          tags: ["AgentCapture"],
        };

        return {
          actionType: "log_journal",
          headline: `Saved Reflection: "${entry.title}"`,
          explanation:
            completion.content || `Captured in journal under ${entry.mood} headspace`,
          entityType: "journal",
          createdJournal: entry,
          queryAnswer: completion.content || undefined,
        };
      }

      if (fnName === "create_note") {
        const noteTitle = args.title || "Knowledge Note";
        const noteContent = args.content || prompt;
        const note: KnowledgeItem = {
          id: `kn-${Date.now()}`,
          subject: noteTitle,
          title: noteTitle,
          content: noteContent,
          summary: noteContent.slice(0, 180),
          folderId: args.folderId || null,
          tags: args.tags || ["SecondBrain"],
          status: "Synthesized",
          startDate: today,
          endDate: today,
          domain: "General",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        return {
          actionType: "create_note",
          headline: `Created Knowledge Note: "${note.title}"`,
          explanation: completion.content || `Saved to Notes Workspace`,
          entityType: "knowledge",
          createdNote: note,
          queryAnswer: completion.content || undefined,
        };
      }
    }

    // If the model responded conversationally or provided a weekly plan
    if (completion.content && completion.content.trim()) {
      let headline = "Second Brain Executive Intelligence";
      const lowerPrompt = prompt.toLowerCase();
      if (lowerPrompt.includes("plan")) {
        headline = "Strategic Execution Plan";
      } else if (lowerPrompt.includes("brainstorm")) {
        headline = "Brainstorming & Strategic Exploration";
      } else if (lowerPrompt.includes("audit") || lowerPrompt.includes("review")) {
        headline = "Second Brain Review & Insights";
      }

      return {
        actionType: "query_brain",
        headline,
        explanation: "Synthesized using your live brain state, priorities, and knowledge vault",
        entityType: "query",
        queryAnswer: completion.content,
        citations: relevantMemories.map((m) => ({
          title: m.chunk.title,
          type: m.chunk.item_type,
          snippet: m.chunk.content.slice(0, 100) + "...",
        })),
      };
    }

    return null;
  }

  /**
   * Deterministic Offline Agent Engine (Zero Network Latency, Instant Local Intelligence)
   * Designed to NEVER auto-task conversational or planning prompts!
   */
  private static async executeLocally(
    prompt: string,
    brainState: BrainState
  ): Promise<AgentExecutionResult> {
    const today = getLocalDateString();
    const lower = prompt.toLowerCase().trim();

    // 1. Planning intent: "plan my week", "plan today", "schedule my week", "weekly plan", "prioritize"
    if (
      /\b(plan (my )?week|weekly plan|plan (for )?today|schedule my week|prioritize (my )?(day|week|tasks)|plan tomorrow)\b/i.test(
        prompt
      )
    ) {
      return this.generateOfflinePlan(prompt, brainState);
    }

    // 2. Greetings and capability queries: "hi", "hello", "who are you", "help"
    if (/^(hi|hello|hey|help|who are you|what can you do|about you)\b/i.test(lower)) {
      return {
        actionType: "query_brain",
        headline: "Synapse Second Brain AI",
        explanation: "Autonomous Life Operating System Assistant",
        entityType: "query",
        queryAnswer: `**Hello! I am Synapse**, your autonomous Second Brain executive.\n\nHere is what I can do for you:\n- **Plan your week & days**: *"Plan my week: analyze my top priorities"*\n- **Schedule tasks intelligently**: *"CS 1332 exam next monday"*, *"Buy groceries tomorrow"*\n- **Update task status**: *"Mark CS 1332 lab as completed"*\n- **Build daily habits**: *"Did my 90m deep work sprint"*\n- **Set long-term goals**: *"Goal: Reach $100k liquid savings by 2028"*\n- **Recall memories & notes**: *"What did I decide about Raft consensus?"*\n- **Reflect & journal**: *"Journal: Had a breakthrough in system design today"*\n\nSimply type whatever is on your mind, and I will resolve it seamlessly!`,
      };
    }

    // 3. Brainstorming or open-ended strategic thoughts
    if (
      /\b(brainstorm|ideas|optimize|optimizations|strategy|perspectives)\b/i.test(lower) &&
      !lower.startsWith("task:") &&
      !lower.startsWith("todo:")
    ) {
      return {
        actionType: "query_brain",
        headline: "Strategic Brainstorming & Insights",
        explanation: "Generated high-leverage frameworks based on your life system",
        entityType: "query",
        queryAnswer: `### 💡 High-Leverage Strategic Perspectives\n\n1. **Ruthless Focus on the Vital Few (Pareto 80/20)**:\n   - Review your current active tasks (${
          brainState.tasks.filter((t) => !t.completed).length
        } pending). Identify the top 20% that create 80% of academic and career leverage.\n2. **Energy Management Over Time Management**:\n   - Anchor your most cognitively demanding work to your peak morning hours right after your key habits.\n3. **Tight Feedback Loops**:\n   - Turn large ambiguous milestones into small, falsifiable daily test sprints.\n\n*Tip: Connect an OpenRouter API key in Settings for personalized, deep-reasoning multi-model brainstorming tailored to your notes and projects.*`,
      };
    }

    // 4. Check for Habit Completion Intent ("did my 90m sprint", "completed habit", "drank water")
    if (
      lower.includes("habit") ||
      lower.includes("completed my") ||
      lower.includes("did my") ||
      lower.includes("streak") ||
      lower.includes("drank") ||
      lower.includes("cold water") ||
      lower.includes("workout today")
    ) {
      for (const habit of brainState.habits) {
        const nameTokens = habit.name.toLowerCase().split(/\s+/);
        const matchCount = nameTokens.filter((token) => token.length > 2 && lower.includes(token)).length;
        if (matchCount >= 2 || lower.includes(habit.name.toLowerCase())) {
          const updatedHabit = syncHabitStreaks({
            ...habit,
            history: { ...habit.history, [today]: true },
          });
          return {
            actionType: "complete_habit",
            headline: `Extended Habit Streak: "${habit.name}"`,
            explanation: `Logged for today. Streak is now ${updatedHabit.streak} consecutive days!`,
            entityType: "habit",
            updatedHabit,
          };
        }
      }
    }

    // 2. Check for Task Status Update Intent ("mark X as completed / done", "finish X")
    const updateMatch = lower.match(/(mark|set|finish|completed?)\s+(?:task\s+)?["']?(.+?)["']?\s+(?:as\s+)?(complete[d]?|done|in progress|not started)/i);
    if (updateMatch) {
      const searchTitle = updateMatch[2].trim().toLowerCase();
      const newStatus = /in progress/i.test(updateMatch[3])
        ? "in_progress"
        : /not started/i.test(updateMatch[3])
        ? "not_started"
        : "completed";

      const matchedTask = brainState.tasks.find((t) => t.title.toLowerCase().includes(searchTitle));
      if (matchedTask) {
        const updatedTask = setTaskStatus(matchedTask, newStatus);
        return {
          actionType: "update_task",
          headline: `Updated Task: "${matchedTask.title}"`,
          explanation: `Marked status as "${newStatus}" in ${matchedTask.section}`,
          entityType: "task",
          updatedTask,
        };
      }
    }

    // 3. Check for Long-Term Goal Intent ("reach $100k", "goal:", "achieve 4.0 gpa", "run marathon")
    if (
      lower.startsWith("goal:") ||
      lower.includes("reach $") ||
      lower.includes("net worth") ||
      lower.includes("gpa") ||
      lower.includes("become a") ||
      lower.includes("achieve ") ||
      lower.includes("run a marathon") ||
      lower.includes("long-term")
    ) {
      const cleanTitle = prompt.replace(/^(goal:)/i, "").trim();
      let sector: GoalSector = "career";
      if (/\$|money|save|wealth|invest|net worth|portfolio/i.test(lower)) sector = "finance";
      else if (/gpa|grade|study|academics|degree|phd/i.test(lower)) sector = "academics";
      else if (/marathon|workout|lift|muscle|body|health|weight/i.test(lower)) sector = "health";
      else if (/stoic|mind|wisdom|clarity|focus|peace/i.test(lower)) sector = "mindset";
      else if (/friend|relationship|community|network/i.test(lower)) sector = "personal";

      const goal: Goal = {
        id: `goal-${Date.now()}`,
        title: cleanTitle,
        sector,
        timeframe: /year/i.test(lower) ? "yearly" : "long_term",
        progress: 0,
        status: "in_progress",
        why: `Core commitment to long-term ${sector} improvement.`,
        metrics: lower.includes("$") ? cleanTitle.match(/\$[\d,kK]+/)?.[0] || "Target Value" : "100% completion",
        milestones: [
          { id: `gm-${Date.now()}-1`, title: "Define quarterly leading indicators & milestones", completed: false },
          { id: `gm-${Date.now()}-2`, title: "Build non-negotiable daily execution ritual", completed: false },
          { id: `gm-${Date.now()}-3`, title: "Conduct 90-day progress audit & calibrate", completed: false },
        ],
        createdAt: new Date().toISOString(),
      };

      return {
        actionType: "create_goal",
        headline: `Established Life Goal: "${goal.title}"`,
        explanation: `Categorized under ${sector.toUpperCase()} with 3 actionable stepping stones`,
        entityType: "goal",
        createdGoal: goal,
      };
    }

    // 3.5 Check for Note Creation Intent ("note: ...", "take a note: ...", "write note: ...")
    if (
      lower.startsWith("note:") ||
      lower.startsWith("take note:") ||
      lower.startsWith("write note:") ||
      lower.startsWith("create note:") ||
      lower.includes("take a note") ||
      lower.includes("save note")
    ) {
      const cleanContent = prompt
        .replace(/^(note:|take note:|write note:|create note:|take a note about|save note)/i, "")
        .trim();

      const title = cleanContent.split("\n")[0].slice(0, 60) || "Note";

      // Match folder
      const matchingFolder = brainState.noteFolders?.find((f) =>
        lower.includes(f.name.toLowerCase())
      );

      const noteItem: KnowledgeItem = {
        id: `note-${Date.now()}`,
        title,
        subject: title,
        content: cleanContent,
        summary: cleanContent.slice(0, 180),
        folderId: matchingFolder?.id || null,
        status: "Synthesized",
        startDate: today,
        endDate: today,
        domain: matchingFolder ? matchingFolder.name : "General",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return {
        actionType: "create_note",
        headline: `Created Note: "${noteItem.title}"`,
        explanation: matchingFolder
          ? `Filed in folder "${matchingFolder.name}"`
          : "Saved to Notes & Vault",
        entityType: "knowledge",
        createdNote: noteItem,
      };
    }

    // 4. Check for Journal / Reflection Intent ("today i felt", "grateful for", "reflection:")
    if (
      lower.startsWith("journal:") ||
      lower.startsWith("reflection:") ||
      lower.includes("today i ") ||
      lower.includes("i feel ") ||
      lower.includes("grateful for") ||
      lower.includes("felt great") ||
      lower.includes("proud of")
    ) {
      const cleanContent = prompt.replace(/^(journal:|reflection:)/i, "").trim();
      const mood = /tired|exhausted|burnout/i.test(lower)
        ? "tired"
        : /stressed|anxious/i.test(lower)
        ? "stressed"
        : /great|ecstatic|pumped|proud|amazing/i.test(lower)
        ? "great"
        : "neutral";

      const entry: JournalEntry = {
        id: `journal-${Date.now()}`,
        date: today,
        title: cleanContent.slice(0, 48) || "Evening Reflection",
        content: cleanContent,
        mood,
        wins: ["Captured mindful reflection"],
        challenges: [],
        tags: ["Reflection"],
      };

      return {
        actionType: "log_journal",
        headline: `Saved Reflection: "${entry.title}"`,
        explanation: `Logged in journal for ${today} (${mood} state)`,
        entityType: "journal",
        createdJournal: entry,
      };
    }

    // 5. Check for Knowledge Query Intent ("what did I decide about...", "what are my tasks...", "?")
    if (
      lower.startsWith("what ") ||
      lower.startsWith("how ") ||
      lower.startsWith("where ") ||
      lower.startsWith("when ") ||
      lower.startsWith("why ") ||
      lower.includes("?") ||
      lower.startsWith("search ")
    ) {
      // Run local semantic search over vector vault
      let matches: any[] = [];
      try {
        matches = await vectorVault.search(prompt, 3);
      } catch {}

      if (matches.length > 0) {
        const top = matches[0];
        const answer = `Based on your second brain records: "${top.chunk.title}" contains relevant context: "${top.chunk.content.slice(0, 180)}..."`;
        return {
          actionType: "query_brain",
          headline: `Vault Synthesis: ${top.chunk.title}`,
          explanation: `Retrieved from ${top.chunk.item_type.toUpperCase()} with ${(top.score * 100).toFixed(0)}% semantic relevance`,
          entityType: "query",
          queryAnswer: answer,
          citations: matches.map((m) => ({
            title: m.chunk.title,
            type: m.chunk.item_type,
            snippet: m.chunk.content.slice(0, 90) + "...",
          })),
        };
      }
    }

    // 6. EXPLICIT Task Creation ONLY:
    // Check if it's explicitly a task (prefixed with "task:", "todo:", "schedule", "add task")
    // OR mentions academic deadlines (exam, quiz, midterm, assignment, hw, lab, paper) with dates
    // OR starts with imperative verbs with a resolved natural date.
    const isExplicitTaskPrefix = /^(task:|todo:|schedule\s+|add task\s+|create task\s+)/i.test(prompt);
    const isAcademicDeadline = /\b(exam|final|midterm|test|quiz|hw|homework|assignment|lab|project submission)\b/i.test(prompt);
    const dateResolution = resolveNaturalDate(prompt);
    const hasResolvedDate = Boolean(dateResolution.dateStr);

    const startsWithImperative = /^(buy|call|email|submit|finish|write|read|study|meet|review|clean|fix|prep|prepare|send|order|pay)\b/i.test(lower);

    if (isExplicitTaskPrefix || isAcademicDeadline || (startsWithImperative && hasResolvedDate)) {
      const dueDate = dateResolution.dateStr || today;
      let rawTitle = dateResolution.cleanedText
        .replace(/^(task:|todo:|schedule\s+|add task\s+|create task\s+)/i, "")
        .trim();
      if (!rawTitle) rawTitle = prompt;

      const taskTitle = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
      const hierarchy = matchSectionHierarchy(prompt, brainState.sections, brainState.subsections);
      const isUrgent = /\b(exam|final|midterm|test|urgent|asap|critical|deadline|today)\b/i.test(prompt);
      const priority = isUrgent ? "urgent" : "high";

      let subtasks: { id: string; title: string; completed: boolean }[] | undefined = undefined;
      if (/\b(exam|test|midterm|final)\b/i.test(prompt)) {
        subtasks = [
          { id: `sub-${Date.now()}-1`, title: "Review lecture slides & core invariant proofs", completed: false },
          { id: `sub-${Date.now()}-2`, title: "Solve practice exam & past problem sets", completed: false },
          { id: `sub-${Date.now()}-3`, title: "Consolidate active recall summary sheet", completed: false },
        ];
      } else if (/\b(project|lab|assignment|paper)\b/i.test(prompt)) {
        subtasks = [
          { id: `sub-${Date.now()}-1`, title: "Outline requirements & edge invariants", completed: false },
          { id: `sub-${Date.now()}-2`, title: "Implement core algorithmic solution", completed: false },
          { id: `sub-${Date.now()}-3`, title: "Run full unit test suite & verify", completed: false },
        ];
      }

      const task: Task = normalizeTask({
        id: `task-${Date.now()}`,
        title: taskTitle,
        dueDate,
        priority,
        section: hierarchy.section,
        subsection: hierarchy.subsection,
        status: "not_started",
        subtasks,
      });

      const relativeLabel = dateResolution.relativeLabel
        ? ` (Due: ${dateResolution.relativeLabel})`
        : ` (Due: ${dueDate})`;

      return {
        actionType: "create_task",
        headline: `Scheduled Task: "${task.title}"`,
        explanation: `Filed into ${task.section} → ${task.subsection}${relativeLabel}`,
        entityType: "task",
        createdTask: task,
      };
    }

    // 7. Fallback for Ambiguous / Open-Ended Input:
    // NEVER auto-create a task! Return helpful conversational guidance.
    return {
      actionType: "query_brain",
      headline: "Thought Captured & Conversational Guidance",
      explanation: "Understood your input. How would you like to handle this?",
      entityType: "query",
      queryAnswer: `I noted your input:\n\n> *"${prompt}"*\n\nTo make this actionable in your Second Brain, you can:\n- **Schedule it as a task**: Say *"Schedule task: ${prompt}"*\n- **Save it as a note**: Say *"Note: ${prompt}"*\n- **Establish a life goal**: Say *"Goal: ${prompt}"*\n- **Plan your week**: Say *"Plan my week: ${prompt}"*`,
    };
  }

  /**
   * High-Fidelity Local Weekly Strategic Planning Engine
   */
  private static generateOfflinePlan(_prompt: string, brainState: BrainState): AgentExecutionResult {
    const pendingTasks = brainState.tasks.filter((t) => !t.completed);
    const academicTasks = pendingTasks.filter((t) =>
      (t.section || "").toLowerCase().includes("acad")
    );
    const careerTasks = pendingTasks.filter(
      (t) =>
        (t.section || "").toLowerCase().includes("career") ||
        (t.section || "").toLowerCase().includes("project")
    );
    const activeGoals = brainState.goals || [];
    const habits = brainState.habits;

    let planText = `## 🗓️ Weekly Strategic Execution Blueprint\n\n`;

    planText += `### 🎯 High-Leverage Academic Priorities\n`;
    if (academicTasks.length > 0) {
      academicTasks.slice(0, 4).forEach((t) => {
        planText += `- **[${t.subsection || "General"}]** ${t.title} *(Due: ${t.dueDate}, Priority: ${t.priority.toUpperCase()})*\n`;
        if (t.subtasks && t.subtasks.length > 0) {
          t.subtasks.forEach((st) => {
            planText += `  - [ ] ${st.title}\n`;
          });
        }
      });
    } else {
      planText += `- *No urgent academic deadlines currently pending. Excellent momentum!*\n`;
    }

    planText += `\n### 💼 Career & Long-Term Growth Horizons\n`;
    if (careerTasks.length > 0 || activeGoals.length > 0) {
      activeGoals.slice(0, 2).forEach((g) => {
        planText += `- **Goal: ${g.title}** (${g.sector.toUpperCase()} - ${g.timeframe})\n  - Why: *"${g.why}"*\n`;
        if (g.milestones && g.milestones.length > 0) {
          g.milestones.slice(0, 3).forEach((m) => {
            planText += `  - [${m.completed ? "x" : " "}] ${m.title}\n`;
          });
        }
      });
      careerTasks.slice(0, 3).forEach((t) => {
        planText += `- **Task**: ${t.title} *(Due: ${t.dueDate})*\n`;
      });
    } else {
      planText += `- *Dedicate a 90-minute deep work block to high-leverage skill building & portfolio architecture.*\n`;
    }

    planText += `\n### ⚡ Daily Habit Anchor System\n`;
    if (habits.length > 0) {
      habits.slice(0, 4).forEach((h) => {
        planText += `- **${h.name}** (Current streak: **${h.streak} days**)\n`;
      });
    } else {
      planText += `- *Maintain non-negotiable morning deep work and recovery habits.*\n`;
    }

    planText += `\n### 🚀 Recommended Daily Focus Blueprint\n`;
    planText += `- **Monday - Tuesday**: Deep focus on critical academic deliverables and highest-priority deadlines.\n`;
    planText += `- **Wednesday - Thursday**: Technical depth, system implementations, and career milestones.\n`;
    planText += `- **Friday - Weekend**: Buffer review, milestone consolidation, and reflective weekly retrospective.\n`;

    return {
      actionType: "query_brain",
      headline: "Weekly Strategic Plan",
      explanation:
        "Synthesized from your active academic courses, career goals, and daily habit streaks",
      entityType: "query",
      queryAnswer: planText,
    };
  }
}

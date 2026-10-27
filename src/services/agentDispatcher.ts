import { BrainState, Task, Goal, Habit, JournalEntry, KnowledgeItem, GoalSector } from "../types";
import { queryOpenRouter } from "./openrouter";
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
   * Enterprise LLM-Powered Agentic Router using Structured JSON Tool-Calling
   */
  private static async executeWithLLM(
    prompt: string,
    brainState: BrainState,
    openRouterKey: string,
    model: string = "anthropic/claude-3.5-sonnet"
  ): Promise<AgentExecutionResult | null> {
    const today = getLocalDateString();
    const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });

    // Lightweight Schema Context Manifest (~120 tokens)
    const contextManifest = {
      todayDate: today,
      todayDayOfWeek: dayOfWeek,
      sectionsSchema: brainState.sections.map((sec) => ({
        section: sec,
        subsections: brainState.subsections[sec] || ["General"],
      })),
      activeHabits: brainState.habits.map((h) => ({ id: h.id, name: h.name })),
      activeGoals: (brainState.goals || []).map((g) => ({ id: g.id, title: g.title, sector: g.sector })),
      recentPendingTasks: brainState.tasks
        .filter((t) => !t.completed)
        .slice(0, 10)
        .map((t) => ({ id: t.id, title: t.title, section: t.section, subsection: t.subsection, dueDate: t.dueDate })),
    };

    const systemPrompt = `You are the Autonomous Executive Agent for Synapse Second Brain OS.
You receive natural language input and must dynamically decide which action to execute inside the user's system.

CURRENT CONTEXT:
Today is ${dayOfWeek}, ${today}.
Registered Sections & Subsections: ${JSON.stringify(contextManifest.sectionsSchema)}
Active Habits: ${JSON.stringify(contextManifest.activeHabits)}
Active Goals: ${JSON.stringify(contextManifest.activeGoals)}
Recent Tasks: ${JSON.stringify(contextManifest.recentPendingTasks)}

YOU CAN EXECUTE ONE OF THESE ACTIONS:
1. "create_task": User wants to schedule or execute something (e.g. "CS 1332 exam next monday", "buy groceries tomorrow").
   - Intelligently assign the right section and subsection from the Registered Sections. If user mentions "CS 1332", put it in Academic / CS 1332!
   - Resolve relative dates (e.g. "next monday" relative to ${today}).
   - Automatically generate 2-3 high-leverage preparation subtasks if appropriate.
2. "update_task": User wants to complete, modify, or reschedule an existing task (e.g. "mark CS 1332 lab as completed").
   - Match existing taskId. Set status to "completed" or change dueDate.
3. "complete_habit": User completed a habit today (e.g. "did my 90m deep work sprint", "drank cold water and worked out").
   - Match habitId.
4. "create_goal": User expresses a major long-term aspiration, wealth target, fitness milestone, or life improvement objective (e.g. "Reach $100k liquid savings by 2028", "Run a half-marathon under 1:45").
   - Sector: "career" | "academics" | "finance" | "health" | "mindset" | "personal".
   - Timeframe: "quarterly" | "yearly" | "long_term" | "lifetime".
   - Generate 3-4 actionable milestones, target metrics, and a "why" statement.
5. "log_journal": User reflects on their day, thoughts, feelings, wins, or mental state (e.g. "Felt super energized after the gym and made good progress").
   - Mood: "ecstatic" | "great" | "neutral" | "tired" | "stressed". Extract wins, challenges, reflection.
6. "query_brain": User asks a question about their notes, state, decisions, or past history (e.g. "What did I decide about Raft consensus?", "What's on my agenda today?").
   - Provide a direct, articulate, insightful executive answer based on context.

RESPOND ONLY WITH VALID JSON matching this exact structure:
{
  "actionType": "create_task" | "update_task" | "complete_habit" | "create_goal" | "log_journal" | "query_brain",
  "headline": "Brief punchy 1-line summary of what you did",
  "explanation": "1-sentence explanation of why you filed or resolved it this way",
  "taskData": {
    "title": "Clean task title without redundant date words",
    "section": "Exact section name from registered list",
    "subsection": "Exact subsection name from registered list",
    "dueDate": "YYYY-MM-DD",
    "priority": "urgent" | "high" | "medium" | "low",
    "subtasks": ["Milestone 1", "Milestone 2"]
  },
  "updateTaskData": {
    "taskId": "id of task to update",
    "status": "completed" | "in_progress" | "not_started"
  },
  "habitData": {
    "habitId": "id of habit to check"
  },
  "goalData": {
    "title": "Clear Goal Title",
    "sector": "career" | "academics" | "finance" | "health" | "mindset" | "personal",
    "timeframe": "quarterly" | "yearly" | "long_term" | "lifetime",
    "targetDate": "YYYY-MM-DD",
    "metrics": "Quantifiable target metric",
    "why": "Core conviction",
    "milestones": ["Milestone 1", "Milestone 2", "Milestone 3"]
  },
  "journalData": {
    "title": "Reflection Title",
    "content": "Full reflection content",
    "mood": "great",
    "wins": ["Win 1"],
    "challenges": []
  },
  "queryAnswer": "Direct intelligent answer if actionType is query_brain"
}`;

    const response = await queryOpenRouter(
      [{ role: "user", content: prompt }],
      openRouterKey,
      model,
      systemPrompt
    );

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const actionType: AgentActionType = parsed.actionType || "create_task";

    if (actionType === "create_task" && parsed.taskData) {
      const td = parsed.taskData;
      const task: Task = normalizeTask({
        id: `task-${Date.now()}`,
        title: td.title || prompt,
        dueDate: td.dueDate || today,
        priority: td.priority || "high",
        section: td.section || brainState.sections[0] || "Academic",
        subsection: td.subsection || "General",
        status: "not_started",
        subtasks: Array.isArray(td.subtasks)
          ? td.subtasks.map((st: string, idx: number) => ({
              id: `sub-${Date.now()}-${idx}`,
              title: st,
              completed: false,
            }))
          : undefined,
      });

      return {
        actionType: "create_task",
        headline: parsed.headline || `Scheduled task: "${task.title}"`,
        explanation: parsed.explanation || `Filed in ${task.section} → ${task.subsection} for ${task.dueDate}`,
        entityType: "task",
        createdTask: task,
      };
    }

    if (actionType === "update_task" && parsed.updateTaskData) {
      const targetTask = brainState.tasks.find((t) => t.id === parsed.updateTaskData.taskId);
      if (targetTask) {
        const updatedTask = setTaskStatus(targetTask, parsed.updateTaskData.status || "completed");
        return {
          actionType: "update_task",
          headline: parsed.headline || `Updated task: "${updatedTask.title}"`,
          explanation: parsed.explanation || `Status changed to ${updatedTask.status}`,
          entityType: "task",
          updatedTask,
        };
      }
    }

    if (actionType === "complete_habit" && parsed.habitData) {
      const habit = brainState.habits.find((h) => h.id === parsed.habitData.habitId);
      if (habit) {
        const updatedHabit = syncHabitStreaks({
          ...habit,
          history: { ...habit.history, [today]: true },
        });
        return {
          actionType: "complete_habit",
          headline: parsed.headline || `Logged Habit: "${habit.name}"`,
          explanation: parsed.explanation || `Streak extended to ${updatedHabit.streak} days!`,
          entityType: "habit",
          updatedHabit,
        };
      }
    }

    if (actionType === "create_goal" && parsed.goalData) {
      const gd = parsed.goalData;
      const goal: Goal = {
        id: `goal-${Date.now()}`,
        title: gd.title || prompt,
        sector: gd.sector || "career",
        timeframe: gd.timeframe || "yearly",
        targetDate: gd.targetDate || undefined,
        metrics: gd.metrics || undefined,
        why: gd.why || "High-leverage life improvement commitment",
        status: "in_progress",
        progress: 0,
        milestones: Array.isArray(gd.milestones)
          ? gd.milestones.map((m: string, idx: number) => ({
              id: `gm-${Date.now()}-${idx}`,
              title: m,
              completed: false,
            }))
          : [],
        createdAt: new Date().toISOString(),
      };

      return {
        actionType: "create_goal",
        headline: parsed.headline || `Established Goal: "${goal.title}"`,
        explanation: parsed.explanation || `Tracked in ${goal.sector.toUpperCase()} (${goal.timeframe} horizon)`,
        entityType: "goal",
        createdGoal: goal,
      };
    }

    if (actionType === "log_journal" && parsed.journalData) {
      const jd = parsed.journalData;
      const entry: JournalEntry = {
        id: `journal-${Date.now()}`,
        date: today,
        title: jd.title || "Daily Reflection",
        content: jd.content || prompt,
        mood: jd.mood || "great",
        wins: jd.wins || [],
        challenges: jd.challenges || [],
        tags: ["AgentCapture"],
      };

      return {
        actionType: "log_journal",
        headline: parsed.headline || `Saved Reflection: "${entry.title}"`,
        explanation: parsed.explanation || `Captured in journal under ${entry.mood} headspace`,
        entityType: "journal",
        createdJournal: entry,
      };
    }

    if (actionType === "query_brain" && parsed.queryAnswer) {
      return {
        actionType: "query_brain",
        headline: parsed.headline || "Knowledge Retrieval & Synthesis",
        explanation: parsed.explanation || "Queried your Second Brain memory vault",
        entityType: "query",
        queryAnswer: parsed.queryAnswer,
      };
    }

    return null;
  }

  /**
   * Deterministic Offline Agent Engine (Zero Network Latency, Instant Intelligence)
   */
  private static async executeLocally(
    prompt: string,
    brainState: BrainState
  ): Promise<AgentExecutionResult> {
    const today = getLocalDateString();
    const lower = prompt.toLowerCase();

    // 1. Check for Habit Completion Intent ("did my 90m sprint", "completed habit", "drank water")
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

    // 6. Default to Intelligent Context-Aware Task Creation
    // (e.g. "CS 1332 exam next monday")
    const dateResolution = resolveNaturalDate(prompt);
    const dueDate = dateResolution.dateStr || today;

    // Remove keywords like "task:", "todo:" from title
    let rawTitle = dateResolution.cleanedText.replace(/^(task:|todo:)\s*/i, "").trim();
    if (!rawTitle) rawTitle = prompt;

    // Capitalize first letter cleanly
    const taskTitle = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);

    // Schema hierarchy matching
    const hierarchy = matchSectionHierarchy(prompt, brainState.sections, brainState.subsections);

    // Urgency detection
    const isUrgent = /\b(exam|final|midterm|test|urgent|asap|critical|deadline|today)\b/i.test(prompt);
    const priority = isUrgent ? "urgent" : "high";

    // Auto-generate prep milestones for exams / projects
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

    const relativeLabel = dateResolution.relativeLabel ? ` (Due: ${dateResolution.relativeLabel})` : ` (Due: ${dueDate})`;

    return {
      actionType: "create_task",
      headline: `Scheduled Task: "${task.title}"`,
      explanation: `Filed into ${task.section} → ${task.subsection}${relativeLabel}`,
      entityType: "task",
      createdTask: task,
    };
  }
}

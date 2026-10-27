import { Task, Habit, JournalEntry, DailyBrief } from "../types";
import { SearchResult } from "./vectorVault";

export const OPENROUTER_MODELS = [
  { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", desc: "Top reasoning, fluid task decomposition" },
  { id: "openai/gpt-4o", name: "GPT-4o", desc: "Balanced intelligence & quick creative thinking" },
  { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash", desc: "Ultra-fast response with high accuracy" },
  { id: "deepseek/deepseek-chat", name: "DeepSeek V3", desc: "Cost-efficient, razor-sharp logic" },
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", desc: "Open-weights powerhouse" },
];

export interface OpenRouterToolFunction {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface OpenRouterTool {
  type: "function";
  function: OpenRouterToolFunction;
}

export interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface OpenRouterCompletionResponse {
  content: string | null;
  toolCalls?: OpenRouterToolCall[];
}

export async function queryOpenRouterWithTools(
  messages: { role: string; content: string }[],
  tools: OpenRouterTool[],
  apiKey: string,
  model: string = "anthropic/claude-3.5-sonnet",
  systemPrompt?: string,
  toolChoice: "auto" | "none" | { type: "function"; function: { name: string } } = "auto"
): Promise<OpenRouterCompletionResponse> {
  if (!apiKey) {
    throw new Error("No OpenRouter API key provided. Please configure it in Settings.");
  }

  const payloadMessages = [];
  if (systemPrompt) {
    payloadMessages.push({ role: "system", content: systemPrompt });
  }
  payloadMessages.push(...messages);

  const bodyPayload: any = {
    model: model || "anthropic/claude-3.5-sonnet",
    messages: payloadMessages,
    temperature: 0.3,
    max_tokens: 2000,
  };

  if (tools && tools.length > 0) {
    bodyPayload.tools = tools;
    bodyPayload.tool_choice = toolChoice;
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://synapse-second-brain.local",
      "X-Title": "Synapse Second Brain",
    },
    body: JSON.stringify(bodyPayload),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody?.error?.message || `OpenRouter Error (HTTP ${res.status})`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const msg = choice?.message;

  let toolCalls: OpenRouterToolCall[] | undefined = undefined;
  if (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0) {
    toolCalls = msg.tool_calls;
  } else if (msg?.function_call) {
    toolCalls = [
      {
        id: `call-${Date.now()}`,
        type: "function",
        function: {
          name: msg.function_call.name,
          arguments: msg.function_call.arguments,
        },
      },
    ];
  }

  return {
    content: msg?.content || null,
    toolCalls,
  };
}

export async function testOpenRouterKey(apiKey: string): Promise<{ success: boolean; message: string }> {
  if (!apiKey || apiKey.trim() === "") {
    return { success: false, message: "Please provide an API key." };
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
      },
    });

    if (res.ok) {
      const data = await res.json();
      const label = data?.data?.label || "User";
      const limit = data?.data?.limit != null ? `$${data.data.limit}` : "Active";
      return { success: true, message: `Connected! Key valid (${label}, limit: ${limit})` };
    } else {
      // If auth/key endpoint is restricted, try a minimal completion
      const testReq = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://synapse-second-brain.local",
          "X-Title": "Synapse Second Brain",
        },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash-001",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        }),
      });

      if (testReq.ok) {
        return { success: true, message: "Connected successfully to OpenRouter!" };
      } else {
        const errorData = await testReq.json().catch(() => ({}));
        return { success: false, message: errorData?.error?.message || `HTTP ${testReq.status}: Unauthorized or Invalid Key` };
      }
    }
  } catch (err: any) {
    return { success: false, message: err.message || "Network error contacting OpenRouter" };
  }
}

export async function queryOpenRouter(
  messages: { role: string; content: string }[],
  apiKey: string,
  model: string = "anthropic/claude-3.5-sonnet",
  systemPrompt?: string
): Promise<string> {
  if (!apiKey) {
    throw new Error("No OpenRouter API key provided. Please configure it in Settings.");
  }

  const payloadMessages = [];
  if (systemPrompt) {
    payloadMessages.push({ role: "system", content: systemPrompt });
  }
  payloadMessages.push(...messages);

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://synapse-second-brain.local",
      "X-Title": "Synapse Second Brain",
    },
    body: JSON.stringify({
      model: model || "anthropic/claude-3.5-sonnet",
      messages: payloadMessages,
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody?.error?.message || `OpenRouter Error (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "No response received.";
}

export async function breakdownTaskWithAI(
  taskTitle: string,
  apiKey: string,
  model: string
): Promise<string[]> {
  const systemPrompt = `You are an elite productivity executive and GTD coach. When given a task title, break it down into 3 to 5 clear, concrete, actionable, sequential subtasks. Return ONLY a valid JSON array of strings, without backticks or markdown formatting. Example: ["Step 1...", "Step 2...", "Step 3..."]`;
  
  const raw = await queryOpenRouter(
    [{ role: "user", content: `Break down this task: "${taskTitle}"` }],
    apiKey,
    model,
    systemPrompt
  );

  try {
    const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.map((s) => String(s));
    }
  } catch {
    // Fallback: split by lines
    return raw
      .split("\n")
      .map((l) => l.replace(/^[-*0-9.]+\s*/, "").trim())
      .filter((l) => l.length > 0)
      .slice(0, 5);
  }

  return ["Clarify objective & requirements", "Execute core deliverable", "Review and verify quality"];
}

export async function synthesizeJournalWithAI(
  entry: JournalEntry,
  completedTasks: Task[],
  habits: Habit[],
  apiKey: string,
  model: string
): Promise<string> {
  const completedToday = completedTasks.filter((t) => t.dueDate === entry.date && t.completed);
  const habitsDone = habits.filter((h) => h.history[entry.date]);

  const contextText = `
Date: ${entry.date}
Journal Title: ${entry.title}
Mood: ${entry.mood}
Journal Entry: ${entry.content}
Wins: ${entry.wins.join(", ") || "None listed"}
Challenges: ${entry.challenges.join(", ") || "None listed"}
Tasks Completed Today: ${completedToday.map((t) => t.title).join(", ") || "None recorded"}
Habits Completed Today: ${habitsDone.map((h) => h.name).join(", ") || "None recorded"}
`;

  const systemPrompt = `You are a compassionate, sharp, and Stoic second-brain cognitive coach. Review the user's daily journal and actions. Provide:
1. **Key Insight**: 2 sentences analyzing the user's emotional & execution state.
2. **Patterns & Wins**: What went well and why it matters.
3. **Calibrated Action for Tomorrow**: One concrete mindset or operational tweak for tomorrow.
Keep the tone encouraging, concise, and deeply actionable. Format in clean markdown with bold points.`;

  return queryOpenRouter(
    [{ role: "user", content: `Please review my day and provide your second-brain synthesis:\n${contextText}` }],
    apiKey,
    model,
    systemPrompt
  );
}

export async function chatWithSecondBrain(
  query: string,
  allTasks: Task[],
  allHabits: Habit[],
  recentJournals: JournalEntry[],
  apiKey: string,
  model: string,
  chatHistory: { role: string; content: string }[],
  relevantMemories?: SearchResult[]
): Promise<string> {
  const pendingTasks = allTasks.filter((t) => !t.completed);
  const overdueTasks = allTasks.filter((t) => !t.completed && new Date(t.dueDate) < new Date());

  let ragContext = "";
  if (relevantMemories && relevantMemories.length > 0) {
    ragContext = `\n\n=== RETRIEVED HISTORICAL MEMORIES FROM YOUR SECOND BRAIN VAULT (RAG) ===\nThe following relevant past decisions, journal reflections, knowledge notes, and completed tasks were semantically retrieved from the user's vector vault based on this question:\n` +
      relevantMemories.map((m, idx) => {
        const pct = Math.round(m.score * 100);
        const dateStr = m.chunk.date ? ` | Date: ${m.chunk.date}` : "";
        return `[Memory #${idx + 1} - ${m.chunk.item_type.toUpperCase()}${dateStr} (Relevance: ${pct}%)]\nTitle: "${m.chunk.title}"\nContent: ${m.chunk.content}\n`;
      }).join("\n") +
      `\nWhen the user asks about previous decisions, thoughts, or past events (e.g. "what did I decide about X last month?"), use these retrieved memories to provide accurate, grounded answers citing dates and context.`;
  }

  const systemPrompt = `You are "Synapse", an ultra-intelligent AI Second Brain native desktop companion with a Semantic Memory Vault.
You have direct read access to the user's life operating system:
- Current Pending Tasks (${pendingTasks.length}): ${pendingTasks.slice(0, 10).map((t) => `• [${t.priority.toUpperCase()}] ${t.title} (Due: ${t.dueDate})`).join("\n")}
- Overdue Tasks: ${overdueTasks.length > 0 ? overdueTasks.map((t) => t.title).join(", ") : "None! Outstanding work!"}
- Habits tracked (${allHabits.length}): ${allHabits.map((h) => `${h.name} (Streak: ${h.streak}d)`).join(", ")}
- Latest Journal Entry: ${recentJournals[0] ? `"${recentJournals[0].title}" (Mood: ${recentJournals[0].mood})` : "None yet"}${ragContext}

Help the user think clearly, prioritize ruthlessly, recall past decisions and notes, organize tasks, reflect deeply, and maintain their daily habits. Speak with confidence, empathy, and intellectual sharpness. Format answers nicely with markdown lists and bold headers when helpful.`;

  const historyWithNew = [...chatHistory, { role: "user", content: query }];
  return queryOpenRouter(historyWithNew, apiKey, model, systemPrompt);
}

/**
 * Intelligent AI Quick Capture Auto-Classifier:
 * Parses raw text/voice/URL input and automatically determines entity type, structured attributes.
 */
export async function autoClassifyWithAI(
  rawInput: string,
  apiKey: string,
  model: string = "google/gemini-2.0-flash-001"
): Promise<{
  type: "task" | "knowledge" | "journal" | "habit";
  title: string;
  dueDate?: string;
  priority?: "urgent" | "high" | "medium" | "low";
  section?: string;
  mood?: "ecstatic" | "great" | "neutral" | "tired" | "stressed";
  frequency?: "daily" | "weekdays" | "weekends";
  tags?: string[];
  notes?: string;
}> {
  const today = new Date().toISOString().split("T")[0];
  const systemPrompt = `You are a precision parser for an AI Second Brain quick capture system. Today is ${today}.
Analyze the user's quick thought, task, journal snippet, URL, or habit.
Classify it into ONE of:
- "task": An actionable todo or errand.
- "knowledge": An informational note, book insight, bookmark, research summary, or article link.
- "journal": A personal reflection, mood check-in, wins, challenges, or emotional thought.
- "habit": A recurring routine or daily/weekly behavior to build.

Return ONLY a valid JSON object with:
{
  "type": "task" | "knowledge" | "journal" | "habit",
  "title": "Clean, concise title",
  "dueDate": "YYYY-MM-DD" (if applicable, else omit),
  "priority": "urgent" | "high" | "medium" | "low" (if task),
  "section": "Academic" | "Career" | "Health" | "Finance" | "Personal",
  "mood": "ecstatic" | "great" | "neutral" | "tired" | "stressed" (if journal),
  "frequency": "daily" | "weekdays" | "weekends" (if habit),
  "tags": ["tag1", "tag2"],
  "notes": "additional context or description"
}
Do NOT include markdown formatting or backticks. Return raw JSON only.`;

  try {
    const raw = await queryOpenRouter(
      [{ role: "user", content: rawInput }],
      apiKey,
      model,
      systemPrompt
    );

    const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && parsed.type && parsed.title) {
      return parsed;
    }
  } catch {}

  // Fallback heuristic classification
  const lower = rawInput.toLowerCase();
  const isUrl = /https?:\/\//i.test(rawInput);
  const isHabit = /\b(daily|every day|routine|streak|workout|meditate|drink water)\b/i.test(lower);
  const isJournal = /\b(felt|feeling|today was|grateful|mood|tired|stressed|proud|wins|reflection)\b/i.test(lower);

  let type: "task" | "knowledge" | "journal" | "habit" = "task";
  if (isUrl) type = "knowledge";
  else if (isHabit) type = "habit";
  else if (isJournal) type = "journal";

  return {
    type,
    title: rawInput.slice(0, 80).trim(),
    priority: "medium",
    section: "Academic",
    notes: rawInput,
  };
}

/**
 * AI-Enhanced Daily Executive Briefing Generator:
 * Generates an executive morning briefing analyzing today's tasks, streaks, and reflections.
 */
export async function generateDailyBriefWithAI(
  tasks: Task[],
  habits: Habit[],
  recentJournals: JournalEntry[],
  apiKey?: string,
  model: string = "google/gemini-2.0-flash-001"
): Promise<DailyBrief> {
  const today = new Date().toISOString().split("T")[0];
  const pendingTasks = tasks.filter((t) => !t.completed);
  const dueTodayTasks = tasks.filter((t) => !t.completed && t.dueDate === today);
  const overdueTasks = tasks.filter((t) => !t.completed && t.dueDate && t.dueDate < today);
  const urgentTasks = tasks.filter((t) => !t.completed && (t.priority === "urgent" || t.priority === "high"));
  const activeHabits = habits.filter((h) => h.streak > 0);
  const latestJournal = recentJournals[0];

  // Try OpenRouter AI generation if API key is present
  if (apiKey && apiKey.trim() !== "") {
    const contextPrompt = `
Today is: ${today}
Pending Tasks Count: ${pendingTasks.length}
Overdue Tasks (${overdueTasks.length}): ${overdueTasks.map((t) => `• [${t.priority.toUpperCase()}] ${t.title}`).join("; ") || "None"}
Due Today (${dueTodayTasks.length}): ${dueTodayTasks.map((t) => `• [${t.priority.toUpperCase()}] ${t.title} (${t.section})`).join("; ") || "None"}
High Priority Pool: ${urgentTasks.slice(0, 5).map((t) => t.title).join(", ") || "None"}
Habits Active: ${activeHabits.map((h) => `${h.name} (${h.streak}d streak)`).join(", ") || "None yet"}
Recent Journal Mood: ${latestJournal ? `"${latestJournal.mood}" - ${latestJournal.title}` : "None"}
`;

    const systemPrompt = `You are the chief executive cognitive officer of an elite second brain system.
Generate a sharp, energizing, modern daily executive morning brief.
Return ONLY valid JSON matching this schema:
{
  "headline": "A bold, punchy, high-conviction 1-sentence headline for today",
  "summary": "2-3 sentences of executive briefing synthesizing today's battleground, focus, and trade-offs.",
  "topPriorities": [
    { "title": "Top Task Title", "reason": "1-sentence why this moves the needle today" }
  ],
  "mindsetDirective": "A Stoic, sharp mental model or operational focus for today",
  "energyAdvice": "Clear advice on managing peak focus blocks vs recovery today"
}
Do NOT return markdown backticks. Return raw JSON only. Limit topPriorities to exactly 3 items.`;

    try {
      const raw = await queryOpenRouter(
        [{ role: "user", content: `Generate today's executive brief:\n${contextPrompt}` }],
        apiKey,
        model,
        systemPrompt
      );

      const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (parsed && parsed.headline && parsed.summary) {
        return {
          date: today,
          generatedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          headline: parsed.headline,
          summary: parsed.summary,
          topPriorities: Array.isArray(parsed.topPriorities) ? parsed.topPriorities.slice(0, 3) : [],
          mindsetDirective: parsed.mindsetDirective || "Prioritize ruthlessly. Focus on leverage over volume.",
          energyAdvice: parsed.energyAdvice || "Tackle cognitive-heavy tasks before noon; defer administrative items.",
        };
      }
    } catch (e) {
      console.warn("AI Daily Brief generation fallback:", e);
    }
  }

  // Algorithmic Fallback Synthesis (100% offline, instant)
  const candidateTasks = [
    ...overdueTasks,
    ...dueTodayTasks,
    ...urgentTasks,
    ...pendingTasks,
  ];
  // Deduplicate candidates
  const seenIds = new Set<string>();
  const top3 = candidateTasks.filter((t) => {
    if (seenIds.has(t.id)) return false;
    seenIds.add(t.id);
    return true;
  }).slice(0, 3);

  const topPriorities = top3.map((t) => ({
    id: t.id,
    title: t.title,
    reason: t.dueDate === today
      ? "Due today — high immediate leverage."
      : t.dueDate && t.dueDate < today
      ? "Overdue — clear this bottleneck first."
      : `High leverage in ${t.section}.`,
  }));

  const headline = overdueTasks.length > 0
    ? `Eliminate the ${overdueTasks[0].title.slice(0, 32)} bottleneck early to seize momentum.`
    : dueTodayTasks.length > 0
    ? `Execute ${dueTodayTasks[0].title.slice(0, 30)} with deep focus before midday.`
    : `High clarity day: ${pendingTasks.length} pending objectives mapped across your Life OS.`;

  const summary = `You have ${dueTodayTasks.length} objectives scheduled for today and ${overdueTasks.length} items needing attention. Your habit streaks (${activeHabits.length} currently active) show solid momentum. Guard your deep-work window.`;

  return {
    date: today,
    generatedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    headline,
    summary,
    topPriorities: topPriorities.length > 0 ? topPriorities : [
      { title: "Define top objective for today", reason: "Clarify leverage" },
    ],
    mindsetDirective: "Speed of execution beats perfection of planning. Move the needle on the hardest task first.",
    energyAdvice: "Schedule a 90-minute unbroken block this morning. Hydrate early and shut off shallow notifications.",
  };
}

/**
 * Breaks down a high-level life goal into 4-5 measurable milestones and a target metric.
 * Works both with OpenRouter AI or with intelligent offline heuristics.
 */
export async function breakdownGoalWithAI(
  goalTitle: string,
  sector: string,
  timeframe?: string,
  why?: string,
  apiKey?: string,
  model?: string
): Promise<{ milestones: string[]; metrics?: string; advice?: string }> {
  if (apiKey && apiKey.trim() !== "") {
    try {
      const prompt = `You are an elite executive life coach and strategic systems thinker.
Break down this long-term life goal into 4-5 actionable, high-leverage milestones, a concrete target metric, and 1 sentence of strategic advice.

Goal: "${goalTitle}"
Sector: ${sector}
Timeframe: ${timeframe || "yearly"}
Why: ${why || "Long-term self-improvement and life mastery"}

Respond ONLY with valid JSON in this exact structure:
{
  "milestones": ["Milestone 1", "Milestone 2", "Milestone 3", "Milestone 4"],
  "metrics": "Clear quantifiable target metric",
  "advice": "1 concise sentence of strategic advice"
}`;

      const response = await queryOpenRouter(
        [{ role: "user", content: prompt }],
        apiKey,
        model || "anthropic/claude-3.5-sonnet"
      );

      // Extract JSON block
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.milestones) && parsed.milestones.length > 0) {
          return {
            milestones: parsed.milestones.map((m: any) => String(m).trim()),
            metrics: parsed.metrics ? String(parsed.metrics) : undefined,
            advice: parsed.advice ? String(parsed.advice) : undefined,
          };
        }
      }
    } catch (e) {
      console.warn("AI Goal breakdown failed, using strategic heuristic fallback:", e);
    }
  }

  // Strategic Sector Heuristic Fallback (offline / instant)
  const sectorLower = sector.toLowerCase();
  if (sectorLower.includes("career")) {
    return {
      milestones: [
        `Audit current skill stack & map core competencies needed for "${goalTitle}"`,
        `Build & publish a portfolio-grade project showcasing advanced system design`,
        `Conduct 10 informational interviews with leaders currently at this level`,
        `Deliver high-leverage organizational outcome with measurable ROI`,
      ],
      metrics: "L5/L6 caliber technical achievement + 15 peer endorsements",
      advice: "Focus on asymmetric output and public proof of work rather than routine activity.",
    };
  } else if (sectorLower.includes("academic")) {
    return {
      milestones: [
        `Outline master syllabus and break weekly readings into 90m deep work blocks`,
        `Build active-recall flashcard vault and solve past exam problem sets`,
        `Establish weekly office hour relationship with principal faculty`,
        `Complete capstone synthesis project or honors research paper`,
      ],
      metrics: "3.9+ GPA / Top 5% cohort ranking",
      advice: "Active testing and spaced retrieval outperform passive re-reading 3:1.",
    };
  } else if (sectorLower.includes("finance")) {
    return {
      milestones: [
        `Calculate exact monthly burn rate and optimize recurring fixed overheads`,
        `Automate dollar-cost averaging into low-expense diversified index funds`,
        `Build a dedicated 6-month liquid emergency runway in high-yield cash`,
        `Launch or scale a high-margin secondary cash-flow stream`,
      ],
      metrics: "Maintain >40% net savings rate & hit capital milestone",
      advice: "Wealth is what you do not spend; automate deposits before discretionary spending.",
    };
  } else if (sectorLower.includes("health")) {
    return {
      milestones: [
        `Standardize 8-hour sleep window with consistent circadian light exposure`,
        `Execute 4 progressive resistance training sessions weekly with logged volume`,
        `Achieve target daily protein intake (1g/lb) and eliminate processed sugars`,
        `Hit benchmark conditioning test (e.g. 5k/10k time or body composition target)`,
      ],
      metrics: "Resting HR <58 bpm, peak VO2 max, 4-streak workout compliance",
      advice: "Consistency of habit execution compounds exponentially faster than intensity spikes.",
    };
  } else {
    return {
      milestones: [
        `Define clear non-negotiable weekly ritual supporting "${goalTitle}"`,
        `Track daily lead indicators in second brain for 30 consecutive days`,
        `Conduct mid-point retrospective and eliminate top 2 friction points`,
        `Finalize execution sprint and celebrate achievement with mentor or peers`,
      ],
      metrics: "90% 90-day execution consistency score",
      advice: "Design your physical and digital environment so failure requires more effort than success.",
    };
  }
}

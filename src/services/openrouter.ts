import { Task, Habit, JournalEntry } from "../types";

export const OPENROUTER_MODELS = [
  { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", desc: "Top reasoning, fluid task decomposition" },
  { id: "openai/gpt-4o", name: "GPT-4o", desc: "Balanced intelligence & quick creative thinking" },
  { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash", desc: "Ultra-fast response with high accuracy" },
  { id: "deepseek/deepseek-chat", name: "DeepSeek V3", desc: "Cost-efficient, razor-sharp logic" },
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", desc: "Open-weights powerhouse" },
];

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
  chatHistory: { role: string; content: string }[]
): Promise<string> {
  const pendingTasks = allTasks.filter((t) => !t.completed);
  const overdueTasks = allTasks.filter((t) => !t.completed && new Date(t.dueDate) < new Date());

  const systemPrompt = `You are "Synapse", an ultra-intelligent AI Second Brain native desktop companion.
You have direct read access to the user's life operating system:
- Current Pending Tasks (${pendingTasks.length}): ${pendingTasks.slice(0, 10).map((t) => `• [${t.priority.toUpperCase()}] ${t.title} (Due: ${t.dueDate})`).join("\n")}
- Overdue Tasks: ${overdueTasks.length > 0 ? overdueTasks.map((t) => t.title).join(", ") : "None! Outstanding work!"}
- Habits tracked (${allHabits.length}): ${allHabits.map((h) => `${h.name} (Streak: ${h.streak}d)`).join(", ")}
- Latest Journal Entry: ${recentJournals[0] ? `"${recentJournals[0].title}" (Mood: ${recentJournals[0].mood})` : "None yet"}

Help the user think clearly, prioritize ruthlessly, organize tasks, reflect deeply, and maintain their daily habits. Speak with confidence, empathy, and intellectual sharpness. Format answers nicely with markdown lists and bold headers when helpful.`;

  const historyWithNew = [...chatHistory, { role: "user", content: query }];
  return queryOpenRouter(historyWithNew, apiKey, model, systemPrompt);
}

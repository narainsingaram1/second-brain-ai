import type { BrainState, Task } from "../types";
import { activeMemories, isSensitiveMemory, normalizeAgentMemory } from "./agentMemory";
import { FAST_MODEL, queryOpenRouterWithTools, type OpenRouterTool } from "./openrouter";
import { conversationTitle } from "../utils/chatPresentation";
import { getLocalDateString } from "../utils/habitStreaks";
import { formatPercent, summarize } from "../utils/grades";
import { courseLabel, courseTasks, dueCards, studyOf } from "../utils/study";
import { field } from "../utils/workspaces";

/**
 * What the chat offers next: quick replies written from the exchange that just happened, and conversation
 * starters written from the user's own work. Both come from the fast model after the fact, so they never
 * delay a reply, and quietly disappear if it fails.
 */
export const STARTER_KINDS = ["task", "class", "goal", "career", "habit", "calendar", "email", "idea"] as const;
export type StarterKind = typeof STARTER_KINDS[number];
export interface ChatStarter { kind: StarterKind; title: string; detail: string; prompt: string }
export interface ConnectedServices { calendar: boolean; gmail: boolean }

const STARTER_COUNT = 4;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const clean = (value: unknown, max: number) => {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").replace(/^["'“”]+|["'“”]+$/g, "").trim();
  return text.length > max ? "" : text;
};
const isOpen = (t: Task) => t.status !== "completed" && !t.completed;
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return getLocalDateString(d);
};
const dayLabel = (date: string, today: string) => {
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  const d = new Date(`${date}T12:00:00`);
  return date <= addDays(today, 6) ? d.toLocaleDateString(undefined, { weekday: "long" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const byDue = (a: Task, b: Task) => a.dueDate.localeCompare(b.dueDate) || (a.dueTime || "99").localeCompare(b.dueTime || "99");

/** Starters from plain rules: shown instantly, and whenever the model is unavailable. */
export function localStarters(state: BrainState, services: ConnectedServices = { calendar: false, gmail: false }, today = getLocalDateString()): ChatStarter[] {
  const open = state.tasks.filter(t => isOpen(t) && t.dueDate);
  const overdue = open.filter(t => t.dueDate < today).sort(byDue);
  const upcoming = open.filter(t => t.dueDate >= today).sort(byDue);
  const study = studyOf(state);
  const picks: ChatStarter[] = [];

  if (overdue.length === 1) picks.push({ kind: "task", title: `Finish ${clip(overdue[0].title, 36)}`, detail: `Overdue since ${dayLabel(overdue[0].dueDate, today)}`, prompt: `"${overdue[0].title}" is overdue. Help me either finish it now or pick a realistic new date.` });
  if (overdue.length > 1) picks.push({ kind: "task", title: `Catch up on ${overdue.length} overdue tasks`, detail: `Starting with ${clip(overdue[0].title, 30)}`, prompt: "Look at my overdue tasks and help me decide what to finish, what to reschedule and what to drop." });
  if (upcoming[0]) picks.push({ kind: "task", title: `Get ahead on ${clip(upcoming[0].title, 32)}`, detail: `Due ${dayLabel(upcoming[0].dueDate, today)}`, prompt: `Help me get started on "${upcoming[0].title}". Break it into steps I can finish before it's due.` });

  const courses = study.courses.map(course => ({
    course, cards: study.decks.filter(d => d.courseId === course.id).reduce((n, d) => n + dueCards(d, today).length, 0),
    grade: course.grading?.categories.length ? summarize(course.grading).current : null,
  }));
  const withCards = [...courses].sort((a, b) => b.cards - a.cards)[0];
  if (withCards?.cards) picks.push({ kind: "class", title: `Review ${withCards.course.code || withCards.course.name}`, detail: `${withCards.cards} flashcards due`, prompt: `Quiz me on the flashcards due in ${courseLabel(withCards.course)}, one at a time.` });
  const graded = courses.find(c => c.grade !== null);
  if (graded) picks.push({ kind: "class", title: `Where I stand in ${graded.course.code || graded.course.name}`, detail: `Currently ${formatPercent(graded.grade)}`, prompt: `Look at my grades in ${courseLabel(graded.course)}. What do I need on the remaining work, and what should I focus on?` });

  const goal = (state.goals || []).filter(g => g.status !== "achieved" && g.status !== "on_hold").sort((a, b) => a.progress - b.progress)[0];
  if (goal) picks.push({ kind: "goal", title: `Move ${clip(goal.title, 34)} forward`, detail: `${goal.progress}% of the way there`, prompt: `Look at my goal "${goal.title}" and tell me the single most useful next step this week.` });

  const followUp = (state.trackerItems || []).filter(i => i.kind === "job_application" && field(i, "followUpDate") && field(i, "followUpDate") <= today && !["offer", "rejected", "not_started"].includes(i.status))[0];
  if (followUp) picks.push({ kind: "career", title: `Follow up with ${clip(followUp.subject || followUp.title, 30)}`, detail: "Follow-up is due", prompt: `Help me write a short follow-up for my ${followUp.title} application at ${followUp.subject}.` });
  const reviews = (state.trackerItems || []).filter(i => i.kind === "leetcode" && field(i, "nextReview") && field(i, "nextReview") <= today);
  if (reviews.length) picks.push({ kind: "career", title: `Revisit ${clip(reviews[0].title, 34)}`, detail: reviews.length > 1 ? `${reviews.length} problems up for review` : "Up for review", prompt: `Walk me through re-solving "${reviews[0].title}" without giving the answer away.` });

  const events = (state.events || []).filter(e => e.date === today);
  if (events.length || services.calendar) picks.push({ kind: "calendar", title: events.length === 1 ? `Prep for ${clip(events[0].title, 34)}` : "Map out my week", detail: events.length ? `${events.length === 1 ? "Today" : `${events.length} events today`}` : "Calendar and deadlines", prompt: events.length === 1 ? `Help me prepare for "${events[0].title}" today.` : "Look at my calendar and deadlines this week. Point out the busy days and free blocks for deep work." });
  if (services.gmail) picks.push({ kind: "email", title: "Triage my inbox", detail: "What needs a reply or a task", prompt: "Triage my unread email from the last 3 days: what needs a reply, what has a deadline, and what can wait." });

  const lastChat = (state.conversations || []).find(t => t.messages.some(m => m.role === "user"));
  if (lastChat) picks.push({ kind: "idea", title: `Back to ${clip(conversationTitle(lastChat.messages), 34)}`, detail: "Your last conversation", prompt: `Let's pick up where we left off on: ${conversationTitle(lastChat.messages)}` });

  if (picks.length < STARTER_COUNT) picks.push(
    { kind: "class", title: "Add my classes", detail: "Materials, flashcards and grades", prompt: "I want to set up my classes. Ask me what I'm taking this term and add them." },
    { kind: "goal", title: "Set a goal for this term", detail: "Turned into real milestones", prompt: "Help me set one meaningful goal for this term and break it into milestones." },
    { kind: "task", title: "Empty my head", detail: "I'll sort it into tasks", prompt: "I want to do a brain dump. Ask me what's on my mind, then turn it into tasks." },
  );
  // Variety first: one per kind, then fill any remaining slots in order.
  const seen = new Set<StarterKind>();
  const first = picks.filter(p => !seen.has(p.kind) && seen.add(p.kind));
  return [...first, ...picks.filter(p => !first.includes(p))].slice(0, STARTER_COUNT);
}

/** A small, bounded picture of what the user has going on. Nothing sensitive, because starters sit on screen. */
export function starterContext(state: BrainState, services: ConnectedServices, now = new Date()) {
  const today = getLocalDateString(now);
  const open = state.tasks.filter(t => isOpen(t) && t.dueDate);
  const task = (t: Task) => ({ title: clip(t.title, 80), due: dayLabel(t.dueDate, today), area: t.subsection && t.subsection !== "General" ? t.subsection : t.section, priority: t.priority });
  const study = studyOf(state);
  const memory = normalizeAgentMemory(state.agentMemory);
  return {
    now: now.toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric" }),
    overdue: open.filter(t => t.dueDate < today).sort(byDue).slice(0, 6).map(task),
    dueSoon: open.filter(t => t.dueDate >= today && t.dueDate <= addDays(today, 7)).sort(byDue).slice(0, 10).map(task),
    events: (state.events || []).filter(e => e.date >= today && e.date <= addDays(today, 3)).slice(0, 8).map(e => ({ title: clip(e.title, 70), day: dayLabel(e.date, today), time: e.startTime })),
    classes: study.courses.slice(0, 8).map(c => ({
      name: courseLabel(c), openTasks: courseTasks(state, c).filter(isOpen).length, documents: study.documents.filter(d => d.courseId === c.id).length,
      flashcardsDue: study.decks.filter(d => d.courseId === c.id).reduce((n, d) => n + dueCards(d, today).length, 0),
      ...(c.grading?.categories.length ? { grade: formatPercent(summarize(c.grading).current) } : {}),
    })),
    goals: (state.goals || []).filter(g => g.status !== "achieved").slice(0, 8).map(g => ({ title: clip(g.title, 80), progress: g.progress, nextMilestone: g.milestones.find(m => !m.completed)?.title })),
    habits: (state.habits || []).slice(0, 6).map(h => ({ name: h.name, streak: h.streak, doneToday: !!h.history[today] })),
    jobSearch: (state.trackerItems || []).filter(i => i.kind === "job_application" && ["applied", "screening", "onsite"].includes(i.status)).slice(0, 6).map(i => ({ role: clip(i.title, 60), company: i.subject, stage: i.status })),
    recentNotes: [...(state.knowledgeItems || [])].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, 5).map(n => clip(n.title || n.subject, 70)),
    recentChats: (state.conversations || []).filter(t => t.messages.some(m => m.role === "user")).slice(0, 6).map(t => clip(conversationTitle(t.messages), 70)),
    aboutThem: memory.enabled ? activeMemories(memory).filter(m => !isSensitiveMemory(`${m.topic} ${m.content}`)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12).map(m => clip(m.content, 140)) : [],
    connected: services,
  };
}

/** Starters are worth rewriting when what's coming up changes, not on every small edit. */
export function starterFingerprint(state: BrainState, today = getLocalDateString()) {
  const horizon = addDays(today, 7);
  const tasks = state.tasks.filter(t => isOpen(t) && t.dueDate && t.dueDate <= horizon).map(t => t.id).sort();
  return [today, ...tasks, ...(state.goals || []).map(g => g.id).sort(), ...studyOf(state).courses.map(c => c.id).sort()].join("|");
}

const STARTERS_PROMPT = `You write the conversation starters on the home screen of a personal second-brain assistant called Iris. Given a snapshot of one user's life, propose exactly ${STARTER_COUNT} starters they would actually want to tap right now.

Rules:
- Each one must be about something real and named in the snapshot: a specific assignment, class, goal, company, note or past conversation. Never invent anything.
- Cover different parts of their life. Combine what is urgent with something longer term, and at least one that is more interesting than a to-do: a connection between two things they're doing, a question their recent chats raise, or something their goals imply.
- Prefer what makes sense at this time of day and this point in their week.
- title: 2 to 6 words, specific, like "Prep for the CS 2110 lab". Not generic, like "Plan my day".
- detail: under 7 words, why this matters now, like "Due tomorrow at 5 PM".
- prompt: the complete first message, in the user's voice, specific enough for Iris to act on immediately. One or two sentences. Iris can read and change all their records, search the web and read their course materials.
- kind: the closest of ${STARTER_KINDS.join(", ")}.
- Plain, warm wording. No emoji, no exclamation marks.`;

const startersTool: OpenRouterTool = {
  type: "function",
  function: {
    name: "suggest_starters",
    description: "Record the conversation starters.",
    parameters: {
      type: "object",
      properties: { starters: { type: "array", items: { type: "object", properties: {
        kind: { type: "string", enum: [...STARTER_KINDS] }, title: { type: "string" }, detail: { type: "string" }, prompt: { type: "string" },
      }, required: ["kind", "title", "detail", "prompt"] } } },
      required: ["starters"],
    },
  },
};

export function parseStarters(raw: unknown): ChatStarter[] {
  if (!Array.isArray(raw)) return [];
  const starters: ChatStarter[] = [];
  for (const item of raw) {
    const title = clean(item?.title, 60), detail = clean(item?.detail, 60), prompt = clean(item?.prompt, 400);
    if (!title || !detail || !prompt || starters.some(s => s.title.toLowerCase() === title.toLowerCase())) continue;
    starters.push({ kind: STARTER_KINDS.includes(item.kind) ? item.kind : "idea", title, detail: detail.replace(/\.$/, ""), prompt });
  }
  return starters.slice(0, STARTER_COUNT);
}

async function askFast<T>(state: BrainState, system: string, payload: unknown, tool: OpenRouterTool, maxTokens: number, signal: AbortSignal, read: (args: Record<string, unknown>) => T): Promise<T | null> {
  const key = state.openRouterKey?.trim();
  if (!key) return null;
  const completion = await queryOpenRouterWithTools([{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }], [tool], key, FAST_MODEL, undefined,
    { type: "function", function: { name: tool.function.name } }, signal, { temperature: 0.6, maxTokens });
  const call = completion.toolCalls?.find(t => t.function.name === tool.function.name);
  if (!call) return null;
  try { return read(JSON.parse(call.function.arguments)); } catch { return null; }
}

export async function generateStarters(state: BrainState, services: ConnectedServices, signal: AbortSignal): Promise<ChatStarter[]> {
  const starters = await askFast(state, STARTERS_PROMPT, starterContext(state, services), startersTool, 900, signal, args => parseStarters(args.starters));
  return starters && starters.length === STARTER_COUNT ? starters : [];
}

const FOLLOW_UPS_PROMPT = `You write the quick replies shown under an assistant's answer in a personal second-brain app (tasks, goals, notes, courses, calendar, job search). Propose exactly 3 messages this user would most plausibly send next.

Rules:
- Write as the user, the exact words they would send: "Make it due Friday", never "Would you like to set a date?".
- Ground each one in this exchange, using its specific names, dates and topics.
- Take three different directions: act on what just happened, go deeper, or connect it to something related.
- If the assistant asked a question, at least two must be direct, specific answers to it.
- If the assistant just changed something, offer a refinement of that change (a date, priority, breaking it into steps) and a natural next move.
- Only suggest what the assistant can do: read and change the user's records, search the web, read their course materials, plan, explain, draft.
- 3 to 9 words each. No trailing period, no emoji.
- Never write filler like "Tell me more", "Thanks", "Explain further" or "What else can you do", and never repeat what the user already asked.`;

const followUpsTool: OpenRouterTool = {
  type: "function",
  function: {
    name: "suggest_follow_ups",
    description: "Record the suggested next messages.",
    parameters: { type: "object", properties: { followUps: { type: "array", items: { type: "string" } } }, required: ["followUps"] },
  },
};

const FILLER = /^(tell me more|thanks?( you)?|thank you|ok(ay)?|explain( further| more)?|what else can you do|continue|go on)\b[.!?]*$/i;
export function parseFollowUps(raw: unknown, alreadyAsked: string[] = []): string[] {
  if (!Array.isArray(raw)) return [];
  const asked = new Set(alreadyAsked.map(q => q.trim().toLowerCase()));
  const items: string[] = [];
  for (const item of raw) {
    const text = clean(item, 80).replace(/\.$/, "");
    if (!text || FILLER.test(text) || asked.has(text.toLowerCase()) || items.some(i => i.toLowerCase() === text.toLowerCase())) continue;
    items.push(text);
  }
  return items.slice(0, 3);
}

export interface FollowUpTurn { question: string; answer: string; earlierQuestions: string[]; changes: string[] }
export async function generateFollowUps(state: BrainState, turn: FollowUpTurn, signal: AbortSignal): Promise<string[]> {
  const payload = { earlierQuestions: turn.earlierQuestions.slice(-3).map(q => clip(q, 160)), question: clip(turn.question, 800), answer: clip(turn.answer, 1800), changesMade: turn.changes.slice(0, 8) };
  return await askFast(state, FOLLOW_UPS_PROMPT, payload, followUpsTool, 250, signal, args => parseFollowUps(args.followUps, [turn.question, ...turn.earlierQuestions])) || [];
}

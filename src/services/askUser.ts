import type { OpenRouterTool } from "./openrouter";

/**
 * Asking the user mid-task. The turn pauses on a card in the chat (choices to tap, or a short typed answer)
 * and carries on with the answers, so open tabs and progress stay as they are. Offered only where someone can
 * answer live (turns run in the app); elsewhere the model asks in its reply.
 */
export const ASK_TOOL_NAME = "ask_user";
const MAX_QUESTIONS = 5;
const MAX_CHOICES = 8;

export interface UserQuestion {
  id: string;
  question: string;
  /** Options to tap. The user can always type something else instead. */
  choices?: string[];
  /** More than one choice may be picked. */
  multiple?: boolean;
  /** A hint in the text box, e.g. "(555) 123-4567". */
  placeholder?: string;
}
export interface UserQuestionRequest {
  id: string;
  /** What the questions are for, e.g. "For your Airbnb application". */
  context?: string;
  questions: UserQuestion[];
}
/** Answers by question id. A question the user skipped has no entry. */
export type UserAnswers = Record<string, string>;

export const ASK_TOOL: OpenRouterTool = { type: "function", function: {
  name: ASK_TOOL_NAME,
  description: "Ask the user and wait for the answer here in the chat, then carry on in this same turn: your open tabs and progress stay exactly as they are. Use it whenever you can't continue without something only the user knows: a form question you can't answer from their memory, profile or résumé, which of several things they mean, a choice between options. Prefer it over guessing, and over ending your reply with a question while work is half done. Put every question you have at this point in one call. Give choices when the answer is one of a few options (copy a form's options exactly); leave them out for a short typed answer. Never ask for passwords, card numbers or one-time codes: the user types those on the page.",
  parameters: { type: "object", additionalProperties: false, required: ["questions"], properties: {
    context: { type: "string", description: "One short line on what this is for, e.g. \"For your Airbnb internship application\"." },
    questions: { type: "array", minItems: 1, maxItems: MAX_QUESTIONS, items: { type: "object", additionalProperties: false, required: ["question"], properties: {
      question: { type: "string", description: "The question, short and specific." },
      choices: { type: "array", maxItems: MAX_CHOICES, items: { type: "string" }, description: "2 to 8 short options to tap. The user can still type another answer." },
      multiple: { type: "boolean", description: "True when several choices may be picked." },
      placeholder: { type: "string", description: "Example of the expected answer, shown in the text box." },
    } } },
  } },
} };

const clip = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The model's arguments as a request the chat can show. Throws a message the model can act on. */
export function questionRequest(args: Record<string, unknown>, id: string = crypto.randomUUID()): UserQuestionRequest {
  const raw = Array.isArray(args.questions) ? args.questions : [];
  const questions = raw.slice(0, MAX_QUESTIONS).map((q, i): UserQuestion => {
    const item = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
    const choices = Array.isArray(item.choices) ? [...new Set(item.choices.map(c => clip(c, 120)).filter(Boolean))].slice(0, MAX_CHOICES) : [];
    return { id: `q${i + 1}`, question: clip(item.question, 300),
      ...(choices.length >= 2 ? { choices } : {}), ...(choices.length >= 2 && item.multiple === true ? { multiple: true } : {}),
      ...(clip(item.placeholder, 80) ? { placeholder: clip(item.placeholder, 80) } : {}) };
  }).filter(q => q.question);
  if (!questions.length) throw new Error("ask_user needs at least one question with text.");
  const context = clip(args.context, 160);
  return { id, ...(context ? { context } : {}), questions };
}

/** What the model gets back: each question with the user's answer, in order. */
export function answersOutput(request: UserQuestionRequest, answers: UserAnswers | null) {
  if (!answers) return { answered: false, note: "The user didn't answer (they stopped, or it timed out). Don't guess: do what you can without it, and in your reply say what you still need." };
  return {
    answered: true,
    answers: request.questions.map(q => ({ question: q.question, answer: answers[q.id]?.trim() || "(skipped: the user chose not to answer)" })),
    note: "These are the user's own answers. Continue the task with them.",
  };
}

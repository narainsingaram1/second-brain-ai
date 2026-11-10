import type { AIMessage, ApprovalRequest } from "../../src/types";
import type { AgentExecutionResult } from "../../src/services/agentDispatcher";
import type { AdminStore, TelegramAccount, UserSession } from "./admin";
import { providerKey, type Deps } from "./context";
import { googleSession } from "./google";
import { googleToolset } from "./googleTools";
import { HttpError } from "./http";
import { runServerAgent } from "./serverAgent";
import { plainIrisUi } from "../../src/utils/irisUi";
import type { ServerStore } from "./store";
import { plainText, sha256Hex, type TelegramClient } from "./telegram";
import { executeApproved } from "../routes/actions";

interface TelegramChat { id: number; type: string }
interface TelegramMessage { message_id: number; chat: TelegramChat; from?: { id: number; username?: string }; text?: string; reply_to_message?: { text?: string } }
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: { id: string; from: { id: number }; data?: string; message?: TelegramMessage };
}

export const TELEGRAM_THREAD = { id: "telegram", title: "Telegram" };
const MESSAGES_PER_HOUR = 60;
const TURN_TIMEOUT_MS = 280_000;
const RECENT_NOTIFICATION_MS = 12 * 3_600_000;
const CHANNEL_NOTE = "This conversation is over Telegram. Reply like a text message: short, usually under 80 words, plain text with no headings, tables, markdown or interactive cards. Do not include record IDs. Say plainly what you changed.";
const NOT_LINKED = "This chat isn't connected to a Synapse account. Open Synapse, go to Settings, and choose Connect Telegram.";
const HELP = "Text me like you would in Synapse: \"add a task to finish the lab by Friday at 5\", \"what's due this week?\", \"mark the essay done\".\n\n/stop pauses reminders\n/resume turns them back on";

/** Handles one update from Telegram. Only private chats, and only from the person who owns the chat. */
export async function handleTelegramUpdate(deps: Deps, telegram: TelegramClient, admin: AdminStore, update: TelegramUpdate): Promise<void> {
  const query = update.callback_query;
  const message = update.message;
  const chat = query?.message?.chat ?? message?.chat;
  const senderId = query?.from.id ?? message?.from?.id;
  if (!chat || chat.type !== "private" || chat.id !== senderId) return;

  const start = message?.text?.trim().match(/^\/start\s+([\w-]{16,64})$/);
  if (start) return link(telegram, admin, chat.id, start[1], message?.from?.username ?? null);

  const account = await admin.claimUpdate(chat.id, update.update_id);
  if (!account) {
    if (query) await telegram.answer(query.id);
    if (!await admin.accountForChat(chat.id)) await telegram.send(chat.id, NOT_LINKED);
    return;
  }
  if (query) return decide(deps, telegram, admin, account, query);
  const text = message?.text?.trim();
  if (!message) return;
  if (!text) return telegram.send(chat.id, "I can only read text messages here for now.");
  if (/^\/(start|help)\b/i.test(text)) return telegram.send(chat.id, HELP);
  if (/^\/stop\b/i.test(text) || /^\/resume\b/i.test(text)) {
    const on = /^\/resume\b/i.test(text);
    await admin.setNotifications(account.userId, on);
    return telegram.send(chat.id, on ? "Reminders are back on." : "Reminders paused. You can still text me anytime. /resume turns them back on.");
  }
  return converse(deps, telegram, admin, account, message, text);
}

async function link(telegram: TelegramClient, admin: AdminStore, chatId: number, code: string, username: string | null) {
  const userId = await admin.consumeLinkCode(await sha256Hex(code), chatId, username);
  await telegram.send(chatId, userId ? `You're connected. ${HELP}` : "That link has expired or was already used. Open Synapse Settings and choose Connect Telegram again.");
}

async function withSession(admin: AdminStore, userId: string, work: (session: UserSession) => Promise<void>) {
  const session = await admin.session(userId);
  try { await work(session); } finally { await session.close(); }
}

const describe = (error: unknown) => error instanceof HttpError ? error.message : "I couldn't finish that. Try again in a moment.";
const logFailure = (where: string, error: unknown) => { if (!(error instanceof HttpError)) console.error(`[telegram] ${where}`, error instanceof Error ? error.message : "unknown error"); };

async function converse(deps: Deps, telegram: TelegramClient, admin: AdminStore, account: TelegramAccount, incoming: TelegramMessage, text: string) {
  const chatId = account.chatId;
  const typing = () => telegram.typing(chatId).catch(() => {});
  void typing();
  const timer = setInterval(typing, 4500);
  try {
    await withSession(admin, account.userId, async ({ store }) => {
      if (await store.countAudit("telegram message", new Date(Date.now() - 3_600_000).toISOString()) >= MESSAGES_PER_HOUR)
        throw new HttpError(429, "That's a lot of messages this hour. Give me a little while and try again.");
      await store.appendAudit({ actor: "user", action: "telegram message", entityType: "conversation", entityId: TELEGRAM_THREAD.id, title: "Telegram message" });
      const key = await providerKey(deps, store);
      const google = await googleSession(deps, store).catch(() => null);
      const tools = google ? googleToolset(google, store, account.timeZone) : undefined;
      // Reminders are sent without the assistant, so it is told about them to make "done with that" work.
      const recent = await admin.recentNotifications(account.userId, new Date(Date.now() - RECENT_NOTIFICATION_MS).toISOString());
      const quoted = incoming.reply_to_message?.text;
      const context: AIMessage[] = [...recent, ...(quoted && !recent.includes(quoted) ? [quoted] : [])]
        .map(content => ({ id: crypto.randomUUID(), role: "assistant", content, timestamp: new Date().toISOString() }));
      const message: AIMessage = { id: crypto.randomUUID(), role: "user", content: text, timestamp: new Date().toISOString() };
      let delivered: Promise<void> | undefined;
      await runServerAgent(store, key, { message, chatHistory: context, conversationId: TELEGRAM_THREAD.id, savedThread: TELEGRAM_THREAD, timeZone: account.timeZone, channelNote: CHANNEL_NOTE },
        event => { if (event.type === "done") delivered = deliver(telegram, store, chatId, event.result); },
        AbortSignal.timeout(TURN_TIMEOUT_MS), tools, deps.web?.());
      await delivered;
    });
  } catch (error) {
    logFailure("turn failed", error);
    await telegram.send(chatId, describe(error)).catch(() => {});
  } finally {
    clearInterval(timer);
  }
}

async function deliver(telegram: TelegramClient, store: ServerStore, chatId: number, result: AgentExecutionResult) {
  await telegram.send(chatId, plainText(plainIrisUi(result.queryAnswer)));
  for (const approval of result.approvals || []) await askApproval(telegram, store, chatId, approval);
}

const approvalText = (a: ApprovalRequest) => [a.summary, ...a.details, ...(a.preview ? [a.preview.slice(0, 1500)] : []), ...(a.warnings || []).map(w => `Check: ${w}`)].join("\n");

async function askApproval(telegram: TelegramClient, store: ServerStore, chatId: number, approval: ApprovalRequest) {
  const action = await store.getAction(approval.id);
  // Email and invitations can't be taken back, so they keep the app's full review and undo window.
  if (action?.tier === "external_irreversible") return telegram.send(chatId, `${approval.summary}\n\nThis one goes out to other people, so review and approve it in Synapse.`);
  await telegram.send(chatId, approvalText(approval), [{ text: "Approve", callback_data: `y:${approval.id}` }, { text: "Reject", callback_data: `n:${approval.id}` }]);
}

async function decide(deps: Deps, telegram: TelegramClient, admin: AdminStore, account: TelegramAccount, query: NonNullable<TelegramUpdate["callback_query"]>) {
  await telegram.answer(query.id);
  const decision = query.data?.match(/^([yn]):([0-9a-f-]{36})$/i);
  const messageId = query.message?.message_id;
  if (!decision || !messageId) return;
  const original = query.message?.text || "";
  const finish = (status: string) => telegram.edit(account.chatId, messageId, `${original}\n\n${status}`);
  try {
    await withSession(admin, account.userId, async ({ store }) => {
      const id = decision[2];
      const action = await store.getAction(id);
      if (!action) return void await finish("This is no longer available.");
      if (action.tier === "external_irreversible") return void await finish("Open Synapse to approve this one.");
      await store.decideAction(id, decision[1].toLowerCase() === "y" ? "approve" : "reject", action.payload_hash);
      if (decision[1].toLowerCase() === "n") return void await finish("Rejected. Nothing changed.");
      const outcome = await executeApproved(deps, store, id);
      await finish(outcome.status === "executed" ? "Done." : `Couldn't do that: ${outcome.error}`);
    });
  } catch (error) {
    logFailure("decision failed", error);
    await finish(error instanceof HttpError && error.status === 409 ? "This is no longer waiting for a decision." : describe(error)).catch(() => {});
  }
}

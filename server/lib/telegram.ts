/** A thin client for the Telegram Bot API. Replies are plain text, so nothing a model writes can break formatting. */
export interface TelegramButton { text: string; callback_data: string }
export interface TelegramClient {
  send(chatId: number, text: string, buttons?: TelegramButton[]): Promise<void>;
  edit(chatId: number, messageId: number, text: string): Promise<void>;
  answer(callbackId: string): Promise<void>;
  typing(chatId: number): Promise<void>;
  username(): Promise<string>;
  setWebhook(url: string, secret: string): Promise<void>;
}

const MESSAGE_LIMIT = 4000;

export function telegramClient(token: string, fetcher: typeof fetch = fetch): TelegramClient {
  const call = async <T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> => {
    const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const data = await response.json().catch(() => null) as { ok?: boolean; result?: T; error_code?: number; description?: string } | null;
    if (!data?.ok) throw new Error(`Telegram ${method} failed (${data?.error_code ?? response.status})${data?.description ? `: ${data.description}` : ""}`);
    return data.result as T;
  };
  return {
    async send(chatId, text, buttons) {
      const parts = splitMessage(text);
      for (const [index, part] of parts.entries())
        await call("sendMessage", { chat_id: chatId, text: part, link_preview_options: { is_disabled: true },
          ...(buttons && index === parts.length - 1 ? { reply_markup: { inline_keyboard: [buttons] } } : {}) });
    },
    async edit(chatId, messageId, text) {
      await call("editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, MESSAGE_LIMIT), reply_markup: { inline_keyboard: [] } });
    },
    async answer(callbackId) { await call("answerCallbackQuery", { callback_query_id: callbackId }); },
    async typing(chatId) { await call("sendChatAction", { chat_id: chatId, action: "typing" }); },
    async username() { return (await call<{ username: string }>("getMe")).username; },
    async setWebhook(url, secret) { await call("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"] }); },
  };
}

/** Derived from the bot token, so there is one less secret to configure and rotating the token rotates this too. */
export async function webhookSecret(token: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("synapse-telegram-webhook"));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function sameSecret(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Markdown the app would render, flattened for a plain text message. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\s*\[(?:task|goal|habit|journal|knowledge|tracker|event|course|document|deck|quiz|workspace|folder):[^\]\s]+\]/g, "")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

export function splitMessage(text: string, limit = MESSAGE_LIMIT): string[] {
  const parts: string[] = [];
  let rest = text.trim() || "Done.";
  while (rest.length > limit) {
    const newline = rest.lastIndexOf("\n", limit);
    const cut = newline > limit / 2 ? newline : limit;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  parts.push(rest);
  return parts;
}

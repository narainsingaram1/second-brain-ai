import type { GoogleSession } from "./google";
import { HttpError } from "./http";

const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface GoogleEvent {
  id: string; title: string; date: string; endDate?: string; startTime?: string; endTime?: string; allDay: boolean;
  location?: string; link?: string; attendees: number; status?: string;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function validTimeZone(zone: unknown): string {
  try { if (typeof zone === "string" && zone.length < 64) { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return zone; } } catch { /* fall through */ }
  return "UTC";
}

/** Events on the primary calendar between two local dates (inclusive), in the given time zone. */
export async function listEvents(google: GoogleSession, from: string, to: string, timeZone: string, max = 250): Promise<GoogleEvent[]> {
  if (!DATE.test(from) || !DATE.test(to) || to < from) throw new HttpError(400, "Use a valid date range (YYYY-MM-DD).");
  if (Date.parse(to) - Date.parse(from) > 62 * 86400000) throw new HttpError(400, "Ask for at most two months of events at once.");
  // Pad by a day either side in UTC, then keep only events whose local date falls in range.
  const params = new URLSearchParams({ timeMin: `${addDays(from, -1)}T00:00:00Z`, timeMax: `${addDays(to, 2)}T00:00:00Z`, singleEvents: "true", orderBy: "startTime",
    timeZone, maxResults: String(Math.min(max, 250)) });
  const body = await google.json<{ items?: any[] }>(`${CAL}?${params}`);
  return (body.items || []).filter(e => e.status !== "cancelled").map(e => {
    const allDay = !!e.start?.date;
    const start = allDay ? e.start.date : String(e.start?.dateTime || "");
    const end = allDay ? e.end?.date : String(e.end?.dateTime || "");
    const event: GoogleEvent = {
      id: String(e.id), title: String(e.summary || "(No title)").slice(0, 300), date: start.slice(0, 10), allDay,
      attendees: Array.isArray(e.attendees) ? e.attendees.length : 0,
      ...(e.location ? { location: String(e.location).slice(0, 300) } : {}),
      ...(typeof e.htmlLink === "string" && e.htmlLink.startsWith("https://") ? { link: e.htmlLink } : {}),
    };
    if (allDay) { const last = addDays(String(end), -1); if (last > event.date) event.endDate = last; }
    else { event.startTime = start.slice(11, 16); event.endTime = end.slice(11, 16); if (end.slice(0, 10) > event.date) event.endDate = end.slice(0, 10); }
    return event;
  }).filter(e => e.date <= to && (e.endDate || e.date) >= from);
}

export interface NewEvent { title: string; date: string; startTime?: string; endTime?: string; timeZone: string; location?: string; description?: string; attendees?: string[] }
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export function validateNewEvent(args: Record<string, unknown>, timeZone: string): NewEvent {
  const title = typeof args.title === "string" ? args.title.trim() : "";
  const date = String(args.date || "");
  const startTime = args.startTime === undefined ? undefined : String(args.startTime);
  const endTime = args.endTime === undefined ? undefined : String(args.endTime);
  if (!title || title.length > 300) throw new Error("Give the event a title (up to 300 characters).");
  if (!DATE.test(date)) throw new Error("Use a date in YYYY-MM-DD.");
  if ((startTime && !TIME.test(startTime)) || (endTime && !TIME.test(endTime))) throw new Error("Use 24-hour HH:MM times.");
  if (!!startTime !== !!endTime) throw new Error("Give both a start and an end time, or neither for an all-day event.");
  if (startTime && endTime && endTime <= startTime) throw new Error("The end time must be after the start time.");
  const attendees = Array.isArray(args.attendees) ? args.attendees.map(a => String(a).trim()).filter(Boolean) : [];
  if (attendees.length > 50 || attendees.some(a => !EMAIL.test(a))) throw new Error("Attendees must be email addresses (at most 50).");
  return { title, date, startTime, endTime, timeZone,
    ...(typeof args.location === "string" && args.location.trim() ? { location: args.location.trim().slice(0, 300) } : {}),
    ...(typeof args.description === "string" && args.description.trim() ? { description: args.description.trim().slice(0, 5000) } : {}),
    ...(attendees.length ? { attendees } : {}) };
}

/** Creates an event on the primary calendar. Guests receive Google's invitation email. */
export async function createEvent(google: GoogleSession, event: NewEvent): Promise<GoogleEvent> {
  const when = (time?: string, endDate = event.date) => time ? { dateTime: `${event.date}T${time}:00`, timeZone: event.timeZone } : { date: endDate };
  const body = {
    summary: event.title, location: event.location, description: event.description,
    start: when(event.startTime), end: event.endTime ? when(event.endTime) : { date: addDays(event.date, 1) },
    ...(event.attendees ? { attendees: event.attendees.map(email => ({ email })) } : {}),
  };
  const created = await google.json<any>(`${CAL}?sendUpdates=${event.attendees ? "all" : "none"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { id: String(created.id), title: event.title, date: event.date, startTime: event.startTime, endTime: event.endTime, allDay: !event.startTime,
    attendees: event.attendees?.length || 0, ...(typeof created.htmlLink === "string" ? { link: created.htmlLink } : {}) };
}

export interface EmailSummary { id: string; threadId: string; from: string; to: string; subject: string; date: string; snippet: string; unread: boolean }
const header = (headers: Array<{ name: string; value: string }> = [], name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
const decodeEntities = (text: string) => text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Messages matching a Gmail search (same syntax as the Gmail search box). Metadata and snippet only. */
export async function searchEmail(google: GoogleSession, query: string, max = 10): Promise<EmailSummary[]> {
  const list = await google.json<{ messages?: Array<{ id: string }> }>(`${GMAIL}/messages?${new URLSearchParams({ q: query.slice(0, 500), maxResults: String(Math.min(Math.max(max, 1), 25)) })}`);
  return Promise.all((list.messages || []).map(async ({ id }) => {
    const m = await google.json<any>(`${GMAIL}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
    const h = m.payload?.headers;
    return { id: String(m.id), threadId: String(m.threadId), from: header(h, "From").slice(0, 300), to: header(h, "To").slice(0, 500), subject: header(h, "Subject").slice(0, 300),
      date: header(h, "Date"), snippet: decodeEntities(String(m.snippet || "")).slice(0, 300), unread: Array.isArray(m.labelIds) && m.labelIds.includes("UNREAD") };
  }));
}

const decodeBody = (data?: string) => {
  if (!data) return "";
  try { return new TextDecoder().decode(Uint8Array.from(atob(data.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))); } catch { return ""; }
};
/** Readable text from an HTML email: no tags, scripts, styles or tracking markup. */
export function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export const MAX_EMAIL_CHARS = 20_000;

/** One email as plain text (HTML stripped, capped), with its attachments listed but not downloaded. */
export async function readEmail(google: GoogleSession, id: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("Use a message ID from search_email.");
  const m = await google.json<any>(`${GMAIL}/messages/${id}?format=full`);
  let plain = "", html = "";
  const attachments: string[] = [];
  const walk = (part: any) => {
    if (!part) return;
    if (part.filename) attachments.push(String(part.filename).slice(0, 200));
    else if (part.mimeType === "text/plain" && !plain) plain = decodeBody(part.body?.data);
    else if (part.mimeType === "text/html" && !html) html = decodeBody(part.body?.data);
    (part.parts || []).forEach(walk);
  };
  walk(m.payload);
  const text = (plain || htmlToText(html) || decodeEntities(String(m.snippet || ""))).replace(/\r\n/g, "\n");
  const h = m.payload?.headers;
  return {
    id: String(m.id), threadId: String(m.threadId), from: header(h, "From"), to: header(h, "To"), cc: header(h, "Cc"), subject: header(h, "Subject"), date: header(h, "Date"),
    body: text.length > MAX_EMAIL_CHARS ? `${text.slice(0, MAX_EMAIL_CHARS)}\n[…message truncated]` : text, attachments,
  };
}

export interface NewDraft { to: string[]; cc: string[]; subject: string; body: string; replyToId?: string }
export function validateDraft(args: Record<string, unknown>): NewDraft {
  const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map(a => String(a).trim()).filter(Boolean);
  const to = list(args.to), cc = list(args.cc);
  const subject = typeof args.subject === "string" ? args.subject.trim() : "";
  const body = typeof args.body === "string" ? args.body : "";
  if (!to.length && !args.replyToId) throw new Error("Give at least one recipient.");
  if ([...to, ...cc].length > 50 || [...to, ...cc].some(a => !EMAIL.test(a))) throw new Error("Recipients must be email addresses (at most 50).");
  if (subject.length > 300 || /[\r\n]/.test(subject)) throw new Error("Use a single-line subject up to 300 characters.");
  if (!body.trim() || body.length > 50_000) throw new Error("Write a body (up to 50,000 characters).");
  return { to, cc, subject, body, ...(typeof args.replyToId === "string" && args.replyToId ? { replyToId: args.replyToId } : {}) };
}

const utf8Base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const encodeHeader = (text: string) => /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${utf8Base64(text)}?=`;

/** Saves a draft in the user's Gmail Drafts folder. Nothing is sent. Replies stay in their thread. */
export async function createDraft(google: GoogleSession, draft: NewDraft) {
  let threadId: string | undefined, replyHeaders: string[] = [], to = draft.to, subject = draft.subject;
  if (draft.replyToId) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(draft.replyToId)) throw new Error("Use a message ID from search_email.");
    const original = await google.json<any>(`${GMAIL}/messages/${draft.replyToId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Reply-To`);
    const h = original.payload?.headers;
    threadId = String(original.threadId);
    const messageId = header(h, "Message-ID").replace(/[\r\n]/g, "");
    if (messageId) replyHeaders = [`In-Reply-To: ${messageId}`, `References: ${messageId}`];
    if (!to.length) { const reply = (header(h, "Reply-To") || header(h, "From")).match(/<([^>]+)>/)?.[1] || header(h, "Reply-To") || header(h, "From"); if (EMAIL.test(reply.trim())) to = [reply.trim()]; }
    if (!subject) { const original_ = header(h, "Subject").replace(/[\r\n]/g, ""); subject = /^re:/i.test(original_) ? original_ : `Re: ${original_}`; }
  }
  if (!to.length) throw new Error("Give at least one recipient.");
  const mime = [
    `To: ${to.join(", ")}`, ...(draft.cc.length ? [`Cc: ${draft.cc.join(", ")}`] : []), `Subject: ${encodeHeader(subject)}`, ...replyHeaders,
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", utf8Base64(draft.body).replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");
  const raw = utf8Base64(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const created = await google.json<any>(`${GMAIL}/drafts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: { raw, ...(threadId ? { threadId } : {}) } }) });
  return { draftId: String(created.id), messageId: String(created.message?.id || ""), to, subject, link: "https://mail.google.com/mail/u/0/#drafts" };
}

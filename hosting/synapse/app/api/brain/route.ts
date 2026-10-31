import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "Vary": "Cookie" } });
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in required" }, 401);
  const row = await env.DB!.prepare("SELECT state, revision FROM brains WHERE user_id = ?").bind(user.userId).first<{ state: string; revision: number }>();
  return json({ user: { id: user.userId, email: user.email }, state: row ? JSON.parse(row.state) : null, revision: row?.revision || 0 });
}
export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in required" }, 401);
  // Cookie-authenticated writes must originate from this application.
  if (request.headers.get("Origin") !== new URL(request.url).origin) return json({ error: "Invalid origin" }, 403);
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "Expected JSON" }, 415);
  const body = await request.text();
  if (body.length > 4_000_000) return json({ error: "Backup exceeds 4 MB" }, 413);
  let data;
  try { data = JSON.parse(body); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { state, revision } = data;
  if (!Number.isSafeInteger(revision) || revision < 0 || !state || typeof state !== "object" || Array.isArray(state)) return json({ error: "Invalid state" }, 400);
  for (const field of ["tasks", "goals", "habits", "journalEntries", "knowledgeItems", "chatHistory", "sections"]) {
    if (!Array.isArray(state[field])) return json({ error: `Invalid ${field}` }, 400);
  }
  // Never accept client-supplied ownership or credentials.
  delete state.openRouterKey; delete state.userId;
  const value = JSON.stringify(state);
  const now = new Date().toISOString();
  const result = revision === 0
    ? await env.DB!.prepare("INSERT INTO brains (user_id, state, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO NOTHING").bind(user.userId, value, now).run()
    : await env.DB!.prepare("UPDATE brains SET state = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?").bind(value, now, user.userId, revision).run();
  if (!result.meta.changes) return json({ error: "Records changed on another device" }, 409);
  return json({ revision: revision + 1 });
}

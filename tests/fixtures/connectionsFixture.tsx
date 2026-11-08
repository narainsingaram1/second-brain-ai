// Manual browser fixture for Google connections, the calendar overlay and an external approval card.
// Synthetic data only: a fake session in local storage and intercepted /api responses; nothing leaves the page.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/chat.css";
import "../../src/index.css";
import "../../src/redesign.css";
import "../../src/pages.css";
import { ConnectionsPanel } from "../../src/components/ConnectionsPanel";
import { TaskCalendarView } from "../../src/components/TaskCalendarView";
import { ApprovalCard } from "../../src/components/ApprovalCard";
import { describeExternal } from "../../src/services/actionPolicy";
import { getLocalDateString } from "../../src/utils/habitStreaks";
import type { ApprovalRequest, Task } from "../../src/types";

// Supabase reads its session from here (project ref "fixture" from the fixture's Supabase URL).
localStorage.setItem("sb-fixture-auth-token", JSON.stringify({ access_token: "fixture-access-token", refresh_token: "fixture-refresh", token_type: "bearer",
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "fixture-user", aud: "authenticated", email: "student@gatech.edu", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } }));

const today = new Date();
const day = (offset: number) => getLocalDateString(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset));
let connected = true;
const requests: string[] = [];
(window as unknown as { __requests: string[] }).__requests = requests;
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  requests.push(`${init?.method || "GET"} ${url.pathname}${url.search} auth=${new Headers(init?.headers).get("Authorization") ? "yes" : "no"}`);
  if (url.pathname === "/api/health") return Response.json({ ok: true, secrets: true, agent: true, approvals: true, google: true });
  if (url.pathname === "/api/google" && init?.method === "DELETE") { connected = false; return Response.json({ connected: false }); }
  if (url.pathname === "/api/google" && url.searchParams.get("action") === "events") return Response.json({ connected, events: connected ? [
    { id: "g1", title: "CS 1332 lecture", date: day(0), startTime: "09:30", endTime: "10:45", allDay: false, attendees: 0, link: "https://calendar.google.com/event?eid=g1" },
    { id: "g2", title: "Career fair", date: day(2), endDate: day(3), allDay: true, attendees: 0, link: "https://calendar.google.com/event?eid=g2" },
  ] : [] });
  if (url.pathname === "/api/google") return Response.json(connected
    ? { configured: true, connected: true, email: "student@gatech.edu", calendar: true, gmail: true, status: "active", connectedAt: "2026-11-07T15:00:00Z", lastError: null }
    : { configured: true, connected: false });
  return new Response("Not found", { status: 404 });
};

const tasks: Task[] = [{ id: "t1", title: "Submit project report", dueDate: day(0), priority: "high", section: "Academic", subsection: "General", status: "not_started", completed: false } as Task];
const args = { title: "Project sync", date: day(1), startTime: "09:00", endTime: "09:30", attendees: ["amy@gatech.edu", "raj@gatech.edu"] };
const { summary, details } = describeExternal("create_calendar_event", args);

function Fixture() {
  const [approval, setApproval] = useState<ApprovalRequest>({ id: "a1", tool: "create_calendar_event", summary, details, reason: "Google will email invitations to the guests.", status: "pending", remote: true, payloadHash: "0".repeat(64) });
  return <main style={{ maxWidth: 1100, margin: "24px auto", padding: "0 16px", display: "grid", gap: 24 }}>
    <div style={{ maxWidth: 560 }}><ConnectionsPanel /></div>
    <div style={{ maxWidth: 640 }}><ApprovalCard approval={approval} onDecide={async decision => setApproval(a => ({ ...a, status: decision === "approve" ? "executed" : "rejected" }))} /></div>
    <TaskCalendarView tasks={tasks} sections={["Academic"]} subsections={{ Academic: ["General"] }} onToggleTask={() => {}} onAddTask={() => {}} onEditTask={() => {}} onDeleteTask={() => {}} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

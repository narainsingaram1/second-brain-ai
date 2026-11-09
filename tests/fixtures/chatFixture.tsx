// Manual browser regression fixture. No storage reads and no external provider requests.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/chat.css";
import "../../src/index.css";
import "../../src/redesign.css";
import { ChatWorkspace } from "../../src/components/ChatWorkspace";
import { Sidebar } from "../../src/components/Sidebar";
import { TopHeader } from "../../src/components/TopHeader";
import { useBrainConversation } from "../../src/hooks/useBrainConversation";
import { AIMessage, BrainState } from "../../src/types";
const lc3Note = { id: "fixture-note-lc3", title: "CS 2110 — LC-3 TRAP routines", subject: "CS 2110", content: "TRAP x20 GETC, x21 OUT, x22 PUTS, x25 HALT. Use JSR/RET for subroutines and save R7.", summary: "LC-3 TRAP routines", status: "Synthesized" as const, startDate: "2026-11-01", endDate: "2026-11-01" };
const tasks = Array.from({ length: 7 }, (_, i) => ({ id: `fixture-task-${i}`, title: ["Prepare project presentation", "Review lecture notes", "Complete problem set", "Practice interview questions", "Draft research proposal", "Review experiment results", "Submit weekly reflection"][i], dueDate: `2026-11-0${i + 1}`, section: "Academic", subsection: "General", priority: "medium" as const, status: "in_progress" as const, completed: false }));
const goals = [{ id: "fixture-goal", title: "Find a research opportunity", sector: "career" as const, timeframe: "quarterly" as const, description: "Find a lab working on robotics and autonomous systems.", metrics: "Three conversations with faculty", why: "Build practical research experience", progress: 35, status: "in_progress" as const, milestones: [{ id: "milestone", title: "Shortlist three labs", completed: true }, { id: "milestone-two", title: "Prepare a research introduction", completed: false }], createdAt: "2026-10-01" }];
const sources = [...tasks.map(t => ({ type: "task", id: t.id, title: t.title })), { type: "goal", id: goals[0].id, title: goals[0].title }];
const answer = `## Your week at a glance\n\nHere are seven upcoming tasks, sorted by deadline.\n\n${tasks.map(t => `- **${t.title}** [task:${t.id}] — due ${t.dueDate}. Complete the next concrete step before starting another task.`).join("\n")}\n\n### A clearer next step\n\nFor [goal:fixture-goal], start with your existing shortlist. Your goal is already 35% complete; the next milestone is to prepare a research introduction.\n\nKeep the introduction specific to the lab’s current work, and use your robotics project as evidence of your interest.\n\n### What to prioritize\n\nFinish the presentation first, then work through the problem set. Leave a buffer before each deadline. These are recommendations; no records were changed.`;
function makeMessage(role: "user" | "assistant", content: string): AIMessage { return { id: crypto.randomUUID(), role, content, timestamp: "3:30 PM", sources: role === "assistant" ? sources : undefined }; }
const sseResponse = (...events: unknown[]) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
// Streams the synthetic answer a few words at a time, like a provider's server-sent events. A message
// containing "delete" makes the model ask to delete the first task, which needs the user's approval.
window.fetch = async (_url, init) => {
  await new Promise(resolve => setTimeout(resolve, 600));
  const request = JSON.parse(String((init as RequestInit | undefined)?.body || "{}"));
  const lastUser = [...(request.messages || [])].reverse().find((m: { role: string }) => m.role === "user");
  const userText = typeof lastUser?.content === "string" ? lastUser.content : "";
  const forced = request.tool_choice?.function?.name;
  const suggestion = (args: unknown) => Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: "fx-suggest", type: "function", function: { name: forced, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }] });
  if (forced === "suggest_follow_ups") return suggestion({ followUps: ["Make it due this Friday", "Move it to SWE Applications", "What else should I update on my profile?"] });
  if (forced === "suggest_starters") return suggestion({ starters: [
    { kind: "class", title: "Prep for the CS 2110 lab", detail: "TRAP routines are up next", prompt: "Quiz me on LC-3 TRAP routines from my CS 2110 notes." },
    { kind: "task", title: "Start the presentation", detail: "Due tomorrow, nothing started", prompt: "Help me outline my project presentation." },
    { kind: "goal", title: "Pitch the robotics lab", detail: "Your research goal is at 40%", prompt: "Help me prepare a research introduction for the robotics lab." },
    { kind: "idea", title: "Connect LC-3 to interviews", detail: "Two things you're working on", prompt: "How could what I'm learning about LC-3 help in systems interviews?" },
  ] });
  if (/delete/i.test(userText)) {
    const answered = (request.messages || []).some((m: { role: string }) => m.role === "tool");
    return answered
      ? sseResponse({ choices: [{ delta: { content: "Deleting **Prepare project presentation** is waiting for your approval below." }, finish_reason: "stop" }] })
      : sseResponse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "fixture-delete", function: { name: "delete_task", arguments: JSON.stringify({ taskId: "fixture-task-0" }) } }] }, finish_reason: "tool_calls" }] });
  }
  // A message mentioning LC-3 shows the full activity: streamed reasoning, a records search and a web
  // search (the provider's web plugin), then more reasoning and a streamed answer.
  if (/lc-?3/i.test(userText)) {
    if (request.plugins) return Response.json({ choices: [{ message: { content: "LC-3 is a teaching ISA with 15 opcodes and 8 registers [Wikipedia](https://en.wikipedia.org/wiki/Little_Computer_3).",
      annotations: [{ type: "url_citation", url_citation: { url: "https://en.wikipedia.org/wiki/Little_Computer_3", title: "Little Computer 3 - Wikipedia" } }, { type: "url_citation", url_citation: { url: "https://www.cs.colostate.edu/~cs270/.Fall20/resources/PattPatelAppA.pdf", title: "LC-3 ISA reference (Patt & Patel)" } }] } }] });
    const answered = (request.messages || []).some((m: { role: string }) => m.role === "tool");
    const thinking = answered
      ? "The notes cover TRAP routines and the web results confirm the opcode count. I'll contrast LC-3 with x86 and ARM on instruction count, addressing modes and registers, and keep it concrete."
      : "The user is asking how LC-3 assembly differs from real-world assembly. They may have course notes on LC-3, so I'll check those first, then confirm the ISA details on the web before comparing.";
    const reply = answered
      ? "**Short answer:** LC-3 *is* assembly, just for a tiny teaching machine instead of a real CPU.\n\n| | LC-3 | x86-64 / ARM |\n|---|---|---|\n| Instructions | 15 opcodes | Hundreds to thousands |\n| Registers | 8 general (R0–R7) | 16+ general, plus vector registers |\n| Word size | 16-bit | 64-bit |\n\n### Why it feels different\n\n- **No multiply or OR instruction.** You build them from `ADD`, `AND` and `NOT`.\n- **Tiny address offsets.** `LD`/`ST` reach only ±256 words, so you use `LDR` or pointers for anything farther.\n- **I/O through TRAPs** like `GETC`, `OUT` and `PUTS` instead of system calls.\n\nEverything you learn (registers, condition codes, the stack, calling conventions) carries straight over to x86 and ARM."
      : "";
    const chunks = [...thinking.split(/(?<= )/).map(t => ({ reasoning: t })), ...reply.split(/(?<= )/).map(t => ({ content: t }))];
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({ async start(controller) {
      for (let i = 0; i < chunks.length; i += 2) {
        const part = chunks.slice(i, i + 2);
        const delta = { reasoning: part.map(p => p.reasoning || "").join("") || undefined, content: part.map(p => p.content || "").join("") || undefined };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`));
        await new Promise(resolve => setTimeout(resolve, delta.reasoning ? 70 : 35));
      }
      const end = answered ? { delta: {}, finish_reason: "stop" }
        : { delta: { tool_calls: [{ index: 0, id: "fx-search", function: { name: "search_records", arguments: JSON.stringify({ query: "LC-3 assembly" }) } },
            { index: 1, id: "fx-web", function: { name: "web_search", arguments: JSON.stringify({ query: "LC-3 ISA compared to x86 assembly" }) } }] }, finish_reason: "tool_calls" };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [end] })}\n\ndata: [DONE]\n\n`));
      controller.close();
    } });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  }
  const words = answer.split(/(?<= )/);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ async start(controller) {
    for (let i = 0; i < words.length; i += 3) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: words.slice(i, i + 3).join("") } }] })}\n\n`));
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`));
    controller.close();
  } });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
};
function Fixture() {
  const [state, setState] = useState<BrainState | null>({ userId: "ui-fixture", tasks, goals, habits: [], journalEntries: [], knowledgeItems: [lc3Note], sections: ["Academic"], subsections: { Academic: ["General"] }, chatHistory: [], conversations: [], selectedModel: "fixture/synthetic-model", openRouterKey: "fixture-only", theme: "light" });
  const [collapsed, setCollapsed] = useState(window.innerWidth < 768);
  const conversation = useBrainConversation(state, setState, () => {});
  (window as unknown as { __fixtureTasks: () => string[] }).__fixtureTasks = () => state?.tasks.map(t => t.title) || [];
  if (!state) return null;
  const active = state.chatHistory.some(m => m.role === "user");
  return <div className="h-[100dvh] overflow-hidden flex bg-[#f8f9fd] text-slate-900 dark:text-slate-100 dark:bg-[#090b14]">
    <div data-test-controls className="fixed left-0 bottom-0 z-50 flex gap-1 p-1 text-[9px] bg-white border rounded">
      <button type="button" onClick={() => setState(prev => prev && ({ ...prev, chatHistory: Array.from({ length: 12 }, (_, i) => [makeMessage("user", `Review my week, question ${i + 1}`), makeMessage("assistant", answer)]).flat() }))}>Load long thread</button>
      <button type="button" onClick={() => setState(prev => prev && ({ ...prev, chatHistory: [...prev.chatHistory, makeMessage("assistant", "A new answer arrived while you were reading earlier messages.")] }))}>Add incoming</button>
      <button type="button" onClick={() => document.documentElement.classList.toggle("dark")}>Dark</button>
    </div>
    <Sidebar activeTab="home" setActiveTab={() => {}} collapsed={collapsed} onToggleCollapse={() => setCollapsed(!collapsed)} onQuickCapture={() => {}} counts={{ tasks: tasks.length, notes: 0, goals: goals.length }} />
    <div className="flex-1 flex flex-col min-w-0 min-h-0">{!active && <TopHeader theme="light" onToggleTheme={() => document.documentElement.classList.toggle("dark")} onOpenGlobalSearch={() => {}} onOpenAuth={() => {}} onOpenNotifications={() => {}} />}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden"><ChatWorkspace conversation={conversation} state={state} messages={state.chatHistory} onSaveNote={note => setState(prev => prev && ({ ...prev, knowledgeItems: [...prev.knowledgeItems, note] }))} onOpenSettings={() => {}} /></main>
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

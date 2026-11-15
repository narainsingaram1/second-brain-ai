// Manual QA surface for the academic workspace: synthetic data, no provider requests. Quiz and flashcard
// generation is answered by a fake provider that streams its JSON slowly, so background progress can be watched.
// Add ?fail to the URL to make generation fail (for the error and retry states).
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkspacesView } from "../../src/components/WorkspacesView";
import { saveDocumentText } from "../../src/services/studyDocuments";
import type { BrainState } from "../../src/types";
import "../../src/index.css";
import "../../src/redesign.css";

const now = "2026-11-05T12:00:00.000Z";
const course = { id: "fx-course", workspaceId: "fx-ws", code: "CS 2110", name: "Computer Organization & Programming", term: "Fall 2026", instructor: "Prof. Lee", createdAt: now, updatedAt: now };
const doc = { id: "fx-doc", courseId: course.id, folderId: "fx-folder", name: "Lab 19 Slides.pptx", kind: "pptx", size: 1000, pages: 12, chars: 400, hash: "h", createdAt: now };
void saveDocumentText("fx-user", doc.id, "h", "## Slide 1\n\nprintf formats: %d prints an int, %c a char, %x lowercase hex. A char argument is promoted to int.");

window.fetch = async (_url, init) => {
  const request = JSON.parse(String((init as RequestInit | undefined)?.body || "{}"));
  await new Promise(r => setTimeout(r, 700));
  if (new URLSearchParams(location.search).has("fail")) return Response.json({ error: { message: "The provider is rate limiting requests. Try again in a minute." } }, { status: 429 });
  const prompt = String(request.messages?.at(-1)?.content || "");
  const count = Number(/(\d+)(?:-question| flashcards)/.exec(prompt)?.[1] || 10);
  const quiz = /practice quiz/.test(prompt);
  const items = Array.from({ length: count }, (_, i) => quiz
    ? { type: "mcq", prompt: `What does printf("%d", c) print for char c = ${65 + i}?`, choices: [String.fromCharCode(65 + i), String(65 + i), "0", "Error"], answerIndex: 1, explanation: "A char is promoted to int; %d prints its value.", doc: 1 }
    : { front: `Format specifier #${i + 1}?`, back: "%d prints an int.", doc: 1 });
  const json = JSON.stringify(quiz ? { questions: items } : { cards: items });
  const signal = (init as RequestInit | undefined)?.signal;
  const body = new ReadableStream<Uint8Array>({ async start(c) {
    const enc = new TextEncoder();
    for (const piece of json.match(/[\s\S]{1,24}/g) || []) {
      if (signal?.aborted) return c.error(signal.reason);
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`));
      await new Promise(r => setTimeout(r, 90));
    }
    c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`));
    c.close();
  } });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
};

function Fixture() {
  const [state, setState] = useState<BrainState>({
    userId: "fx-user", tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], trackerItems: [], events: [], chatHistory: [],
    sections: ["Academic"], subsections: { Academic: ["General"] }, openRouterKey: "fixture-only", selectedModel: "fixture/model", theme: "light",
    workspaces: [{ id: "fx-ws", name: "School", description: "Fall semester", template: "academic", color: "blue", notes: "", createdAt: now }],
    study: { courses: [course], folders: [{ id: "fx-folder", courseId: course.id, parentId: null, name: "Labs", createdAt: now }], documents: [doc], decks: [], quizzes: [] },
  } as unknown as BrainState);
  return <div className="min-h-[100dvh] bg-[#f8f9fd] dark:bg-[#090b14] p-6">
    <button type="button" className="fixed left-1 bottom-1 z-50 text-[10px] bg-white border rounded px-1" onClick={() => document.documentElement.classList.toggle("dark")}>Dark</button>
    <WorkspacesView state={state} workspaceId="fx-ws" onNavigate={() => {}} onAsk={() => {}}
      onChange={update => setState(prev => update(prev))} taskActions={{ onToggle: () => {}, onEdit: () => {}, onNew: () => {} }} />
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

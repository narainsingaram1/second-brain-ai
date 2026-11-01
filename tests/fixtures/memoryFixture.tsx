// Isolated browser integration fixture. All model responses are local synthetic stubs.
import React, { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/redesign.css";
import "../../src/chat.css";
import type { BrainState } from "../../src/types";
import { ChatWorkspace } from "../../src/components/ChatWorkspace";
import { MemoryModal } from "../../src/components/MemoryModal";
import { useBrainConversation } from "../../src/hooks/useBrainConversation";
import {
  loadInitialState,
  persistBrainState,
} from "../../src/services/storage";
import { emptyMemory } from "../../src/services/agentMemory";
const requests: any[] = [];
(window as any).__memoryRequests = requests;
window.fetch = async (_url, opts) => {
  const payload = JSON.parse(String(opts?.body));
  requests.push(payload);
  const last = payload.messages.at(-1);
  if (last.role === "user" && last.content.includes("DELAYED_MEMORY_QA")) {
    return await new Promise<Response>(resolve => {
      (window as any).__finishDelayedMemory = () => {
        const id = payload.messages[0].content.match(/Current user message ID: ([^.]+)\./)?.[1];
        resolve(Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: "delayed", type: "function", function: { name: "remember_memory", arguments: JSON.stringify({ topic: "writing style", category: "preference", content: "Prefers concise answers.", messageId: id, excerpt: last.content }) } }] } }] }));
      };
    });
  }

  const result = (content: string | null, calls?: any[]) =>
    Response.json({ choices: [{ message: { content, tool_calls: calls } }] });
  if (payload.tool_choice?.function?.name === "propose_memory_candidates") {
    const batch = JSON.parse(last.content),
      source = batch[0];
    return result(null, [
      {
        id: "proposal",
        type: "function",
        function: {
          name: "propose_memory_candidates",
          arguments: JSON.stringify({
            candidates: [
              {
                topic: "study examples",
                category: "preference",
                content: "Prefers concrete examples when studying.",
                messageId: source.messageId,
                excerpt: source.content,
              },
            ],
          }),
        },
      },
    ]);
  }
  if (last.role === "tool")
    return result(
      JSON.parse(last.content).saved
        ? "Remembered. I’ll keep future replies concise."
        : "Memory could not be saved.",
    );
  if (/remember/i.test(last.content)) {
    const id = payload.messages[0].content.match(
      /Current user message ID: ([^.]+)\./,
    )?.[1];
    return result(null, [
      {
        id: "remember",
        type: "function",
        function: {
          name: "remember_memory",
          arguments: JSON.stringify({
            topic: "writing style",
            category: "preference",
            content: "Prefers concise answers with concrete examples.",
            messageId: id,
            excerpt: last.content,
          }),
        },
      },
    ]);
  }
  return result(
    payload.messages[0].content.includes("Prefers concise answers")
      ? "Your saved preference is concise answers with concrete examples."
      : "No saved writing preference is available in this conversation.",
  );
};
const base = (owner = "memory-fixture"): BrainState => ({
  userId: owner,
  tasks: [],
  goals: [],
  habits: [],
  journalEntries: [],
  knowledgeItems: [],
  sections: [],
  subsections: {},
  chatHistory: [],
  conversations: [
    {
      id: "past-fixture",
      title: "Study preferences",
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: "past-user",
          role: "user",
          content: "I prefer concrete examples when studying.",
          timestamp: "12:00",
        },
      ],
    },
  ],
  conversationId: crypto.randomUUID(),
  openRouterKey: "fixture-only",
  selectedModel: "fixture/model",
  theme: "light",
  agentMemory: emptyMemory(),
});
function Fixture() {
  const [state, setState] = useState<BrainState | null>(null),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string>();
  const latest = useRef(state);
  latest.current = state;
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    loadInitialState("memory-fixture").then((saved) =>
      setState({
        ...base(),
        agentMemory: saved.agentMemory,
        chatHistory: saved.chatHistory.filter(
          (m) =>
            m.role !== "assistant" ||
            m.rememberedIds ||
            m.content.includes("preference"),
        ),
        conversations: saved.conversations?.length
          ? saved.conversations
          : base().conversations,
      }),
    );
  }, []);
  useEffect(() => {
    if (state) {
      (window as any).__memoryState = state;
      persistBrainState(() => latest.current!, state.userId).catch(
        console.error,
      );
    }
  }, [state]);
  useEffect(() => {
    const show = (e: Event) => {
      setSelected((e as CustomEvent).detail?.id);
      setOpen(true);
    };
    window.addEventListener("synapse-open-memory", show);
    return () => window.removeEventListener("synapse-open-memory", show);
  }, []);
  const conversation = useBrainConversation(state, setState, () => {});
  if (!state) return <p>Loading fixture…</p>;
  return (
    <div
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "var(--silk-canvas)",
      }}
    >
      <div
        style={{
          padding: 14,
          display: "flex",
          gap: 20,
          color: "var(--silk-text)",
        }}
      >
        <button onClick={() => setOpen(true)}>Manage memory</button>
        <button
          onClick={() => document.documentElement.classList.toggle("dark")}
        >
          Toggle theme
        </button>
        <button
          onClick={() =>
            setState(
              base(
                state.userId === "memory-fixture"
                  ? "other-fixture"
                  : "memory-fixture",
              ),
            )
          }
        >
          Switch account
        </button>
        <button onClick={conversation.startNew}>New conversation</button>
      </div>
      <ChatWorkspace
        conversation={conversation}
        state={state}
        messages={conversation.messages || state.chatHistory}
      />
      {open && (
        <MemoryModal
          state={state}
          selectedId={selected}
          onClose={close}
          onChange={conversation.changeMemory}
          onOpenSource={() => {}}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);

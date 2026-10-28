import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { AIMessage, BrainState } from "../types";
import { AgentExecutionResult, AgentOptions, AutonomousBrainAgent, RunConversation } from "../services/agentDispatcher";
import { applyMutation } from "../services/brainTools";
import { persistBrainState } from "../services/storage";

export function useBrainConversation(state: BrainState | null, setState: Dispatch<SetStateAction<BrainState | null>>, onBeforeMutation: (state: BrainState) => void) {
  const latest = useRef(state);
  latest.current = state;
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  useEffect(() => () => active.current?.abort(), [state?.userId]);
  const run: RunConversation = async (prompt: string, options: AgentOptions = {}): Promise<AgentExecutionResult> => {
    if (active.current) throw new Error("A conversation is already running. Stop it before sending another message.");
    const initial = latest.current;
    if (!initial) throw new Error("Your records are still loading.");
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const publish = (next: BrainState) => { latest.current = next; setState(next); };
    const timestamp = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const user: AIMessage = { id: crypto.randomUUID(), role: "user", content: prompt, timestamp: timestamp() };
    publish({ ...initial, chatHistory: [...initial.chatHistory, user] });
    try {
      const result = await AutonomousBrainAgent.execute(prompt, initial, initial.openRouterKey, initial.selectedModel, {
        signal,
        onProgress: message => { setProgress(message); options.onProgress?.(message); },
        commit: async mutation => {
          signal.throwIfAborted();
          const before = latest.current;
          if (!before || before.userId !== initial.userId) throw new Error("Account changed; action stopped.");
          if (mutation.expected) {
            const current = mutation.type === "task" ? before.tasks.find(r => r.id === mutation.record.id) : before.habits.find(r => r.id === mutation.record.id);
            if (JSON.stringify(current) !== JSON.stringify(mutation.expected)) throw new Error("This record changed during the conversation. Start a new turn to review its current state.");
          }
          const audit = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), timeString: timestamp(), action: mutation.action, entityType: mutation.type,
            entityTitle: "name" in mutation.record ? mutation.record.name : mutation.record.title || "Note", canUndo: true };
          const next = { ...applyMutation(before, mutation), auditLog: [audit, ...(before.auditLog || [])].slice(0, 100) };
          await persistBrainState(next, initial.userId);
          if (latest.current?.userId === initial.userId) {
            onBeforeMutation(before);
            // Preserve unrelated edits made while the durable write was in progress.
            publish({ ...applyMutation(latest.current!, mutation), auditLog: [audit, ...(latest.current!.auditLog || [])].slice(0, 100) });
          }
        },
      });
      if (latest.current?.userId === initial.userId) {
        const assistant: AIMessage = { id: crypto.randomUUID(), role: "assistant", content: result.queryAnswer, timestamp: timestamp(),
          sources: result.citations.map(({ id, type, title, offset }) => ({ id, type, title, offset })) };
        publish({ ...latest.current!, chatHistory: [...latest.current!.chatHistory, assistant] });
      }
      return result;
    } finally {
      active.current = null;
      setBusy(false);
      setProgress("");
    }
  };
  return { run, busy, progress, stop: () => active.current?.abort() };
}

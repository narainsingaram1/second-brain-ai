import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { conversationTitle } from "../utils/chatPresentation";
import { boundConversations } from "../utils/conversationBudget";
import { attachmentOf, rememberImage } from "../utils/imageInput";
import { AIMessage, BrainState, ConversationThread } from "../types";
import {
  AutonomousBrainAgent,
  RunConversation,
} from "../services/agentDispatcher";
import { applyMutation, MUTATION_COLLECTIONS } from "../services/brainTools";
import { persistBrainState } from "../services/storage";
import { learnFromTurn } from "../services/memoryHistory";
import {
  applyMemoryChange,
  clearMemoryIndex,
  topicKey,
  normalizeAgentMemory,
  type AgentMemory,
  type MemoryChange,
} from "../services/agentMemory";
import {
  invalidateMemoryEmbedding,
  setMemoryAccount,
} from "../services/memorySemantic";

export interface BrainConversation {
  run: RunConversation;
  busy: boolean;
  progress: string;
  stop: () => void;
  startNew: () => void;
  resume: (id: string) => void;
  temporary?: boolean;
  setTemporary?: (temporary: boolean) => void;
  messages?: AIMessage[];
  changeMemory?: (change: MemoryChange) => Promise<AgentMemory>;
}
function archiveCurrent(state: BrainState): ConversationThread[] {
  const archived = state.conversations || [];
  if (!state.chatHistory.some((m) => m.role === "user")) return archived;
  const thread = {
    id: state.conversationId || crypto.randomUUID(),
    title: conversationTitle(state.chatHistory),
    messages: state.chatHistory,
    updatedAt: new Date().toISOString(),
  };
  return boundConversations([thread, ...archived.filter((t) => t.id !== thread.id)]);
}
export function useBrainConversation(
  state: BrainState | null,
  setState: Dispatch<SetStateAction<BrainState | null>>,
  onBeforeMutation: (state: BrainState) => void,
) {
  const latest = useRef(state);
  latest.current = state;
  const active = useRef<AbortController | null>(null);
  const learning = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState("");
  const [temporary, setTemporaryState] = useState(false),
    [temporaryMessages, setTemporaryMessages] = useState<AIMessage[]>([]);
  const tempLatest = useRef(temporaryMessages);
  tempLatest.current = temporaryMessages;
  const tempId = useRef(crypto.randomUUID());
  const publish = (next: BrainState) => {
    latest.current = next;
    setState(next);
  };
  useEffect(() => {
    generation.current++;
    active.current?.abort();
    active.current = null;
    learning.current?.abort();
    learning.current = null;
    clearMemoryIndex();
    setMemoryAccount(state?.userId || "guest");
    setTemporaryState(false);
    setTemporaryMessages([]);
    setBusy(false);
    setProgress("");
    return () => {
      generation.current++;
      active.current?.abort();
      learning.current?.abort();
      clearMemoryIndex();
      setMemoryAccount("");
    };
  }, [state?.userId]);
  const changeMemory = async (
    change: MemoryChange,
    agentOwned = false,
  ): Promise<AgentMemory> => {
    if (!agentOwned) active.current?.abort();
    const account = latest.current?.userId,
      run = generation.current;
    if (!latest.current) throw new Error("Workspace is loading.");
    let saved: AgentMemory | undefined;
    const previousEntries = normalizeAgentMemory(
      latest.current.agentMemory,
    ).entries;
    await persistBrainState(
      () => {
        const current = latest.current;
        if (
          !current ||
          current.userId !== account ||
          generation.current !== run
        )
          throw new Error("Account changed; memory save stopped.");
        saved = applyMemoryChange(current.agentMemory, change);
        return { ...current, agentMemory: saved };
      },
      account,
      (snapshot) => {
        const current = latest.current;
        if (
          !current ||
          current.userId !== account ||
          generation.current !== run
        )
          throw new Error("Account changed during memory save.");
        publish({ ...current, agentMemory: snapshot.agentMemory });
      },
    );
    clearMemoryIndex();
    if (change.kind !== "settings") {
      const changedIds = previousEntries
        .filter((previous) => {
          const next = saved!.entries.find((entry) => entry.id === previous.id);
          return (
            !next ||
            next.content !== previous.content ||
            next.topic !== previous.topic
          );
        })
        .map((entry) => entry.id);
      await Promise.all(
        changedIds.map((id) =>
          invalidateMemoryEmbedding(account || "guest", id),
        ),
      );
    }
    return saved!;
  };
  /**
   * After a reply is shown, the fast model checks the user's message for durable facts and
   * saves the ones that pass every memory gate, then marks the reply as "Remembered".
   * Failures are silent: learning is best effort and never blocks or alters the answer.
   */
  const learnInBackground = async (user: AIMessage, assistantId: string, reply: string) => {
    const account = latest.current?.userId, run = generation.current;
    const isCurrent = () => latest.current?.userId === account && generation.current === run;
    learning.current?.abort();
    const controller = new AbortController();
    learning.current = controller;
    try {
      if (!latest.current) return;
      const changes = await learnFromTurn(latest.current, user, reply, controller.signal);
      const ids: string[] = [];
      for (const change of changes) {
        if (controller.signal.aborted || !isCurrent()) return;
        try {
          const saved = await changeMemory(change, true);
          const entry = saved.entries.find((e) => topicKey(e.topic) === topicKey(change.entry.topic));
          if (entry) ids.push(entry.id);
        } catch {
          /* Forgotten topics, conflicts and limits reject the save; nothing else to do. */
        }
      }
      if (ids.length && isCurrent() && latest.current) {
        publish({
          ...latest.current,
          chatHistory: latest.current.chatHistory.map((m) =>
            m.id === assistantId ? { ...m, rememberedIds: [...new Set([...(m.rememberedIds || []), ...ids])] } : m,
          ),
        });
      }
    } catch {
      /* Provider errors and cancellation leave memory unchanged. */
    } finally {
      if (learning.current === controller) learning.current = null;
    }
  };
  const run: RunConversation = async (prompt, options = {}) => {
    if (active.current)
      throw new Error(
        "A conversation is already running. Stop it before sending another message.",
      );
    const workspace = latest.current;
    if (!workspace) throw new Error("Your records are still loading.");
    const runGeneration = generation.current;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const isCurrent = () =>
      latest.current?.userId === workspace.userId &&
      generation.current === runGeneration;
    const timestamp = () =>
      new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const images = options.images || [];
    images.forEach(rememberImage);
    const user: AIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      timestamp: timestamp(),
      ...(images.length ? { attachments: images.map(attachmentOf) } : {}),
    };
    const conversationId = workspace.conversationId || crypto.randomUUID();
    const initial = temporary
      ? {
          ...workspace,
          chatHistory: tempLatest.current,
          conversations: [],
          conversationId: tempId.current,
        }
      : { ...workspace, conversationId };
    if (temporary) {
      tempLatest.current = [...tempLatest.current, user];
      setTemporaryMessages(tempLatest.current);
    } else
      publish({
        ...workspace,
        conversationId,
        chatHistory: [...workspace.chatHistory, user],
      });
    try {
      const result = await AutonomousBrainAgent.execute(
        prompt,
        initial,
        initial.openRouterKey,
        initial.selectedModel,
        {
          ...options,
          signal,
          temporary,
          currentMessage: user,
          getMemory: () =>
            isCurrent()
              ? latest.current?.agentMemory
              : { ...normalizeAgentMemory(undefined), enabled: false },
          commitMemory: async (change) => {
            signal.throwIfAborted();
            if (!isCurrent()) throw new Error("Account changed.");
            const memory = await changeMemory(change, true);
            return memory;
          },
          onProgress: (message) => {
            if (isCurrent()) setProgress(message);
            options.onProgress?.(message);
          },
          commit: async (mutation) => {
            signal.throwIfAborted();
            const before = latest.current;
            if (!before || !isCurrent())
              throw new Error("Account changed; action stopped.");
            const audit = {
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              timeString: timestamp(),
              action: mutation.action,
              entityType: mutation.type,
              entityTitle:
                "name" in mutation.record
                  ? mutation.record.name
                  : mutation.record.title || "Note",
              canUndo: true,
            };
            await persistBrainState(
              () => {
                const current = latest.current;
                if (!current || !isCurrent())
                  throw new Error("Account changed; action stopped.");
                if (mutation.expected) {
                  const record = (
                    (current[MUTATION_COLLECTIONS[mutation.type]] || []) as Array<{ id: string }>
                  ).find((r) => r.id === mutation.record.id);
                  if (
                    JSON.stringify(record) !== JSON.stringify(mutation.expected)
                  )
                    throw new Error(
                      "This record changed during the conversation. Start a new turn to review its current state.",
                    );
                }
                return {
                  ...applyMutation(current, mutation),
                  auditLog: [audit, ...(current.auditLog || [])].slice(0, 100),
                };
              },
              initial.userId,
              () => {
                if (isCurrent()) {
                  onBeforeMutation(before);
                  publish({
                    ...applyMutation(latest.current!, mutation),
                    auditLog: [
                      audit,
                      ...(latest.current!.auditLog || []),
                    ].slice(0, 100),
                  });
                }
              },
            );
          },
        },
      );
      if (isCurrent()) {
        const assistant: AIMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.queryAnswer,
          timestamp: timestamp(),
          sources: result.citations.map(({ id, type, title, offset }) => ({
            id,
            type,
            title,
            offset,
          })),
          rememberedIds: result.rememberedIds,
          memoryNotice: result.memoryNotice,
        };
        // Keep the vision model's reading of the images with the message so follow-ups work after reload.
        const withDescription = (messages: AIMessage[]) => result.imageDescription
          ? messages.map(m => m.id === user.id ? { ...m, imageDescription: result.imageDescription!.slice(0, 12000) } : m)
          : messages;
        if (temporary) {
          tempLatest.current = [...withDescription(tempLatest.current), assistant];
          setTemporaryMessages(tempLatest.current);
        } else
          publish({
            ...latest.current!,
            chatHistory: [...withDescription(latest.current!.chatHistory), assistant],
          });
        // The main model already handled memory when it saved something this turn.
        if (!temporary && !result.rememberedIds?.length && (result.status === "complete" || result.status === "partial"))
          void learnInBackground(user, assistant.id, result.queryAnswer);
      }
      return result;
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
        setProgress("");
      }
    }
  };
  const switchConversation = (id?: string) => {
    if (active.current || !latest.current) return;
    if (temporary && !id) {
      tempId.current = crypto.randomUUID();
      tempLatest.current = [];
      setTemporaryMessages([]);
      return;
    }
    setTemporaryState(false);
    setTemporaryMessages([]);
    const current = latest.current,
      thread = id ? current.conversations?.find((t) => t.id === id) : undefined;
    if (id && !thread) return;
    publish({
      ...current,
      conversations: archiveCurrent(current).filter((t) => t.id !== id),
      conversationId: thread?.id || crypto.randomUUID(),
      chatHistory: thread?.messages || [],
    });
  };
  const setTemporary = (value: boolean) => {
    if (active.current) return;
    generation.current++;
    tempId.current = crypto.randomUUID();
    tempLatest.current = [];
    setTemporaryMessages([]);
    setTemporaryState(value);
  };
  return {
    run,
    busy,
    progress,
    stop: () => active.current?.abort(),
    startNew: () => switchConversation(),
    resume: (id: string) => switchConversation(id),
    temporary,
    setTemporary,
    messages: temporary ? temporaryMessages : state?.chatHistory,
    changeMemory,
  };
}

import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { conversationTitle } from "../utils/chatPresentation";
import { boundConversations } from "../utils/conversationBudget";
import { attachmentOf, rememberImage } from "../utils/imageInput";
import { AgentStep, AIMessage, ApprovalRequest, AuditLogEntry, BrainState, ConversationThread } from "../types";
import {
  AutonomousBrainAgent,
  RunConversation,
  type AgentExecutionResult,
} from "../services/agentDispatcher";
import { applyMutation, mutationRecords, recordTitle, type Mutation } from "../services/brainTools";
import { describeMutation } from "../services/actionPolicy";
import { applyBatch } from "../services/batchChanges";
import { prepareCardChanges, prepareChecklistTasks, type CardChange } from "../services/irisCards";
import type { IrisCardState, IrisUiSpec } from "../utils/irisUi";
import { persistBrainState } from "../services/storage";
import { adoptServerChanges, usesRecordStorage } from "../services/cloudSync";
import { isServerHeldKey } from "../services/providerTransport";
import { apiJson, readUrlOnServer, serverFeatures } from "../services/serverApi";
import type { SavedRecord } from "../services/recordSync";
import { MAX_REMOTE_TURN_BYTES, runRemoteTurn, type RemoteTurn } from "../services/remoteAgent";
import { getVisionModel } from "../services/openrouter";
import { webToolset } from "../services/webTools";
import { MemoryLearner, turnsOf, type LearnerStatus } from "../services/memoryLearning";
import { generateFollowUps } from "../services/chatSuggestions";
import {
  applyMemoryChange,
  clearMemoryIndex,
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
  decideApproval: (messageId: string, approvalId: string, decision: "approve" | "reject") => Promise<void>;
  /** Creates the checklist rows the user ticked on an interactive card. */
  addCardTasks: (messageId: string, block: number, spec: Extract<IrisUiSpec, { type: "checklist" }>, indexes: number[]) => Promise<void>;
  setCardState: (messageId: string, block: number, next: IrisCardState) => void;
  /** Ticks a task off (or back on) or marks a habit done, from a card showing live records. */
  changeFromCard: (changes: CardChange[]) => Promise<void>;
  busy: boolean;
  progress: string;
  /** The reply as it streams in, under the ID the finished message will keep. */
  draft: { id: string; content: string } | null;
  /** What the assistant is doing right now, step by step, while a reply is in progress. */
  activity: AgentStep[];
  /** Suggested next messages for the newest answer. */
  followUps?: { messageId: string; items: string[]; loading: boolean } | null;
  stop: () => void;
  startNew: () => void;
  resume: (id: string) => void;
  temporary?: boolean;
  setTemporary?: (temporary: boolean) => void;
  messages?: AIMessage[];
  changeMemory?: (change: MemoryChange) => Promise<AgentMemory>;
  memoryStatus?: LearnerStatus;
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
  const learner = useRef<MemoryLearner | null>(null);
  const changeMemoryRef = useRef<(change: MemoryChange, agentOwned?: boolean) => Promise<AgentMemory>>(null!);
  const [memoryStatus, setMemoryStatus] = useState<LearnerStatus>({ state: "idle" });
  const generation = useRef(0);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState("");
  const [draft, setDraft] = useState<{ id: string; content: string } | null>(null);
  const [activity, setActivity] = useState<AgentStep[]>([]);
  // Quick replies for the newest answer. Held here, not saved: they only matter until the next message.
  const [followUps, setFollowUps] = useState<{ messageId: string; items: string[]; loading: boolean } | null>(null);
  const followUpRequest = useRef<AbortController | null>(null);
  const clearFollowUps = () => { followUpRequest.current?.abort(); followUpRequest.current = null; setFollowUps(null); };
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
    clearMemoryIndex();
    setMemoryAccount(state?.userId || "guest");
    setTemporaryState(false);
    setTemporaryMessages([]);
    setBusy(false);
    setProgress("");
    setDraft(null);
    setActivity([]);
    clearFollowUps();
    setMemoryStatus({ state: "idle" });
    const background = new MemoryLearner({
      getState: () => latest.current,
      commit: (changes) => changeMemoryRef.current({ kind: "batch", changes }, true),
      onStatus: setMemoryStatus,
      // Marks the reply to each message that taught something, so the user can see and review it.
      onLearned: (byMessage) => {
        const current = latest.current;
        if (!current) return;
        const assistantAfter = new Map<string, string[]>();
        current.chatHistory.forEach((message, index) => {
          const ids = byMessage.get(message.id), next = current.chatHistory[index + 1];
          if (ids && next?.role === "assistant") assistantAfter.set(next.id, ids);
        });
        if (assistantAfter.size)
          publish({ ...current, chatHistory: current.chatHistory.map((m) => assistantAfter.has(m.id) ? { ...m, rememberedIds: [...new Set([...(m.rememberedIds || []), ...assistantAfter.get(m.id)!])] } : m) });
      },
    });
    learner.current = background;
    // Hiding the tab may be the last chance to read what was just said on this device.
    const flushHidden = () => { if (document.visibilityState === "hidden") void background.flush(); };
    document.addEventListener("visibilitychange", flushHidden);
    return () => {
      generation.current++;
      active.current?.abort();
      document.removeEventListener("visibilitychange", flushHidden);
      background.dispose();
      learner.current = null;
      clearMemoryIndex();
      setMemoryAccount("");
    };
  }, [state?.userId]);
  // Picks up anything in the open conversation not yet read, such as turns from before the tab last closed.
  const openConversation = state?.conversationId, loaded = Boolean(state);
  useEffect(() => {
    const current = latest.current;
    if (loaded && current) learner.current?.enqueue(turnsOf(current.chatHistory.slice(-40), current.conversationId || "current"));
  }, [loaded, openConversation, state?.userId]);
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
  changeMemoryRef.current = changeMemory;
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
    clearFollowUps();
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
    // Streamed text is applied at most once per frame, so long answers do not re-render per token.
    const assistantId = crypto.randomUUID();
    let streamedText = "", frame = 0, stepFrame = 0;
    // Steps arrive often (reasoning streams in); they are applied at most once per frame too.
    const steps = new Map<string, AgentStep>();
    setActivity([]);
    const onStep = (step: AgentStep) => {
      if (!isCurrent()) return;
      steps.set(step.id, step);
      if (!stepFrame) stepFrame = requestAnimationFrame(() => {
        stepFrame = 0;
        if (isCurrent() && active.current === controller) setActivity([...steps.values()]);
      });
    };
    const onText = (text: string) => {
      options.onText?.(text);
      if (!isCurrent()) return;
      streamedText = text;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (isCurrent() && active.current === controller) setDraft(streamedText ? { id: assistantId, content: streamedText } : null);
      });
    };
    // Hosted accounts whose key is stored on the server run the turn there; otherwise it runs here.
    const turn: RemoteTurn = {
      message: user, chatHistory: initial.chatHistory, conversationId: initial.conversationId, model: initial.selectedModel,
      visionModel: getVisionModel(), temporary, images: images.length ? images : undefined,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    const runsOnServer = async () => isServerHeldKey(initial.openRouterKey) && usesRecordStorage() && (await serverFeatures()).agent
      && new Blob([JSON.stringify(turn)]).size <= MAX_REMOTE_TURN_BYTES;
    const runOnServer = async () => {
      let saved = 0;
      try {
        // The server reads the workspace from the database, so pending edits are saved first.
        await persistBrainState(() => latest.current!, initial.userId);
        return await runRemoteTurn(turn, {
        signal,
        onText,
        onStep,
        onProgress: message => { if (isCurrent()) setProgress(message); options.onProgress?.(message); },
        onSaved: (records, preferences, action, entityType, title) => {
          const before = latest.current;
          if (!before || !isCurrent()) return;
          onBeforeMutation(before);
          const next = adoptServerChanges(before, records, preferences);
          if (entityType === "memory") { publish(next); return; }
          const audit = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), timeString: timestamp(), action,
            entityType: entityType as AuditLogEntry["entityType"], entityTitle: title, canUndo: true };
          publish({ ...next, auditLog: [audit, ...(next.auditLog || [])].slice(0, 100) });
          saved++;
        },
        });
      } catch (error) {
        // Same shape as a failed in-browser turn: say what happened and whether anything was saved.
        const cancelled = signal.aborted;
        const savedNote = saved ? `\n\n${saved} change${saved === 1 ? " was" : "s were"} saved before this stopped and remain saved.` : "\n\nNo changes were saved.";
        return { actionType: "query_brain", entityType: "query", headline: cancelled ? "Stopped" : "Assistant unavailable", explanation: saved ? `${saved} changes saved` : "No changes saved",
          queryAnswer: (cancelled ? "The request was stopped." : `I couldn’t finish this request: ${error instanceof Error ? error.message : "the server did not respond"}`) + savedNote,
          actions: [], citations: [], status: cancelled ? "cancelled" : "error", rememberedIds: [] } satisfies AgentExecutionResult;
      }
    };
    try {
      const result = await runsOnServer() ? await runOnServer() : await AutonomousBrainAgent.execute(
        prompt,
        initial,
        initial.openRouterKey,
        initial.selectedModel,
        {
          ...options,
          signal,
          temporary,
          currentMessage: user,
          // Search goes through the AI provider. Links are read by the app's server, since browsers can't
          // read most other sites; without a server (desktop builds) this browser tries them directly.
          externalTools: options.externalTools ?? webToolset({ fetch: (...args) => fetch(...args), manualRedirects: false, relay: readUrlOnServer }, initial.openRouterKey, initial.selectedModel),
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
          onText,
          onStep,
          onProgress: (message) => {
            if (isCurrent()) setProgress(message);
            options.onProgress?.(message);
          },
          // In-browser turns keep the prepared change with the reply until the user decides.
          propose: async (change) => ({ id: crypto.randomUUID(), tool: change.tool, summary: change.summary, details: change.details,
            reason: change.reason, status: "pending", remote: false, mutation: change.mutations ?? change.mutation }),
          // A batch is one write: every change lands or none does, with one undo point.
          commitBatch: async (mutations) => {
            signal.throwIfAborted();
            const before = latest.current;
            if (!before || !isCurrent()) throw new Error("Account changed; action stopped.");
            const audits = mutations.map(mutation => ({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), timeString: timestamp(),
              action: mutation.action, entityType: mutation.type, entityTitle: recordTitle(mutation.record, "Note"), canUndo: true })).reverse(); // Newest first.
            const apply = (base: BrainState) => {
              const next = applyBatch(base, mutations);
              return { ...next, auditLog: [...audits, ...(base.auditLog || [])].slice(0, 100) };
            };
            await persistBrainState(
              () => {
                const current = latest.current;
                if (!current || !isCurrent()) throw new Error("Account changed; action stopped.");
                return apply(current);
              },
              initial.userId,
              saved => {
                if (!isCurrent()) return;
                onBeforeMutation(before);
                // Keep anything edited while saving; if that edit touched these records, show what was saved.
                let shown = saved;
                try { shown = apply(latest.current!); } catch { /* Saved state is still correct. */ }
                publish(shown);
              },
            );
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
                recordTitle(mutation.record, "Note"),
              canUndo: true,
            };
            await persistBrainState(
              () => {
                const current = latest.current;
                if (!current || !isCurrent())
                  throw new Error("Account changed; action stopped.");
                if (mutation.expected) {
                  const record = mutationRecords(current, mutation.type).find(
                    (r) => r.id === mutation.record.id,
                  );
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
          id: assistantId,
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
          ...(result.approvals?.length ? { approvals: result.approvals } : {}),
          ...(result.actions?.length ? {
            actions: result.actions.map(m => {
              const { summary, details } = describeMutation(m.action, m);
              const title = recordTitle(m.record, "Untitled");
              return {
                action: m.action,
                type: m.type,
                id: m.record.id,
                title,
                summary,
                details,
                remove: !!m.remove,
              };
            }),
          } : {}),
          ...(result.external?.length ? { external: result.external } : {}),
          ...(result.activity?.length ? { activity: result.activity } : {}),
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
        // Temporary chats are never read. Everything else joins the background queue, which batches it.
        if (!temporary && (result.status === "complete" || result.status === "partial"))
          learner.current?.enqueue([{ message: user, reply: result.queryAnswer, conversationId: initial.conversationId || "current" }]);
        // Anything waiting on approval already has its next step on screen.
        if ((result.status === "complete" || result.status === "partial") && !result.approvals?.length && initial.openRouterKey?.trim()) {
          const request = new AbortController();
          followUpRequest.current = request;
          setFollowUps({ messageId: assistantId, items: [], loading: true });
          const changes = result.actions.map(m => `${m.action}: ${recordTitle(m.record, "note")}`);
          const earlierQuestions = initial.chatHistory.filter(m => m.role === "user").map(m => m.content);
          generateFollowUps(initial, { question: prompt, answer: result.queryAnswer, earlierQuestions, changes }, AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]))
            .catch(() => [] as string[])
            .then(items => { if (followUpRequest.current === request) setFollowUps({ messageId: assistantId, items, loading: false }); });
        }
      }
      return result;
    } finally {
      if (frame) cancelAnimationFrame(frame);
      if (stepFrame) cancelAnimationFrame(stepFrame);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
        setProgress("");
        setDraft(null);
        setActivity([]);
      }
    }
  };
  const switchConversation = (id?: string) => {
    if (active.current || !latest.current) return;
    clearFollowUps();
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
    clearFollowUps();
    generation.current++;
    tempId.current = crypto.randomUUID();
    tempLatest.current = [];
    setTemporaryMessages([]);
    setTemporaryState(value);
  };
  /** Updates one approval request on the message that carries it, wherever that conversation is shown. */
  const setApproval = (messageId: string, approvalId: string, patch: Partial<ApprovalRequest>) => {
    const update = (messages: AIMessage[]) => messages.map(m => m.id !== messageId ? m : { ...m, approvals: m.approvals?.map(a => a.id === approvalId ? { ...a, ...patch } : a) });
    if (tempLatest.current.some(m => m.id === messageId)) { tempLatest.current = update(tempLatest.current); setTemporaryMessages(tempLatest.current); return; }
    const current = latest.current;
    if (current) publish({ ...current, chatHistory: update(current.chatHistory) });
  };
  /**
   * Applies or rejects a change the assistant proposed. Hosted requests are decided and run on the server,
   * which re-checks the exact payload; local ones re-check that the record has not changed since.
   */
  const decideApproval = async (messageId: string, approvalId: string, decision: "approve" | "reject") => {
    const current = latest.current;
    const message = [...tempLatest.current, ...(current?.chatHistory || [])].find(m => m.id === messageId);
    const approval = message?.approvals?.find(a => a.id === approvalId);
    if (!current || !approval || approval.status !== "pending") return;
    if (approval.remote) {
      try {
        const result = await apiJson<{ status: "rejected" | "executed" | "failed"; error?: string; records?: SavedRecord[]; preferences?: Record<string, unknown>; action?: string; entityType?: string; title?: string }>(
          "/api/actions", { method: "POST", body: JSON.stringify({ id: approval.id, decision, payloadHash: approval.payloadHash }) });
        if (result.status === "executed" && latest.current) {
          onBeforeMutation(latest.current);
          const next = adoptServerChanges(latest.current, result.records || [], result.preferences);
          const audit = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), timeString: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            action: result.action || approval.tool, entityType: (result.entityType || "task") as AuditLogEntry["entityType"], entityTitle: result.title || approval.summary, canUndo: true };
          publish({ ...next, auditLog: [audit, ...(next.auditLog || [])].slice(0, 100) });
        }
        setApproval(messageId, approvalId, { status: result.status, ...(result.error ? { error: result.error } : {}) });
      } catch (error) {
        setApproval(messageId, approvalId, { status: "expired", error: error instanceof Error ? error.message : "This request is no longer available." });
      }
      return;
    }
    if (decision === "reject") { setApproval(messageId, approvalId, { status: "rejected" }); return; }
    if (Array.isArray(approval.mutation)) {
      // A batch: every change is re-checked against the state the ones before it leave, then applied together.
      const mutations = approval.mutation as Mutation[];
      let next: BrainState;
      try { next = applyBatch(current, mutations); } catch (error) {
        setApproval(messageId, approvalId, { status: "failed", error: error instanceof Error ? error.message : "These changes could not be applied." });
        return;
      }
      onBeforeMutation(current);
      const audits = mutations.map(mutation => ({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), timeString: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        action: mutation.action, entityType: mutation.type, entityTitle: recordTitle(mutation.record, "Note"), canUndo: true })).reverse();
      publish({ ...next, auditLog: [...audits, ...(current.auditLog || [])].slice(0, 100) });
      setApproval(messageId, approvalId, { status: "executed", mutation: undefined });
      return;
    }
    const mutation = approval.mutation as Mutation | undefined;
    const target = mutation && mutationRecords(current, mutation.type).find(r => r.id === mutation.record.id);
    if (!mutation || JSON.stringify(target ?? null) !== JSON.stringify(mutation.expected ?? null)) {
      setApproval(messageId, approvalId, { status: "failed", error: "The record changed after this was proposed, so it was not applied. Ask again to work from its current version." });
      return;
    }
    onBeforeMutation(current);
    const audit = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), timeString: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      action: mutation.action, entityType: mutation.type, entityTitle: recordTitle(mutation.record, "Note"), canUndo: true };
    publish({ ...applyMutation(current, mutation), auditLog: [audit, ...(current.auditLog || [])].slice(0, 100) });
    setApproval(messageId, approvalId, { status: "executed", mutation: undefined });
  };
  const withCardState = (messages: AIMessage[], messageId: string, block: number, change: (card: IrisCardState) => IrisCardState) =>
    messages.map(m => m.id !== messageId ? m : { ...m, cardState: { ...m.cardState, [block]: change(m.cardState?.[block] || {}) } });
  const setCardState = (messageId: string, block: number, next: IrisCardState) => {
    if (tempLatest.current.some(m => m.id === messageId)) { tempLatest.current = withCardState(tempLatest.current, messageId, block, () => next); setTemporaryMessages(tempLatest.current); return; }
    const current = latest.current;
    if (current) publish({ ...current, chatHistory: withCardState(current.chatHistory, messageId, block, () => next) });
  };
  /** Saves changes made from a card as the user's own edits, with one undo point and an audit entry each. */
  const commitFromCard = async (mutations: Mutation[], extra: (state: BrainState) => BrainState = s => s) => {
    const current = latest.current;
    if (!current) throw new Error("Workspace is loading.");
    const apply = (base: BrainState): BrainState => {
      const next = extra(mutations.reduce(applyMutation, base));
      const audits = mutations.map(mutation => ({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), timeString: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        action: mutation.action, entityType: mutation.type, entityTitle: recordTitle(mutation.record, "Task"), canUndo: true }));
      return { ...next, auditLog: [...audits, ...(next.auditLog || [])].slice(0, 100) };
    };
    await persistBrainState(() => apply(latest.current!), current.userId, () => {
      onBeforeMutation(latest.current!);
      publish(apply(latest.current!));
    });
  };
  const addCardTasks = async (messageId: string, block: number, spec: Extract<IrisUiSpec, { type: "checklist" }>, indexes: number[]) => {
    const current = latest.current;
    if (!current) throw new Error("Workspace is loading.");
    const message = [...tempLatest.current, ...current.chatHistory].find(m => m.id === messageId);
    const already = message?.cardState?.[block]?.added || {};
    const { mutations, added } = prepareChecklistTasks(current, spec, indexes.filter(index => already[index] === undefined));
    if (!mutations.length) return;
    const mark = (card: IrisCardState) => ({ ...card, added: { ...card.added, ...added } });
    await commitFromCard(mutations, next => ({ ...next, chatHistory: withCardState(next.chatHistory, messageId, block, mark) }));
    if (tempLatest.current.some(m => m.id === messageId)) { tempLatest.current = withCardState(tempLatest.current, messageId, block, mark); setTemporaryMessages(tempLatest.current); }
  };
  const changeFromCard = async (changes: CardChange[]) => {
    if (!latest.current) throw new Error("Workspace is loading.");
    await commitFromCard(prepareCardChanges(latest.current, changes));
  };
  return {
    run,
    decideApproval,
    addCardTasks,
    setCardState,
    changeFromCard,
    busy,
    progress,
    activity,
    draft,
    followUps,
    stop: () => active.current?.abort(),
    startNew: () => switchConversation(),
    resume: (id: string) => switchConversation(id),
    temporary,
    setTemporary,
    messages: temporary ? temporaryMessages : state?.chatHistory,
    changeMemory,
    memoryStatus,
  };
}

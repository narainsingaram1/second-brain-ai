import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { conversationTitle } from "../utils/chatPresentation";
import { boundConversations } from "../utils/conversationBudget";
import { attachmentOf, rememberImage, sessionImage, type PreparedImage } from "../utils/imageInput";
import { rememberFileText, savedFile, sessionFileText } from "../utils/chatFiles";
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
import { apiJson, readUrlOnServer, searchWebOnServer, serverFeatures } from "../services/serverApi";
import type { SavedRecord } from "../services/recordSync";
import { MAX_REMOTE_TURN_BYTES, runRemoteTurn, type RemoteTurn } from "../services/remoteAgent";
import { getVisionModel } from "../services/openrouter";
import { combineToolsets, webToolset } from "../services/webTools";
import { browserAgentEnabled, browserBridge, browserToolset, needsBrowser, type BrowserConfirmRequest } from "../services/browserAgent";
import type { UserAnswers, UserQuestionRequest } from "../services/askUser";
import { createAgentRouter, type ActivityToast } from "../services/toolRouter";
import { browserFiles } from "../services/browserFiles";
import { AgentAuditLog } from "../services/agentAudit";
import { loadUserPolicy, saveUserPolicy } from "../services/agentPolicy";
import { hasNativeApproval, nativeConfirm, withdrawNative } from "../services/nativeApproval";
import { nativeBrowserLink } from "../services/browserLink";
import { desktopReady, desktopToolset, needsDesktop } from "../services/desktopAgent";
import { needsVault, vaultToolset } from "../services/vaultAgent";

type BrowserAnswer = boolean | "deny_site";
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
  /** The open conversation is waiting on an answer. Other conversations may be answering at the same time. */
  busy: boolean;
  /** Conversations with a reply in progress, open or not. */
  runningIds?: string[];
  /** The id of the conversation on screen. */
  openId?: string;
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
  /**
   * Sends a user message again, optionally with new text, and answers it afresh. For an assistant message, its
   * question is asked again (regenerate). Later messages are dropped, unless `branch` keeps the original
   * conversation in the archive and continues in a new one.
   */
  resubmit?: (messageId: string, prompt?: string, options?: { branch?: boolean }) => Promise<AgentExecutionResult | undefined>;
  temporary?: boolean;
  setTemporary?: (temporary: boolean) => void;
  messages?: AIMessage[];
  changeMemory?: (change: MemoryChange) => Promise<AgentMemory>;
  memoryStatus?: LearnerStatus;
  /** A step on a website waiting for the user's go-ahead while the assistant works. */
  browserConfirm?: BrowserConfirmRequest | null;
  /** true allows, false declines, "deny_site" declines and turns the agent off for that site. */
  answerBrowserConfirm?: (answer: BrowserAnswer) => void;
  /** Soft (T1) steps the assistant just took on a website, shown without stopping it. */
  agentToasts?: ActivityToast[];
  dismissAgentToast?: (id: string) => void;
  /** Questions the assistant asked mid-task, waiting for the user's answers. */
  userQuestion?: UserQuestionRequest | null;
  /** The answers by question id, or null for "not now". */
  answerUserQuestion?: (answers: UserAnswers | null) => void;
}

/** How long a question waits for an answer before the assistant carries on without one. */
const QUESTION_WAIT_MS = 20 * 60_000;

/** Website work gets more room than an ordinary turn: pages load slowly and tasks take many steps. */
const BROWSER_BUDGET = { steps: 120, tools: 240, timeMs: 15 * 60_000 };
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
/** Changes one conversation's messages, whether it is the one on screen or waiting in the archive. */
function withMessages(state: BrainState, id: string, change: (messages: AIMessage[]) => AIMessage[]): BrainState {
  if (state.conversationId === id) return { ...state, chatHistory: change(state.chatHistory) };
  const thread = state.conversations?.find(t => t.id === id);
  if (!thread) return state;
  const updated = { ...thread, messages: change(thread.messages), updatedAt: new Date().toISOString() };
  return { ...state, conversations: boundConversations([updated, ...(state.conversations || []).filter(t => t.id !== id)]) };
}
/** What one conversation's reply in progress shows. */
interface RunView {
  progress: string;
  draft: { id: string; content: string } | null;
  activity: AgentStep[];
  browserConfirm: BrowserConfirmRequest | null;
  userQuestion: UserQuestionRequest | null;
  agentToasts: ActivityToast[];
}
const EMPTY_RUN: RunView = { progress: "", draft: null, activity: [], browserConfirm: null, userQuestion: null, agentToasts: [] };
export function useBrainConversation(
  state: BrainState | null,
  setState: Dispatch<SetStateAction<BrainState | null>>,
  onBeforeMutation: (state: BrainState) => void,
) {
  const latest = useRef(state);
  latest.current = state;
  // Each conversation answering right now, by conversation id. Several can run at once.
  const controllers = useRef(new Map<string, AbortController>());
  const [runs, setRuns] = useState<Record<string, RunView>>({});
  const patchRun = (id: string, patch: Partial<RunView> | ((run: RunView) => Partial<RunView>)) =>
    setRuns(previous => previous[id] ? { ...previous, [id]: { ...previous[id], ...(typeof patch === "function" ? patch(previous[id]) : patch) } } : previous);
  const abortAll = () => controllers.current.forEach(controller => controller.abort());
  const learner = useRef<MemoryLearner | null>(null);
  const changeMemoryRef = useRef<(change: MemoryChange, agentOwned?: boolean) => Promise<AgentMemory>>(null!);
  const [memoryStatus, setMemoryStatus] = useState<LearnerStatus>({ state: "idle" });
  const generation = useRef(0);
  const confirmResolvers = useRef(new Map<string, (answer: BrowserAnswer) => void>());
  const nativeConfirms = useRef(new Set<string>());
  const questionResolvers = useRef(new Map<string, (answers: UserAnswers | null) => void>());
  const dismissAgentToast = (id: string) => setRuns(previous => Object.fromEntries(Object.entries(previous).map(([key, run]) => [key, { ...run, agentToasts: run.agentToasts.filter(t => t.id !== id) }])));
  const answerConfirm = (runId: string, answer: BrowserAnswer) => {
    const resolve = confirmResolvers.current.get(runId); confirmResolvers.current.delete(runId); patchRun(runId, { browserConfirm: null });
    // In the desktop app only the approval window can allow; from here a request can only be withdrawn.
    if (nativeConfirms.current.has(runId)) { nativeConfirms.current.delete(runId); void withdrawNative(); return; }
    resolve?.(answer);
  };
  const answerQuestion = (runId: string, answers: UserAnswers | null) => {
    const resolve = questionResolvers.current.get(runId); questionResolvers.current.delete(runId); patchRun(runId, { userQuestion: null });
    resolve?.(answers);
  };
  // Quick replies for the newest answer. Held here, not saved: they only matter until the next message.
  const [followUps, setFollowUps] = useState<{ messageId: string; items: string[]; loading: boolean } | null>(null);
  const followUpRequest = useRef<AbortController | null>(null);
  const clearFollowUps = () => { followUpRequest.current?.abort(); followUpRequest.current = null; setFollowUps(null); };
  const [temporary, setTemporaryState] = useState(false),
    [temporaryMessages, setTemporaryMessages] = useState<AIMessage[]>([]);
  const tempLatest = useRef(temporaryMessages);
  tempLatest.current = temporaryMessages;
  const tempId = useRef(crypto.randomUUID());
  const temporaryRef = useRef(temporary);
  temporaryRef.current = temporary;
  /** The conversation on screen right now. */
  const currentOpenId = () => temporaryRef.current ? tempId.current : latest.current?.conversationId || "";
  const stopRun = (runId: string) => { answerConfirm(runId, false); answerQuestion(runId, null); controllers.current.get(runId)?.abort(); };
  const publish = (next: BrainState) => {
    latest.current = next;
    setState(next);
  };
  // ⌘⌥. (desktop app) stops the assistant: Rust halts desktop steps, this ends the turn and any browser work.
  useEffect(() => {
    if (!hasNativeApproval()) return;
    let unlisten: (() => void) | undefined, gone = false;
    void import("@tauri-apps/api/event").then(({ listen }) => listen("agent-stop", () => { [...controllers.current.keys()].forEach(stopRun); }))
      .then(off => { if (gone) off(); else unlisten = off; }).catch(() => {});
    return () => { gone = true; unlisten?.(); };
  }, []);
  useEffect(() => {
    generation.current++;
    abortAll();
    controllers.current.clear();
    clearMemoryIndex();
    setMemoryAccount(state?.userId || "guest");
    setTemporaryState(false);
    setTemporaryMessages([]);
    setRuns({});
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
      abortAll();
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
    if (!agentOwned) abortAll();
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
  /** One turn. `carried` keeps an edited message's images when only their description is left. */
  const runTurn = async (prompt: string, options: Parameters<RunConversation>[1] = {}, carried: Pick<AIMessage, "attachments" | "imageDescription"> = {}): Promise<AgentExecutionResult> => {
    const workspace = latest.current;
    if (!workspace) throw new Error("Your records are still loading.");
    const conversationId = workspace.conversationId || crypto.randomUUID();
    // The conversation this turn belongs to, even after the user moves to another one.
    const runId = temporary ? tempId.current : conversationId;
    if (controllers.current.has(runId))
      throw new Error("This chat is still answering. Stop it, or start a new chat to ask something else.");
    const runGeneration = generation.current;
    const controller = new AbortController();
    controllers.current.set(runId, controller);
    setRuns(previous => ({ ...previous, [runId]: EMPTY_RUN }));
    clearFollowUps();
    const live = () => controllers.current.get(runId) === controller;
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
    const files = options.files || [];
    files.forEach(rememberFileText);
    // The turn reads the whole extracted text; saved conversations keep a capped copy.
    const user: AIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      timestamp: timestamp(),
      ...(images.length ? { attachments: images.map(attachmentOf) } : carried.attachments?.length ? { attachments: carried.attachments } : {}),
      ...(!images.length && carried.imageDescription ? { imageDescription: carried.imageDescription } : {}),
      ...(files.length ? { files } : {}),
    };
    const saved: AIMessage = files.length ? { ...user, files: files.map(savedFile) } : user;
    const initial = temporary
      ? {
          ...workspace,
          chatHistory: tempLatest.current,
          conversations: [],
          conversationId: tempId.current,
        }
      : { ...workspace, conversationId };
    if (temporary) {
      tempLatest.current = [...tempLatest.current, saved];
      setTemporaryMessages(tempLatest.current);
    } else
      publish({
        ...workspace,
        conversationId,
        chatHistory: [...workspace.chatHistory, saved],
      });
    // Streamed text is applied at most once per frame, so long answers do not re-render per token.
    const assistantId = crypto.randomUUID();
    let streamedText = "", frame = 0, stepFrame = 0;
    // Steps arrive often (reasoning streams in); they are applied at most once per frame too.
    const steps = new Map<string, AgentStep>();
    const onStep = (step: AgentStep) => {
      if (!isCurrent()) return;
      steps.set(step.id, step);
      if (!stepFrame) stepFrame = requestAnimationFrame(() => {
        stepFrame = 0;
        if (isCurrent() && live()) patchRun(runId, { activity: [...steps.values()] });
      });
    };
    const onText = (text: string) => {
      options.onText?.(text);
      if (!isCurrent()) return;
      streamedText = text;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (isCurrent() && live()) patchRun(runId, { draft: streamedText ? { id: assistantId, content: streamedText } : null });
      });
    };
    // Hosted accounts whose key is stored on the server run the turn there; otherwise it runs here.
    const turn: RemoteTurn = {
      message: user, chatHistory: initial.chatHistory, conversationId: initial.conversationId, model: initial.selectedModel,
      visionModel: getVisionModel(), temporary, images: images.length ? images : undefined,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    // Work on websites runs here, where the browser extension is; the rest may run on the server.
    // In Chrome, the extension's bridge on this page; in the desktop app, Chrome through Rust (native messaging).
    const bridge = !browserAgentEnabled() ? null : hasNativeApproval() ? nativeBrowserLink() : browserBridge();
    const browser = bridge && needsBrowser(prompt, initial.chatHistory) && (await bridge.status()) === "ready" ? bridge : null;
    /** Stops the agent on a site for good: the user's policy, and the router for the rest of this request. */
    const neverOn = (site: string) => {
      const policy = loadUserPolicy();
      saveUserPolicy({ ...policy, deniedHosts: [...policy.deniedHosts, site] });
      router?.denyHost(site);
    };
    const confirmStep = async (request: BrowserConfirmRequest, stepSignal: AbortSignal): Promise<boolean> => {
      if (hasNativeApproval()) {
        // The chat shows that the assistant is waiting; the answer comes from the native window.
        nativeConfirms.current.add(runId);
        patchRun(runId, { browserConfirm: { ...request, native: true } });
        try {
          const decision = await nativeConfirm({ label: request.label, site: request.site, ...(request.reason ? { reason: request.reason } : {}),
            ...(request.screenshot ? { screenshot: request.screenshot } : {}), ...(request.grant ? { grant: request.grant } : {}) }, stepSignal);
          if (decision === "deny_site") neverOn(request.site);
          return decision === "allow";
        } catch (error) {
          if (stepSignal.aborted) return false;
          console.warn("Native approval window unavailable; asking in the chat instead.", error);
        } finally {
          nativeConfirms.current.delete(runId);
          patchRun(runId, run => ({ browserConfirm: run.browserConfirm?.id === request.id ? null : run.browserConfirm }));
        }
      }
      const answer = await askInChat(request, stepSignal);
      if (answer === "deny_site") neverOn(request.site);
      return answer === true;
    };
    /** A question the assistant asks mid-task: the card waits in the chat, and the turn goes on with the answers. */
    const askUser = (request: UserQuestionRequest, stepSignal: AbortSignal) => new Promise<UserAnswers | null>(resolve => {
      questionResolvers.current.get(runId)?.(null);
      const done = (answers: UserAnswers | null) => { stepSignal.removeEventListener("abort", onAbort); clearTimeout(timer); resolve(answers); };
      const onAbort = () => { if (questionResolvers.current.get(runId) === done) { questionResolvers.current.delete(runId); patchRun(runId, { userQuestion: null }); } done(null); };
      const timer = setTimeout(() => { if (questionResolvers.current.get(runId) === done) answerQuestion(runId, null); }, QUESTION_WAIT_MS);
      stepSignal.addEventListener("abort", onAbort, { once: true });
      questionResolvers.current.set(runId, done);
      if (isCurrent()) patchRun(runId, { userQuestion: request }); else done(null);
    });
    const askInChat = (request: BrowserConfirmRequest, stepSignal: AbortSignal) => new Promise<BrowserAnswer>(resolve => {
      confirmResolvers.current.get(runId)?.(false);
      const done = (answer: BrowserAnswer) => { stepSignal.removeEventListener("abort", onAbort); clearTimeout(timer); resolve(answer); };
      const onAbort = () => { if (confirmResolvers.current.get(runId) === done) { confirmResolvers.current.delete(runId); patchRun(runId, { browserConfirm: null }); } done(false); };
      const timer = setTimeout(() => { if (confirmResolvers.current.get(runId) === done) answerConfirm(runId, false); }, 5 * 60_000);
      stepSignal.addEventListener("abort", onAbort, { once: true });
      confirmResolvers.current.set(runId, done);
      patchRun(runId, { browserConfirm: request });
    });
    // Every browser step passes the router: policy, rate limits, text carried between sites, audit.
    // Native Mac apps, in the desktop app, when the request is about one and the user allowed some.
    const desktop = hasNativeApproval() && needsDesktop(prompt, initial.chatHistory) && await desktopReady();
    const router = browser || desktop ? createAgentRouter({
      policy: loadUserPolicy(), audit: new AgentAuditLog(), turnId: crypto.randomUUID(), confirm: confirmStep,
      notify: toast => {
        if (!isCurrent()) return;
        patchRun(runId, run => ({ agentToasts: [...run.agentToasts.slice(-2), toast] }));
        setTimeout(() => dismissAgentToast(toast.id), 5000);
      },
    }) : null;
    // Saved logins (macOS app): the assistant can see which sites have one, never a password.
    const vault = hasNativeApproval() && needsVault(prompt);
    const runsOnServer = async () => !browser && !desktop && !vault && isServerHeldKey(initial.openRouterKey) && usesRecordStorage() && (await serverFeatures()).agent
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
        onProgress: message => { if (isCurrent()) patchRun(runId, { progress: message }); options.onProgress?.(message); },
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
          externalTools: options.externalTools ?? combineToolsets(
            webToolset({ fetch: (...args) => fetch(...args), manualRedirects: false, relay: readUrlOnServer, search: searchWebOnServer }),
            browser && router ? router.wrap(browserToolset(browser, { confirm: router.confirm, files: browserFiles(() => latest.current, () => user) })) : undefined,
            desktop && router ? router.wrap(desktopToolset()) : undefined,
            vault ? vaultToolset() : undefined),
          ...(browser || desktop ? { budget: BROWSER_BUDGET } : {}),
          // Turns that run here can ask the user live; Telegram and server turns ask in the reply instead.
          ask: options.ask ?? askUser,
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
            if (isCurrent()) patchRun(runId, { progress: message });
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
          sources: result.citations.map(({ id, type, title, offset, url }) => ({
            id,
            type,
            title,
            offset,
            ...(url ? { url } : {}),
          })),
          ...(result.usage ? { usage: result.usage } : {}),
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
          // A temporary chat that was closed is gone, and so is its answer.
          if (tempId.current === runId) {
            tempLatest.current = [...withDescription(tempLatest.current), assistant];
            setTemporaryMessages(tempLatest.current);
          }
        } else
          // The answer goes to its own conversation, which may no longer be the one on screen.
          publish(withMessages(latest.current!, runId, messages => [...withDescription(messages), assistant]));
        // Temporary chats are never read. Everything else joins the background queue, which batches it.
        if (!temporary && (result.status === "complete" || result.status === "partial"))
          learner.current?.enqueue([{ message: saved, reply: result.queryAnswer, conversationId: initial.conversationId || "current" }]);
        // Anything waiting on approval already has its next step on screen.
        if (currentOpenId() === runId && (result.status === "complete" || result.status === "partial") && !result.approvals?.length && initial.openRouterKey?.trim()) {
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
      if (live()) {
        controllers.current.delete(runId);
        confirmResolvers.current.delete(runId);
        questionResolvers.current.delete(runId);
        nativeConfirms.current.delete(runId);
        setRuns(previous => { const { [runId]: _, ...rest } = previous; return rest; });
      }
    }
  };
  const run: RunConversation = (prompt, options) => runTurn(prompt, options);
  const resubmit = async (messageId: string, prompt?: string, { branch = false }: { branch?: boolean } = {}) => {
    const current = latest.current;
    if (!current || controllers.current.has(currentOpenId())) return undefined;
    const history = temporary ? tempLatest.current : current.chatHistory;
    let index = history.findIndex(m => m.id === messageId);
    while (index >= 0 && history[index].role !== "user") index--;
    if (index < 0) return undefined;
    const original = history[index], kept = history.slice(0, index);
    const text = prompt ?? original.content;
    // Images still held this session are looked at again; otherwise the earlier reading of them is kept.
    const images = (original.attachments || []).flatMap((a): PreparedImage[] => { const dataUrl = sessionImage(a.id); return dataUrl ? [{ ...a, dataUrl }] : []; });
    const allImages = !!original.attachments?.length && images.length === original.attachments.length;
    const files = original.files?.map(f => ({ ...f, text: sessionFileText(f.id) || f.text }));
    clearFollowUps();
    if (temporary) { tempLatest.current = kept; setTemporaryMessages(kept); }
    else if (branch) publish({ ...current, conversations: archiveCurrent(current), conversationId: crypto.randomUUID(), chatHistory: kept });
    else publish({ ...current, chatHistory: kept });
    return runTurn(text, { ...(allImages ? { images } : {}), ...(files?.length ? { files } : {}) },
      allImages ? {} : { attachments: original.attachments, imageDescription: original.imageDescription });
  };
  /** Opens another conversation. Replies in progress carry on and land in their own conversation. */
  const switchConversation = (id?: string) => {
    // A temporary chat is never saved, so it can only be left once it has finished.
    if (!latest.current || (temporaryRef.current && controllers.current.has(tempId.current))) return;
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
    if (controllers.current.has(tempId.current)) return;
    clearFollowUps();
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
  const openId = temporary ? tempId.current : state?.conversationId || "";
  const openRun = openId ? runs[openId] : undefined;
  return {
    run,
    resubmit,
    decideApproval,
    addCardTasks,
    setCardState,
    changeFromCard,
    busy: !!openRun,
    runningIds: Object.keys(runs),
    openId,
    progress: openRun?.progress || "",
    activity: openRun?.activity || [],
    draft: openRun?.draft || null,
    followUps,
    stop: () => stopRun(currentOpenId()),
    browserConfirm: openRun?.browserConfirm || null,
    answerBrowserConfirm: (answer: BrowserAnswer) => answerConfirm(currentOpenId(), answer),
    userQuestion: openRun?.userQuestion || null,
    answerUserQuestion: (answers: UserAnswers | null) => answerQuestion(currentOpenId(), answers),
    agentToasts: openRun?.agentToasts || [],
    dismissAgentToast,
    startNew: () => switchConversation(),
    resume: (id: string) => switchConversation(id),
    temporary,
    setTemporary,
    messages: temporary ? temporaryMessages : state?.chatHistory,
    changeMemory,
    memoryStatus,
  };
}

import { MemoryModal } from "./components/MemoryModal";
import { renameTaskIcon } from "./utils/taskAppearance";
import { followSubsectionRename } from "./utils/study";
import { managedAuthEnabled } from "./services/managedAuth";
import { CloudControls } from "./components/CloudControls";
import { cloudEnabled, cloudStatus, refreshCloud, REMOTE_CHANGE_EVENT } from "./services/cloudSync";
import { useBrainConversation } from "./hooks/useBrainConversation";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { BrainState, Task, Habit, JournalEntry, KnowledgeItem, AuthSession, AuditLogEntry, Goal, GoalStatus, TaskStatus, NoteFolder, CalendarEvent } from "./types";
import { loadInitialState, persistBrainState, writeEmergencySnapshot } from "./services/storage";
import { initAuth } from "./services/auth";
import { syncHabitStreaks, getLocalDateString } from "./utils/habitStreaks";
import { normalizeTask, setTaskStatus, toggleTaskCompleted } from "./utils/taskState";
import { synthesizeJournalWithAI, breakdownTaskWithAI } from "./services/openrouter";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { Sidebar } from "./components/Sidebar";
import { TopHeader } from "./components/TopHeader";
import { HomeView } from "./components/HomeView";
import { GoalsView } from "./components/GoalsView";
import { GoalModal } from "./components/GoalModal";
import { TaskMatrixView } from "./components/TaskMatrixView";
import { HabitsView } from "./components/HabitsView";
import { JournalView } from "./components/JournalView";
import { NotesWorkspace } from "./components/NotesWorkspace";
import { WorkspacesView } from "./components/WorkspacesView";
import { hydrateDocumentTexts } from "./services/studyDocuments";
import type { PreparedImage } from "./utils/imageInput";
import { OpenRouterSettingsModal } from "./components/OpenRouterSettingsModal";
import { TaskModal } from "./components/TaskModal";
import { EventModal } from "./components/EventModal";
import { HabitModal } from "./components/HabitModal";
import { KnowledgeModal } from "./components/KnowledgeModal";
import { ManagedAccountModal } from "./components/ManagedAccountModal";
import { AuthModal } from "./components/AuthModal";
import { UniversalQuickCapture } from "./components/UniversalQuickCapture";
import { SemanticMemoryVaultModal } from "./components/SemanticMemoryVaultModal";
import { SemanticGlobalSearch } from "./components/SemanticGlobalSearch";
import { AuditLogModal } from "./components/AuditLogModal";
import { dropLegacyVault, vectorVault } from "./services/vectorVault";
import { accessToken, finishGoogleConnect, getStoredKey, serverFeatures } from "./services/serverApi";
import { isServerHeldKey, SERVER_HELD_KEY, setProviderProxyAuth } from "./services/providerTransport";
import { Plus, CheckSquare, Flame, BookOpen, FolderPlus, X, Zap, Target, FileText } from "lucide-react";
import { AppSkeleton } from "./components/AppSkeleton";
import { rememberedTab, rememberTab, rememberTheme } from "./utils/startupMemory";

export const App: React.FC = () => {
  const [startupError, setStartupError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [state, setState] = useState<BrainState | null>(null);
  const [session, setSession] = useState<AuthSession>({ currentUser: null, isGuest: true });
  const [activeTab, setActiveTab] = useState<string>(rememberedTab);
  useEffect(() => rememberTab(activeTab), [activeTab]);
  const theme = state?.theme;
  useEffect(() => { if (theme) rememberTheme(theme); }, [theme]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const isChatTab = activeTab === "copilot";
  const [chatLaunchError, setChatLaunchError] = useState("");
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => document.documentElement.style.setProperty("--app-viewport-height", `${viewport?.height || window.innerHeight}px`);
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
      document.documentElement.style.removeProperty("--app-viewport-height");
    };
  }, []);

  // Modals state
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | undefined>();
  const closeMemory = useCallback(() => setIsMemoryOpen(false), []);
  useEffect(() => {
    const open = (event: Event) => { setSelectedMemoryId((event as CustomEvent<{ id?: string }>).detail?.id); setIsSettingsOpen(false); setIsMemoryOpen(true); };
    window.addEventListener("synapse-open-memory", open);
    return () => window.removeEventListener("synapse-open-memory", open);
  }, []);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalDefaultSection, setTaskModalDefaultSection] = useState<string>("Academic");
  const [taskModalDefaultSubsection, setTaskModalDefaultSubsection] = useState<string>("CS 1332");
  const [taskModalDefaultDueDate, setTaskModalDefaultDueDate] = useState<string>("");
  const [activeEditTask, setActiveEditTask] = useState<Task | null>(null);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [activeEditEvent, setActiveEditEvent] = useState<CalendarEvent | null>(null);
  const [eventModalDefaultDate, setEventModalDefaultDate] = useState<string>("");
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [activeEditGoal, setActiveEditGoal] = useState<Goal | null>(null);
  const [isHabitModalOpen, setIsHabitModalOpen] = useState(false);
  const [isKnowledgeModalOpen, setIsKnowledgeModalOpen] = useState(false);
  const [activeEditKnowledge, setActiveEditKnowledge] = useState<KnowledgeItem | null>(null);
  const [isQuickAddMenuOpen, setIsQuickAddMenuOpen] = useState(false);
  const [isQuickCaptureOpen, setIsQuickCaptureOpen] = useState(false);
  const [isVaultModalOpen, setIsVaultModalOpen] = useState(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [isAuditLogOpen, setIsAuditLogOpen] = useState(false);

  // Undo / Redo History Stack (30 rolling snapshots)
  const historyPast = useRef<BrainState[]>([]);
  const historyFuture = useRef<BrainState[]>([]);
  const lastMutation = useRef<{ key: string; at: number } | null>(null);
  useEffect(() => { historyPast.current = []; historyFuture.current = []; }, [state?.userId]);

  const conversation = useBrainConversation(state, setState, before => {
    historyPast.current = [...historyPast.current.slice(-29), before];
    lastMutation.current = null;
    historyFuture.current = [];
  });

  /** Opens the assistant with a message, from Home or any workspace. */
  const askAssistant = async (prompt: string, images?: PreparedImage[]) => {
    setChatLaunchError("");
    setActiveTab("copilot");
    try { await conversation.run(prompt, images?.length ? { images } : undefined); }
    catch (error) { setChatLaunchError(error instanceof Error ? error.message : "Could not send your message. Try again."); }
  };

  // Course document text lives outside the snapshot; load it so the assistant can search and read it.
  const studyDocumentKey = state?.study?.documents.map(d => d.id).join(",") || "";
  useEffect(() => {
    if (!state?.userId || !studyDocumentKey) return;
    hydrateDocumentTexts(state.userId, studyDocumentKey.split(",")).catch(() => {});
  }, [state?.userId, studyDocumentKey]);

  useEffect(() => {
    const updateSyncError = () => {
      const status = cloudStatus();
      setSyncError(cloudEnabled && !["Synced", "Saving…", "Connecting…"].includes(status) ? status : "");
    };
    updateSyncError();
    window.addEventListener("synapse-sync-status", updateSyncError);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const unsaved = !!pendingSave.current || savesInFlight.current > 0;
      flushSave();
      if (unsaved && latestSaveState.current) writeEmergencySnapshot(latestSaveState.current);
      if (cloudEnabled && (unsaved || cloudStatus() !== "Synced")) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("synapse-sync-status", updateSyncError);
    };
  }, []);

  // Load initial session & database state on mount
  useEffect(() => {
    let disposed = false;
    initAuth().then((authSession) => {
      if (disposed) return;
      setSession(authSession);
      return loadInitialState(authSession.currentUser?.id).then((loaded) => {
        if (disposed) return;
        setState(loaded);
        if (loaded.theme === "dark") {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }

        // Hosted accounts: use the provider key stored encrypted on the server when there is one.
        if (managedAuthEnabled && authSession.currentUser) {
          setProviderProxyAuth(accessToken);
          // Returning from Google's consent screen: finish connecting, then show the result in Settings.
          finishGoogleConnect().then(result => { if (result && !disposed) setIsSettingsOpen(true); }).catch(() => {});
          serverFeatures().then(async features => {
            if (!features.secrets || disposed) return;
            const stored = await getStoredKey();
            if (disposed) return;
            setState(prev => {
              if (!prev || prev.userId !== loaded.userId) return prev;
              if (stored.configured && !isServerHeldKey(prev.openRouterKey)) return { ...prev, openRouterKey: SERVER_HELD_KEY };
              if (!stored.configured && isServerHeldKey(prev.openRouterKey)) return { ...prev, openRouterKey: "" };
              return prev;
            });
          }).catch(() => {});
        }
        // Embed new or edited passages in the background, so the first search is fast.
        dropLegacyVault();
        if (loaded.openRouterKey?.trim()) {
          const warm = () => { if (!disposed) vectorVault.reindexBrain(loaded).catch(() => {}); };
          if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 10000 }); else setTimeout(warm, 3000);
        }
      });
    }).catch(error => { if (!disposed) setStartupError(error.message || "Could not load your records."); });
    return () => { disposed = true; };
  }, []);

  // Pull other devices' changes every 15 s, on focus, and right after a save finds a conflict. The latest
  // state is read when the download finishes, so the timer is not recreated on every edit.
  const hasState = !!state;
  useEffect(() => {
    if (!cloudEnabled || !hasState || conversation.busy) return;
    let disposed = false;
    const refresh = async () => {
      const base = latestSaveState.current;
      if (document.hidden || !base) return;
      const next = await refreshCloud(base, () => !disposed && latestSaveState.current?.userId === base.userId, () => latestSaveState.current);
      if (next && !disposed) { latestSaveState.current = next; setState(next); }
    };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener(REMOTE_CHANGE_EVENT, refresh);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener(REMOTE_CHANGE_EVENT, refresh); };
  }, [hasState, conversation.busy]);

  // Listen for Tauri native global hotkey event: ⌘⌥N or ⌥⇧N (open-quick-capture)
  useEffect(() => {
    if (!(window as any).__TAURI_INTERNALS__ && !(window as any).__TAURI__) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        return listen("open-quick-capture", () => {
          setIsQuickCaptureOpen(true);
        }).then((unsub) => {
          unlisten = unsub;
        });
      })
      .catch(() => {});

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const latestSaveState = useRef(state);
  latestSaveState.current = state;

  // Sync state to storage & database. The first change saves immediately; further changes within
  // 400 ms (typing, dragging, rapid toggles) are coalesced into one trailing write. If the page is hidden
  // or closed while a save is pending or in flight, a synchronous emergency copy is kept as well.
  const pendingSave = useRef<{ timer: number; userId?: string } | null>(null);
  const lastSaveAt = useRef(0);
  const savesInFlight = useRef(0);
  const saveNow = useCallback((userId?: string) => {
    lastSaveAt.current = Date.now();
    savesInFlight.current++;
    persistBrainState(() => {
      const latest = latestSaveState.current;
      if (!latest || latest.userId !== userId) throw new Error("Account changed; save stopped.");
      return latest;
    }, userId)
      .catch(error => console.error("State save failed:", error))
      .finally(() => { savesInFlight.current--; });
  }, []);
  const flushSave = useCallback(() => {
    const pending = pendingSave.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingSave.current = null;
    saveNow(pending.userId);
  }, [saveNow]);
  useEffect(() => {
    if (!state) return;
    if (pendingSave.current && pendingSave.current.userId !== state.userId) flushSave();
    if (!pendingSave.current && Date.now() - lastSaveAt.current > 400) {
      saveNow(state.userId);
      return;
    }
    if (pendingSave.current) window.clearTimeout(pendingSave.current.timer);
    pendingSave.current = { timer: window.setTimeout(flushSave, 400), userId: state.userId };
  }, [state, session, flushSave, saveNow]);
  useEffect(() => {
    const onHide = () => {
      const unsaved = !!pendingSave.current || savesInFlight.current > 0;
      flushSave();
      if (unsaved && latestSaveState.current) writeEmergencySnapshot(latestSaveState.current);
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") onHide(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      flushSave();
    };
  }, [flushSave]);

  // Handle switching or logging into user accounts
  const handleSessionChange = async (newSession: AuthSession) => {
    setSession(newSession);
    const loaded = await loadInitialState(newSession.currentUser?.id);
    setState(loaded);
  };

  // Record State Mutation in Audit Log & Undo Stack.
  // State is updated immutably everywhere, so snapshots are kept by reference (structural sharing)
  // instead of deep-copying the whole workspace on every change.
  const recordMutation = (
    action: string,
    entityType: "task" | "habit" | "journal" | "knowledge" | "section" | "goal" | "event",
    entityTitle: string,
    details?: string
  ) => {
    if (!state) return;
    // Repeated edits to the same record (e.g. note autosaves while typing) form one undo step and one audit entry.
    const key = `${action}|${entityType}|${entityTitle}`;
    const now = Date.now();
    const coalesce = action.startsWith("Updated") && lastMutation.current?.key === key && now - lastMutation.current.at < 120000;
    lastMutation.current = { key, at: now };
    if (coalesce) return;
    historyPast.current = [...historyPast.current.slice(-29), state];
    historyFuture.current = [];

    const entry: AuditLogEntry = {
      id: `audit-${now}`,
      timestamp: new Date(now).toISOString(),
      timeString: new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      action,
      entityType,
      entityTitle,
      details,
      canUndo: true,
    };

    setState((prev) => (prev ? {
      ...prev,
      auditLog: [entry, ...(prev.auditLog || []).slice(0, 99)],
    } : null));
  };

  // ⌘Z Undo Handler
  const handleUndo = () => {
    if (historyPast.current.length === 0 || !state) return;
    const previousState = historyPast.current.pop()!;
    historyFuture.current.push(state);
    lastMutation.current = null;
    setState(current => current ? { ...previousState, agentMemory: current.agentMemory } : current);
  };

  // ⌘⇧Z / ⌘Y Redo Handler
  const handleRedo = () => {
    if (historyFuture.current.length === 0 || !state) return;
    const nextState = historyFuture.current.pop()!;
    historyPast.current.push(state);
    lastMutation.current = null;
    setState(current => current ? { ...nextState, agentMemory: current.agentMemory } : current);
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest("input, textarea, select"))) return;
      // ⌘Z Undo (without shift)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === "KeyZ") {
        e.preventDefault();
        handleUndo();
        return;
      }

      // ⌘⇧Z or ⌘Y Redo
      if (
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyZ") ||
        ((e.metaKey || e.ctrlKey) && e.code === "KeyY")
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // ⌘K: Real Semantic Global Search Omnibar
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsGlobalSearchOpen((prev) => !prev);
        return;
      }

      // ⌘⌥N (Cmd+Option+N / Ctrl+Alt+N) or ⌥⇧N (Option+Shift+N): Universal Quick Capture
      const isAltN = e.altKey && (e.key.toLowerCase() === "n" || e.code === "KeyN");
      if (((e.metaKey || e.ctrlKey) && isAltN) || (e.shiftKey && isAltN)) {
        e.preventDefault();
        e.stopPropagation();
        setIsQuickCaptureOpen(true);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "n" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setActiveEditTask(null);
        const sec = state?.sections[0] || "Academic";
        const sub = state?.subsections[sec]?.[0] || "General";
        setTaskModalDefaultSection(sec);
        setTaskModalDefaultSubsection(sub);
        setIsTaskModalOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state]);

  if (startupError) return <div className="p-8"><p>{startupError}</p><button onClick={() => window.location.reload()}>Retry</button></div>;

  if (!state) return <AppSkeleton />;

  // Toggle Theme
  const handleToggleTheme = () => {
    const newTheme = state.theme === "dark" ? "light" : "dark";
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    setState((prev) => (prev ? { ...prev, theme: newTheme } : null));
  };

  // Task Handlers
  const handleToggleTask = (taskId: string) => {
    const taskObj = state?.tasks.find((t) => t.id === taskId);
    if (taskObj) {
      recordMutation(taskObj.status === "completed" ? "Reopened Task" : "Completed Task", "task", taskObj.title);
    }
    setState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === taskId ? toggleTaskCompleted(t) : t)),
      };
    });
  };

  const handleStatusChange = (taskId: string, status: TaskStatus) => {
    const taskObj = state?.tasks.find((t) => t.id === taskId);
    if (taskObj) {
      recordMutation(`Status -> ${status.replace("_", " ")}`, "task", taskObj.title);
    }
    setState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === taskId ? setTaskStatus(t, status) : t)),
      };
    });
  };

  const handleSaveTask = (task: Task) => {
    const normalized = normalizeTask(task);
    const exists = state?.tasks.some((t) => t.id === normalized.id);
    recordMutation(exists ? "Updated Task" : "Created Task", "task", normalized.title);

    setState((prev) => {
      if (!prev) return null;
      const isExist = prev.tasks.some((t) => t.id === normalized.id);
      return {
        ...prev,
        tasks: isExist
          ? prev.tasks.map((t) => (t.id === normalized.id ? normalized : t))
          : [normalized, ...prev.tasks],
      };
    });
    // Auto-update Semantic Memory Vault
  };

  const openNewTask = (section?: string, subsection?: string, defaultDueDate?: string) => {
    const sec = section || state?.sections[0] || "Academic";
    setTaskModalDefaultSection(sec);
    setTaskModalDefaultSubsection(subsection || state?.subsections[sec]?.[0] || "General");
    setTaskModalDefaultDueDate(defaultDueDate || getLocalDateString());
    setActiveEditTask(null);
    setIsTaskModalOpen(true);
  };
  const openEditTask = (task: Task) => {
    setActiveEditTask(task);
    setIsTaskModalOpen(true);
  };

  const openNewEvent = (date?: string) => {
    setActiveEditEvent(null);
    setEventModalDefaultDate(date || getLocalDateString());
    setIsEventModalOpen(true);
  };
  const openEditEvent = (event: CalendarEvent) => {
    setActiveEditEvent(event);
    setIsEventModalOpen(true);
  };
  const handleSaveEvent = (event: CalendarEvent) => {
    const exists = state?.events?.some((e) => e.id === event.id);
    recordMutation(exists ? "Updated Event" : "Created Event", "event", event.title, `${event.date}${event.startTime ? ` ${event.startTime}` : ""}`);
    setState((prev) => {
      if (!prev) return null;
      const list = prev.events || [];
      return { ...prev, events: list.some((e) => e.id === event.id) ? list.map((e) => (e.id === event.id ? event : e)) : [...list, event] };
    });
  };
  const handleDeleteEvent = (eventId: string) => {
    const event = state?.events?.find((e) => e.id === eventId);
    if (event) recordMutation("Deleted Event", "event", event.title, event.date);
    setState((prev) => (prev ? { ...prev, events: (prev.events || []).filter((e) => e.id !== eventId) } : prev));
  };

  const handleDeleteTask = (taskId: string) => {
    const taskObj = state?.tasks.find((t) => t.id === taskId);
    if (taskObj) {
      recordMutation("Deleted Task", "task", taskObj.title, `Section: ${taskObj.section}`);
    }
    setState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== taskId),
      };
    });
  };

  // Section Management Handlers
  const handleAddSection = (sectionName: string) => {
    const trimmed = sectionName.trim();
    if (!trimmed) return;
    setState((prev) => {
      if (!prev) return null;
      if (prev.sections.includes(trimmed)) return prev;
      return {
        ...prev,
        sections: [...prev.sections, trimmed],
        subsections: {
          ...prev.subsections,
          [trimmed]: ["General"],
        },
      };
    });
  };

  const handleDeleteSection = (sectionName: string) => {
    recordMutation("Deleted Section", "section", sectionName);
    setState((prev) => {
      if (!prev) return null;
      const remainingSections = prev.sections.filter((s) => s !== sectionName);
      if (remainingSections.length === 0) return prev;
      const fallbackSec = remainingSections[0];
      const fallbackSub = prev.subsections[fallbackSec]?.[0] || "General";

      // Reassign tasks to fallback section and subsection
      const updatedTasks = prev.tasks.map((t) =>
        t.section === sectionName ? { ...t, section: fallbackSec, subsection: fallbackSub } : t
      );

      const updatedSubs = { ...prev.subsections };
      delete updatedSubs[sectionName];

      return {
        ...prev,
        sections: remainingSections,
        subsections: updatedSubs,
        tasks: updatedTasks,
      };
    });
  };

  // Subsection Management Handlers
  const handleAddSubsection = (section: string, subsectionName: string) => {
    const trimmed = subsectionName.trim();
    if (!trimmed) return;
    setState((prev) => {
      if (!prev) return null;
      const currentSubs = prev.subsections[section] || ["General"];
      if (currentSubs.includes(trimmed)) return prev;
      return {
        ...prev,
        subsections: {
          ...prev.subsections,
          [section]: [...currentSubs, trimmed],
        },
      };
    });
  };

  const handleDeleteSubsection = (section: string, subsectionName: string) => {
    setState((prev) => {
      if (!prev) return null;
      const currentSubs = prev.subsections[section] || ["General"];
      const remainingSubs = currentSubs.filter((s) => s !== subsectionName);
      if (remainingSubs.length === 0) return prev;
      const fallbackSub = remainingSubs[0];

      // Reassign tasks in this subsection
      const updatedTasks = prev.tasks.map((t) =>
        t.section === section && (t.subsection || "General") === subsectionName
          ? { ...t, subsection: fallbackSub }
          : t
      );

      return {
        ...prev,
        subsections: {
          ...prev.subsections,
          [section]: remainingSubs,
        },
        tasks: updatedTasks,
      };
    });
  };

  const handleRenameSubsection = (section: string, oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    setState((prev) => {
      if (!prev) return null;
      const currentSubs = prev.subsections[section] || ["General"];
      if (currentSubs.includes(trimmed)) {
        alert(`A subsection named "${trimmed}" already exists in ${section}.`);
        return prev;
      }
      const updatedSubs = currentSubs.map((s) => (s === oldName ? trimmed : s));
      const updatedTasks = prev.tasks.map((t) =>
        t.section === section && (t.subsection || "General") === oldName
          ? { ...t, subsection: trimmed }
          : t
      );
      return followSubsectionRename({
        ...prev,
        taskAppearance: renameTaskIcon(prev.taskAppearance, section, oldName, trimmed),
        subsections: {
          ...prev.subsections,
          [section]: updatedSubs,
        },
        tasks: updatedTasks,
      }, section, oldName, trimmed);
    });
  };

  const handleMoveTask = (taskId: string, targetSection: string, targetSubsection?: string) => {
    setState((prev) => {
      if (!prev) return null;
      const subs = prev.subsections[targetSection] || ["General"];
      const sub = targetSubsection || subs[0] || "General";
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === taskId ? { ...t, section: targetSection, subsection: sub } : t
        ),
      };
    });
  };

  // Habit Handlers (Real continuously computed streaks)
  const handleToggleHabit = (habitId: string, customDate?: string) => {
    const habitObj = state?.habits.find((h) => h.id === habitId);
    if (habitObj) {
      recordMutation("Toggled Habit", "habit", habitObj.name);
    }
    const targetDate = customDate || getLocalDateString();
    setState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        habits: prev.habits.map((h) => {
          if (h.id !== habitId) return h;
          const isDone = !!h.history[targetDate];
          const newHistory = { ...h.history, [targetDate]: !isDone };
          return syncHabitStreaks({ ...h, history: newHistory });
        }),
      };
    });
  };

  const handleSaveHabit = (habit: Habit) => {
    const synced = syncHabitStreaks(habit);
    const exists = state?.habits.some((h) => h.id === synced.id);
    recordMutation(exists ? "Updated Habit" : "Created Habit", "habit", synced.name);

    setState((prev) => {
      if (!prev) return null;
      const isExist = prev.habits.some((h) => h.id === synced.id);
      return {
        ...prev,
        habits: isExist
          ? prev.habits.map((h) => (h.id === synced.id ? synced : h))
          : [...prev.habits, synced],
      };
    });
  };

  // Goal Handlers (Macro Life Improvement & Horizons)
  const handleSaveGoal = (goal: Goal) => {
    const exists = state?.goals?.some((g) => g.id === goal.id);
    recordMutation(exists ? "Updated Life Goal" : "Created Life Goal", "goal", goal.title);

    setState((prev) => {
      if (!prev) return null;
      const currentGoals = prev.goals || [];
      const isExist = currentGoals.some((g) => g.id === goal.id);
      return {
        ...prev,
        goals: isExist
          ? currentGoals.map((g) => (g.id === goal.id ? goal : g))
          : [goal, ...currentGoals],
      };
    });
  };

  const handleDeleteGoal = (goalId: string) => {
    const goalObj = state?.goals?.find((g) => g.id === goalId);
    if (goalObj) {
      recordMutation("Deleted Life Goal", "goal", goalObj.title);
    }
    setState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        goals: (prev.goals || []).filter((g) => g.id !== goalId),
      };
    });
  };

  const handleToggleMilestone = (goalId: string, milestoneId: string) => {
    setState((prev) => {
      if (!prev) return null;
      const updatedGoals = (prev.goals || []).map((goal) => {
        if (goal.id !== goalId) return goal;
        const updatedMilestones = (goal.milestones || []).map((m) =>
          m.id === milestoneId ? { ...m, completed: !m.completed } : m
        );
        const completedCount = updatedMilestones.filter((m) => m.completed).length;
        const progress = updatedMilestones.length > 0
          ? Math.round((completedCount / updatedMilestones.length) * 100)
          : goal.progress;
        const status = progress === 100 ? ("achieved" as GoalStatus) : (goal.status === "achieved" ? ("in_progress" as GoalStatus) : goal.status);
        const updatedGoal = {
          ...goal,
          milestones: updatedMilestones,
          progress,
          status,
        };
        return updatedGoal;
      });
      return {
        ...prev,
        goals: updatedGoals,
      };
    });
  };

  const handleUpdateGoalStatus = (goalId: string, status: GoalStatus) => {
    setState((prev) => {
      if (!prev) return null;
      const updatedGoals = (prev.goals || []).map((g) => {
        if (g.id !== goalId) return g;
        const progress = status === "achieved" ? 100 : (g.progress === 100 ? 50 : g.progress);
        const updated = { ...g, status, progress };
        return updated;
      });
      return {
        ...prev,
        goals: updatedGoals,
      };
    });
  };

  // Journal Handlers
  const handleSaveJournalEntry = (entry: JournalEntry) => {
    recordMutation("Saved Journal Reflection", "journal", entry.title);
    setState((prev) => {
      if (!prev) return null;
      const exists = prev.journalEntries.some((j) => j.id === entry.id || j.date === entry.date);
      return {
        ...prev,
        journalEntries: exists
          ? prev.journalEntries.map((j) => (j.id === entry.id || j.date === entry.date ? entry : j))
          : [entry, ...prev.journalEntries],
      };
    });
  };

  const handleSynthesizeAI = async (entry: JournalEntry) => {
    return synthesizeJournalWithAI(
      entry,
      state.tasks,
      state.habits,
      state.openRouterKey,
      state.selectedModel
    );
  };

  // Knowledge & Notes Handlers
  const handleSaveKnowledge = (item: KnowledgeItem) => {
    const normalizedItem: KnowledgeItem = {
      ...item,
      title: item.title || item.subject,
      subject: item.title || item.subject,
      content: item.content || item.summary || "",
      summary:
        item.summary ||
        (item.content && item.content.length > 200
          ? item.content.slice(0, 197) + "..."
          : item.content || item.subject),
      updatedAt: new Date().toISOString(),
    };

    const exists = state?.knowledgeItems.some((k) => k.id === normalizedItem.id);
    recordMutation(exists ? "Updated Note" : "Created Note", "knowledge", normalizedItem.subject);

    setState((prev) => {
      if (!prev) return null;
      const isExist = prev.knowledgeItems.some((k) => k.id === normalizedItem.id);
      return {
        ...prev,
        knowledgeItems: isExist
          ? prev.knowledgeItems.map((k) => (k.id === normalizedItem.id ? normalizedItem : k))
          : [normalizedItem, ...prev.knowledgeItems],
      };
    });
  };

  const handleDeleteKnowledge = (id: string) => {
    const itemObj = state?.knowledgeItems.find((k) => k.id === id);
    if (itemObj) {
      recordMutation("Deleted Note", "knowledge", itemObj.subject);
    }
    setState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        knowledgeItems: prev.knowledgeItems.filter((k) => k.id !== id),
      };
    });
  };

  // Folder Handlers
  const handleSaveFolder = (folder: NoteFolder) => {
    const exists = (state?.noteFolders || []).some((f) => f.id === folder.id);
    recordMutation(exists ? "Updated Folder" : "Created Folder", "knowledge", folder.name);

    setState((prev) => {
      if (!prev) return null;
      const currentFolders = prev.noteFolders || [];
      const isExist = currentFolders.some((f) => f.id === folder.id);
      return {
        ...prev,
        noteFolders: isExist
          ? currentFolders.map((f) => (f.id === folder.id ? folder : f))
          : [...currentFolders, folder],
      };
    });
  };

  const handleDeleteFolder = (id: string) => {
    const folderObj = (state?.noteFolders || []).find((f) => f.id === id);
    if (folderObj) {
      recordMutation("Deleted Folder", "knowledge", folderObj.name);
    }
    setState((prev) => {
      if (!prev) return null;
      const currentFolders = prev.noteFolders || [];
      const parentId = folderObj?.parentId || null;

      // Safely move child notes inside deleted folder to parent folder or root
      const updatedNotes = prev.knowledgeItems.map((note) =>
        note.folderId === id ? { ...note, folderId: parentId } : note
      );

      // Move any child subfolders to parent folder
      const updatedFolders = currentFolders
        .filter((f) => f.id !== id)
        .map((f) => (f.parentId === id ? { ...f, parentId } : f));

      return {
        ...prev,
        knowledgeItems: updatedNotes,
        noteFolders: updatedFolders,
      };
    });
  };

  // OpenRouter Key & Model
  const handleSaveOpenRouterKey = (key: string) => {
    setState((prev) => (prev ? { ...prev, openRouterKey: key } : null));
  };

  const handleSelectModel = (model: string) => {
    setState((prev) => (prev ? { ...prev, selectedModel: model } : null));
  };

  // Backup Export
  const handleExportBackup = async () => {
    const jsonStr = JSON.stringify(state, null, 2);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string>("export_backup", {
        content: jsonStr,
        filename: `synapse_backup_${new Date().toISOString().split("T")[0]}.json`,
      });
      alert(`Backup exported successfully to:\n${path}`);
    } catch {
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `synapse_backup_${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Task AI Breakdown
  const handleTriggerAIBreakdown = async (task: Task) => {
    if (!state.openRouterKey) {
      setIsSettingsOpen(true);
      return;
    }
    try {
      const subtasks = await breakdownTaskWithAI(task.title, state.openRouterKey, state.selectedModel);
      const newSubObjects = subtasks.map((t, idx) => ({
        id: `sub-${Date.now()}-${idx}`,
        title: t,
        completed: false,
      }));
      handleSaveTask({ ...task, subtasks: [...(task.subtasks || []), ...newSubObjects] });
    } catch (err: any) {
      alert("AI breakdown error: " + err.message);
    }
  };

  return (
    <div className="synapse-app h-[var(--app-viewport-height,100dvh)] overflow-hidden flex font-sans transition-colors duration-300 relative">
      {syncError && !isSettingsOpen && (
        <div role="alert" className="fixed bottom-4 left-4 right-4 sm:left-auto sm:max-w-md z-50 rounded-2xl border border-line bg-raised dark:bg-slate-900 p-4 text-xs text-amber-900 dark:text-amber-200 shadow-lg">
          <p>{syncError}</p>
          <button type="button" onClick={() => setIsSettingsOpen(true)} className="mt-2 font-semibold underline">
            Open sync settings
          </button>
        </div>
      )}

      <a className="skip-link" href="#main-content">Skip to content</a>
      {/* Left Sidebar */}
      <Sidebar
        activeTab={activeTab}
        workspaces={state.workspaces}
        counts={{ tasks: state.tasks.filter(task => !task.completed).length, notes: state.knowledgeItems.length, goals: state.goals.filter(goal => goal.status !== "achieved").length }}
        onQuickCapture={() => setIsQuickCaptureOpen(true)}
        setActiveTab={setActiveTab}
        collapsed={isSidebarCollapsed || isNarrow}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Main View Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full relative z-10 overflow-hidden">
        {/* Top Right Header matching screenshot */}
        <TopHeader
          activeTab={activeTab}
          pageTitle={activeTab.startsWith("workspace:") ? state.workspaces?.find(workspace => workspace.id === activeTab.slice(10))?.name || "Workspaces" : activeTab.startsWith("workspace") ? "Workspaces" : undefined}
          onOpenGlobalSearch={() => setIsGlobalSearchOpen(true)}
          theme={state.theme}
          onToggleTheme={handleToggleTheme}
          session={session}
          onOpenAuth={() => managedAuthEnabled ? setIsAuthModalOpen(true) : cloudEnabled ? window.location.assign("/signout-with-chatgpt?return_to=/") : setIsAuthModalOpen(true)}
          onOpenNotifications={() => setIsAuditLogOpen(true)}
        />

        {/* Main Content Viewport */}
        <main id="main-content" className={`workspace-main flex-1 min-h-0 w-full ${isChatTab ? "flex flex-col overflow-hidden" : "overflow-y-auto"}`}>
          {isChatTab ? (
            <ChatWorkspace conversation={conversation} state={state} messages={conversation.messages || state.chatHistory} onSaveNote={handleSaveKnowledge} onOpenSettings={() => setIsSettingsOpen(true)} externalError={chatLaunchError} />
          ) : activeTab === "home" ? (
            <HomeView
              conversation={conversation}
              brainState={state}
              displayName={session.currentUser?.name}
              onToggleTask={handleToggleTask}
              onEditTask={task => { setActiveEditTask(task); setIsTaskModalOpen(true); }}
              onEditEvent={openEditEvent}
              onOpenNote={note => { setActiveEditKnowledge(note); setActiveTab("knowledge"); }}
              onAsk={askAssistant}
              onNavigate={setActiveTab}
              onNewTask={() => {
                const section = state.sections[0] || "Academic";
                setActiveEditTask(null);
                setTaskModalDefaultSection(section);
                setTaskModalDefaultSubsection(state.subsections[section]?.[0] || "General");
                setTaskModalDefaultDueDate(getLocalDateString());
                setIsTaskModalOpen(true);
              }}
              onNewNote={() => {
                const note: KnowledgeItem = { id: crypto.randomUUID(), subject: "Untitled Note", title: "Untitled Note", summary: "", content: "", folderId: null, status: "Draft", startDate: getLocalDateString(), endDate: getLocalDateString(), createdAt: new Date().toISOString() };
                handleSaveKnowledge(note);
                setActiveEditKnowledge(note);
                setActiveTab("knowledge");
              }}
            />
          ) : (
            <div className={`workspace-page page-${activeTab} w-full mx-auto space-y-6`}>
              {activeTab.startsWith("workspace") && <WorkspacesView
                key={`${state.userId}:${activeTab}`}
                state={state}
                workspaceId={activeTab.startsWith("workspace:") ? activeTab.slice(10) : undefined}
                createInitially={activeTab === "workspace-new"}
                onNavigate={setActiveTab}
                onAsk={prompt => { void askAssistant(prompt); }}
                onChange={update => setState(prev => prev ? update(prev) : prev)}
                taskActions={{ onToggle: handleToggleTask, onEdit: openEditTask, onNew: openNewTask }}
              />}
              {/* ========================================================= */}
              {/* TAB 0.5: LIFE GOALS & LONG-TERM VISION                    */}
              {/* ========================================================= */}
              {activeTab === "goals" && (
                <GoalsView
                  goals={state.goals || []}
                  onAddGoal={() => {
                    setActiveEditGoal(null);
                    setIsGoalModalOpen(true);
                  }}
                  onEditGoal={(goal) => {
                    setActiveEditGoal(goal);
                    setIsGoalModalOpen(true);
                  }}
                  onDeleteGoal={handleDeleteGoal}
                  onToggleMilestone={handleToggleMilestone}
                  onUpdateGoalStatus={handleUpdateGoalStatus}
                  theme={state.theme}
                />
              )}

              {/* ========================================================= */}
              {/* TAB 1: TASKS MATRIX (Sections & Subsections)              */}
              {/* ========================================================= */}
              {activeTab === "tasks" && (
                <TaskMatrixView
                  tasks={state.tasks}
                  events={state.events || []}
                  onAddEvent={openNewEvent}
                  onEditEvent={openEditEvent}
                  sections={state.sections}
                  subsections={state.subsections}
                  appearance={state.taskAppearance}
                  onAppearanceChange={(taskAppearance) => setState(prev => prev ? { ...prev, taskAppearance } : prev)}
                  onToggleTask={handleToggleTask}
                  onStatusChange={handleStatusChange}
                  onAddTask={openNewTask}
                  onEditTask={openEditTask}
                  onDeleteTask={handleDeleteTask}
                  onSaveTask={handleSaveTask}
                  onAIBreakdown={handleTriggerAIBreakdown}
                  onAddSection={handleAddSection}
                  onDeleteSection={handleDeleteSection}
                  onAddSubsection={handleAddSubsection}
                  onDeleteSubsection={handleDeleteSubsection}
                  onRenameSubsection={handleRenameSubsection}
                  onMoveTask={handleMoveTask}
                />
              )}

              {/* ========================================================= */}
              {/* TAB 2: DAILY HABITS (Clean streaks & 7-day punch cards)   */}
              {/* ========================================================= */}
              {activeTab === "habits" && (
                <HabitsView
                  habits={state.habits}
                  onToggleHabit={handleToggleHabit}
                  onAddHabit={() => setIsHabitModalOpen(true)}
                  onDeleteHabit={(id) =>
                    setState((prev) => (prev ? { ...prev, habits: prev.habits.filter((h) => h.id !== id) } : null))
                  }
                />
              )}

              {/* ========================================================= */}
              {/* TAB 3: REFLECTIONS / JOURNAL                             */}
              {/* ========================================================= */}
              {activeTab === "journal" && (
                <JournalView
                  entries={state.journalEntries}
                  tasks={state.tasks}
                  habits={state.habits}
                  onSaveEntry={handleSaveJournalEntry}
                  onSynthesizeAI={handleSynthesizeAI}
                  openRouterKey={state.openRouterKey}
                  selectedModel={state.selectedModel}
                  onOpenSettings={() => setIsSettingsOpen(true)}
                  onSaveKnowledge={handleSaveKnowledge}
                />
              )}

              {/* ========================================================= */}
              {/* TAB 4: NOTES & VAULT FILE SYSTEM WORKSPACE               */}
              {/* ========================================================= */}
              {activeTab === "knowledge" && (
                <NotesWorkspace
                  items={state.knowledgeItems}
                  folders={state.noteFolders || []}
                  onSaveNote={handleSaveKnowledge}
                  onDeleteNote={handleDeleteKnowledge}
                  onSaveFolder={handleSaveFolder}
                  onDeleteFolder={handleDeleteFolder}
                  openRouterKey={state.openRouterKey}
                  selectedModel={state.selectedModel}
                  onGenerateTasks={(newTasks) => {
                    const today = new Date().toISOString().split("T")[0];
                    newTasks.forEach((t) => {
                      const sec = state.sections[0] || "Academic";
                      const sub = state.subsections[sec]?.[0] || "General";
                      const task: Task = normalizeTask({
                        id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                        title: t.title,
                        dueDate: today,
                        priority: (t.priority as any) || "medium",
                        section: sec,
                        subsection: sub,
                        status: "not_started",
                        completed: false,
                      });
                      handleSaveTask(task);
                    });
                  }}
                  initialSelectedNote={activeEditKnowledge}
                  onClearInitialSelectedNote={() => setActiveEditKnowledge(null)}
                />
              )}
            </div>
          )}
        </main>
      </div>

      {/* ========================================================= */}
      {/* FLOATING BOTTOM "+ Add" BUTTON (Tabs other than Home)     */}
      {/* ========================================================= */}
      {!isChatTab && activeTab !== "home" && !activeTab.startsWith("workspace") && (
        <div className="fixed bottom-6 right-6 z-30 flex flex-col items-end">
          {/* Quick Pop-up Menu */}
          {isQuickAddMenuOpen && (
            <div className="quick-add-menu">
              <button
                onClick={() => {
                  setIsQuickAddMenuOpen(false);
                  setIsQuickCaptureOpen(true);
                }}
                className="quick-add-item"
              >
                <Zap size={16} strokeWidth={1.5} />
                <span>Quick capture</span>
                <kbd>⌘⌥N</kbd>
              </button>

              <button
                onClick={() => {
                  setIsQuickAddMenuOpen(false);
                  setActiveEditTask(null);
                  const sec = state.sections[0] || "Academic";
                  const sub = state.subsections[sec]?.[0] || "General";
                  setTaskModalDefaultSection(sec);
                  setTaskModalDefaultSubsection(sub);
                  setIsTaskModalOpen(true);
                }}
                className="quick-add-item"
              >
                <CheckSquare size={16} strokeWidth={1.5} />
                <span>Task</span>
              </button>

              <button
                onClick={() => {
                  setIsQuickAddMenuOpen(false);
                  setActiveEditGoal(null);
                  setIsGoalModalOpen(true);
                }}
                className="quick-add-item"
              >
                <Target size={16} strokeWidth={1.5} />
                <span>Goal</span>
              </button>

              <button
                onClick={() => {
                  setIsQuickAddMenuOpen(false);
                  const name = prompt("Enter new section name (e.g. Projects, Research, Personal):");
                  if (name) handleAddSection(name);
                }}
                className="quick-add-item"
              >
                <FolderPlus size={16} strokeWidth={1.5} />
                <span>Task section</span>
              </button>

              <button
                onClick={() => {
                  setIsQuickAddMenuOpen(false);
                  setIsHabitModalOpen(true);
                }}
                className="quick-add-item"
              >
                <Flame size={16} strokeWidth={1.5} />
                <span>Habit</span>
              </button>

              <button
                onClick={() => {
                  setIsQuickAddMenuOpen(false);
                  setActiveTab("journal");
                }}
                className="quick-add-item"
              >
                <BookOpen size={16} strokeWidth={1.5} />
                <span>Journal entry</span>
              </button>

              <button
                onClick={() => {
                  setIsQuickAddMenuOpen(false);
                  setActiveTab("knowledge");
                  setActiveEditKnowledge(null);
                  setIsKnowledgeModalOpen(true);
                }}
                className="quick-add-item"
              >
                <FileText size={16} strokeWidth={1.5} />
                <span>Note</span>
              </button>
            </div>
          )}

          {/* The Black Pill Button */}
          <button
            onClick={() => setIsQuickAddMenuOpen(!isQuickAddMenuOpen)}
            className="quick-add-button"
          >
            {isQuickAddMenuOpen ? <X size={16} strokeWidth={1.5} /> : <Plus size={16} strokeWidth={1.5} />}
            <span>{isQuickAddMenuOpen ? "Close" : "New"}</span>
          </button>
        </div>
      )}

      {/* Modals */}
      <UniversalQuickCapture
        isOpen={isQuickCaptureOpen}
        onClose={() => setIsQuickCaptureOpen(false)}
        brainState={state}
        onAddTask={handleSaveTask}
        onAddJournal={handleSaveJournalEntry}
        onAddKnowledge={handleSaveKnowledge}
        onAddHabit={handleSaveHabit}
        openRouterKey={state.openRouterKey}
      />

      <SemanticMemoryVaultModal
        isOpen={isVaultModalOpen}
        onClose={() => setIsVaultModalOpen(false)}
        brainState={state}
        openRouterKey={state.openRouterKey}
      />

      <OpenRouterSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        openRouterKey={state.openRouterKey}
        onSaveKey={handleSaveOpenRouterKey}
        selectedModel={state.selectedModel}
        onSelectModel={handleSelectModel}
        askBeforeChanges={!!state.preferences?.askBeforeChanges}
        onAskBeforeChanges={value => setState(prev => prev ? { ...prev, preferences: { ...prev.preferences, askBeforeChanges: value } } : prev)}
        onOpenMemory={() => { setIsSettingsOpen(false); setSelectedMemoryId(undefined); setIsMemoryOpen(true); }}
        onExportBackup={handleExportBackup}
        workspaceControls={cloudEnabled ? <CloudControls state={state} onImport={setState} /> : undefined}
      />

      {isMemoryOpen && <MemoryModal key={state.userId} state={state} onClose={closeMemory} selectedId={selectedMemoryId} status={conversation.memoryStatus} onChange={conversation.changeMemory} onOpenSource={id => { if (id !== state.conversationId && id !== "current") conversation.resume(id); setActiveTab("home"); setIsMemoryOpen(false); }} />}

      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        task={activeEditTask}
        sections={state.sections}
        subsections={state.subsections}
        defaultSection={taskModalDefaultSection}
        defaultSubsection={taskModalDefaultSubsection}
        defaultDueDate={taskModalDefaultDueDate}
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
        onAddSubsection={handleAddSubsection}
        openRouterKey={state.openRouterKey}
        selectedModel={state.selectedModel}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <EventModal
        isOpen={isEventModalOpen}
        onClose={() => setIsEventModalOpen(false)}
        event={activeEditEvent}
        defaultDate={eventModalDefaultDate}
        onSave={handleSaveEvent}
        onDelete={handleDeleteEvent}
      />

      <HabitModal
        isOpen={isHabitModalOpen}
        onClose={() => setIsHabitModalOpen(false)}
        onSave={handleSaveHabit}
      />

      <KnowledgeModal
        isOpen={isKnowledgeModalOpen}
        onClose={() => setIsKnowledgeModalOpen(false)}
        item={activeEditKnowledge}
        folders={state.noteFolders || []}
        onSave={(savedNote) => {
          handleSaveKnowledge(savedNote);
          setActiveEditKnowledge(savedNote);
        }}
        onDelete={handleDeleteKnowledge}
      />

      {managedAuthEnabled ? <ManagedAccountModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} session={session} /> : <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        session={session}
        onSessionChange={handleSessionChange}
      />}

      <SemanticGlobalSearch
        isOpen={isGlobalSearchOpen}
        onClose={() => setIsGlobalSearchOpen(false)}
        brainState={state}
        onSelectTask={(task) => {
          setActiveTab("tasks");
          setActiveEditTask(task);
          setIsTaskModalOpen(true);
        }}
        onSelectGoal={(goal) => {
          setActiveTab("goals");
          setActiveEditGoal(goal);
          setIsGoalModalOpen(true);
        }}
        onSelectHabit={() => {
          setActiveTab("habits");
        }}
        onSelectJournal={() => {
          setActiveTab("journal");
        }}
        onSelectKnowledge={(item) => {
          setActiveTab("knowledge");
          setActiveEditKnowledge(item);
          setIsKnowledgeModalOpen(true);
        }}
        openRouterKey={state.openRouterKey}
      />

      <GoalModal
        isOpen={isGoalModalOpen}
        onClose={() => setIsGoalModalOpen(false)}
        onSave={handleSaveGoal}
        editingGoal={activeEditGoal}
        openRouterKey={state.openRouterKey}
        selectedModel={state.selectedModel}
      />

      <AuditLogModal
        isOpen={isAuditLogOpen}
        onClose={() => setIsAuditLogOpen(false)}
        auditLog={state.auditLog || []}
        onUndo={handleUndo}
        canUndo={historyPast.current.length > 0}
        onClearLog={() =>
          setState((prev) => (prev ? { ...prev, auditLog: [] } : null))
        }
      />
    </div>
  );
};

export default App;

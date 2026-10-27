import React, { useState, useEffect, useRef } from "react";
import { BrainState, Task, Habit, JournalEntry, KnowledgeItem, AuthSession, AuditLogEntry, Goal, GoalStatus, TaskStatus, NoteFolder } from "./types";
import { loadInitialState, persistBrainState } from "./services/storage";
import { initAuth } from "./services/auth";
import { syncHabitStreaks, getLocalDateString } from "./utils/habitStreaks";
import { normalizeTask, setTaskStatus, toggleTaskCompleted } from "./utils/taskState";
import { synthesizeJournalWithAI, breakdownTaskWithAI } from "./services/openrouter";
import { Sidebar } from "./components/Sidebar";
import { TopHeader } from "./components/TopHeader";
import { HomeView } from "./components/HomeView";
import { GoalsView } from "./components/GoalsView";
import { GoalModal } from "./components/GoalModal";
import { TaskMatrixView } from "./components/TaskMatrixView";
import { HabitsView } from "./components/HabitsView";
import { JournalView } from "./components/JournalView";
import { NotesWorkspace } from "./components/NotesWorkspace";
import { AICopilotModal } from "./components/AICopilotModal";
import { OpenRouterSettingsModal } from "./components/OpenRouterSettingsModal";
import { TaskModal } from "./components/TaskModal";
import { HabitModal } from "./components/HabitModal";
import { KnowledgeModal } from "./components/KnowledgeModal";
import { AuthModal } from "./components/AuthModal";
import { UniversalQuickCapture } from "./components/UniversalQuickCapture";
import { SemanticMemoryVaultModal } from "./components/SemanticMemoryVaultModal";
import { SemanticGlobalSearch } from "./components/SemanticGlobalSearch";
import { AuditLogModal } from "./components/AuditLogModal";
import { vectorVault } from "./services/vectorVault";
import { Plus, CheckSquare, Flame, BookOpen, FolderPlus, X, Zap, Undo2, Target, FileText } from "lucide-react";

export const App: React.FC = () => {
  const [state, setState] = useState<BrainState | null>(null);
  const [session, setSession] = useState<AuthSession>({ currentUser: null, isGuest: true });
  const [activeTab, setActiveTab] = useState<string>("home");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Modals state
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAICopilotOpen, setIsAICopilotOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalDefaultSection, setTaskModalDefaultSection] = useState<string>("Academic");
  const [taskModalDefaultSubsection, setTaskModalDefaultSubsection] = useState<string>("CS 1332");
  const [taskModalDefaultDueDate, setTaskModalDefaultDueDate] = useState<string>("");
  const [activeEditTask, setActiveEditTask] = useState<Task | null>(null);
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
  const [undoToast, setUndoToast] = useState<{ message: string; onUndo: () => void } | null>(null);

  // Undo / Redo History Stack (30 rolling snapshots)
  const historyPast = useRef<BrainState[]>([]);
  const historyFuture = useRef<BrainState[]>([]);

  // Load initial session & database state on mount
  useEffect(() => {
    initAuth().then((authSession) => {
      setSession(authSession);
      loadInitialState(authSession.currentUser?.id).then((loaded) => {
        setState(loaded);
        if (loaded.theme === "dark") {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }

        // Prime the local vector vault if not yet indexed
        vectorVault.getVaultStats().then((vStats) => {
          if (vStats.total_chunks === 0 && (loaded.tasks.length > 0 || loaded.journalEntries.length > 0)) {
            vectorVault.reindexBrain(loaded, loaded.openRouterKey).catch(() => {});
          }
        });
      });
    });
  }, []);

  // Listen for Tauri native global hotkey event: ⌘⌥N or ⌥⇧N (open-quick-capture)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        listen("open-quick-capture", () => {
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

  // Sync state to storage & database whenever it changes
  useEffect(() => {
    if (state) {
      persistBrainState(state, session.currentUser?.id);
    }
  }, [state, session]);

  // Handle switching or logging into user accounts
  const handleSessionChange = async (newSession: AuthSession) => {
    setSession(newSession);
    const loaded = await loadInitialState(newSession.currentUser?.id);
    setState(loaded);
  };

  // Record State Mutation in Audit Log & Undo Stack
  const recordMutation = (
    action: string,
    entityType: "task" | "habit" | "journal" | "knowledge" | "section" | "goal",
    entityTitle: string,
    details?: string
  ) => {
    if (!state) return;
    // Push snapshot to past history
    historyPast.current = [...historyPast.current.slice(-29), JSON.parse(JSON.stringify(state))];
    historyFuture.current = [];

    const entry: AuditLogEntry = {
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      timeString: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
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

    setUndoToast({
      message: `${action}: "${entityTitle.slice(0, 24)}"`,
      onUndo: handleUndo,
    });
  };

  // ⌘Z Undo Handler
  const handleUndo = () => {
    if (historyPast.current.length === 0 || !state) return;
    const previousState = historyPast.current.pop()!;
    historyFuture.current.push(JSON.parse(JSON.stringify(state)));
    setState(previousState);
    setUndoToast({
      message: "State restored (⌘Z)",
      onUndo: handleRedo,
    });
    setTimeout(() => setUndoToast(null), 3500);
  };

  // ⌘⇧Z / ⌘Y Redo Handler
  const handleRedo = () => {
    if (historyFuture.current.length === 0 || !state) return;
    const nextState = historyFuture.current.pop()!;
    historyPast.current.push(JSON.parse(JSON.stringify(state)));
    setState(nextState);
    setUndoToast(null);
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

  if (!state) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-white dark:bg-[#0e1015]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-slate-900 dark:border-white border-t-transparent animate-spin"></div>
          <span className="font-mono text-xs font-bold text-slate-400">
            [synapse] loading...
          </span>
        </div>
      </div>
    );
  }

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
    vectorVault.indexItem(normalized, "task", state?.openRouterKey).catch(() => {});
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
    vectorVault.removeItem(taskId).catch(() => {});
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
      return {
        ...prev,
        subsections: {
          ...prev.subsections,
          [section]: updatedSubs,
        },
        tasks: updatedTasks,
      };
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
    vectorVault.indexItem(synced, "habit", state?.openRouterKey).catch(() => {});
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
    vectorVault.indexItem(goal, "goal", state?.openRouterKey).catch(() => {});
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
    vectorVault.removeItem(goalId).catch(() => {});
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
        vectorVault.indexItem(updatedGoal, "goal", prev.openRouterKey).catch(() => {});
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
        vectorVault.indexItem(updated, "goal", prev.openRouterKey).catch(() => {});
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
    vectorVault.indexItem(entry, "journal", state?.openRouterKey).catch(() => {});
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
    vectorVault.indexItem(normalizedItem, "knowledge", state?.openRouterKey).catch(() => {});
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
    vectorVault.removeItem(id).catch(() => {});
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
    <div className="min-h-screen bg-[#f8f9fd] dark:bg-[#090b14] text-slate-900 dark:text-slate-100 flex font-sans transition-colors duration-300 relative overflow-x-hidden">
      {/* Ambient Glowing Background Orbs matching the screenshot atmosphere */}
      <div className="fixed -bottom-24 -left-24 w-[520px] h-[520px] rounded-full bg-blue-600/10 dark:bg-blue-600/15 blur-[140px] pointer-events-none z-0" />
      <div className="fixed -top-24 -right-24 w-[520px] h-[520px] rounded-full bg-purple-600/10 dark:bg-purple-600/15 blur-[140px] pointer-events-none z-0" />

      {/* Subtle cosmic star specks in dark mode */}
      <div className="hidden dark:block fixed top-1/4 left-1/3 w-1 h-1 rounded-full bg-indigo-400/40 animate-pulse pointer-events-none" />
      <div className="hidden dark:block fixed top-1/2 right-1/4 w-1.5 h-1.5 rounded-full bg-purple-400/30 animate-pulse pointer-events-none" />
      <div className="hidden dark:block fixed bottom-1/3 left-1/5 w-1 h-1 rounded-full bg-blue-400/40 animate-pulse pointer-events-none" />
      <div className="hidden dark:block fixed top-2/3 right-1/6 w-1 h-1 rounded-full bg-indigo-300/30 animate-pulse pointer-events-none" />

      {/* Left Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        collapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onOpenProModal={() => setIsSettingsOpen(true)}
      />

      {/* Main View Area */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10 min-h-screen">
        {/* Top Right Header matching screenshot */}
        <TopHeader
          onOpenGlobalSearch={() => setIsGlobalSearchOpen(true)}
          theme={state.theme}
          onToggleTheme={handleToggleTheme}
          session={session}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onOpenNotifications={() => setIsAuditLogOpen(true)}
        />

        {/* Main Content Viewport */}
        <main className="flex-1 px-4 sm:px-8 py-2 w-full max-w-6xl mx-auto pb-24">
        {/* ========================================================= */}
        {/* TAB 0: HOME / AUTONOMOUS BRAIN AGENT COMMAND CENTER       */}
        {/* ========================================================= */}
        {activeTab === "home" && (
          <HomeView
            brainState={state}
            onSaveTask={handleSaveTask}
            onUpdateTask={handleSaveTask}
            onSaveGoal={handleSaveGoal}
            onSaveHabit={handleSaveHabit}
            onSaveJournal={handleSaveJournalEntry}
            onSaveKnowledge={handleSaveKnowledge}
            onNavigateTab={(tab) => setActiveTab(tab)}
            onUndo={handleUndo}
            openRouterKey={state.openRouterKey}
          />
        )}

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
            sections={state.sections}
            subsections={state.subsections}
            onToggleTask={handleToggleTask}
            onStatusChange={handleStatusChange}
            onAddTask={(section, subsection, defaultDueDate) => {
              const sec = section || state.sections[0] || "Academic";
              const sub = subsection || state.subsections[sec]?.[0] || "General";
              setTaskModalDefaultSection(sec);
              setTaskModalDefaultSubsection(sub);
              setTaskModalDefaultDueDate(defaultDueDate || getLocalDateString());
              setActiveEditTask(null);
              setIsTaskModalOpen(true);
            }}
            onEditTask={(task) => {
              setActiveEditTask(task);
              setIsTaskModalOpen(true);
            }}
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
            onOpenSettings={() => setIsSettingsOpen(true)}
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

        {/* ========================================================= */}
        {/* TAB 5: AI COPILOT DIRECT VIEW                             */}
        {/* ========================================================= */}
        {activeTab === "copilot" && (
          <div className="max-w-2xl mx-auto pt-6 text-center space-y-4">
            <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">
              AI Copilot
            </h2>
            <p className="text-xs text-slate-400">
              Interactive conversational intelligence synchronized with your tasks and habits
            </p>
            <button
              onClick={() => setIsAICopilotOpen(true)}
              className="px-6 py-3 rounded-full bg-slate-950 text-white dark:bg-white dark:text-slate-950 text-xs font-bold shadow-md hover:scale-105 transition-all"
            >
              Open Second Brain Chat
            </button>
          </div>
        )}
      </main>
      </div>

      {/* ========================================================= */}
      {/* FLOATING BOTTOM "+ Add" BUTTON (Tabs other than Home)     */}
      {/* ========================================================= */}
      {activeTab !== "home" && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center">
          {/* Quick Pop-up Menu */}
          {isQuickAddMenuOpen && (
            <div className="mb-3 bg-white dark:bg-[#141721] rounded-3xl p-2 border border-slate-200 dark:border-slate-800 shadow-xl flex flex-col gap-1 w-52 animate-fade-in text-xs font-semibold">
              <button
                onClick={() => {
                  setIsQuickAddMenuOpen(false);
                  setIsQuickCaptureOpen(true);
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 text-amber-900 dark:text-amber-200 transition-colors text-left font-bold"
              >
                <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                <div className="flex items-center justify-between w-full">
                  <span>Quick Capture</span>
                  <span className="text-[10px] font-mono opacity-60">⌘⌥N</span>
                </div>
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
                className="flex items-center gap-2 px-3 py-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors text-left"
              >
                <CheckSquare className="w-3.5 h-3.5 text-blue-500" />
                <span>Add Task</span>
              </button>

              <button
                onClick={() => {
                  setIsQuickAddMenuOpen(false);
                  setActiveEditGoal(null);
                  setIsGoalModalOpen(true);
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors text-left"
              >
                <Target className="w-3.5 h-3.5 text-indigo-500" />
                <span>New Life Goal</span>
              </button>

              <button
                onClick={() => {
                  setIsQuickAddMenuOpen(false);
                  const name = prompt("Enter new section name (e.g. Projects, Research, Personal):");
                  if (name) handleAddSection(name);
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors text-left"
              >
                <FolderPlus className="w-3.5 h-3.5 text-indigo-500" />
                <span>New Section</span>
              </button>

              <button
                onClick={() => {
                  setIsQuickAddMenuOpen(false);
                  setIsHabitModalOpen(true);
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors text-left"
              >
                <Flame className="w-3.5 h-3.5 text-amber-500" />
                <span>Add Habit</span>
              </button>

              <button
                onClick={() => {
                  setIsQuickAddMenuOpen(false);
                  setActiveTab("journal");
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors text-left"
              >
                <BookOpen className="w-3.5 h-3.5 text-purple-500" />
                <span>Reflection</span>
              </button>

              <button
                onClick={() => {
                  setIsQuickAddMenuOpen(false);
                  setActiveTab("knowledge");
                  setActiveEditKnowledge(null);
                  setIsKnowledgeModalOpen(true);
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors text-left"
              >
                <FileText className="w-3.5 h-3.5 text-blue-500" />
                <span>New Note</span>
              </button>
            </div>
          )}

          {/* The Black Pill Button */}
          <button
            onClick={() => setIsQuickAddMenuOpen(!isQuickAddMenuOpen)}
            className="flex items-center gap-1.5 px-6 py-2.5 rounded-full bg-slate-950 text-white dark:bg-white dark:text-slate-950 text-xs font-bold shadow-lg hover:scale-105 active:scale-95 transition-all"
          >
            {isQuickAddMenuOpen ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            <span>{isQuickAddMenuOpen ? "Close" : "Add"}</span>
          </button>
        </div>
      )}

      {/* Modals */}
      <AICopilotModal
        isOpen={isAICopilotOpen}
        onClose={() => setIsAICopilotOpen(false)}
        tasks={state.tasks}
        habits={state.habits}
        journalEntries={state.journalEntries}
        chatHistory={state.chatHistory}
        onUpdateChatHistory={(messages) =>
          setState((prev) => (prev ? { ...prev, chatHistory: messages } : null))
        }
        openRouterKey={state.openRouterKey}
        selectedModel={state.selectedModel}
        onOpenSettings={() => {
          setIsAICopilotOpen(false);
          setIsSettingsOpen(true);
        }}
        onOpenVault={() => {
          setIsAICopilotOpen(false);
          setIsVaultModalOpen(true);
        }}
        brainState={state}
        onSaveTask={handleSaveTask}
        onUpdateTask={handleSaveTask}
        onSaveGoal={handleSaveGoal}
        onSaveHabit={handleSaveHabit}
        onSaveJournal={handleSaveJournalEntry}
        onSaveKnowledge={handleSaveKnowledge}
        onNavigateTab={(tab) => {
          setIsAICopilotOpen(false);
          setActiveTab(tab);
        }}
        onUndo={handleUndo}
      />

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
        onExportBackup={handleExportBackup}
      />

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

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        session={session}
        onSessionChange={handleSessionChange}
      />

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

      {/* Undo/Redo Floating Action Toast */}
      {undoToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-slate-900/95 text-white dark:bg-white/95 dark:text-slate-950 backdrop-blur-md shadow-2xl border border-slate-700/50 dark:border-slate-200/50 animate-fade-in text-xs font-semibold">
          <span>{undoToast.message}</span>
          <button
            onClick={() => {
              undoToast.onUndo();
              setUndoToast(null);
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Undo (⌘Z)</span>
          </button>
          <button
            onClick={() => setUndoToast(null)}
            className="p-1 hover:opacity-75 transition-opacity"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

export default App;

import React, { useState, useEffect } from "react";
import { BrainState, Task, Habit, JournalEntry, KnowledgeItem, AuthSession } from "./types";
import { loadInitialState, persistBrainState } from "./services/storage";
import { initAuth } from "./services/auth";
import { syncHabitStreaks, getLocalDateString } from "./utils/habitStreaks";
import { synthesizeJournalWithAI, breakdownTaskWithAI } from "./services/openrouter";
import { Header } from "./components/Header";
import { TaskMatrixView } from "./components/TaskMatrixView";
import { HabitsView } from "./components/HabitsView";
import { JournalView } from "./components/JournalView";
import { KnowledgeTable } from "./components/KnowledgeTable";
import { AICopilotModal } from "./components/AICopilotModal";
import { OpenRouterSettingsModal } from "./components/OpenRouterSettingsModal";
import { TaskModal } from "./components/TaskModal";
import { HabitModal } from "./components/HabitModal";
import { KnowledgeModal } from "./components/KnowledgeModal";
import { AuthModal } from "./components/AuthModal";
import { UniversalQuickCapture } from "./components/UniversalQuickCapture";
import { SemanticMemoryVaultModal } from "./components/SemanticMemoryVaultModal";
import { vectorVault } from "./services/vectorVault";
import { Plus, CheckSquare, Flame, BookOpen, FolderPlus, Database, X, Zap } from "lucide-react";

export const App: React.FC = () => {
  const [state, setState] = useState<BrainState | null>(null);
  const [session, setSession] = useState<AuthSession>({ currentUser: null, isGuest: true });
  const [activeTab, setActiveTab] = useState<string>("tasks");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals state
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAICopilotOpen, setIsAICopilotOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalDefaultSection, setTaskModalDefaultSection] = useState<string>("Academic");
  const [taskModalDefaultSubsection, setTaskModalDefaultSubsection] = useState<string>("CS 1332");
  const [taskModalDefaultDueDate, setTaskModalDefaultDueDate] = useState<string>("");
  const [activeEditTask, setActiveEditTask] = useState<Task | null>(null);
  const [isHabitModalOpen, setIsHabitModalOpen] = useState(false);
  const [isKnowledgeModalOpen, setIsKnowledgeModalOpen] = useState(false);
  const [activeEditKnowledge, setActiveEditKnowledge] = useState<KnowledgeItem | null>(null);
  const [isQuickAddMenuOpen, setIsQuickAddMenuOpen] = useState(false);
  const [isQuickCaptureOpen, setIsQuickCaptureOpen] = useState(false);
  const [isVaultModalOpen, setIsVaultModalOpen] = useState(false);

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

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌘⌥N (Cmd+Option+N / Ctrl+Alt+N) or ⌥⇧N (Option+Shift+N): Universal Quick Capture
      // Completely free from browser collisions like ⌘⇧N (Chrome incognito)
      const isAltN = e.altKey && (e.key.toLowerCase() === "n" || e.code === "KeyN");
      if (((e.metaKey || e.ctrlKey) && isAltN) || (e.shiftKey && isAltN)) {
        e.preventDefault();
        e.stopPropagation();
        setIsQuickCaptureOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsAICopilotOpen((prev) => !prev);
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
    setState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        tasks: prev.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const currentStatus = t.status || (t.completed ? "completed" : "not_started");
          const nextStatus = currentStatus === "completed" ? "not_started" : "completed";
          return {
            ...t,
            status: nextStatus,
            completed: nextStatus === "completed",
          };
        }),
      };
    });
  };

  const handleStatusChange = (taskId: string, status: Task["status"]) => {
    setState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status,
                completed: status === "completed",
              }
            : t
        ),
      };
    });
  };

  const handleSaveTask = (task: Task) => {
    const status = task.status || (task.completed ? "completed" : "not_started");
    const normalized: Task = {
      ...task,
      status,
      completed: status === "completed",
    };
    setState((prev) => {
      if (!prev) return null;
      const exists = prev.tasks.some((t) => t.id === normalized.id);
      return {
        ...prev,
        tasks: exists
          ? prev.tasks.map((t) => (t.id === normalized.id ? normalized : t))
          : [normalized, ...prev.tasks],
      };
    });
    // Auto-update Semantic Memory Vault
    vectorVault.indexItem(normalized, "task", state?.openRouterKey).catch(() => {});
  };

  const handleDeleteTask = (taskId: string) => {
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
    setState((prev) => {
      if (!prev) return null;
      const exists = prev.habits.some((h) => h.id === synced.id);
      return {
        ...prev,
        habits: exists
          ? prev.habits.map((h) => (h.id === synced.id ? synced : h))
          : [...prev.habits, synced],
      };
    });
    vectorVault.indexItem(synced, "habit", state?.openRouterKey).catch(() => {});
  };

  // Journal Handlers
  const handleSaveJournalEntry = (entry: JournalEntry) => {
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

  // Knowledge Handlers
  const handleSaveKnowledge = (item: KnowledgeItem) => {
    setState((prev) => {
      if (!prev) return null;
      const exists = prev.knowledgeItems.some((k) => k.id === item.id);
      return {
        ...prev,
        knowledgeItems: exists
          ? prev.knowledgeItems.map((k) => (k.id === item.id ? item : k))
          : [item, ...prev.knowledgeItems],
      };
    });
    vectorVault.indexItem(item, "knowledge", state?.openRouterKey).catch(() => {});
  };

  const handleDeleteKnowledge = (id: string) => {
    setState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        knowledgeItems: prev.knowledgeItems.filter((k) => k.id !== id),
      };
    });
    vectorVault.removeItem(id).catch(() => {});
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
    <div className="min-h-screen bg-white dark:bg-[#0e1015] text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
      {/* Minimal Top Header like [untitled] */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        openRouterKey={state.openRouterKey}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenAIChat={() => setIsAICopilotOpen(true)}
        onOpenQuickCapture={() => setIsQuickCaptureOpen(true)}
        onOpenVault={() => setIsVaultModalOpen(true)}
        theme={state.theme}
        onToggleTheme={handleToggleTheme}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        session={session}
        onOpenAuth={() => setIsAuthModalOpen(true)}
      />

      {/* Main Spacious Content */}
      <main className="flex-1 px-6 sm:px-12 py-8 max-w-5xl mx-auto w-full pb-28">
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
        {/* TAB 4: NOTES & VAULT (Untitled-style squircle artwork)   */}
        {/* ========================================================= */}
        {activeTab === "knowledge" && (
          <KnowledgeTable
            items={state.knowledgeItems}
            onAddItem={() => {
              setActiveEditKnowledge(null);
              setIsKnowledgeModalOpen(true);
            }}
            onSelectItem={(item) => {
              setActiveEditKnowledge(item);
              setIsKnowledgeModalOpen(true);
            }}
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

      {/* ========================================================= */}
      {/* FLOATING BOTTOM "+ Add" BUTTON (Matching Attachment 2)    */}
      {/* ========================================================= */}
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
                setActiveEditKnowledge(null);
                setIsKnowledgeModalOpen(true);
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors text-left"
            >
              <Database className="w-3.5 h-3.5 text-emerald-500" />
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
        onSave={handleSaveKnowledge}
        onDelete={handleDeleteKnowledge}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        session={session}
        onSessionChange={handleSessionChange}
      />
    </div>
  );
};

export default App;

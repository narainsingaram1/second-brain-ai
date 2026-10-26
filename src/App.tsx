import React, { useState, useEffect } from "react";
import { BrainState, Task, Habit, JournalEntry, KnowledgeItem, LifeDomain } from "./types";
import { loadInitialState, persistBrainState } from "./services/storage";
import { synthesizeJournalWithAI, breakdownTaskWithAI } from "./services/openrouter";
import { Header } from "./components/Header";
import { FloatingDock } from "./components/FloatingDock";
import { HomeDashboard } from "./components/HomeDashboard";
import { DomainBar } from "./components/DomainBar";
import { JourneyCanvas } from "./components/JourneyCanvas";
import { KnowledgeTable } from "./components/KnowledgeTable";
import { HabitsPanel } from "./components/HabitsPanel";
import { TaskMatrixView } from "./components/TaskMatrixView";
import { HabitsView } from "./components/HabitsView";
import { JournalView } from "./components/JournalView";
import { AICopilotModal } from "./components/AICopilotModal";
import { OpenRouterSettingsModal } from "./components/OpenRouterSettingsModal";
import { TaskModal } from "./components/TaskModal";
import { HabitModal } from "./components/HabitModal";
import { KnowledgeModal } from "./components/KnowledgeModal";

export const App: React.FC = () => {
  const [state, setState] = useState<BrainState | null>(null);
  const [activeTab, setActiveTab] = useState<string>("home");
  const [selectedDomain, setSelectedDomain] = useState<LifeDomain | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAICopilotOpen, setIsAICopilotOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalStage, setTaskModalStage] = useState<Task["stage"]>("intake");
  const [activeEditTask, setActiveEditTask] = useState<Task | null>(null);
  const [isHabitModalOpen, setIsHabitModalOpen] = useState(false);
  const [isKnowledgeModalOpen, setIsKnowledgeModalOpen] = useState(false);
  const [activeEditKnowledge, setActiveEditKnowledge] = useState<KnowledgeItem | null>(null);

  // Load initial state on mount
  useEffect(() => {
    loadInitialState().then((loaded) => {
      setState(loaded);
      if (loaded.theme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    });
  }, []);

  // Sync state to storage whenever it changes
  useEffect(() => {
    if (state) {
      persistBrainState(state);
    }
  }, [state]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsAICopilotOpen((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setActiveEditTask(null);
        setIsTaskModalOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!state) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#edf0f5] dark:bg-[#0b0d13]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 dark:bg-white flex items-center justify-center shadow-lg animate-pulse">
            <div className="w-5 h-5 rounded-full border-2 border-white dark:border-slate-900 border-t-transparent animate-spin"></div>
          </div>
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            Initializing Synapse...
          </span>
        </div>
      </div>
    );
  }

  // Domain Counts
  const domainCounts = state.tasks.reduce(
    (acc, task) => {
      if (!task.completed) {
        acc[task.domain] = (acc[task.domain] || 0) + 1;
      }
      return acc;
    },
    { career: 0, health: 0, mindset: 0, learning: 0, ai: 0 } as Record<LifeDomain, number>
  );

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
        tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t)),
      };
    });
  };

  const handleSaveTask = (task: Task) => {
    setState((prev) => {
      if (!prev) return null;
      const exists = prev.tasks.some((t) => t.id === task.id);
      return {
        ...prev,
        tasks: exists
          ? prev.tasks.map((t) => (t.id === task.id ? task : t))
          : [task, ...prev.tasks],
      };
    });
  };

  const handleDeleteTask = (taskId: string) => {
    setState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== taskId),
      };
    });
  };

  // Habit Handlers
  const handleToggleHabit = (habitId: string, customDate?: string) => {
    const targetDate = customDate || new Date().toISOString().split("T")[0];
    setState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        habits: prev.habits.map((h) => {
          if (h.id !== habitId) return h;
          const isDone = !!h.history[targetDate];
          const newHistory = { ...h.history, [targetDate]: !isDone };
          const newStreak = !isDone ? h.streak + 1 : Math.max(0, h.streak - 1);
          const newBest = Math.max(h.bestStreak, newStreak);
          return { ...h, history: newHistory, streak: newStreak, bestStreak: newBest };
        }),
      };
    });
  };

  const handleSaveHabit = (habit: Habit) => {
    setState((prev) => {
      if (!prev) return null;
      const exists = prev.habits.some((h) => h.id === habit.id);
      return {
        ...prev,
        habits: exists
          ? prev.habits.map((h) => (h.id === habit.id ? habit : h))
          : [...prev.habits, habit],
      };
    });
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
  };

  const handleDeleteKnowledge = (id: string) => {
    setState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        knowledgeItems: prev.knowledgeItems.filter((k) => k.id !== id),
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
      // Browser download fallback
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `synapse_backup_${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Task AI Breakdown from Matrix
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
      alert("AI Breakdown error: " + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-[#edf0f5] dark:bg-[#0b0d13] flex flex-col font-sans transition-colors duration-200">
      {/* Top Header matching reference image */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        openRouterKey={state.openRouterKey}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenAIChat={() => setIsAICopilotOpen(true)}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />

      <div className="flex-1 flex relative">
        {/* Floating Left Dock matching reference image */}
        <FloatingDock
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          theme={state.theme}
          onToggleTheme={handleToggleTheme}
          onQuickAdd={() => {
            setActiveEditTask(null);
            setIsTaskModalOpen(true);
          }}
        />

        {/* Main Content Pane */}
        <main className="flex-1 pl-20 pr-6 py-6 overflow-x-hidden">
          {/* ========================================================= */}
          {/* TAB 0: HOME / COMMAND CENTER (Dynamic Second Brain Hub)    */}
          {/* ========================================================= */}
          {activeTab === "home" && (
            <HomeDashboard
              state={state}
              onToggleTask={handleToggleTask}
              onToggleHabit={handleToggleHabit}
              onAddTask={() => {
                setActiveEditTask(null);
                setTaskModalStage("intake");
                setIsTaskModalOpen(true);
              }}
              onAddHabit={() => setIsHabitModalOpen(true)}
              onOpenJournal={() => setActiveTab("journal")}
              onOpenAICopilot={() => setIsAICopilotOpen(true)}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onNavigateTab={setActiveTab}
              onEditTask={(task) => {
                setActiveEditTask(task);
                setIsTaskModalOpen(true);
              }}
              onAIBreakdown={handleTriggerAIBreakdown}
            />
          )}

          {/* ========================================================= */}
          {/* TAB 1: JOURNEYS & FLOW (Personal Life Operating Pipeline) */}
          {/* ========================================================= */}
          {activeTab === "journeys" && (
            <div className="space-y-6 max-w-[1600px] mx-auto">
              {/* Header Title & Life Domain Avatars Row */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                    Life Operating Journeys
                  </h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Multi-stage cognitive pipeline & connected life operations
                  </p>
                </div>

                {/* Domain & Member Avatars Strip */}
                <DomainBar
                  selectedDomain={selectedDomain}
                  onSelectDomain={setSelectedDomain}
                  domainCounts={domainCounts}
                />
              </div>

              {/* 4-Column Connected Workflow Canvas with Bezier Connectors */}
              <JourneyCanvas
                tasks={state.tasks}
                onToggleTask={handleToggleTask}
                onAddTask={(stage) => {
                  setTaskModalStage(stage);
                  setActiveEditTask(null);
                  setIsTaskModalOpen(true);
                }}
                onEditTask={(task) => {
                  setActiveEditTask(task);
                  setIsTaskModalOpen(true);
                }}
                selectedDomain={selectedDomain}
                onTriggerAIInsight={(task) => {
                  setActiveEditTask(task);
                  setIsTaskModalOpen(true);
                }}
              />

              {/* Dual Master Bottom Panels: Suggested Knowledge & Habits Panel */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-2">
                {/* Left 7 Columns: Suggested Knowledge Table */}
                <div className="lg:col-span-7">
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
                </div>

                {/* Right 5 Columns: Habits Panel & AI Insights */}
                <div className="lg:col-span-5">
                  <HabitsPanel
                    habits={state.habits}
                    onToggleHabit={(id) => handleToggleHabit(id)}
                    onAddHabit={() => setIsHabitModalOpen(true)}
                    onViewAllHabits={() => setActiveTab("habits")}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* TAB 2: TASK MATRIX (Due dates, priority, subtasks)         */}
          {/* ========================================================= */}
          {activeTab === "tasks" && (
            <TaskMatrixView
              tasks={state.tasks}
              onToggleTask={handleToggleTask}
              onAddTask={(stage) => {
                setTaskModalStage(stage || "intake");
                setActiveEditTask(null);
                setIsTaskModalOpen(true);
              }}
              onEditTask={(task) => {
                setActiveEditTask(task);
                setIsTaskModalOpen(true);
              }}
              onAIBreakdown={handleTriggerAIBreakdown}
            />
          )}

          {/* ========================================================= */}
          {/* TAB 3: DAILY HABITS (7-day punch cards, streak tracker)    */}
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
          {/* TAB 4: REFLECTIONS / JOURNAL (Stoic debrief & AI coach)    */}
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
          {/* TAB 5: SUGGESTED KNOWLEDGE FULL VIEW                      */}
          {/* ========================================================= */}
          {activeTab === "knowledge" && (
            <div className="max-w-6xl mx-auto space-y-6">
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
            </div>
          )}

          {/* ========================================================= */}
          {/* TAB 6: AI COPILOT FULL VIEW                               */}
          {/* ========================================================= */}
          {activeTab === "copilot" && (
            <div className="max-w-3xl mx-auto pt-4">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-black text-slate-900 dark:text-white">Synapse Neural Agent</h2>
                <p className="text-xs text-slate-500 mt-1">Direct conversational interface to your Second Brain</p>
              </div>
              <button
                onClick={() => setIsAICopilotOpen(true)}
                className="w-full py-4 rounded-3xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm font-bold shadow-lg"
              >
                Launch AI Assistant
              </button>
            </div>
          )}
        </main>
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
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
        defaultStage={taskModalStage}
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
    </div>
  );
};

export default App;

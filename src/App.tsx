import React, { useState, useEffect } from "react";
import { BrainState, Task, Habit, JournalEntry, KnowledgeItem } from "./types";
import { loadInitialState, persistBrainState } from "./services/storage";
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
import { Plus, CheckSquare, Flame, BookOpen, FolderPlus, Database, X } from "lucide-react";

export const App: React.FC = () => {
  const [state, setState] = useState<BrainState | null>(null);
  const [activeTab, setActiveTab] = useState<string>("tasks");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAICopilotOpen, setIsAICopilotOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalDefaultSection, setTaskModalDefaultSection] = useState<string>("Academic");
  const [taskModalDefaultSubsection, setTaskModalDefaultSubsection] = useState<string>("CS 1332");
  const [activeEditTask, setActiveEditTask] = useState<Task | null>(null);
  const [isHabitModalOpen, setIsHabitModalOpen] = useState(false);
  const [isKnowledgeModalOpen, setIsKnowledgeModalOpen] = useState(false);
  const [activeEditKnowledge, setActiveEditKnowledge] = useState<KnowledgeItem | null>(null);
  const [isQuickAddMenuOpen, setIsQuickAddMenuOpen] = useState(false);

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
        theme={state.theme}
        onToggleTheme={handleToggleTheme}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
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
            onAddTask={(section, subsection) => {
              const sec = section || state.sections[0] || "Academic";
              const sub = subsection || state.subsections[sec]?.[0] || "General";
              setTaskModalDefaultSection(sec);
              setTaskModalDefaultSubsection(sub);
              setActiveEditTask(null);
              setIsTaskModalOpen(true);
            }}
            onEditTask={(task) => {
              setActiveEditTask(task);
              setIsTaskModalOpen(true);
            }}
            onDeleteTask={handleDeleteTask}
            onAIBreakdown={handleTriggerAIBreakdown}
            onAddSection={handleAddSection}
            onDeleteSection={handleDeleteSection}
            onAddSubsection={handleAddSubsection}
            onDeleteSubsection={handleDeleteSubsection}
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
          <div className="mb-3 bg-white dark:bg-[#141721] rounded-3xl p-2 border border-slate-200 dark:border-slate-800 shadow-xl flex flex-col gap-1 w-48 animate-fade-in text-xs font-semibold">
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
    </div>
  );
};

export default App;

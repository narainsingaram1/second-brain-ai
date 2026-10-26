import React, { useState } from "react";
import { JournalEntry, Task, Habit } from "../types";
import {
  Sparkles,
  Calendar,
  Save,
  Smile,
  Meh,
  Frown,
  Zap,
  Plus,
  Trash2,
  Brain,
  Quote,
  CheckCircle2,
} from "lucide-react";
import confetti from "canvas-confetti";

interface JournalViewProps {
  entries: JournalEntry[];
  tasks: Task[];
  habits: Habit[];
  onSaveEntry: (entry: JournalEntry) => void;
  onSynthesizeAI: (entry: JournalEntry) => Promise<string>;
  openRouterKey: string;
  onOpenSettings: () => void;
}

export const JournalView: React.FC<JournalViewProps> = ({
  entries,
  tasks,
  habits,
  onSaveEntry,
  onSynthesizeAI,
  openRouterKey,
  onOpenSettings,
}) => {
  const todayStr = new Date().toISOString().split("T")[0];

  const todayEntry = entries.find((e) => e.date === todayStr) || {
    id: `journal-${todayStr}`,
    date: todayStr,
    title: "",
    content: "",
    mood: "great" as const,
    wins: [],
    challenges: [],
    tags: ["Reflection"],
  };

  const [currentEntry, setCurrentEntry] = useState<JournalEntry>(todayEntry);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [newWin, setNewWin] = useState("");
  const [newChallenge, setNewChallenge] = useState("");
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const moods: { id: JournalEntry["mood"]; label: string; icon: any; color: string }[] = [
    { id: "ecstatic", label: "Peak Energy", icon: Zap, color: "text-amber-500 bg-amber-50 dark:bg-amber-950/40" },
    { id: "great", label: "Great / Clear", icon: Smile, color: "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" },
    { id: "neutral", label: "Steady", icon: Meh, color: "text-blue-500 bg-blue-50 dark:bg-blue-950/40" },
    { id: "tired", label: "Fatigued", icon: Frown, color: "text-slate-500 bg-slate-100 dark:bg-slate-800" },
    { id: "stressed", label: "Overwhelmed", icon: Brain, color: "text-rose-500 bg-rose-50 dark:bg-rose-950/40" },
  ];

  const handleSelectDate = (dateStr: string) => {
    setSelectedDate(dateStr);
    const existing = entries.find((e) => e.date === dateStr);
    if (existing) {
      setCurrentEntry(existing);
    } else {
      setCurrentEntry({
        id: `journal-${dateStr}`,
        date: dateStr,
        title: "",
        content: "",
        mood: "great",
        wins: [],
        challenges: [],
        tags: ["Reflection"],
      });
    }
  };

  const handleSave = () => {
    onSaveEntry(currentEntry);
    setSavedSuccess(true);
    confetti({
      particleCount: 25,
      spread: 50,
      origin: { y: 0.7 },
      colors: ["#3b82f6", "#10b981", "#8b5cf6"],
    });
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleAddWin = () => {
    if (!newWin.trim()) return;
    setCurrentEntry((prev) => ({ ...prev, wins: [...prev.wins, newWin.trim()] }));
    setNewWin("");
  };

  const handleAddChallenge = () => {
    if (!newChallenge.trim()) return;
    setCurrentEntry((prev) => ({ ...prev, challenges: [...prev.challenges, newChallenge.trim()] }));
    setNewChallenge("");
  };

  const handleAIAudit = async () => {
    if (!openRouterKey) {
      onOpenSettings();
      return;
    }
    setIsSynthesizing(true);
    try {
      const insight = await onSynthesizeAI(currentEntry);
      setCurrentEntry((prev) => {
        const updated = { ...prev, aiReflection: insight };
        onSaveEntry(updated);
        return updated;
      });
    } catch (err: any) {
      alert("AI Synthesis error: " + err.message);
    } finally {
      setIsSynthesizing(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white/80 dark:bg-[#141721]/80 backdrop-blur-xl rounded-4xl p-6 border border-slate-300/70 dark:border-slate-800 shadow-card flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            Reflective Journal & Cognitive Synthesis
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Capture subconscious flow, track emotional calibration, and receive deep AI coaching
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleAIAudit}
            disabled={isSynthesizing}
            className="tactile-btn flex items-center gap-2 px-4 py-2 rounded-full bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-md transition-all disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            <span>{isSynthesizing ? "Analyzing Mindset..." : "AI Cognitive Synthesis"}</span>
          </button>

          <button
            onClick={handleSave}
            className="tactile-btn flex items-center gap-2 px-5 py-2 rounded-full bg-[#0d0f14] dark:bg-white text-white dark:text-slate-900 text-xs font-bold shadow-md transition-all"
          >
            <Save className="w-4 h-4" />
            <span>{savedSuccess ? "Saved!" : "Save Entry"}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main Journal Editor (Left 8 cols) */}
        <div className="lg:col-span-8 space-y-5">
          <div className="bg-white dark:bg-[#141721] rounded-4xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-5">
            {/* Date and Mood row */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-400" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => handleSelectDate(e.target.value)}
                  className="bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
                <span className="text-[10px] font-semibold text-slate-400 hidden sm:inline flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500 inline" />
                  {tasks.filter((t) => t.dueDate === selectedDate && t.completed).length} tasks done • {habits.filter((h) => h.history[selectedDate]).length} habits
                </span>
              </div>

              {/* Mood selector pills */}
              <div className="flex items-center gap-1.5">
                {moods.map((m) => {
                  const Icon = m.icon;
                  const isSelected = currentEntry.mood === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setCurrentEntry((prev) => ({ ...prev, mood: m.id }))}
                      title={m.label}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                        isSelected
                          ? `${m.color} ring-2 ring-blue-500 scale-105 shadow-sm`
                          : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title */}
            <div>
              <input
                type="text"
                placeholder="Entry Title / Daily Theme..."
                value={currentEntry.title}
                onChange={(e) => setCurrentEntry((prev) => ({ ...prev, title: e.target.value }))}
                className="w-full text-lg font-extrabold text-slate-900 dark:text-white placeholder-slate-400 bg-transparent focus:outline-none"
              />
            </div>

            {/* Journal Content */}
            <div>
              <textarea
                rows={9}
                placeholder="What went down today? How did you manage energy, deep work, and habits? What were the standout moments?"
                value={currentEntry.content}
                onChange={(e) => setCurrentEntry((prev) => ({ ...prev, content: e.target.value }))}
                className="w-full bg-slate-50/60 dark:bg-slate-900/40 text-slate-800 dark:text-slate-200 p-4 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 text-sm leading-relaxed placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none font-medium"
              />
            </div>

            {/* Wins & Lessons Grids */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {/* Daily Wins */}
              <div className="bg-emerald-50/40 dark:bg-emerald-950/20 p-4 rounded-3xl border border-emerald-200/60 dark:border-emerald-900/40 space-y-2">
                <span className="text-xs font-extrabold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Key Wins & Breakthroughs
                </span>
                <div className="space-y-1.5">
                  {currentEntry.wins.map((win, i) => (
                    <div key={i} className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 bg-white/80 dark:bg-slate-900/60 p-2 rounded-xl">
                      <span>• {win}</span>
                      <button
                        onClick={() =>
                          setCurrentEntry((prev) => ({
                            ...prev,
                            wins: prev.wins.filter((_, idx) => idx !== i),
                          }))
                        }
                        className="text-slate-400 hover:text-rose-500"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      placeholder="Add a win..."
                      value={newWin}
                      onChange={(e) => setNewWin(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddWin()}
                      className="w-full text-xs bg-white dark:bg-slate-900 px-3 py-1.5 rounded-full border border-emerald-200 focus:outline-none"
                    />
                    <button
                      onClick={handleAddWin}
                      className="p-1.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Challenges */}
              <div className="bg-amber-50/40 dark:bg-amber-950/20 p-4 rounded-3xl border border-amber-200/60 dark:border-amber-900/40 space-y-2">
                <span className="text-xs font-extrabold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <Brain className="w-3.5 h-3.5" />
                  Obstacles & Strategic Friction
                </span>
                <div className="space-y-1.5">
                  {currentEntry.challenges.map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 bg-white/80 dark:bg-slate-900/60 p-2 rounded-xl">
                      <span>• {c}</span>
                      <button
                        onClick={() =>
                          setCurrentEntry((prev) => ({
                            ...prev,
                            challenges: prev.challenges.filter((_, idx) => idx !== i),
                          }))
                        }
                        className="text-slate-400 hover:text-rose-500"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      placeholder="Add an obstacle..."
                      value={newChallenge}
                      onChange={(e) => setNewChallenge(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddChallenge()}
                      className="w-full text-xs bg-white dark:bg-slate-900 px-3 py-1.5 rounded-full border border-amber-200 focus:outline-none"
                    />
                    <button
                      onClick={handleAddChallenge}
                      className="p-1.5 rounded-full bg-amber-600 text-white hover:bg-amber-700"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* AI Synthesis & Past Entries Sidebar (Right 4 cols) */}
        <div className="lg:col-span-4 space-y-5">
          {/* AI Coach Card */}
          <div className="bg-gradient-to-b from-purple-500/10 to-indigo-500/10 dark:from-purple-950/40 dark:to-indigo-950/30 rounded-4xl p-5 border border-purple-200/80 dark:border-purple-800/60 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-purple-700 dark:text-purple-300 tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-purple-500" />
                AI Second Brain Synthesis
              </span>
              {!openRouterKey && (
                <button
                  onClick={onOpenSettings}
                  className="text-[10px] font-bold text-amber-600 underline"
                >
                  Configure API Key
                </button>
              )}
            </div>

            {currentEntry.aiReflection ? (
              <div className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed font-medium bg-white/70 dark:bg-slate-900/60 p-4 rounded-3xl border border-purple-100 dark:border-purple-900/50 whitespace-pre-line">
                {currentEntry.aiReflection}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-500 dark:text-slate-400 space-y-2">
                <Quote className="w-6 h-6 mx-auto text-purple-400 opacity-60" />
                <p className="text-xs">
                  Click <strong>AI Cognitive Synthesis</strong> to generate a multi-dimensional analysis of your day's work, habits, and mindset.
                </p>
              </div>
            )}
          </div>

          {/* Past Entries List */}
          <div className="bg-white dark:bg-[#141721] rounded-4xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
            <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider">
              Previous Reflections
            </h3>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => handleSelectDate(entry.date)}
                  className={`w-full text-left p-3 rounded-2xl border transition-all ${
                    entry.date === selectedDate
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-transparent shadow-sm"
                      : "bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span>{entry.date}</span>
                    <span className="capitalize opacity-80">{entry.mood}</span>
                  </div>
                  <h4 className="text-xs font-semibold truncate mt-1">
                    {entry.title || "Untitled Reflection"}
                  </h4>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

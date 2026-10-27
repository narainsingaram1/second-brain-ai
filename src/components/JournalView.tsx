import React, { useState, useRef } from "react";
import { JournalEntry, Task, Habit, KnowledgeItem } from "../types";
import {
  BookOpen,
  Sparkles,
  Save,
  Calendar,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Zap,
  Sun,
  Smile,
  Cloud,
  Activity,
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  AlertTriangle,
  Circle,
  Plus,
  Trash2,
  BarChart3,
  ListChecks,
  TrendingUp,
  ArrowRight,
  Copy,
  Check,
  Bookmark,
  X,
} from "lucide-react";
import confetti from "canvas-confetti";
import { MarkdownView } from "./MarkdownView";
import { queryOpenRouter } from "../services/openrouter";

interface JournalViewProps {
  entries: JournalEntry[];
  tasks: Task[];
  habits: Habit[];
  onSaveEntry: (entry: JournalEntry) => void;
  onSynthesizeAI: (entry: JournalEntry) => Promise<string>;
  openRouterKey: string;
  onOpenSettings: () => void;
  onAddTask?: (task: Task) => void;
  onSaveKnowledge?: (item: KnowledgeItem) => void;
}

// Helpers for formatted date presentation matching reference screenshot
function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return "Today";
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }); // e.g. "Mon, Oct 27, 2026"
}

function shiftDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + deltaDays);
  const nextY = date.getFullYear();
  const nextM = String(date.getMonth() + 1).padStart(2, "0");
  const nextD = String(date.getDate()).padStart(2, "0");
  return `${nextY}-${nextM}-${nextD}`;
}

function parseMonthDay(dateStr: string): { month: string; day: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const month = date.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const day = String(d);
  return { month, day };
}

export const JournalView: React.FC<JournalViewProps> = ({
  entries,
  tasks,
  habits,
  onSaveEntry,
  onSynthesizeAI,
  openRouterKey,
  onOpenSettings,
  onSaveKnowledge,
}) => {
  const todayStr = new Date().toISOString().split("T")[0];

  // Default initial entries to match user screenshot if no prior entries exist
  const DEFAULT_PAST_ENTRIES: JournalEntry[] = [
    {
      id: "journal-2026-10-26",
      date: "2026-10-26",
      title: "Deep Architecture Flow & Clarity",
      content:
        "Felt in the zone today. Made great progress on 2110 project and felt confident in algorithm invariants. Energy stayed elevated after the morning workout.",
      mood: "great",
      wins: ["Completed CS 2110 core invariant implementation", "Maintained 90m deep work block without checking phone"],
      challenges: ["Slight afternoon dip around 3pm before hydration"],
      tags: ["DeepWork", "Academic"],
    },
    {
      id: "journal-2026-10-25",
      date: "2026-10-25",
      title: "Energy Calibration & Habit Momentum",
      content:
        "A bit tired in the morning but recovered well after gym. Good progress on goals and reviewed systems roadmap.",
      mood: "neutral",
      wins: ["Hit all daily habits consistently", "Drafted technical roadmap"],
      challenges: ["Needed extra 15m to get into focus block"],
      tags: ["Habits", "Fitness"],
    },
    {
      id: "journal-2026-10-24",
      date: "2026-10-24",
      title: "Overcoming Friction",
      content:
        "Struggled with focus early on, but got back on track in the evening after resetting mindset.",
      mood: "tired",
      wins: ["Recovered evening momentum", "Reflected on boundary management"],
      challenges: ["Context switching early morning"],
      tags: ["Mindset"],
    },
  ];

  const allMergedEntries = entries && entries.length > 0 ? entries : DEFAULT_PAST_ENTRIES;

  const todayEntry = allMergedEntries.find((e) => e.date === todayStr) || {
    id: `journal-${todayStr}`,
    date: todayStr,
    title: "",
    content: "",
    mood: "ecstatic" as const,
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
  const [isAiMenuOpen, setIsAiMenuOpen] = useState(false);
  const [isCopiedSynthesis, setIsCopiedSynthesis] = useState(false);
  const [isSavedNoteSuccess, setIsSavedNoteSuccess] = useState(false);
  const [isAllEntriesModalOpen, setIsAllEntriesModalOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // 5 Mood definitions matching screenshot
  const moods = [
    {
      id: "ecstatic" as const,
      label: "Peak Energy",
      shortLabel: "Peak Energy",
      icon: Zap,
      selectedStyle:
        "border-2 border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 shadow-xs",
      badgeStyle:
        "bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-200/60 dark:border-purple-800/40",
    },
    {
      id: "great" as const,
      label: "Great / Clear",
      shortLabel: "Great",
      icon: Sun,
      selectedStyle:
        "border-2 border-amber-400 bg-amber-50/70 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 shadow-xs",
      badgeStyle:
        "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/40",
    },
    {
      id: "neutral" as const,
      label: "Steady",
      shortLabel: "Steady",
      icon: Smile,
      selectedStyle:
        "border-2 border-blue-400 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 shadow-xs",
      badgeStyle:
        "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/40",
    },
    {
      id: "tired" as const,
      label: "Fatigued",
      shortLabel: "Fatigued",
      icon: Cloud,
      selectedStyle:
        "border-2 border-slate-400 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 shadow-xs",
      badgeStyle:
        "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/40",
    },
    {
      id: "stressed" as const,
      label: "Overwhelmed",
      shortLabel: "Overwhelmed",
      icon: Activity,
      selectedStyle:
        "border-2 border-rose-400 bg-rose-50/70 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 shadow-xs",
      badgeStyle:
        "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/40",
    },
  ];

  // Tasks and habit counts for the selected date
  const tasksDoneCount = tasks.filter((t) => t.dueDate === selectedDate && t.completed).length;
  const habitsLoggedCount = habits.filter((h) => h.history && h.history[selectedDate]).length;

  const handleSelectDate = (dateStr: string) => {
    setSelectedDate(dateStr);
    const existing = allMergedEntries.find((e) => e.date === dateStr);
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
      particleCount: 30,
      spread: 55,
      origin: { y: 0.7 },
      colors: ["#3b82f6", "#10b981", "#8b5cf6"],
    });
    setTimeout(() => setSavedSuccess(false), 2200);
  };

  const handleAddWin = () => {
    if (!newWin.trim()) return;
    setCurrentEntry((prev) => ({ ...prev, wins: [...prev.wins, newWin.trim()] }));
    setNewWin("");
  };

  const handleRemoveWin = (index: number) => {
    setCurrentEntry((prev) => ({
      ...prev,
      wins: prev.wins.filter((_, idx) => idx !== index),
    }));
  };

  const handleAddChallenge = () => {
    if (!newChallenge.trim()) return;
    setCurrentEntry((prev) => ({ ...prev, challenges: [...prev.challenges, newChallenge.trim()] }));
    setNewChallenge("");
  };

  const handleRemoveChallenge = (index: number) => {
    setCurrentEntry((prev) => ({
      ...prev,
      challenges: prev.challenges.filter((_, idx) => idx !== index),
    }));
  };

  // Textarea formatting tools (Bold, Italic, Link, Bullet, Numbered)
  const handleFormat = (type: "bold" | "italic" | "link" | "bullet" | "ordered") => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = currentEntry.content;
    const selectedText = text.substring(start, end);

    let replacement = "";
    let cursorOffset = 0;

    if (type === "bold") {
      replacement = `**${selectedText || "bold text"}**`;
      cursorOffset = selectedText ? replacement.length : 2;
    } else if (type === "italic") {
      replacement = `*${selectedText || "italic text"}*`;
      cursorOffset = selectedText ? replacement.length : 1;
    } else if (type === "link") {
      replacement = selectedText ? `[${selectedText}](url)` : `[link title](url)`;
      cursorOffset = replacement.length;
    } else if (type === "bullet") {
      replacement = `\n- ${selectedText || "bullet point"}`;
      cursorOffset = replacement.length;
    } else if (type === "ordered") {
      replacement = `\n1. ${selectedText || "numbered item"}`;
      cursorOffset = replacement.length;
    }

    const updatedContent = text.substring(0, start) + replacement + text.substring(end);
    setCurrentEntry((prev) => ({ ...prev, content: updatedContent }));

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + cursorOffset, start + cursorOffset);
    }, 0);
  };

  // Write with AI actions
  const handleAiWritingAction = async (action: "deepen" | "stoic" | "polish") => {
    setIsAiMenuOpen(false);
    if (!openRouterKey) {
      onOpenSettings();
      return;
    }

    setIsSynthesizing(true);
    try {
      let prompt = "";
      if (action === "deepen") {
        prompt = `Review this reflection snippet and add 2 thought-provoking Socratic introspection prompts and an encouraging insight:\n\n"${currentEntry.content || "Reflecting on today's execution"}"`;
      } else if (action === "stoic") {
        prompt = `Review this journal reflection from a Marcus Aurelius / Epictetus Stoic perspective. Provide one grounding Stoic reframe on control and virtue:\n\n"${currentEntry.content || "Overcoming friction"}"`;
      } else if (action === "polish") {
        prompt = `Polish and improve the clarity, cadence, and elegance of this journal entry while preserving its authentic personal tone:\n\n"${currentEntry.content}"`;
      }

      const result = await queryOpenRouter([{ role: "user", content: prompt }], openRouterKey);
      setCurrentEntry((prev) => ({
        ...prev,
        content: prev.content ? `${prev.content}\n\n---\n*AI Writing Assistant*:\n${result}` : result,
      }));
    } catch (err: any) {
      alert("AI Writing error: " + err.message);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Right column AI Synthesis trigger (Full, Action items, Trends)
  const handleTriggerSynthesis = async (type: "full" | "actions" | "trends") => {
    if (!openRouterKey) {
      onOpenSettings();
      return;
    }

    setIsSynthesizing(true);
    try {
      let insight = "";
      if (type === "full") {
        insight = await onSynthesizeAI(currentEntry);
      } else if (type === "actions") {
        const prompt = `Review this daily reflection and extract 2 to 3 concrete actionable GTD tasks or habit tweaks for tomorrow. Format in clean bullet points:\n\nTitle: "${currentEntry.title}"\nContent: "${currentEntry.content}"\nWins: ${currentEntry.wins.join(", ")}\nObstacles: ${currentEntry.challenges.join(", ")}`;
        insight = await queryOpenRouter([{ role: "user", content: prompt }], openRouterKey);
      } else if (type === "trends") {
        const recent = allMergedEntries
          .slice(0, 5)
          .map((e) => `[${e.date} (${e.mood})]: ${e.title} - ${e.content.slice(0, 80)}`)
          .join("\n");
        const prompt = `Analyze emotional and execution trends across the user's recent days:\n${recent}\n\nProvide 2-3 bulleted observations on consistency, energy, and cognitive friction.`;
        insight = await queryOpenRouter([{ role: "user", content: prompt }], openRouterKey);
      }

      setCurrentEntry((prev) => {
        const updated = { ...prev, aiReflection: insight };
        onSaveEntry(updated);
        return updated;
      });
    } catch (err: any) {
      alert("AI Synthesis notice: " + (err.message || "Failed to reach AI service"));
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleCopySynthesis = () => {
    if (!currentEntry.aiReflection) return;
    navigator.clipboard.writeText(currentEntry.aiReflection);
    setIsCopiedSynthesis(true);
    setTimeout(() => setIsCopiedSynthesis(false), 2000);
  };

  const handleSaveSynthesisToNotes = () => {
    if (!currentEntry.aiReflection || !onSaveKnowledge) return;
    const today = new Date().toISOString().split("T")[0];
    const note: KnowledgeItem = {
      id: `kn-journal-${Date.now()}`,
      subject: `Synthesis: ${currentEntry.title || currentEntry.date}`,
      title: `Synthesis: ${currentEntry.title || currentEntry.date}`,
      content: currentEntry.aiReflection,
      summary: currentEntry.aiReflection.slice(0, 180),
      folderId: null,
      status: "Synthesized",
      startDate: today,
      endDate: today,
      domain: "Journal Synthesis",
      tags: ["Reflection", "AISynthesis"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onSaveKnowledge(note);
    setIsSavedNoteSuccess(true);
    confetti({ particleCount: 30, spread: 50, origin: { y: 0.6 } });
    setTimeout(() => setIsSavedNoteSuccess(false), 2500);
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-4 sm:py-6 space-y-6 animate-fade-in">
      {/* ========================================================= */}
      {/* TOP HEADER MATCHING USER REFERENCE SCREENSHOT            */}
      {/* ========================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Open Book Badge + Title + Subtitle */}
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100/80 dark:border-indigo-900/40 flex items-center justify-center shrink-0 shadow-xs">
            <BookOpen className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              Reflective Journal & Cognitive Synthesis
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium mt-0.5">
              Capture subconscious flow, track emotional calibration, and receive deep AI coaching.
            </p>
          </div>
        </div>

        {/* Right: AI Cognitive Synthesis button + Save Entry button */}
        <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-auto">
          <button
            onClick={() => handleTriggerSynthesis("full")}
            disabled={isSynthesizing}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white font-bold text-xs sm:text-sm shadow-md shadow-indigo-500/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4 fill-white/80" />
            <span>{isSynthesizing ? "Synthesizing..." : "AI Cognitive Synthesis"}</span>
          </button>

          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#121424] text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 font-bold text-xs sm:text-sm shadow-xs active:scale-95 transition-all"
          >
            <Save className="w-4 h-4 stroke-[2]" />
            <span>{savedSuccess ? "Saved!" : "Save Entry"}</span>
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* MAIN TWO-COLUMN WORKSPACE                                */}
      {/* ========================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* --------------------------------------------------------- */}
        {/* LEFT COLUMN (8 cols): Main Journal Form Card              */}
        {/* --------------------------------------------------------- */}
        <div className="lg:col-span-8 space-y-4">
          <div className="rounded-3xl border border-slate-200/80 dark:border-[#232646] bg-white dark:bg-[#101223] p-5 sm:p-6 shadow-xs space-y-5">
            {/* Top row: Date Selector Pill + Progress Indicator */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
              {/* Date Pill with Calendar and Chevron buttons */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 shadow-2xs">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <button
                  type="button"
                  onClick={() => handleSelectDate(shiftDate(selectedDate, -1))}
                  className="p-0.5 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                  title="Previous day"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span
                  onClick={() => dateInputRef.current?.showPicker?.()}
                  className="text-xs font-bold cursor-pointer select-none px-1 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                  title="Click to jump to date"
                >
                  {formatDisplayDate(selectedDate)}
                </span>
                <button
                  type="button"
                  onClick={() => handleSelectDate(shiftDate(selectedDate, 1))}
                  className="p-0.5 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                  title="Next day"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <input
                  ref={dateInputRef}
                  type="date"
                  value={selectedDate}
                  onChange={(e) => e.target.value && handleSelectDate(e.target.value)}
                  className="sr-only"
                />
              </div>

              {/* Real Task & Habit progress */}
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {tasksDoneCount} tasks done • {habitsLoggedCount}{" "}
                  {habitsLoggedCount === 1 ? "habit" : "habits"} logged
                </span>
              </div>
            </div>

            {/* Row 2: Mood / Emotional Calibration (5 Pills) */}
            <div className="flex flex-wrap items-center gap-2">
              {moods.map((m) => {
                const Icon = m.icon;
                const isSelected = currentEntry.mood === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setCurrentEntry((prev) => ({ ...prev, mood: m.id }))}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
                      isSelected
                        ? m.selectedStyle
                        : "border border-slate-200/70 dark:border-slate-800 bg-white/70 dark:bg-slate-900/40 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700 hover:text-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Row 3: Entry Title / Daily Theme */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Entry Title / Daily Theme
              </label>
              <input
                type="text"
                placeholder="e.g. Productive Monday, Reset, Learning Mode..."
                value={currentEntry.title}
                onChange={(e) => setCurrentEntry((prev) => ({ ...prev, title: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30 px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500 transition-colors"
              />
            </div>

            {/* Row 4: Main Content Container with Top Toolbar */}
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/20 overflow-hidden focus-within:border-indigo-400 dark:focus-within:border-indigo-500/80 transition-colors">
              {/* Toolbar */}
              <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800/80 px-3 py-2 bg-white/70 dark:bg-slate-900/50">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleFormat("bold")}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold"
                    title="Bold (**text**)"
                  >
                    <Bold className="w-3.5 h-3.5 stroke-[2.5]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFormat("italic")}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-serif italic"
                    title="Italic (*text*)"
                  >
                    <Italic className="w-3.5 h-3.5 stroke-[2.5]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFormat("link")}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs"
                    title="Insert Link ([text](url))"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFormat("bullet")}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs"
                    title="Bullet List (- item)"
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFormat("ordered")}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs"
                    title="Numbered List (1. item)"
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Write with AI Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsAiMenuOpen(!isAiMenuOpen)}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300 text-xs font-semibold border border-purple-200/60 dark:border-purple-800/50 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    <span>Write with AI</span>
                    <ChevronRight
                      className={`w-3 h-3 transition-transform ${isAiMenuOpen ? "rotate-90" : ""}`}
                    />
                  </button>

                  {isAiMenuOpen && (
                    <div className="absolute right-0 top-full mt-1.5 w-56 rounded-2xl bg-white dark:bg-[#141721] border border-slate-200 dark:border-slate-800 shadow-xl p-1.5 z-20 space-y-1 animate-fade-in">
                      <button
                        onClick={() => handleAiWritingAction("deepen")}
                        className="w-full text-left px-3 py-2 rounded-xl text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 font-medium"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                        <span>Deepen Reflection</span>
                      </button>
                      <button
                        onClick={() => handleAiWritingAction("stoic")}
                        className="w-full text-left px-3 py-2 rounded-xl text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 font-medium"
                      >
                        <Activity className="w-3.5 h-3.5 text-amber-500" />
                        <span>Stoic Reframe & Mindset</span>
                      </button>
                      <button
                        onClick={() => handleAiWritingAction("polish")}
                        className="w-full text-left px-3 py-2 rounded-xl text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 font-medium"
                      >
                        <Bold className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Polish & Clarify Flow</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Main Textarea */}
              <textarea
                ref={textareaRef}
                rows={8}
                placeholder="What went down today? How did you manage energy, deep work, and habits? What were the standout moments?"
                value={currentEntry.content}
                onChange={(e) => setCurrentEntry((prev) => ({ ...prev, content: e.target.value }))}
                className="w-full bg-transparent px-4 py-3.5 text-xs sm:text-sm leading-relaxed text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none resize-none font-medium"
              />
            </div>

            {/* Row 5: Two Sub-Boxes at bottom (Wins & Obstacles) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              {/* Box 1: Key Wins & Breakthroughs */}
              <div className="rounded-2xl border border-emerald-200/60 dark:border-emerald-900/40 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                  <Sun className="w-3.5 h-3.5" />
                  <span>Key Wins & Breakthroughs</span>
                </div>

                <div className="space-y-2">
                  {currentEntry.wins.map((win, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900/60 border border-emerald-200/50 dark:border-emerald-900/30 text-xs text-slate-800 dark:text-slate-200 group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="truncate font-medium">{win}</span>
                      </div>
                      <button
                        onClick={() => handleRemoveWin(idx)}
                        className="text-slate-400 hover:text-rose-500 p-0.5 opacity-60 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}

                  {/* Input Row */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 flex items-center">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 absolute left-3 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Add a win..."
                        value={newWin}
                        onChange={(e) => setNewWin(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddWin()}
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-emerald-200/80 dark:border-emerald-900/60 bg-white dark:bg-slate-900/70 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
                      />
                    </div>
                    <button
                      onClick={handleAddWin}
                      className="w-7 h-7 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shrink-0 shadow-xs transition-colors"
                      title="Add win"
                    >
                      <Plus className="w-4 h-4 stroke-[2.5]" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Box 2: Obstacles & Strategic Friction */}
              <div className="rounded-2xl border border-amber-200/60 dark:border-amber-900/40 bg-amber-50/20 dark:bg-amber-950/10 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Obstacles & Strategic Friction</span>
                </div>

                <div className="space-y-2">
                  {currentEntry.challenges.map((c, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900/60 border border-amber-200/50 dark:border-amber-900/30 text-xs text-slate-800 dark:text-slate-200 group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Circle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="truncate font-medium">{c}</span>
                      </div>
                      <button
                        onClick={() => handleRemoveChallenge(idx)}
                        className="text-slate-400 hover:text-rose-500 p-0.5 opacity-60 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}

                  {/* Input Row */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 flex items-center">
                      <Circle className="w-3.5 h-3.5 text-amber-500 absolute left-3 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Add an obstacle..."
                        value={newChallenge}
                        onChange={(e) => setNewChallenge(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddChallenge()}
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-amber-200/80 dark:border-amber-900/60 bg-white dark:bg-slate-900/70 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-amber-500 transition-colors"
                      />
                    </div>
                    <button
                      onClick={handleAddChallenge}
                      className="w-7 h-7 rounded-full bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center shrink-0 shadow-xs transition-colors"
                      title="Add obstacle"
                    >
                      <Plus className="w-4 h-4 stroke-[2.5]" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* --------------------------------------------------------- */}
        {/* RIGHT COLUMN (4 cols): AI Synthesis + Previous Entries    */}
        {/* --------------------------------------------------------- */}
        <div className="lg:col-span-4 space-y-5">
          {/* Card 1: AI SECOND BRAIN SYNTHESIS */}
          <div className="rounded-3xl border border-indigo-100/90 dark:border-[#28274a] bg-gradient-to-br from-indigo-50/70 via-purple-50/40 to-white dark:from-[#17152b] dark:via-[#131424] dark:to-[#101223] p-5 shadow-xs space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span className="text-xs font-black tracking-wider uppercase text-purple-700 dark:text-purple-300">
                  AI Second Brain Synthesis
                </span>
              </div>
              <button
                onClick={() => handleTriggerSynthesis("full")}
                className="w-6 h-6 rounded-lg flex items-center justify-center text-purple-600 dark:text-purple-400 hover:bg-purple-100/60 dark:hover:bg-purple-900/40 transition-colors"
                title="Run full synthesis"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
              Turn your thoughts into deeper insights, pattern analysis, and personalized coaching.
            </p>

            {/* 3 Action Buttons */}
            <div className="space-y-2">
              {/* 1. Generate Full Analysis */}
              <div
                onClick={() => handleTriggerSynthesis("full")}
                className="flex items-center justify-between p-3 rounded-2xl bg-white/90 dark:bg-[#121424]/90 border border-slate-200/70 dark:border-slate-800 hover:border-indigo-400/60 dark:hover:border-indigo-500/50 cursor-pointer transition-all group shadow-2xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      Generate Full Analysis
                    </h4>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate font-medium">
                      Thought patterns, emotions, and insights
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition-colors shrink-0 ml-1" />
              </div>

              {/* 2. Extract Action Items */}
              <div
                onClick={() => handleTriggerSynthesis("actions")}
                className="flex items-center justify-between p-3 rounded-2xl bg-white/90 dark:bg-[#121424]/90 border border-slate-200/70 dark:border-slate-800 hover:border-purple-400/60 dark:hover:border-purple-500/50 cursor-pointer transition-all group shadow-2xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <ListChecks className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      Extract Action Items
                    </h4>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate font-medium">
                      Convert insights into tasks and habits
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-purple-500 transition-colors shrink-0 ml-1" />
              </div>

              {/* 3. Reflect on Trends */}
              <div
                onClick={() => handleTriggerSynthesis("trends")}
                className="flex items-center justify-between p-3 rounded-2xl bg-white/90 dark:bg-[#121424]/90 border border-slate-200/70 dark:border-slate-800 hover:border-blue-400/60 dark:hover:border-blue-500/50 cursor-pointer transition-all group shadow-2xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      Reflect on Trends
                    </h4>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate font-medium">
                      See progress over time
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-blue-500 transition-colors shrink-0 ml-1" />
              </div>
            </div>

            {/* Generated AI Reflection / Coaching content if present */}
            {currentEntry.aiReflection && (
              <div className="pt-2 border-t border-purple-100/80 dark:border-slate-800 space-y-2 animate-fade-in">
                <div className="flex items-center justify-between text-[11px] font-bold text-purple-700 dark:text-purple-300">
                  <span>Coaching Synthesis</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopySynthesis}
                      className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    >
                      {isCopiedSynthesis ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{isCopiedSynthesis ? "Copied" : "Copy"}</span>
                    </button>
                    {onSaveKnowledge && (
                      <button
                        onClick={handleSaveSynthesisToNotes}
                        className="flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
                      >
                        {isSavedNoteSuccess ? (
                          <Check className="w-3 h-3 text-emerald-500" />
                        ) : (
                          <Bookmark className="w-3 h-3" />
                        )}
                        <span>{isSavedNoteSuccess ? "Saved!" : "Save Note"}</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-60 overflow-y-auto pr-1 text-xs text-slate-700 dark:text-slate-300 bg-white/80 dark:bg-slate-900/70 p-3.5 rounded-2xl border border-purple-100/80 dark:border-purple-900/40 leading-relaxed font-medium">
                  <MarkdownView content={currentEntry.aiReflection} />
                </div>
              </div>
            )}
          </div>

          {/* Card 2: PREVIOUS ENTRIES */}
          <div className="rounded-3xl border border-slate-200/80 dark:border-[#232646] bg-white dark:bg-[#101223] p-5 shadow-xs space-y-3.5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400">
                PREVIOUS ENTRIES
              </span>
              <button
                onClick={() => setIsAllEntriesModalOpen(true)}
                className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>View All</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {/* Past Entries List */}
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {allMergedEntries.map((entry) => {
                const { month, day } = parseMonthDay(entry.date);
                const isSelected = entry.date === selectedDate;
                const moodConfig = moods.find((m) => m.id === entry.mood) || moods[1];

                return (
                  <div
                    key={entry.id}
                    onClick={() => handleSelectDate(entry.date)}
                    className={`flex items-center justify-between gap-3 p-2.5 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700 shadow-xs"
                        : "bg-slate-50/60 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700"
                    }`}
                  >
                    {/* Left Date Box */}
                    <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 flex flex-col items-center justify-center shrink-0 shadow-2xs">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight leading-none">
                        {month}
                      </span>
                      <span className="text-xs font-black text-slate-900 dark:text-white leading-none mt-0.5">
                        {day}
                      </span>
                    </div>

                    {/* Middle Info */}
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {entry.title || "Untitled Reflection"}
                      </h4>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5 font-medium">
                        {entry.content || "No reflection body recorded."}
                      </p>
                    </div>

                    {/* Right Mood Pill */}
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize shrink-0 ${moodConfig.badgeStyle}`}
                    >
                      {moodConfig.shortLabel || moodConfig.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* "VIEW ALL ENTRIES" MODAL                                  */}
      {/* ========================================================= */}
      {isAllEntriesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-[#121424] rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                All Journal Entries ({allMergedEntries.length})
              </h3>
              <button
                onClick={() => setIsAllEntriesModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-2">
              {allMergedEntries.map((e) => (
                <div
                  key={e.id}
                  onClick={() => {
                    handleSelectDate(e.date);
                    setIsAllEntriesModalOpen(false);
                  }}
                  className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] text-slate-400 font-bold uppercase">{e.date}</div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {e.title || "Untitled Reflection"}
                    </div>
                  </div>
                  <span className="text-[10px] font-bold capitalize px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                    {e.mood}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useState, useEffect, useRef } from "react";
import {
  BrainState,
  Task,
  Goal,
  JournalEntry,
  KnowledgeItem,
  DailyBrief,
} from "../types";
import { generateDailyBriefWithAI } from "../services/openrouter";
import { getLocalDateString } from "../utils/habitStreaks";
import confetti from "canvas-confetti";
import {
  Sparkles,
  ArrowUp,
  Mic,
  MicOff,
  Target,
  CheckSquare,
  BookOpen,
  FolderPlus,
  Search,
  Zap,
  ChevronDown,
  ChevronUp,
  Database,
  History,
} from "lucide-react";

type CaptureType = "auto" | "goal" | "task" | "journal" | "knowledge";

interface HomeViewProps {
  brainState: BrainState;
  onSaveTask: (task: Task) => void;
  onSaveGoal: (goal: Goal) => void;
  onSaveJournal: (entry: JournalEntry) => void;
  onSaveKnowledge: (item: KnowledgeItem) => void;
  onOpenGoalModal: () => void;
  onOpenQuickCapture: () => void;
  onOpenGlobalSearch: () => void;
  onOpenAICopilot: () => void;
  onOpenVault: () => void;
  onOpenAuditLog?: () => void;
  onNavigateTab?: (tab: string) => void;
  openRouterKey: string;
  onUpdateDailyBrief: (brief: DailyBrief) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  brainState,
  onSaveTask,
  onSaveGoal,
  onSaveJournal,
  onSaveKnowledge,
  onOpenGoalModal,
  onOpenQuickCapture,
  onOpenGlobalSearch,
  onOpenAICopilot,
  onOpenVault,
  onOpenAuditLog,
  openRouterKey,
  onUpdateDailyBrief,
}) => {
  const [inputText, setInputText] = useState("");
  const [selectedType, setSelectedType] = useState<CaptureType>("auto");
  const [isRecording, setIsRecording] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureFeedback, setCaptureFeedback] = useState<string | null>(null);
  const [showBriefAccordion, setShowBriefAccordion] = useState(false);
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  const todayStr = getLocalDateString(new Date());

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        Math.max(textareaRef.current.scrollHeight, 60),
        180
      )}px`;
    }
  }, [inputText]);

  // Speech-to-text recognition setup
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join("");
        setInputText(transcript);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognition.onerror = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      setCaptureFeedback("Voice capture: Speech API unavailable in this browser.");
      setTimeout(() => setCaptureFeedback(null), 3000);
      return;
    }

    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (err) {
        setIsRecording(false);
      }
    }
  };

  // Auto-classifier heuristic
  const classifyInput = (text: string): CaptureType => {
    const lower = text.toLowerCase();
    // Goal detection
    if (
      lower.startsWith("goal:") ||
      lower.includes("achieve") ||
      lower.includes("strive") ||
      lower.includes("reach $") ||
      lower.includes("gpa") ||
      lower.includes("long term") ||
      lower.includes("become a") ||
      lower.includes("master ")
    ) {
      return "goal";
    }

    // Journal / reflection detection
    if (
      lower.startsWith("journal:") ||
      lower.includes("i feel") ||
      lower.includes("felt like") ||
      lower.includes("today i") ||
      lower.includes("grateful for") ||
      lower.includes("reflection:") ||
      lower.includes("proud of")
    ) {
      return "journal";
    }

    // Knowledge / note detection
    if (
      lower.startsWith("note:") ||
      lower.startsWith("learn:") ||
      lower.includes("read article") ||
      lower.includes("paper on") ||
      lower.includes("concept:") ||
      lower.includes("summary:") ||
      lower.includes("definition:")
    ) {
      return "knowledge";
    }

    // Default to task
    return "task";
  };

  const handleCaptureSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanText = inputText.trim();
    if (!cleanText || isCapturing) return;

    setIsCapturing(true);

    const effectiveType = selectedType === "auto" ? classifyInput(cleanText) : selectedType;

    try {
      if (effectiveType === "goal") {
        const titleClean = cleanText.replace(/^(goal:)/i, "").trim();
        const goalSector = (
          titleClean.toLowerCase().includes("money") || titleClean.toLowerCase().includes("dollar") || titleClean.toLowerCase().includes("$")
            ? "finance"
            : titleClean.toLowerCase().includes("study") || titleClean.toLowerCase().includes("gpa") || titleClean.toLowerCase().includes("grade") || titleClean.toLowerCase().includes("class")
            ? "academics"
            : titleClean.toLowerCase().includes("workout") || titleClean.toLowerCase().includes("run") || titleClean.toLowerCase().includes("gym") || titleClean.toLowerCase().includes("marathon")
            ? "health"
            : titleClean.toLowerCase().includes("mind") || titleClean.toLowerCase().includes("stoic") || titleClean.toLowerCase().includes("read")
            ? "mindset"
            : "career"
        );

        const newGoal: Goal = {
          id: `goal-${Date.now()}`,
          title: titleClean,
          sector: goalSector,
          timeframe: "yearly",
          progress: 0,
          status: "in_progress",
          milestones: [
            { id: `gm-${Date.now()}-1`, title: "Define roadmap and core milestones", completed: false },
            { id: `gm-${Date.now()}-2`, title: "Execute daily/weekly lead indicators", completed: false },
          ],
          why: "Self-improvement commitment captured from Home Command Center.",
          createdAt: new Date().toISOString(),
        };

        onSaveGoal(newGoal);
        setCaptureFeedback(`✨ Captured as Life Goal (${goalSector})`);
        confetti({ particleCount: 40, spread: 60, origin: { y: 0.6 } });
      } else if (effectiveType === "journal") {
        const titleClean = cleanText.replace(/^(journal:)/i, "").trim();
        const newJournal: JournalEntry = {
          id: `journal-${Date.now()}`,
          date: todayStr,
          title: titleClean.slice(0, 50) || "Evening Reflection",
          content: cleanText,
          mood: "great",
          wins: ["Reflective focus captured"],
          challenges: [],
          tags: ["DailyCapture"],
        };

        onSaveJournal(newJournal);
        setCaptureFeedback("📖 Saved to Daily Journal");
        confetti({ particleCount: 25, spread: 45, origin: { y: 0.6 } });
      } else if (effectiveType === "knowledge") {
        const titleClean = cleanText.replace(/^(note:|learn:)/i, "").trim();
        const newNote: KnowledgeItem = {
          id: `know-${Date.now()}`,
          subject: titleClean.slice(0, 48) || "Knowledge Synthesis",
          status: "Synthesized",
          startDate: todayStr,
          endDate: todayStr,
          domain: "General",
          summary: cleanText,
          itemCount: 1,
        };

        onSaveKnowledge(newNote);
        setCaptureFeedback("📝 Saved to Knowledge Vault");
        confetti({ particleCount: 25, spread: 45, origin: { y: 0.6 } });
      } else {
        // Task
        const titleClean = cleanText.replace(/^(task:|todo:)/i, "").trim();
        const matchedSection = brainState.sections[0] || "Career";
        const matchedSub = brainState.subsections[matchedSection]?.[0] || "General";

        const newTask: Task = {
          id: `task-${Date.now()}`,
          title: titleClean,
          dueDate: todayStr,
          priority: "high",
          section: matchedSection,
          subsection: matchedSub,
          completed: false,
          status: "not_started",
        };

        onSaveTask(newTask);
        setCaptureFeedback(`✅ Task created in ${matchedSection}`);
        confetti({ particleCount: 30, spread: 50, origin: { y: 0.6 } });
      }

      setInputText("");
    } catch (e) {
      console.error("Capture failed:", e);
      setCaptureFeedback("Error capturing item.");
    } finally {
      setIsCapturing(false);
      setTimeout(() => setCaptureFeedback(null), 3500);
    }
  };

  const handleGenerateBrief = async () => {
    setIsGeneratingBrief(true);
    try {
      const brief = await generateDailyBriefWithAI(
        brainState.tasks,
        brainState.habits,
        brainState.journalEntries,
        openRouterKey,
        brainState.selectedModel
      );
      onUpdateDailyBrief(brief);
    } catch (e) {
      console.error("Failed to generate brief:", e);
    } finally {
      setIsGeneratingBrief(false);
    }
  };

  // Due today & quick metrics
  const dueTodayTasks = brainState.tasks.filter((t) => !t.completed && t.dueDate === todayStr);
  const activeHabits = brainState.habits;
  const completedHabitsToday = activeHabits.filter((h) => h.history[todayStr]).length;
  const activeGoals = brainState.goals || [];

  return (
    <div className="flex flex-col items-center justify-center min-h-[72vh] px-4 py-8 animate-fade-in">
      {/* Centered Brand Emblem (matching Perplexity visual organization) */}
      <div className="flex flex-col items-center text-center mb-6">
        <div className="relative group cursor-pointer" onClick={onOpenAICopilot}>
          {/* Faceted Monogram / Logo */}
          <div className="w-14 h-14 rounded-3xl bg-slate-100 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:scale-105 group-hover:border-indigo-500/50">
            <svg
              className="w-7 h-7 text-indigo-600 dark:text-indigo-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900 animate-pulse" />
        </div>

        {/* Crisp Central Question Heading */}
        <h1 className="text-2xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight mt-5">
          Where should we start?
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md">
          Capture tasks, life goals, journal notes, or query your second brain vault.
        </p>
      </div>

      {/* Main Perplexity-Style Centered Input Card */}
      <div className="w-full max-w-2xl">
        <div className="relative rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xl dark:shadow-2xl dark:shadow-black/60 backdrop-blur-xl transition-all duration-200 focus-within:ring-2 focus-within:ring-indigo-500/30 focus-within:border-indigo-500/60 overflow-hidden">
          {/* Textarea Input Field */}
          <div className="p-4 sm:p-5 pb-2">
            <textarea
              ref={textareaRef}
              rows={2}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleCaptureSubmit();
                }
              }}
              placeholder="Ask anything or capture anything... (tasks, life goals, thoughts, notes)"
              className="w-full bg-transparent text-sm sm:text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none resize-none leading-relaxed font-medium"
            />
          </div>

          {/* Bottom Card Toolbar (Type selector, Context, Model, Mic, Submit) */}
          <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 bg-slate-50/70 dark:bg-slate-900/70 border-t border-slate-100 dark:border-slate-800/80">
            {/* Left Tools: Type Pill & Second Brain Context */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
              {/* Type Pill Dropdown/Selector */}
              <div className="relative flex items-center bg-slate-200/70 dark:bg-slate-800 rounded-2xl p-0.5">
                {(
                  [
                    { id: "auto", label: "Auto", icon: Sparkles },
                    { id: "goal", label: "Goal", icon: Target },
                    { id: "task", label: "Task", icon: CheckSquare },
                    { id: "journal", label: "Journal", icon: BookOpen },
                    { id: "knowledge", label: "Note", icon: FolderPlus },
                  ] as const
                ).map((t) => {
                  const Icon = t.icon;
                  const isSelected = selectedType === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedType(t.id)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all ${
                        isSelected
                          ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs"
                          : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      <span className="hidden sm:inline">{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Source/Vault Context Pill */}
              <button
                type="button"
                onClick={onOpenVault}
                title="Semantic Memory Vault status"
                className="hidden md:flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-400 transition-colors"
              >
                <Database className="w-3 h-3 text-indigo-500" />
                <span>Vault</span>
              </button>
            </div>

            {/* Right Tools: Model Name, Mic & Circular Submit Action Button */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Active Model Pill */}
              <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                <span className="truncate max-w-[100px]">
                  {brainState.selectedModel?.split("/")[1] || "Claude 3.5"}
                </span>
              </div>

              {/* Speech-to-Text Microphone Button */}
              <button
                type="button"
                onClick={toggleRecording}
                title={isRecording ? "Stop recording" : "Voice quick capture"}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                  isRecording
                    ? "bg-rose-500 text-white animate-pulse"
                    : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              {/* Circular Submit Button (Perplexity white/accent circle button) */}
              <button
                type="button"
                onClick={() => handleCaptureSubmit()}
                disabled={!inputText.trim() || isCapturing}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shadow-md ${
                  inputText.trim() && !isCapturing
                    ? "bg-indigo-600 hover:bg-indigo-500 text-white hover:scale-105 active:scale-95 cursor-pointer"
                    : "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-60"
                }`}
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>
          </div>
        </div>

        {/* Capture Confirmation Feedback Toast */}
        {captureFeedback && (
          <div className="mt-3 py-1.5 px-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold text-indigo-700 dark:text-indigo-300 text-center animate-fade-in shadow-2xs">
            {captureFeedback}
          </div>
        )}

        {/* Quick Suggestion Pills Directly Underneath Input */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-5 text-xs">
          <button
            onClick={onOpenGoalModal}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-2xl bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold border border-slate-200/50 dark:border-slate-800 transition-all hover:scale-102"
          >
            <Target className="w-3.5 h-3.5 text-indigo-500" />
            <span>Set Life Goal</span>
          </button>

          <button
            onClick={onOpenQuickCapture}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-2xl bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold border border-slate-200/50 dark:border-slate-800 transition-all hover:scale-102"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>Quick Capture</span>
            <kbd className="text-[10px] font-mono opacity-60">⌘⌥N</kbd>
          </button>

          <button
            onClick={onOpenGlobalSearch}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-2xl bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold border border-slate-200/50 dark:border-slate-800 transition-all hover:scale-102"
          >
            <Search className="w-3.5 h-3.5 text-cyan-500" />
            <span>Search Brain</span>
            <kbd className="text-[10px] font-mono opacity-60">⌘K</kbd>
          </button>

          <button
            onClick={onOpenAICopilot}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-2xl bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold border border-slate-200/50 dark:border-slate-800 transition-all hover:scale-102"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-500" />
            <span>Ask Copilot</span>
          </button>

          {onOpenAuditLog && (
            <button
              onClick={onOpenAuditLog}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-2xl bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold border border-slate-200/50 dark:border-slate-800 transition-all hover:scale-102"
            >
              <History className="w-3.5 h-3.5 text-cyan-500" />
              <span>Event Log</span>
              <kbd className="text-[10px] font-mono opacity-60">⌘Z</kbd>
            </button>
          )}
        </div>
      </div>

      {/* Subdued Minimalist Daily Focus Accordion (Optional Collapsible) */}
      <div className="w-full max-w-2xl mt-10">
        <button
          onClick={() => setShowBriefAccordion(!showBriefAccordion)}
          className="w-full flex items-center justify-between px-4 py-2.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/40 dark:hover:bg-slate-900/80 border border-slate-200/60 dark:border-slate-800/60 text-xs font-bold text-slate-600 dark:text-slate-400 transition-all"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            <span>Today's Executive Brief & Focus</span>
            <span className="text-[11px] font-normal text-slate-400">
              ({dueTodayTasks.length} tasks due, {completedHabitsToday}/{activeHabits.length} habits done, {activeGoals.length} life goals)
            </span>
          </div>
          {showBriefAccordion ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showBriefAccordion && (
          <div className="mt-3 p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800/70 shadow-sm animate-fade-in space-y-4">
            {brainState.dailyBrief ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 font-bold">
                      {brainState.dailyBrief.date} // Synthesis
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      {brainState.dailyBrief.headline}
                    </h3>
                  </div>
                  <button
                    onClick={handleGenerateBrief}
                    disabled={isGeneratingBrief}
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Refresh briefing"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${isGeneratingBrief ? "animate-spin" : ""}`} />
                  </button>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {brainState.dailyBrief.summary}
                </p>

                {/* Priority items */}
                {brainState.dailyBrief.topPriorities && (
                  <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Key Objectives
                    </div>
                    {brainState.dailyBrief.topPriorities.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-xs py-1 px-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50"
                      >
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {item.title}
                        </span>
                        <span className="text-[11px] text-slate-400">{item.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-xs text-slate-400 mb-2">No executive brief generated for today yet.</p>
                <button
                  onClick={handleGenerateBrief}
                  disabled={isGeneratingBrief}
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all inline-flex items-center gap-1.5"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isGeneratingBrief ? "animate-spin" : ""}`} />
                  <span>{isGeneratingBrief ? "Synthesizing..." : "Generate Morning Brief"}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

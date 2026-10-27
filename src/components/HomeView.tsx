import React, { useState, useEffect, useRef } from "react";
import {
  BrainState,
  Task,
  Goal,
  Habit,
  JournalEntry,
  KnowledgeItem,
} from "../types";
import { AutonomousBrainAgent, AgentExecutionResult } from "../services/agentDispatcher";
import confetti from "canvas-confetti";
import {
  Sparkles,
  ArrowUp,
  Mic,
  MicOff,
  Globe,
  Sliders,
  Plus,
  ClipboardList,
  Target,
  CheckSquare,
  ChevronRight,
  ChevronDown,
  Undo2,
  Layers,
  ArrowRight,
  FileText,
  BookOpen,
} from "lucide-react";

interface HomeViewProps {
  brainState: BrainState;
  onSaveTask: (task: Task) => void;
  onUpdateTask: (task: Task) => void;
  onSaveGoal: (goal: Goal) => void;
  onSaveHabit: (habit: Habit) => void;
  onSaveJournal: (entry: JournalEntry) => void;
  onSaveKnowledge: (item: KnowledgeItem) => void;
  onNavigateTab: (tab: string) => void;
  onUndo: () => void;
  openRouterKey: string;
}

export const HomeView: React.FC<HomeViewProps> = ({
  brainState,
  onSaveTask,
  onUpdateTask,
  onSaveGoal,
  onSaveHabit,
  onSaveJournal,
  onSaveKnowledge,
  onNavigateTab,
  onUndo,
  openRouterKey,
}) => {
  const [inputText, setInputText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastExecution, setLastExecution] = useState<AgentExecutionResult | null>(null);

  // Tools toggle state
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [isToolsDropdownOpen, setIsToolsDropdownOpen] = useState(false);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        180
      )}px`;
    }
  }, [inputText]);

  // Voice capture setup
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript));
        setIsRecording(false);
      };

      recognition.onerror = () => setIsRecording(false);
      recognition.onend = () => setIsRecording(false);

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser environment.");
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
        console.error("Speech recognition error:", err);
      }
    }
  };

  // Main Agent Submission
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const prompt = inputText.trim();
    if (!prompt || isProcessing) return;

    setIsProcessing(true);
    setLastExecution(null);

    try {
      const result = await AutonomousBrainAgent.execute(prompt, brainState, openRouterKey);
      setLastExecution(result);

      if (result.actionType === "create_task" && result.createdTask) {
        onSaveTask(result.createdTask);
        confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
      } else if (result.actionType === "update_task" && result.updatedTask) {
        onUpdateTask(result.updatedTask);
        confetti({ particleCount: 40, spread: 50, origin: { y: 0.6 } });
      } else if (result.actionType === "create_goal" && result.createdGoal) {
        onSaveGoal(result.createdGoal);
        confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
      } else if (result.actionType === "complete_habit" && result.updatedHabit) {
        onSaveHabit(result.updatedHabit);
        confetti({ particleCount: 40, spread: 55, origin: { y: 0.6 } });
      } else if (result.actionType === "log_journal" && result.createdJournal) {
        onSaveJournal(result.createdJournal);
        confetti({ particleCount: 30, spread: 45, origin: { y: 0.6 } });
      } else if (result.actionType === "create_note" && result.createdNote) {
        onSaveKnowledge(result.createdNote);
        confetti({ particleCount: 30, spread: 45, origin: { y: 0.6 } });
      }

      setInputText("");
    } catch (err) {
      console.error("Agent execution error:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Quick Action Card click handlers
  const handleQuickAction = (action: "plan" | "goal" | "task" | "brainstorm") => {
    if (action === "plan") {
      setInputText("Plan my week: analyze my top priorities across academic and career, and break down milestones");
      if (textareaRef.current) textareaRef.current.focus();
    } else if (action === "goal") {
      setInputText("Set a new goal: ");
      if (textareaRef.current) textareaRef.current.focus();
    } else if (action === "task") {
      setInputText("Schedule task: ");
      if (textareaRef.current) textareaRef.current.focus();
    } else if (action === "brainstorm") {
      setInputText("Brainstorm ideas for high-leverage projects and life optimizations");
      if (textareaRef.current) textareaRef.current.focus();
    }
  };

  return (
    <div className="w-full flex flex-col items-center justify-center min-h-[calc(100vh-140px)] max-w-4xl mx-auto px-4 py-8 relative animate-fade-in">
      {/* Celestial Orbital Emblem Graphic */}
      <div className="relative mb-6">
        <div className="relative w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center">
          {/* Ambient Glowing Halo */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-blue-600/20 via-indigo-600/30 to-purple-600/25 blur-2xl pointer-events-none" />

          {/* SVG Orbit Lines & Satellite Nodes */}
          <svg
            viewBox="0 0 160 160"
            className="w-full h-full absolute inset-0 pointer-events-none overflow-visible"
          >
            {/* Ellipse Orbit 1: Tilted 25 deg */}
            <g transform="rotate(25 80 80)">
              <ellipse
                cx="80"
                cy="80"
                rx="68"
                ry="36"
                fill="none"
                stroke="currentColor"
                className="text-indigo-400/40 dark:text-indigo-400/30 stroke-[1.2]"
              />
              {/* Orbiting Satellite Node 1 */}
              <circle
                cx="148"
                cy="80"
                r="2.5"
                className="fill-indigo-400 dark:fill-indigo-300"
              />
            </g>

            {/* Ellipse Orbit 2: Tilted -35 deg */}
            <g transform="rotate(-35 80 80)">
              <ellipse
                cx="80"
                cy="80"
                rx="66"
                ry="34"
                fill="none"
                stroke="currentColor"
                className="text-purple-400/40 dark:text-purple-400/30 stroke-[1.2]"
              />
              {/* Orbiting Satellite Node 2 */}
              <circle
                cx="14"
                cy="80"
                r="2.5"
                className="fill-purple-400 dark:fill-purple-300"
              />
              <circle
                cx="120"
                cy="56"
                r="1.8"
                className="fill-blue-400 dark:fill-blue-300 opacity-80"
              />
            </g>

            {/* Faint Center Ring */}
            <circle
              cx="80"
              cy="80"
              r="48"
              fill="none"
              stroke="currentColor"
              className="text-slate-300/40 dark:text-indigo-500/20 stroke-[0.8]"
              strokeDasharray="2 4"
            />
          </svg>

          {/* Central 4-point Star Emblem */}
          <div className="relative z-10 w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 hover:scale-105 transition-transform">
            <Sparkles className="w-5 h-5 text-white fill-white/80" />
          </div>
        </div>
      </div>

      {/* Main Title & Subtitle matching screenshots */}
      <div className="text-center space-y-2 mb-8">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-slate-900 dark:text-white">
          Where should we{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600 dark:from-indigo-400 dark:to-purple-400">
            start?
          </span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium max-w-md mx-auto">
          Your autonomous second brain. Plan, create, and get things done.
        </p>
      </div>

      {/* Main Central Input Container (Glassmorphic) */}
      <div className="w-full relative mb-6">
        <form
          onSubmit={handleSubmit}
          className="relative w-full rounded-3xl bg-white/95 dark:bg-[#101223]/90 border border-slate-200/90 dark:border-[#25284b] shadow-xl shadow-indigo-500/5 dark:shadow-[0_0_50px_-10px_rgba(79,70,229,0.2)] backdrop-blur-xl transition-all focus-within:border-indigo-400 dark:focus-within:border-indigo-500/70 p-4 sm:p-5 flex flex-col gap-3"
        >
          {/* Main Textarea */}
          <textarea
            ref={textareaRef}
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything, plan something, or tell me what you want to do..."
            className="w-full bg-transparent text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm font-medium resize-none focus:outline-none leading-relaxed"
          />

          {/* Bottom Toolbar inside the box */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800/60">
            {/* Left Tools: + , Web , Tools */}
            <div className="flex items-center gap-2">
              {/* Plus Button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
                  className="w-7 h-7 rounded-xl flex items-center justify-center bg-slate-100 dark:bg-[#171a30] border border-slate-200/80 dark:border-[#2c3057] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#1f2342] transition-colors"
                  title="Add attachment or action"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>

                {isPlusMenuOpen && (
                  <div className="absolute left-0 bottom-full mb-2 w-48 bg-white dark:bg-[#141728] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-1 z-30 flex flex-col gap-0.5 text-xs font-semibold animate-fade-in">
                    <button
                      type="button"
                      onClick={() => {
                        setIsPlusMenuOpen(false);
                        handleQuickAction("task");
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-left"
                    >
                      <CheckSquare className="w-3.5 h-3.5 text-emerald-500" />
                      <span>New Task</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPlusMenuOpen(false);
                        handleQuickAction("goal");
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-left"
                    >
                      <Target className="w-3.5 h-3.5 text-rose-500" />
                      <span>New Goal</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPlusMenuOpen(false);
                        setInputText("note: ");
                        if (textareaRef.current) textareaRef.current.focus();
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-left"
                    >
                      <FileText className="w-3.5 h-3.5 text-blue-500" />
                      <span>New Note</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPlusMenuOpen(false);
                        setInputText("journal: ");
                        if (textareaRef.current) textareaRef.current.focus();
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-left"
                    >
                      <BookOpen className="w-3.5 h-3.5 text-purple-500" />
                      <span>Reflection</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Web Toggle Pill */}
              <button
                type="button"
                onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                  webSearchEnabled
                    ? "bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-700"
                    : "bg-slate-100 dark:bg-[#171a30] text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-[#2c3057] hover:bg-slate-200 dark:hover:bg-[#1f2342]"
                }`}
              >
                <Globe className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500" />
                <span>Web</span>
              </button>

              {/* Tools Dropdown Pill */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsToolsDropdownOpen(!isToolsDropdownOpen)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-[#171a30] text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-[#2c3057] hover:bg-slate-200 dark:hover:bg-[#1f2342] transition-colors"
                >
                  <Sliders className="w-3.5 h-3.5 text-slate-400" />
                  <span>Tools</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {isToolsDropdownOpen && (
                  <div className="absolute left-0 bottom-full mb-2 w-52 bg-white dark:bg-[#141728] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-1.5 z-30 flex flex-col gap-0.5 text-xs font-semibold animate-fade-in">
                    <button
                      type="button"
                      onClick={() => {
                        setIsToolsDropdownOpen(false);
                        onNavigateTab("copilot");
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-left"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                      <span>Copilot Assistant</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsToolsDropdownOpen(false);
                        onNavigateTab("knowledge");
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-left"
                    >
                      <Layers className="w-3.5 h-3.5 text-blue-500" />
                      <span>Memory Vault & Notes</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right Tools: Voice Mic & Submit Arrow */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleRecording}
                className={`p-2 rounded-full transition-colors ${
                  isRecording
                    ? "bg-rose-500 text-white animate-pulse"
                    : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#171a30]"
                }`}
                title={isRecording ? "Listening... click to stop" : "Voice dictation"}
              >
                {isRecording ? (
                  <MicOff className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>

              <button
                type="submit"
                disabled={!inputText.trim() || isProcessing}
                className={`w-9 h-9 rounded-2xl flex items-center justify-center transition-all ${
                  inputText.trim() && !isProcessing
                    ? "bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/30 hover:scale-105 active:scale-95"
                    : "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                }`}
              >
                {isProcessing ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Reactive Agent Action Card */}
      {lastExecution && (
        <div className="w-full mb-6 p-4 rounded-3xl bg-white/90 dark:bg-[#121424] border border-slate-200 dark:border-slate-800 shadow-md animate-fade-in flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                {lastExecution.headline}
              </h4>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {lastExecution.explanation}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (lastExecution.entityType === "task") onNavigateTab("tasks");
                else if (lastExecution.entityType === "goal") onNavigateTab("goals");
                else if (lastExecution.entityType === "habit") onNavigateTab("habits");
                else if (lastExecution.entityType === "journal") onNavigateTab("journal");
                else if (lastExecution.entityType === "knowledge") onNavigateTab("knowledge");
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
            >
              <span>View</span>
              <ArrowRight className="w-3 h-3" />
            </button>
            <button
              onClick={onUndo}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
              title="Undo action"
            >
              <Undo2 className="w-3 h-3" />
              <span>Undo</span>
            </button>
          </div>
        </div>
      )}

      {/* 4 Quick Action Cards Grid matching screenshots */}
      <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Plan my week */}
        <div
          onClick={() => handleQuickAction("plan")}
          className="group flex items-center justify-between p-3.5 rounded-2xl bg-white dark:bg-[#121424] border border-slate-200/80 dark:border-[#232646] hover:border-blue-500/40 hover:shadow-md cursor-pointer transition-all"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-500 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <ClipboardList className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                Plan my week
              </h4>
              <p className="text-[10px] text-slate-400 truncate">
                Break down my tasks and goals
              </p>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500 transition-colors shrink-0 ml-1" />
        </div>

        {/* Card 2: Set a new goal */}
        <div
          onClick={() => handleQuickAction("goal")}
          className="group flex items-center justify-between p-3.5 rounded-2xl bg-white dark:bg-[#171321] border border-slate-200/80 dark:border-[#3b1d28] hover:border-rose-500/40 hover:shadow-md cursor-pointer transition-all"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-500 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-500/20 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Target className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                Set a new goal
              </h4>
              <p className="text-[10px] text-slate-400 truncate">
                Help me define and track it
              </p>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-500 transition-colors shrink-0 ml-1" />
        </div>

        {/* Card 3: Create tasks */}
        <div
          onClick={() => handleQuickAction("task")}
          className="group flex items-center justify-between p-3.5 rounded-2xl bg-white dark:bg-[#111822] border border-slate-200/80 dark:border-[#1b342b] hover:border-emerald-500/40 hover:shadow-md cursor-pointer transition-all"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <CheckSquare className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                Create tasks
              </h4>
              <p className="text-[10px] text-slate-400 truncate">
                Turn this into an actionable plan
              </p>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-500 transition-colors shrink-0 ml-1" />
        </div>

        {/* Card 4: Brainstorm ideas */}
        <div
          onClick={() => handleQuickAction("brainstorm")}
          className="group flex items-center justify-between p-3.5 rounded-2xl bg-white dark:bg-[#161225] border border-slate-200/80 dark:border-[#2e2049] hover:border-purple-500/40 hover:shadow-md cursor-pointer transition-all"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-500 dark:bg-purple-950/40 dark:text-purple-400 border border-purple-500/20 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                Brainstorm ideas
              </h4>
              <p className="text-[10px] text-slate-400 truncate">
                Explore concepts and get suggestions
              </p>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-purple-500 transition-colors shrink-0 ml-1" />
        </div>
      </div>
    </div>
  );
};

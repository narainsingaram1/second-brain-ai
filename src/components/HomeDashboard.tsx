import React, { useState, useEffect } from "react";
import { BrainState, Task } from "../types";
import {
  Sparkles,
  Flame,
  Check,
  Calendar,
  Clock,
  Play,
  Pause,
  RotateCcw,
  Plus,
  ArrowRight,
  Zap,
  BookOpen,
  Brain,
  Send,
  Activity,
  Smile,
  RefreshCw,
} from "lucide-react";
import confetti from "canvas-confetti";
import { queryOpenRouter } from "../services/openrouter";

interface HomeDashboardProps {
  state: BrainState;
  onToggleTask: (taskId: string) => void;
  onToggleHabit: (habitId: string) => void;
  onAddTask: () => void;
  onAddHabit: () => void;
  onOpenJournal: () => void;
  onOpenAICopilot: () => void;
  onOpenSettings: () => void;
  onNavigateTab: (tab: string) => void;
  onEditTask: (task: Task) => void;
  onAIBreakdown: (task: Task) => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  state,
  onToggleTask,
  onToggleHabit,
  onAddTask,
  onAddHabit,
  onOpenJournal,
  onOpenAICopilot,
  onOpenSettings,
  onNavigateTab,
  onEditTask,
  onAIBreakdown,
}) => {
  const todayStr = new Date().toISOString().split("T")[0];

  // Dynamic Greeting based on current hour
  const [greeting, setGreeting] = useState("Good morning");
  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting("Good morning");
    else if (hour < 18) setGreeting("Good afternoon");
    else setGreeting("Good evening");
  }, []);

  // Live Clock
  const [currentTime, setCurrentTime] = useState(
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Interactive Deep Work Sprint Timer (25 minutes Pomodoro / Focus sprint)
  const [sprintSeconds, setSprintSeconds] = useState(25 * 60);
  const [isSprintActive, setIsSprintActive] = useState(false);

  useEffect(() => {
    let interval: any = null;
    if (isSprintActive && sprintSeconds > 0) {
      interval = setInterval(() => {
        setSprintSeconds((prev) => prev - 1);
      }, 1000);
    } else if (sprintSeconds === 0 && isSprintActive) {
      setIsSprintActive(false);
      confetti({
        particleCount: 50,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#3b82f6", "#10b981", "#8b5cf6"],
      });
    }
    return () => clearInterval(interval);
  }, [isSprintActive, sprintSeconds]);

  const toggleSprint = () => setIsSprintActive(!isSprintActive);
  const resetSprint = () => {
    setIsSprintActive(false);
    setSprintSeconds(25 * 60);
  };

  const formatSprintTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
  };

  // Quick Capture bar state
  const [quickCaptureText, setQuickCaptureText] = useState("");

  const handleQuickCaptureSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickCaptureText.trim()) return;

    // Check if it's a question or a task
    if (quickCaptureText.endsWith("?") || quickCaptureText.toLowerCase().startsWith("what") || quickCaptureText.toLowerCase().startsWith("how")) {
      onOpenAICopilot();
      return;
    }

    // Default to quick task creation
    const newTask: Task = {
      id: `task-${Date.now()}`,
      title: quickCaptureText.trim(),
      dueDate: todayStr,
      priority: "high",
      stage: "intake",
      domain: "career",
      completed: false,
    };
    onEditTask(newTask);
    setQuickCaptureText("");
    confetti({
      particleCount: 20,
      spread: 40,
      origin: { y: 0.8 },
      colors: ["#3b82f6", "#10b981"],
    });
  };

  // AI Briefing State
  const [aiBriefing, setAiBriefing] = useState<string>(
    "Your cognitive velocity is high. Priority Focus: Complete the Rust IPC architecture sprint before noon, protect your 18-day habit streak, and maintain an uninterrupted 90-minute deep work block."
  );
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);

  const generateLiveAIBrief = async () => {
    if (!state.openRouterKey) {
      onOpenSettings();
      return;
    }
    setIsGeneratingBrief(true);
    try {
      const urgentTasks = state.tasks.filter((t) => !t.completed && (t.priority === "urgent" || t.priority === "high"));
      const prompt = `Give a crisp 2-sentence executive morning briefing for the user based on these priorities:
- Tasks due today: ${urgentTasks.map((t) => t.title).join(", ") || "General focus blocks"}
- Habits tracked: ${state.habits.map((h) => h.name).join(", ")}
Be strategic, Stoic, motivating, and direct.`;

      const response = await queryOpenRouter(
        [{ role: "user", content: prompt }],
        state.openRouterKey,
        state.selectedModel
      );
      setAiBriefing(response);
    } catch {
      setAiBriefing("AI Brief: Focus on high-leverage execution. Clear your urgent inbox deliverables first, then transition into deep focus.");
    } finally {
      setIsGeneratingBrief(false);
    }
  };

  // Today's metrics calculations
  const todayTasks = state.tasks.filter((t) => t.dueDate === todayStr);
  const completedTodayTasks = todayTasks.filter((t) => t.completed).length;
  const urgentPendingTasks = state.tasks.filter((t) => !t.completed && (t.priority === "urgent" || t.priority === "high"));

  const completedTodayHabits = state.habits.filter((h) => h.history[todayStr]).length;
  const habitPercentage = state.habits.length > 0 ? Math.round((completedTodayHabits / state.habits.length) * 100) : 0;
  const topStreak = Math.max(...state.habits.map((h) => h.streak), 0);

  const todayJournal = state.journalEntries.find((j) => j.date === todayStr);

  return (
    <div className="relative w-full max-w-[1500px] mx-auto space-y-7 pb-12 animate-fade-in">
      {/* ========================================================================= */}
      {/* AMBIENT AURORA GLOWS (Subtle modern accent highlights in background)     */}
      {/* ========================================================================= */}
      <div className="absolute -top-10 -left-10 w-96 h-96 bg-blue-500/10 dark:bg-blue-600/15 rounded-full blur-[100px] pointer-events-none animate-aurora"></div>
      <div className="absolute top-48 right-10 w-[420px] h-[420px] bg-purple-500/10 dark:bg-purple-600/15 rounded-full blur-[120px] pointer-events-none animate-aurora [animation-delay:4s]"></div>
      <div className="absolute top-[600px] left-1/3 w-80 h-80 bg-emerald-500/10 dark:bg-emerald-600/10 rounded-full blur-[100px] pointer-events-none"></div>

      {/* ========================================================================= */}
      {/* HERO SECTION: Dynamic Greeting + Live Sprint Station                      */}
      {/* ========================================================================= */}
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left 8 Cols: Main Welcome Banner & Quick Capture */}
        <div className="lg:col-span-8 bg-white/80 dark:bg-[#141721]/80 backdrop-blur-2xl rounded-4xl p-7 border border-slate-200/80 dark:border-slate-800 shadow-tactile flex flex-col justify-between relative overflow-hidden group">
          {/* Subtle top edge accent glow */}
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 opacity-80"></div>

          <div>
            {/* Live Status Pill Row */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold shadow-xs">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                Neural Engine Synced
              </span>

              <span className="flex items-center gap-1 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-bold">
                <Brain className="w-3.5 h-3.5 text-blue-500" />
                {state.selectedModel.split("/")[1] || state.selectedModel}
              </span>

              <span className="text-[11px] font-bold text-slate-400 ml-auto flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {currentTime}
              </span>
            </div>

            {/* Main Greeting */}
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
              {greeting}, <span className="bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600 bg-clip-text text-transparent">Narain</span>.
            </h1>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">
              You have <span className="text-slate-900 dark:text-white font-bold">{urgentPendingTasks.length} high-leverage tasks</span> pending and your meditation streak is at <span className="text-amber-500 font-bold">{topStreak} days</span>.
            </p>
          </div>

          {/* Glowing Omnibar Quick Capture Input */}
          <form onSubmit={handleQuickCaptureSubmit} className="mt-6">
            <div className="relative flex items-center bg-slate-100/90 dark:bg-[#1a1e2b] rounded-full border border-slate-300/80 dark:border-slate-700/80 p-1.5 shadow-inner focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all duration-300">
              <div className="w-9 h-9 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center text-slate-400 ml-1 shadow-xs">
                <Sparkles className="w-4 h-4 text-purple-500" />
              </div>
              <input
                type="text"
                placeholder="Quick-capture task with due date (e.g. 'Audit rust IPC engine tomorrow') or ask AI..."
                value={quickCaptureText}
                onChange={(e) => setQuickCaptureText(e.target.value)}
                className="w-full bg-transparent text-xs font-semibold px-3 py-2 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none"
              />
              <button
                type="submit"
                className="w-9 h-9 rounded-full bg-[#0d0f14] dark:bg-white text-white dark:text-slate-900 flex items-center justify-center hover:scale-105 active:scale-95 shadow-md transition-all shrink-0 mr-1"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Quick Action Pills underneath */}
            <div className="flex items-center gap-2 mt-3 overflow-x-auto text-[11px] font-semibold text-slate-500">
              <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Fast Track:</span>
              <button
                type="button"
                onClick={onAddTask}
                className="px-2.5 py-1 rounded-full bg-white/70 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center gap-1 shadow-xs"
              >
                <Plus className="w-3 h-3" />
                <span>New Task</span>
              </button>
              <button
                type="button"
                onClick={onAddHabit}
                className="px-2.5 py-1 rounded-full bg-white/70 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:border-amber-400 hover:text-amber-600 transition-colors flex items-center gap-1 shadow-xs"
              >
                <Flame className="w-3 h-3 text-amber-500" />
                <span>New Habit</span>
              </button>
              <button
                type="button"
                onClick={onOpenJournal}
                className="px-2.5 py-1 rounded-full bg-white/70 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:border-purple-400 hover:text-purple-600 transition-colors flex items-center gap-1 shadow-xs"
              >
                <BookOpen className="w-3 h-3 text-purple-500" />
                <span>Daily Reflection</span>
              </button>
              <button
                type="button"
                onClick={onOpenAICopilot}
                className="px-2.5 py-1 rounded-full bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-400/40 text-blue-600 dark:text-blue-400 hover:scale-105 transition-all flex items-center gap-1 shadow-xs ml-auto"
              >
                <Sparkles className="w-3 h-3 text-purple-500" />
                <span>Ask Second Brain</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right 4 Cols: Interactive Deep Work Sprint Station (Hyperfocus Timer) */}
        <div className="lg:col-span-4 bg-[#0d0f14] dark:bg-[#12151f] rounded-4xl p-6 text-white border border-slate-800 shadow-floating flex flex-col justify-between relative overflow-hidden group">
          {/* Subtle Ambient Violet/Cyan Glow inside sprint card */}
          <div className="absolute -top-20 -right-20 w-48 h-48 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none group-hover:bg-indigo-500/30 transition-all duration-500"></div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping"></span>
                Hyperfocus Sprint
              </span>
              <span className="text-[11px] font-mono text-slate-400">Pomodoro 25m</span>
            </div>

            <div className="mt-4">
              <h3 className="text-sm font-bold text-slate-200 line-clamp-1">
                Refactor Rust Core IPC & Local Storage Engine
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Block distractions • 100% flow state
              </p>
            </div>
          </div>

          {/* Big Digital Countdown with Circular Pulse */}
          <div className="my-5 flex items-center justify-between">
            <div className="text-4xl md:text-5xl font-black font-mono tracking-tight text-white flex items-center gap-1">
              <span>{formatSprintTime(sprintSeconds)}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleSprint}
                title={isSprintActive ? "Pause Sprint" : "Start Sprint"}
                className={`w-12 h-12 rounded-full flex items-center justify-center text-slate-950 font-bold transition-all shadow-lg hover:scale-105 active:scale-95 ${
                  isSprintActive
                    ? "bg-amber-400 text-slate-950"
                    : "bg-white text-slate-950 hover:bg-slate-200"
                }`}
              >
                {isSprintActive ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>
              <button
                onClick={resetSprint}
                title="Reset Timer"
                className="w-9 h-9 rounded-full bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Progress Bar with Glowing Accent */}
          <div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 h-full rounded-full transition-all duration-1000 shadow-sm"
                style={{ width: `${((25 * 60 - sprintSeconds) / (25 * 60)) * 100}%` }}
              ></div>
            </div>
            <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1.5 font-mono">
              <span>Sprint #1</span>
              <span>{Math.round(((25 * 60 - sprintSeconds) / (25 * 60)) * 100)}% Complete</span>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4 DYNAMIC BENTO CARDS: Velocity, Habits, AI Briefing, Journal             */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* BENTO 1: Task Execution Radar */}
        <div
          onClick={() => onNavigateTab("tasks")}
          className="bg-white/90 dark:bg-[#141721]/90 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-card transition-all cursor-pointer group hover:-translate-y-0.5 relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-900/50">
              Execution Velocity
            </span>
            <div className="w-7 h-7 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {completedTodayTasks} <span className="text-sm font-semibold text-slate-400">/ {todayTasks.length} Completed</span>
          </div>

          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-3 mb-2">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${todayTasks.length > 0 ? (completedTodayTasks / todayTasks.length) * 100 : 0}%` }}
            ></div>
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 line-clamp-1">
            {urgentPendingTasks.length > 0
              ? `${urgentPendingTasks.length} urgent deliverables remaining`
              : "All priority deliverables clear!"}
          </p>
        </div>

        {/* BENTO 2: Habit Momentum & Streaks */}
        <div
          onClick={() => onNavigateTab("habits")}
          className="bg-white/90 dark:bg-[#141721]/90 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-card transition-all cursor-pointer group hover:-translate-y-0.5 relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-900/50">
              Habit Momentum
            </span>
            <div className="w-7 h-7 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-500 flex items-center justify-center">
              <Flame className="w-3.5 h-3.5 fill-amber-500" />
            </div>
          </div>

          <div className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <span>{topStreak} Days</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
              {habitPercentage}% Today
            </span>
          </div>

          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-3 mb-2">
            <div
              className="bg-amber-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${habitPercentage}%` }}
            ></div>
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 line-clamp-1">
            {completedTodayHabits} of {state.habits.length} daily rituals locked in
          </p>
        </div>

        {/* BENTO 3: Cognitive Readiness & Vault */}
        <div
          onClick={() => onNavigateTab("knowledge")}
          className="bg-white/90 dark:bg-[#141721]/90 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-card transition-all cursor-pointer group hover:-translate-y-0.5 relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 px-2 py-0.5 rounded-full border border-purple-200 dark:border-purple-900/50">
              Cognitive Vault
            </span>
            <div className="w-7 h-7 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <BookOpen className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {state.knowledgeItems.length} <span className="text-sm font-semibold text-slate-400">Mental Models</span>
          </div>

          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-3 mb-2">
            <div className="bg-purple-500 h-full rounded-full w-4/5"></div>
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 line-clamp-1">
            Design sprint & Rust IPC models indexed
          </p>
        </div>

        {/* BENTO 4: Stoic Mindset & Energy */}
        <div
          onClick={onOpenJournal}
          className="bg-white/90 dark:bg-[#141721]/90 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-card transition-all cursor-pointer group hover:-translate-y-0.5 relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-full border border-rose-200 dark:border-rose-900/50">
              Daily Calibration
            </span>
            <div className="w-7 h-7 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center">
              <Smile className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="text-2xl font-black text-slate-900 dark:text-white capitalize">
            {todayJournal ? todayJournal.mood : "Clear & Focused"}
          </div>

          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-3 mb-2">
            <div className="bg-rose-500 h-full rounded-full w-full"></div>
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 line-clamp-1">
            {todayJournal?.title || "Click to record daily debrief & wins"}
          </p>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SPLIT SECTION: Today's Mission Radar + Habits Punch Matrix                */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Cols: Today's Action Radar (Urgent & Priority Tasks) */}
        <div className="lg:col-span-7 bg-white/80 dark:bg-[#141721]/80 backdrop-blur-xl rounded-4xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-tactile flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-500" />
                  Today's Mission Radar
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Prioritized deliverables due for execution today
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={onAddTask}
                  className="tactile-btn flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-950 shadow-sm"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Deliverable</span>
                </button>
              </div>
            </div>

            {/* Task list for today */}
            <div className="space-y-3">
              {todayTasks.slice(0, 5).map((task) => (
                <div
                  key={task.id}
                  onClick={() => onEditTask(task)}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 group ${
                    task.completed
                      ? "bg-slate-50/60 dark:bg-slate-900/30 border-slate-200/60 dark:border-slate-800 opacity-60"
                      : "bg-white dark:bg-[#181d29] border-slate-200/80 dark:border-slate-700/80 shadow-xs hover:border-blue-400 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!task.completed) {
                          confetti({
                            particleCount: 25,
                            spread: 50,
                            origin: { y: 0.7 },
                            colors: ["#3b82f6", "#10b981"],
                          });
                        }
                        onToggleTask(task.id);
                      }}
                      className={`w-5 h-5 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                        task.completed
                          ? "bg-emerald-500 text-white"
                          : "border-2 border-slate-300 dark:border-slate-600 hover:border-emerald-500"
                      }`}
                    >
                      {task.completed && <Check className="w-3 h-3 stroke-[3]" />}
                    </button>

                    <div className="min-w-0">
                      <h4
                        className={`text-xs font-bold truncate leading-tight ${
                          task.completed
                            ? "line-through text-slate-400 dark:text-slate-500"
                            : "text-slate-900 dark:text-slate-100"
                        }`}
                      >
                        {task.title}
                      </h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Calendar className="w-2.5 h-2.5" />
                          {task.dueDate}
                        </span>
                        <span className="text-[10px] text-slate-400 capitalize">• {task.domain}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                        task.priority === "urgent"
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                          : task.priority === "high"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      }`}
                    >
                      {task.priority}
                    </span>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAIBreakdown(task);
                      }}
                      title="AI Subtask Breakdown"
                      className="p-1 rounded-lg text-slate-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-400 text-[11px]">
              Showing top 5 tasks for today
            </span>
            <button
              onClick={() => onNavigateTab("tasks")}
              className="text-blue-600 dark:text-blue-400 font-bold hover:underline flex items-center gap-1 text-[11px]"
            >
              <span>View Full Matrix</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Right 5 Cols: Daily Habits & AI Coaching Debrief */}
        <div className="lg:col-span-5 space-y-6">
          {/* AI Executive Briefing Card */}
          <div className="bg-gradient-to-br from-indigo-900/90 via-slate-900 to-[#121524] text-white rounded-4xl p-6 border border-indigo-800/50 shadow-floating relative overflow-hidden group">
            {/* Ambient Purple Highlight Glow */}
            <div className="absolute top-0 right-0 w-48 h-48 bg-purple-500/20 rounded-full blur-3xl pointer-events-none"></div>

            <div className="flex items-center justify-between mb-3 relative z-10">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-purple-300 bg-purple-500/20 px-2.5 py-0.5 rounded-full border border-purple-500/30 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-purple-300" />
                AI Daily Battle Plan
              </span>
              <button
                onClick={generateLiveAIBrief}
                disabled={isGeneratingBrief}
                title="Regenerate brief with OpenRouter"
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingBrief ? "animate-spin text-purple-400" : ""}`} />
              </button>
            </div>

            <p className="text-xs text-slate-200 leading-relaxed font-medium relative z-10">
              "{aiBriefing}"
            </p>

            <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between relative z-10">
              <span className="text-[10px] text-slate-400 font-mono">
                Model: {state.selectedModel.split("/")[1] || "Claude 3.5 Sonnet"}
              </span>
              <button
                onClick={onOpenAICopilot}
                className="text-xs font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <span>Ask AI Assistant</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Daily Habit Punch Matrix (Quick Checkoff) */}
          <div className="bg-white/80 dark:bg-[#141721]/80 backdrop-blur-xl rounded-4xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-tactile">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Flame className="w-4 h-4 text-amber-500 fill-amber-500" />
                  Daily Habit Checklist
                </h3>
                <p className="text-[11px] text-slate-400">
                  {completedTodayHabits} of {state.habits.length} checked today
                </p>
              </div>
              <button
                onClick={onAddHabit}
                className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-2.5">
              {state.habits.slice(0, 4).map((habit) => {
                const isDone = !!habit.history[todayStr];
                return (
                  <div
                    key={habit.id}
                    onClick={() => {
                      if (!isDone) {
                        confetti({
                          particleCount: 20,
                          spread: 40,
                          origin: { y: 0.7 },
                          colors: ["#10b981", "#f59e0b"],
                        });
                      }
                      onToggleHabit(habit.id);
                    }}
                    className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                      isDone
                        ? "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40 text-emerald-900 dark:text-emerald-300"
                        : "bg-white dark:bg-[#181d29] border-slate-200/80 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                          isDone
                            ? "bg-emerald-500 text-white"
                            : "border-2 border-slate-300 dark:border-slate-600"
                        }`}
                      >
                        {isDone && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                      <span className={`text-xs font-bold truncate ${isDone ? "line-through opacity-75" : ""}`}>
                        {habit.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-[10px] font-bold text-amber-500 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-200/60 dark:border-amber-800/50 shrink-0">
                      <Flame className="w-2.5 h-2.5 fill-amber-500" />
                      <span>{habit.streak}d</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Streak momentum active</span>
              <button
                onClick={() => onNavigateTab("habits")}
                className="text-blue-600 dark:text-blue-400 font-bold hover:underline"
              >
                View 7-Day Punch Grid &rarr;
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

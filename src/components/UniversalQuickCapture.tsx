import React, { useState, useEffect, useRef } from "react";
import { Task, JournalEntry, KnowledgeItem, Habit, BrainState } from "../types";
import { vectorVault } from "../services/vectorVault";
import { autoClassifyWithAI } from "../services/openrouter";
import { getLocalDateString } from "../utils/habitStreaks";
import {
  Sparkles,
  Mic,
  MicOff,
  CheckCircle2,
  BookOpen,
  FileText,
  Flame,
  ArrowRight,
  X,
  Calendar,
  Zap,
} from "lucide-react";

interface UniversalQuickCaptureProps {
  isOpen: boolean;
  onClose: () => void;
  brainState: BrainState;
  onAddTask: (task: Task) => void;
  onAddJournal: (entry: JournalEntry) => void;
  onAddKnowledge: (item: KnowledgeItem) => void;
  onAddHabit: (habit: Habit) => void;
  openRouterKey: string;
}

type ClassifiedType = "task" | "knowledge" | "journal" | "habit";

export const UniversalQuickCapture: React.FC<UniversalQuickCaptureProps> = ({
  isOpen,
  onClose,
  brainState,
  onAddTask,
  onAddJournal,
  onAddKnowledge,
  onAddHabit,
  openRouterKey,
}) => {
  const [input, setInput] = useState("");
  const [activeType, setActiveType] = useState<ClassifiedType>("task");
  const [isManualOverride, setIsManualOverride] = useState(false);
  const [confidence, setConfidence] = useState<number>(85);

  // Field attributes for fast tuning
  const [priority, setPriority] = useState<"urgent" | "high" | "medium" | "low">("medium");
  const [dueDate, setDueDate] = useState<string>("");
  const [section, setSection] = useState<string>("Academic");
  const [mood, setMood] = useState<"ecstatic" | "great" | "neutral" | "tired" | "stressed">("great");
  const [frequency, setFrequency] = useState<"daily" | "weekdays" | "weekends">("daily");

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  // AI Classification loading state
  const [isAiClassifying, setIsAiClassifying] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      setSection(brainState.sections[0] || "Academic");
    } else {
      // Reset state
      setInput("");
      setIsManualOverride(false);
      setDueDate("");
      setPriority("medium");
      if (isRecording) {
        stopVoiceRecognition();
      }
    }
  }, [isOpen, brainState.sections]);

  // Real-time heuristic classifier
  useEffect(() => {
    if (!input.trim() || isManualOverride) return;

    const lower = input.toLowerCase();
    const hasUrl = /https?:\/\//i.test(input);
    const hasHabitWords = /\b(daily|every day|streak|habit|routine|drink water|workout daily|meditate daily|pages a day)\b/i.test(lower);
    const hasJournalWords = /\b(felt|feeling|today was|grateful|mood|tired|stressed|proud|wins|reflection|anxious|overwhelmed)\b/i.test(lower);
    const hasTaskWords = /\b(todo|finish|submit|due|call|email|send|buy|review|prepare|schedule|assignment|lab|homework|asap|urgent)\b/i.test(lower);

    let detected: ClassifiedType = "task";
    let conf = 75;

    if (hasUrl) {
      detected = "knowledge";
      conf = 95;
    } else if (hasHabitWords) {
      detected = "habit";
      conf = 90;
    } else if (hasJournalWords) {
      detected = "journal";
      conf = 88;
    } else if (hasTaskWords) {
      detected = "task";
      conf = 92;
    }

    setActiveType(detected);
    setConfidence(conf);

    // Auto-extract date hints
    const today = new Date();
    if (/\btomorrow\b/i.test(lower)) {
      const tom = new Date(today);
      tom.setDate(tom.getDate() + 1);
      setDueDate(getLocalDateString(tom));
    } else if (/\btoday\b/i.test(lower) || /\btonight\b/i.test(lower)) {
      setDueDate(getLocalDateString(today));
    } else if (/\bfriday\b/i.test(lower)) {
      const d = new Date(today);
      const day = d.getDay();
      const diff = (5 - day + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      setDueDate(getLocalDateString(d));
    }

    // Auto-extract priority hints
    if (/\b(urgent|asap|critical|emergency)\b/i.test(lower)) {
      setPriority("urgent");
    } else if (/\b(high priority|important)\b/i.test(lower)) {
      setPriority("high");
    }
  }, [input, isManualOverride]);

  // Setup Web Speech Recognition
  const startVoiceRecognition = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser/environment.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsRecording(true);
      };

      recognition.onresult = (event: any) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) {
          setInput((prev) => (prev ? `${prev} ${transcript.trim()}` : transcript.trim()));
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (e) {
      console.error("Failed to start voice recognition:", e);
      setIsRecording(false);
    }
  };

  const stopVoiceRecognition = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
  };

  const toggleVoice = () => {
    if (isRecording) {
      stopVoiceRecognition();
    } else {
      startVoiceRecognition();
    }
  };

  // Optional AI Auto-Refine
  const handleAiRefine = async () => {
    if (!input.trim()) return;
    if (!openRouterKey) {
      alert("Please add an OpenRouter API key in Settings to use Neural Auto-Classification.");
      return;
    }

    setIsAiClassifying(true);
    try {
      const result = await autoClassifyWithAI(input, openRouterKey);
      if (result) {
        setActiveType(result.type);
        setIsManualOverride(true);
        if (result.priority) setPriority(result.priority);
        if (result.dueDate) setDueDate(result.dueDate);
        if (result.section) setSection(result.section);
        if (result.mood) setMood(result.mood);
        if (result.frequency) setFrequency(result.frequency);
        if (result.title) setInput(result.title);
      }
    } catch (err) {
      console.error("AI refine error:", err);
    } finally {
      setIsAiClassifying(false);
    }
  };

  // Instant Save Handler
  const handleSave = async () => {
    if (!input.trim()) return;

    const rawText = input.trim();
    const todayStr = getLocalDateString(new Date());

    if (activeType === "task") {
      const newTask: Task = {
        id: `task-${Date.now()}`,
        title: rawText,
        dueDate: dueDate || todayStr,
        priority: priority,
        section: section || brainState.sections[0] || "Academic",
        completed: false,
        status: "not_started",
        tags: ["quick-capture"],
      };
      onAddTask(newTask);
      // Index immediately into Semantic Memory Vault
      vectorVault.indexItem(newTask, "task", openRouterKey).catch(() => {});
      setToastMessage(`Captured Task: "${rawText.slice(0, 30)}..."`);
    } else if (activeType === "journal") {
      const newEntry: JournalEntry = {
        id: `journal-${Date.now()}`,
        date: dueDate || todayStr,
        title: rawText.slice(0, 45) + (rawText.length > 45 ? "..." : ""),
        content: rawText,
        mood: mood,
        wins: [],
        challenges: [],
        tags: ["quick-capture"],
      };
      onAddJournal(newEntry);
      vectorVault.indexItem(newEntry, "journal", openRouterKey).catch(() => {});
      setToastMessage(`Captured Journal Reflection`);
    } else if (activeType === "knowledge") {
      const isUrl = /https?:\/\//i.test(rawText);
      const newKnowledge: KnowledgeItem = {
        id: `know-${Date.now()}`,
        subject: isUrl ? rawText.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : rawText.slice(0, 50),
        status: "Draft",
        startDate: todayStr,
        endDate: todayStr,
        domain: section,
        summary: rawText,
      };
      onAddKnowledge(newKnowledge);
      vectorVault.indexItem(newKnowledge, "knowledge", openRouterKey).catch(() => {});
      setToastMessage(`Captured Knowledge Note`);
    } else if (activeType === "habit") {
      const newHabit: Habit = {
        id: `habit-${Date.now()}`,
        name: rawText.slice(0, 50),
        frequency: frequency,
        streak: 0,
        bestStreak: 0,
        history: {},
        domain: "mindset",
        timeOfDay: "morning",
      };
      onAddHabit(newHabit);
      vectorVault.indexItem(newHabit, "habit", openRouterKey).catch(() => {});
      setToastMessage(`Captured Habit: "${rawText.slice(0, 30)}"`);
    }

    setTimeout(() => {
      setToastMessage(null);
      onClose();
    }, 600);
  };

  // Keyboard navigation inside modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md animate-fade-in">
      {/* Floating HUD Card */}
      <div
        onKeyDown={handleKeyDown}
        className="bg-white/95 dark:bg-[#12151e]/95 backdrop-blur-2xl rounded-3xl border border-slate-200/80 dark:border-slate-800/80 shadow-2xl w-full max-w-xl overflow-hidden flex flex-col transition-all duration-200 ring-1 ring-slate-900/5 dark:ring-white/10"
      >
        {/* Top Header Row with Classification Badges */}
        <div className="px-5 pt-4 pb-2 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/60">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-amber-500/10 dark:bg-amber-400/10 text-amber-500 flex items-center justify-center">
              <Zap className="w-4 h-4 fill-amber-500" />
            </div>
            <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
              [quick capture]
            </span>
            <span className="text-[10px] text-slate-400 font-mono px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800">
              ⌘⌥N
            </span>
          </div>

          {/* Type Selector Pills */}
          <div className="flex items-center gap-1 bg-slate-100/80 dark:bg-slate-800/80 p-0.5 rounded-full border border-slate-200/50 dark:border-slate-700/50">
            {[
              { id: "task", label: "Task", icon: CheckCircle2 },
              { id: "knowledge", label: "Note", icon: FileText },
              { id: "journal", label: "Journal", icon: BookOpen },
              { id: "habit", label: "Habit", icon: Flame },
            ].map((t) => {
              const Icon = t.icon;
              const isSelected = activeType === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveType(t.id as ClassifiedType);
                    setIsManualOverride(true);
                  }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                    isSelected
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-xs"
                      : "text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Input Area */}
        <div className="p-5 space-y-3">
          <div className="relative">
            <textarea
              ref={inputRef}
              rows={3}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Capture anything... 'CS 1332 lab due Friday', 'Felt energized after morning run', 'Read article on transformers', or drop a URL"
              className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none resize-none leading-relaxed"
            />

            {/* Voice Wave Animation if Recording */}
            {isRecording && (
              <div className="flex items-center gap-1.5 py-1 text-xs text-red-500 font-semibold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                <span>Listening... speak your thought clearly</span>
              </div>
            )}
          </div>

          {/* Auto-detected confidence badge & AI Refine button */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-slate-400">Classified as:</span>
              <span className="font-extrabold capitalize text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                {activeType}
                {!isManualOverride && (
                  <span className="text-[10px] font-mono text-slate-400 font-normal">
                    ({confidence}% match)
                  </span>
                )}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Voice Input Button */}
              <button
                onClick={toggleVoice}
                title={isRecording ? "Stop voice recording" : "Record voice input"}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all ${
                  isRecording
                    ? "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300 ring-1 ring-red-400"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                }`}
              >
                {isRecording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                <span>{isRecording ? "Listening" : "Voice"}</span>
              </button>

              {/* AI Refine Button */}
              {openRouterKey && (
                <button
                  onClick={handleAiRefine}
                  disabled={isAiClassifying || !input.trim()}
                  title="Refine classification with OpenRouter LLM"
                  className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-all disabled:opacity-50"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isAiClassifying ? "animate-spin" : ""}`} />
                  <span>{isAiClassifying ? "Analyzing..." : "AI Auto-Fill"}</span>
                </button>
              )}
            </div>
          </div>

          {/* Contextual Quick Attributes Bar */}
          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800/60 flex flex-wrap items-center gap-2.5 text-xs">
            {activeType === "task" && (
              <>
                {/* Priority Selector */}
                <div className="flex items-center gap-1">
                  {(["urgent", "high", "medium", "low"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPriority(p)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold capitalize transition-all ${
                        priority === p
                          ? p === "urgent"
                            ? "bg-red-600 text-white"
                            : p === "high"
                            ? "bg-amber-600 text-white"
                            : "bg-slate-800 text-white dark:bg-white dark:text-slate-900"
                          : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>

                {/* Due Date Shortcut */}
                <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200 dark:border-slate-700">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="bg-transparent text-[11px] font-semibold text-slate-700 dark:text-slate-300 focus:outline-none"
                  />
                </div>

                {/* Section Selector */}
                <select
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  className="ml-auto bg-transparent text-[11px] font-bold text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                >
                  {brainState.sections.map((s) => (
                    <option key={s} value={s} className="dark:bg-slate-900">
                      {s}
                    </option>
                  ))}
                </select>
              </>
            )}

            {activeType === "journal" && (
              <div className="flex items-center gap-2 w-full justify-between">
                <span className="text-[11px] font-bold text-slate-400">Mood:</span>
                <div className="flex items-center gap-1">
                  {[
                    { id: "ecstatic", label: "🤩 Ecstatic" },
                    { id: "great", label: "😄 Great" },
                    { id: "neutral", label: "😐 Neutral" },
                    { id: "tired", label: "😴 Tired" },
                    { id: "stressed", label: "😰 Stressed" },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMood(m.id as any)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
                        mood === m.id
                          ? "bg-purple-600 text-white shadow-2xs"
                          : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeType === "habit" && (
              <div className="flex items-center gap-2 w-full justify-between">
                <span className="text-[11px] font-bold text-slate-400">Frequency:</span>
                <div className="flex items-center gap-1">
                  {[
                    { id: "daily", label: "Every Day" },
                    { id: "weekdays", label: "Weekdays" },
                    { id: "weekends", label: "Weekends" },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setFrequency(f.id as any)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
                        frequency === f.id
                          ? "bg-amber-600 text-white shadow-2xs"
                          : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeType === "knowledge" && (
              <div className="flex items-center gap-2 w-full justify-between">
                <span className="text-[11px] font-bold text-slate-400">Domain / Category:</span>
                <select
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  className="bg-transparent text-[11px] font-bold text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                >
                  <option value="Academic" className="dark:bg-slate-900">Academic / CS</option>
                  <option value="Career" className="dark:bg-slate-900">Career & Projects</option>
                  <option value="AI" className="dark:bg-slate-900">AI & Engineering</option>
                  <option value="Health" className="dark:bg-slate-900">Health & Wellness</option>
                  <option value="Mindset" className="dark:bg-slate-900">Mindset & Philosophy</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-50/70 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
            <span>
              <kbd className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 rounded text-[10px] font-bold">
                ⌘↵
              </kbd>{" "}
              Save
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 rounded text-[10px] font-bold">
                esc
              </kbd>{" "}
              Close
            </span>
          </div>

          <div className="flex items-center gap-2">
            {toastMessage && (
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 animate-fade-in flex items-center gap-1 mr-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {toastMessage}
              </span>
            )}

            <button
              onClick={handleSave}
              disabled={!input.trim()}
              className="flex items-center gap-1.5 px-5 py-2 rounded-2xl bg-slate-950 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-950 text-xs font-bold shadow-md hover:scale-102 active:scale-98 transition-all disabled:opacity-40"
            >
              <span>Capture</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

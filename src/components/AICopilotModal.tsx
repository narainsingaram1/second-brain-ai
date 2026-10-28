import React, { useState, useRef, useEffect } from "react";
import { BrainState, Task, Habit, JournalEntry, AIMessage, Goal, KnowledgeItem } from "../types";
import { RunConversation } from "../services/agentDispatcher";
import { SourceReferences } from "./SourceReferences";
import { MarkdownView } from "./MarkdownView";

import {
  Sparkles,
  Send,
  X,
  Bot,
  Target,
  Flame,
  BookOpen,
  Settings,
  Database,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface AICopilotModalProps {
  conversation: { run: RunConversation; busy: boolean; progress: string; stop: () => void };
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  habits: Habit[];
  journalEntries: JournalEntry[];
  chatHistory: AIMessage[];
  onUpdateChatHistory: (messages: AIMessage[]) => void;
  openRouterKey: string;
  selectedModel: string;
  onOpenSettings: () => void;
  onOpenVault?: () => void;
  brainState?: BrainState | null;
  onSaveTask?: (task: Task) => void;
  onUpdateTask?: (task: Task) => void;
  onSaveGoal?: (goal: Goal) => void;
  onSaveHabit?: (habit: Habit) => void;
  onSaveJournal?: (entry: JournalEntry) => void;
  onSaveKnowledge?: (item: KnowledgeItem) => void;
  onNavigateTab?: (tab: string) => void;
  onUndo?: () => void;
}

export const AICopilotModal: React.FC<AICopilotModalProps> = ({
  conversation,
  isOpen,
  onClose,
  chatHistory,
  openRouterKey,
  selectedModel,
  brainState,
  onOpenSettings,
  onOpenVault,
  onNavigateTab,
  onUndo,
}) => {
  const [input, setInput] = useState("");
  const isLoading = conversation.busy;
  const [error, setError] = useState("");
  const retrievedMemories = chatHistory.flatMap(m => m.sources || []).filter((s, i, all) => all.findIndex(x => x.id === s.id && x.type === s.type) === i).map(s => ({ chunk: { item_type: s.type, title: s.title, content: s.id }, score: 0 }));
  const [isMemoriesExpanded, setIsMemoriesExpanded] = useState(false);
  const [lastActionResult, setLastActionResult] = useState<{
    actionType: string;
    entityType?: string;
    headline: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [isOpen, chatHistory, isLoading]);

  if (!isOpen) return null;

  const quickPrompts = [
    { label: "Recall Past Decisions (RAG)", icon: Database, prompt: "What did I decide or reflect on regarding my recent projects and goals last month?" },
    { label: "Prioritize Today's Due Dates", icon: Target, prompt: "Review all my pending tasks and prioritize the top 3 high-leverage tasks for today with estimated completion blocks." },
    { label: "Analyze Habit Consistency", icon: Flame, prompt: "Audit my daily habit streaks and give me personalized advice on maintaining momentum and avoiding burnout." },
    { label: "Strategic Day Review", icon: BookOpen, prompt: "Review my recent journal reflections and completed tasks. What behavioral patterns should I be mindful of tomorrow?" },
  ];

  const handleSend = async (customPrompt?: string) => {
    const textToSend = customPrompt || input;
    if (!textToSend.trim()) return;

    if (!openRouterKey) {
      onOpenSettings();
      return;
    }

    if (isLoading) return;
    setInput("");
    setError("");
    try {
      const result = await conversation.run(textToSend.trim());
      setLastActionResult(result.actions.length ? { actionType: result.actionType, entityType: "compound", headline: result.explanation } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request failed.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-[#141721] rounded-4xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-2xl h-[650px] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-md">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
                  Synapse Neural Copilot
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                  {selectedModel.split("/")[1] || selectedModel}
                </span>
              </div>
              <p className="text-xs text-slate-400">Context aware: Tasks, Due Dates, Habits & Reflections</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenVault && (
              <button
                onClick={onOpenVault}
                title="Semantic Memory Vault (Vector Store)"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 text-xs font-bold hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
              >
                <Database className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Memory Vault</span>
              </button>
            )}
            <button
              onClick={onOpenSettings}
              title="Change OpenRouter Model or Key"
              className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Retrieved Memories RAG Bar */}
        {retrievedMemories.length > 0 && (
          <div className="bg-indigo-50/80 dark:bg-indigo-950/30 border-b border-indigo-100 dark:border-indigo-900/40 px-6 py-2 text-xs">
            <button
              onClick={() => setIsMemoriesExpanded(!isMemoriesExpanded)}
              className="w-full flex items-center justify-between text-indigo-700 dark:text-indigo-300 font-bold"
            >
              <span className="flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-indigo-500" />
                <span>🧠 {retrievedMemories.length} source references in this conversation</span>
              </span>
              {isMemoriesExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {isMemoriesExpanded && (
              <div className="mt-2 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {retrievedMemories.map((m, i) => (
                  <div
                    key={i}
                    className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-900/50 text-[11px]"
                  >
                    <div className="flex items-center justify-between font-bold text-slate-800 dark:text-slate-200">
                      <span className="capitalize text-indigo-600 dark:text-indigo-400">
                        [{m.chunk.item_type}] {m.chunk.title}
                      </span>
                      <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                        {m.chunk.item_type} match
                      </span>
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 text-[10px] truncate mt-0.5">
                      {m.chunk.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Chat message stream */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {chatHistory.map((msg) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 text-white dark:text-slate-900 flex items-center justify-center shrink-0 text-xs shadow-sm">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-3xl p-4 text-xs leading-relaxed ${
                    isUser
                      ? "bg-[#0d0f14] text-white dark:bg-white dark:text-slate-950 rounded-br-sm shadow-sm"
                      : "bg-slate-100 dark:bg-[#121424] text-slate-800 dark:text-slate-200 rounded-bl-sm border border-slate-200/60 dark:border-slate-800/80 font-medium"
                  }`}
                >
                  {isUser ? (
                    <div className="whitespace-pre-line">{msg.content}</div>
                  ) : (
                    <>
                      <MarkdownView content={msg.content} />
                      {lastActionResult && onNavigateTab && (
                        <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-slate-200/60 dark:border-slate-800">
                          <button
                            onClick={() => {
                              if (lastActionResult.entityType === "task") onNavigateTab("tasks");
                              else if (lastActionResult.entityType === "goal") onNavigateTab("goals");
                              else if (lastActionResult.entityType === "habit") onNavigateTab("habits");
                              else if (lastActionResult.entityType === "journal") onNavigateTab("journal");
                              else if (lastActionResult.entityType === "knowledge") onNavigateTab("knowledge");
                            }}
                            className="px-2.5 py-1 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-bold text-[10px] transition-colors"
                          >
                            View in {lastActionResult.entityType?.toUpperCase() || "APP"} →
                          </button>
                          {onUndo && (
                            <button
                              onClick={onUndo}
                              className="px-2 py-1 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-[10px] transition-colors"
                            >
                              Undo ⌘Z
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {!isUser && <SourceReferences sources={msg.sources} state={brainState} />}
                  <span
                    className={`block text-[9px] mt-2 opacity-60 text-right ${
                      isUser ? "text-slate-300 dark:text-slate-600" : "text-slate-400"
                    }`}
                  >
                    {msg.timestamp}
                  </span>
                </div>

                {isUser && (
                  <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 text-xs shadow-sm font-bold">
                    NS
                  </div>
                )}
              </div>
            );
          })}

          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {isLoading && <div role="status" className="text-sm text-indigo-600">{conversation.progress} <button type="button" onClick={conversation.stop} className="underline ml-2">Stop</button></div>}
          {isLoading && (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 animate-spin" />
              </div>
              <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded-2xl flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce"></span>
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce [animation-delay:0.4s]"></span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Prompts Bar */}
        <div className="px-6 py-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center gap-2 overflow-x-auto bg-slate-50/30 dark:bg-slate-900/20">
          {quickPrompts.map((qp, idx) => {
            const Icon = qp.icon;
            return (
              <button
                key={idx}
                onClick={() => handleSend(qp.prompt)}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:border-blue-400 whitespace-nowrap shadow-xs transition-colors shrink-0"
              >
                <Icon className="w-3 h-3 text-blue-500" />
                <span>{qp.label}</span>
              </button>
            );
          })}
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-[#141721] flex items-center gap-2">
          <input
            type="text"
            placeholder={
              openRouterKey
                ? "Ask your second brain anything..."
                : "Add your OpenRouter API key to activate AI..."
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            disabled={isLoading}
            className="flex-1 bg-slate-100 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 px-4 py-3 rounded-full border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
          />
          <button
            onClick={() => handleSend()}
            disabled={isLoading || !input.trim()}
            className="w-10 h-10 rounded-full bg-[#0d0f14] dark:bg-white text-white dark:text-slate-900 flex items-center justify-center hover:scale-105 active:scale-95 disabled:opacity-40 transition-all shadow-md shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

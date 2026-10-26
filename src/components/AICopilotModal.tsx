import React, { useState, useRef, useEffect } from "react";
import { Task, Habit, JournalEntry, AIMessage } from "../types";
import { chatWithSecondBrain } from "../services/openrouter";
import {
  Sparkles,
  Send,
  X,
  Bot,
  Target,
  Flame,
  BookOpen,
  Settings,
} from "lucide-react";

interface AICopilotModalProps {
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
}

export const AICopilotModal: React.FC<AICopilotModalProps> = ({
  isOpen,
  onClose,
  tasks,
  habits,
  journalEntries,
  chatHistory,
  onUpdateChatHistory,
  openRouterKey,
  selectedModel,
  onOpenSettings,
}) => {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
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

    const userMessage: AIMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: textToSend.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const newHistory = [...chatHistory, userMessage];
    onUpdateChatHistory(newHistory);
    setInput("");
    setIsLoading(true);

    try {
      const historyForApi = newHistory.map((m) => ({ role: m.role, content: m.content }));
      const responseText = await chatWithSecondBrain(
        textToSend,
        tasks,
        habits,
        journalEntries,
        openRouterKey,
        selectedModel,
        historyForApi
      );

      const assistantMessage: AIMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: responseText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      onUpdateChatHistory([...newHistory, assistantMessage]);
    } catch (err: any) {
      const errorMessage: AIMessage = {
        id: `msg-err-${Date.now()}`,
        role: "assistant",
        content: `**OpenRouter Error**: ${err.message || "Failed to contact AI service"}. Please verify your API key in Settings.`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      onUpdateChatHistory([...newHistory, errorMessage]);
    } finally {
      setIsLoading(false);
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
                  className={`max-w-[80%] rounded-3xl p-4 text-xs leading-relaxed ${
                    isUser
                      ? "bg-[#0d0f14] text-white dark:bg-white dark:text-slate-950 rounded-br-sm shadow-sm"
                      : "bg-slate-100 dark:bg-slate-800/80 text-slate-800 dark:text-slate-200 rounded-bl-sm border border-slate-200/60 dark:border-slate-700/60 font-medium"
                  }`}
                >
                  <div className="whitespace-pre-line">{msg.content}</div>
                  <span
                    className={`block text-[9px] mt-1.5 opacity-60 text-right ${
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

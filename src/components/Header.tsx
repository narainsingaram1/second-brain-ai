import React, { useState } from "react";
import {
  Search,
  Sparkles,
  Settings,
  Key,
  Moon,
  Sun,
  Menu,
} from "lucide-react";

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  openRouterKey: string;
  onOpenSettings: () => void;
  onOpenAIChat: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  openRouterKey,
  onOpenSettings,
  onOpenAIChat,
  theme,
  onToggleTheme,
  searchQuery,
  setSearchQuery,
}) => {
  const [isSearching, setIsSearching] = useState(false);

  const navItems = [
    { id: "tasks", label: "Tasks" },
    { id: "habits", label: "Habits" },
    { id: "journal", label: "Journal" },
    { id: "knowledge", label: "Notes" },
    { id: "copilot", label: "Copilot" },
  ];

  return (
    <header className="w-full flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-800/80 bg-white/80 dark:bg-[#0e1015]/80 backdrop-blur-md sticky top-0 z-40">
      {/* Left: Minimalist Brand like [untitled] in attachment */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setActiveTab("tasks")}
          className="w-9 h-9 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors"
        >
          <Menu className="w-4 h-4" />
        </button>

        <button
          onClick={() => setActiveTab("tasks")}
          className="font-mono text-base font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-1 hover:opacity-80 transition-opacity"
        >
          <span>[synapse]</span>
        </button>
      </div>

      {/* Center: Clean Minimal Navigation Pills */}
      <nav className="flex items-center bg-slate-100/80 dark:bg-slate-800/60 p-1 rounded-full border border-slate-200/50 dark:border-slate-700/50">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                isActive
                  ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950 shadow-xs"
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Right: Rounded Square Buttons matching the attachment */}
      <div className="flex items-center gap-2">
        {/* Quick Search */}
        <div
          className={`relative flex items-center bg-slate-100 dark:bg-slate-800/70 rounded-2xl px-3 py-1.5 transition-all ${
            isSearching ? "w-64 ring-2 ring-slate-900/10 dark:ring-white/10" : "w-36 sm:w-44"
          }`}
        >
          <Search className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearching(true)}
            onBlur={() => setIsSearching(false)}
            placeholder="Search..."
            className="w-full bg-transparent text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none font-medium"
          />
          <span className="text-[10px] text-slate-400 hidden sm:inline ml-1 font-mono">⌘K</span>
        </div>

        {/* AI Copilot shortcut button */}
        <button
          onClick={onOpenAIChat}
          title="Ask AI Second Brain"
          className="w-9 h-9 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors"
        >
          <Sparkles className="w-4 h-4 text-purple-500" />
        </button>

        {/* OpenRouter Key status */}
        <button
          onClick={onOpenSettings}
          title={openRouterKey ? "OpenRouter Connected" : "Add OpenRouter API Key"}
          className={`w-9 h-9 rounded-2xl flex items-center justify-center transition-colors ${
            openRouterKey
              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
              : "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 animate-pulse"
          }`}
        >
          <Key className="w-4 h-4" />
        </button>

        {/* Dark/Light mode toggle */}
        <button
          onClick={onToggleTheme}
          title={theme === "dark" ? "Light Mode" : "Dark Mode"}
          className="w-9 h-9 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors"
        >
          {theme === "dark" ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          title="Settings"
          className="w-9 h-9 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};

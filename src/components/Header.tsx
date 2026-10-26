import React, { useState } from "react";
import {
  Search,
  Sparkles,
  Bell,
  Settings,
  Key,
  ShieldCheck,
  Command,
} from "lucide-react";

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  openRouterKey: string;
  onOpenSettings: () => void;
  onOpenAIChat: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  openRouterKey,
  onOpenSettings,
  onOpenAIChat,
  searchQuery,
  setSearchQuery,
}) => {
  const [isSearching, setIsSearching] = useState(false);

  const navItems = [
    { id: "journeys", label: "Journeys & Flow" },
    { id: "tasks", label: "Task Matrix" },
    { id: "habits", label: "Daily Habits" },
    { id: "journal", label: "Reflections" },
    { id: "knowledge", label: "Suggested Knowledge" },
    { id: "copilot", label: "AI Copilot" },
  ];

  return (
    <header className="w-full flex items-center justify-between px-6 py-3.5 border-b border-slate-200/80 dark:border-slate-800 bg-[#edf0f5]/90 dark:bg-[#0b0d13]/90 backdrop-blur-md sticky top-0 z-40">
      {/* Brand Logo - Styled precisely like the screenshot's top-left */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 cursor-pointer group" onClick={() => setActiveTab("journeys")}>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
            {/* Hexagon/stacked cube node icon */}
            <div className="flex flex-col items-center gap-0.5">
              <div className="w-3.5 h-1 bg-white dark:bg-slate-900 rounded-sm"></div>
              <div className="w-3.5 h-1 bg-blue-400 rounded-sm"></div>
              <div className="w-3.5 h-1 bg-rose-400 rounded-sm"></div>
            </div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-extrabold text-lg tracking-tight text-slate-900 dark:text-white">synapse</span>
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">AI 2.0</span>
          </div>
        </div>
      </div>

      {/* Center Navigation Pills - Matching the reference image pill design */}
      <nav className="flex items-center bg-slate-200/60 dark:bg-slate-900/60 p-1 rounded-full border border-slate-300/40 dark:border-slate-800 shadow-inner">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                isActive
                  ? "bg-[#0d0f14] dark:bg-white text-white dark:text-slate-950 shadow-md scale-[1.02]"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-300/50 dark:hover:bg-slate-800/50"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Right Controls - URL/Search Bar & Action Icons matching the design */}
      <div className="flex items-center gap-3">
        {/* Browser URL / Omnibar pill */}
        <div className={`relative flex items-center bg-white dark:bg-[#141721] rounded-full border px-3.5 py-1.5 shadow-sm transition-all duration-300 group ${
          isSearching ? "w-80 border-blue-500 ring-2 ring-blue-500/20" : "w-64 border-slate-300/70 dark:border-slate-800 hover:w-72"
        }`}>
          <div className="flex items-center gap-1.5 text-slate-400 mr-2">
            {isSearching ? <Search className="w-3.5 h-3.5 text-blue-500" /> : <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />}
            <span className="text-[11px] font-mono text-slate-400 select-none">synapse://</span>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearching(true)}
            onBlur={() => setIsSearching(false)}
            placeholder="brain/search..."
            className="w-full bg-transparent text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none font-medium"
          />
          <div className="flex items-center gap-1 text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
            <Command className="w-2.5 h-2.5" />
            <span>K</span>
          </div>
        </div>

        {/* Action Pill Group */}
        <div className="flex items-center gap-1 bg-white dark:bg-[#141721] p-1 rounded-full border border-slate-300/70 dark:border-slate-800 shadow-sm">
          {/* Quick AI Trigger */}
          <button
            onClick={onOpenAIChat}
            title="Ask AI Second Brain"
            className="p-1.5 rounded-full hover:bg-blue-50 dark:hover:bg-blue-950/40 text-blue-600 dark:text-blue-400 transition-colors relative group"
          >
            <Sparkles className="w-4 h-4" />
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
          </button>

          {/* Activity / Notifications */}
          <button
            onClick={() => setActiveTab("tasks")}
            title="3 pending high-priority actions"
            className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors relative"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-rose-500"></span>
          </button>

          {/* OpenRouter API Key Status Button */}
          <button
            onClick={onOpenSettings}
            title={openRouterKey ? "OpenRouter Connected" : "OpenRouter API Key Missing - Click to configure"}
            className={`p-1.5 rounded-full transition-colors flex items-center gap-1 text-xs px-2.5 ${
              openRouterKey
                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100"
                : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100 animate-pulse"
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span className="text-[11px] font-semibold">{openRouterKey ? "AI Active" : "Add Key"}</span>
          </button>

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            title="App Settings"
            className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* User Profile Avatar with Online Status */}
        <div className="relative cursor-pointer group" onClick={onOpenSettings}>
          <img
            src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
            alt="User avatar"
            className="w-8 h-8 rounded-full object-cover ring-2 ring-white dark:ring-slate-800 shadow-sm group-hover:scale-105 transition-transform"
          />
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white dark:border-slate-900 rounded-full"></span>
        </div>
      </div>
    </header>
  );
};

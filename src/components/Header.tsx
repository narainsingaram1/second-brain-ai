import React from "react";
import {
  Search,
  PenLine,
  Settings,
  Key,
  Moon,
  Sun,
  Menu,
  User,
  Zap,
  Database,
  History,
} from "lucide-react";
import { AuthSession } from "../types";

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  openRouterKey: string;
  onOpenSettings: () => void;
  onOpenAIChat: () => void;
  onOpenQuickCapture?: () => void;
  onOpenVault?: () => void;
  onOpenGlobalSearch?: () => void;
  onOpenAuditLog?: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  searchQuery?: string;
  setSearchQuery?: (query: string) => void;
  session?: AuthSession;
  onOpenAuth?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  openRouterKey,
  onOpenSettings,
  onOpenAIChat,
  onOpenQuickCapture,
  onOpenVault,
  onOpenGlobalSearch,
  onOpenAuditLog,
  theme,
  onToggleTheme,
  searchQuery,
  session,
  onOpenAuth,
}) => {
  const navItems = [
    { id: "home", label: "Home" },
    { id: "goals", label: "Goals" },
    { id: "tasks", label: "Tasks" },
    { id: "habits", label: "Habits" },
    { id: "journal", label: "Journal" },
    { id: "knowledge", label: "Notes" },
    { id: "copilot", label: "Copilot" },
  ];

  return (
    <header className="w-full flex items-center justify-between px-6 py-4 border-b border-line bg-panel backdrop-blur-md sticky top-0 z-40">
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
          className="font-mono text-base font-bold tracking-tight text-ink flex items-center gap-1 hover:opacity-80 transition-opacity"
        >
          <span>[synapse]</span>
        </button>
      </div>

      {/* Center: Clean Minimal Navigation Pills */}
      <nav className="flex items-center bg-raised p-1 rounded-full border border-slate-200/50 dark:border-slate-700/50">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                isActive
                  ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950 shadow-xs"
                  : "text-slate-500 hover:text-ink dark:hover:text-white"
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
          onClick={onOpenGlobalSearch}
          className="relative flex items-center bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800/70 dark:hover:bg-slate-800 rounded-2xl px-3 py-1.5 transition-all w-36 sm:w-44 cursor-pointer"
        >
          <Search className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0" />
          <input
            type="text"
            readOnly
            value={searchQuery}
            placeholder="Search... ⌘K"
            className="w-full bg-transparent text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none font-medium cursor-pointer"
          />
          <span className="text-[11px] text-slate-400 hidden sm:inline ml-1 font-mono">⌘K</span>
        </div>

        {/* Universal Quick Capture shortcut button */}
        {onOpenQuickCapture && (
          <button
            onClick={onOpenQuickCapture}
            title="Universal Quick Capture (⌘⌥N / ⌥⇧N)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl  bg-blue-600 hover:bg-blue-600 hover:to-orange-600 text-white text-xs font-bold shadow-xs active:scale-98 transition-all"
          >
            <Zap className="w-3.5 h-3.5 fill-white" />
            <span className="hidden lg:inline">Quick capture</span>
            <span className="text-[11px] opacity-80 font-mono hidden sm:inline">⌘⌥N</span>
          </button>
        )}

        {/* Semantic Memory Vault button */}
        {onOpenVault && (
          <button
            onClick={onOpenVault}
            title="Semantic Memory Vault (RAG Vector Store)"
            className="w-9 h-9 rounded-2xl bg-raised hover:bg-slate-100 dark:bg-raised dark:hover:bg-slate-800 text-muted dark:text-slate-400 flex items-center justify-center transition-all"
          >
            <Database className="w-4 h-4" />
          </button>
        )}

        {/* Audit Log / Event History button */}
        {onOpenAuditLog && (
          <button
            onClick={onOpenAuditLog}
            title="Audit Log & State Rollback (⌘Z)"
            className="w-9 h-9 rounded-2xl bg-raised hover:bg-slate-100 dark:bg-raised dark:hover:bg-slate-800 text-muted dark:text-slate-400 flex items-center justify-center transition-all"
          >
            <History className="w-4 h-4" />
          </button>
        )}

        {/* AI Copilot shortcut button */}
        <button
          onClick={onOpenAIChat}
          title="Ask Iris"
          className="w-9 h-9 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors"
        >
          <PenLine className="w-4 h-4 text-muted" />
        </button>

        {/* OpenRouter Key status */}
        <button
          onClick={onOpenSettings}
          title={openRouterKey ? "AI provider connected" : "Add AI provider key"}
          className={`w-9 h-9 rounded-2xl flex items-center justify-center transition-colors ${
            openRouterKey
              ? "bg-raised text-[var(--workspace-success)]"
              : "bg-raised text-muted dark:text-slate-400 animate-pulse"
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
          {theme === "dark" ? <Sun className="w-4 h-4 text-muted" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          title="Settings"
          className="w-9 h-9 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* User Account / Sign In Profile Pill */}
        {onOpenAuth && (
          <div className="pl-1 border-l border-line">
            {session?.currentUser ? (
              <button
                onClick={onOpenAuth}
                title={`Signed in as ${session.currentUser.name} (${session.currentUser.email})`}
                className="flex items-center gap-2 p-1 pr-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200/60 dark:border-slate-700 transition-all active:scale-98"
              >
                <img
                  src={session.currentUser.avatar}
                  alt={session.currentUser.name}
                  className="w-7 h-7 rounded-xl object-cover border border-white dark:border-slate-600 shadow-2xs"
                />
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 max-w-[85px] truncate hidden md:inline">
                  {session.currentUser.name.split(" ")[0]}
                </span>
              </button>
            ) : (
              <button
                onClick={onOpenAuth}
                title="Sign in with Google or create an account"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-xs active:scale-98"
              >
                <User className="w-3.5 h-3.5" />
                <span>Sign in</span>
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

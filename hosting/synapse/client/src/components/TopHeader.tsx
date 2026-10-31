import React from "react";
import { Search, Moon, Sun, Bell, ChevronDown } from "lucide-react";
import { AuthSession } from "../types";

interface TopHeaderProps {
  onOpenGlobalSearch: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  session?: AuthSession;
  onOpenAuth: () => void;
  onOpenNotifications: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  onOpenGlobalSearch,
  theme,
  onToggleTheme,
  session,
  onOpenAuth,
  onOpenNotifications,
}) => {
  // Compute user name and initials
  const user = session?.currentUser;
  const displayName = user?.name || (user?.email ? user.email.split("@")[0] : "Narain");
  
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "NS";

  return (
    <header className="synapse-header w-full shrink-0 flex items-center justify-end px-3 sm:px-8 py-3 sm:py-4 gap-2 sm:gap-3 z-20 select-none">
      <span className="header-location">YOUR PERSONAL SPACE <span>/</span> <strong>Make space for clarity</strong></span>
      {/* Search Bar Pill: "Search anything...  ⌘ K" */}
      <button
        type="button"
        onClick={onOpenGlobalSearch}
        aria-label="Search workspace"
        className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-slate-100/90 dark:bg-[#111324] border border-slate-200/80 dark:border-[#242747] text-slate-500 dark:text-slate-400 hover:border-indigo-400 dark:hover:border-indigo-500/50 shadow-xs hover:shadow-sm transition-all group min-w-0 w-8 sm:w-64 shrink-0 sm:shrink px-2 sm:px-3.5"
      >
        <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500 transition-colors shrink-0" />
        <span className="hidden sm:inline text-xs font-medium text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 truncate">
          Search anything...
        </span>
        <kbd className="hidden sm:block ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-white dark:bg-[#1a1d36] border border-slate-200 dark:border-slate-700/60 text-slate-400 shadow-xs">
          ⌘ K
        </kbd>
      </button>

      {/* Theme Toggle Button (Moon / Sun) */}
      <button
        type="button"
        onClick={onToggleTheme}
        className="w-8 h-8 rounded-full flex items-center justify-center bg-white/80 dark:bg-[#111324] border border-slate-200/80 dark:border-[#242747] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white shadow-xs hover:scale-105 transition-all"
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {theme === "dark" ? (
          <Sun className="w-3.5 h-3.5" />
        ) : (
          <Moon className="w-3.5 h-3.5" />
        )}
      </button>

      {/* Notification Bell Button with Indicator Dot */}
      <button
        type="button"
        onClick={onOpenNotifications}
        className="relative w-8 h-8 rounded-full flex items-center justify-center bg-white/80 dark:bg-[#111324] border border-slate-200/80 dark:border-[#242747] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white shadow-xs hover:scale-105 transition-all"
        title="Notifications & Audit Log"
      >
        <Bell className="w-3.5 h-3.5" />
        {/* Unread notification indicator dot */}
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-indigo-500 ring-2 ring-white dark:ring-[#090b14]" />
      </button>

      {/* User Profile Pill: (NS) Narain ⌵ */}
      <button
        type="button"
        onClick={onOpenAuth}
        aria-label="Account settings"
        className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-white/80 dark:bg-[#111324] border border-slate-200/80 dark:border-[#242747] hover:border-slate-300 dark:hover:border-slate-600 shadow-xs hover:shadow-sm transition-all group"
      >
        {/* Initials Circle */}
        <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-[10px] font-bold text-white shadow-xs">
          {initials}
        </div>
        <span className="hidden sm:inline text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white">
          {displayName}
        </span>
        <ChevronDown className="w-3 h-3 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
      </button>
    </header>
  );
};

import React from "react";
import {
  LayoutDashboard,
  GitFork,
  CheckSquare,
  Flame,
  BookOpen,
  Database,
  Bot,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";

interface FloatingDockProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onQuickAdd: () => void;
}

export const FloatingDock: React.FC<FloatingDockProps> = ({
  activeTab,
  setActiveTab,
  theme,
  onToggleTheme,
  onQuickAdd,
}) => {
  const [collapsed, setCollapsed] = React.useState(false);

  const dockItems = [
    { id: "home", label: "Command Center", icon: LayoutDashboard },
    { id: "journeys", label: "Focus Flow", icon: GitFork },
    { id: "tasks", label: "Task Matrix", icon: CheckSquare },
    { id: "habits", label: "Daily Habits", icon: Flame },
    { id: "journal", label: "Reflections", icon: BookOpen },
    { id: "knowledge", label: "Neural Vault", icon: Database },
    { id: "copilot", label: "AI Copilot", icon: Bot },
  ];

  return (
    <aside className="fixed left-4 top-24 z-30 flex flex-col items-center">
      <div className="bg-white/90 dark:bg-[#141721]/90 backdrop-blur-xl border border-slate-300/60 dark:border-slate-800 rounded-full p-2 shadow-floating flex flex-col items-center gap-2">
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand Dock" : "Collapse"}
          className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>

        <div className="w-5 h-[1px] bg-slate-200 dark:bg-slate-800 my-0.5"></div>

        {/* Quick Add Pill */}
        <button
          onClick={onQuickAdd}
          title="Quick Add Task or Habit"
          className="w-9 h-9 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center hover:scale-110 active:scale-95 shadow-md transition-all"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
        </button>

        <div className="w-5 h-[1px] bg-slate-200 dark:bg-slate-800 my-0.5"></div>

        {/* Navigation Icons */}
        {dockItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              title={item.label}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 relative group ${
                isActive
                  ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md scale-105"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/80"
              }`}
            >
              <Icon className="w-4 h-4" />
              {/* Tooltip on hover */}
              <span className="absolute left-12 px-2.5 py-1 bg-slate-900 text-white dark:bg-white dark:text-slate-950 text-xs font-semibold rounded-lg shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
                {item.label}
              </span>
            </button>
          );
        })}

        <div className="w-5 h-[1px] bg-slate-200 dark:bg-slate-800 my-1"></div>

        {/* Tactile Day / Night Theme Switcher (matching screenshot bottom left) */}
        <button
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 ${
            theme === "dark"
              ? "bg-amber-400/20 text-amber-400 hover:bg-amber-400/30"
              : "bg-slate-900 text-amber-300 hover:bg-slate-800 shadow-sm"
          }`}
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
};

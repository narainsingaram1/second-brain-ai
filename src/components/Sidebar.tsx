import React from "react";
import {
  Sparkles,
  Home,
  Target,
  CheckSquare,
  BarChart2,
  BookOpen,
  FileText,
  ChevronsLeft,
  ChevronsRight,
  Crown,
  ChevronRight,
} from "lucide-react";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenProModal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  collapsed,
  onToggleCollapse,
  onOpenProModal,
}) => {
  const navItems = [
    { id: "home", label: "Home", icon: Home },
    { id: "goals", label: "Goals", icon: Target },
    { id: "tasks", label: "Tasks", icon: CheckSquare },
    { id: "habits", label: "Habits", icon: BarChart2 },
    { id: "journal", label: "Journal", icon: BookOpen },
    { id: "knowledge", label: "Notes", icon: FileText },
    { id: "copilot", label: "Copilot", icon: Sparkles },
  ];

  return (
    <aside
      className={`h-screen sticky top-0 flex flex-col justify-between transition-all duration-300 ease-in-out border-r border-slate-200/60 dark:border-slate-800/60 bg-white/70 dark:bg-[#090b14]/90 backdrop-blur-xl z-30 select-none ${
        collapsed ? "w-[72px] px-2.5 py-5" : "w-[240px] px-4 py-5"
      }`}
    >
      {/* Top Branding Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between px-1">
          <div
            onClick={() => setActiveTab("home")}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            {/* Sparkle 4-point Icon with Vibrant Gradient */}
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform shrink-0">
              <Sparkles className="w-4 h-4 text-white fill-white/30" />
            </div>

            {!collapsed && (
              <span className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white flex items-center">
                <span>[synapse]</span>
              </span>
            )}
          </div>

          <button
            onClick={onToggleCollapse}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronsRight className="w-4 h-4" />
            ) : (
              <ChevronsLeft className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-all group ${
                  isActive
                    ? "bg-[#eceef8] dark:bg-[#181a32] text-indigo-600 dark:text-[#a5b4fc] border border-indigo-200/50 dark:border-indigo-500/20 shadow-xs"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-slate-800/40"
                } ${collapsed ? "justify-center px-0" : ""}`}
                title={collapsed ? item.label : undefined}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-110 ${
                    isActive
                      ? "text-indigo-600 dark:text-[#818cf8]"
                      : "text-slate-400 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-white"
                  }`}
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Pro Card */}
      <div>
        {!collapsed ? (
          <div
            onClick={onOpenProModal}
            className="group flex items-center justify-between p-3 rounded-2xl bg-slate-50/80 dark:bg-[#121422]/70 border border-slate-200/80 dark:border-slate-800/80 hover:border-amber-500/40 hover:bg-slate-100 dark:hover:bg-[#181a2e] cursor-pointer transition-all shadow-xs"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-xl bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20 flex items-center justify-center shrink-0">
                <Crown className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h4 className="text-xs font-extrabold text-slate-900 dark:text-white">
                    Pro
                  </h4>
                </div>
                <p className="text-[10px] text-slate-400 truncate">
                  Unlock more power
                </p>
              </div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-amber-500 transition-colors shrink-0" />
          </div>
        ) : (
          <button
            onClick={onOpenProModal}
            className="w-full flex items-center justify-center p-2.5 rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/20 hover:scale-105 transition-all"
            title="Pro - Unlock more power"
          >
            <Crown className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
};

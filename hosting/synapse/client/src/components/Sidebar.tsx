import React from "react";
import {
  Sparkles,
  Home,
  Target,
  CheckSquare,
  BarChart2,
  BookOpen,
  FileText,
  Settings2,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSettings?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  collapsed,
  onToggleCollapse,
  onOpenSettings,
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
      className={`synapse-sidebar shrink-0 flex flex-col justify-between transition-all duration-300 ease-in-out border-r border-slate-200/60 dark:border-slate-800/60 bg-white/70 dark:bg-[#090b14]/90 backdrop-blur-xl z-30 select-none ${
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
                <span>iris<span className="brand-period">.</span></span>
              </span>
            )}
          </div>

          <button
            onClick={onToggleCollapse}
            className="hidden md:block p-1.5 rounded-xl text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
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
        <nav className="sidebar-nav space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                aria-current={isActive ? "page" : undefined}
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
      <div className="sidebar-bottom">
        {!collapsed && <div className="sidebar-note"><span className="sidebar-note-mark">✧</span><p>A little space<br/>for a clearer mind.</p></div>}
        <button onClick={onOpenSettings} className="sidebar-settings" title="Workspace settings"><Settings2 size={17}/>{!collapsed && <><span>Workspace settings</span><span className="settings-dot"/></>}</button>
      </div>
    </aside>
  );
};

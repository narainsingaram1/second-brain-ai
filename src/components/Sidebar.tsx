import {
  BookOpen,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  FileText,
  Flame,
  Home,
  Layers,
  Plus,
  Settings2,
  Sparkles,
  Target,
  Briefcase,
  FolderOpen,
} from "lucide-react";
import type { Workspace } from "../types";
interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSettings?: () => void;
  onQuickCapture: () => void;
  counts: { tasks: number; notes: number; goals: number };
  workspaces?: Workspace[];
}
const groups = [
  {
    label: "WORKSPACE",
    items: [
      { id: "home", label: "Home", icon: Home },
      { id: "tasks", label: "Tasks", icon: CheckSquare },
      { id: "knowledge", label: "Notes", icon: FileText },
    ],
  },
  {
    label: "PERSONAL GROWTH",
    items: [
      { id: "goals", label: "Goals", icon: Target },
      { id: "habits", label: "Habits", icon: Flame },
      { id: "journal", label: "Journal", icon: BookOpen },
    ],
  },
  {
    label: "THINK TOGETHER",
    items: [{ id: "copilot", label: "Iris Copilot", icon: Sparkles }],
  },
];
export function Sidebar({
  activeTab,
  setActiveTab,
  collapsed,
  onToggleCollapse,
  onOpenSettings,
  onQuickCapture,
  counts,
  workspaces = [],
}: SidebarProps) {
  return (
    <aside className={`synapse-sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="sidebar-brand-row">
        <button
          className="iris-brand"
          aria-label="Iris home"
          onClick={() => setActiveTab("home")}
        >
          <span className="iris-mark" />
          {!collapsed && (
            <span>
              Iris<span className="brand-period">.</span>
            </span>
          )}
        </button>
        <button
          className="sidebar-collapse icon-control"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
      <button
        className="sidebar-capture"
        onClick={onQuickCapture}
        title="Create a note or task"
      >
        <Plus size={17} />
        {!collapsed && (
          <>
            <span>Quick create</span>
            <kbd>⌘⌥N</kbd>
          </>
        )}
      </button>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {groups.map((group) => (
          <div className="nav-group" key={group.label}>
            {!collapsed && <p className="nav-label">{group.label}</p>}
            {group.items.map((item) => {
              const count =
                item.id === "tasks"
                  ? counts.tasks
                  : item.id === "knowledge"
                    ? counts.notes
                    : item.id === "goals"
                      ? counts.goals
                      : undefined;
              return (
                <button
                  key={item.id}
                  aria-current={activeTab === item.id ? "page" : undefined}
                  onClick={() => setActiveTab(item.id)}
                  title={item.label}
                >
                  <item.icon size={18} />
                  {!collapsed && (
                    <>
                      <span>{item.label}</span>
                      {count !== undefined && count > 0 && (
                        <small>{count}</small>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        <div className="nav-group">
          {!collapsed && <div className="sidebar-workspace-label"><p className="nav-label">WORKSPACES</p><button onClick={() => setActiveTab("workspace-new")} aria-label="Create workspace" title="Create workspace"><Plus size={14} /></button></div>}
          <button onClick={() => setActiveTab("workspaces")} aria-current={activeTab === "workspaces" || activeTab === "workspace-new" ? "page" : undefined} title="All workspaces"><Layers size={18} />{!collapsed && <span>All workspaces</span>}</button>
          {workspaces.map(workspace => <button key={workspace.id} onClick={() => setActiveTab(`workspace:${workspace.id}`)} aria-current={activeTab === `workspace:${workspace.id}` ? "page" : undefined} title={workspace.name}><span className={`workspace-nav-dot ws-color-${workspace.color}`}>{workspace.template === "career" ? <Briefcase size={17} /> : <FolderOpen size={17} />}</span>{!collapsed && <span className="workspace-nav-name">{workspace.name}</span>}</button>)}
          {!collapsed && <button className="workspace-nav-add" onClick={() => setActiveTab("workspace-new")}><Plus size={16} /><span>New workspace</span></button>}
        </div>
      </nav>
      <div className="sidebar-bottom">
        {!collapsed && (
          <div className="sidebar-note">
            <Layers size={20} />
            <strong>
              Less scattered.
              <br />
              More connected.
            </strong>
            <p>Your thoughts have a home here.</p>
          </div>
        )}
        <button
          className="sidebar-settings"
          onClick={onOpenSettings}
          title="Settings"
        >
          <Settings2 size={18} />
          {!collapsed && <span>Settings & preferences</span>}
        </button>
      </div>
    </aside>
  );
}

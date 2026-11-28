import {
  BookOpen,
  CheckSquare,
  CalendarDays,
  Repeat,
  ChevronLeft,
  ChevronRight,
  FileText,
  Flame,
  Home,
  Layers,
  Plus,
  Settings2,
  Briefcase,
  FolderOpen,
  GraduationCap,
  HeartPulse,
  X,
} from "lucide-react";
import type { Workspace } from "../types";
interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSettings?: () => void;
  onNewChat: () => void;
  chatBusy?: boolean;
  counts: { tasks: number; notes: number };
  workspaces?: Workspace[];
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}
const groups = [
  {
    label: "Plan",
    items: [
      { id: "home", label: "Home", icon: Home },
      { id: "tasks", label: "Tasks", icon: CheckSquare },
      { id: "events", label: "Events", icon: CalendarDays },
      { id: "routines", label: "Routines", icon: Repeat },
      { id: "knowledge", label: "Notes", icon: FileText },
    ],
  },
  {
    label: "Grow",
    items: [
      { id: "habits", label: "Habits", icon: Flame },
      { id: "journal", label: "Journal", icon: BookOpen },
    ],
  },
];
export function Sidebar({
  activeTab,
  setActiveTab,
  collapsed,
  onToggleCollapse,
  onOpenSettings,
  onNewChat,
  chatBusy = false,
  counts,
  workspaces = [],
  mobileOpen = false,
  onCloseMobile,
}: SidebarProps) {
  const selectTab = (tab: string) => {
    setActiveTab(tab);
    onCloseMobile?.();
  };
  return (
    <>
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={`synapse-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}
        aria-label="Sidebar navigation"
      >
      <div className="sidebar-brand-row">
        <button
          className="iris-brand"
          aria-label="Iris home"
          onClick={() => selectTab("home")}
        >
          <span className="iris-mark" aria-hidden="true" />
          {!collapsed && <span>Iris</span>}
        </button>
        <div className="flex items-center gap-1">
          {onCloseMobile && (
            <button
              type="button"
              className="sidebar-mobile-close icon-control"
              onClick={onCloseMobile}
              aria-label="Close navigation menu"
            >
              <X size={17} />
            </button>
          )}
          <button
            className="sidebar-collapse icon-control"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </div>
      <button
        className="sidebar-capture"
        onClick={() => {
          onNewChat();
          onCloseMobile?.();
        }}
        title="New chat (⌘N)"
        aria-label="New chat"
        disabled={chatBusy}
      >
        <Plus size={16} />
        {!collapsed && (
          <>
            <span>New</span>
            <kbd>⌘N</kbd>
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
                    : undefined;
              return (
                <button
                  key={item.id}
                  aria-current={activeTab === item.id ? "page" : undefined}
                  onClick={() => selectTab(item.id)}
                  title={item.label}
                >
                  <item.icon size={16} strokeWidth={1.5} />
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
          {!collapsed && <div className="sidebar-workspace-label"><p className="nav-label">Workspaces</p><button onClick={() => selectTab("workspace-new")} aria-label="Create workspace" title="Create workspace"><Plus size={14} /></button></div>}
          <button onClick={() => selectTab("workspaces")} aria-current={activeTab === "workspaces" || activeTab === "workspace-new" ? "page" : undefined} title="All workspaces"><Layers size={16} strokeWidth={1.5} />{!collapsed && <span>All workspaces</span>}</button>
          {workspaces.map(workspace => <button key={workspace.id} onClick={() => selectTab(`workspace:${workspace.id}`)} aria-current={activeTab === `workspace:${workspace.id}` ? "page" : undefined} title={workspace.name}><span className={`workspace-nav-dot ws-color-${workspace.color}`}>{workspace.template === "career" ? <Briefcase size={16} strokeWidth={1.5} /> : workspace.template === "academic" ? <GraduationCap size={16} strokeWidth={1.5} /> : workspace.template === "health" ? <HeartPulse size={16} strokeWidth={1.5} /> : <FolderOpen size={16} strokeWidth={1.5} />}</span>{!collapsed && <span className="workspace-nav-name">{workspace.name}</span>}</button>)}
          {!collapsed && <button className="workspace-nav-add" onClick={() => selectTab("workspace-new")}><Plus size={16} strokeWidth={1.5} /><span>New workspace</span></button>}
        </div>
      </nav>
      <div className="sidebar-bottom">
        <button
          className="sidebar-settings"
          onClick={() => {
            onCloseMobile?.();
            onOpenSettings?.();
          }}
          title="Settings"
        >
          <Settings2 size={16} strokeWidth={1.5} />
          {!collapsed && <span>Settings</span>}
        </button>
      </div>
      </aside>
    </>
  );
}

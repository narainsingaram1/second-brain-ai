import { Search, Moon, Sun, Bell } from "lucide-react";
import { AuthSession } from "../types";
interface TopHeaderProps {
  onOpenGlobalSearch: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  session?: AuthSession;
  onOpenAuth: () => void;
  onOpenNotifications: () => void;
  activeTab: string;
  pageTitle?: string;
}
const titles: Record<string, string> = {
  home: "Home",
  tasks: "Tasks",
  events: "Events",
  planner: "Daily planner",
  knowledge: "Notes",
  goals: "Goals",
  habits: "Habits",
  journal: "Journal",
  copilot: "Ask Iris",
};
export function TopHeader({
  onOpenGlobalSearch,
  theme,
  onToggleTheme,
  session,
  onOpenAuth,
  onOpenNotifications,
  activeTab,
  pageTitle,
}: TopHeaderProps) {
  const user = session?.currentUser;
  const name = user?.name || user?.email?.split("@")[0] || "Guest";
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <header className="synapse-header">
      <div className="header-location">
        <strong>{pageTitle || titles[activeTab] || "Home"}</strong>
      </div>
      <button
        className="workspace-search"
        onClick={onOpenGlobalSearch}
        aria-label="Search workspace"
      >
        <Search size={15} strokeWidth={1.5} className="shrink-0" />
        <span>Search anything...</span>
        <kbd>⌘K</kbd>
      </button>
      <div className="header-actions">
        <button
          className="icon-control"
          onClick={onToggleTheme}
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          title={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
        >
          {theme === "dark" ? <Sun size={17} strokeWidth={1.5} /> : <Moon size={17} strokeWidth={1.5} />}
        </button>
        <button
          className="icon-control"
          onClick={onOpenNotifications}
          aria-label="Activity history"
          title="Activity history"
        >
          <Bell size={17} strokeWidth={1.5} />
        </button>
        <button
          className="account-avatar-btn"
          onClick={onOpenAuth}
          aria-label="Account settings"
          title="Account settings"
        >
          <span>{initials}</span>
        </button>
      </div>
    </header>
  );
}

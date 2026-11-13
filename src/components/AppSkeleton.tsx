import { Sidebar } from "./Sidebar";
import { rememberedTab } from "../utils/startupMemory";

const noop = () => {};
const ROWS = [0, 1, 2, 3, 4, 5];

/** The app's own frame while the account and data load: the real sidebar, with placeholder content. */
export function AppSkeleton() {
  return (
    <div role="status" aria-label="Loading your workspace" className="synapse-app app-skeleton h-[var(--app-viewport-height,100dvh)] overflow-hidden flex font-sans relative">
      <div inert className="contents">
        <Sidebar
          activeTab={rememberedTab()}
          setActiveTab={noop}
          onNewChat={noop}
          onToggleCollapse={noop}
          counts={{ tasks: 0, notes: 0, goals: 0 }}
          collapsed={window.matchMedia("(max-width: 767px)").matches}
        />
      </div>
      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full" aria-hidden="true">
        <div className="synapse-header">
          <span className="app-skeleton-bar app-skeleton-location" />
          <span className="app-skeleton-bar app-skeleton-search" />
          <span className="app-skeleton-bar app-skeleton-account" />
        </div>
        <div className="workspace-page w-full mx-auto">
          <span className="app-skeleton-bar app-skeleton-title" />
          <span className="app-skeleton-bar app-skeleton-subtitle" />
          <div className="app-skeleton-rows">
            {ROWS.map(row => <span key={row} className="app-skeleton-bar app-skeleton-row" />)}
          </div>
        </div>
      </div>
    </div>
  );
}

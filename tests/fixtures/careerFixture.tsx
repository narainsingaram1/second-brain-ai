// Isolated manual QA surface: real components and browser storage; no provider calls.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "../../src/components/Sidebar";
import { TopHeader } from "../../src/components/TopHeader";
import { WorkspacesView } from "../../src/components/WorkspacesView";
import {
  loadInitialState,
  persistBrainState,
} from "../../src/services/storage";
import type { BrainState } from "../../src/types";
import "../../src/index.css";
import "../../src/redesign.css";

const owner = "career-ui-fixture";
function Fixture() {
  const [state, setState] = useState<BrainState | null>(null);
  const [tab, setTab] = useState("workspace:workspace-career");
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("Loading");
  const [collapsed, setCollapsed] = useState(window.innerWidth < 768);
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    loadInitialState(owner)
      .then(setState)
      .catch((error) => setError(error.message));
  }, []);
  useEffect(() => {
    if (!state) return;
    setSaveStatus("Saving");
    persistBrainState(() => latest.current!, owner)
      .then(() => setSaveStatus("Saved"))
      .catch((error) => {
        setSaveStatus("Error");
        setError(error.message);
      });
  }, [state]);
  if (!state) return <div>{error || "Loading fixture…"}</div>;
  return (
    <div className="synapse-app h-[100dvh] flex overflow-hidden">
      <Sidebar
        activeTab={tab}
        setActiveTab={setTab}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        onQuickCapture={() => {}}
        counts={{ tasks: 0, notes: 0, goals: 0 }}
        workspaces={state.workspaces}
      />
      <div className="flex flex-col min-w-0 min-h-0 flex-1">
        <TopHeader
          activeTab={tab}
          pageTitle={
            state.workspaces?.find(
              (workspace) => tab === `workspace:${workspace.id}`,
            )?.name || "Workspaces"
          }
          onOpenGlobalSearch={() => {}}
          theme={state.theme}
          onToggleTheme={() => {
            document.documentElement.classList.toggle("dark");
            setState(
              (prev) =>
                prev && {
                  ...prev,
                  theme: prev.theme === "light" ? "dark" : "light",
                },
            );
          }}
          onOpenAuth={() => {}}
          onOpenNotifications={() => {}}
        />
        <main className="workspace-main overflow-y-auto min-h-0">
          <div className="workspace-page">
            <WorkspacesView
              key={tab}
              state={state}
              workspaceId={
                tab.startsWith("workspace:") ? tab.slice(10) : undefined
              }
              createInitially={tab === "workspace-new"}
              onChange={(update) =>
                setState((prev) => (prev ? update(prev) : prev))
              }
              onNavigate={setTab}
            />
          </div>
        </main>
        <output
          aria-label="Fixture save status"
          className="fixed bottom-1 right-2 text-[10px] text-slate-500"
        >
          {error || saveStatus}
        </output>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);

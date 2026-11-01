import { managedAuthEnabled, signOutManaged } from "../services/managedAuth";
import { useEffect, useRef, useState } from "react";
import type { BrainState } from "../types";
import { cloudEnabled, cloudStatus, markCloudDirty, sharedState } from "../services/cloudSync";
import { persistBrainState } from "../services/storage";

export function CloudControls({ state, onImport }: { state: BrainState; onImport: (state: BrainState) => void }) {
  const [status, setStatus] = useState(cloudStatus());
  const [retrying, setRetrying] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const update = () => setStatus(cloudStatus());
    update();
    window.addEventListener("synapse-sync-status", update);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (cloudEnabled && cloudStatus() !== "Synced") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("synapse-sync-status", update);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
  const exportData = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ state: sharedState(state) }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `synapse-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-2 text-xs bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
    <span role="status" className="mr-auto">{cloudEnabled ? status : "Stored on this device"}</span>
    {cloudEnabled && status !== "Synced" && status !== "Saving…" && status !== "Connecting…" && (
      <button type="button" disabled={retrying} onClick={async () => {
        setRetrying(true);
        try { await persistBrainState(state, state.userId); }
        catch (error) { window.alert(error instanceof Error ? error.message : "Could not save. Export your work before closing this tab."); }
        finally { setRetrying(false); }
      }}>{retrying ? "Retrying…" : "Retry save"}</button>
    )}
    <button type="button" onClick={exportData}>Export data</button>
    {cloudEnabled && <><button type="button" onClick={() => input.current?.click()}>Import data</button>{managedAuthEnabled ? <button onClick={async () => {
        if (cloudStatus() !== "Synced" && !window.confirm("Some changes may not be saved. Export your work before signing out. Sign out anyway?")) return;
        try { await signOutManaged(); } catch { window.alert("Could not sign out. Try again."); }
      }}>Sign out</button> : <a href="/signout-with-chatgpt?return_to=/" target="_top">Sign out</a>}
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return;
        try {
          const parsed = JSON.parse(await file.text()); const data = parsed.state || parsed;
          for (const field of ["tasks", "goals", "habits", "journalEntries", "knowledgeItems", "chatHistory", "sections"]) {
            if (!Array.isArray(data[field])) throw new Error(`Invalid backup: missing ${field}`);
          }
          if (!window.confirm("Replace the cloud records with this backup? Export your current records first if you need to keep them.")) return;
          markCloudDirty();
          const { openRouterKey: _key, userId: _id, ...records } = data;
          onImport({ ...state, ...records, userId: state.userId, openRouterKey: state.openRouterKey });
        } catch (error) { window.alert(error instanceof Error ? error.message : "Could not import backup"); }
        event.target.value = "";
      }} /></>}
  </div>;
}

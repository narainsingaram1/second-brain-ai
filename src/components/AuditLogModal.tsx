import { DialogBackdrop } from "./workspace/DialogBackdrop";
import React, { useEffect, useState } from "react";
import { accountHistory, type AccountHistoryEntry } from "../services/serverApi";
import { AuditLogEntry } from "../types";
import {
  History,
  Undo2,
  CheckCircle2,
  Trash2,
  PlusCircle,
  Edit3,
  Flame,
  BookOpen,
  FileText,
  X,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";

interface AuditLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  auditLog: AuditLogEntry[];
  onUndo: () => void;
  canUndo: boolean;
  onClearLog: () => void;
}

export const AuditLogModal: React.FC<AuditLogModalProps> = ({
  isOpen,
  onClose,
  auditLog,
  onUndo,
  canUndo,
  onClearLog,
}) => {
  const [filter, setFilter] = useState<string>("all");
  const [history, setHistory] = useState<AccountHistoryEntry[]>([]);
  useEffect(() => { if (isOpen) accountHistory().then(setHistory).catch(() => setHistory([])); }, [isOpen]);

  if (!isOpen) return null;

  const filtered = auditLog.filter((entry) => {
    if (filter === "all") return true;
    return entry.entityType === filter;
  });

  const getActionIcon = (action: string, type: string) => {
    if (action.toLowerCase().includes("delete")) {
      return <Trash2 className="w-3.5 h-3.5 text-red-400" />;
    }
    if (action.toLowerCase().includes("create") || action.toLowerCase().includes("add")) {
      return <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />;
    }
    if (action.toLowerCase().includes("complete") || action.toLowerCase().includes("toggle")) {
      return <CheckCircle2 className="w-3.5 h-3.5 text-muted" />;
    }
    if (type === "habit") return <Flame className="w-3.5 h-3.5 text-muted" />;
    if (type === "journal") return <BookOpen className="w-3.5 h-3.5 text-muted" />;
    if (type === "knowledge") return <FileText className="w-3.5 h-3.5 text-muted" />;
    return <Edit3 className="w-3.5 h-3.5 text-slate-400" />;
  };

  return (
    <DialogBackdrop onClose={onClose} label="Activity history" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-fade-in">
      <div className="workspace-dialog bg-panel backdrop-blur-2xl rounded-3xl border border-line shadow-2xl w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden ring-1 ring-slate-900/5 dark:ring-white/10">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-raised border border-line text-muted flex items-center justify-center">
              <History className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-sm tracking-tight text-ink">
                  Audit log & event history
                </h3>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-raised text-muted dark:bg-raised dark:text-slate-400 border border-line flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  Immutable Ledger
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Full chronological mutation history with instant ⌘Z state rollback
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo last action (⌘Z)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-950 text-xs font-bold transition-all disabled:opacity-40 disabled:hover:scale-100 active:scale-98 shadow-xs"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Undo (⌘Z)</span>
            </button>
            <button aria-label="Close dialog" onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter Pills Bar */}
        <div className="px-6 py-2.5 bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-1 bg-raised p-0.5 rounded-xl border border-slate-200/50 dark:border-slate-700/50">
            {["all", "task", "habit", "journal", "knowledge", "section"].map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold capitalize transition-all ${
                  filter === t
                    ? "bg-white dark:bg-slate-700 text-ink shadow-2xs"
                    : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <span className="text-[11px] font-mono text-slate-400">
            {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        {/* Events Timeline List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2.5">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400 space-y-2">
              <History className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
              <p className="text-xs font-semibold">No mutation events recorded yet.</p>
              <p className="text-[11px]">Any edits, creations, or deletions will be tracked here in real time.</p>
            </div>
          ) : (
            filtered.map((entry, idx) => (
              <div
                key={entry.id || idx}
                className="group p-3 rounded-2xl bg-slate-50/80 dark:bg-slate-900/50 border border-line flex items-center justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-center shrink-0">
                    {getActionIcon(entry.action, entry.entityType)}
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-ink">
                        {entry.action}:
                      </span>
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate max-w-[280px]">
 "{entry.entityTitle}"
                      </span>
                      <span className="text-[11px] font-mono px-1.5 py-0.2 rounded uppercase tracking-wider bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                        {entry.entityType}
                      </span>
                    </div>
                    {entry.details && (
                      <p className="text-[11px] text-slate-400 truncate max-w-[360px]">
                        {entry.details}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-slate-400">
                    {entry.timeString}
                  </span>
                  {idx === 0 && canUndo && (
                    <button
                      onClick={onUndo}
                      title="Undo this action"
                      className="opacity-0 group-hover:opacity-100 px-2 py-1 rounded-lg bg-raised text-muted dark:text-slate-400 text-[11px] font-bold hover:bg-slate-100 transition-all flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Undo</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
          {history.length > 0 && <section className="pt-4 space-y-2" aria-label="Account history">
            <h4 className="text-xs font-bold text-ink flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-[var(--workspace-success)]" />Account history</h4>
            <p className="text-[11px] text-slate-400">Kept on the server for every device, including what the assistant proposed and what you approved. Entries cannot be edited or deleted.</p>
            {history.map(entry => <div key={entry.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-line text-xs">
              <span className="min-w-0 truncate"><span className="font-semibold">{entry.actor === "user" ? "You" : entry.actor === "assistant" ? "Assistant" : "System"}</span> · {entry.action}{entry.title ? `: ${entry.title}` : ""}</span>
              <time className="shrink-0 text-[11px] font-mono text-slate-400" dateTime={entry.at}>{new Date(entry.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
            </div>)}
          </section>}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <span>State rollback engine: 30 rolling snapshots</span>
          {auditLog.length > 0 && (
            <button
              onClick={onClearLog}
              className="text-red-500 hover:text-red-600 font-semibold transition-colors"
            >
              Clear Log
            </button>
          )}
        </div>
      </div>
    </DialogBackdrop>
  );
};

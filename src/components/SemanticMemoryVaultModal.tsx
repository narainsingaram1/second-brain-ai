import { DialogBackdrop } from "./workspace/DialogBackdrop";
import React, { useState, useEffect } from "react";
import { BrainState } from "../types";
import { vectorVault, SearchResult, VaultStats } from "../services/vectorVault";
import {
  Database,
  Search,
  RefreshCw,
  PenLine,
  X,
  Layers,
  Cpu,
  HardDrive,
  FileText,
  CheckCircle2,
  Calendar,
  Flame,
  BookOpen,
  ShieldCheck,
} from "lucide-react";

interface SemanticMemoryVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  brainState: BrainState;
  openRouterKey: string;
}

export const SemanticMemoryVaultModal: React.FC<SemanticMemoryVaultModalProps> = ({
  isOpen,
  onClose,
  brainState,
  openRouterKey,
}) => {
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [reindexProgress, setReindexProgress] = useState<{ current: number; total: number } | null>(null);
  const [reindexSuccess, setReindexSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadStats();
    }
  }, [isOpen]);

  const loadStats = async () => {
    const s = await vectorVault.getVaultStats(brainState);
    setStats(s);
  };

  const handleSearch = async (queryText?: string) => {
    const q = queryText !== undefined ? queryText : searchQuery;
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await vectorVault.search(
        { ...brainState, openRouterKey },
        q,
        8,
        filterType !== "all" ? filterType : undefined,
      );
      setSearchResults(results);
    } catch (err) {
      console.error("Vector search failed:", err);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (searchQuery.trim().length > 1) {
      const timer = setTimeout(() => {
        handleSearch();
      }, 200);
      return () => clearTimeout(timer);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, filterType]);

  const handleReindex = async () => {
    setIsReindexing(true);
    setReindexProgress({ current: 0, total: 1 });
    setReindexSuccess(false);

    try {
      await vectorVault.reindexBrain({ ...brainState, openRouterKey }, (current, total) => {
        setReindexProgress({ current, total });
      });
      await loadStats();
      setReindexSuccess(true);
      setTimeout(() => setReindexSuccess(false), 4000);
    } catch (err) {
      console.error("Re-indexing failed:", err);
    } finally {
      setIsReindexing(false);
      setReindexProgress(null);
    }
  };

  if (!isOpen) return null;

  const sampleQueries = [
 "Algorithms and CS 1332 decisions",
 "Workout routine & fitness consistency",
 "Overcoming burnout & stress reflection",
 "Completed high-leverage milestones",
  ];

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "task":
        return <CheckCircle2 className="w-3.5 h-3.5 text-muted" />;
      case "journal":
        return <BookOpen className="w-3.5 h-3.5 text-muted" />;
      case "knowledge":
        return <FileText className="w-3.5 h-3.5 text-[var(--workspace-success)]" />;
      case "habit":
        return <Flame className="w-3.5 h-3.5 text-muted" />;
      default:
        return <Database className="w-3.5 h-3.5 text-slate-500" />;
    }
  };

  return (
    <DialogBackdrop onClose={onClose} label="Knowledge index" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-fade-in">
      <div className="workspace-dialog bg-panel rounded-3xl border border-line shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-raised border border-line text-muted flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base tracking-tight text-ink">
                  Semantic memory vault
                </h3>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-raised text-muted dark:bg-raised dark:text-slate-400 border border-line flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  RAG Vector Store
                </span>
              </div>
              <p className="text-xs text-slate-400">
                High-dimensional neural vector embeddings for historical recall across your life OS
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReindex}
              disabled={isReindexing}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                isReindexing
                  ? "bg-slate-100 text-slate-400 dark:bg-slate-800"
                  : "bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-950 shadow-xs"
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isReindexing ? "animate-spin" : ""}`} />
              <span>{isReindexing ? "Re-indexing..." : "Re-index Brain"}</span>
            </button>
            <button aria-label="Close dialog" onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Re-indexing progress bar */}
        {reindexProgress && (
          <div className="bg-raised px-6 py-2.5 border-b border-line flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-muted dark:text-slate-400 font-semibold">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>
                Embedding new passages: {reindexProgress.current} of {reindexProgress.total}…
              </span>
            </div>
            <div className="w-32 bg-indigo-200 dark:bg-raised rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-indigo-600 dark:bg-indigo-400 h-full transition-all duration-300"
                style={{
                  width: `${(reindexProgress.current / Math.max(1, reindexProgress.total)) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        {reindexSuccess && (
          <div className="bg-raised px-6 py-2 border-b border-line flex items-center gap-2 text-xs text-[var(--workspace-success)] font-bold">
            <CheckCircle2 className="w-4 h-4" />
            <span>Vault successfully re-indexed! All tasks, notes, habits, and journals are synced into vector storage.</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-line">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <Layers className="w-3.5 h-3.5 text-muted" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Passages</span>
              </div>
              <div className="text-xl font-extrabold text-ink">
                {stats?.embedded_chunks || 0}<span className="text-xs font-semibold text-muted"> / {stats?.total_chunks || 0} embedded</span>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-line">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-[var(--workspace-success)]" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Records</span>
              </div>
              <div className="text-xl font-extrabold text-ink">
                {stats?.total_items || 0}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-line">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <Cpu className="w-3.5 h-3.5 text-muted" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Dimensions</span>
              </div>
              <div className="text-xl font-extrabold text-ink">
                {stats?.vector_dim ? `${stats.vector_dim}d` : "—"}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-line">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <HardDrive className="w-3.5 h-3.5 text-muted" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Engine</span>
              </div>
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate mt-1">
                {stats?.provider === "openrouter" ? "Hybrid (keyword + neural)" : "Keyword only"}
              </div>
            </div>
          </div>

          {/* Interactive Semantic Search Query Tool */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-extrabold text-ink flex items-center gap-1.5">
                <PenLine className="w-3.5 h-3.5 text-muted" />
                <span>Live Semantic Search Test (Cosine Similarity)</span>
              </label>

              {/* Type Filter Pills */}
              <div className="flex items-center gap-1 bg-raised p-0.5 rounded-xl border border-slate-200/50 dark:border-slate-700/50">
                {["all", "task", "journal", "knowledge", "habit"].map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold capitalize transition-all ${
                      filterType === type
                        ? "bg-white dark:bg-slate-700 text-ink shadow-2xs"
                        : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ask your memory vault (e.g. 'what did I decide about CS 1332?', 'workout progress')..."
                className="w-full bg-slate-50 dark:bg-slate-900/70 border border-line rounded-2xl pl-10 pr-4 py-2.5 text-xs text-ink placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 font-medium"
              />
              {isSearching && (
                <div className="absolute right-3.5 w-3.5 h-3.5 border-2 border-line border-t-transparent rounded-full animate-spin" />
              )}
            </div>

            {/* Quick Sample Queries */}
            {!searchQuery && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[11px] text-slate-400 font-semibold self-center mr-1">Try:</span>
                {sampleQueries.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSearchQuery(q)}
                    className="px-2.5 py-1 rounded-xl bg-raised hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-ink dark:hover:text-slate-100 transition-colors border border-slate-200/40 dark:border-slate-700/40"
                  >
 "{q}"
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Search Results List */}
          {searchResults.length > 0 && (
            <div className="space-y-2.5 pt-2">
              <div className="text-xs font-bold text-slate-500 flex items-center justify-between">
                <span>Top ranked semantic matches</span>
                <span>{searchResults.length} vectors retrieved</span>
              </div>

              <div className="space-y-2">
                {searchResults.map((res, idx) => {
                  const scorePct = Math.round(res.score * 100);
                  const isHighMatch = scorePct >= 75;

                  return (
                    <div
                      key={res.chunk.id || idx}
                      className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-line space-y-2 hover:border-slate-300 transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {getTypeIcon(res.chunk.item_type)}
                          <span className="text-[11px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {res.chunk.item_type}
                          </span>
                          <span className="font-bold text-xs text-ink">
                            {res.chunk.title}
                          </span>
                        </div>

                        {/* Similarity Score Badge */}
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-xs font-extrabold px-2 py-0.5 rounded-full ${
                              isHighMatch
                                ? "bg-raised text-emerald-800 dark:bg-raised dark:text-[var(--workspace-success)]"
                                : "bg-raised text-muted dark:bg-raised dark:text-slate-400"
                            }`}
                          >
                            {scorePct}% match
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-normal bg-white dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                        {res.chunk.content}
                      </p>

                      {res.chunk.date && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                          <Calendar className="w-3 h-3" />
                          <span>Timeline: {res.chunk.date}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {searchQuery && searchResults.length === 0 && !isSearching && (
            <div className="text-center py-8 text-slate-400 space-y-1">
              <Database className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
              <p className="text-xs font-medium">No matching vector chunks found.</p>
              <p className="text-[11px]">Try clicking "Re-index Brain" to update your embeddings.</p>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-6 py-3.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between text-[11px] text-slate-400">
          <span>Synced locally to SQLite / JSON Vector Vault in ~/.second_brain_ai/</span>
          <button aria-label="Close dialog" onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-800 dark:text-slate-200 font-bold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </DialogBackdrop>
  );
};

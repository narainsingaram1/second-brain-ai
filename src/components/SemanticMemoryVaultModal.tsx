import React, { useState, useEffect } from "react";
import { BrainState } from "../types";
import { vectorVault, SearchResult, VaultStats } from "../services/vectorVault";
import {
  Database,
  Search,
  RefreshCw,
  Sparkles,
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
    const s = await vectorVault.getVaultStats();
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
        q,
        8,
        filterType !== "all" ? filterType : undefined,
        openRouterKey
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
      await vectorVault.reindexBrain(brainState, openRouterKey, (current, total) => {
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
        return <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />;
      case "journal":
        return <BookOpen className="w-3.5 h-3.5 text-purple-500" />;
      case "knowledge":
        return <FileText className="w-3.5 h-3.5 text-emerald-500" />;
      case "habit":
        return <Flame className="w-3.5 h-3.5 text-amber-500" />;
      default:
        return <Database className="w-3.5 h-3.5 text-slate-500" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-fade-in">
      <div className="bg-white dark:bg-[#12141c] rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 text-white flex items-center justify-center shadow-md shadow-indigo-500/20">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
                  Semantic Memory Vault
                </h3>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50 flex items-center gap-1">
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
                  : "bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-950 shadow-xs hover:scale-102"
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isReindexing ? "animate-spin" : ""}`} />
              <span>{isReindexing ? "Re-indexing..." : "Re-index Brain"}</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Re-indexing progress bar */}
        {reindexProgress && (
          <div className="bg-indigo-50 dark:bg-indigo-950/40 px-6 py-2.5 border-b border-indigo-100 dark:border-indigo-900/50 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 font-semibold">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>
                Embedding brain entities: {reindexProgress.current} of {reindexProgress.total} items...
              </span>
            </div>
            <div className="w-32 bg-indigo-200 dark:bg-indigo-900 rounded-full h-1.5 overflow-hidden">
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
          <div className="bg-emerald-50 dark:bg-emerald-950/40 px-6 py-2 border-b border-emerald-100 dark:border-emerald-900/50 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 font-bold">
            <CheckCircle2 className="w-4 h-4" />
            <span>Vault successfully re-indexed! All tasks, notes, habits, and journals are synced into vector storage.</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <Layers className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Vector Chunks</span>
              </div>
              <div className="text-xl font-extrabold text-slate-900 dark:text-white">
                {stats?.total_chunks || 0}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Indexed Items</span>
              </div>
              <div className="text-xl font-extrabold text-slate-900 dark:text-white">
                {stats?.total_items || 0}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <Cpu className="w-3.5 h-3.5 text-purple-500" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Dimensions</span>
              </div>
              <div className="text-xl font-extrabold text-slate-900 dark:text-white">
                {stats?.vector_dim || 384}d
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <HardDrive className="w-3.5 h-3.5 text-pink-500" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Engine</span>
              </div>
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate mt-1">
                {stats?.provider === "openrouter" ? "OpenRouter Neural" : "Local Fast Engine"}
              </div>
            </div>
          </div>

          {/* Interactive Semantic Search Query Tool */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                <span>Live Semantic Search Test (Cosine Similarity)</span>
              </label>

              {/* Type Filter Pills */}
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-xl border border-slate-200/50 dark:border-slate-700/50">
                {["all", "task", "journal", "knowledge", "habit"].map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold capitalize transition-all ${
                      filterType === type
                        ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs"
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
                className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 font-medium"
              />
              {isSearching && (
                <div className="absolute right-3.5 w-3.5 h-3.5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              )}
            </div>

            {/* Quick Sample Queries */}
            {!searchQuery && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] text-slate-400 font-semibold self-center mr-1">Try:</span>
                {sampleQueries.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSearchQuery(q)}
                    className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-[10px] font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors border border-slate-200/40 dark:border-slate-700/40"
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
                <span>Top Ranked Semantic Matches</span>
                <span>{searchResults.length} vectors retrieved</span>
              </div>

              <div className="space-y-2">
                {searchResults.map((res, idx) => {
                  const scorePct = Math.round(res.score * 100);
                  const isHighMatch = scorePct >= 75;

                  return (
                    <div
                      key={res.chunk.id || idx}
                      className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800/70 space-y-2 hover:border-indigo-400/50 transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {getTypeIcon(res.chunk.item_type)}
                          <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {res.chunk.item_type}
                          </span>
                          <span className="font-bold text-xs text-slate-900 dark:text-white">
                            {res.chunk.title}
                          </span>
                        </div>

                        {/* Similarity Score Badge */}
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-xs font-extrabold px-2 py-0.5 rounded-full ${
                              isHighMatch
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                                : "bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300"
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
                        <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
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
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-800 dark:text-slate-200 font-bold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

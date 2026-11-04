import { DialogBackdrop } from "./workspace/DialogBackdrop";
import React, { useState, useEffect, useRef } from "react";
import { Task, Habit, JournalEntry, KnowledgeItem, BrainState, Goal } from "../types";
import { vectorVault, SearchResult } from "../services/vectorVault";
import {
  Search,
  CheckCircle2,
  Flame,
  BookOpen,
  FileText,
  Target,
  X,
  Sparkles,
  CornerDownLeft,
} from "lucide-react";

interface SemanticGlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  brainState: BrainState;
  onSelectTask: (task: Task) => void;
  onSelectHabit: (habit: Habit) => void;
  onSelectJournal: (entry: JournalEntry) => void;
  onSelectKnowledge: (item: KnowledgeItem) => void;
  onSelectGoal?: (goal: Goal) => void;
  openRouterKey: string;
}

interface GroupedItem {
  id: string;
  type: "task" | "habit" | "journal" | "knowledge" | "goal";
  title: string;
  snippet: string;
  score?: number; // Cosine similarity 0.0 - 1.0
  isKeywordMatch?: boolean;
  date?: string;
  metadata?: any;
  raw: any;
}

export const SemanticGlobalSearch: React.FC<SemanticGlobalSearchProps> = ({
  isOpen,
  onClose,
  brainState,
  onSelectTask,
  onSelectHabit,
  onSelectJournal,
  onSelectKnowledge,
  onSelectGoal,
  openRouterKey,
}) => {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<GroupedItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
    } else {
      setQuery("");
      setResults([]);
    }
  }, [isOpen]);

  // Execute hybrid semantic vector search + keyword fallback
  useEffect(() => {
    if (!query.trim()) {
      // Default: show recent / high priority items
      const recentTasks = brainState.tasks.slice(0, 3).map((t) => ({
        id: t.id,
        type: "task" as const,
        title: t.title,
        snippet: t.description || `Priority: ${t.priority} • Section: ${t.section}`,
        date: t.dueDate,
        raw: t,
      }));
      const recentJournals = brainState.journalEntries.slice(0, 2).map((j) => ({
        id: j.id,
        type: "journal" as const,
        title: j.title,
        snippet: j.content.slice(0, 90) + "...",
        date: j.date,
        raw: j,
      }));
      setResults([...recentTasks, ...recentJournals]);
      return;
    }

    let isCancelled = false;
    setIsSearching(true);

    const runSearch = async () => {
      const q = query.trim().toLowerCase();

      // 1. Semantic Vector Search
      let vectorMatches: SearchResult[] = [];
      try {
        vectorMatches = await vectorVault.search(q, 15, undefined, openRouterKey);
      } catch (err) {
        console.warn("Vector omnibar search fallback:", err);
      }

      if (isCancelled) return;

      const scoredMap = new Map<string, GroupedItem>();

      // Populate vector matches
      for (const vm of vectorMatches) {
        const itemType = vm.chunk.item_type;
        const itemId = vm.chunk.item_id;

        let rawItem: any = null;
        if (itemType === "task") rawItem = brainState.tasks.find((t) => t.id === itemId);
        else if (itemType === "habit") rawItem = brainState.habits.find((h) => h.id === itemId);
        else if (itemType === "journal") rawItem = brainState.journalEntries.find((j) => j.id === itemId);
        else if (itemType === "knowledge") rawItem = brainState.knowledgeItems.find((k) => k.id === itemId);
        else if (itemType === "goal") rawItem = (brainState.goals || []).find((g) => g.id === itemId);

        if (rawItem) {
          scoredMap.set(itemId, {
            id: itemId,
            type: itemType,
            title: vm.chunk.title,
            snippet: vm.chunk.content.slice(0, 110) + "...",
            score: vm.score,
            date: vm.chunk.date,
            raw: rawItem,
          });
        }
      }

      // 2. Keyword Fallback Search across all entities
      brainState.tasks.forEach((t) => {
        if (
          t.title.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q)) ||
          t.section.toLowerCase().includes(q) ||
          (t.tags && t.tags.some((tag) => tag.toLowerCase().includes(q)))
        ) {
          if (!scoredMap.has(t.id)) {
            scoredMap.set(t.id, {
              id: t.id,
              type: "task",
              title: t.title,
              snippet: t.description || `Section: ${t.section} • Due: ${t.dueDate || "None"}`,
              isKeywordMatch: true,
              date: t.dueDate,
              raw: t,
            });
          }
        }
      });

      brainState.habits.forEach((h) => {
        if (
          h.name.toLowerCase().includes(q) ||
          (h.description && h.description.toLowerCase().includes(q))
        ) {
          if (!scoredMap.has(h.id)) {
            scoredMap.set(h.id, {
              id: h.id,
              type: "habit",
              title: h.name,
              snippet: `Frequency: ${h.frequency} • Streak: ${h.streak}d`,
              isKeywordMatch: true,
              raw: h,
            });
          }
        }
      });

      brainState.journalEntries.forEach((j) => {
        if (
          j.title.toLowerCase().includes(q) ||
          j.content.toLowerCase().includes(q) ||
          j.wins.some((w) => w.toLowerCase().includes(q))
        ) {
          if (!scoredMap.has(j.id)) {
            scoredMap.set(j.id, {
              id: j.id,
              type: "journal",
              title: j.title,
              snippet: j.content.slice(0, 110) + "...",
              isKeywordMatch: true,
              date: j.date,
              raw: j,
            });
          }
        }
      });

      brainState.knowledgeItems.forEach((k) => {
        if (
          k.subject.toLowerCase().includes(q) ||
          k.summary.toLowerCase().includes(q) ||
          (k.domain && k.domain.toLowerCase().includes(q))
        ) {
          if (!scoredMap.has(k.id)) {
            scoredMap.set(k.id, {
              id: k.id,
              type: "knowledge",
              title: k.subject,
              snippet: k.summary.slice(0, 110) + "...",
              isKeywordMatch: true,
              date: k.startDate,
              raw: k,
            });
          }
        }
      });

      (brainState.goals || []).forEach((g) => {
        if (
          g.title.toLowerCase().includes(q) ||
          g.sector.toLowerCase().includes(q) ||
          (g.why && g.why.toLowerCase().includes(q)) ||
          (g.metrics && g.metrics.toLowerCase().includes(q))
        ) {
          if (!scoredMap.has(g.id)) {
            scoredMap.set(g.id, {
              id: g.id,
              type: "goal",
              title: g.title,
              snippet: `${g.sector.toUpperCase()} • Horizon: ${g.timeframe} • Progress: ${g.progress}%`,
              isKeywordMatch: true,
              date: g.targetDate,
              raw: g,
            });
          }
        }
      });

      const merged = Array.from(scoredMap.values());
      // Sort by score descending (vector matches first, then keyword matches)
      merged.sort((a, b) => {
        const scoreA = a.score !== undefined ? a.score : 0.5;
        const scoreB = b.score !== undefined ? b.score : 0.5;
        return scoreB - scoreA;
      });

      setResults(merged);
      setIsSearching(false);
      setSelectedIndex(0);
    };

    const timer = setTimeout(runSearch, 150);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [query, brainState, openRouterKey]);

  if (!isOpen) return null;

  const filteredResults = results.filter((item) => {
    if (activeFilter === "all") return true;
    return item.type === activeFilter;
  });

  const handleSelect = (item: GroupedItem) => {
    onClose();
    if (item.type === "task") onSelectTask(item.raw as Task);
    else if (item.type === "habit") onSelectHabit(item.raw as Habit);
    else if (item.type === "journal") onSelectJournal(item.raw as JournalEntry);
    else if (item.type === "knowledge") onSelectKnowledge(item.raw as KnowledgeItem);
    else if (item.type === "goal" && onSelectGoal) onSelectGoal(item.raw as Goal);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredResults.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredResults.length) % Math.max(1, filteredResults.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredResults[selectedIndex]) {
        handleSelect(filteredResults[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "goal":
        return <Target className="w-4 h-4 text-indigo-500" />;
      case "task":
        return <CheckCircle2 className="w-4 h-4 text-blue-500" />;
      case "habit":
        return <Flame className="w-4 h-4 text-amber-500" />;
      case "journal":
        return <BookOpen className="w-4 h-4 text-purple-500" />;
      case "knowledge":
        return <FileText className="w-4 h-4 text-emerald-500" />;
      default:
        return <Search className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <DialogBackdrop onClose={onClose} label="Search workspace"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-slate-950/70 backdrop-blur-md animate-fade-in"
    >
      <div className="workspace-dialog bg-panel backdrop-blur-2xl rounded-3xl border border-line shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col ring-1 ring-slate-900/5 dark:ring-white/10">
        {/* Search Omnibar Input */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center gap-3">
          <Search className="w-5 h-5 text-indigo-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks, habits, reflections, and notes semantically... (⌘K)"
            className="w-full bg-transparent text-sm font-medium text-ink placeholder-slate-400 focus:outline-none"
          />
          {isSearching && (
            <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
          )}
          <button aria-label="Close dialog" onClick={onClose}
            className="p-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter Pills */}
        <div className="px-5 py-2 bg-slate-50/60 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1">
            {[
              { id: "all", label: "All" },
              { id: "goal", label: "Goals" },
              { id: "task", label: "Tasks" },
              { id: "habit", label: "Habits" },
              { id: "journal", label: "Journal" },
              { id: "knowledge", label: "Notes" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-bold capitalize transition-all ${
                  activeFilter === f.id
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-2xs"
                    : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <span className="text-[11px] font-mono text-slate-400">
            {filteredResults.length} {filteredResults.length === 1 ? "result" : "results"}
          </span>
        </div>

        {/* Search Results List */}
        <div className="max-h-[380px] overflow-y-auto p-3 space-y-1">
          {filteredResults.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-1">
              <Sparkles className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
              <p className="text-xs font-semibold">No matching entries found</p>
              <p className="text-[11px]">Try typing another phrase or keyword.</p>
            </div>
          ) : (
            filteredResults.map((item, idx) => {
              const isSelected = selectedIndex === idx;
              const pct = item.score !== undefined ? Math.round(item.score * 100) : null;

              return (
                <div
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`p-3 rounded-2xl cursor-pointer transition-all flex items-center justify-between gap-3 ${
                    isSelected
                      ? "bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/80"
                      : "hover:bg-slate-50 dark:hover:bg-slate-900/50 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-center shrink-0">
                      {getTypeIcon(item.type)}
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-ink truncate">
                          {item.title}
                        </span>
                        <span className="text-[11px] font-mono uppercase tracking-wider px-1.5 py-0.2 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          {item.type}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted truncate max-w-[420px]">
                        {item.snippet}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {pct !== null && pct > 40 && (
                      <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50">
                        {pct}% match
                      </span>
                    )}
                    {item.isKeywordMatch && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        keyword
                      </span>
                    )}
                    {item.date && (
                      <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                        {item.date}
                      </span>
                    )}
                    {isSelected && (
                      <CornerDownLeft className="w-3.5 h-3.5 text-indigo-500 ml-1" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-5 py-2.5 bg-slate-50/70 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 bg-slate-200 dark:bg-slate-800 rounded font-bold">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-slate-200 dark:bg-slate-800 rounded font-bold">↵</kbd> jump to item
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-slate-200 dark:bg-slate-800 rounded font-bold">esc</kbd> close
            </span>
          </div>

          <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
            Semantic Vector + Keyword Engine
          </span>
        </div>
      </div>
    </DialogBackdrop>
  );
};

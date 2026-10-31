import React, { useState } from "react";
import { Goal, GoalSector, GoalTimeframe, GoalStatus } from "../types";
import { MountainHeroIllustration } from "./MountainHeroIllustration";
import confetti from "canvas-confetti";
import {
  Target,
  Plus,
  Briefcase,
  GraduationCap,
  DollarSign,
  Heart,
  Brain,
  Compass,
  Calendar,
  CheckCircle2,
  Circle,
  MoreHorizontal,
  Edit2,
  Trash2,
  Trophy,
  TrendingUp,
  Flag,
  ChevronRight,
  Search,
  Layers,
  ArrowRight,
} from "lucide-react";

interface GoalsViewProps {
  goals: Goal[];
  onAddGoal: () => void;
  onEditGoal: (goal: Goal) => void;
  onDeleteGoal: (goalId: string) => void;
  onToggleMilestone: (goalId: string, milestoneId: string) => void;
  onUpdateGoalStatus: (goalId: string, status: GoalStatus) => void;
  theme?: "light" | "dark";
}

const SECTOR_CONFIG: Record<
  GoalSector,
  { label: string; icon: any; color: string; bg: string; border: string; bar: string }
> = {
  career: {
    label: "Career & Work",
    icon: Briefcase,
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border-indigo-500/20",
    border: "border-indigo-200 dark:border-indigo-900/40",
    bar: "from-blue-600 via-indigo-600 to-purple-600",
  },
  academics: {
    label: "Academics",
    icon: GraduationCap,
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-500/10 text-purple-500 dark:text-purple-400 border-purple-500/20",
    border: "border-purple-200 dark:border-purple-900/40",
    bar: "from-purple-600 to-fuchsia-600",
  },
  finance: {
    label: "Finance & Wealth",
    icon: DollarSign,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20",
    border: "border-emerald-200 dark:border-emerald-900/40",
    bar: "from-emerald-600 to-teal-600",
  },
  health: {
    label: "Health & Fitness",
    icon: Heart,
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/20",
    border: "border-rose-200 dark:border-rose-900/40",
    bar: "from-rose-600 to-pink-600",
  },
  mindset: {
    label: "Mindset & Wisdom",
    icon: Brain,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20",
    border: "border-amber-200 dark:border-amber-900/40",
    bar: "from-amber-600 to-orange-600",
  },
  personal: {
    label: "Personal Growth",
    icon: Compass,
    color: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-500/10 text-cyan-500 dark:text-cyan-400 border-cyan-500/20",
    border: "border-cyan-200 dark:border-cyan-900/40",
    bar: "from-cyan-600 to-sky-600",
  },
};

const TIMEFRAME_LABELS: Record<GoalTimeframe, string> = {
  quarterly: "Quarterly (90d)",
  yearly: "Yearly (1y)",
  long_term: "3–5 Years",
  lifetime: "North Star",
};

export const GoalsView: React.FC<GoalsViewProps> = ({
  goals,
  onAddGoal,
  onEditGoal,
  onDeleteGoal,
  onToggleMilestone,
  onUpdateGoalStatus,
  theme = "dark",
}) => {
  const [selectedSector, setSelectedSector] = useState<GoalSector | "all">("all");
  const [selectedTimeframe, setSelectedTimeframe] = useState<GoalTimeframe | "all">("all");
  const [selectedStatus, setSelectedStatus] = useState<GoalStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMenuGoalId, setActiveMenuGoalId] = useState<string | null>(null);
  const [expandedMilestonesGoalId, setExpandedMilestonesGoalId] = useState<string | null>(null);

  // Filtered goals
  const filteredGoals = goals.filter((g) => {
    if (selectedSector !== "all" && g.sector !== selectedSector) return false;
    if (selectedTimeframe !== "all" && g.timeframe !== selectedTimeframe) return false;
    if (selectedStatus !== "all" && g.status !== selectedStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = (g.title || "").toLowerCase().includes(q);
      const matchDesc = (g.description || "").toLowerCase().includes(q);
      const matchWhy = (g.why || "").toLowerCase().includes(q);
      return matchTitle || matchDesc || matchWhy;
    }
    return true;
  });

  // Analytics computations matching the screenshot
  const totalGoals = goals.length;
  const activeGoalsCount = goals.filter((g) => g.status !== "achieved").length;
  const achievedGoals = goals.filter((g) => g.status === "achieved" || g.progress === 100).length;
  const totalMilestones = goals.reduce((acc, g) => acc + (g.milestones?.length || 0), 0);
  const completedMilestones = goals.reduce(
    (acc, g) => acc + (g.milestones?.filter((m) => m.completed).length || 0),
    0
  );
  const avgProgress =
    totalGoals > 0
      ? Math.round(goals.reduce((acc, g) => acc + (g.progress || 0), 0) / totalGoals)
      : 0;

  // Sector counts
  const sectorCounts: Record<GoalSector, number> = {
    career: goals.filter((g) => g.sector === "career").length,
    academics: goals.filter((g) => g.sector === "academics").length,
    finance: goals.filter((g) => g.sector === "finance").length,
    health: goals.filter((g) => g.sector === "health").length,
    mindset: goals.filter((g) => g.sector === "mindset").length,
    personal: goals.filter((g) => g.sector === "personal").length,
  };

  const handleMilestoneCheck = (goal: Goal, milestoneId: string) => {
    onToggleMilestone(goal.id, milestoneId);
    confetti({
      particleCount: 30,
      spread: 50,
      origin: { y: 0.7 },
    });
  };

  return (
    <div className="space-y-6 sm:space-y-7 animate-fade-in pb-16 select-none">
      {/* ========================================================= */}
      {/* 1. HERO HEADER WITH MOUNTAIN PEAK SUMMIT ARTWORK          */}
      {/* ========================================================= */}
      <div className="relative rounded-3xl p-6 sm:p-8 bg-white/90 dark:bg-[#0c0e1e]/90 border border-slate-200/80 dark:border-slate-800/80 shadow-sm overflow-hidden flex flex-col justify-between min-h-[170px] sm:min-h-[190px]">
        {/* Mountain Illustration Layer on Right */}
        <div className="absolute right-0 top-0 bottom-0 w-full sm:w-[540px] pointer-events-none opacity-90 dark:opacity-100">
          <MountainHeroIllustration theme={theme} />
        </div>

        {/* Hero Content on Left (Above Illustration) */}
        <div className="relative z-10 max-w-xl space-y-2">
          {/* Breadcrumb matching screenshot: Life Vision / Mastery */}
          <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-500 dark:text-indigo-400">
            <span>Life Vision</span>
            <span className="text-slate-400 dark:text-slate-600">/</span>
            <span>Mastery</span>
          </div>

          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
            Life Goals & Horizons
          </h1>
          <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium max-w-lg">
            Macro self-improvement across Career, Academics, Finance, Health, Mindset, and Personal Growth.
          </p>
        </div>

        {/* Top Right Floating Action: + New Life Goal */}
        <div className="relative z-10 pt-4 sm:pt-0 sm:absolute sm:top-8 sm:right-8">
          <button
            onClick={onAddGoal}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:opacity-95 text-white text-xs font-bold shadow-md shadow-indigo-500/25 hover:scale-105 active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>New Life Goal</span>
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 2. TOP METRIC CARDS ROW (4 Cards matching screenshot)     */}
      {/* ========================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Active Goals */}
        <div className="p-5 rounded-3xl bg-white dark:bg-[#121428] border border-purple-400/40 dark:border-purple-500/30 shadow-md shadow-purple-500/5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-500 dark:text-purple-400 border border-purple-500/20 flex items-center justify-center shrink-0">
                <Target className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Active Goals
              </span>
            </div>
            <button
              onClick={() => setSelectedStatus("in_progress")}
              className="w-6 h-6 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 flex items-center justify-center transition-colors"
              title="Filter by Active Goals"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-3">
            <div className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
              {activeGoalsCount}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Across 6 life sectors</p>
          </div>
        </div>

        {/* Card 2: Avg Progress */}
        <div className="p-5 rounded-3xl bg-white dark:bg-[#101824] border border-slate-200/80 dark:border-emerald-500/20 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Avg Progress
              </span>
            </div>
            <button
              onClick={() => setSelectedStatus("all")}
              className="w-6 h-6 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 flex items-center justify-center transition-colors"
              title="View all progress"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-3">
            <div className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
              {avgProgress}%
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${avgProgress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Card 3: Milestones Met */}
        <div className="p-5 rounded-3xl bg-white dark:bg-[#10162a] border border-slate-200/80 dark:border-blue-500/20 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-500 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
                <Flag className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Milestones Met
              </span>
            </div>
            <button
              onClick={() => {}}
              className="w-6 h-6 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 flex items-center justify-center transition-colors"
              title="Stepping stones completed"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-3">
            <div className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
              {completedMilestones}{" "}
              <span className="text-base font-normal text-slate-400">/ {totalMilestones}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Stepping stones completed</p>
          </div>
        </div>

        {/* Card 4: Achieved */}
        <div className="p-5 rounded-3xl bg-white dark:bg-[#181622] border border-slate-200/80 dark:border-amber-500/20 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20 flex items-center justify-center shrink-0">
                <Trophy className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Achieved
              </span>
            </div>
            <button
              onClick={() => setSelectedStatus("achieved")}
              className="w-6 h-6 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 flex items-center justify-center transition-colors"
              title="Filter Achieved Goals"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-3">
            <div className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
              {achievedGoals}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Major life summits reached</p>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 3. SECTOR FILTER PILLS ROW (Horizontal selector)          */}
      {/* ========================================================= */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        {/* All Sectors Pill */}
        <button
          onClick={() => setSelectedSector("all")}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all shrink-0 ${
            selectedSector === "all"
              ? "bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/20"
              : "bg-slate-100 hover:bg-slate-200 dark:bg-[#141628] dark:hover:bg-[#1c1f38] text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-800"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>All Sectors ({goals.length})</span>
        </button>

        {/* Individual Sector Pills */}
        {(Object.keys(SECTOR_CONFIG) as GoalSector[]).map((sec) => {
          const cfg = SECTOR_CONFIG[sec];
          const Icon = cfg.icon;
          const count = sectorCounts[sec];
          const isSelected = selectedSector === sec;

          return (
            <button
              key={sec}
              onClick={() => setSelectedSector(sec)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-bold transition-all shrink-0 ${
                isSelected
                  ? "bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/20"
                  : "bg-slate-100 hover:bg-slate-200 dark:bg-[#141628] dark:hover:bg-[#1c1f38] text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-800"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>
                {cfg.label} ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* ========================================================= */}
      {/* 4. TIMEFRAME HORIZONS & SEARCH / STATUS BAR               */}
      {/* ========================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        {/* Left: Timeframe Horizons */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <button
            onClick={() => setSelectedTimeframe("all")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors shrink-0 ${
              selectedTimeframe === "all"
                ? "bg-slate-200 text-slate-900 dark:bg-[#1c1f38] dark:text-white"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            All Horizons
          </button>
          {(Object.keys(TIMEFRAME_LABELS) as GoalTimeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setSelectedTimeframe(tf)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors shrink-0 ${
                selectedTimeframe === tf
                  ? "bg-slate-200 text-slate-900 dark:bg-[#1c1f38] dark:text-white font-bold"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              {TIMEFRAME_LABELS[tf]}
            </button>
          ))}
        </div>

        {/* Right: Search & Status Dropdown */}
        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="flex items-center bg-slate-100 dark:bg-[#111324] border border-slate-200/80 dark:border-slate-800 rounded-full px-3 py-1.5 text-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />
            <input
              type="text"
              placeholder="Search goals..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent focus:outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400 w-28 sm:w-36 text-xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-slate-400 hover:text-slate-200 ml-1 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Status Dropdown */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#111324] border border-slate-200/80 dark:border-slate-800 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>Status:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as any)}
              className="bg-transparent focus:outline-none text-slate-800 dark:text-slate-200 font-bold cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="in_progress">In Progress</option>
              <option value="achieved">Achieved</option>
              <option value="not_started">Not Started</option>
              <option value="on_hold">On Hold</option>
            </select>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 5. GOALS GRID & NEW GOAL CARD (Matching screenshot)       */}
      {/* ========================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Render Filtered Goals */}
        {filteredGoals.map((goal) => {
          const cfg = SECTOR_CONFIG[goal.sector] || SECTOR_CONFIG.career;
          const SectorIcon = cfg.icon;
          const milestones = goal.milestones || [];
          const completedCount = milestones.filter((m) => m.completed).length;
          const isExpanded = expandedMilestonesGoalId === goal.id;

          return (
            <div
              key={goal.id}
              className="group relative flex flex-col justify-between p-6 rounded-3xl bg-white dark:bg-[#121424] border border-slate-200/80 dark:border-[#232646] hover:border-indigo-500/40 hover:shadow-lg transition-all min-h-[220px]"
            >
              <div>
                {/* Top Row: Sector Badge + Horizon Badge + Progress + Options */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {/* Sector Badge */}
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/20">
                      <SectorIcon className="w-3.5 h-3.5" />
                      <span>{cfg.label}</span>
                    </span>

                    {/* Horizon Badge */}
                    <span className="px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300">
                      {TIMEFRAME_LABELS[goal.timeframe]}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black font-mono text-slate-500 dark:text-slate-400">
                      {goal.progress}%
                    </span>

                    <div className="relative">
                      <button
                        onClick={() =>
                          setActiveMenuGoalId(activeMenuGoalId === goal.id ? null : goal.id)
                        }
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>

                      {activeMenuGoalId === goal.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 mt-1 w-44 bg-white dark:bg-[#1a1e2d] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-1 z-30 flex flex-col gap-0.5 text-xs font-semibold animate-fade-in"
                        >
                          <button
                            onClick={() => {
                              setActiveMenuGoalId(null);
                              onEditGoal(goal);
                            }}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-left"
                          >
                            <Edit2 className="w-3.5 h-3.5 text-slate-400" />
                            <span>Edit Goal</span>
                          </button>
                          <button
                            onClick={() => {
                              setActiveMenuGoalId(null);
                              onUpdateGoalStatus(
                                goal.id,
                                goal.status === "achieved" ? "in_progress" : "achieved"
                              );
                            }}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-left"
                          >
                            <Trophy className="w-3.5 h-3.5 text-amber-500" />
                            <span>
                              {goal.status === "achieved" ? "Mark In Progress" : "Mark Achieved"}
                            </span>
                          </button>
                          <button
                            onClick={() => {
                              setActiveMenuGoalId(null);
                              if (confirm(`Delete goal "${goal.title}"?`)) {
                                onDeleteGoal(goal.id);
                              }
                            }}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-500 text-left"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Title */}
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mt-3.5 mb-1.5 leading-snug group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  {goal.title}
                </h3>

                {/* Description */}
                {goal.description && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-normal mb-3 line-clamp-2">
                    {goal.description}
                  </p>
                )}

                {/* Progress Bar and Labels matching screenshot */}
                <div className="space-y-1.5 mt-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                    <span>Progress</span>
                    <span>
                      {completedCount} of {milestones.length} milestones ({goal.progress}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800/80 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 h-full rounded-full transition-all duration-500 shadow-[0_0_12px_rgba(168,85,247,0.5)]"
                      style={{ width: `${goal.progress}%` }}
                    />
                  </div>
                </div>

                {/* Expandable Milestones Stepping Stones */}
                {isExpanded && milestones.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-2 animate-fade-in">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                      Stepping Stones / Milestones
                    </div>
                    {milestones.map((m) => (
                      <div
                        key={m.id}
                        onClick={() => handleMilestoneCheck(goal, m.id)}
                        className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                      >
                        {m.completed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : (
                          <Circle className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <span
                          className={`text-xs ${
                            m.completed
                              ? "line-through text-slate-400"
                              : "text-slate-800 dark:text-slate-200 font-medium"
                          }`}
                        >
                          {m.title}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom Row: Created Date + Manage -> Button */}
              <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>
                    Created{" "}
                    {new Date(goal.createdAt).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {milestones.length > 0 && (
                    <button
                      onClick={() =>
                        setExpandedMilestonesGoalId(isExpanded ? null : goal.id)
                      }
                      className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    >
                      {isExpanded ? "Hide" : `Milestones (${milestones.length})`}
                    </button>
                  )}
                  <button
                    onClick={() => onEditGoal(goal)}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#201d42] hover:bg-[#2b2759] border border-indigo-500/30 text-indigo-300 font-bold text-xs shadow-xs hover:scale-105 transition-all"
                  >
                    <span>Manage</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Create a New Life Goal Card (Matching right slot in screenshot) */}
        <div
          onClick={onAddGoal}
          className="group relative flex flex-col items-center justify-center p-8 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-indigo-500/50 bg-slate-50/30 dark:bg-slate-900/10 cursor-pointer min-h-[220px] transition-all hover:scale-[1.01]"
        >
          <div className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 flex items-center justify-center text-slate-600 dark:text-slate-300 group-hover:bg-gradient-to-tr group-hover:from-blue-600 group-hover:to-purple-600 group-hover:text-white group-hover:border-transparent group-hover:scale-110 shadow-sm transition-all mb-3">
            <Plus className="w-5 h-5 stroke-[2.5]" />
          </div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1 group-hover:text-indigo-500 transition-colors">
            Create a new life goal
          </h4>
          <p className="text-xs text-slate-400 text-center max-w-[220px]">
            Set a goal, add milestones, and track your progress.
          </p>
        </div>
      </div>
    </div>
  );
};

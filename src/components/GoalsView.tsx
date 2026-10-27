import React, { useState } from "react";
import { Goal, GoalSector, GoalTimeframe, GoalStatus } from "../types";
import confetti from "canvas-confetti";
import {
  Target,
  Plus,
  Briefcase,
  GraduationCap,
  DollarSign,
  HeartPulse,
  Brain,
  Compass,
  Calendar,
  CheckCircle2,
  Circle,
  MoreVertical,
  Edit2,
  Trash2,
  Trophy,
  TrendingUp,
  ArrowUpRight,
} from "lucide-react";

interface GoalsViewProps {
  goals: Goal[];
  onAddGoal: () => void;
  onEditGoal: (goal: Goal) => void;
  onDeleteGoal: (goalId: string) => void;
  onToggleMilestone: (goalId: string, milestoneId: string) => void;
  onUpdateGoalStatus: (goalId: string, status: GoalStatus) => void;
}

const SECTOR_CONFIG: Record<
  GoalSector,
  { label: string; icon: any; color: string; bg: string; border: string; bar: string }
> = {
  career: {
    label: "Career & Work",
    icon: Briefcase,
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-50 dark:bg-indigo-950/40",
    border: "border-indigo-200 dark:border-indigo-900/40",
    bar: "from-indigo-500 to-blue-500",
  },
  academics: {
    label: "Academics",
    icon: GraduationCap,
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-50 dark:bg-purple-950/40",
    border: "border-purple-200 dark:border-purple-900/40",
    bar: "from-purple-500 to-fuchsia-500",
  },
  finance: {
    label: "Finance & Wealth",
    icon: DollarSign,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    border: "border-emerald-200 dark:border-emerald-900/40",
    bar: "from-emerald-500 to-teal-500",
  },
  health: {
    label: "Health & Fitness",
    icon: HeartPulse,
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-50 dark:bg-rose-950/40",
    border: "border-rose-200 dark:border-rose-900/40",
    bar: "from-rose-500 to-pink-500",
  },
  mindset: {
    label: "Mindset & Wisdom",
    icon: Brain,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-200 dark:border-amber-900/40",
    bar: "from-amber-500 to-orange-500",
  },
  personal: {
    label: "Personal Growth",
    icon: Compass,
    color: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-50 dark:bg-cyan-950/40",
    border: "border-cyan-200 dark:border-cyan-900/40",
    bar: "from-cyan-500 to-sky-500",
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
}) => {
  const [selectedSector, setSelectedSector] = useState<GoalSector | "all">("all");
  const [selectedTimeframe, setSelectedTimeframe] = useState<GoalTimeframe | "all">("all");
  const [selectedStatus, setSelectedStatus] = useState<GoalStatus | "all">("all");
  const [activeMenuGoalId, setActiveMenuGoalId] = useState<string | null>(null);

  // Filtered goals
  const filteredGoals = goals.filter((g) => {
    if (selectedSector !== "all" && g.sector !== selectedSector) return false;
    if (selectedTimeframe !== "all" && g.timeframe !== selectedTimeframe) return false;
    if (selectedStatus !== "all" && g.status !== selectedStatus) return false;
    return true;
  });

  // Analytics
  const totalGoals = goals.length;
  const achievedGoals = goals.filter((g) => g.status === "achieved" || g.progress === 100).length;
  const totalMilestones = goals.reduce((acc, g) => acc + (g.milestones?.length || 0), 0);
  const completedMilestones = goals.reduce(
    (acc, g) => acc + (g.milestones?.filter((m) => m.completed).length || 0),
    0
  );
  const avgProgress = totalGoals > 0
    ? Math.round(goals.reduce((acc, g) => acc + (g.progress || 0), 0) / totalGoals)
    : 0;

  const handleMilestoneCheck = (goal: Goal, milestoneId: string) => {
    onToggleMilestone(goal.id, milestoneId);
    
    // Check if this was the last milestone needed
    const remaining = (goal.milestones || []).filter((m) => !m.completed && m.id !== milestoneId).length;
    const targetMilestone = (goal.milestones || []).find((m) => m.id === milestoneId);
    if (targetMilestone && !targetMilestone.completed && remaining === 0) {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
      });
    } else {
      confetti({
        particleCount: 25,
        spread: 45,
        origin: { y: 0.7 },
      });
    }
  };

  return (
    <div className="space-y-8 animate-fade-in pb-16">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/60 dark:border-slate-800/60">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
              [life.vision // mastery]
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
            <span className="text-[10px] font-mono text-slate-400">Self-Improvement Horizons</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            Life Goals & Horizons
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Macro self-improvement across Career, Academics, Finance, Health, Mindset, and Personal Growth.
          </p>
        </div>

        <button
          onClick={onAddGoal}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md hover:scale-102 active:scale-98 transition-all cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Life Goal</span>
        </button>
      </div>

      {/* Analytics Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-3xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800/70 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-xs font-bold uppercase tracking-wider">Active Goals</span>
            <Target className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {totalGoals}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Across 6 life sectors
          </div>
        </div>

        <div className="p-4 rounded-3xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800/70 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-xs font-bold uppercase tracking-wider">Avg Progress</span>
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {avgProgress}%
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${avgProgress}%` }}
            />
          </div>
        </div>

        <div className="p-4 rounded-3xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800/70 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-xs font-bold uppercase tracking-wider">Milestones Met</span>
            <CheckCircle2 className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {completedMilestones} <span className="text-sm font-normal text-slate-400">/ {totalMilestones}</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Stepping stones completed
          </div>
        </div>

        <div className="p-4 rounded-3xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800/70 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-xs font-bold uppercase tracking-wider">Achieved</span>
            <Trophy className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {achievedGoals}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Major life summits reached
          </div>
        </div>
      </div>

      {/* Filter and Tab Controls */}
      <div className="space-y-3">
        {/* Sector Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <button
            onClick={() => setSelectedSector("all")}
            className={`px-3.5 py-1.5 rounded-2xl text-xs font-bold transition-all shrink-0 ${
              selectedSector === "all"
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs"
                : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
            }`}
          >
            All Sectors ({goals.length})
          </button>
          {(Object.keys(SECTOR_CONFIG) as GoalSector[]).map((sec) => {
            const cfg = SECTOR_CONFIG[sec];
            const count = goals.filter((g) => g.sector === sec).length;
            const isSelected = selectedSector === sec;
            const Icon = cfg.icon;
            return (
              <button
                key={sec}
                onClick={() => setSelectedSector(sec)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-2xl text-xs font-bold transition-all shrink-0 ${
                  isSelected
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{cfg.label}</span>
                <span className="opacity-70 text-[10px]">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Timeframe & Status Subfilters */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-2xl">
            {(["all", "quarterly", "yearly", "long_term", "lifetime"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setSelectedTimeframe(tf)}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all ${
                  selectedTimeframe === tf
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                {tf === "all" ? "All Horizons" : TIMEFRAME_LABELS[tf]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as any)}
              className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 text-[11px] font-semibold text-slate-800 dark:text-slate-200 focus:outline-none"
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

      {/* Goals Grid */}
      {filteredGoals.length === 0 ? (
        <div className="p-12 text-center rounded-3xl bg-slate-50 dark:bg-slate-900/40 border border-dashed border-slate-200 dark:border-slate-800">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-500 flex items-center justify-center mx-auto mb-3">
            <Target className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800 dark:text-white">No goals found</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {selectedSector !== "all" || selectedTimeframe !== "all"
              ? "Try adjusting your sector or timeframe filters to reveal other long-term goals."
              : "Capture your first major life aspiration, target metrics, and actionable milestones."}
          </p>
          <button
            onClick={onAddGoal}
            className="mt-4 px-4 py-2 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Set New Life Goal</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filteredGoals.map((goal) => {
            const sectorCfg = SECTOR_CONFIG[goal.sector] || SECTOR_CONFIG.career;
            const SectorIcon = sectorCfg.icon;
            const milestones = goal.milestones || [];
            const completedCount = milestones.filter((m) => m.completed).length;
            const isAchieved = goal.status === "achieved" || goal.progress === 100;

            return (
              <div
                key={goal.id}
                className="group relative flex flex-col justify-between p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs hover:shadow-md transition-all duration-200"
              >
                <div>
                  {/* Top Header Badge Row */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold ${sectorCfg.bg} ${sectorCfg.color}`}>
                        <SectorIcon className="w-3.5 h-3.5" />
                        <span>{sectorCfg.label}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                        {TIMEFRAME_LABELS[goal.timeframe]}
                      </span>
                    </div>

                    <div className="relative flex items-center gap-1">
                      {isAchieved ? (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                          <Trophy className="w-3 h-3" />
                          <span>Achieved</span>
                        </span>
                      ) : (
                        <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                          {goal.progress}%
                        </span>
                      )}

                      <div className="relative">
                        <button
                          onClick={() => setActiveMenuGoalId(activeMenuGoalId === goal.id ? null : goal.id)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {activeMenuGoalId === goal.id && (
                          <div className="absolute right-0 top-8 z-30 w-36 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl animate-fade-in">
                            <button
                              onClick={() => {
                                setActiveMenuGoalId(null);
                                onEditGoal(goal);
                              }}
                              className="w-full px-3 py-1.5 text-left text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>Edit Goal</span>
                            </button>
                            <button
                              onClick={() => {
                                setActiveMenuGoalId(null);
                                onUpdateGoalStatus(goal.id, isAchieved ? "in_progress" : "achieved");
                              }}
                              className="w-full px-3 py-1.5 text-left text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2"
                            >
                              <Trophy className="w-3.5 h-3.5 text-amber-500" />
                              <span>{isAchieved ? "Mark In Progress" : "Mark Achieved"}</span>
                            </button>
                            <button
                              onClick={() => {
                                setActiveMenuGoalId(null);
                                onDeleteGoal(goal.id);
                              }}
                              className="w-full px-3 py-1.5 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete Goal</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Goal Title */}
                  <h3 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
                    {goal.title}
                  </h3>

                  {/* Core "Why" Anchor Callout */}
                  {goal.why && (
                    <div className="mt-2.5 p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 italic leading-relaxed">
                      <span className="font-bold not-italic text-slate-400 dark:text-slate-500 mr-1.5 text-[10px] uppercase tracking-wider">
                        Conviction:
                      </span>
                      "{goal.why}"
                    </div>
                  )}

                  {/* Target Metrics & Target Date */}
                  <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
                    {goal.metrics && (
                      <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                        <Target className="w-3.5 h-3.5 text-indigo-500" />
                        <span>{goal.metrics}</span>
                      </div>
                    )}

                    {goal.targetDate && (
                      <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-medium">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>Target: {goal.targetDate}</span>
                      </div>
                    )}
                  </div>

                  {/* Animated Progress Bar */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5 font-medium">
                      <span>Progress</span>
                      <span>{completedCount} of {milestones.length} milestones ({goal.progress}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${sectorCfg.bar} transition-all duration-500`}
                        style={{ width: `${Math.max(goal.progress, 4)}%` }}
                      />
                    </div>
                  </div>

                  {/* Milestones Checklist */}
                  {milestones.length > 0 && (
                    <div className="mt-4 space-y-1.5">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Key Milestones
                      </div>
                      <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                        {milestones.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => handleMilestoneCheck(goal, m.id)}
                            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 text-left transition-colors group/item"
                          >
                            {m.completed ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : (
                              <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover/item:text-slate-400 shrink-0" />
                            )}
                            <span
                              className={`text-xs ${
                                m.completed
                                  ? "line-through text-slate-400 dark:text-slate-500"
                                  : "text-slate-700 dark:text-slate-200 font-medium"
                              }`}
                            >
                              {m.title}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Quick Action Footer */}
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-[10px] text-slate-400">
                    Created {new Date(goal.createdAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                  <button
                    onClick={() => onEditGoal(goal)}
                    className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                  >
                    <span>Manage</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

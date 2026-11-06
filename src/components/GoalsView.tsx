import { PageHeading } from "./workspace/PageHeading";
import React, { useState } from "react";
import { Goal, GoalSector, GoalTimeframe, GoalStatus } from "../types";

import {
  Plus,
  Briefcase,
  GraduationCap,
  DollarSign,
  Heart,
  Brain,
  Compass,
  CheckCircle2,
  Circle,
  MoreHorizontal,
  Edit2,
  Trash2,
  Trophy,
  Search,
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

const SECTOR_CONFIG: Record<GoalSector, { label: string; icon: any }> = {
  career: { label: "Career", icon: Briefcase },
  academics: { label: "Academics", icon: GraduationCap },
  finance: { label: "Finance", icon: DollarSign },
  health: { label: "Health", icon: Heart },
  mindset: { label: "Mindset", icon: Brain },
  personal: { label: "Personal", icon: Compass },
};

const TIMEFRAME_LABELS: Record<GoalTimeframe, string> = {
  quarterly: "This quarter",
  yearly: "This year",
  long_term: "3–5 years",
  lifetime: "Lifetime",
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
  };

  const stats = [
    { label: "Active goals", value: String(activeGoalsCount), onClick: () => setSelectedStatus("in_progress") },
    { label: "Average progress", value: `${avgProgress}%`, onClick: () => setSelectedStatus("all") },
    { label: "Milestones done", value: `${completedMilestones} of ${totalMilestones}`, onClick: undefined },
    { label: "Achieved", value: String(achievedGoals), onClick: () => setSelectedStatus("achieved") },
  ];
  return (
    <div className="goals-page">
      <PageHeading title="Goals" description="Longer-term direction, broken into milestones you can check off">
        <button className="workspace-primary" onClick={onAddGoal}><Plus size={16} strokeWidth={1.5} />New goal</button>
      </PageHeading>

      <div className="stat-strip">
        {stats.map((stat) => (
          <button key={stat.label} onClick={stat.onClick} disabled={!stat.onClick}>
            <small>{stat.label}</small>
            <span className="figure">{stat.value}</span>
          </button>
        ))}
      </div>

      <div className="goal-toolbar">
        <div className="segmented" role="tablist" aria-label="Sector">
          <button role="tab" aria-selected={selectedSector === "all"} onClick={() => setSelectedSector("all")}>
            All <span className="meta">{goals.length}</span>
          </button>
          {(Object.keys(SECTOR_CONFIG) as GoalSector[]).map((sec) => (
            <button key={sec} role="tab" aria-selected={selectedSector === sec} onClick={() => setSelectedSector(sec)}>
              {SECTOR_CONFIG[sec].label} <span className="meta">{sectorCounts[sec]}</span>
            </button>
          ))}
        </div>
        <div className="goal-filter-controls">
          <label className="field-search">
            <Search size={16} strokeWidth={1.5} />
            <input type="text" placeholder="Search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} aria-label="Search goals" />
          </label>
          <select className="field-select" value={selectedTimeframe} onChange={(e) => setSelectedTimeframe(e.target.value as any)} aria-label="Timeframe">
            <option value="all">Any timeframe</option>
            {(Object.keys(TIMEFRAME_LABELS) as GoalTimeframe[]).map((tf) => <option key={tf} value={tf}>{TIMEFRAME_LABELS[tf]}</option>)}
          </select>
          <select className="field-select" value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value as any)} aria-label="Status">
            <option value="all">Any status</option>
            <option value="in_progress">In progress</option>
            <option value="achieved">Achieved</option>
            <option value="not_started">Not started</option>
            <option value="on_hold">On hold</option>
          </select>
        </div>
      </div>

      <div className="goal-grid">
        {filteredGoals.map((goal) => {
          const cfg = SECTOR_CONFIG[goal.sector] || SECTOR_CONFIG.career;
          const SectorIcon = cfg.icon;
          const milestones = goal.milestones || [];
          const completedCount = milestones.filter((m) => m.completed).length;
          const isExpanded = expandedMilestonesGoalId === goal.id;
          return (
            <article key={goal.id} className="goal-card">
              <header className="goal-card-top">
                <span className="goal-sector"><SectorIcon size={14} strokeWidth={1.5} />{cfg.label} · {TIMEFRAME_LABELS[goal.timeframe]}</span>
                <div className="goal-menu">
                  <button className="icon-control" aria-label={`Options for ${goal.title}`} onClick={() => setActiveMenuGoalId(activeMenuGoalId === goal.id ? null : goal.id)}>
                    <MoreHorizontal size={16} strokeWidth={1.5} />
                  </button>
                  {activeMenuGoalId === goal.id && (
                    <div className="menu" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setActiveMenuGoalId(null); onEditGoal(goal); }}><Edit2 size={16} strokeWidth={1.5} />Edit</button>
                      <button onClick={() => { setActiveMenuGoalId(null); onUpdateGoalStatus(goal.id, goal.status === "achieved" ? "in_progress" : "achieved"); }}>
                        <Trophy size={16} strokeWidth={1.5} />{goal.status === "achieved" ? "Mark in progress" : "Mark achieved"}
                      </button>
                      <button className="is-danger" onClick={() => { setActiveMenuGoalId(null); if (confirm(`Delete goal "${goal.title}"?`)) onDeleteGoal(goal.id); }}>
                        <Trash2 size={16} strokeWidth={1.5} />Delete
                      </button>
                    </div>
                  )}
                </div>
              </header>
              <h3>{goal.title}</h3>
              {goal.description && <p className="goal-description">{goal.description}</p>}
              <div className="goal-progress">
                <span className="progress-track"><i style={{ width: `${Math.min(100, Math.max(0, goal.progress))}%` }} /></span>
                <span className="meta">{goal.progress}%</span>
              </div>
              {isExpanded && milestones.length > 0 && (
                <ul className="goal-milestones">
                  {milestones.map((m) => (
                    <li key={m.id}>
                      <button className={m.completed ? "is-done" : ""} onClick={() => handleMilestoneCheck(goal, m.id)} aria-pressed={m.completed}>
                        {m.completed ? <CheckCircle2 size={16} strokeWidth={1.5} /> : <Circle size={16} strokeWidth={1.5} />}
                        <span>{m.title}</span>
                        {m.targetDate && <span className="date-stamp">{new Date(`${m.targetDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <footer className="goal-card-bottom">
                <span className="meta">
                  {goal.targetDate ? `Due ${new Date(`${goal.targetDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })}` : `Since ${new Date(goal.createdAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })}`}
                </span>
                <div className="goal-actions">
                  {milestones.length > 0 && (
                    <button className="text-action is-quiet" onClick={() => setExpandedMilestonesGoalId(isExpanded ? null : goal.id)}>
                      {isExpanded ? "Hide milestones" : `${completedCount} of ${milestones.length} milestones`}
                    </button>
                  )}
                  <button className="text-action" onClick={() => onEditGoal(goal)}>Open<ArrowRight size={14} strokeWidth={1.5} /></button>
                </div>
              </footer>
            </article>
          );
        })}
        <button className="goal-new" onClick={onAddGoal}>
          <Plus size={16} strokeWidth={1.5} />
          <strong>New goal</strong>
          <span>Set a direction, add milestones and track progress</span>
        </button>
      </div>
    </div>
  );
};

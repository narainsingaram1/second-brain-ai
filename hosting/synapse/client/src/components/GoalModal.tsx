import React, { useState, useEffect } from "react";
import { Goal, GoalSector, GoalTimeframe, GoalStatus, GoalMilestone } from "../types";
import { breakdownGoalWithAI } from "../services/openrouter";
import {
  X,
  Target,
  Sparkles,
  Briefcase,
  GraduationCap,
  DollarSign,
  HeartPulse,
  Brain,
  Compass,
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
} from "lucide-react";

interface GoalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (goal: Goal) => void;
  editingGoal?: Goal | null;
  openRouterKey?: string;
  selectedModel?: string;
}

const SECTORS: { id: GoalSector; label: string; icon: any; color: string; bg: string }[] = [
  { id: "career", label: "Career & Work", icon: Briefcase, color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-50 dark:bg-indigo-950/40" },
  { id: "academics", label: "Academics", icon: GraduationCap, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/40" },
  { id: "finance", label: "Finance & Wealth", icon: DollarSign, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40" },
  { id: "health", label: "Health & Fitness", icon: HeartPulse, color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-950/40" },
  { id: "mindset", label: "Mindset & Wisdom", icon: Brain, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/40" },
  { id: "personal", label: "Personal & Life", icon: Compass, color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-50 dark:bg-cyan-950/40" },
];

const TIMEFRAMES: { id: GoalTimeframe; label: string; desc: string }[] = [
  { id: "quarterly", label: "Quarterly", desc: "90 days" },
  { id: "yearly", label: "Yearly", desc: "1 year" },
  { id: "long_term", label: "3–5 Years", desc: "Medium-term" },
  { id: "lifetime", label: "Lifetime", desc: "North Star" },
];

export const GoalModal: React.FC<GoalModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingGoal,
  openRouterKey,
  selectedModel,
}) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sector, setSector] = useState<GoalSector>("career");
  const [timeframe, setTimeframe] = useState<GoalTimeframe>("yearly");
  const [targetDate, setTargetDate] = useState("");
  const [metrics, setMetrics] = useState("");
  const [why, setWhy] = useState("");
  const [status, setStatus] = useState<GoalStatus>("in_progress");
  const [milestones, setMilestones] = useState<GoalMilestone[]>([]);
  const [newMilestoneText, setNewMilestoneText] = useState("");
  const [isBreakingDown, setIsBreakingDown] = useState(false);
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);

  useEffect(() => {
    if (editingGoal) {
      setTitle(editingGoal.title);
      setDescription(editingGoal.description || "");
      setSector(editingGoal.sector || "career");
      setTimeframe(editingGoal.timeframe || "yearly");
      setTargetDate(editingGoal.targetDate || "");
      setMetrics(editingGoal.metrics || "");
      setWhy(editingGoal.why || "");
      setStatus(editingGoal.status || "in_progress");
      setMilestones(editingGoal.milestones || []);
      setAiAdvice(null);
    } else {
      setTitle("");
      setDescription("");
      setSector("career");
      setTimeframe("yearly");
      setTargetDate("");
      setMetrics("");
      setWhy("");
      setStatus("in_progress");
      setMilestones([]);
      setAiAdvice(null);
    }
  }, [editingGoal, isOpen]);

  if (!isOpen) return null;

  const handleAddMilestone = () => {
    if (!newMilestoneText.trim()) return;
    setMilestones((prev) => [
      ...prev,
      {
        id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: newMilestoneText.trim(),
        completed: false,
      },
    ]);
    setNewMilestoneText("");
  };

  const handleToggleMilestone = (id: string) => {
    setMilestones((prev) =>
      prev.map((m) => (m.id === id ? { ...m, completed: !m.completed } : m))
    );
  };

  const handleDeleteMilestone = (id: string) => {
    setMilestones((prev) => prev.filter((m) => m.id !== id));
  };

  const handleAIBreakdown = async () => {
    if (!title.trim()) return;
    setIsBreakingDown(true);
    setAiAdvice(null);
    try {
      const res = await breakdownGoalWithAI(
        title,
        sector,
        timeframe,
        why,
        openRouterKey,
        selectedModel
      );
      if (res.milestones && res.milestones.length > 0) {
        const generated = res.milestones.map((mText, idx) => ({
          id: `m-ai-${Date.now()}-${idx}`,
          title: mText,
          completed: false,
        }));
        setMilestones((prev) => [...prev, ...generated]);
      }
      if (res.metrics && !metrics) {
        setMetrics(res.metrics);
      }
      if (res.advice) {
        setAiAdvice(res.advice);
      }
    } catch (e) {
      console.error("AI breakdown failed", e);
    } finally {
      setIsBreakingDown(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const completedMilestones = milestones.filter((m) => m.completed).length;
    const progress = milestones.length > 0
      ? Math.round((completedMilestones / milestones.length) * 100)
      : (status === "achieved" ? 100 : 0);

    const goalToSave: Goal = {
      id: editingGoal ? editingGoal.id : `goal-${Date.now()}`,
      title: title.trim(),
      description: description.trim() || undefined,
      sector,
      timeframe,
      targetDate: targetDate || undefined,
      metrics: metrics.trim() || undefined,
      why: why.trim() || undefined,
      status: progress === 100 ? "achieved" : status,
      milestones,
      progress,
      createdAt: editingGoal ? editingGoal.createdAt : new Date().toISOString(),
    };

    onSave(goalToSave);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-2xs">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {editingGoal ? "Edit Life Goal" : "New Life Goal"}
              </h2>
              <p className="text-xs text-slate-400">
                Define your long-term aspiration, milestones & conviction
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Goal Title */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
              Goal Title <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Master Distributed Systems & Land Staff SWE Role"
                className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 text-sm font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleAIBreakdown}
                disabled={!title.trim() || isBreakingDown}
                title="Use AI to generate milestones, metrics & coaching advice"
                className="absolute right-2 top-2 px-3 py-1 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-2xs hover:scale-102 active:scale-98 disabled:opacity-40 transition-all cursor-pointer"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isBreakingDown ? "animate-spin" : ""}`} />
                <span>{isBreakingDown ? "Generating..." : "AI Breakdown"}</span>
              </button>
            </div>
          </div>

          {/* Sector Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider">
              Life Sector
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SECTORS.map((s) => {
                const Icon = s.icon;
                const isSelected = sector === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSector(s.id)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-2xl text-xs font-bold transition-all border ${
                      isSelected
                        ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 ring-2 ring-indigo-500/20"
                        : "border-slate-200/70 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700"
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-lg ${s.bg} ${s.color} flex items-center justify-center shrink-0`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="truncate">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Timeframe & Target Date Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                Time Horizon
              </label>
              <div className="grid grid-cols-2 gap-1.5 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-2xl">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.id}
                    type="button"
                    onClick={() => setTimeframe(tf.id)}
                    className={`py-1.5 px-2 rounded-xl text-xs font-bold transition-all ${
                      timeframe === tf.id
                        ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    <div>{tf.label}</div>
                    <div className="text-[10px] font-normal text-slate-400">{tf.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                Target Date
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              <div className="mt-3">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 uppercase tracking-wider">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as GoalStatus)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none"
                >
                  <option value="not_started">Not Started</option>
                  <option value="in_progress">In Progress</option>
                  <option value="achieved">Achieved / Completed</option>
                  <option value="on_hold">On Hold</option>
                </select>
              </div>
            </div>
          </div>

          {/* Target Metrics */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider flex items-center justify-between">
              <span>Target Metric (Measurable Result)</span>
              <span className="text-[10px] text-slate-400 font-normal">How you know you won</span>
            </label>
            <input
              type="text"
              value={metrics}
              onChange={(e) => setMetrics(e.target.value)}
              placeholder="e.g. $100,000 liquid capital, 4.0 GPA, sub-1:45 half marathon"
              className="w-full px-4 py-2 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>

          {/* "Why This Matters" Conviction */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider flex items-center justify-between">
              <span>Why This Matters (Core Conviction)</span>
              <span className="text-[10px] text-indigo-500 font-semibold">Self-Improvement Anchor</span>
            </label>
            <textarea
              rows={2}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder="Why are you striving towards this? What profound change does achieving this create in your life?"
              className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 resize-none leading-relaxed"
            />
          </div>

          {/* AI Advice Banner (if generated) */}
          {aiAdvice && (
            <div className="p-3.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
              <div className="text-xs text-indigo-900 dark:text-indigo-200 leading-relaxed">
                <span className="font-bold">Strategic Insight: </span>
                {aiAdvice}
              </div>
            </div>
          )}

          {/* Milestones Checklist */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Milestones & Stepping Stones ({milestones.filter((m) => m.completed).length}/{milestones.length})
              </label>
              {milestones.length > 0 && (
                <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                  {Math.round((milestones.filter((m) => m.completed).length / milestones.length) * 100)}% Complete
                </span>
              )}
            </div>

            {/* Existing Milestones List */}
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {milestones.map((milestone) => (
                <div
                  key={milestone.id}
                  className="flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800 group hover:border-slate-300 dark:hover:border-slate-700 transition-all"
                >
                  <button
                    type="button"
                    onClick={() => handleToggleMilestone(milestone.id)}
                    className="flex items-center gap-2.5 flex-1 text-left"
                  >
                    {milestone.completed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
                    )}
                    <span
                      className={`text-xs ${
                        milestone.completed
                          ? "line-through text-slate-400 dark:text-slate-500"
                          : "text-slate-800 dark:text-slate-200 font-medium"
                      }`}
                    >
                      {milestone.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteMilestone(milestone.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 transition-opacity"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Milestone Input */}
            <div className="flex gap-2 mt-2.5">
              <input
                type="text"
                value={newMilestoneText}
                onChange={(e) => setNewMilestoneText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddMilestone();
                  }
                }}
                placeholder="Add actionable stepping stone milestone..."
                className="flex-1 px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
              <button
                type="button"
                onClick={handleAddMilestone}
                className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800/80">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md hover:scale-102 active:scale-98 transition-all"
            >
              {editingGoal ? "Save Changes" : "Create Goal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

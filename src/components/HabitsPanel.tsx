import React from "react";
import { Habit } from "../types";
import { Flame, Check, Plus, Sparkles, Compass, HeartPulse, BookOpen } from "lucide-react";
import confetti from "canvas-confetti";

interface HabitsPanelProps {
  habits: Habit[];
  onToggleHabit: (habitId: string) => void;
  onAddHabit: () => void;
  onViewAllHabits: () => void;
}

export const HabitsPanel: React.FC<HabitsPanelProps> = ({
  habits,
  onToggleHabit,
  onAddHabit,
  onViewAllHabits,
}) => {
  const todayStr = new Date().toISOString().split("T")[0];

  const completedToday = habits.filter((h) => h.history[todayStr]).length;
  const total = habits.length;
  const percentage = total > 0 ? Math.round((completedToday / total) * 100) : 0;

  const handleToggle = (e: React.MouseEvent, habitId: string, isCompleted: boolean) => {
    e.stopPropagation();
    if (!isCompleted) {
      confetti({
        particleCount: 30,
        spread: 50,
        origin: { y: 0.7 },
        colors: ["#10b981", "#3b82f6", "#f59e0b"],
      });
    }
    onToggleHabit(habitId);
  };

  const getHabitIcon = (name: string) => {
    if (name.toLowerCase().includes("meditat") || name.toLowerCase().includes("breath")) return Sparkles;
    if (name.toLowerCase().includes("work") || name.toLowerCase().includes("deep")) return Flame;
    if (name.toLowerCase().includes("journal") || name.toLowerCase().includes("stoic")) return BookOpen;
    if (name.toLowerCase().includes("cardio") || name.toLowerCase().includes("gym")) return HeartPulse;
    return Compass;
  };

  return (
    <div className="bg-slate-200/50 dark:bg-slate-900/40 rounded-4xl p-5 border border-slate-300/60 dark:border-slate-800 shadow-sm flex flex-col h-full">
      {/* Header bar matching the screenshot bottom right */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
            Daily Habits & Streaks
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {completedToday} of {total} completed today ({percentage}%)
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Circular Progress Ring */}
          <div className="relative w-8 h-8 flex items-center justify-center">
            <svg className="w-8 h-8 transform -rotate-90">
              <circle
                cx="16"
                cy="16"
                r="13"
                stroke="currentColor"
                strokeWidth="3"
                fill="transparent"
                className="text-slate-300 dark:text-slate-700"
              />
              <circle
                cx="16"
                cy="16"
                r="13"
                stroke="currentColor"
                strokeWidth="3"
                fill="transparent"
                strokeDasharray={81.68}
                strokeDashoffset={81.68 - (percentage / 100) * 81.68}
                strokeLinecap="round"
                className="text-emerald-500 transition-all duration-500"
              />
            </svg>
            <span className="absolute text-[9px] font-black">{percentage}%</span>
          </div>

          <button
            onClick={onAddHabit}
            title="New Habit"
            className="w-7 h-7 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center hover:bg-slate-900 hover:text-white dark:hover:bg-white dark:hover:text-slate-900 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Habits List Container */}
      <div className="space-y-2.5 flex-1 overflow-y-auto pr-1">
        {habits.slice(0, 4).map((habit) => {
          const isDone = !!habit.history[todayStr];
          const IconComponent = getHabitIcon(habit.name);

          return (
            <div
              key={habit.id}
              onClick={(e) => handleToggle(e, habit.id, isDone)}
              className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between group ${
                isDone
                  ? "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40"
                  : "bg-white dark:bg-[#141721] border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-sm"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
                    isDone
                      ? "bg-emerald-500 text-white"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 group-hover:bg-slate-200"
                  }`}
                >
                  <IconComponent className="w-4 h-4" />
                </div>
                <div>
                  <h4
                    className={`text-xs font-bold leading-tight ${
                      isDone
                        ? "text-emerald-900 dark:text-emerald-300 line-through"
                        : "text-slate-900 dark:text-slate-100"
                    }`}
                  >
                    {habit.name}
                  </h4>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-slate-400 font-semibold flex items-center gap-0.5">
                      <Flame className="w-3 h-3 text-amber-500 fill-amber-500" />
                      {habit.streak} day streak
                    </span>
                    <span className="text-[10px] text-slate-400 capitalize">• {habit.timeOfDay || "anytime"}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={(e) => handleToggle(e, habit.id, isDone)}
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                  isDone
                    ? "bg-emerald-500 text-white shadow-sm"
                    : "border-2 border-slate-300 dark:border-slate-600 hover:border-emerald-500"
                }`}
              >
                {isDone && <Check className="w-3.5 h-3.5 stroke-[3]" />}
              </button>
            </div>
          );
        })}
      </div>

      {/* AI Second Brain Habit Insight */}
      <div className="mt-3.5 pt-3 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
          <Sparkles className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span className="text-[11px] truncate">
            {percentage === 100
              ? "Flawless habit execution today! Peak cognitive momentum."
              : `12-day streak on deep work active. Protect your evening shutdown.`}
          </span>
        </div>
        <button
          onClick={onViewAllHabits}
          className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
        >
          View All &rarr;
        </button>
      </div>
    </div>
  );
};

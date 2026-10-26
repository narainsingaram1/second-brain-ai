import React from "react";
import { Habit } from "../types";
import { Flame, Plus, Check, Trophy, Trash2 } from "lucide-react";
import confetti from "canvas-confetti";
import { getLocalDateString } from "../utils/habitStreaks";

interface HabitsViewProps {
  habits: Habit[];
  onToggleHabit: (habitId: string, dateStr?: string) => void;
  onAddHabit: () => void;
  onDeleteHabit: (habitId: string) => void;
}

export const HabitsView: React.FC<HabitsViewProps> = ({
  habits,
  onToggleHabit,
  onAddHabit,
  onDeleteHabit,
}) => {
  // Generate last 7 days array based on local date
  const last7Days: { dateStr: string; dayLabel: string; isToday: boolean }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const dateStr = getLocalDateString(d);
    const dayLabel = d.toLocaleDateString("en-US", { weekday: "short" });
    last7Days.push({ dateStr, dayLabel, isToday: i === 0 });
  }

  const todayStr = last7Days[6].dateStr;
  const completedToday = habits.filter((h) => h.history[todayStr]).length;
  const bestOverallStreak = Math.max(...habits.map((h) => h.bestStreak), 0);

  const handleToggle = (e: React.MouseEvent, habitId: string, dateStr: string, isDone: boolean) => {
    e.stopPropagation();
    if (!isDone) {
      confetti({
        particleCount: 25,
        spread: 45,
        origin: { y: 0.6 },
        colors: ["#10b981", "#3b82f6", "#f59e0b"],
      });
    }
    onToggleHabit(habitId, dateStr);
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {/* Top Header Card */}
      <div className="bg-white/80 dark:bg-[#141721]/80 backdrop-blur-xl rounded-4xl p-6 border border-slate-300/70 dark:border-slate-800 shadow-card flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            Daily Habits & Neuro-Consistency
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Build unshakeable daily rituals with visual streaks and progressive momentum
          </p>
        </div>

        <button
          onClick={onAddHabit}
          className="tactile-btn flex items-center gap-2 px-4 py-2 rounded-full bg-[#0d0f14] dark:bg-white text-white dark:text-slate-900 text-xs font-bold shadow-md hover:scale-105 active:scale-95 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>New Daily Habit</span>
        </button>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#141721] rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Check className="w-6 h-6 stroke-[3]" />
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider">Completed Today</span>
            <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-0.5">
              {completedToday} <span className="text-sm font-semibold text-slate-400">/ {habits.length}</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#141721] rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-500 flex items-center justify-center">
            <Flame className="w-6 h-6 fill-amber-500" />
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider">Top Current Streak</span>
            <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-0.5">
              {Math.max(...habits.map((h) => h.streak), 0)} <span className="text-sm font-semibold text-slate-400">Days</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#141721] rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <Trophy className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider">All-Time Best Record</span>
            <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-0.5">
              {bestOverallStreak} <span className="text-sm font-semibold text-slate-400">Days</span>
            </div>
          </div>
        </div>
      </div>

      {/* 7-Day Habit Matrix */}
      <div className="bg-white dark:bg-[#141721] rounded-4xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-6 overflow-x-auto">
        <div className="min-w-[700px]">
          {/* Header Row with Days */}
          <div className="grid grid-cols-12 gap-3 pb-4 border-b border-slate-100 dark:border-slate-800 text-xs font-bold text-slate-400 uppercase tracking-wider">
            <div className="col-span-5">Habit & Frequency</div>
            <div className="col-span-2 text-center">Streaks</div>
            <div className="col-span-5 grid grid-cols-7 gap-1 text-center">
              {last7Days.map((day) => (
                <div key={day.dateStr} className={`text-[11px] ${day.isToday ? "text-blue-600 dark:text-blue-400 font-extrabold" : ""}`}>
                  {day.dayLabel}
                </div>
              ))}
            </div>
          </div>

          {/* Habit Rows */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60 mt-2">
            {habits.map((habit) => (
              <div key={habit.id} className="grid grid-cols-12 gap-3 py-4 items-center hover:bg-slate-50/60 dark:hover:bg-slate-800/30 rounded-2xl transition-colors px-2">
                {/* Name & Domain */}
                <div className="col-span-5 pr-2 flex items-center justify-between group/habit">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{habit.name}</h4>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                      <span className="capitalize">{habit.domain}</span>
                      <span>•</span>
                      <span className="capitalize">{habit.timeOfDay || "Anytime"}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => onDeleteHabit(habit.id)}
                    title="Delete habit"
                    className="opacity-0 group-hover/habit:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Streak Badge with Current & Best Streak */}
                <div className="col-span-2 flex flex-col items-center justify-center">
                  {habit.streak > 0 ? (
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-extrabold text-xs border border-amber-200 dark:border-amber-800/60 shadow-2xs">
                      <Flame className="w-3.5 h-3.5 fill-amber-500 text-amber-500 animate-pulse" />
                      <span>{habit.streak}d</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 font-bold text-xs border border-slate-200 dark:border-slate-700">
                      <Flame className="w-3.5 h-3.5 text-slate-400" />
                      <span>0d</span>
                    </div>
                  )}
                  <span className="text-[10px] text-slate-400 font-medium mt-0.5">
                    best: {habit.bestStreak}d
                  </span>
                </div>

                {/* 7-Day Punch Circles */}
                <div className="col-span-5 grid grid-cols-7 gap-1 place-items-center">
                  {last7Days.map((day) => {
                    const isDone = !!habit.history[day.dateStr];
                    return (
                      <button
                        key={day.dateStr}
                        onClick={(e) => handleToggle(e, habit.id, day.dateStr, isDone)}
                        title={`${day.dateStr}: ${isDone ? "Completed" : "Not completed"}`}
                        className={`w-7 h-7 rounded-xl flex items-center justify-center transition-all ${
                          isDone
                            ? "bg-emerald-500 text-white shadow-sm scale-105"
                            : "bg-slate-100 dark:bg-slate-800 text-transparent hover:border hover:border-emerald-400"
                        } ${day.isToday ? "ring-2 ring-blue-400 ring-offset-2 dark:ring-offset-slate-900" : ""}`}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

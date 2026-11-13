import { PageHeading } from "./workspace/PageHeading";
import React from "react";
import { Habit } from "../types";
import { Plus, Check, Trash2, Pencil } from "lucide-react";
import { getLocalDateString } from "../utils/habitStreaks";

interface HabitsViewProps {
  habits: Habit[];
  onToggleHabit: (habitId: string, dateStr?: string) => void;
  onAddHabit: () => void;
  onEditHabit: (habit: Habit) => void;
  onDeleteHabit: (habitId: string) => void;
}

export const HabitsView: React.FC<HabitsViewProps> = ({
  habits,
  onToggleHabit,
  onAddHabit,
  onEditHabit,
  onDeleteHabit,
}) => {
  // Generate last 7 days array based on local date
  const last7Days: { dateStr: string; dayLabel: string; isToday: boolean }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const dateStr = getLocalDateString(d);
    const dayLabel = d.toLocaleDateString("en-US", { weekday: "short" });
    last7Days.push({ dateStr, dayLabel: `${dayLabel} ${String(d.getDate()).padStart(2, "0")}`, isToday: i === 0 });
  }

  const todayStr = last7Days[6].dateStr;
  const completedToday = habits.filter((h) => h.history[todayStr]).length;
  const bestOverallStreak = Math.max(...habits.map((h) => h.bestStreak), 0);

  const handleToggle = (e: React.MouseEvent, habitId: string, dateStr: string) => {
    e.stopPropagation();
    onToggleHabit(habitId, dateStr);
  };
  const weekDone = habits.reduce((n, h) => n + last7Days.filter((d) => h.history[d.dateStr]).length, 0);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <div className="habits-page">
      <PageHeading title="Habits" description="A week at a glance. Tap a day to mark it done">
        <button className="workspace-primary" onClick={onAddHabit}><Plus size={16} strokeWidth={1.5} />New habit</button>
      </PageHeading>

      <div className="stat-strip is-three">
        <div><small>Done today</small><span className="figure">{completedToday} <small>of {habits.length}</small></span></div>
        <div><small>Longest current streak</small><span className="figure">{plural(Math.max(...habits.map((h) => h.streak), 0), "day")}</span></div>
        <div><small>Best streak ever</small><span className="figure">{plural(bestOverallStreak, "day")}</span></div>
      </div>

      {/* The week as a tally sheet: one ruled row per habit, one dated column per day. */}
      <section className="tally-sheet" aria-label="Last seven days">
        <div className="tally-row tally-head">
          <span>Habit</span>
          <span>Streak</span>
          {last7Days.map((day) => (
            <span key={day.dateStr} className={`date-stamp ${day.isToday ? "is-today" : ""}`}>{day.isToday ? "Today" : day.dayLabel}</span>
          ))}
        </div>
        {habits.map((habit) => (
          <div key={habit.id} data-record-id={habit.id} className="tally-row">
            <div className="tally-name">
              <button
                type="button"
                className="tally-name-button"
                onClick={() => onEditHabit(habit)}
                title={`Edit habit ${habit.name}`}
              >
                <strong>{habit.name}</strong>
                <small>{[habit.domain, habit.timeOfDay || "Any time"].filter(Boolean).map((x) => String(x).replace(/^./, (c) => c.toUpperCase())).join(" · ")}</small>
              </button>
              <div className="tally-actions">
                <button
                  type="button"
                  className="icon-control tally-edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditHabit(habit);
                  }}
                  aria-label={`Edit ${habit.name}`}
                  title={`Edit ${habit.name}`}
                >
                  <Pencil size={15} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  className="icon-control tally-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteHabit(habit.id);
                  }}
                  aria-label={`Delete ${habit.name}`}
                  title={`Delete ${habit.name}`}
                >
                  <Trash2 size={16} strokeWidth={1.5} />
                </button>
              </div>
            </div>
            <span className="tally-streak">
              <span className="figure">{habit.streak}</span>
              <small>best {habit.bestStreak}</small>
            </span>
            {last7Days.map((day) => {
              const isDone = !!habit.history[day.dateStr];
              return (
                <button
                  key={day.dateStr}
                  className={`tally-cell ${isDone ? "is-done" : ""} ${day.isToday ? "is-today" : ""}`}
                  onClick={(e) => handleToggle(e, habit.id, day.dateStr)}
                  aria-pressed={isDone}
                  aria-label={`${habit.name}, ${day.dateStr}: ${isDone ? "done" : "not done"}`}
                >
                  {isDone && <Check size={14} strokeWidth={2} />}
                </button>
              );
            })}
          </div>
        ))}
        <div className="tally-row tally-foot">
          <span>{plural(weekDone, "check-in")} this week</span>
        </div>
      </section>
    </div>
  );
};

import { DialogBackdrop } from "./workspace/DialogBackdrop";
import React, { useEffect, useState } from "react";
import { Habit, LifeDomain } from "../types";
import { X, Flame, Trash2 } from "lucide-react";

interface HabitModalProps {
  isOpen: boolean;
  onClose: () => void;
  habit?: Habit | null;
  onSave: (habit: Habit) => void;
  onDelete?: (habitId: string) => void;
}

export const HabitModal: React.FC<HabitModalProps> = ({
  isOpen,
  onClose,
  habit,
  onSave,
  onDelete,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState<LifeDomain>("health");
  const [frequency, setFrequency] = useState<Habit["frequency"]>("daily");
  const [timeOfDay, setTimeOfDay] = useState<Habit["timeOfDay"]>("morning");

  useEffect(() => {
    if (!isOpen) return;
    if (habit) {
      setName(habit.name || "");
      setDescription(habit.description || "");
      setDomain(habit.domain || "health");
      setFrequency(habit.frequency || "daily");
      setTimeOfDay(habit.timeOfDay || "morning");
    } else {
      setName("");
      setDescription("");
      setDomain("health");
      setFrequency("daily");
      setTimeOfDay("morning");
    }
  }, [isOpen, habit]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const habitToSave: Habit = {
      id: habit?.id || `habit-${Date.now()}`,
      name: name.trim(),
      description: description.trim() || undefined,
      domain,
      frequency,
      timeOfDay,
      streak: habit?.streak || 0,
      bestStreak: habit?.bestStreak || 0,
      history: habit?.history || {},
      icon: habit?.icon,
    };

    onSave(habitToSave);
    onClose();
  };

  const handleDelete = () => {
    if (!habit || !onDelete) return;
    if (confirm(`Delete habit "${habit.name}"?`)) {
      onDelete(habit.id);
      onClose();
    }
  };

  const isEditing = Boolean(habit);

  return (
    <DialogBackdrop
      onClose={onClose}
      label={isEditing ? "Edit habit" : "New habit"}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
    >
      <div className="workspace-dialog bg-panel rounded-4xl border border-line shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-muted " />
            <h3 className="font-extrabold text-base tracking-tight text-ink">
              {isEditing ? "Edit habit" : "New daily habit"}
            </h3>
          </div>
          <button
            aria-label="Close dialog"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Habit Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. 20-Minute Deep Reading"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-raised text-xs font-bold text-ink px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Cue / intention / rule
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Right after morning coffee, sit by the window without phone"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-raised text-xs text-ink p-3 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Life domain
              </label>
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value as any)}
                className="w-full bg-raised text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
              >
                <option value="health">Health & Vitality</option>
                <option value="career">Career & Projects</option>
                <option value="mindset">Mindset & Habits</option>
                <option value="learning">Deep Learning</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Frequency
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as any)}
                className="w-full bg-raised text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
              >
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekends">Weekends</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Time of day
              </label>
              <select
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value as any)}
                className="w-full bg-raised text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
              >
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
              </select>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
            <div>
              {isEditing && onDelete && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-3 py-1.5 rounded-full text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-full bg-primary text-white text-xs font-bold shadow-md active:scale-[0.98] transition-all"
              >
                {isEditing ? "Save changes" : "Start Habit"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </DialogBackdrop>
  );
};

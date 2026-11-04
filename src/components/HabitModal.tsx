import { DialogBackdrop } from "./workspace/DialogBackdrop";
import React, { useState } from "react";
import { Habit, LifeDomain } from "../types";
import { X, Flame } from "lucide-react";

interface HabitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (habit: Habit) => void;
}

export const HabitModal: React.FC<HabitModalProps> = ({ isOpen, onClose, onSave }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState<LifeDomain>("health");
  const [frequency, setFrequency] = useState<Habit["frequency"]>("daily");
  const [timeOfDay, setTimeOfDay] = useState<Habit["timeOfDay"]>("morning");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newHabit: Habit = {
      id: `habit-${Date.now()}`,
      name: name.trim(),
      description: description.trim() || undefined,
      domain,
      frequency,
      timeOfDay,
      streak: 0,
      bestStreak: 0,
      history: {},
    };

    onSave(newHabit);
    onClose();
  };

  return (
    <DialogBackdrop onClose={onClose} label="New habit" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="workspace-dialog bg-panel rounded-4xl border border-line shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-amber-500 fill-amber-500" />
            <h3 className="font-extrabold text-base tracking-tight text-ink">
              New Daily Habit
            </h3>
          </div>
          <button aria-label="Close dialog" onClick={onClose}
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
              Cue / Intention / Rule
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
                Life Domain
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
                Time of Day
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

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-full bg-primary text-white text-xs font-bold shadow-md hover:scale-105 active:scale-95 transition-all"
            >
              Start Habit
            </button>
          </div>
        </form>
      </div>
    </DialogBackdrop>
  );
};

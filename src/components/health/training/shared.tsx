import { useEffect, useState } from "react";
import type { HealthDay, WorkoutPlan, WorkoutSession } from "../../../types";
import type { WeightUnit } from "../../../utils/training";

/** Everything the training screens read and change. Weights cross this boundary in kg. */
export interface TrainingApi {
  unit: WeightUnit;
  today: string;
  workouts: WorkoutSession[];
  plans: WorkoutPlan[];
  days: HealthDay[];
  goalWeightKg?: number;
  setUnit: (unit: WeightUnit) => void;
  saveWorkout: (w: WorkoutSession) => void;
  deleteWorkout: (id: string) => void;
  savePlan: (p: WorkoutPlan) => void;
  deletePlan: (id: string) => void;
  logWeight: (date: string, kg: number | null) => void;
  setGoalWeight: (kg: number | undefined) => void;
  onAsk: (prompt: string) => void;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Monday first, the way training weeks are read. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
export const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
export const compact = (n: number) => n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`;

/**
 * A number input that keeps what is typed ("18." or "") while focused and commits parsed values,
 * so converting between kg and lb never rewrites the field under the cursor.
 */
export function NumField({ value, onCommit, placeholder, step = "any", label, decimals = 1, className }: {
  value: number | undefined; onCommit: (v: number | undefined) => void; placeholder?: string; step?: string; label: string; decimals?: number; className?: string;
}) {
  const show = (v: number | undefined) => v === undefined ? "" : String(Math.round(v * 10 ** decimals) / 10 ** decimals);
  const [text, setText] = useState(show(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(show(value)); }, [value, focused]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input className={className} inputMode="decimal" aria-label={label} placeholder={placeholder} step={step} value={text}
      onFocus={e => { setFocused(true); e.currentTarget.select(); }}
      onBlur={() => { setFocused(false); setText(show(value)); }}
      onChange={e => {
        const raw = e.target.value.replace(",", ".");
        if (!/^\d*\.?\d*$/.test(raw)) return;
        setText(raw);
        onCommit(raw === "" || raw === "." ? undefined : Number(raw));
      }} />
  );
}

/** A text input that only commits non-blank values, so a name is never saved empty; blanks revert on blur. */
export function TextField({ value, onCommit, label, maxLength, className, placeholder }: {
  value: string; onCommit: (v: string) => void; label: string; maxLength: number; className?: string; placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(value); }, [value, focused]);
  return (
    <input type="text" className={className} aria-label={label} maxLength={maxLength} placeholder={placeholder} value={text}
      onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setText(value); }}
      onChange={e => { setText(e.target.value); if (e.target.value.trim()) onCommit(e.target.value); }} />
  );
}

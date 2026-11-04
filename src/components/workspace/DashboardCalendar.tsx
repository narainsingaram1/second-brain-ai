import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Task } from "../../types";
import { getLocalDateString } from "../../utils/habitStreaks";
interface Props {
  tasks: Task[];
  selected: string;
  onSelect: (date: string) => void;
}
export function DashboardCalendar({ tasks, selected, onSelect }: Props) {
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const today = getLocalDateString();
  const first = (month.getDay() + 6) % 7;
  const length = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  const move = (amount: number) =>
    setMonth(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + amount, 1),
    );
  return (
    <section className="workspace-card dashboard-calendar">
      <div className="card-heading">
        <h2>
          <CalendarDays size={18} />
          {month.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <div className="inline-actions">
          <button
            className="icon-control"
            aria-label="Previous month"
            onClick={() => move(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-control"
            aria-label="Next month"
            onClick={() => move(1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="month-grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => (
          <span className="weekday" key={`day-${i}`}>
            {day}
          </span>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {Array.from({ length }, (_, i) => {
          const date = getLocalDateString(
            new Date(month.getFullYear(), month.getMonth(), i + 1),
          );
          const hasTasks = tasks.some(
            (task) => task.dueDate === date && !task.completed,
          );
          return (
            <button
              key={date}
              aria-label={date}
              aria-pressed={selected === date}
              aria-current={today === date ? "date" : undefined}
              className={`${today === date ? "today" : ""} ${hasTasks ? "has-tasks" : ""}`}
              onClick={() => onSelect(date)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <button
        className="calendar-today"
        onClick={() => {
          setMonth(
            new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          );
          onSelect(today);
        }}
      >
        Back to today
      </button>
    </section>
  );
}

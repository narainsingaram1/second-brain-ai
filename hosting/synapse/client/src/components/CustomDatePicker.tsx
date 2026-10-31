import React, { useState, useRef, useEffect } from "react";
import { Calendar as CalendarIcon, ArrowUp, ArrowDown } from "lucide-react";

interface CustomDatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  placeholder?: string;
  className?: string;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAYS_OF_WEEK = ["S", "M", "T", "W", "T", "F", "S"];

export const CustomDatePicker: React.FC<CustomDatePickerProps> = ({
  value,
  onChange,
  placeholder = "Select date",
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;

  // Parse initial year & month from value or fallback to today
  const initialDate = value ? new Date(value + "T00:00:00") : today;
  const [viewYear, setViewYear] = useState<number>(
    isNaN(initialDate.getFullYear()) ? today.getFullYear() : initialDate.getFullYear()
  );
  const [viewMonth, setViewMonth] = useState<number>(
    isNaN(initialDate.getMonth()) ? today.getMonth() : initialDate.getMonth()
  );

  // Sync view year/month when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value + "T00:00:00");
      if (!isNaN(d.getTime())) {
        setViewYear(d.getFullYear());
        setViewMonth(d.getMonth());
      }
    }
  }, [value]);

  // Handle click outside to close popover
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Navigate months
  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  // Format value to MM/DD/YYYY for input display (matching screenshot)
  const formatDisplay = (val: string) => {
    if (!val) return "";
    const parts = val.split("-");
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${month}/${day}/${year}`;
    }
    return val;
  };

  // Build calendar matrix
  const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun
  const daysInCurrentMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const days: {
    dayNumber: number;
    dateStr: string;
    isCurrentMonth: boolean;
    isPrevMonth: boolean;
    isNextMonth: boolean;
  }[] = [];

  // Trailing days from previous month
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const prevM = viewMonth === 0 ? 11 : viewMonth - 1;
    const prevY = viewMonth === 0 ? viewYear - 1 : viewYear;
    const dateStr = `${prevY}-${String(prevM + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    days.push({
      dayNumber: d,
      dateStr,
      isCurrentMonth: false,
      isPrevMonth: true,
      isNextMonth: false,
    });
  }

  // Days in current month
  for (let d = 1; d <= daysInCurrentMonth; d++) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    days.push({
      dayNumber: d,
      dateStr,
      isCurrentMonth: true,
      isPrevMonth: false,
      isNextMonth: false,
    });
  }

  // Leading days from next month (complete 35 or 42 cells)
  const totalCount = days.length;
  const targetTotal = totalCount > 35 ? 42 : 35;
  const remaining = targetTotal - totalCount;
  for (let d = 1; d <= remaining; d++) {
    const nextM = viewMonth === 11 ? 0 : viewMonth + 1;
    const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;
    const dateStr = `${nextY}-${String(nextM + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    days.push({
      dayNumber: d,
      dateStr,
      isCurrentMonth: false,
      isPrevMonth: false,
      isNextMonth: true,
    });
  }

  const handleSelectDay = (dayItem: (typeof days)[0]) => {
    onChange(dayItem.dateStr);
    if (dayItem.isPrevMonth) {
      if (viewMonth === 0) {
        setViewMonth(11);
        setViewYear((y) => y - 1);
      } else {
        setViewMonth((m) => m - 1);
      }
    } else if (dayItem.isNextMonth) {
      if (viewMonth === 11) {
        setViewMonth(0);
        setViewYear((y) => y + 1);
      } else {
        setViewMonth((m) => m + 1);
      }
    }
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Input Pill Trigger */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-slate-50 dark:bg-slate-800/80 text-xs font-semibold text-slate-800 dark:text-slate-200 px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center justify-between cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-colors shadow-2xs"
      >
        <span className={value ? "text-slate-900 dark:text-slate-100 font-bold" : "text-slate-400"}>
          {value ? formatDisplay(value) : placeholder}
        </span>
        <CalendarIcon className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
      </div>

      {/* Calendar Popover (Matches media_1793030139545_40384874.png) */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 z-50 w-[270px] bg-white dark:bg-[#161a24] rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-2xl p-3.5 animate-fade-in select-none">
          {/* Header: Month Year on left, Up/Down navigation arrows on right */}
          <div className="flex items-center justify-between px-1 pb-3">
            <div className="flex items-center gap-1 font-bold text-xs text-slate-900 dark:text-slate-100">
              <span>
                {MONTH_NAMES[viewMonth]} {viewYear}
              </span>
              <span className="text-[10px] text-slate-400">▾</span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrevMonth}
                title="Previous month"
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                title="Next month"
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Days of Week Row (S M T W T F S) */}
          <div className="grid grid-cols-7 text-center mb-1">
            {DAYS_OF_WEEK.map((day, idx) => (
              <div key={idx} className="text-[11px] font-bold text-slate-400 dark:text-slate-500 py-1">
                {day}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-y-1 gap-x-0.5 text-center">
            {days.map((item) => {
              const isSelected = item.dateStr === value;
              const isToday = item.dateStr === todayStr;

              return (
                <button
                  type="button"
                  key={item.dateStr}
                  onClick={() => handleSelectDay(item)}
                  className={`h-8 w-8 mx-auto flex items-center justify-center text-xs font-semibold rounded-lg transition-all ${
                    isSelected
                      ? "bg-blue-600 text-white font-bold rounded-lg shadow-sm"
                      : item.isCurrentMonth
                      ? isToday
                        ? "text-blue-600 dark:text-blue-400 font-bold hover:bg-blue-50 dark:hover:bg-blue-950/40"
                        : "text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                      : "text-slate-300 dark:text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/40 font-normal"
                  }`}
                >
                  {item.dayNumber}
                </button>
              );
            })}
          </div>

          {/* Footer: Clear on left, Today on right */}
          <div className="flex items-center justify-between pt-3 mt-2 border-t border-slate-100 dark:border-slate-800 px-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
                setIsOpen(false);
              }}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 transition-colors"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(todayStr);
                setViewYear(today.getFullYear());
                setViewMonth(today.getMonth());
                setIsOpen(false);
              }}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 transition-colors"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

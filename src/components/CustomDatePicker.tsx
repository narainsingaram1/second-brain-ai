import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { getLocalDateString } from "../utils/habitStreaks";

interface CustomDatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-describedby"?: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const POPOVER_WIDTH = 288;
const POPOVER_HEIGHT = 340;
const GAP = 6;

const parse = (value: string) => {
  const d = value ? new Date(`${value}T00:00:00`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const addDays = (value: string, days: number) => {
  const d = parse(value)!;
  d.setDate(d.getDate() + days);
  return getLocalDateString(d);
};
const monthLabel = (year: number, month: number) =>
  new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
export const formatDueDate = (value: string) =>
  parse(value)?.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) || "";

/**
 * Date field with a calendar popover. The popover is positioned against the viewport so it is never
 * clipped by a scrolling dialog, and the grid works with the keyboard (arrows, Home/End, Page Up/Down).
 */
export const CustomDatePicker: React.FC<CustomDatePickerProps> = ({
  value,
  onChange,
  placeholder = "Select date",
  className = "",
  id,
  "aria-describedby": describedBy,
}) => {
  const today = getLocalDateString();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(value || today);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const labelId = useId();

  const focusedDate = parse(focused) || new Date();
  const viewYear = focusedDate.getFullYear();
  const viewMonth = focusedDate.getMonth();

  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    const top = below >= POPOVER_HEIGHT + GAP || rect.top < POPOVER_HEIGHT + GAP
      ? Math.min(rect.bottom + GAP, window.innerHeight - POPOVER_HEIGHT - 8)
      : rect.top - POPOVER_HEIGHT - GAP;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - POPOVER_WIDTH - 8);
    setPosition({ top: Math.max(8, top), left: Math.max(8, left) });
  }, []);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  const openPicker = () => {
    setFocused(value || today);
    // Render inside the open dialog (if any) so its focus trap and aria-modal include the calendar.
    setHost((trigger.current?.closest('[role="dialog"]') as HTMLElement) || document.body);
    place();
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!popover.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open, close]);

  // Keep keyboard focus on the active day as it moves.
  useEffect(() => {
    if (open) grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus({ preventScroll: true });
  }, [open, focused, host, position !== null]);

  const select = (date: string) => {
    onChange(date);
    close();
  };

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    const day = Math.min(focusedDate.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
    setFocused(getLocalDateString(new Date(d.getFullYear(), d.getMonth(), day)));
  };

  const onGridKey = (event: React.KeyboardEvent) => {
    const moves: Record<string, () => void> = {
      ArrowLeft: () => setFocused(addDays(focused, -1)),
      ArrowRight: () => setFocused(addDays(focused, 1)),
      ArrowUp: () => setFocused(addDays(focused, -7)),
      ArrowDown: () => setFocused(addDays(focused, 7)),
      Home: () => setFocused(addDays(focused, -focusedDate.getDay())),
      End: () => setFocused(addDays(focused, 6 - focusedDate.getDay())),
      PageUp: () => shiftMonth(event.shiftKey ? -12 : -1),
      PageDown: () => shiftMonth(event.shiftKey ? 12 : 1),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      move();
    }
  };

  const onPopoverKey = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation(); // Close the calendar, not the dialog behind it.
      close();
    }
  };

  // Six full weeks so the popover never changes height between months.
  const first = new Date(viewYear, viewMonth, 1);
  const start = new Date(viewYear, viewMonth, 1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { date: getLocalDateString(d), day: d.getDate(), inMonth: d.getMonth() === viewMonth };
  });
  const weeks = Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  return (
    <div className={`date-field ${className}`}>
      <button
        ref={trigger}
        id={id}
        type="button"
        className="date-field-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={describedBy}
        onClick={() => (open ? close(false) : openPicker())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            openPicker();
          }
        }}
      >
        <span className={value ? "" : "date-field-placeholder"}>{value ? formatDueDate(value) : placeholder}</span>
        <CalendarIcon aria-hidden="true" />
      </button>

      {open && position && host && createPortal(
        <div
          ref={popover}
          role="dialog"
          aria-modal="false"
          aria-labelledby={labelId}
          className="date-popover"
          style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}
          onKeyDown={onPopoverKey}
        >
          <div className="date-popover-head">
            <span id={labelId} aria-live="polite">{monthLabel(viewYear, viewMonth)}</span>
            <div>
              <button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
                <ChevronLeft aria-hidden="true" />
              </button>
              <button type="button" aria-label="Next month" onClick={() => shiftMonth(1)}>
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          </div>

          <div ref={grid} role="grid" aria-labelledby={labelId} className="date-grid" onKeyDown={onGridKey}>
            <div role="row" className="date-grid-row">
              {WEEKDAYS.map((day) => (
                <span key={day} role="columnheader" aria-label={day} className="date-grid-weekday">
                  {day.slice(0, 2)}
                </span>
              ))}
            </div>
            {weeks.map((week) => (
              <div role="row" key={week[0].date} className="date-grid-row">
                {week.map((cell) => (
                  <span role="gridcell" key={cell.date} aria-selected={cell.date === value}>
                    <button
                      type="button"
                      data-date={cell.date}
                      tabIndex={cell.date === focused ? 0 : -1}
                      aria-label={formatDueDate(cell.date)}
                      aria-current={cell.date === today ? "date" : undefined}
                      className={`date-day${cell.inMonth ? "" : " is-outside"}${cell.date === value ? " is-selected" : ""}`}
                      onClick={() => select(cell.date)}
                    >
                      {cell.day}
                    </button>
                  </span>
                ))}
              </div>
            ))}
          </div>

          <div className="date-popover-foot">
            <button type="button" onClick={() => { onChange(""); close(); }}>Clear</button>
            <button type="button" onClick={() => select(today)}>Today</button>
          </div>
        </div>,
        host,
      )}
    </div>
  );
};

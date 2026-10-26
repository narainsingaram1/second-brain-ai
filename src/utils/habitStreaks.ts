import { Habit } from "../types";

/**
 * Returns today's date formatted as YYYY-MM-DD in the user's local timezone.
 */
export function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats a Date as YYYY-MM-DD.
 */
function toDateStr(d: Date): string {
  return getLocalDateString(d);
}

/**
 * Parses a YYYY-MM-DD string into a local Date object.
 */
function parseDateStr(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Checks if a date falls on a weekend (Saturday = 6, Sunday = 0).
 */
function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Calculates the current real continuous streak for a habit.
 * - If today is marked complete, counts today and every consecutive completed day backward.
 * - If today is not yet marked complete, checks yesterday. If yesterday was completed, the streak
 *   remains alive (today is still in progress!) and counts consecutive completed days backward.
 * - If neither today nor yesterday was completed, current streak is 0.
 * - If frequency is 'weekdays', weekends are skipped and do not break the streak.
 */
export function calculateHabitStreak(
  history: Record<string, boolean> = {},
  frequency: Habit["frequency"] = "daily",
  referenceDateStr?: string
): number {
  const todayStr = referenceDateStr || getLocalDateString();
  const today = parseDateStr(todayStr);

  const isTodayDone = !!history[todayStr];

  // Helper to step backward 1 day
  const prevDay = (d: Date): Date => {
    const p = new Date(d);
    p.setDate(p.getDate() - 1);
    return p;
  };

  // Find the anchor date to count from:
  // If today is done, start at today.
  // If today is not done, check if yesterday was done (or previous weekday).
  let currentCheck: Date;
  let streak = 0;

  if (isTodayDone) {
    currentCheck = today;
    streak = 1;
    currentCheck = prevDay(currentCheck);
  } else {
    // Today is not marked done yet. Check yesterday.
    let yesterday = prevDay(today);
    if (frequency === "weekdays") {
      while (isWeekend(yesterday)) {
        yesterday = prevDay(yesterday);
      }
    }

    const yesterdayStr = toDateStr(yesterday);
    if (history[yesterdayStr]) {
      // Streak is still active from yesterday!
      currentCheck = yesterday;
      streak = 1;
      currentCheck = prevDay(currentCheck);
    } else {
      // Streak is broken
      return 0;
    }
  }

  // Count backwards consecutively
  // Safety guard of 10,000 days to prevent infinite loop
  let safety = 0;
  while (safety < 10000) {
    safety++;

    if (frequency === "weekdays" && isWeekend(currentCheck)) {
      // Skip weekends without breaking the streak
      currentCheck = prevDay(currentCheck);
      continue;
    }

    const checkStr = toDateStr(currentCheck);
    if (history[checkStr]) {
      streak++;
      currentCheck = prevDay(currentCheck);
    } else {
      // Chain broken
      break;
    }
  }

  return streak;
}

/**
 * Calculates the all-time best (longest) streak for a habit from its full history.
 */
export function calculateBestStreak(
  history: Record<string, boolean> = {},
  frequency: Habit["frequency"] = "daily",
  referenceDateStr?: string
): number {
  const currentStreak = calculateHabitStreak(history, frequency, referenceDateStr);

  // Collect all dates that were completed
  const completedDates = Object.entries(history)
    .filter(([_, done]) => !!done)
    .map(([dateStr]) => dateStr)
    .sort(); // Lexicographical sort works for YYYY-MM-DD

  if (completedDates.length === 0) {
    return currentStreak;
  }

  let maxStreak = 0;
  let currentChain = 0;
  let lastDate: Date | null = null;

  for (const dateStr of completedDates) {
    const d = parseDateStr(dateStr);

    if (!lastDate) {
      currentChain = 1;
      lastDate = d;
      maxStreak = Math.max(maxStreak, currentChain);
      continue;
    }

    // Check difference in days between lastDate and d
    const diffMs = d.getTime() - lastDate.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      // Same day duplicate, ignore
      continue;
    }

    if (diffDays === 1) {
      currentChain++;
    } else if (frequency === "weekdays") {
      // Check if all intermediate days were weekends
      let allWeekends = true;
      const step = new Date(lastDate);
      step.setDate(step.getDate() + 1);

      while (step < d) {
        if (!isWeekend(step)) {
          allWeekends = false;
          break;
        }
        step.setDate(step.getDate() + 1);
      }

      if (allWeekends) {
        currentChain++;
      } else {
        currentChain = 1;
      }
    } else {
      currentChain = 1;
    }

    lastDate = d;
    maxStreak = Math.max(maxStreak, currentChain);
  }

  return Math.max(maxStreak, currentStreak);
}

/**
 * Recomputes and updates the streak and bestStreak on a habit object
 * strictly from its history records.
 */
export function syncHabitStreaks(habit: Habit, referenceDateStr?: string): Habit {
  const streak = calculateHabitStreak(habit.history, habit.frequency, referenceDateStr);
  const bestStreak = Math.max(
    calculateBestStreak(habit.history, habit.frequency, referenceDateStr),
    streak
  );

  return {
    ...habit,
    streak,
    bestStreak,
  };
}

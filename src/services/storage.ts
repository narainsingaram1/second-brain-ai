import { BrainState, Task, Habit, JournalEntry, KnowledgeItem, AIMessage, TaskStatus, Goal } from "../types";
import { syncHabitStreaks, getLocalDateString } from "../utils/habitStreaks";
import { loadUserStateFromDB, saveUserStateToDB } from "./database";

const STORAGE_KEY = "synapse_second_brain_state";

const todayStr = getLocalDateString();
const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split("T")[0];
const inThreeDaysStr = new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0];
const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split("T")[0];

/**
 * Generates an authentic consecutive history dictionary for initial habits,
 * guaranteeing the streak calculation matches real historical dates.
 */
function generateConsecutiveHistory(daysCount: number, includeToday: boolean): Record<string, boolean> {
  const history: Record<string, boolean> = {};
  const startOffset = includeToday ? 0 : 1;
  for (let i = startOffset; i < daysCount + startOffset; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const dateStr = d.toISOString().split("T")[0];
    history[dateStr] = true;
  }
  return history;
}

export const DEFAULT_SECTIONS = ["Academic", "Career", "Finance", "Health"];

export const DEFAULT_SUBSECTIONS: Record<string, string[]> = {
  Academic: ["CS 1332", "Systems & Architecture", "General"],
  Career: ["SWE Applications", "Open Source & Projects", "Interviews"],
  Finance: ["Trading & Risk", "Monthly Budget", "Investments"],
  Health: ["Workouts", "Sleep & Recovery", "Nutrition"],
};

export const INITIAL_TASKS: Task[] = [
  // Academic
  {
    id: "task-1",
    title: "CS 1332 Data Structures & Algorithms Lab",
    description: "Implement AVL Tree balance invariants and JUnit test cases",
    dueDate: todayStr,
    priority: "urgent",
    section: "Academic",
    subsection: "CS 1332",
    completed: false,
    status: "in_progress",
    subtasks: [
      { id: "sub-1", title: "Implement Left & Right Rotations", completed: true },
      { id: "sub-2", title: "Balance factor recalculations", completed: false },
      { id: "sub-3", title: "Run edge test suite", completed: false },
    ],
  },
  {
    id: "task-2",
    title: "Study Distributed Consensus & Paxos/Raft",
    description: "Read Raft paper section 5 and outline leader election mechanics",
    dueDate: tomorrowStr,
    priority: "high",
    section: "Academic",
    subsection: "Systems & Architecture",
    completed: false,
    status: "not_started",
  },

  // Career
  {
    id: "task-3",
    title: "Refactor Rust Native Storage & IPC Bridge",
    description: "Benchmark zero-overhead disk persistence and IPC latency for native app",
    dueDate: todayStr,
    priority: "high",
    section: "Career",
    subsection: "Open Source & Projects",
    completed: true,
    status: "completed",
  },
  {
    id: "task-4",
    title: "Submit Applications for SWE Summer 2027",
    description: "Target top 5 infrastructure & quantitative trading teams",
    dueDate: inThreeDaysStr,
    priority: "medium",
    section: "Career",
    subsection: "SWE Applications",
    completed: false,
    status: "in_progress",
  },

  // Finance
  {
    id: "task-5",
    title: "Review Trading Risk Parameters & Drawdown Bounds",
    description: "Analyze daily PnL variance, Sharpe ratio, and position sizing rules",
    dueDate: todayStr,
    priority: "high",
    section: "Finance",
    subsection: "Trading & Risk",
    completed: false,
    status: "not_started",
  },
  {
    id: "task-6",
    title: "Audit Monthly Expenses & Automated Investments",
    description: "Review automated DCA into index funds and prune unused subscriptions",
    dueDate: inThreeDaysStr,
    priority: "low",
    section: "Finance",
    subsection: "Monthly Budget",
    completed: false,
    status: "not_started",
  },

  // Health
  {
    id: "task-7",
    title: "Zone 2 Cardio (45m) & Compound Lifts",
    description: "Aerobic base building followed by heavy squat & pull-ups",
    dueDate: todayStr,
    priority: "high",
    section: "Health",
    subsection: "Workouts",
    completed: true,
    status: "completed",
  },
  {
    id: "task-8",
    title: "Evening Circadian Shutdown & No Screens Past 9 PM",
    description: "Warm shower, magnesium glycinate, 20 pages of reading",
    dueDate: todayStr,
    priority: "medium",
    section: "Health",
    subsection: "Sleep & Recovery",
    completed: false,
    status: "not_started",
  },
];

export const INITIAL_HABITS: Habit[] = [
  syncHabitStreaks({
    id: "habit-1",
    name: "Morning Breathwork & Cold Immersion",
    description: "15m Wim Hof protocol + cold shower kickstart",
    frequency: "daily",
    streak: 0,
    bestStreak: 24,
    history: generateConsecutiveHistory(18, true),
    timeOfDay: "morning",
  }),
  syncHabitStreaks({
    id: "habit-2",
    name: "Deep Work Sprint (90m Uninterrupted)",
    description: "Zero notifications, full focus state before noon",
    frequency: "daily",
    streak: 0,
    bestStreak: 30,
    history: generateConsecutiveHistory(12, true),
    timeOfDay: "morning",
  }),
  syncHabitStreaks({
    id: "habit-3",
    name: "Daily Stoic Journal & Reflection",
    description: "Evening debrief, gratitude, cognitive audit",
    frequency: "daily",
    streak: 0,
    bestStreak: 45,
    history: generateConsecutiveHistory(25, false),
    timeOfDay: "evening",
  }),
  syncHabitStreaks({
    id: "habit-4",
    name: "Zone 2 Cardio / Strength Workout",
    description: "45 minutes aerobic conditioning or compound lifts",
    frequency: "daily",
    streak: 0,
    bestStreak: 15,
    history: generateConsecutiveHistory(9, false),
    timeOfDay: "afternoon",
  }),
  syncHabitStreaks({
    id: "habit-5",
    name: "Read 20 Pages (Technical or Philosophy)",
    description: "High-signal knowledge acquisition",
    frequency: "daily",
    streak: 0,
    bestStreak: 21,
    history: generateConsecutiveHistory(14, true),
    timeOfDay: "evening",
  }),
];

export const INITIAL_GOALS: Goal[] = [
  {
    id: "goal-1",
    title: "Land Staff SWE / Systems Infrastructure Lead",
    description: "Build high-throughput planetary-scale infrastructure with absolute technical autonomy.",
    sector: "career",
    timeframe: "yearly",
    targetDate: "2027-12-31",
    progress: 50,
    status: "in_progress",
    why: "Build high-throughput planetary-scale infrastructure with absolute technical autonomy and deep mastery.",
    metrics: "Lead high-impact distributed systems project + L5/L6 compensation tier",
    milestones: [
      { id: "gm-1", title: "Ship zero-overhead native storage subsystem in Rust", completed: true },
      { id: "gm-2", title: "Master distributed consensus invariants (Paxos & Raft)", completed: true },
      { id: "gm-3", title: "Design & open-source high-throughput stream processing benchmark", completed: false },
      { id: "gm-4", title: "Target top 15 system infrastructure teams & conduct architectural interviews", completed: false },
    ],
    createdAt: new Date().toISOString(),
  },
  {
    id: "goal-2",
    title: "Achieve 4.0 Cumulative GPA in Computer Science",
    description: "Master theoretical computing foundations, algorithms, and computational complexity.",
    sector: "academics",
    timeframe: "yearly",
    targetDate: "2027-05-15",
    progress: 75,
    status: "in_progress",
    why: "Build bulletproof analytical rigor and complete mastery over computer systems fundamentals.",
    metrics: "Straight A/A+ across all 3000/4000-level CS courses",
    milestones: [
      { id: "gm-5", title: "Complete CS 1332 DSA with 100% test suite accuracy", completed: true },
      { id: "gm-6", title: "Finish Operating Systems & Virtual Memory assignments early", completed: true },
      { id: "gm-7", title: "Master dynamic programming & tree decomposition proofs", completed: true },
      { id: "gm-8", title: "Submit honors capstone research thesis on local vector indexing", completed: false },
    ],
    createdAt: new Date().toISOString(),
  },
  {
    id: "goal-3",
    title: "Reach $100,000 Liquid Net Worth & Core Investment Foundation",
    description: "Achieve complete financial runway and asymmetric freedom to build ambitious ventures.",
    sector: "finance",
    timeframe: "long_term",
    targetDate: "2028-12-31",
    progress: 40,
    status: "in_progress",
    why: "Total financial autonomy and security to take big asymmetric bets without stress.",
    metrics: "$100,000 liquid capital across index funds, risk-calibrated portfolio, and cash reserves",
    milestones: [
      { id: "gm-9", title: "Automate 50% monthly savings into low-cost broad index ETFs", completed: true },
      { id: "gm-10", title: "Build 6-month high-yield liquid cash emergency buffer", completed: true },
      { id: "gm-11", title: "Maximize Roth IRA & tax-advantaged retirement accounts", completed: false },
      { id: "gm-12", title: "Reach $50,000 portfolio milestone", completed: false },
      { id: "gm-13", title: "Scale monthly cash-flow surplus to >$3,500/mo", completed: false },
    ],
    createdAt: new Date().toISOString(),
  },
  {
    id: "goal-4",
    title: "Sub-1:45 Half-Marathon & 1,000-lb Powerlifting Total",
    description: "Maintain peak biological vigor, cardiovascular endurance, and structural longevity.",
    sector: "health",
    timeframe: "yearly",
    targetDate: "2027-10-15",
    progress: 50,
    status: "in_progress",
    why: "A resilient, energetic, and powerful physical vessel that fuels high cognitive output.",
    metrics: "1:44:59 21.1k race pace + 1,000 lb (Squat/Bench/Deadlift)",
    milestones: [
      { id: "gm-14", title: "Build weekly base mileage to 35 km with Zone 2 discipline", completed: true },
      { id: "gm-15", title: "Maintain 8 hours sleep average with zero alarm fatigue", completed: true },
      { id: "gm-16", title: "Complete 15k training time-trial under 1 hour 15 min", completed: false },
      { id: "gm-17", title: "Hit 405 lb Deadlift & 315 lb Squat personal records", completed: false },
    ],
    createdAt: new Date().toISOString(),
  },
  {
    id: "goal-5",
    title: "Radical Intellectual Clarity & Daily Deep Work Mastery",
    description: "Eliminate cognitive fragmentation, resist digital triviality, and cultivate profound focus.",
    sector: "mindset",
    timeframe: "lifetime",
    targetDate: "2030-01-01",
    progress: 67,
    status: "in_progress",
    why: "Peace of mind, sovereign attention, and high signal-to-noise ratio in everyday living.",
    metrics: "3+ hours deep uninterrupted cognitive work daily, 24 books read/year, daily reflection",
    milestones: [
      { id: "gm-18", title: "Maintain 30-day streak of morning journaling & cold exposure", completed: true },
      { id: "gm-19", title: "Implement strict zero-phone protocol before 9:00 AM", completed: true },
      { id: "gm-20", title: "Read 24 seminal texts across philosophy, economics, and computing", completed: false },
    ],
    createdAt: new Date().toISOString(),
  },
];

export const INITIAL_JOURNAL: JournalEntry[] = [
  {
    id: "journal-1",
    date: todayStr,
    title: "Flow State Architecture & Zero-Distraction Focus",
    content: "Started the day with morning cold exposure. Clean cognitive headspace. Locked in 90 minutes of uninterrupted work on the second brain native client. Realizing that simplicity in interface design brings profound mental clarity.",
    mood: "great",
    wins: ["Clean, simple minimalist UI redesign", "18-day habit streak maintained", "Clear task segmentation across Academic and Career"],
    challenges: ["Context switching between multiple codebases"],
    aiReflection: "Your mental clarity correlates directly with eliminating visual and cognitive noise. Protect this minimalist workflow.",
    tags: ["Clarity", "Minimalism", "Momentum"],
  },
  {
    id: "journal-2",
    date: yesterdayStr,
    title: "Energy Calibration & Habit Momentum",
    content: "Replaced afternoon caffeine with a 15-minute sunlight walk. Sleep score jumped significantly. Solid momentum on systems programming notes.",
    mood: "great",
    wins: ["18-day morning ritual streak maintained", "Optimal afternoon walk routine"],
    challenges: ["Mind wandering during late evening reading"],
    aiReflection: "Protect your evening circadian shutdown. The replacement habits are working well.",
    tags: ["Habits", "Health", "Energy"],
  },
];

export const INITIAL_KNOWLEDGE: KnowledgeItem[] = [
  {
    id: "know-1",
    subject: "Distributed Systems & Raft Consensus",
    status: "Executed",
    startDate: todayStr,
    endDate: tomorrowStr,
    domain: "Academic",
    summary: "Leader election, log replication, safety guarantees, and split-brain resolution protocols.",
    coverGradient: "from-lime-300 via-amber-200 to-rose-300",
    itemCount: 4,
  },
  {
    id: "know-2",
    subject: "Rust Memory Safety & Zero-Cost Concurrency",
    status: "Synthesized",
    startDate: todayStr,
    endDate: tomorrowStr,
    domain: "Career",
    summary: "Borrow checker ergonomics, crossbeam channels, atomic primitives, and SIMD optimizations.",
    coverGradient: "from-sky-300 via-indigo-200 to-purple-300",
    itemCount: 8,
  },
  {
    id: "know-3",
    subject: "Quantitative Backtesting & Alpha Generation",
    status: "Review",
    startDate: todayStr,
    endDate: tomorrowStr,
    domain: "Finance",
    summary: "Order book dynamics, microstructure signals, latency arbitrage bounds, and execution slippage.",
    coverGradient: "from-emerald-300 via-teal-200 to-blue-300",
    itemCount: 12,
  },
  {
    id: "know-4",
    subject: "Circadian Biology & Dopamine Management",
    status: "Synthesized",
    startDate: todayStr,
    endDate: tomorrowStr,
    domain: "Health",
    summary: "Morning photons, adenosine accumulation, temperature minimums, and cognitive resilience.",
    coverGradient: "from-rose-300 via-pink-200 to-amber-200",
    itemCount: 3,
  },
];

export const INITIAL_CHAT: AIMessage[] = [
  {
    id: "msg-1",
    role: "assistant",
    content: "Welcome to your **Synapse Second Brain**. I'm synchronized with your tasks across Academic, Career, Finance, and Health, as well as your daily habits.\n\nHow can I help direct your focus today?",
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  },
];

export async function loadInitialState(userId?: string): Promise<BrainState> {
  const envKey = import.meta.env.VITE_OPENROUTER_API_KEY || "";
  let storedState: Partial<BrainState> = {};

  // 1. Try to load user-specific state from Database if userId is specified
  if (userId) {
    try {
      const dbState = await loadUserStateFromDB(userId);
      if (dbState) {
        storedState = dbState;
      }
    } catch (e) {
      console.warn("Could not load user state from DB, falling back", e);
    }
  }

  // 2. If no user state loaded yet, try Tauri native data or localStorage
  if (!storedState.tasks) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const nativeData = await invoke<string | null>("load_brain_data");
      if (nativeData) {
        storedState = JSON.parse(nativeData);
      }
      const nativeKey = await invoke<string | null>("get_openrouter_api_key");
      if (nativeKey && !storedState.openRouterKey) {
        storedState.openRouterKey = nativeKey;
      }
    } catch {
      const local = localStorage.getItem(STORAGE_KEY);
      if (local) {
        try {
          storedState = JSON.parse(local);
        } catch (e) {
          console.error("Failed to parse localStorage state", e);
        }
      }
    }
  }

  const finalKey = storedState.openRouterKey || envKey || localStorage.getItem("synapse_openrouter_key") || "";

  // Ensure sections exist
  const sections = storedState.sections && storedState.sections.length > 0
    ? storedState.sections
    : DEFAULT_SECTIONS;

  // Ensure subsections exist for every section
  const subsections: Record<string, string[]> = { ...DEFAULT_SUBSECTIONS, ...(storedState.subsections || {}) };
  sections.forEach((sec) => {
    if (!subsections[sec] || subsections[sec].length === 0) {
      subsections[sec] = ["General"];
    }
  });

  // Ensure tasks have valid section, subsection, and status ('not_started' | 'in_progress' | 'completed')
  const rawTasks = storedState.tasks && storedState.tasks.length > 0 ? storedState.tasks : INITIAL_TASKS;
  const tasks = rawTasks.map((t, idx) => {
    const section = t.section || sections[idx % sections.length];
    const sectionSubs = subsections[section] || ["General"];
    const subsection = t.subsection || sectionSubs[0] || "General";
    const status: TaskStatus = t.status || (t.completed ? "completed" : "not_started");
    const completed = status === "completed";
    return { ...t, section, subsection, status, completed };
  });

  // Ensure all habits have accurate, continuously-calculated streaks from actual history
  const rawHabits = storedState.habits && storedState.habits.length > 0 ? storedState.habits : INITIAL_HABITS;
  const habits = rawHabits.map((h) => syncHabitStreaks(h));

  // Ensure goals exist and have valid milestone progress
  const rawGoals = storedState.goals && storedState.goals.length > 0 ? storedState.goals : INITIAL_GOALS;
  const goals: Goal[] = rawGoals.map((g) => {
    const milestones = g.milestones || [];
    const completedCount = milestones.filter((m) => m.completed).length;
    const computedProgress = milestones.length > 0
      ? Math.round((completedCount / milestones.length) * 100)
      : (typeof g.progress === "number" ? g.progress : 0);
    const status = computedProgress === 100 ? "achieved" : (g.status || "in_progress");
    return {
      ...g,
      sector: g.sector || "career",
      timeframe: g.timeframe || "yearly",
      milestones,
      progress: computedProgress,
      status,
      createdAt: g.createdAt || new Date().toISOString(),
    };
  });

  return {
    userId,
    tasks,
    goals,
    sections,
    subsections,
    habits,
    journalEntries: storedState.journalEntries || INITIAL_JOURNAL,
    knowledgeItems: storedState.knowledgeItems || INITIAL_KNOWLEDGE,
    chatHistory: storedState.chatHistory || INITIAL_CHAT,
    openRouterKey: finalKey,
    selectedModel: storedState.selectedModel || "anthropic/claude-3.5-sonnet",
    theme: storedState.theme || "light",
    dailyBrief: storedState.dailyBrief,
    auditLog: storedState.auditLog || [],
  };
}

export async function persistBrainState(state: BrainState, userId?: string): Promise<void> {
  const targetUserId = userId || state.userId || "guest";
  const updatedState = { ...state, userId: targetUserId };
  const json = JSON.stringify(updatedState);
  
  // 1. Persist to actual database
  try {
    await saveUserStateToDB(targetUserId, updatedState);
  } catch (e) {
    console.warn("Failed to persist state to database", e);
  }

  // 2. LocalStorage mirror
  try {
    localStorage.setItem(STORAGE_KEY, json);
    if (state.openRouterKey) {
      localStorage.setItem("synapse_openrouter_key", state.openRouterKey);
    }
  } catch (e) {
    console.error("Failed to save to localStorage", e);
  }

  // 3. Tauri Native Storage
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_brain_data", { data: json });
    if (state.openRouterKey) {
      await invoke("save_openrouter_api_key", { apiKey: state.openRouterKey });
    }
  } catch {
    // Graceful fallback in browser mode
  }
}

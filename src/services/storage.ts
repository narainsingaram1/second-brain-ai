import { BrainState, Task, Habit, JournalEntry, KnowledgeItem, AIMessage, TaskStatus } from "../types";
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

  return {
    userId,
    tasks,
    sections,
    subsections,
    habits,
    journalEntries: storedState.journalEntries || INITIAL_JOURNAL,
    knowledgeItems: storedState.knowledgeItems || INITIAL_KNOWLEDGE,
    chatHistory: storedState.chatHistory || INITIAL_CHAT,
    openRouterKey: finalKey,
    selectedModel: storedState.selectedModel || "anthropic/claude-3.5-sonnet",
    theme: storedState.theme || "light",
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

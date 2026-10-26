import { BrainState, Task, Habit, JournalEntry, KnowledgeItem, AIMessage } from "../types";

const STORAGE_KEY = "synapse_second_brain_state";

const todayStr = new Date().toISOString().split("T")[0];
const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split("T")[0];
const inThreeDaysStr = new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0];
const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split("T")[0];
const twoDaysAgoStr = new Date(Date.now() - 172800000).toISOString().split("T")[0];

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
  },
];

export const INITIAL_HABITS: Habit[] = [
  {
    id: "habit-1",
    name: "Morning Breathwork & Cold Immersion",
    description: "15m Wim Hof protocol + cold shower kickstart",
    frequency: "daily",
    streak: 18,
    bestStreak: 24,
    history: {
      [todayStr]: true,
      [yesterdayStr]: true,
      [twoDaysAgoStr]: true,
    },
    timeOfDay: "morning",
  },
  {
    id: "habit-2",
    name: "Deep Work Sprint (90m Uninterrupted)",
    description: "Zero notifications, full focus state before noon",
    frequency: "daily",
    streak: 12,
    bestStreak: 30,
    history: {
      [todayStr]: true,
      [yesterdayStr]: true,
      [twoDaysAgoStr]: true,
    },
    timeOfDay: "morning",
  },
  {
    id: "habit-3",
    name: "Daily Stoic Journal & Reflection",
    description: "Evening debrief, gratitude, cognitive audit",
    frequency: "daily",
    streak: 25,
    bestStreak: 45,
    history: {
      [todayStr]: false,
      [yesterdayStr]: true,
      [twoDaysAgoStr]: true,
    },
    timeOfDay: "evening",
  },
  {
    id: "habit-4",
    name: "Zone 2 Cardio / Strength Workout",
    description: "45 minutes aerobic conditioning or compound lifts",
    frequency: "daily",
    streak: 9,
    bestStreak: 15,
    history: {
      [todayStr]: false,
      [yesterdayStr]: true,
      [twoDaysAgoStr]: false,
    },
    timeOfDay: "afternoon",
  },
  {
    id: "habit-5",
    name: "Read 20 Pages (Technical or Philosophy)",
    description: "High-signal knowledge acquisition",
    frequency: "daily",
    streak: 14,
    bestStreak: 21,
    history: {
      [todayStr]: true,
      [yesterdayStr]: true,
      [twoDaysAgoStr]: true,
    },
    timeOfDay: "evening",
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

export async function loadInitialState(): Promise<BrainState> {
  const envKey = import.meta.env.VITE_OPENROUTER_API_KEY || "";
  let storedState: Partial<BrainState> = {};

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

  // Ensure tasks have valid section and subsection
  const tasks = (storedState.tasks && storedState.tasks.length > 0 ? storedState.tasks : INITIAL_TASKS).map((t, idx) => {
    const section = t.section || sections[idx % sections.length];
    const sectionSubs = subsections[section] || ["General"];
    const subsection = t.subsection || sectionSubs[0] || "General";
    return { ...t, section, subsection };
  });

  return {
    tasks,
    sections,
    subsections,
    habits: storedState.habits || INITIAL_HABITS,
    journalEntries: storedState.journalEntries || INITIAL_JOURNAL,
    knowledgeItems: storedState.knowledgeItems || INITIAL_KNOWLEDGE,
    chatHistory: storedState.chatHistory || INITIAL_CHAT,
    openRouterKey: finalKey,
    selectedModel: storedState.selectedModel || "anthropic/claude-3.5-sonnet",
    theme: storedState.theme || "light",
  };
}

export async function persistBrainState(state: BrainState): Promise<void> {
  const json = JSON.stringify(state);
  
  try {
    localStorage.setItem(STORAGE_KEY, json);
    if (state.openRouterKey) {
      localStorage.setItem("synapse_openrouter_key", state.openRouterKey);
    }
  } catch (e) {
    console.error("Failed to save to localStorage", e);
  }

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

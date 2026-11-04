import { normalizeAgentMemory } from "./agentMemory";
import { normalizeTaskAppearance } from "../utils/taskAppearance";
import { managedAuthEnabled } from "./managedAuth";
import { cloudEnabled, loadCloud, saveCloud } from "./cloudSync";
import { BrainState, Task, Habit, JournalEntry, KnowledgeItem, AIMessage, Goal, StateEnvelope, NoteFolder } from "../types";
import { syncHabitStreaks, getLocalDateString } from "../utils/habitStreaks";
import { normalizeTask } from "../utils/taskState";
import { loadUserStateFromDB, saveUserStateToDB } from "./database";

export const CURRENT_SCHEMA_VERSION = 1;
const STORAGE_KEY = "synapse_second_brain_state";
const STORAGE_ENVELOPE_KEY = "synapse_second_brain_envelope";

// Serialized promise queue to eliminate concurrent write races
let persistQueue: Promise<void> = Promise.resolve();

/**
 * Checks if running inside Tauri native runtime.
 */
export async function isTauriEnvironment(): Promise<boolean> {
  try {
    if (typeof window === "undefined") return false;
    const { invoke } = await import("@tauri-apps/api/core");
    return typeof invoke === "function" && Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
  } catch {
    return false;
  }
}

/**
 * Wraps state in a versioned, timestamped envelope.
 */
export function wrapStateEnvelope(state: BrainState, userId: string): StateEnvelope {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    userId,
    state: {
      ...state,
      userId,
    },
  };
}

/**
 * Unwraps data safely from either a versioned envelope or legacy raw state.
 */
export function unwrapStateEnvelope(data: any): {
  state: Partial<BrainState>;
  updatedAt?: string;
  schemaVersion?: number;
} {
  if (!data) return { state: {} };
  if (typeof data === "object" && data.schemaVersion && data.state) {
    return {
      state: data.state,
      updatedAt: data.updatedAt,
      schemaVersion: data.schemaVersion,
    };
  }
  // Legacy unversioned state
  return { state: data };
}

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
    id: "goal-career-tech",
    title: "Enhancing Technical Knowledge for Career (AI Engineer, SWE, etc..)",
    description: "Build deep technical skills, gain real-world experience, and become highly competitive for top AI/SWE roles.",
    sector: "career",
    timeframe: "long_term",
    targetDate: "2029-12-31",
    progress: 0,
    status: "in_progress",
    why: "Build world-class technical foundation to lead AI and software engineering innovations.",
    metrics: "Deep systems mastery + Staff AI Engineer placement",
    milestones: [],
    createdAt: new Date().toISOString(),
  },
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

export const DEFAULT_NOTE_FOLDERS: NoteFolder[] = [
  {
    id: "folder-academic",
    name: "Academic",
    parentId: null,
    color: "blue",
    createdAt: new Date().toISOString(),
  },
  {
    id: "folder-cs2110",
    name: "CS 2110",
    parentId: "folder-academic",
    color: "amber",
    createdAt: new Date().toISOString(),
  },
  {
    id: "folder-cs3600",
    name: "CS 3600",
    parentId: "folder-academic",
    color: "purple",
    createdAt: new Date().toISOString(),
  },
  {
    id: "folder-lmc3403",
    name: "LMC 3403",
    parentId: "folder-academic",
    color: "rose",
    createdAt: new Date().toISOString(),
  },
  {
    id: "folder-projects",
    name: "Projects & Code",
    parentId: null,
    color: "emerald",
    createdAt: new Date().toISOString(),
  },
  {
    id: "folder-personal",
    name: "Personal & Health",
    parentId: null,
    color: "cyan",
    createdAt: new Date().toISOString(),
  },
];

export const INITIAL_KNOWLEDGE: KnowledgeItem[] = [
  {
    id: "know-1",
    subject: "Distributed Systems & Raft Consensus",
    title: "Distributed Systems & Raft Consensus",
    status: "Executed",
    startDate: todayStr,
    endDate: tomorrowStr,
    domain: "Academic",
    folderId: "folder-cs3600",
    summary: "Leader election, log replication, safety guarantees, and split-brain resolution protocols.",
    content: `# Distributed Systems & Raft Consensus\n\n## Overview\nRaft is a consensus algorithm designed as an alternative to Multi-Paxos to be more understandable.\n\n### Core Properties\n- **Leader Election**: Randomized timers prevent split votes.\n- **Log Replication**: The leader accepts log entries and propagates them to followers.\n- **Safety**: State Machine Safety Property guarantees that if a server applies an entry at a given index, no other server will apply a different log entry for the same index.\n\n### Action Items\n- [x] Review term negotiation mechanics\n- [ ] Implement randomized election timeouts in Rust\n- [ ] Simulate network partitioning behavior`,
    coverGradient: "from-lime-300 via-amber-200 to-rose-300",
    itemCount: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "know-2",
    subject: "Rust Memory Safety & Zero-Cost Concurrency",
    title: "Rust Memory Safety & Zero-Cost Concurrency",
    status: "Synthesized",
    startDate: todayStr,
    endDate: tomorrowStr,
    domain: "Career",
    folderId: "folder-projects",
    summary: "Borrow checker ergonomics, crossbeam channels, atomic primitives, and SIMD optimizations.",
    content: `# Rust Memory Safety & Zero-Cost Concurrency\n\n## Memory Model\nRust achieves memory safety without a garbage collector through its ownership system, governed by compile-time rules:\n1. Each value in Rust has an owner.\n2. There can only be one owner at a time.\n3. When the owner goes out of scope, the value is dropped.\n\n## Concurrency Primitives\n- \`Arc<Mutex<T>>\` for shared mutable state\n- Crossbeam channels for lock-free message passing\n- Rayon for data parallelism\n\n\`\`\`rust\nuse std::sync::mpsc;\nuse std::thread;\n\nlet (tx, rx) = mpsc::channel();\nthread::spawn(move || {\n    tx.send("zero-cost abstractions").unwrap();\n});\n\`\`\``,
    coverGradient: "from-sky-300 via-indigo-200 to-purple-300",
    itemCount: 8,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "know-3",
    subject: "Quantitative Backtesting & Alpha Generation",
    title: "Quantitative Backtesting & Alpha Generation",
    status: "Review",
    startDate: todayStr,
    endDate: tomorrowStr,
    domain: "Finance",
    folderId: "folder-projects",
    summary: "Order book dynamics, microstructure signals, latency arbitrage bounds, and execution slippage.",
    content: `# Quantitative Backtesting & Alpha Generation\n\n## Market Microstructure\n- **Order Book Dynamics**: Level 2 / Level 3 depth analysis\n- **Slippage Bounds**: Modeling linear market impact\n- **Sharpe & Sortino Calibration**: Target Sortino > 2.5 with annualized volatility under 12%`,
    coverGradient: "from-emerald-300 via-teal-200 to-blue-300",
    itemCount: 12,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "know-4",
    subject: "Circadian Biology & Dopamine Management",
    title: "Circadian Biology & Dopamine Management",
    status: "Synthesized",
    startDate: todayStr,
    endDate: tomorrowStr,
    domain: "Health",
    folderId: "folder-personal",
    summary: "Morning photons, adenosine accumulation, temperature minimums, and cognitive resilience.",
    content: `# Circadian Biology & Dopamine Management\n\n## Core Protocols\n1. **Morning Light Viewing**: 10–15 minutes of outdoor sunlight within 30 minutes of waking.\n2. **Adenosine Delay**: Delay caffeine intake for 90–120 minutes upon waking to avoid afternoon crash.\n3. **Dopamine Baseline**: Avoid stacking multiple dopamine spikes (e.g. pre-workout + music + phone). Maintain intermittent reward scheduling.`,
    coverGradient: "from-rose-300 via-pink-200 to-amber-200",
    itemCount: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
  const envKey = (typeof import.meta !== "undefined" && import.meta.env?.VITE_OPENROUTER_API_KEY) || "";
  const targetUserId = userId || "guest";
  let storedState: Partial<BrainState> = {};
  let loadedFrom = "none";

  const inTauri = await isTauriEnvironment();

  if (cloudEnabled) storedState = (await loadCloud()).state;

  // 1. CANONICAL STORE: If in Tauri desktop app, native file storage is primary
  if (inTauri && !cloudEnabled) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const nativeData = await invoke<string | null>("load_brain_data");
      if (nativeData) {
        const parsed = JSON.parse(nativeData);
        const { state } = unwrapStateEnvelope(parsed);
        if (state && (state.tasks || state.habits || state.goals)) {
          storedState = state;
          loadedFrom = "tauri_native";
        }
      }
      const nativeKey = await invoke<string | null>("get_openrouter_api_key");
      if (nativeKey && !storedState.openRouterKey) {
        storedState.openRouterKey = nativeKey;
      }
    } catch (e) {
      console.warn("[Storage] Could not load from Tauri native storage:", e);
    }
  }

  // 2. CANONICAL STORE FOR BROWSER / FALLBACK FOR TAURI: IndexedDB
  if (!cloudEnabled && !storedState.tasks) {
    try {
      const dbState = await loadUserStateFromDB(targetUserId);
      if (dbState && (dbState.tasks || dbState.habits || dbState.goals)) {
        storedState = dbState;
        loadedFrom = "indexed_db";
      }
    } catch (e) {
      console.warn("[Storage] Could not load from IndexedDB:", e);
    }
  }

  // 3. EMERGENCY OFFLINE FALLBACK: LocalStorage
  if (!cloudEnabled && !storedState.tasks && typeof localStorage !== "undefined") {
    try {
      const localEnv = localStorage.getItem(STORAGE_ENVELOPE_KEY) || localStorage.getItem(STORAGE_KEY);
      if (localEnv) {
        const parsed = JSON.parse(localEnv);
        const { state } = unwrapStateEnvelope(parsed);
        if (state && (state.tasks || state.habits || state.goals)) {
          storedState = state;
          loadedFrom = "local_storage";
        }
      }
    } catch (e) {
      console.error("[Storage] Failed to read from localStorage fallback:", e);
    }
  }

  console.info(`[Storage] Brain state initialized from canonical store: ${loadedFrom}`);

  const credentialKey = managedAuthEnabled ? `synapse_openrouter_key_${targetUserId}` : "synapse_openrouter_key";
  const finalKey = (managedAuthEnabled ? "" : storedState.openRouterKey || envKey) || (typeof localStorage !== "undefined" ? localStorage.getItem(credentialKey) : null) || "";

  // Ensure sections exist
  const sections = Array.isArray(storedState.sections)
    ? storedState.sections
    : DEFAULT_SECTIONS;

  // Ensure subsections exist for every section
  const subsections: Record<string, string[]> = { ...DEFAULT_SUBSECTIONS, ...(storedState.subsections || {}) };
  sections.forEach((sec) => {
    if (!subsections[sec] || subsections[sec].length === 0) {
      subsections[sec] = ["General"];
    }
  });

  // Canonical Task Normalization: Status is single source of truth; completed is synchronized
  const rawTasks = Array.isArray(storedState.tasks) ? storedState.tasks : INITIAL_TASKS;
  const tasks: Task[] = rawTasks.map((t, idx) => {
    const section = t.section || sections[idx % sections.length];
    const sectionSubs = subsections[section] || ["General"];
    const subsection = t.subsection || sectionSubs[0] || "General";
    return normalizeTask({
      ...t,
      section,
      subsection,
    });
  });

  // Ensure all habits have accurate, continuously-calculated streaks from actual history
  const rawHabits = Array.isArray(storedState.habits) ? storedState.habits : INITIAL_HABITS;
  const habits = rawHabits.map((h) => syncHabitStreaks(h));

  // Ensure goals exist and have valid milestone progress
  const rawGoals = Array.isArray(storedState.goals) ? storedState.goals : INITIAL_GOALS;
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

  // Normalize Note Folders hierarchy
  const rawFolders = Array.isArray(storedState.noteFolders)
    ? storedState.noteFolders
    : DEFAULT_NOTE_FOLDERS;
  const noteFolders: NoteFolder[] = rawFolders.map((f: any) => ({
    id: f.id,
    name: f.name || "Untitled Folder",
    parentId: f.parentId || null,
    color: f.color || "blue",
    icon: f.icon,
    createdAt: f.createdAt || new Date().toISOString(),
    updatedAt: f.updatedAt,
  }));

  // Normalize Knowledge / Notes with content, folderId, and title
  const rawKnowledge = Array.isArray(storedState.knowledgeItems)
    ? storedState.knowledgeItems
    : INITIAL_KNOWLEDGE;

  const knowledgeItems: KnowledgeItem[] = rawKnowledge.map((item: any) => {
    const title = item.title || item.subject || "Untitled Note";
    const content = item.content || item.summary || "";
    let folderId = item.folderId !== undefined ? item.folderId : null;

    // Smart folder mapping if unfiled
    if (folderId === undefined || folderId === null) {
      const lower = (title + " " + (item.domain || "")).toLowerCase();
      if (lower.includes("2110")) folderId = "folder-cs2110";
      else if (lower.includes("3600")) folderId = "folder-cs3600";
      else if (lower.includes("3403")) folderId = "folder-lmc3403";
      else if (lower.includes("academic") || lower.includes("exam") || lower.includes("cs")) folderId = "folder-academic";
      else if (lower.includes("health") || lower.includes("habit") || lower.includes("dopamine")) folderId = "folder-personal";
      else if (lower.includes("career") || lower.includes("finance") || lower.includes("rust") || lower.includes("project")) folderId = "folder-projects";
      else folderId = null;
    }

    return {
      ...item,
      id: item.id || `know-${Date.now()}`,
      title,
      subject: title,
      content,
      summary: item.summary || (content.length > 200 ? content.slice(0, 197) + "..." : content),
      folderId,
      status: item.status || "Synthesized",
      startDate: item.startDate || todayStr,
      endDate: item.endDate || tomorrowStr,
      domain: item.domain || "General",
      coverGradient: item.coverGradient || "from-lime-300 via-amber-200 to-rose-300",
      itemCount: item.itemCount || 1,
      pinned: Boolean(item.pinned),
      favorite: Boolean(item.favorite),
      tags: Array.isArray(item.tags) ? item.tags : [],
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || new Date().toISOString(),
    };
  });

  return {
    userId: targetUserId,
    agentMemory: normalizeAgentMemory(storedState.agentMemory),
    tasks,
    goals,
    sections,
    subsections,
    habits,
    journalEntries: storedState.journalEntries || INITIAL_JOURNAL,
    knowledgeItems,
    trackerItems: storedState.trackerItems || [],
    noteFolders,
    chatHistory: storedState.chatHistory || INITIAL_CHAT,
    conversationId: storedState.conversationId,
    conversations: storedState.conversations || [],
    openRouterKey: finalKey,
    selectedModel: storedState.selectedModel || "anthropic/claude-3.5-sonnet",
    theme: storedState.theme || "light",
    taskAppearance: normalizeTaskAppearance(storedState.taskAppearance),
    dailyBrief: storedState.dailyBrief,
    auditLog: storedState.auditLog || [],
  };
}

/**
 * Persists brain state canonically with versioned envelope, avoiding triple-store race conditions.
 */
async function persistNow(state: BrainState, targetUserId: string): Promise<void> {
  const cleanState = { ...state, tasks: state.tasks.map(t => normalizeTask(t)), userId: targetUserId,
    agentMemory: normalizeAgentMemory(state.agentMemory) };
    if (cloudEnabled) {
      await saveCloud(cleanState);
      if (managedAuthEnabled) {
        const key = `synapse_openrouter_key_${targetUserId}`;
        try {
          if (cleanState.openRouterKey) localStorage.setItem(key, cleanState.openRouterKey);
          else localStorage.removeItem(key);
        } catch { /* Cloud persistence has already succeeded. */ }
        return;
      }
    }
    const envelope = wrapStateEnvelope(cleanState, targetUserId);
    const envelopeJson = JSON.stringify(envelope);

    const inTauri = await isTauriEnvironment();

    if (inTauri) {
      // 1. CANONICAL PRIMARY: Tauri Native Storage
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_brain_data", { data: envelopeJson });
      } catch (e) {
        console.error("[Storage] Desktop save failed:", e);
        throw new Error("Could not save changes to desktop storage.");
      }
      // Credentials are a separate write; failure must not misreport an already saved action.
      if (cleanState.openRouterKey) {
        import("@tauri-apps/api/core").then(({ invoke }) => invoke("save_openrouter_api_key", { apiKey: cleanState.openRouterKey })).catch(() => {});
      }
      // Non-blocking background sync to IndexedDB for multi-user database records
      saveUserStateToDB(targetUserId, cleanState).catch(() => {});
    } else {
      // 1. CANONICAL PRIMARY FOR WEB: IndexedDB
      try {
        await saveUserStateToDB(targetUserId, cleanState);
      } catch (e) {
        console.warn("[Storage] IndexedDB save failed, using LocalStorage fallback:", e);
        try {
          localStorage.setItem(STORAGE_ENVELOPE_KEY, envelopeJson);
        } catch { throw new Error("Could not save changes to browser storage."); }
      }
    }

    // Secondary offline fallback & fast cache
    try {
      localStorage.setItem(STORAGE_ENVELOPE_KEY, envelopeJson);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanState));
      if (cleanState.openRouterKey) {
        localStorage.setItem("synapse_openrouter_key", cleanState.openRouterKey);
      }
    } catch {}

}

export async function persistBrainState(input: BrainState | (() => BrainState), userId?: string, onPersisted?: (saved: BrainState) => void): Promise<void> {
  persistQueue = persistQueue.catch(() => {}).then(async () => {
    const state = typeof input === "function" ? input() : input;
    const targetUserId = userId || state.userId || "guest";
    if (state.userId && state.userId !== targetUserId) throw new Error("Account changed; save stopped.");
    await persistNow(state, targetUserId);
    onPersisted?.(state);
  });
  return persistQueue;
}

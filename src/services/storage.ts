import { BrainState, Task, Habit, JournalEntry, KnowledgeItem, AIMessage } from "../types";

const STORAGE_KEY = "synapse_second_brain_state";

const todayStr = new Date().toISOString().split("T")[0];
const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split("T")[0];
const twoDaysAgoStr = new Date(Date.now() - 172800000).toISOString().split("T")[0];

export const INITIAL_TASKS: Task[] = [
  // Column 1: Intake & Morning Kickoff
  {
    id: "task-1",
    title: "Allocate Case to User",
    description: "Assign incoming high-priority triage items to appropriate life focus blocks",
    dueDate: todayStr,
    priority: "high",
    stage: "intake",
    domain: "career",
    completed: true,
    assignedAvatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
    assignedName: "Alex R.",
    connectedTo: ["task-3", "task-4"],
  },
  {
    id: "task-2",
    title: "Acknowledge Case receipt to customer",
    description: "Send initial status update and alignment confirmation to team",
    dueDate: todayStr,
    priority: "medium",
    stage: "intake",
    domain: "career",
    completed: true,
    assignedAvatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80",
    assignedName: "David K.",
    connectedTo: ["task-6"],
  },

  // Column 2: Active Execution & Deep Work
  {
    id: "task-3",
    title: "Identify Issue Category",
    description: "Classify system constraints and architecture requirements",
    dueDate: todayStr,
    priority: "urgent",
    stage: "execution",
    domain: "learning",
    completed: true,
    assignedAvatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80",
    assignedName: "Elena S.",
    connectedTo: ["task-8"],
  },
  {
    id: "task-4",
    title: "Identify Issue Severity",
    description: "Gauge latency impact across distributed neural network endpoints",
    dueDate: todayStr,
    priority: "high",
    stage: "execution",
    domain: "career",
    completed: true,
    assignedAvatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&auto=format&fit=crop&q=80",
    assignedName: "Sophia L.",
    connectedTo: ["task-9"],
  },
  {
    id: "task-5",
    title: "Identify Issue Impact",
    description: "Map downstream user journey touchpoints and dependencies",
    dueDate: todayStr,
    priority: "medium",
    stage: "execution",
    domain: "mindset",
    completed: false,
    assignedAvatar: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=100&auto=format&fit=crop&q=80",
    assignedName: "Marcus P.",
  },
  {
    id: "task-6",
    title: "Allocate to Resolution Team",
    description: "Delegate non-essential operational friction and establish sprint checkpoints",
    dueDate: todayStr,
    priority: "low",
    stage: "execution",
    domain: "career",
    completed: false,
    assignedAvatar: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=100&auto=format&fit=crop&q=80",
    assignedName: "Liam T.",
  },
  {
    id: "task-7",
    title: "Advise Customer of Resolution estimate",
    description: "Provide transparent timeline and expected milestone deliverables",
    dueDate: todayStr,
    priority: "medium",
    stage: "execution",
    domain: "career",
    completed: false,
    assignedAvatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100&auto=format&fit=crop&q=80",
    assignedName: "Maya W.",
  },

  // Column 3: Technical Resolution
  {
    id: "task-8",
    title: "Identify Issue Dependencies",
    description: "Audit Rust core thread pool and memory safety benchmarks",
    dueDate: todayStr,
    priority: "high",
    stage: "resolution",
    domain: "learning",
    completed: false,
    connectedTo: ["task-13"],
  },
  {
    id: "task-9",
    title: "Identify Issue Resolution",
    description: "Synthesize optimal caching strategy and client IPC bridge",
    dueDate: todayStr,
    priority: "urgent",
    stage: "resolution",
    domain: "learning",
    completed: false,
    connectedTo: ["task-13"],
  },
  {
    id: "task-10",
    title: "Estimate Resolution Time",
    description: "Deep work 90-minute hyperfocus block scheduled",
    dueDate: todayStr,
    priority: "urgent",
    stage: "resolution",
    domain: "career",
    completed: false,
    assignedAvatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80",
    assignedName: "Nathan B.",
  },
  {
    id: "task-11",
    title: "Advise Customer of Resolution Estimate",
    description: "Review automated synthetic summary and client sign-off",
    dueDate: todayStr,
    priority: "medium",
    stage: "resolution",
    domain: "career",
    completed: false,
    assignedAvatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&auto=format&fit=crop&q=80",
    assignedName: "Chloe H.",
  },
  {
    id: "task-12",
    title: "Advise Customer Issue Resolved",
    description: "Final audit report, knowledge vault sync, and habit debrief",
    dueDate: todayStr,
    priority: "low",
    stage: "resolution",
    domain: "career",
    completed: false,
  },

  // Column 4: New Tasks & Daily Habits (Tactile grid buttons)
  {
    id: "task-13",
    title: "Request Processing",
    description: "Central AI neural pipeline orchestrator processing active life threads",
    dueDate: todayStr,
    priority: "urgent",
    stage: "next-actions",
    domain: "ai",
    completed: false,
    isFocusPill: true, // Stark black card highlighted with arrow!
  },
  {
    id: "task-14",
    title: "Problem Resolution",
    dueDate: todayStr,
    priority: "high",
    stage: "next-actions",
    domain: "learning",
    completed: false,
  },
  {
    id: "task-15",
    title: "Customer Communication",
    dueDate: todayStr,
    priority: "medium",
    stage: "next-actions",
    domain: "career",
    completed: false,
  },
  {
    id: "task-16",
    title: "Testing and Verification",
    dueDate: todayStr,
    priority: "high",
    stage: "next-actions",
    domain: "learning",
    completed: false,
  },
  {
    id: "task-17",
    title: "Customer Notification",
    dueDate: todayStr,
    priority: "low",
    stage: "next-actions",
    domain: "career",
    completed: false,
  },
  {
    id: "task-18",
    title: "Customer Satisfaction",
    dueDate: todayStr,
    priority: "low",
    stage: "next-actions",
    domain: "mindset",
    completed: false,
  },
];

export const INITIAL_HABITS: Habit[] = [
  {
    id: "habit-1",
    name: "Morning Meditation & Cold Exposure",
    description: "15 min mindfulness breathwork + cold shower kickstart",
    domain: "health",
    frequency: "daily",
    streak: 18,
    bestStreak: 24,
    history: {
      [todayStr]: true,
      [yesterdayStr]: true,
      [twoDaysAgoStr]: true,
    },
    timeOfDay: "morning",
    icon: "Sparkles",
  },
  {
    id: "habit-2",
    name: "Deep Work Sprint (90m uninterrupted)",
    description: "Zero distraction, phones silenced, full flow state",
    domain: "career",
    frequency: "daily",
    streak: 12,
    bestStreak: 30,
    history: {
      [todayStr]: true,
      [yesterdayStr]: true,
      [twoDaysAgoStr]: true,
    },
    timeOfDay: "morning",
    icon: "Flame",
  },
  {
    id: "habit-3",
    name: "Daily Journal & Stoic Reflection",
    description: "Evening debrief, gratitude, cognitive audit",
    domain: "mindset",
    frequency: "daily",
    streak: 25,
    bestStreak: 45,
    history: {
      [todayStr]: false,
      [yesterdayStr]: true,
      [twoDaysAgoStr]: true,
    },
    timeOfDay: "evening",
    icon: "BookOpen",
  },
  {
    id: "habit-4",
    name: "Zone 2 Cardio / Strength Training",
    description: "45 mins aerobic base building or compound lifts",
    domain: "health",
    frequency: "daily",
    streak: 9,
    bestStreak: 15,
    history: {
      [todayStr]: false,
      [yesterdayStr]: true,
      [twoDaysAgoStr]: false,
    },
    timeOfDay: "afternoon",
    icon: "HeartPulse",
  },
  {
    id: "habit-5",
    name: "Read 20 Pages (Technical / Philosophy)",
    description: "High signal knowledge accumulation",
    domain: "learning",
    frequency: "daily",
    streak: 14,
    bestStreak: 21,
    history: {
      [todayStr]: true,
      [yesterdayStr]: true,
      [twoDaysAgoStr]: true,
    },
    timeOfDay: "evening",
    icon: "Compass",
  },
];

export const INITIAL_JOURNAL: JournalEntry[] = [
  {
    id: "journal-1",
    date: todayStr,
    title: "Deep Architecture Flow & Cognitive Clarity",
    content: "Woke up energized. Completed morning breathwork without touching the phone. Handled the core Rust IPC integration and laid out the second brain journey board. Feeling strong alignment between strategic vision and daily tactical execution.",
    mood: "great",
    wins: ["Rust core zero-error build", "Flawless UI parity with the master design", "Maintained 90m deep work block"],
    challenges: ["Context switching between multiple terminal streams"],
    aiReflection: "Your execution velocity is peaking. Protect this focus state by scheduling tomorrow's deep work block before opening communications.",
    tags: ["Productivity", "Tauri", "FlowState"],
  },
  {
    id: "journal-2",
    date: yesterdayStr,
    title: "Energy Calibration & Habit Momentum",
    content: "Solid consistency throughout the afternoon. Felt a slight mid-day dip around 2 PM, resolved it with a 15-minute sunlight walk instead of caffeine. Read 25 pages of distributed systems theory.",
    mood: "great",
    wins: ["18-day morning ritual streak maintained", "Replaced afternoon coffee with sunlight walk"],
    challenges: ["Mind wandering slightly during evening reading"],
    aiReflection: "The replacement habit (sunlight walk instead of caffeine) preserved your sleep quality and evening circadian rhythm. Keep this cadence.",
    tags: ["Habits", "Health", "Energy"],
  },
];

export const INITIAL_KNOWLEDGE: KnowledgeItem[] = [
  {
    id: "know-1",
    subject: "Design Sprint: Second Brain Neumorphic UI",
    status: "Executed",
    startDate: "2026-10-24 09:30",
    endDate: "2026-10-26 18:00",
    domain: "career",
    assignedUser: "Narain Singaram",
    assignedAvatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
    summary: "Complete blueprint for tactile glassmorphic and soft pill navigation design system.",
  },
  {
    id: "know-2",
    subject: "OpenRouter Multi-LLM Orchestration Guide",
    status: "Executed",
    startDate: "2026-10-25 14:00",
    endDate: "2026-10-26 21:00",
    domain: "ai",
    assignedUser: "Narain Singaram",
    assignedAvatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80",
    summary: "API routing patterns, fallback models, token budgeting, and live prompt synthesis.",
  },
  {
    id: "know-3",
    subject: "Tauri v2 IPC & Native Rust Storage Architecture",
    status: "Synthesized",
    startDate: "2026-10-26 08:00",
    endDate: "2026-10-27 12:00",
    domain: "learning",
    assignedUser: "Narain Singaram",
    assignedAvatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&auto=format&fit=crop&q=80",
    summary: "Secure command handling, zero-overhead disk persistence, and offline data redundancy.",
  },
  {
    id: "know-4",
    subject: "High Performance Daily Habit Streaks & Dopamine Stacking",
    status: "Review",
    startDate: "2026-10-26 10:00",
    endDate: "2026-10-28 17:00",
    domain: "health",
    assignedUser: "Narain Singaram",
    assignedAvatar: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=100&auto=format&fit=crop&q=80",
    summary: "Neurobiology of habit formation, visual reinforcement through tactile UI cards.",
  },
];

export const INITIAL_CHAT: AIMessage[] = [
  {
    id: "msg-1",
    role: "assistant",
    content: "Welcome to your **Synapse AI Second Brain**! I'm synchronized with your active tasks, daily habits, and reflections.\n\nToday you have **3 high-priority tasks** in motion, and your morning meditation streak is at **18 days**! How would you like to direct your focus today?",
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  },
];

export async function loadInitialState(): Promise<BrainState> {
  // Check for OpenRouter API key from .env first
  const envKey = import.meta.env.VITE_OPENROUTER_API_KEY || "";

  let storedState: Partial<BrainState> = {};

  // Try Tauri native invoke first if available
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
    // Tauri not running or in browser mode, fallback to localStorage
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

  return {
    tasks: storedState.tasks || INITIAL_TASKS,
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
  
  // Save to localStorage immediately
  try {
    localStorage.setItem(STORAGE_KEY, json);
    if (state.openRouterKey) {
      localStorage.setItem("synapse_openrouter_key", state.openRouterKey);
    }
  } catch (e) {
    console.error("Failed to save to localStorage", e);
  }

  // Also sync to Tauri native Rust core if running in Tauri
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_brain_data", { data: json });
    if (state.openRouterKey) {
      await invoke("save_openrouter_api_key", { apiKey: state.openRouterKey });
    }
  } catch {
    // Graceful fallback when running in browser dev mode
  }
}

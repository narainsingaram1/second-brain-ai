import type { AgentMemory } from "../services/agentMemory";
export type LifeDomain = 'career' | 'health' | 'mindset' | 'learning' | 'ai';

export type TaskStatus = 'not_started' | 'in_progress' | 'completed';

export type GoalSector = 'career' | 'academics' | 'finance' | 'health' | 'mindset' | 'personal';
export type GoalTimeframe = 'quarterly' | 'yearly' | 'long_term' | 'lifetime';
export type GoalStatus = 'not_started' | 'in_progress' | 'achieved' | 'on_hold';

export interface GoalMilestone {
  id: string;
  title: string;
  completed: boolean;
  targetDate?: string;
}

export interface Goal {
  id: string;
  title: string;
  description?: string;
  sector: GoalSector;
  timeframe: GoalTimeframe;
  targetDate?: string;
  progress: number; // 0 to 100
  status: GoalStatus;
  milestones: GoalMilestone[];
  why?: string; // Core personal motivation / conviction
  metrics?: string; // Target metric e.g. "$15,000 saved", "4.0 GPA"
  color?: string;
  tags?: string[];
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  dueDate: string; // YYYY-MM-DD
  priority: 'urgent' | 'high' | 'medium' | 'low';
  section: string; // Academic, Career, Finance, Health, or custom section
  subsection?: string; // Optional subsection e.g. CS 1332, Workouts, etc.
  status: TaskStatus; // Canonical source of truth: 'not_started' | 'in_progress' | 'completed'
  completed: boolean; // Synchronized derived flag: completed === (status === 'completed')
  subtasks?: { id: string; title: string; completed: boolean }[];
  tags?: string[];
  stage?: string;
  domain?: LifeDomain;
}

export interface StateEnvelope {
  schemaVersion: number;
  updatedAt: string;
  userId: string;
  state: BrainState;
}

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  provider: 'google' | 'email' | 'guest';
  passwordHash?: string;
  createdAt: string;
  lastLoginAt: string;
}

export interface AuthSession {
  currentUser: UserAccount | null;
  isGuest: boolean;
}

export interface Habit {
  id: string;
  name: string;
  description?: string;
  domain?: LifeDomain;
  frequency: 'daily' | 'weekdays' | 'weekends';
  streak: number;
  bestStreak: number;
  history: Record<string, boolean>; // 'YYYY-MM-DD': boolean
  timeOfDay?: 'morning' | 'afternoon' | 'evening';
  icon?: string;
}

export interface JournalEntry {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  content: string;
  mood: 'ecstatic' | 'great' | 'neutral' | 'tired' | 'stressed';
  wins: string[];
  challenges: string[];
  aiReflection?: string;
  tags: string[];
}

export type NoteFolderColor = 'amber' | 'blue' | 'emerald' | 'purple' | 'rose' | 'cyan' | 'indigo' | 'slate';

export interface NoteFolder {
  id: string;
  name: string;
  parentId: string | null; // null for top-level root folders, or folder ID for nested subfolders
  color?: NoteFolderColor;
  icon?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface KnowledgeItem {
  id: string;
  subject: string;
  title?: string; // Canonical alias for subject
  content?: string; // Full markdown / rich text content
  summary: string; // Snippet or summary
  folderId?: string | null; // Which folder it belongs to (null = root/unfiled)
  tags?: string[];
  pinned?: boolean;
  favorite?: boolean;
  status: 'Executed' | 'Synthesized' | 'Review' | 'Draft';
  startDate: string;
  endDate: string;
  domain?: string;
  coverGradient?: string;
  itemCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type Note = KnowledgeItem;

export interface AIMessage {
  sources?: Array<{ id: string; type: string; title: string; offset?: number }>;
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  rememberedIds?: string[];
  memoryNotice?: string;
}

export interface ConversationThread {
  id: string;
  title: string;
  messages: AIMessage[];
  updatedAt: string;
}

export interface DailyBrief {
  date: string; // YYYY-MM-DD
  generatedAt: string;
  headline: string;
  summary: string;
  topPriorities: { id?: string; title: string; reason: string }[];
  mindsetDirective: string;
  energyAdvice: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  timeString: string;
  action: string;
  entityType: 'task' | 'habit' | 'journal' | 'knowledge' | 'section' | 'goal';
  entityTitle: string;
  details?: string;
  canUndo: boolean;
}

export interface TaskSubsectionStyle {
  accent: string;
  visual: string;
}

export interface TaskAppearance {
  accent: string;
  icons: Record<string, string>;
  subsections?: Record<string, TaskSubsectionStyle>;
}

export interface BrainState {
  agentMemory?: AgentMemory;
  userId?: string;
  tasks: Task[];
  goals: Goal[];
  sections: string[];
  subsections: Record<string, string[]>; // Section -> array of Subsection names
  habits: Habit[];
  journalEntries: JournalEntry[];
  knowledgeItems: KnowledgeItem[];
  noteFolders?: NoteFolder[];
  chatHistory: AIMessage[];
  conversationId?: string;
  conversations?: ConversationThread[];
  openRouterKey: string;
  selectedModel: string;
  theme: 'light' | 'dark';
  taskAppearance?: TaskAppearance;
  dailyBrief?: DailyBrief;
  auditLog?: AuditLogEntry[];
}

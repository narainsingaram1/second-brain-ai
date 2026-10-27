export type LifeDomain = 'career' | 'health' | 'mindset' | 'learning' | 'ai';

export type TaskStatus = 'not_started' | 'in_progress' | 'completed';

export interface Task {
  id: string;
  title: string;
  description?: string;
  dueDate: string; // YYYY-MM-DD
  priority: 'urgent' | 'high' | 'medium' | 'low';
  section: string; // Academic, Career, Finance, Health, or custom section
  subsection?: string; // Optional subsection e.g. CS 1332, Workouts, etc.
  completed: boolean;
  status?: TaskStatus; // 'not_started' | 'in_progress' | 'completed'
  subtasks?: { id: string; title: string; completed: boolean }[];
  tags?: string[];
  stage?: string;
  domain?: LifeDomain;
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

export interface KnowledgeItem {
  id: string;
  subject: string;
  status: 'Executed' | 'Synthesized' | 'Review' | 'Draft';
  startDate: string;
  endDate: string;
  domain?: string;
  summary: string;
  coverGradient?: string;
  itemCount?: number;
}

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
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
  entityType: 'task' | 'habit' | 'journal' | 'knowledge' | 'section';
  entityTitle: string;
  details?: string;
  canUndo: boolean;
}

export interface BrainState {
  userId?: string;
  tasks: Task[];
  sections: string[];
  subsections: Record<string, string[]>; // Section -> array of Subsection names
  habits: Habit[];
  journalEntries: JournalEntry[];
  knowledgeItems: KnowledgeItem[];
  chatHistory: AIMessage[];
  openRouterKey: string;
  selectedModel: string;
  theme: 'light' | 'dark';
  dailyBrief?: DailyBrief;
  auditLog?: AuditLogEntry[];
}

export type LifeDomain = 'career' | 'health' | 'mindset' | 'learning' | 'ai';

export interface Task {
  id: string;
  title: string;
  description?: string;
  dueDate: string; // YYYY-MM-DD
  priority: 'urgent' | 'high' | 'medium' | 'low';
  stage: 'intake' | 'execution' | 'resolution' | 'next-actions';
  domain: LifeDomain;
  completed: boolean;
  assignedAvatar?: string;
  assignedName?: string;
  subtasks?: { id: string; title: string; completed: boolean }[];
  tags?: string[];
  isFocusPill?: boolean;
  connectedTo?: string[]; // IDs of tasks in the next column to connect with bezier curves
  columnOrder?: number;
}

export interface Habit {
  id: string;
  name: string;
  description?: string;
  domain: LifeDomain;
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
  domain: LifeDomain;
  assignedUser?: string;
  assignedAvatar?: string;
  url?: string;
  summary: string;
}

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface DomainInfo {
  id: LifeDomain;
  label: string;
  avatar: string;
  badgeCount: number;
  color: string;
}

export interface BrainState {
  tasks: Task[];
  habits: Habit[];
  journalEntries: JournalEntry[];
  knowledgeItems: KnowledgeItem[];
  chatHistory: AIMessage[];
  openRouterKey: string;
  selectedModel: string;
  theme: 'light' | 'dark';
}

import type { AgentMemory } from "../services/agentMemory";
export type LifeDomain = 'career' | 'health' | 'mindset' | 'learning' | 'ai';

export type TaskStatus = 'not_started' | 'in_progress' | 'completed';

export type TrackerStatus =
  | 'not_started'
  | 'in_progress'
  | 'done'
  | 'review'
  | 'applied'
  | 'screening'
  | 'onsite'
  | 'offer'
  | 'rejected';

export type TrackerKind = 'leetcode' | 'job_application';

export interface TrackerItem {
  id: string;
  workspaceId?: string;
  kind: TrackerKind;
  title: string;
  subject: string;
  subjectUrl?: string;
  status: TrackerStatus;
  fields: Record<string, unknown>;
  history: Record<string, unknown>;
  streak: number;
  bestStreak: number;
  tags?: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type Tracker = TrackerItem;

export type WorkspaceColor = 'purple' | 'blue' | 'green' | 'amber' | 'rose';
export interface ResumeVersion {
  id: string;
  name: string;
  size: number;
  mime: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  uploadedAt: string;
}
export interface Workspace {
  id: string;
  name: string;
  description: string;
  template: 'career' | 'academic' | 'health' | 'blank';
  color: WorkspaceColor;
  notes: string;
  createdAt: string;
  /** Health workspaces only: personal targets the health metrics are measured against. */
  health?: HealthProfile;
  resumes?: ResumeVersion[];
  currentResumeId?: string;
}

/** Personal numbers the health metrics use. Every field is optional; sensible defaults fill the gaps. */
export interface HealthProfile {
  sleepGoalMin?: number;
  stepGoal?: number;
  /** Measured or known maximum heart rate. Otherwise estimated from workouts or age. */
  maxHr?: number;
  birthYear?: number;
  /** Only used to pick the training-load (TRIMP) weighting. */
  sex?: 'female' | 'male';
}

export interface HealthWorkout {
  id: string;
  type: string;
  /** Local time, "YYYY-MM-DD HH:mm". */
  start: string;
  minutes: number;
  energyKcal?: number;
  distanceKm?: number;
  avgHr?: number;
  maxHr?: number;
}

/** One calendar day of Apple Health data (id "health-YYYY-MM-DD"), plus the user's own tags and note. */
export interface HealthDay {
  id: string;
  date: string;
  /** Daily values keyed by HEALTH_METRICS keys, in the units listed there. */
  metrics: Record<string, number>;
  /** Local times of the night that ended this morning, "YYYY-MM-DD HH:mm". */
  sleepStart?: string;
  sleepEnd?: string;
  workouts?: HealthWorkout[];
  tags?: string[];
  note?: string;
  source?: string;
  updatedAt: string;
}

/** A class the user is taking. Lives inside an academic workspace. */
export interface Course {
  id: string;
  workspaceId: string;
  code: string; // e.g. "CS 1332"
  name: string; // e.g. "Data Structures & Algorithms"
  term?: string;
  instructor?: string;
  /** Grade weights, scores and letter scale for this course. */
  grading?: import("../utils/grades").CourseGrading;
  createdAt: string;
  updatedAt: string;
}

export interface StudyFolder {
  id: string;
  courseId: string;
  parentId: string | null;
  name: string;
  createdAt: string;
}

export type StudyDocumentKind = 'pdf' | 'docx' | 'pptx' | 'text' | 'image';

/**
 * Metadata for an uploaded file. The extracted text is stored separately (IndexedDB plus an
 * optional cloud table) so large course materials never bloat the synced snapshot.
 */
export interface StudyDocument {
  id: string;
  courseId: string;
  folderId: string | null;
  name: string;
  kind: StudyDocumentKind;
  size: number; // bytes of the original file
  pages?: number;
  chars: number; // length of the extracted text
  hash: string; // SHA-256 of the extracted text
  summary?: string;
  createdAt: string;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  sourceDocId?: string;
  /** Spaced repetition (SM-2 style). due is a local YYYY-MM-DD date. */
  due: string;
  interval: number; // days
  ease: number;
  reps: number;
  lapses: number;
}

export interface FlashcardDeck {
  id: string;
  courseId: string;
  title: string;
  sourceDocIds: string[];
  cards: Flashcard[];
  createdAt: string;
  updatedAt: string;
}

export interface QuizQuestion {
  id: string;
  type: 'mcq' | 'short';
  prompt: string;
  choices?: string[]; // mcq only
  answerIndex?: number; // mcq only
  answer: string; // correct choice text, or the model answer for short questions
  explanation?: string;
  sourceDocId?: string;
}

export interface QuizAttempt {
  id: string;
  at: string;
  score: number;
  total: number;
  /** Question IDs answered incorrectly, for targeted review. */
  missed: string[];
}

export interface Quiz {
  id: string;
  courseId: string;
  title: string;
  sourceDocIds: string[];
  questions: QuizQuestion[];
  attempts: QuizAttempt[];
  createdAt: string;
}

export interface StudyState {
  courses: Course[];
  folders: StudyFolder[];
  documents: StudyDocument[];
  decks: FlashcardDeck[];
  quizzes: Quiz[];
}

export type RecordType =
  | 'task'
  | 'goal'
  | 'habit'
  | 'journal'
  | 'knowledge'
  | 'tracker';

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
  /** Optional local due time, 24-hour "HH:MM" (e.g. "23:59"). Absent means any time that day. */
  dueTime?: string;
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

/** Image attached to a chat message. Only a small thumbnail is persisted; full images stay in memory. */
export interface ImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  /** Small JPEG data URL (about 160 px) for display in the transcript. */
  thumbnail?: string;
}

/** One thing the assistant did while working on a reply, shown live and kept with the reply. */
export type AgentStepKind = "think" | "prepare" | "records" | "web" | "email" | "calendar" | "change" | "memory" | "image" | "approval" | "write";
export interface AgentStep {
  id: string;
  kind: AgentStepKind;
  /** What it is doing or did, in plain words: "Searching the web for “LC-3 ISA”". */
  label: string;
  /** The model's reasoning, or a short result ("Found 4 matches"). */
  detail?: string;
  /** Things the step touched: record titles, or web sources as "title|url". */
  items?: string[];
  status: "running" | "done" | "error";
  startedAt: number;
  endedAt?: number;
  /** Superseded steps (e.g. a thinking pass that produced nothing to show). */
  hidden?: boolean;
}

/** A change the assistant successfully executed and saved in the user's workspace during this turn. */
export interface AppliedAction {
  action: string;
  type: string;
  id: string;
  title: string;
  summary: string;
  details?: string[];
  remove?: boolean;
}

export interface AIMessage {
  sources?: Array<{ id: string; type: string; title: string; offset?: number }>;
  attachments?: ImageAttachment[];
  /** Text description of the attachments from the vision model, kept so follow-ups work after reload. */
  imageDescription?: string;
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  rememberedIds?: string[];
  memoryNotice?: string;
  /** Changes the assistant proposed in this reply that wait for the user's decision. */
  approvals?: ApprovalRequest[];
  /** Actions successfully executed and saved in the user's workspace this turn. */
  actions?: AppliedAction[];
  /** Things the assistant did in connected services (drafts saved, events created), with links. */
  external?: Array<{ tool: string; summary: string; link?: string }>;
  /** What the assistant did to produce this reply, step by step. */
  activity?: AgentStep[];
  /** What the user has done with each interactive card in this reply, by the card's order in the text. */
  cardState?: Record<number, IrisCardState>;
}

/** Progress on one interactive card, kept with the message so it survives a reload. */
export interface IrisCardState {
  /** Checklist rows already turned into tasks: row index to task ID. */
  added?: Record<number, string>;
  picked?: string;
  answers?: number[];
  /** Steps the user has ticked off. */
  done?: number[];
}

/**
 * A change the assistant may make only after the user approves it. Hosted accounts keep the request on
 * the server (bound to a hash of its exact payload); local mode keeps the prepared change here.
 */
export interface ApprovalRequest {
  id: string;
  tool: string;
  summary: string;
  /** Field-level description of what changes, e.g. "Status: Not started → Completed". */
  details: string[];
  reason: string;
  /** The full text that will go out (e.g. an email body), shown in full before approving. */
  preview?: string;
  /** Things to check before approving, e.g. a recipient the user has never emailed. */
  warnings?: string[];
  status: 'pending' | 'executed' | 'rejected' | 'failed' | 'expired';
  remote: boolean;
  payloadHash?: string;
  /** Local mode only: the prepared change to apply on approval. */
  mutation?: unknown;
  error?: string;
}

export interface BrainPreferences {
  /** Every change the assistant makes waits for approval. */
  askBeforeChanges?: boolean;
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
  entityType: 'task' | 'habit' | 'journal' | 'knowledge' | 'section' | 'goal' | 'tracker' | 'event' | 'course' | 'document' | 'deck' | 'quiz' | 'health' | 'workspace' | 'folder';
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

export type EventKind = 'meeting' | 'event' | 'class' | 'appointment';

/** A scheduled happening with a time and place, distinct from a task that must be done. */
export interface CalendarEvent {
  id: string;
  title: string;
  kind: EventKind;
  date: string; // YYYY-MM-DD, local calendar
  /** 24-hour "HH:MM". Both absent means an all-day event. */
  startTime?: string;
  endTime?: string;
  location?: string;
  /** http(s) link, e.g. a video call. */
  link?: string;
  attendees?: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
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
  trackerItems: TrackerItem[];
  events?: CalendarEvent[];
  healthDays?: HealthDay[];
  workspaces?: Workspace[];
  study?: StudyState;
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
  preferences?: BrainPreferences;
}

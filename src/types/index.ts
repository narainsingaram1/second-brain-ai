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
  /** Unit weights are shown and entered in. Stored values are always kg. */
  weightUnit?: 'kg' | 'lb';
  /** Unit body circumferences and height are shown and entered in. Stored values are always cm. */
  lengthUnit?: 'cm' | 'in';
  /** Body-weight goal in kg. */
  goalWeightKg?: number;
  /** Optional starting weight baseline in kg for tracking overall progress. */
  startWeightKg?: number;
  /** Optional height in cm. */
  heightCm?: number;
}

export type ProgressPhotoPose = 'front' | 'side' | 'back' | 'flexed' | 'other';

export interface BodyMeasurements {
  waistCm?: number;
  chestCm?: number;
  armCm?: number;
  thighCm?: number;
  hipCm?: number;
}

/** One progress photo check-in (collection progressPhotos). Image bytes live in noteImageStore ("synapse-img:..."). */
export interface ProgressPhoto {
  id: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Optional local 24-hour time "HH:mm". */
  time?: string;
  pose: ProgressPhotoPose;
  /** Reference in noteImageStore ("synapse-img:<hash>.<ext>"). */
  imageRef: string;
  width?: number;
  height?: number;
  /** Optional body weight in kg at this check-in. */
  weightKg?: number;
  /** Optional body fat percentage at this check-in. */
  bodyFatPct?: number;
  /** Optional circumference measurements in cm at this check-in. */
  measurements?: BodyMeasurements;
  /** Training or nutrition phase (e.g. "Cut", "Bulk", "Recomp", "Maintenance"). */
  phase?: string;
  /** Context tags such as "fasted", "morning", "post-workout", "relaxed". */
  tags?: string[];
  /** Reflection or lighting/pose details. */
  note?: string;
  /** Starred milestone check-in. */
  milestone?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One set of an exercise. Weights are kg; a set has whatever the exercise measures (reps, load, time, distance). */
export interface WorkoutSet {
  reps?: number;
  weightKg?: number;
  seconds?: number;
  distanceKm?: number;
  /** Effort, 1 to 10. */
  rpe?: number;
  kind?: 'warmup' | 'working' | 'drop' | 'failure';
  done?: boolean;
}

export interface WorkoutExercise {
  id: string;
  /** ID in the exercise library, or "custom-<slug>" for the user's own. */
  exerciseId: string;
  name: string;
  sets: WorkoutSet[];
  note?: string;
}

/** One training session (collection workouts). */
export interface WorkoutSession {
  id: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  name: string;
  /** The plan and day it followed, if any. */
  planId?: string;
  planDayId?: string;
  /** ISO time the session started; set while it is being logged live. */
  startedAt?: string;
  /** ISO time it was finished. A session without it is still in progress. */
  finishedAt?: string;
  durationMin?: number;
  exercises: WorkoutExercise[];
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanExercise {
  id: string;
  exerciseId: string;
  name: string;
  sets: number;
  /** Target reps, e.g. "8-12" or "5". For timed moves, e.g. "30s". */
  reps: string;
  restSec?: number;
  note?: string;
}

export interface PlanDay {
  id: string;
  /** e.g. "Push", "Pull", "Legs", "Upper A". */
  name: string;
  /** Days of the week it is scheduled, 0 = Sunday. */
  weekdays?: number[];
  exercises: PlanExercise[];
}

/** A training split such as Push / Pull / Legs (collection workoutPlans). At most one is active. */
export interface WorkoutPlan {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  days: PlanDay[];
  createdAt: string;
  updatedAt: string;
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
  /** How the text was read: 2+ includes slide images, diagrams and handwriting; missing or 1 means text layer only. */
  extraction?: number;
  /** Pages or slides whose images were transcribed. */
  visualPages?: number;
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
  /** Markdown shown with the question: the code, table or diagram it asks about. Never reveals the answer. */
  exhibit?: string;
  /** Short answer with a definite value (program output, a number, an address): every exact form that counts as right. */
  accept?: string[];
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
  | 'habit'
  | 'journal'
  | 'knowledge'
  | 'tracker';

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
  /** Set on the one folder a workspace owns; its name and color follow the workspace. */
  workspaceId?: string;
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
  /** Transcript of recordings made into this note: paragraphs starting "[mm:ss]", recordings divided by "── Recording N ──". */
  transcript?: string;
  recording?: NoteRecordingInfo;
  /** Editable vector whiteboards embedded in this note, keyed by boardId (`wb-...`). */
  whiteboards?: Record<string, WhiteboardScene>;
}

export type WhiteboardBackground = 'blank' | 'dots' | 'grid' | 'lined';
export type WhiteboardTheme = 'light' | 'dark';
export type WhiteboardPoint = [number, number, number]; // [x, y, pressure]

export type WhiteboardElement =
  | {
      id: string;
      kind: 'pen' | 'highlighter';
      color: string;
      size: number;
      points: WhiteboardPoint[];
      simulatePressure?: boolean;
    }
  | {
      id: string;
      kind: 'line' | 'arrow' | 'rect' | 'ellipse';
      color: string;
      size: number;
      a: [number, number];
      b: [number, number];
    }
  | {
      id: string;
      kind: 'text';
      color: string;
      size: number;
      at: [number, number];
      text: string;
    };

export interface WhiteboardScene {
  version: 1;
  title?: string;
  theme: WhiteboardTheme;
  background: WhiteboardBackground;
  elements: WhiteboardElement[];
  camera?: { x: number; y: number; zoom: number };
  updatedAt: string;
}

export interface NoteRecordingInfo {
  /** Total recorded audio, across every recording into the note. */
  durationSec: number;
  recordedAt: string;
  /** When notes were last written from the transcript. */
  notesGeneratedAt?: string;
  /** The transcript was saved but notes have not been written from it yet. */
  notesPending?: boolean;
  /** What the user typed before notes were first written, kept so nothing they wrote is lost. */
  myNotes?: string;
  /** Bumped when the recorder replaces the note body, so an open editor reloads it. */
  revision?: number;
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

export type ChatFileKind = "pdf" | "docx" | "pptx" | "xlsx" | "csv" | "text" | "rtf";
/**
 * A document attached to a chat message (PDF, Word, Excel, CSV, slides, text). Its extracted text is what the
 * model reads, always as untrusted data. Saved messages keep a capped excerpt; the full text stays in memory.
 */
export interface FileAttachment {
  id: string;
  name: string;
  mimeType: string;
  /** Size of the original file in bytes. */
  size: number;
  kind: ChatFileKind;
  text: string;
  /** Characters extracted before any cap. */
  chars: number;
  /** Pages, slides or sheets, when the format has them. */
  pages?: number;
  /** Part of the document was left out because it was too long. */
  truncated?: boolean;
}

/** One thing the assistant did while working on a reply, shown live and kept with the reply. */
export type AgentStepKind = "think" | "prepare" | "records" | "web" | "email" | "calendar" | "change" | "memory" | "image" | "approval" | "write" | "plan" | "browser" | "desktop" | "ask";
export type AgentPlanStatus = "pending" | "in_progress" | "done" | "skipped" | "blocked";
/** One step of the assistant's plan for a multi-step request. */
export interface AgentPlanItem { title: string; status: AgentPlanStatus; note?: string }
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
  /** A "plan" step: the assistant's current plan, replaced each time it is updated. */
  plan?: AgentPlanItem[];
  /** A live step (website or Mac app): where its time went, in ms, and how much it sent the model. */
  timing?: { ms: number; phases?: Record<string, number>; chars?: number };
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

/** What one assistant reply took: time, tokens and, when the provider reports it, cost. */
export interface TurnUsage {
  /** From sending the message to the finished reply, in milliseconds. */
  ms: number;
  /** Until the first words of the reply appeared. */
  firstTextMs?: number;
  model: string;
  /** Model requests made for this reply (each tool round is one; web searches are counted separately). */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  /** US dollars, summed over the requests that reported a cost. */
  cost?: number;
  /** False when some requests reported no cost, so `cost` is a lower bound. */
  costComplete?: boolean;
  webSearches?: number;
}

export interface AIMessage {
  /** Records the reply drew on (type "web" for web pages, which carry their address in `url`). */
  sources?: Array<{ id: string; type: string; title: string; offset?: number; url?: string }>;
  usage?: TurnUsage;
  attachments?: ImageAttachment[];
  /** Documents attached to a user message, with their extracted text. */
  files?: FileAttachment[];
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
  /** User quality rating on this reply, persisted across reloads. */
  feedback?: 'like' | 'dislike';
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
  entityType: 'task' | 'habit' | 'journal' | 'knowledge' | 'section' | 'tracker' | 'event' | 'course' | 'document' | 'deck' | 'quiz' | 'health' | 'workout' | 'workout_plan' | 'progress_photo' | 'workspace' | 'folder' | 'routine';
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

export type RoutineFrequency = 'daily' | 'weekdays' | 'weekly' | 'monthly';
/** A cheap rule over the user's records that must hold before a routine spends any AI usage. */
export type RoutineCondition = 'always' | 'overdue_tasks' | 'due_today' | 'due_soon' | 'events_today';
/**
 * Work the assistant does on its own on a schedule, such as planning the morning or reviewing the week.
 * Each run is one assistant turn on the server; what it did lands in the routine's own conversation.
 */
export interface Routine {
  id: string;
  name: string;
  /** What to do each run, in the user's words. */
  instructions: string;
  frequency: RoutineFrequency;
  /** 24-hour HH:MM local time. */
  time: string;
  /** Weekly: days of the week, 0 = Sunday. */
  days?: number[];
  /** Monthly: day of the month (the last day in shorter months). */
  dayOfMonth?: number;
  /** IANA time zone the schedule is read in. */
  timeZone: string;
  onlyIf: RoutineCondition;
  /** act: saves changes itself (deletions still wait for approval). suggest: every change waits for approval. */
  mode: 'act' | 'suggest';
  /** Also send the result to Telegram when it is connected. */
  notify: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BrainState {
  agentMemory?: AgentMemory;
  routines?: Routine[];
  userId?: string;
  tasks: Task[];
  sections: string[];
  subsections: Record<string, string[]>; // Section -> array of Subsection names
  habits: Habit[];
  journalEntries: JournalEntry[];
  knowledgeItems: KnowledgeItem[];
  trackerItems: TrackerItem[];
  events?: CalendarEvent[];
  healthDays?: HealthDay[];
  workouts?: WorkoutSession[];
  workoutPlans?: WorkoutPlan[];
  progressPhotos?: ProgressPhoto[];
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

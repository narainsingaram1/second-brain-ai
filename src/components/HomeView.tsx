import { FormEvent, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckSquare,
  FileText,
  Flame,
  Layers,
  Plus,
  Sparkles,
  Target,
  CalendarClock,
} from "lucide-react";
import { BrainState, CalendarEvent, KnowledgeItem, Task } from "../types";
import { formatTime } from "../utils/events";
import { BrainConversation } from "../hooks/useBrainConversation";
import { getLocalDateString } from "../utils/habitStreaks";
import { MountainHeroIllustration } from "./MountainHeroIllustration";
import { FocusTimer } from "./workspace/FocusTimer";
import { DashboardCalendar } from "./workspace/DashboardCalendar";
import { AttachButton, AttachmentTray, useImageAttachments } from "./ImageAttachments";
import type { PreparedImage } from "../utils/imageInput";
interface HomeViewProps {
  conversation: BrainConversation;
  brainState: BrainState;
  displayName?: string;
  onAsk: (prompt: string, images?: PreparedImage[]) => Promise<void>;
  onNavigate: (tab: string) => void;
  onNewTask: () => void;
  onNewNote: () => void;
  onToggleTask: (id: string) => void;
  onEditTask: (task: Task) => void;
  onEditEvent?: (event: CalendarEvent) => void;
  onOpenNote: (note: KnowledgeItem) => void;
}
export function HomeView({
  conversation,
  brainState: state,
  displayName,
  onAsk,
  onNavigate,
  onNewTask,
  onNewNote,
  onToggleTask,
  onEditTask,
  onEditEvent,
  onOpenNote,
}: HomeViewProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedDate, setSelectedDate] = useState(getLocalDateString);
  const [error, setError] = useState("");
  const attachments = useImageAttachments(setError);
  const today = getLocalDateString();
  const now = new Date();
  const greeting =
    now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 18
        ? "Good afternoon"
        : "Good evening";
  const dayTasks = state.tasks.filter((task) => task.dueDate === selectedDate);
  const done = dayTasks.filter((task) => task.completed).length;
  // Deadlines and scheduled events share one chronological "Coming up" list.
  const upcoming: Array<{ kind: "task"; key: string; date: string; time?: string; task: Task } | { kind: "event"; key: string; date: string; time?: string; event: CalendarEvent }> = [
    ...state.tasks
      .filter((task) => !task.completed && task.dueDate > today)
      .map((task) => ({ kind: "task" as const, key: `task:${task.id}`, date: task.dueDate, time: task.dueTime, task })),
    ...(state.events || [])
      .filter((event) => event.date >= today)
      .map((event) => ({ kind: "event" as const, key: `event:${event.id}`, date: event.date, time: event.startTime, event })),
  ]
    .sort((a, b) => `${a.date} ${a.time || "24:00"}`.localeCompare(`${b.date} ${b.time || "24:00"}`))
    .slice(0, 5);
  const overdue = state.tasks.filter(
    (task) => !task.completed && task.dueDate && task.dueDate < today,
  ).length;
  const notes = [...state.knowledgeItems]
    .sort((a, b) =>
      (b.updatedAt || b.createdAt || b.startDate).localeCompare(
        a.updatedAt || a.createdAt || a.startDate,
      ),
    )
    .slice(0, 4);
  const goals = state.goals
    .filter((goal) => goal.status !== "achieved")
    .slice(0, 3);
  const ask = async (text: string) => {
    const images = attachments.images;
    if ((!text.trim() && !images.length) || conversation.busy || attachments.processing) return;
    setError("");
    try {
      attachments.clear();
      await onAsk(text.trim(), images.length ? images : undefined);
      setPrompt("");
    } catch (err) {
      attachments.restore(images);
      setError(
        err instanceof Error
          ? err.message
          : "Could not send your message. Try again.",
      );
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(prompt);
  };
  const library = [
    {
      title: "Notes",
      detail: "Ideas & knowledge",
      count: state.knowledgeItems.length,
      icon: FileText,
      tab: "knowledge",
    },
    {
      title: "Tasks",
      detail: "Make things happen",
      count: state.tasks.filter((task) => !task.completed).length,
      icon: CheckSquare,
      tab: "tasks",
    },
    {
      title: "Goals",
      detail: "The bigger picture",
      count: state.goals.length,
      icon: Target,
      tab: "goals",
    },
    {
      title: "Journal",
      detail: "Space to reflect",
      count: state.journalEntries.length,
      icon: BookOpen,
      tab: "journal",
    },
  ];
  return (
    <div className="brain-dashboard">
      <div className="dashboard-main">
        <section className="dashboard-hero">
          <div className="hero-landscape" aria-hidden="true">
            <MountainHeroIllustration theme={state.theme} />
          </div>
          <div className="hero-copy">
            <p className="workspace-eyebrow">
              <Sparkles size={14} />
              {greeting}
              {displayName ? `, ${displayName.split(" ")[0]}` : ""}
            </p>
            <h1>
              Your second brain<span>.</span>
            </h1>
            <p>A home for your thoughts. A little clarity for your day.</p>
            <div className="hero-meta">
              <span className="status-dot" />
              Capture. Connect. Create.
            </div>
          </div>
        </section>
        <section className="dashboard-ask" aria-label="Chat with Iris">
          <AttachmentTray images={attachments.images} processing={attachments.processing} onRemove={attachments.remove} />
          <form className={`dashboard-chat-bar ${attachments.dragging ? "is-dragging" : ""}`} onSubmit={submit} {...attachments.dropProps}>
            {attachments.picker}
            <Sparkles size={24} className="ask-sparkle" />
            <input
              aria-label="Ask Iris"
              placeholder={attachments.images.length ? "Ask about the image, or send to add it as tasks…" : "Ask Iris anything, or paste a screenshot…"}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onPaste={attachments.onPaste}
            />
            <AttachButton onClick={attachments.openPicker} disabled={conversation.busy} />
            <button
              type="submit"
              className="ask-send"
              disabled={(!prompt.trim() && !attachments.images.length) || conversation.busy || attachments.processing}
              aria-label="Send to Iris"
            >
              <ArrowUpRight size={23} />
            </button>
          </form>
          <div className="ask-caption">
            <span>
              <span className="status-dot" /> Iris Copilot · Connected to your
              workspace
            </span>
            <button onClick={() => onNavigate("copilot")}>
              Open chat <ArrowUpRight size={12} />
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </section>
        <div className="dashboard-create">
          <span>MAKE SOMETHING</span>
          <button onClick={onNewNote}>
            <FileText size={16} />
            Note
            <Plus size={13} />
          </button>
          <button onClick={onNewTask}>
            <CheckSquare size={16} />
            Task
            <Plus size={13} />
          </button>
          <button onClick={() => onNavigate("journal")}>
            <BookOpen size={16} />
            Journal
            <ArrowUpRight size={13} />
          </button>
          <button onClick={() => onNavigate("goals")}>
            <Target size={16} />
            Goal
            <ArrowUpRight size={13} />
          </button>
        </div>
        <div className="dashboard-middle">
          <section className="workspace-card today-card">
            <div className="card-heading">
              <h2>
                <CheckSquare size={18} />
                {selectedDate === today
                  ? "Today’s focus"
                  : new Date(`${selectedDate}T12:00:00`).toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric" },
                    )}
              </h2>
              <span className="count-badge">
                {done} / {dayTasks.length}
              </span>
            </div>
            <p className="muted">
              {selectedDate === today
                ? now.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })
                : "Tasks for the selected day"}
            </p>
            <div className="dashboard-task-list">
              {dayTasks.slice(0, 5).map((task) => (
                <div
                  className={`dashboard-task ${task.completed ? "is-done" : ""}`}
                  key={task.id}
                >
                  <button
                    className="task-check"
                    aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
                    aria-pressed={task.completed}
                    onClick={() => onToggleTask(task.id)}
                  >
                    {task.completed && <Check size={12} />}
                  </button>
                  <button
                    className="task-title"
                    onClick={() => onEditTask(task)}
                  >
                    {task.title}
                  </button>
                  <span className="subtle-tag">{task.dueTime ? `${formatTime(task.dueTime)} · ` : ""}{task.section}</span>
                </div>
              ))}
              {!dayTasks.length && (
                <div className="dashboard-empty">
                  <CheckSquare size={25} />
                  <strong>Room for what matters</strong>
                  <p>Add a task to give your day a little direction.</p>
                </div>
              )}
            </div>
            <div className="card-bottom">
              <button className="text-action" onClick={onNewTask}>
                <Plus size={14} />
                Add task
              </button>
              <button
                className="text-action"
                onClick={() => onNavigate("tasks")}
              >
                {overdue ? `${overdue} overdue` : "All tasks"}
                <ArrowRight size={13} />
              </button>
            </div>
          </section>
          <FocusTimer />
        </div>
        <div className="dashboard-lower">
          <section className="workspace-card recent-notes">
            <div className="card-heading">
              <h2>
                <FileText size={18} />
                Recent notes
              </h2>
              <button
                className="text-action"
                onClick={() => onNavigate("knowledge")}
              >
                View all
                <ArrowRight size={13} />
              </button>
            </div>
            {notes.length ? (
              notes.map((note) => (
                <button
                  className="dashboard-note"
                  key={note.id}
                  onClick={() => onOpenNote(note)}
                >
                  <span className="note-file-icon">
                    <FileText size={17} />
                  </span>
                  <span>
                    <strong>{note.subject}</strong>
                    <small>{note.summary || "Open note"}</small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))
            ) : (
              <div className="dashboard-empty">
                <FileText size={25} />
                <strong>Give your ideas a home</strong>
                <p>Save a thought, a lesson, or something worth keeping.</p>
                <button className="text-action" onClick={onNewNote}>
                  <Plus size={14} />
                  Create your first note
                </button>
              </div>
            )}
          </section>
          <section className="workspace-card">
            <div className="card-heading">
              <h2>
                <Target size={18} />
                On the horizon
              </h2>
              <button
                className="icon-control"
                aria-label="View goals"
                onClick={() => onNavigate("goals")}
              >
                <ArrowUpRight size={17} />
              </button>
            </div>
            {goals.length ? (
              goals.map((goal) => (
                <button
                  className="dashboard-goal"
                  key={goal.id}
                  onClick={() => onNavigate("goals")}
                >
                  <span>
                    <strong>{goal.title}</strong>
                    <small>{goal.progress}%</small>
                  </span>
                  <span className="progress-track">
                    <i
                      style={{
                        width: `${Math.min(100, Math.max(0, goal.progress))}%`,
                      }}
                    />
                  </span>
                  <small>
                    {goal.sector} ·{" "}
                    {goal.milestones.filter((item) => item.completed).length}/
                    {goal.milestones.length} milestones
                  </small>
                </button>
              ))
            ) : (
              <div className="dashboard-empty">
                <Target size={25} />
                <strong>Make space for your next chapter</strong>
                <p>Connect today’s work to a goal that matters.</p>
                <button
                  className="text-action"
                  onClick={() => onNavigate("goals")}
                >
                  Set a goal
                  <ArrowRight size={14} />
                </button>
              </div>
            )}
          </section>
        </div>
        <section className="knowledge-overview">
          <div className="section-label">
            <Layers size={16} />
            <h2>Your knowledge, connected</h2>
          </div>
          <div className="knowledge-shortcuts">
            {library.map((item) => (
              <button key={item.tab} onClick={() => onNavigate(item.tab)}>
                <item.icon size={20} />
                <span className="shortcut-count">{item.count}</span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>
        </section>
      </div>
      <aside className="dashboard-rail" aria-label="At a glance">
        <DashboardCalendar
          tasks={state.tasks}
          events={state.events}
          selected={selectedDate}
          onSelect={setSelectedDate}
        />
        <section className="workspace-card upcoming-card">
          <div className="card-heading">
            <h2>
              <Layers size={18} />
              Coming up
            </h2>
            <button
              className="icon-control"
              aria-label="View upcoming tasks"
              onClick={() => onNavigate("tasks")}
            >
              <ArrowUpRight size={16} />
            </button>
          </div>
          {upcoming.length ? (
            upcoming.map((item) => (
              <button
                className={`upcoming-item ${item.kind === "event" ? "is-event" : ""}`}
                key={item.key}
                onClick={() => (item.kind === "task" ? onEditTask(item.task) : onEditEvent?.(item.event))}
              >
                <span>
                  {item.date === today
                    ? "Today"
                    : new Date(`${item.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {item.time ? ` · ${formatTime(item.time)}` : ""}
                </span>
                <strong>
                  {item.kind === "event" && <CalendarClock size={13} aria-label="Event" style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />}
                  {item.kind === "task" ? item.task.title : item.event.title}
                </strong>
              </button>
            ))
          ) : (
            <p className="empty-inline">
              No upcoming deadlines. A little breathing room.
            </p>
          )}
        </section>
        <section className="workspace-card habit-glance">
          <div className="card-heading">
            <h2>
              <Flame size={18} />
              Small steps, daily
            </h2>
          </div>
          <p className="muted">
            {state.habits.filter((habit) => habit.history[today]).length} of{" "}
            {state.habits.length} habits complete today
          </p>
          <div className="habit-progress">
            {state.habits.slice(0, 12).map((habit) => (
              <span
                key={habit.id}
                title={habit.name}
                className={habit.history[today] ? "complete" : ""}
              >
                <Check size={14} />
              </span>
            ))}
          </div>
          <button className="text-action" onClick={() => onNavigate("habits")}>
            Check in with your habits
            <ArrowRight size={13} />
          </button>
        </section>
        <section className="workspace-card copilot-card">
          <span className="copilot-orbit" aria-hidden="true" />
          <Sparkles size={25} />
          <h2>
            A thought partner.
            <br />
            With your context.
          </h2>
          <p>Turn scattered thoughts into a clearer next step.</p>
          <button
            onClick={() =>
              void ask("Help me plan today using my tasks, goals, and habits.")
            }
            disabled={conversation.busy}
          >
            Plan my day
            <ArrowUpRight size={15} />
          </button>
          <button
            onClick={() =>
              void ask("Find connections between my recent notes and goals.")
            }
            disabled={conversation.busy}
          >
            Connect my ideas
            <ArrowUpRight size={15} />
          </button>
        </section>
        <p className="dashboard-footer">
          A clearer mind, one thought at a time.
        </p>
      </aside>
    </div>
  );
}

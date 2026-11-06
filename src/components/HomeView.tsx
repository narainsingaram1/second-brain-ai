import { FormEvent, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  CheckSquare,
  FileText,
  Plus,
  Target,
  CalendarClock,
} from "lucide-react";
import { BrainState, CalendarEvent, KnowledgeItem, Task } from "../types";
import { formatTime } from "../utils/events";
import { BrainConversation } from "../hooks/useBrainConversation";
import { getLocalDateString } from "../utils/habitStreaks";
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
    { title: "Notes", count: state.knowledgeItems.length, tab: "knowledge" },
    { title: "Open tasks", count: state.tasks.filter((task) => !task.completed).length, tab: "tasks" },
    { title: "Goals", count: state.goals.length, tab: "goals" },
    { title: "Journal entries", count: state.journalEntries.length, tab: "journal" },
  ];
  const dueToday = state.tasks.filter((task) => !task.completed && task.dueDate === today).length;
  const weekEnd = getLocalDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const eventsThisWeek = (state.events || []).filter((event) => event.date >= today && event.date <= weekEnd).length;
  const habitsDone = state.habits.filter((habit) => habit.history[today]).length;
  const summary = [
    `${dueToday} ${dueToday === 1 ? "task" : "tasks"} due today`,
    overdue ? `${overdue} overdue` : "",
    `${eventsThisWeek} ${eventsThisWeek === 1 ? "event" : "events"} this week`,
    state.habits.length ? `${habitsDone} of ${state.habits.length} habits done` : "",
  ].filter(Boolean).join(" · ");
  // Planner stamps: "Today", or a short date, always in the same mono format.
  const stamp = (date: string) =>
    date === today ? "Today" : new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "2-digit" });
  const sortedDay = [...dayTasks].sort((a, b) => (a.dueTime || "99").localeCompare(b.dueTime || "99"));
  return (
    <div className="brain-dashboard">
      <div className="dashboard-main">
        <header className="home-head">
          <p className="home-weekday">{now.toLocaleDateString("en-US", { weekday: "long" })}{displayName ? ` · ${displayName.split(" ")[0]}` : ""}</p>
          <h1 className="page-title">{now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</h1>
          <p className="home-summary">{summary}</p>
        </header>
        <section className="dashboard-ask" aria-label="Ask Iris">
          <AttachmentTray images={attachments.images} processing={attachments.processing} onRemove={attachments.remove} />
          <form className={`dashboard-chat-bar ${attachments.dragging ? "is-dragging" : ""}`} onSubmit={submit} {...attachments.dropProps}>
            {attachments.picker}
            <input
              aria-label="Ask Iris"
              placeholder={attachments.images.length ? "Ask about the image, or add it as tasks" : "Ask Iris about your tasks, notes and goals"}
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
              <ArrowUp size={16} strokeWidth={1.75} />
            </button>
          </form>
          <div className="ask-caption">
            <span>Paste a screenshot of a syllabus or invite to turn it into tasks</span>
            <button onClick={() => onNavigate("copilot")}>
              Open chat <ArrowRight size={14} strokeWidth={1.5} />
            </button>
          </div>
          {error && <p role="alert" className="form-error">{error}</p>}
        </section>
        <div className="dashboard-create" aria-label="Create">
          <button onClick={onNewNote}><FileText size={16} strokeWidth={1.5} />Note</button>
          <button onClick={onNewTask}><CheckSquare size={16} strokeWidth={1.5} />Task</button>
          <button onClick={() => onNavigate("journal")}><BookOpen size={16} strokeWidth={1.5} />Journal entry</button>
          <button onClick={() => onNavigate("goals")}><Target size={16} strokeWidth={1.5} />Goal</button>
        </div>
        <div className="dashboard-middle">
          <section className="workspace-card today-card">
            <div className="card-heading">
              <h2>
                {selectedDate === today
                  ? "Today"
                  : new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
              </h2>
              <span className="meta">{done} of {dayTasks.length} done</span>
            </div>
            <div className="dashboard-task-list planner-page">
              {sortedDay.slice(0, 6).map((task) => (
                <div className={`dashboard-task ${task.completed ? "is-done" : ""}`} key={task.id}>
                  <span className="planner-time">{task.dueTime ? formatTime(task.dueTime) : "—"}</span>
                  <button
                    className="task-check"
                    aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
                    aria-pressed={task.completed}
                    onClick={() => onToggleTask(task.id)}
                  >
                    {task.completed && <Check size={12} strokeWidth={2} />}
                  </button>
                  <button className="task-title" onClick={() => onEditTask(task)}>{task.title}</button>
                  <span className="subtle-tag">{task.subsection || task.section}</span>
                </div>
              ))}
              {!dayTasks.length && (
                <div className="dashboard-empty">
                  <strong>Nothing due {selectedDate === today ? "today" : "this day"}</strong>
                  <p>Add a task, or pick another day on the calendar.</p>
                </div>
              )}
            </div>
            <div className="card-bottom">
              <button className="text-action" onClick={onNewTask}><Plus size={14} strokeWidth={1.5} />Add task</button>
              <button className="text-action is-quiet" onClick={() => onNavigate("tasks")}>
                {overdue ? `${overdue} overdue` : "All tasks"}<ArrowRight size={14} strokeWidth={1.5} />
              </button>
            </div>
          </section>
          <FocusTimer />
        </div>
        <div className="dashboard-lower">
          <section className="workspace-card recent-notes">
            <div className="card-heading">
              <h2>Recent notes</h2>
              <button className="text-action is-quiet" onClick={() => onNavigate("knowledge")}>View all<ArrowRight size={14} strokeWidth={1.5} /></button>
            </div>
            {notes.length ? (
              notes.map((note) => (
                <button className="dashboard-note" key={note.id} onClick={() => onOpenNote(note)}>
                  <FileText size={16} strokeWidth={1.5} />
                  <span>
                    <strong>{note.subject}</strong>
                    <small>{note.summary || "No summary yet"}</small>
                  </span>
                  <span className="date-stamp">{stamp((note.updatedAt || note.createdAt || note.startDate).slice(0, 10))}</span>
                </button>
              ))
            ) : (
              <div className="dashboard-empty">
                <strong>No notes yet</strong>
                <p>Lecture notes, ideas and things worth keeping live here.</p>
                <button className="text-action" onClick={onNewNote}><Plus size={14} strokeWidth={1.5} />New note</button>
              </div>
            )}
          </section>
          <section className="workspace-card">
            <div className="card-heading">
              <h2>Goals in progress</h2>
              <button className="text-action is-quiet" onClick={() => onNavigate("goals")}>All goals<ArrowRight size={14} strokeWidth={1.5} /></button>
            </div>
            {goals.length ? (
              goals.map((goal) => (
                <button className="dashboard-goal" key={goal.id} onClick={() => onNavigate("goals")}>
                  <span>
                    <strong>{goal.title}</strong>
                    <small className="figure">{goal.progress}%</small>
                  </span>
                  <span className="progress-track"><i style={{ width: `${Math.min(100, Math.max(0, goal.progress))}%` }} /></span>
                  <small>
                    {goal.sector.replace(/^./, (c) => c.toUpperCase())} · {goal.milestones.filter((item) => item.completed).length} of {goal.milestones.length} milestones
                  </small>
                </button>
              ))
            ) : (
              <div className="dashboard-empty">
                <strong>No goals yet</strong>
                <p>Connect today’s work to something longer term.</p>
                <button className="text-action" onClick={() => onNavigate("goals")}>Set a goal<ArrowRight size={14} strokeWidth={1.5} /></button>
              </div>
            )}
          </section>
        </div>
        <section className="knowledge-overview" aria-label="Library">
          <div className="knowledge-shortcuts">
            {library.map((item) => (
              <button key={item.tab} onClick={() => onNavigate(item.tab)}>
                <span className="figure">{item.count}</span>
                <small>{item.title}</small>
              </button>
            ))}
          </div>
        </section>
      </div>
      <aside className="dashboard-rail" aria-label="At a glance">
        <DashboardCalendar tasks={state.tasks} events={state.events} selected={selectedDate} onSelect={setSelectedDate} />
        <section className="workspace-card upcoming-card">
          <div className="card-heading">
            <h2>Coming up</h2>
          </div>
          {upcoming.length ? (
            upcoming.map((item) => (
              <button
                className={`upcoming-item ${item.kind === "event" ? "is-event" : ""}`}
                key={item.key}
                onClick={() => (item.kind === "task" ? onEditTask(item.task) : onEditEvent?.(item.event))}
              >
                <span className="date-stamp">{stamp(item.date)}</span>
                <span className="upcoming-body">
                  <strong>{item.kind === "task" ? item.task.title : item.event.title}</strong>
                  <small>
                    {item.kind === "event" && <CalendarClock size={12} strokeWidth={1.5} aria-label="Event" />}
                    {item.time ? formatTime(item.time) : item.kind === "event" ? "All day" : "Due"}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p className="empty-inline">Nothing scheduled in the days ahead</p>
          )}
        </section>
        <section className="workspace-card habit-glance">
          <div className="card-heading">
            <h2>Habits</h2>
            <span className="meta">{habitsDone} of {state.habits.length}</span>
          </div>
          <div className="habit-tally">
            {state.habits.slice(0, 8).map((habit) => (
              <span key={habit.id} className={habit.history[today] ? "complete" : ""}>
                <i aria-hidden="true">{habit.history[today] && <Check size={12} strokeWidth={2} />}</i>
                <span>{habit.name}</span>
              </span>
            ))}
          </div>
          <button className="text-action is-quiet" onClick={() => onNavigate("habits")}>Check in<ArrowRight size={14} strokeWidth={1.5} /></button>
        </section>
        <section className="workspace-card copilot-card">
          <h2>Ask Iris</h2>
          <p>Answers come from your own tasks, notes and goals.</p>
          <button onClick={() => void ask("Help me plan today using my tasks, goals, and habits.")} disabled={conversation.busy}>
            Plan my day<ArrowRight size={14} strokeWidth={1.5} />
          </button>
          <button onClick={() => void ask("Find connections between my recent notes and goals.")} disabled={conversation.busy}>
            Connect my notes to my goals<ArrowRight size={14} strokeWidth={1.5} />
          </button>
        </section>
      </aside>
    </div>
  );
}

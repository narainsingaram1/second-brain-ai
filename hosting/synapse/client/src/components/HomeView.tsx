import { ArrowRight, ArrowUpRight, BookOpen, CheckSquare, FileText, Leaf, Plus, Sparkles, Target } from "lucide-react";
import { BrainState, KnowledgeItem } from "../types";
import { BrainConversation } from "../hooks/useBrainConversation";
import { ChatWorkspace } from "./ChatWorkspace";
import { getLocalDateString } from "../utils/habitStreaks";

interface HomeViewProps {
  conversation: BrainConversation;
  brainState: BrainState;
  onSaveKnowledge: (item: KnowledgeItem) => void;
  onOpenSettings: () => void;
  onNavigate: (tab: string) => void;
  onNewTask: () => void;
  onNewNote: () => void;
}
export function HomeView({ conversation, brainState, onSaveKnowledge, onOpenSettings, onNavigate, onNewTask, onNewNote }: HomeViewProps) {
  const active = brainState.chatHistory.some(message => message.role === "user");
  const now = new Date();
  const today = getLocalDateString();
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(now);
    day.setDate(now.getDate() - now.getDay() + index);
    return day;
  });
  const todayTasks = brainState.tasks.filter(task => !task.completed && task.dueDate === today);
  const tasks = todayTasks.slice(0, 3);
  const goals = (brainState.goals || []).filter(goal => goal.status !== "achieved").slice(0, 3);
  return <div className={`home-layout ${active ? "has-conversation" : ""}`}>
    <ChatWorkspace conversation={conversation} state={brainState} messages={brainState.chatHistory} onSaveNote={onSaveKnowledge} onOpenSettings={onOpenSettings} />
    {!active && <aside className="home-rail" aria-label="Your day at a glance">
      <section className="day-card soft-card">
        <div className="rail-heading"><h2>{now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</h2><button onClick={() => onNavigate("tasks")} aria-label="View all tasks"><ArrowUpRight size={17} /></button></div>
        <div className="week-strip">{week.map(day => <div key={day.toISOString()}><span>{day.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 1)}</span><span className={day.getDate() === now.getDate() ? "is-today" : ""}>{day.getDate()}</span></div>)}</div>
        <div className="day-agenda"><p className="rail-label">TODAY’S FOCUS <span>{tasks.length ? `${todayTasks.length} due today` : "A little room to breathe"}</span></p>
          {tasks.length ? tasks.map((task, index) => <button className="agenda-item" key={task.id} onClick={() => onNavigate("tasks")}><i className={`agenda-dot dot-${index}`} /><span><strong>{task.title}</strong><small>{task.section}{task.subsection ? ` · ${task.subsection}` : ""}</small></span><ArrowUpRight size={13} /></button>) : <button className="agenda-empty" onClick={onNewTask}><Plus size={16} /> Set an intention for today</button>}
        </div>
      </section>
      <div className="quiet-card"><div className="quiet-orbit" aria-hidden="true"/><Leaf size={19} /><p>Small, consistent steps.<br/><strong>Extraordinary possibilities.</strong></p><span>MAKE ROOM FOR WHAT MATTERS</span></div>
      <section className="soft-card quick-card"><div className="rail-heading"><h2>A fresh start</h2><Sparkles size={15} /></div><div className="home-quick-actions">
        <button onClick={onNewNote}><span><FileText size={19}/></span>New note</button>
        <button onClick={onNewTask}><span><CheckSquare size={19}/></span>Add task</button>
        <button onClick={() => onNavigate("journal")}><span><BookOpen size={19}/></span>Journal</button>
      </div></section>
      <section className="soft-card rail-goals"><div className="rail-heading"><h2>The bigger picture</h2><button onClick={() => onNavigate("goals")} aria-label="View all goals"><ArrowRight size={16} /></button></div>
        {goals.length ? goals.map(goal => <button className="rail-goal" key={goal.id} onClick={() => onNavigate("goals")}><span className="goal-symbol"><Target size={18}/></span><span className="goal-detail"><span><strong>{goal.title}</strong><small>{goal.progress}%</small></span><span className="goal-track"><i style={{ width: `${Math.min(100, Math.max(0, goal.progress))}%` }}/></span></span></button>) : <button className="agenda-empty" onClick={() => onNavigate("goals")}><Target size={17}/> Give your next chapter a direction <ArrowRight size={14}/></button>}
      </section>
      <p className="rail-footer"><span/> A clearer mind, one thought at a time.</p>
    </aside>}
  </div>;
}

import React, { useRef, useEffect, useState } from "react";
import { Task, LifeDomain } from "../types";
import {
  Check,
  Calendar,
  MoreHorizontal,
  Plus,
  Share2,
  FolderArchive,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import confetti from "canvas-confetti";

interface JourneyCanvasProps {
  tasks: Task[];
  onToggleTask: (taskId: string) => void;
  onAddTask: (stage: Task["stage"]) => void;
  onEditTask: (task: Task) => void;
  selectedDomain: LifeDomain | "all";
  onTriggerAIInsight: (task: Task) => void;
}

export const JourneyCanvas: React.FC<JourneyCanvasProps> = ({
  tasks,
  onToggleTask,
  onAddTask,
  onEditTask,
  selectedDomain,
  onTriggerAIInsight,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [connectorPaths, setConnectorPaths] = useState<
    { id: string; d: string; color: string }[]
  >([]);

  // Filter tasks based on domain
  const filteredTasks = tasks.filter(
    (t) => selectedDomain === "all" || t.domain === selectedDomain
  );

  const stage1Tasks = filteredTasks.filter((t) => t.stage === "intake");
  const stage2Tasks = filteredTasks.filter((t) => t.stage === "execution");
  const stage3Tasks = filteredTasks.filter((t) => t.stage === "resolution");
  const stage4Tasks = filteredTasks.filter((t) => t.stage === "next-actions");

  // Dynamic SVG Bezier connector calculations between connected tasks
  useEffect(() => {
    const updateConnectors = () => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();

      const paths: { id: string; d: string; color: string }[] = [];

      tasks.forEach((task) => {
        if (!task.connectedTo || task.connectedTo.length === 0) return;

        const sourceEl = document.getElementById(`task-node-${task.id}`);
        if (!sourceEl) return;
        const sourceRect = sourceEl.getBoundingClientRect();

        task.connectedTo.forEach((targetId, idx) => {
          const targetEl = document.getElementById(`task-node-${targetId}`);
          if (!targetEl) return;
          const targetRect = targetEl.getBoundingClientRect();

          // Calculate start (right-center of source) and end (left-center of target)
          const startX = sourceRect.right - containerRect.left;
          const startY = sourceRect.top + sourceRect.height / 2 - containerRect.top;
          const endX = targetRect.left - containerRect.left;
          const endY = targetRect.top + targetRect.height / 2 - containerRect.top;

          // Smooth cubic bezier control points
          const deltaX = Math.max(30, (endX - startX) * 0.5);
          const d = `M ${startX} ${startY} C ${startX + deltaX} ${startY}, ${endX - deltaX} ${endY}, ${endX} ${endY}`;

          // Alternate soft rose & soft cobalt connector colors matching screenshot
          const color = idx % 2 === 0 ? "#f43f5e" : "#3b82f6";
          paths.push({ id: `${task.id}->${targetId}`, d, color });
        });
      });

      setConnectorPaths(paths);
    };

    updateConnectors();
    window.addEventListener("resize", updateConnectors);
    const timer = setTimeout(updateConnectors, 300);
    return () => {
      window.removeEventListener("resize", updateConnectors);
      clearTimeout(timer);
    };
  }, [tasks, selectedDomain]);

  const handleComplete = (e: React.MouseEvent, taskId: string, completed: boolean) => {
    e.stopPropagation();
    if (!completed) {
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.6 },
        colors: ["#3b82f6", "#10b981", "#f43f5e", "#f59e0b"],
      });
    }
    onToggleTask(taskId);
  };

  return (
    <div className="relative w-full overflow-x-auto pb-4" ref={containerRef}>
      {/* SVG Canvas for Bezier Connectors */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
        <defs>
          <linearGradient id="roseToPurple" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.8" />
          </linearGradient>
          <linearGradient id="blueToCyan" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.8" />
          </linearGradient>
        </defs>
        {connectorPaths.map((c) => (
          <g key={c.id}>
            <path
              d={c.d}
              fill="none"
              stroke={c.color}
              strokeWidth="2.2"
              strokeDasharray="4 3"
              className="opacity-75 transition-all duration-300"
            />
            {/* Small anchor dot at end */}
            {c.d.split(" ").length >= 8 && (
              <circle
                cx={c.d.split(" ")[c.d.split(" ").length - 2]}
                cy={c.d.split(" ")[c.d.split(" ").length - 1]}
                r="3"
                fill={c.color}
              />
            )}
          </g>
        ))}
      </svg>

      {/* 4 Interactive Columns Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 min-w-[1100px] relative z-20">
        {/* ========================================================= */}
        {/* COLUMN 1: Intake & Morning Kickoff ("New Case Management") */}
        {/* ========================================================= */}
        <div className="bg-slate-200/50 dark:bg-slate-900/40 rounded-4xl p-4 border border-slate-300/60 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[480px]">
          <div>
            <div className="flex items-center justify-between mb-4 px-2">
              <h3 className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
                Intake & Morning Kickoff
              </h3>
              <button
                onClick={() => onAddTask("intake")}
                title="Add task"
                className="w-7 h-7 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center hover:bg-slate-900 hover:text-white dark:hover:bg-white dark:hover:text-slate-900 transition-colors shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3.5">
              {stage1Tasks.map((task) => (
                <div
                  key={task.id}
                  id={`task-node-${task.id}`}
                  onClick={() => onEditTask(task)}
                  className={`group bg-white dark:bg-[#141721] rounded-3xl p-4 shadow-sm border transition-all duration-200 cursor-pointer hover:shadow-md hover:-translate-y-0.5 ${
                    task.completed
                      ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/20"
                      : "border-slate-200/80 dark:border-slate-800"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {task.assignedAvatar ? (
                      <img
                        src={task.assignedAvatar}
                        alt="Assignee"
                        className="w-9 h-9 rounded-full object-cover ring-2 ring-slate-100 dark:ring-slate-800 shadow-sm shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0 font-bold text-xs">
                        {task.domain[0].toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h4
                        className={`text-xs font-bold leading-snug line-clamp-2 ${
                          task.completed
                            ? "line-through text-slate-400 dark:text-slate-500"
                            : "text-slate-900 dark:text-slate-100"
                        }`}
                      >
                        {task.title}
                      </h4>
                      {task.description && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                          {task.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/60">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-slate-400 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        {task.dueDate}
                      </span>
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                          task.priority === "urgent"
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                            : task.priority === "high"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                      >
                        {task.priority}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => handleComplete(e, task.id, task.completed)}
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                          task.completed
                            ? "bg-emerald-500 text-white"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                        }`}
                      >
                        <Check className="w-3 h-3 stroke-[3]" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center py-2 mt-4 text-xs font-bold text-slate-500 tracking-wider">
            Cognitive Intake
          </div>
        </div>

        {/* ========================================================= */}
        {/* COLUMN 2: Issue Identification / Active Execution         */}
        {/* ========================================================= */}
        <div className="bg-slate-200/50 dark:bg-slate-900/40 rounded-4xl p-4 border border-slate-300/60 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[480px]">
          <div>
            <div className="flex items-center justify-between mb-4 px-2">
              <h3 className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
                Active Execution
              </h3>
              <button
                onClick={() => onAddTask("execution")}
                title="Add task"
                className="w-7 h-7 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center hover:bg-slate-900 hover:text-white dark:hover:bg-white dark:hover:text-slate-900 transition-colors shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3.5">
              {stage2Tasks.map((task) => (
                <div
                  key={task.id}
                  id={`task-node-${task.id}`}
                  onClick={() => onEditTask(task)}
                  className={`group bg-white dark:bg-[#141721] rounded-3xl p-4 shadow-sm border transition-all duration-200 cursor-pointer hover:shadow-md hover:-translate-y-0.5 ${
                    task.completed
                      ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/20"
                      : "border-slate-200/80 dark:border-slate-800"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {task.assignedAvatar ? (
                      <img
                        src={task.assignedAvatar}
                        alt="Assignee"
                        className="w-9 h-9 rounded-full object-cover ring-2 ring-slate-100 dark:ring-slate-800 shadow-sm shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0 font-bold text-xs">
                        {task.domain[0].toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h4
                        className={`text-xs font-bold leading-snug line-clamp-2 ${
                          task.completed
                            ? "line-through text-slate-400 dark:text-slate-500"
                            : "text-slate-900 dark:text-slate-100"
                        }`}
                      >
                        {task.title}
                      </h4>
                      {task.description && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                          {task.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/60">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-slate-400 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        {task.dueDate}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTriggerAIInsight(task);
                        }}
                        title="AI Strategy"
                        className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40 transition-colors"
                      >
                        <Sparkles className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => handleComplete(e, task.id, task.completed)}
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                          task.completed
                            ? "bg-emerald-500 text-white"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                        }`}
                      >
                        <Check className="w-3 h-3 stroke-[3]" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center py-2 mt-4 text-xs font-bold text-slate-500 tracking-wider">
            Deep Execution
          </div>
        </div>

        {/* ========================================================= */}
        {/* COLUMN 3: Technical Resolution                            */}
        {/* ========================================================= */}
        <div className="bg-slate-200/50 dark:bg-slate-900/40 rounded-4xl p-4 border border-slate-300/60 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[480px]">
          <div>
            <div className="flex items-center justify-between mb-4 px-2">
              <h3 className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
                Technical Resolution
              </h3>
              <button
                onClick={() => onAddTask("resolution")}
                title="Add task"
                className="w-7 h-7 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center hover:bg-slate-900 hover:text-white dark:hover:bg-white dark:hover:text-slate-900 transition-colors shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3.5">
              {stage3Tasks.map((task) => (
                <div
                  key={task.id}
                  id={`task-node-${task.id}`}
                  onClick={() => onEditTask(task)}
                  className={`group bg-white dark:bg-[#141721] rounded-3xl p-4 shadow-sm border transition-all duration-200 cursor-pointer hover:shadow-md hover:-translate-y-0.5 ${
                    task.completed
                      ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/20"
                      : "border-slate-200/80 dark:border-slate-800"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {task.assignedAvatar ? (
                      <img
                        src={task.assignedAvatar}
                        alt="Assignee"
                        className="w-9 h-9 rounded-full object-cover ring-2 ring-slate-100 dark:ring-slate-800 shadow-sm shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                        <Plus className="w-3.5 h-3.5" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h4
                        className={`text-xs font-bold leading-snug line-clamp-2 ${
                          task.completed
                            ? "line-through text-slate-400 dark:text-slate-500"
                            : "text-slate-900 dark:text-slate-100"
                        }`}
                      >
                        {task.title}
                      </h4>
                      {task.description && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                          {task.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/60">
                    <span className="text-[10px] font-semibold text-slate-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {task.dueDate}
                    </span>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => handleComplete(e, task.id, task.completed)}
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                          task.completed
                            ? "bg-emerald-500 text-white"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                        }`}
                      >
                        <Check className="w-3 h-3 stroke-[3]" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center py-2 mt-4 text-xs font-bold text-slate-500 tracking-wider">
            Synthesis & Polish
          </div>
        </div>

        {/* ========================================================= */}
        {/* COLUMN 4: New Tasks & Daily Habits (Tactile Grid & Focus) */}
        {/* ========================================================= */}
        <div className="bg-slate-200/50 dark:bg-slate-900/40 rounded-4xl p-4 border border-slate-300/60 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[480px]">
          <div>
            {/* Action Bar matching the screenshot: +, Share, Calendar */}
            <div className="flex items-center justify-between mb-4 px-2">
              <h3 className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
                Next Actions
              </h3>
              <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-1 rounded-full shadow-sm border border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => onAddTask("next-actions")}
                  title="Add Action"
                  className="w-6 h-6 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300"
                >
                  <Plus className="w-3 h-3" />
                </button>
                <button
                  title="Share Journey"
                  className="w-6 h-6 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300"
                >
                  <Share2 className="w-3 h-3" />
                </button>
                <button
                  title="Archive / Calendar"
                  className="w-6 h-6 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300"
                >
                  <FolderArchive className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* The Highlighted Black Card: "Request Processing" / "Deep Focus Block" matching the screenshot! */}
            <div className="relative mb-4">
              {/* Pointer indicator arrow */}
              <div className="absolute -left-5 top-1/2 -translate-y-1/2 flex items-center text-slate-900 dark:text-white pointer-events-none">
                <ArrowRight className="w-4 h-4 stroke-[2.5] animate-pulse text-rose-500" />
              </div>

              <div
                id="task-node-task-13"
                onClick={() => {
                  const focusTask = tasks.find((t) => t.id === "task-13");
                  if (focusTask) onEditTask(focusTask);
                }}
                className="bg-[#0d0f14] dark:bg-white text-white dark:text-slate-950 rounded-3xl p-5 shadow-floating border border-slate-800 dark:border-slate-200 cursor-pointer hover:scale-[1.02] active:scale-[0.99] transition-all group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 dark:bg-rose-100 dark:text-rose-700">
                    High Priority Focus
                  </span>
                  <Sparkles className="w-4 h-4 text-amber-400 animate-spin-slow" />
                </div>
                <h4 className="text-sm font-extrabold mt-2 tracking-tight group-hover:text-blue-400 dark:group-hover:text-blue-600 transition-colors">
                  Hyperfocus Sprint Active
                </h4>
                <p className="text-[11px] text-slate-400 dark:text-slate-600 mt-1 line-clamp-2">
                  High-leverage cognitive focus sprint • Zero distractions and phone silenced
                </p>
              </div>
            </div>

            {/* Tactile 2-column Grid of Rounded Pill Buttons matching the screenshot! */}
            <div className="grid grid-cols-2 gap-2.5">
              {stage4Tasks
                .filter((t) => t.id !== "task-13")
                .map((task) => (
                  <button
                    key={task.id}
                    id={`task-node-${task.id}`}
                    onClick={() => onEditTask(task)}
                    className={`tactile-btn p-3.5 rounded-2xl text-left border text-xs font-bold leading-tight transition-all shadow-sm ${
                      task.completed
                        ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 text-emerald-800 dark:text-emerald-300 line-through"
                        : "bg-white dark:bg-[#141721] border-slate-200/80 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:border-slate-400 hover:shadow-md"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                      <MoreHorizontal className="w-3 h-3 text-slate-400 opacity-60" />
                    </div>
                    <span className="line-clamp-2">{task.title}</span>
                  </button>
                ))}
            </div>
          </div>

          <div className="text-center py-2 mt-4 text-xs font-bold text-slate-500 tracking-wider">
            Daily Rituals & Habits
          </div>
        </div>
      </div>
    </div>
  );
};

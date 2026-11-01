// Isolated visual preview: synthetic records, no account or network calls.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/redesign.css";
import { TaskMatrixView } from "../../src/components/TaskMatrixView";
import type { Task, TaskAppearance } from "../../src/types";
function Preview() {
  const [appearance, setAppearance] = useState<TaskAppearance>({
    accent: "purple",
    icons: {},
  });
  const [dark, setDark] = useState(false);
  const [subsections, setSubsections] = useState({
    Academic: ["CS 2110", "LMC 3403", "CS 3600"],
  });
  const [tasks, setTasks] = useState<Task[]>([
    {
      id: "1",
      title: "Quiz 3",
      section: "Academic",
      subsection: "CS 2110",
      dueDate: "2026-11-04",
      priority: "medium",
      status: "not_started",
      completed: false,
    },
    {
      id: "2",
      title: "Journal 9",
      description: "Due Nov 4 — 11:59 PM (but finish before that)",
      section: "Academic",
      subsection: "LMC 3403",
      dueDate: "2026-11-04",
      priority: "medium",
      status: "in_progress",
      completed: false,
    },
  ]);
  return (
    <div style={{ padding: "24px", minHeight: "100vh" }}>
      <button
        style={{ marginBottom: "20px" }}
        onClick={() => {
          document.documentElement.classList.toggle("dark");
          setDark(!dark);
        }}
      >
        Switch to {dark ? "light" : "dark"} mode
      </button>
      <TaskMatrixView
        tasks={tasks}
        sections={["Academic"]}
        subsections={subsections}
        appearance={appearance}
        onAppearanceChange={setAppearance}
        onToggleTask={() => {}}
        onStatusChange={(id, status) =>
          setTasks(
            tasks.map((task) =>
              task.id === id
                ? { ...task, status, completed: status === "completed" }
                : task,
            ),
          )
        }
        onAddTask={() => {}}
        onEditTask={() => {}}
        onDeleteTask={(id) => setTasks(tasks.filter((task) => task.id !== id))}
        onAddSection={() => {}}
        onDeleteSection={() => {}}
        onAddSubsection={() => {}}
        onDeleteSubsection={() => {}}
        onRenameSubsection={(section, oldName, name) => {
          setSubsections({
            Academic: subsections.Academic.map((item) =>
              item === oldName ? name : item,
            ),
          });
          setTasks(
            tasks.map((task) =>
              task.subsection === oldName
                ? { ...task, subsection: name }
                : task,
            ),
          );
        }}
        onMoveTask={(id, section, subsection) =>
          setTasks(
            tasks.map((task) =>
              task.id === id ? { ...task, section, subsection } : task,
            ),
          )
        }
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);

import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  CheckCheck,
  ChevronRight,
  Code2,
  ExternalLink,
  FileText,
  Flame,
  FolderOpen,
  GraduationCap,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Target,
  Trash2,
  X,
} from "lucide-react";
import type {
  BrainState,
  TrackerItem,
  TrackerKind,
  TrackerStatus,
  Workspace,
  WorkspaceColor,
} from "../types";
import {
  APPLICATION_STAGES,
  PROBLEM_STAGES,
  WORKSPACE_COLORS,
  field,
  logSolve,
  practiceDays,
  practiceStreak,
  removeWorkspace,
  safeTrackerUrl,
  workspaceItems,
} from "../utils/workspaces";
import { getLocalDateString } from "../utils/habitStreaks";
import { DialogBackdrop } from "./workspace/DialogBackdrop";
import { AcademicWorkspace } from "./academic/AcademicWorkspace";
import { studyOf } from "../utils/study";
import { deleteDocumentTexts } from "../services/studyDocuments";
import { DIFFICULTIES, JOB_TYPES } from "../utils/trackerFields";
import "../workspaces.css";

type Update = (update: (state: BrainState) => BrainState) => void;
interface Props {
  state: BrainState;
  workspaceId?: string;
  createInitially?: boolean;
  onChange: Update;
  onNavigate: (tab: string) => void;
  onAsk: (prompt: string) => void;
}
type Panel = "overview" | "leetcode" | "job_application" | "notes";
const stagesFor = (kind: TrackerKind) =>
  kind === "leetcode" ? PROBLEM_STAGES : APPLICATION_STAGES;
const solved = (item: TrackerItem) =>
  item.status === "done" || item.status === "review";
const dateLabel = (date: string) =>
  date
    ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "—";
const initial = (value: string) => value.trim().slice(0, 1).toUpperCase();
const templateLabel = (template: Workspace["template"]) =>
  template === "career"
    ? "Career workspace"
    : template === "academic"
      ? "Academic workspace"
      : "Personal workspace";
function WorkspaceIcon({ workspace }: { workspace: Workspace }) {
  return (
    <span className={`ws-icon ws-color-${workspace.color}`}>
      {workspace.template === "career" ? (
        <Briefcase size={22} />
      ) : workspace.template === "academic" ? (
        <GraduationCap size={22} />
      ) : (
        <FolderOpen size={22} />
      )}
    </span>
  );
}
function RecordLink({ item }: { item: TrackerItem }) {
  const url = safeTrackerUrl(item.subjectUrl);
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="ws-record-link"
      aria-label={`Open ${item.title} link`}
      onClick={(event) => event.stopPropagation()}
    >
      <ExternalLink size={14} />
    </a>
  ) : null;
}
function StatusSelect({
  item,
  onChange,
}: {
  item: TrackerItem;
  onChange: (status: TrackerStatus) => void;
}) {
  return (
    <select
      className={`ws-status ws-status-${item.status}`}
      aria-label={`Status for ${item.title}`}
      value={item.status}
      onChange={(event) => onChange(event.target.value as TrackerStatus)}
    >
      {stagesFor(item.kind).map((stage) => (
        <option key={stage.id} value={stage.id}>
          {stage.label}
        </option>
      ))}
    </select>
  );
}

export function WorkspacesView({
  state,
  workspaceId,
  createInitially,
  onChange,
  onNavigate,
  onAsk,
}: Props) {
  const workspaces = state.workspaces || [];
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const [panel, setPanel] = useState<Panel>("overview");
  const [workspaceEditor, setWorkspaceEditor] = useState<
    Workspace | "new" | null
  >(createInitially ? "new" : null);
  const [itemEditor, setItemEditor] = useState<{
    kind: TrackerKind;
    item?: TrackerItem;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    Workspace | TrackerItem | null
  >(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [difficulty, setDifficulty] = useState("all");
  const [board, setBoard] = useState(false);
  const items = workspace
    ? workspaceItems(state.trackerItems || [], workspace.id)
    : [];
  const problems = items.filter((item) => item.kind === "leetcode");
  const applications = items.filter((item) => item.kind === "job_application");
  const today = getLocalDateString();
  const solvedCount = problems.filter(solved).length;
  const activeApplications = applications.filter((item) =>
    ["applied", "screening", "onsite"].includes(item.status),
  );
  const switchPanel = (next: Panel) => {
    setPanel(next);
    setSearch("");
    setStatusFilter("all");
    setDifficulty("all");
  };
  const updateItem = (item: TrackerItem) =>
    onChange((prev) => ({
      ...prev,
      trackerItems: (prev.trackerItems || []).map((existing) =>
        existing.id === item.id ? item : existing,
      ),
    }));
  const saveItem = (item: TrackerItem) => {
    onChange((prev) => ({
      ...prev,
      trackerItems: (prev.trackerItems || []).some(
        (existing) => existing.id === item.id,
      )
        ? prev.trackerItems.map((existing) =>
            existing.id === item.id ? item : existing,
          )
        : [...(prev.trackerItems || []), item],
    }));
    setItemEditor(null);
  };
  const saveWorkspace = (next: Workspace) => {
    onChange((prev) => ({
      ...prev,
      workspaces: (prev.workspaces || []).some(
        (existing) => existing.id === next.id,
      )
        ? prev.workspaces!.map((existing) =>
            existing.id === next.id ? next : existing,
          )
        : [...(prev.workspaces || []), next],
    }));
    setWorkspaceEditor(null);
    onNavigate(`workspace:${next.id}`);
  };
  const closeWorkspaceEditor = () => {
    setWorkspaceEditor(null);
    if (createInitially) onNavigate("workspaces");
  };
  const due = items
    .filter((item) => {
      if (
        item.kind === "job_application" &&
        ["not_started", "offer", "rejected"].includes(item.status)
      )
        return false;
      const date = field(
        item,
        item.kind === "leetcode" ? "nextReview" : "followUpDate",
      );
      return date && date <= today;
    })
    .sort((a, b) =>
      field(
        a,
        a.kind === "leetcode" ? "nextReview" : "followUpDate",
      ).localeCompare(
        field(b, b.kind === "leetcode" ? "nextReview" : "followUpDate"),
      ),
    );
  const filteredItems = items.filter(
    (item) =>
      item.kind === panel &&
      (statusFilter === "all" || item.status === statusFilter) &&
      (difficulty === "all" || field(item, "difficulty") === difficulty) &&
      `${item.title} ${item.subject} ${field(item, "topic")} ${field(item, "location")} ${item.notes || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const activity = practiceDays(problems);
  const totalPractice = activity.reduce((sum, day) => sum + day.count, 0);

  return (
    <div className="ws-root">
      {!workspace ? (
        <>
          <div className="ws-page-heading">
            <div>
              <h1 className="page-title">Workspaces</h1>
              <p>Career prep, courses and projects, each with its own space</p>
            </div>
            <button
              className="ws-button ws-primary"
              onClick={() => setWorkspaceEditor("new")}
            >
              <Plus size={16} />
              New workspace
            </button>
          </div>
          <div className="ws-directory">
            {workspaces.map((space) => {
              const entries = workspaceItems(
                state.trackerItems || [],
                space.id,
              );
              return (
                <button
                  className={`ws-workspace-card ws-color-${space.color}`}
                  key={space.id}
                  onClick={() => onNavigate(`workspace:${space.id}`)}
                >
                  <div className="ws-card-top">
                    <WorkspaceIcon workspace={space} />
                    <ArrowRight size={19} />
                  </div>
                  <h2>{space.name}</h2>
                  <p>
                    {space.description ||
                      "A space to make progress on your own terms."}
                  </p>
                  <div className="ws-card-bottom">
                    <span>
                      {templateLabel(space.template)}
                    </span>
                    <span>
                      {space.template === "academic"
                        ? `${studyOf(state).courses.filter((c) => c.workspaceId === space.id).length} courses`
                        : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
                    </span>
                  </div>
                </button>
              );
            })}
            <button
              className="ws-new-card"
              onClick={() => setWorkspaceEditor("new")}
            >
              <span>
                <Plus size={22} />
              </span>
              <strong>Create a workspace</strong>
              <p>Start fresh, or use the Career or Academic template.</p>
            </button>
          </div>
        </>
      ) : (
        <>
          <button className="ws-back" onClick={() => onNavigate("workspaces")}>
            <ArrowLeft size={14} />
            All workspaces
          </button>
          <div className={`ws-hero ws-color-${workspace.color}`}>
            <div className="ws-hero-main">
              <WorkspaceIcon workspace={workspace} />
              <div>
                <div className="ws-hero-eyebrow">
                  {templateLabel(workspace.template)}
                </div>
                <h1>{workspace.name}</h1>
                <p>{workspace.description || "Make room for what matters."}</p>
              </div>
            </div>
            <div className="ws-hero-actions">
              <button
                className="ws-button ws-secondary"
                aria-label="Workspace settings"
                onClick={() => setWorkspaceEditor(workspace)}
              >
                <Settings2 size={15} />
                <span>Customize</span>
              </button>
              <button
                className="ws-icon-button"
                aria-label="Delete workspace"
                onClick={() => setDeleteTarget(workspace)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          <div
            className="ws-tabs"
            role="tablist"
            aria-label="Workspace pages"
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
              const index = tabs.indexOf(event.target as HTMLButtonElement);
              if (index < 0) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              tabs[next].click();
              tabs[next].focus();
            }}
          >
            {(
              [
                workspace.template === "academic"
                  ? { id: "overview", label: "Courses", icon: GraduationCap }
                  : { id: "overview", label: "Overview", icon: LayoutGrid },
                ...(workspace.template === "career"
                  ? [
                      { id: "leetcode", label: "LeetCode", icon: Code2 },
                      {
                        id: "job_application",
                        label: "Applications",
                        icon: Briefcase,
                      },
                    ]
                  : []),
                { id: "notes", label: "Notes", icon: FileText },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                role="tab"
                tabIndex={panel === tab.id ? 0 : -1}
                id={`ws-tab-${tab.id}`}
                aria-selected={panel === tab.id}
                aria-controls="ws-panel"
                onClick={() => switchPanel(tab.id as Panel)}
              >
                <tab.icon size={16} />
                {tab.label}
                {tab.id === "leetcode" && <span>{problems.length}</span>}
                {tab.id === "job_application" && (
                  <span>{applications.length}</span>
                )}
              </button>
            ))}
          </div>
          <section
            id="ws-panel"
            role="tabpanel"
            aria-labelledby={`ws-tab-${panel}`}
          >
            {panel === "overview" && workspace.template === "academic" && (
              <AcademicWorkspace
                state={state}
                workspace={workspace}
                onChange={onChange}
                onAsk={onAsk}
              />
            )}
            {panel === "overview" &&
              workspace.template !== "academic" &&
              (workspace.template === "career" ? (
                <>
                  <div className="ws-stats">
                    {[
                      {
                        label: "Problems solved",
                        value: solvedCount,
                        detail: `${problems.length} in your collection`,
                        icon: Code2,
                        color: "purple",
                      },
                      {
                        label: "Practice streak",
                        value: practiceStreak(problems),
                        detail: "consecutive days",
                        icon: Flame,
                        color: "amber",
                      },
                      {
                        label: "Active applications",
                        value: activeApplications.length,
                        detail: `${applications.length} opportunities tracked`,
                        icon: Briefcase,
                        color: "blue",
                      },
                      {
                        label: "Interviews",
                        value: applications.filter(
                          (item) => item.status === "onsite",
                        ).length,
                        detail: `${applications.filter((item) => item.status === "offer").length} offers received`,
                        icon: Target,
                        color: "green",
                      },
                    ].map((stat) => (
                      <div className="ws-stat" key={stat.label}>
                        <div>
                          <span>{stat.label}</span>
                          <stat.icon
                            size={17}
                            className={`ws-text-${stat.color}`}
                          />
                        </div>
                        <strong>{stat.value}</strong>
                        <small>{stat.detail}</small>
                      </div>
                    ))}
                  </div>
                  <div className="ws-overview-grid">
                    <div className="ws-panel">
                      <div className="ws-panel-heading">
                        <div>
                          <h2>Interview practice</h2>
                          <p>Build a little momentum every day.</p>
                        </div>
                        <button
                          className="ws-text-button"
                          onClick={() => switchPanel("leetcode")}
                        >
                          View tracker
                          <ArrowRight size={14} />
                        </button>
                      </div>
                      <div className="ws-practice-summary">
                        <div
                          className="ws-progress-ring"
                          style={
                            {
                              "--progress": `${problems.length ? (solvedCount / problems.length) * 100 : 0}%`,
                            } as CSSProperties
                          }
                        >
                          <span>
                            <strong>{solvedCount}</strong>
                            <small>solved</small>
                          </span>
                        </div>
                        <div className="ws-difficulty-bars">
                          {DIFFICULTIES.map((level) => {
                            const all = problems.filter(
                              (item) => field(item, "difficulty") === level,
                            );
                            const done = all.filter(solved).length;
                            return (
                              <div key={level}>
                                <div>
                                  <span
                                    className={`ws-difficulty-${level.toLowerCase()}`}
                                  >
                                    {level}
                                  </span>
                                  <small>
                                    {done}
                                    <span> / {all.length}</span>
                                  </small>
                                </div>
                                <div
                                  className={`ws-progress-track ws-difficulty-${level.toLowerCase()}`}
                                >
                                  <i
                                    style={{
                                      width: `${all.length ? (done / all.length) * 100 : 0}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="ws-activity-heading">
                        <span>Last 28 days</span>
                        <small>
                          {totalPractice}{" "}
                          {totalPractice === 1 ? "solve" : "solves"}
                        </small>
                      </div>
                      <div
                        className="ws-activity"
                        aria-label="Practice activity over the last 28 days"
                      >
                        {activity.map((day) => (
                          <span
                            key={day.date}
                            className={
                              day.count > 0
                                ? day.count > 2
                                  ? "is-active is-busy"
                                  : "is-active"
                                : ""
                            }
                            title={`${dateLabel(day.date)}: ${day.count} solves`}
                          />
                        ))}
                      </div>
                      <button
                        className="ws-button ws-secondary ws-full-button"
                        onClick={() => setItemEditor({ kind: "leetcode" })}
                      >
                        <Plus size={15} />
                        Add a problem
                      </button>
                    </div>
                    <div className="ws-panel">
                      <div className="ws-panel-heading">
                        <div>
                          <h2>Application pipeline</h2>
                          <p>Keep your next opportunity moving.</p>
                        </div>
                        <button
                          className="ws-text-button"
                          onClick={() => switchPanel("job_application")}
                        >
                          View all
                          <ArrowRight size={14} />
                        </button>
                      </div>
                      <div className="ws-pipeline">
                        {APPLICATION_STAGES.slice(0, 5).map((stage) => (
                          <button
                            key={stage.id}
                            onClick={() => {
                              switchPanel("job_application");
                              setStatusFilter(stage.id);
                            }}
                          >
                            <span
                              className={`ws-stage-dot ws-status-${stage.id}`}
                            />
                            <span>{stage.label}</span>
                            <strong>
                              {
                                applications.filter(
                                  (item) => item.status === stage.id,
                                ).length
                              }
                            </strong>
                            <ChevronRight size={14} />
                          </button>
                        ))}
                      </div>
                      <button
                        className="ws-button ws-secondary ws-full-button"
                        onClick={() =>
                          setItemEditor({ kind: "job_application" })
                        }
                      >
                        <Plus size={15} />
                        Add an application
                      </button>
                    </div>
                    <div className="ws-panel ws-next-panel">
                      <div className="ws-panel-heading">
                        <div>
                          <h2>On your radar</h2>
                          <p>Reviews and follow-ups due today or earlier.</p>
                        </div>
                        <span className="ws-count">{due.length}</span>
                      </div>
                      {due.length ? (
                        <div className="ws-due-list">
                          {due.slice(0, 8).map((item) => (
                            <button
                              key={item.id}
                              onClick={() =>
                                setItemEditor({ kind: item.kind, item })
                              }
                            >
                              <span
                                className={`ws-small-icon ${item.kind === "leetcode" ? "ws-color-purple" : "ws-color-blue"}`}
                              >
                                {item.kind === "leetcode" ? (
                                  <Code2 size={16} />
                                ) : (
                                  <Briefcase size={16} />
                                )}
                              </span>
                              <span>
                                <strong>{item.title}</strong>
                                <small>
                                  {item.kind === "leetcode"
                                    ? "Review problem"
                                    : `Follow up · ${item.subject}`}
                                </small>
                              </span>
                              <span className="ws-due-date">
                                {dateLabel(
                                  field(
                                    item,
                                    item.kind === "leetcode"
                                      ? "nextReview"
                                      : "followUpDate",
                                  ),
                                )}
                              </span>
                              <ChevronRight size={14} />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="ws-radar-empty">
                          <CheckCheck size={25} />
                          <div>
                            <strong>You’re all caught up</strong>
                            <p>
                              Add review dates and follow-ups to see what’s
                              next.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="ws-blank-overview ws-panel">
                  <span className="ws-icon">
                    <FileText size={25} />
                  </span>
                  <h2>A fresh space for your ideas</h2>
                  <p>
                    Keep plans, useful links, and next steps in your workspace
                    notes.
                  </p>
                  <button
                    className="ws-button ws-primary"
                    onClick={() => switchPanel("notes")}
                  >
                    Open notes
                    <ArrowRight size={16} />
                  </button>
                </div>
              ))}
            {(panel === "leetcode" || panel === "job_application") && (
              <>
                <div className="ws-tracker-heading">
                  <div>
                    <h2>
                      {panel === "leetcode"
                        ? "LeetCode tracker"
                        : "Job applications"}
                    </h2>
                    <p>
                      {panel === "leetcode"
                        ? `${solvedCount} solved · ${problems.filter((item) => item.status === "review").length} marked to revisit`
                        : `${activeApplications.length} active · ${applications.filter((item) => item.status === "offer").length} offers`}
                    </p>
                  </div>
                  <button
                    className="ws-button ws-primary"
                    onClick={() => setItemEditor({ kind: panel })}
                  >
                    <Plus size={16} />
                    {panel === "leetcode" ? "Add problem" : "Add application"}
                  </button>
                </div>
                <div className="ws-toolbar">
                  <label className="ws-search">
                    <Search size={16} />
                    <input
                      aria-label={
                        panel === "leetcode"
                          ? "Search problems"
                          : "Search applications"
                      }
                      placeholder={
                        panel === "leetcode"
                          ? "Search problems or topics…"
                          : "Search companies or roles…"
                      }
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Filter by status"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    {stagesFor(panel).map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.label}
                      </option>
                    ))}
                  </select>
                  {panel === "leetcode" ? (
                    <select
                      aria-label="Filter by difficulty"
                      value={difficulty}
                      onChange={(event) => setDifficulty(event.target.value)}
                    >
                      <option value="all">All difficulties</option>
                      {DIFFICULTIES.map((level) => (
                        <option key={level}>{level}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="ws-view-toggle">
                      <button
                        aria-label="Table view"
                        aria-pressed={!board}
                        onClick={() => setBoard(false)}
                      >
                        <List size={16} />
                      </button>
                      <button
                        aria-label="Board view"
                        aria-pressed={board}
                        onClick={() => setBoard(true)}
                      >
                        <LayoutGrid size={16} />
                      </button>
                    </div>
                  )}
                </div>
                {filteredItems.length === 0 ? (
                  <div className="ws-empty ws-panel">
                    <span className="ws-empty-icon">
                      {panel === "leetcode" ? (
                        <Code2 size={27} />
                      ) : (
                        <Briefcase size={27} />
                      )}
                    </span>
                    <h3>
                      {search || statusFilter !== "all" || difficulty !== "all"
                        ? "No matches"
                        : panel === "leetcode"
                          ? "Your practice starts here"
                          : "Your next opportunity starts here"}
                    </h3>
                    <p>
                      {search || statusFilter !== "all" || difficulty !== "all"
                        ? "Try a different search or clear your filters."
                        : panel === "leetcode"
                          ? "Save a problem, track your approach, and come back for a review."
                          : "Save an interesting role and follow it from wishlist to offer."}
                    </p>
                    {search ||
                    statusFilter !== "all" ||
                    difficulty !== "all" ? (
                      <button
                        className="ws-button ws-secondary"
                        onClick={() => {
                          setSearch("");
                          setStatusFilter("all");
                          setDifficulty("all");
                        }}
                      >
                        Clear filters
                      </button>
                    ) : (
                      <button
                        className="ws-button ws-primary"
                        onClick={() => setItemEditor({ kind: panel })}
                      >
                        <Plus size={15} />
                        {panel === "leetcode"
                          ? "Add your first problem"
                          : "Add your first application"}
                      </button>
                    )}
                  </div>
                ) : panel === "job_application" && board ? (
                  <div className="ws-board">
                    {APPLICATION_STAGES.filter(
                      (stage) =>
                        statusFilter === "all" || statusFilter === stage.id,
                    ).map((stage) => (
                      <section className="ws-board-column" key={stage.id}>
                        <h3>
                          <span
                            className={`ws-stage-dot ws-status-${stage.id}`}
                          />
                          {stage.label}
                          <small>
                            {
                              filteredItems.filter(
                                (item) => item.status === stage.id,
                              ).length
                            }
                          </small>
                        </h3>
                        {filteredItems
                          .filter((item) => item.status === stage.id)
                          .map((item) => (
                            <div className="ws-board-card" key={item.id}>
                              <div className="ws-board-company">
                                <span className="ws-company-avatar">
                                  {initial(item.subject)}
                                </span>
                                <strong>{item.subject}</strong>
                                <RecordLink item={item} />
                              </div>
                              <button
                                className="ws-record-title"
                                onClick={() =>
                                  setItemEditor({ kind: item.kind, item })
                                }
                              >
                                {item.title}
                              </button>
                              {field(item, "location") && (
                                <p>{field(item, "location")}</p>
                              )}
                              <StatusSelect
                                item={item}
                                onChange={(status) =>
                                  updateItem({
                                    ...item,
                                    status,
                                    updatedAt: new Date().toISOString(),
                                  })
                                }
                              />
                              {field(item, "followUpDate") && (
                                <small>
                                  Follow up{" "}
                                  {dateLabel(field(item, "followUpDate"))}
                                </small>
                              )}
                              <button
                                className="ws-text-button"
                                onClick={() =>
                                  setItemEditor({ kind: item.kind, item })
                                }
                              >
                                Edit details
                                <ArrowRight size={13} />
                              </button>
                            </div>
                          ))}
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="ws-table-wrap">
                    <table className="ws-table">
                      <thead>
                        <tr>
                          {(panel === "leetcode"
                            ? [
                                "Problem",
                                "Difficulty",
                                "Topic",
                                "Status",
                                "Last practiced",
                                "Review",
                                "Actions",
                              ]
                            : [
                                "Company / Role",
                                "Location",
                                "Stage",
                                "Applied",
                                "Follow up",
                                "Actions",
                              ]
                          ).map((column) => (
                            <th key={column}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <div className="ws-title-cell">
                                {item.kind === "job_application" && (
                                  <span className="ws-company-avatar">
                                    {initial(item.subject)}
                                  </span>
                                )}
                                <div>
                                  {item.kind === "job_application" && (
                                    <span className="ws-company-name">
                                      {item.subject}
                                    </span>
                                  )}
                                  <button
                                    className="ws-record-title"
                                    onClick={() =>
                                      setItemEditor({ kind: item.kind, item })
                                    }
                                  >
                                    {item.kind === "leetcode" &&
                                      field(item, "number") && (
                                        <span className="ws-problem-number">
                                          {field(item, "number")}.{" "}
                                        </span>
                                      )}
                                    {item.title}
                                  </button>
                                </div>
                                <RecordLink item={item} />
                              </div>
                            </td>
                            {item.kind === "leetcode" ? (
                              <>
                                <td>
                                  <span
                                    className={`ws-pill ws-difficulty-${field(item, "difficulty").toLowerCase()}`}
                                  >
                                    {field(item, "difficulty") || "—"}
                                  </span>
                                </td>
                                <td>
                                  <span className="ws-topic">
                                    {field(item, "topic") || "—"}
                                  </span>
                                </td>
                              </>
                            ) : (
                              <td>{field(item, "location") || "—"}</td>
                            )}
                            <td>
                              <StatusSelect
                                item={item}
                                onChange={(status) =>
                                  updateItem({
                                    ...item,
                                    status,
                                    updatedAt: new Date().toISOString(),
                                  })
                                }
                              />
                            </td>
                            <td>
                              {dateLabel(
                                field(
                                  item,
                                  item.kind === "leetcode"
                                    ? "lastPractice"
                                    : "appliedDate",
                                ),
                              )}
                            </td>
                            <td>
                              <span
                                className={
                                  field(
                                    item,
                                    item.kind === "leetcode"
                                      ? "nextReview"
                                      : "followUpDate",
                                  ) &&
                                  field(
                                    item,
                                    item.kind === "leetcode"
                                      ? "nextReview"
                                      : "followUpDate",
                                  ) <= today
                                    ? "ws-date-due"
                                    : ""
                                }
                              >
                                {dateLabel(
                                  field(
                                    item,
                                    item.kind === "leetcode"
                                      ? "nextReview"
                                      : "followUpDate",
                                  ),
                                )}
                              </span>
                            </td>
                            <td>
                              <div className="ws-row-actions">
                                {item.kind === "leetcode" && (
                                  <button
                                    className="ws-icon-button ws-solve-button"
                                    aria-label={`Log solve for ${item.title}`}
                                    title="Log a solve today; review in 7 days"
                                    onClick={() => updateItem(logSolve(item))}
                                  >
                                    <Check size={16} />
                                  </button>
                                )}
                                <button
                                  className="ws-icon-button"
                                  aria-label={`Edit ${item.title}`}
                                  onClick={() =>
                                    setItemEditor({ kind: item.kind, item })
                                  }
                                >
                                  <MoreHorizontal size={17} />
                                </button>
                                <button
                                  className="ws-icon-button ws-delete-button"
                                  aria-label={`Delete ${item.title}`}
                                  onClick={() => setDeleteTarget(item)}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="ws-table-footer">
                      {filteredItems.length} of{" "}
                      {panel === "leetcode"
                        ? problems.length
                        : applications.length}{" "}
                      {panel === "leetcode" ? "problems" : "applications"}
                      {panel === "leetcode" && (
                        <span>
                          <Check size={12} />
                          Log solve records today and schedules a review in 7
                          days.
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
            {panel === "notes" && (
              <div className="ws-panel ws-notes">
                <div className="ws-panel-heading">
                  <div>
                    <h2>Workspace notes</h2>
                    <p>
                      {workspace.template === "career"
                        ? "Interview prep, useful links, and the things you want to remember."
                        : "Plans, ideas, and next steps. All in one place."}
                    </p>
                  </div>
                  <span className="ws-note-hint">Saves as you type</span>
                </div>
                <label className="sr-only" htmlFor="workspace-notes">
                  Workspace notes
                </label>
                <textarea
                  id="workspace-notes"
                  maxLength={200000}
                  value={workspace.notes}
                  placeholder={
                    workspace.template === "career"
                      ? "Interview prep\n\nWhat I’m working on…\n\nUseful links\n\nNext steps"
                      : "What are you working toward?\n\nStart writing here…"
                  }
                  onChange={(event) => {
                    const notes = event.target.value;
                    onChange((prev) => ({
                      ...prev,
                      workspaces: (prev.workspaces || []).map((space) =>
                        space.id === workspace.id ? { ...space, notes } : space,
                      ),
                    }));
                  }}
                />
              </div>
            )}
          </section>
        </>
      )}
      {workspaceEditor && (
        <WorkspaceEditor
          workspace={workspaceEditor === "new" ? undefined : workspaceEditor}
          onSave={saveWorkspace}
          onClose={closeWorkspaceEditor}
        />
      )}
      {itemEditor && workspace && (
        <TrackerEditor
          kind={itemEditor.kind}
          item={itemEditor.item}
          workspaceId={workspace.id}
          onClose={() => setItemEditor(null)}
          onSave={saveItem}
        />
      )}
      {deleteTarget && (
        <DialogBackdrop
          label="Confirm deletion"
          onClose={() => setDeleteTarget(null)}
          className="ws-overlay"
        >
          <div className="ws-dialog ws-confirm">
            <span className="ws-confirm-icon">
              <Trash2 size={24} />
            </span>
            <h2>
              Delete{" "}
              {"template" in deleteTarget
                ? deleteTarget.name
                : deleteTarget.title}
              ?
            </h2>
            <p>
              {"template" in deleteTarget
                ? "This removes this workspace, its notes, tracker entries, and any courses with their materials, flashcards and quizzes. Your other workspaces stay intact."
                : "This entry and its practice history will be permanently removed."}
            </p>
            <div className="ws-dialog-actions">
              <button
                className="ws-button ws-secondary"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                className="ws-button ws-danger"
                onClick={() => {
                  if ("template" in deleteTarget) {
                    const documentIds = studyOf(state)
                      .documents.filter((d) =>
                        studyOf(state).courses.some(
                          (c) => c.id === d.courseId && c.workspaceId === deleteTarget.id,
                        ),
                      )
                      .map((d) => d.id);
                    onChange((prev) => removeWorkspace(prev, deleteTarget.id));
                    deleteDocumentTexts(state.userId || "guest", documentIds).catch(() => {});
                    onNavigate("workspaces");
                  } else {
                    onChange((prev) => ({
                      ...prev,
                      trackerItems: (prev.trackerItems || []).filter(
                        (item) => item.id !== deleteTarget.id,
                      ),
                    }));
                  }
                  setDeleteTarget(null);
                }}
              >
                Delete {"template" in deleteTarget ? "workspace" : "entry"}
              </button>
            </div>
          </div>
        </DialogBackdrop>
      )}
    </div>
  );
}

function WorkspaceEditor({
  workspace,
  onSave,
  onClose,
}: {
  workspace?: Workspace;
  onSave: (workspace: Workspace) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(workspace?.name || "");
  const [description, setDescription] = useState(workspace?.description || "");
  const [template, setTemplate] = useState<Workspace["template"]>(
    workspace?.template || "career",
  );
  const [color, setColor] = useState<WorkspaceColor>(
    workspace?.color || "purple",
  );
  return (
    <DialogBackdrop
      label={workspace ? "Customize workspace" : "Create workspace"}
      onClose={onClose}
      className="ws-overlay"
    >
      <form
        className="ws-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          onSave({
            id: workspace?.id || crypto.randomUUID(),
            name: name.trim(),
            description: description.trim(),
            template,
            color,
            notes: workspace?.notes || "",
            createdAt: workspace?.createdAt || new Date().toISOString(),
          });
        }}
      >
        <div className="ws-dialog-heading">
          <div>
            <span className={`ws-icon ws-color-${color}`}>
              <FolderOpen size={22} />
            </span>
            <h2>
              {workspace ? "Make it yours" : "A space for your next chapter"}
            </h2>
            <p>
              {workspace
                ? "Give your workspace a name and a little personality."
                : "Keep a project, a goal, or a whole part of life together."}
            </p>
          </div>
          <button
            className="ws-icon-button"
            type="button"
            aria-label="Close workspace editor"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <div className="ws-form-body">
          <label>
            Workspace name
            <input
              autoFocus
              required
              maxLength={80}
              value={name}
              placeholder="e.g. Career, Side projects, Learning"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Description <small>optional</small>
            <textarea
              maxLength={300}
              rows={2}
              value={description}
              placeholder="What’s this space for?"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          {!workspace && (
            <fieldset>
              <legend>Start with</legend>
              <div className="ws-template-options">
                <button
                  type="button"
                  aria-pressed={template === "career"}
                  onClick={() => setTemplate("career")}
                >
                  <Briefcase size={20} />
                  <strong>Career</strong>
                  <span>LeetCode, applications & notes</span>
                  {template === "career" && <Check size={15} />}
                </button>
                <button
                  type="button"
                  aria-pressed={template === "academic"}
                  onClick={() => setTemplate("academic")}
                >
                  <GraduationCap size={20} />
                  <strong>Academic</strong>
                  <span>Courses, materials, flashcards & quizzes</span>
                  {template === "academic" && <Check size={15} />}
                </button>
                <button
                  type="button"
                  aria-pressed={template === "blank"}
                  onClick={() => setTemplate("blank")}
                >
                  <FileText size={20} />
                  <strong>Blank space</strong>
                  <span>A clean page for your notes</span>
                  {template === "blank" && <Check size={15} />}
                </button>
              </div>
            </fieldset>
          )}
          <fieldset>
            <legend>Color</legend>
            <div className="ws-color-picker">
              {WORKSPACE_COLORS.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-label={`${value} workspace color`}
                  aria-pressed={color === value}
                  className={`ws-color-${value}`}
                  onClick={() => setColor(value)}
                >
                  {color === value && <Check size={16} />}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="ws-dialog-actions">
          <button
            type="button"
            className="ws-button ws-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="ws-button ws-primary"
            disabled={!name.trim()}
          >
            {workspace ? "Save changes" : "Create workspace"}
            <ArrowRight size={15} />
          </button>
        </div>
      </form>
    </DialogBackdrop>
  );
}

function TrackerEditor({
  kind,
  item,
  workspaceId,
  onSave,
  onClose,
}: {
  kind: TrackerKind;
  item?: TrackerItem;
  workspaceId: string;
  onSave: (item: TrackerItem) => void;
  onClose: () => void;
}) {
  const problem = kind === "leetcode";
  const [title, setTitle] = useState(item?.title || "");
  const [company, setCompany] = useState(item?.subject || "");
  const [url, setUrl] = useState(item?.subjectUrl || "");
  const [status, setStatus] = useState<TrackerStatus>(
    item?.status || "not_started",
  );
  const [notes, setNotes] = useState(item?.notes || "");
  const [fields, setFields] = useState<Record<string, unknown>>(
    item?.fields || (problem ? { difficulty: "Medium" } : {}),
  );
  const [error, setError] = useState("");
  const setField = (key: string, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));
  const value = (key: string) =>
    typeof fields[key] === "string" || typeof fields[key] === "number"
      ? String(fields[key])
      : "";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || (!problem && !company.trim())) return;
    if (url.trim() && !safeTrackerUrl(url.trim())) {
      setError("Enter a full http:// or https:// link.");
      return;
    }
    const now = new Date().toISOString();
    onSave({
      ...item,
      id: item?.id || crypto.randomUUID(),
      workspaceId,
      kind,
      title: title.trim(),
      subject: problem ? title.trim() : company.trim(),
      subjectUrl: url.trim() || undefined,
      status,
      fields,
      notes: notes.trim(),
      history: item?.history || {},
      streak: item?.streak || 0,
      bestStreak: item?.bestStreak || 0,
      createdAt: item?.createdAt || now,
      updatedAt: now,
    });
  };
  return (
    <DialogBackdrop
      label={`${item ? "Edit" : "Add"} ${problem ? "problem" : "application"}`}
      onClose={onClose}
      className="ws-overlay"
    >
      <form className="ws-dialog ws-tracker-dialog" onSubmit={submit}>
        <div className="ws-dialog-heading">
          <div>
            <span
              className={`ws-icon ${problem ? "ws-color-purple" : "ws-color-blue"}`}
            >
              {problem ? <Code2 size={22} /> : <Briefcase size={22} />}
            </span>
            <h2>
              {item ? "Edit" : "Add"} {problem ? "a problem" : "an application"}
            </h2>
            <p>
              {problem
                ? "Capture the problem. Keep the approach. Build the habit."
                : "One place for the role, the details, and your next step."}
            </p>
          </div>
          <button
            className="ws-icon-button"
            type="button"
            aria-label="Close tracker editor"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <div className="ws-form-body">
          {!problem && (
            <label>
              Company
              <input
                autoFocus
                required
                maxLength={160}
                value={company}
                placeholder="Company name"
                onChange={(event) => setCompany(event.target.value)}
              />
            </label>
          )}
          <label>
            {problem ? "Problem title" : "Role"}
            <input
              autoFocus={problem}
              required
              maxLength={240}
              value={title}
              placeholder={
                problem ? "e.g. Two Sum" : "e.g. Software Engineer Intern"
              }
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="ws-form-grid">
            {problem ? (
              <>
                <label>
                  Problem number
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={value("number")}
                    placeholder="e.g. 1"
                    onChange={(event) => setField("number", event.target.value)}
                  />
                </label>
                <label>
                  Difficulty
                  <select
                    value={value("difficulty") || "Medium"}
                    onChange={(event) =>
                      setField("difficulty", event.target.value)
                    }
                  >
                    {DIFFICULTIES.map((level) => (
                      <option key={level}>{level}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  Location
                  <input
                    value={value("location")}
                    placeholder="e.g. Atlanta, GA / Remote"
                    onChange={(event) =>
                      setField("location", event.target.value)
                    }
                  />
                </label>
                <label>
                  Job type
                  <select
                    value={value("jobType")}
                    onChange={(event) =>
                      setField("jobType", event.target.value)
                    }
                  >
                    <option value="">Select type</option>
                    {JOB_TYPES.map(
                      (type) => (
                        <option key={type}>{type}</option>
                      ),
                    )}
                  </select>
                </label>
              </>
            )}
          </div>
          {problem && (
            <label>
              Topic
              <input
                value={value("topic")}
                placeholder="e.g. Arrays, Hash maps"
                maxLength={160}
                onChange={(event) => setField("topic", event.target.value)}
              />
            </label>
          )}
          <label>
            {problem ? "Problem link" : "Job posting link"}{" "}
            <small>optional</small>
            <input
              type="url"
              value={url}
              placeholder={
                problem ? "https://leetcode.com/problems/…" : "https://…"
              }
              onChange={(event) => {
                setUrl(event.target.value);
                setError("");
              }}
            />
          </label>
          <label>
            {problem ? "Status" : "Application stage"}
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as TrackerStatus)
              }
            >
              {stagesFor(kind).map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.label}
                </option>
              ))}
            </select>
          </label>
          <div className="ws-form-grid">
            <label>
              {problem ? "Last practiced" : "Applied date"}
              <input
                type="date"
                value={value(problem ? "lastPractice" : "appliedDate")}
                onChange={(event) =>
                  setField(
                    problem ? "lastPractice" : "appliedDate",
                    event.target.value,
                  )
                }
              />
            </label>
            <label>
              {problem ? "Next review" : "Follow-up date"}
              <input
                type="date"
                value={value(problem ? "nextReview" : "followUpDate")}
                onChange={(event) =>
                  setField(
                    problem ? "nextReview" : "followUpDate",
                    event.target.value,
                  )
                }
              />
            </label>
          </div>
          {!problem && (
            <label>
              Contact / recruiter <small>optional</small>
              <input
                value={value("contact")}
                placeholder="Name, email, or LinkedIn"
                onChange={(event) => setField("contact", event.target.value)}
              />
            </label>
          )}
          <label>
            {problem ? "Approach & notes" : "Notes & next steps"}
            <textarea
              rows={4}
              maxLength={10000}
              value={notes}
              placeholder={
                problem
                  ? "Key insight, complexity, mistakes to watch for…"
                  : "Interview details, referral, next steps…"
              }
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          {error && (
            <p className="ws-form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="ws-dialog-actions">
          <button
            type="button"
            className="ws-button ws-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="ws-button ws-primary"
            disabled={!title.trim() || (!problem && !company.trim())}
          >
            <Check size={15} />
            {item
              ? "Save changes"
              : problem
                ? "Add problem"
                : "Add application"}
          </button>
        </div>
      </form>
    </DialogBackdrop>
  );
}

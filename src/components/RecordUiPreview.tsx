import {
  ArrowUpRight,
  Briefcase,
  CalendarClock,
  CalendarDays,
  Check,
  CheckSquare,
  Clock,
  Code2,
  FileText,
  Flame,
  MapPin,
  Target,
} from "lucide-react";
import type { BrainState } from "../types";
import { findRecord, formatRecordDate, referenceTitle } from "../utils/chatPresentation";
import { eventTimeLabel, formatTime } from "../utils/events";
import { getRecordLocation, navigateToRecord } from "../utils/recordNavigation";

interface RecordUiPreviewProps {
  type: string;
  id: string;
  title?: string;
  state?: BrainState | null;
  onNavigate?: () => void;
  compact?: boolean;
}

export function RecordUiPreview({
  type,
  id,
  title,
  state,
  onNavigate,
  compact = false,
}: RecordUiPreviewProps) {
  const record = findRecord(state, type, id);
  const resolvedTitle = title || referenceTitle(type, id, undefined, state);
  const location = getRecordLocation(state, type, id);

  const handleGoTo = () => {
    if (onNavigate) {
      onNavigate();
    } else {
      navigateToRecord(type, id, resolvedTitle, state);
    }
  };

  if (!record) {
    return (
      <div className="record-ui-preview record-ui-missing">
        <p className="text-xs text-muted">This record was removed or is not available in your workspace.</p>
      </div>
    );
  }

  // --- 1. TRACKER: Job Application or LeetCode ---
  if (type === "tracker" && "kind" in record) {
    const tracker = record as any;
    const isJob = tracker.kind === "job_application";

    if (isJob) {
      const company = tracker.subject || "Company";
      const initial = (company.trim()[0] || "C").toUpperCase();
      const status = tracker.status || "applied";
      const locationField = tracker.fields?.location || "";
      const jobType = tracker.fields?.jobType || "";
      const appliedDate = tracker.fields?.appliedDate || "";
      const followUpDate = tracker.fields?.followUpDate || "";
      const notes = tracker.notes || tracker.description || "";
      const streak = tracker.streak || 0;

      return (
        <div className={`record-ui-preview record-ui-job ${compact ? "is-compact" : ""}`}>
          <div className="record-ui-header-bar">
            <div className="record-ui-location-badge" title={location.breadcrumb}>
              <span className="record-ui-loc-icon">📍</span>
              <span className="record-ui-loc-text">{location.breadcrumb}</span>
            </div>
            <button
              type="button"
              className="record-ui-jump-btn"
              onClick={handleGoTo}
              title={`Open ${resolvedTitle} in workspace`}
            >
              <span>Go to in application</span>
              <ArrowUpRight size={13} />
            </button>
          </div>

          <div className="record-job-card-simulation">
            <div className="record-job-top">
              <span className="record-job-avatar" aria-hidden="true">
                {initial}
              </span>
              <div className="record-job-titles">
                <div className="record-job-company-row">
                  <span className="record-job-company">{company}</span>
                  <span className={`record-stage-pill stage-${status}`}>
                    <span className="stage-dot" />
                    <span className="capitalize">{status.replace(/_/g, " ")}</span>
                  </span>
                </div>
                <h4 className="record-job-role">{tracker.title}</h4>
              </div>
            </div>

            <div className="record-job-meta-grid">
              {locationField && (
                <div className="record-meta-chip">
                  <MapPin size={12} />
                  <span>{locationField}</span>
                </div>
              )}
              {jobType && (
                <div className="record-meta-chip">
                  <Briefcase size={12} />
                  <span>{jobType}</span>
                </div>
              )}
              {appliedDate && (
                <div className="record-meta-chip">
                  <CalendarDays size={12} />
                  <span>Applied {formatRecordDate(appliedDate)}</span>
                </div>
              )}
              {followUpDate && (
                <div className="record-meta-chip is-highlight">
                  <Clock size={12} />
                  <span>Follow-up {formatRecordDate(followUpDate)}</span>
                </div>
              )}
              {streak > 0 && (
                <div className="record-meta-chip is-streak">
                  <Flame size={12} />
                  <span>{streak}-day streak</span>
                </div>
              )}
            </div>

            {notes && (
              <p className="record-job-notes-snippet">
                {notes.length > 220 ? `${notes.slice(0, 220)}…` : notes}
              </p>
            )}

            <div className="record-ui-footer-action">
              <span className="record-added-indicator">
                <Check size={12} />
                <span>Added to your workspace</span>
              </span>
              <button
                type="button"
                className="record-open-link-btn"
                onClick={handleGoTo}
              >
                <span>View in Career Workspace</span>
                <ArrowUpRight size={12} />
              </button>
            </div>
          </div>
        </div>
      );
    }

    // LeetCode problem tracker
    const number = tracker.fields?.number ? `#${tracker.fields.number} ` : "";
    const difficulty = String(tracker.fields?.difficulty || "Medium");
    const topic = tracker.fields?.topic || "";
    const nextReview = tracker.fields?.nextReview || "";

    return (
      <div className={`record-ui-preview record-ui-leetcode ${compact ? "is-compact" : ""}`}>
        <div className="record-ui-header-bar">
          <div className="record-ui-location-badge">
            <span className="record-ui-loc-icon">📍</span>
            <span className="record-ui-loc-text">{location.breadcrumb}</span>
          </div>
          <button type="button" className="record-ui-jump-btn" onClick={handleGoTo}>
            <span>Go to in application</span>
            <ArrowUpRight size={13} />
          </button>
        </div>

        <div className="record-leetcode-card-simulation">
          <div className="record-leetcode-top">
            <span className="record-leetcode-icon">
              <Code2 size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <h4 className="record-leetcode-title">
                {number}{tracker.title}
              </h4>
              <div className="record-leetcode-badges">
                <span className={`ws-pill ws-difficulty-${difficulty.toLowerCase()}`}>
                  {difficulty}
                </span>
                {topic && <span className="record-meta-chip">{topic}</span>}
                {nextReview && (
                  <span className="record-meta-chip">
                    <Clock size={12} />
                    <span>Review: {formatRecordDate(nextReview)}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="record-ui-footer-action">
            <span className="record-added-indicator">
              <Check size={12} />
              <span>Added to your LeetCode tracker</span>
            </span>
            <button type="button" className="record-open-link-btn" onClick={handleGoTo}>
              <span>View problem in tracker</span>
              <ArrowUpRight size={12} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- 2. TASK ---
  if (type === "task") {
    const task = record as any;
    const status = task.status || (task.completed ? "completed" : "not_started");
    const priority = task.priority || "medium";
    const dueDate = task.dueDate || "";
    const dueTime = task.dueTime || "";
    const description = task.description || "";
    const subtasks = task.subtasks || [];

    return (
      <div className={`record-ui-preview record-ui-task ${compact ? "is-compact" : ""}`}>
        <div className="record-ui-header-bar">
          <div className="record-ui-location-badge">
            <span className="record-ui-loc-icon">📍</span>
            <span className="record-ui-loc-text">{location.breadcrumb}</span>
          </div>
          <button type="button" className="record-ui-jump-btn" onClick={handleGoTo}>
            <span>Go to in application</span>
            <ArrowUpRight size={13} />
          </button>
        </div>

        <div className="record-task-card-simulation">
          <div className="record-task-main-row">
            <div className={`record-task-check ${status === "completed" ? "is-completed" : ""}`}>
              {status === "completed" ? <Check size={13} /> : <span />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className={`record-task-title ${status === "completed" ? "line-through opacity-70" : ""}`}>
                  {task.title}
                </h4>
                <span className={`record-priority-pill priority-${priority}`}>
                  {priority}
                </span>
                <span className="record-section-pill">
                  {task.section || "Academic"}{task.subsection ? ` › ${task.subsection}` : ""}
                </span>
              </div>
              {description && <p className="record-task-desc">{description}</p>}
            </div>
          </div>

          <div className="record-task-meta-bar">
            {dueDate && (
              <span className="record-meta-chip">
                <CalendarDays size={12} />
                <span>Due {formatRecordDate(dueDate)}{dueTime ? ` at ${formatTime(dueTime)}` : ""}</span>
              </span>
            )}
            {subtasks.length > 0 && (
              <span className="record-meta-chip">
                <CheckSquare size={12} />
                <span>{subtasks.filter((s: any) => s.completed).length}/{subtasks.length} subtasks</span>
              </span>
            )}
          </div>

          <div className="record-ui-footer-action">
            <span className="record-added-indicator">
              <Check size={12} />
              <span>Added to Tasks Matrix</span>
            </span>
            <button type="button" className="record-open-link-btn" onClick={handleGoTo}>
              <span>View in Tasks Matrix</span>
              <ArrowUpRight size={12} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- 3. GOAL ---
  if (type === "goal") {
    const goal = record as any;
    const progress = typeof goal.progress === "number" ? goal.progress : 0;
    const milestones = goal.milestones || [];

    return (
      <div className={`record-ui-preview record-ui-goal ${compact ? "is-compact" : ""}`}>
        <div className="record-ui-header-bar">
          <div className="record-ui-location-badge">
            <span className="record-ui-loc-icon">📍</span>
            <span className="record-ui-loc-text">{location.breadcrumb}</span>
          </div>
          <button type="button" className="record-ui-jump-btn" onClick={handleGoTo}>
            <span>Go to in application</span>
            <ArrowUpRight size={13} />
          </button>
        </div>

        <div className="record-goal-card-simulation">
          <div className="flex items-center gap-2">
            <Target size={16} className="text-indigo-500 shrink-0" />
            <h4 className="font-semibold text-sm text-[var(--workspace-ink)]">{goal.title}</h4>
            <span className="record-status-pill ml-auto capitalize">{goal.status || "in_progress"}</span>
          </div>

          {goal.why && <p className="text-xs text-muted mt-1">{goal.why}</p>}

          <div className="record-progress-box mt-3">
            <div className="flex justify-between text-xs text-muted mb-1">
              <span>Progress</span>
              <span>{progress}%</span>
            </div>
            <div className="record-progress-track">
              <div className="record-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {milestones.length > 0 && (
            <div className="record-milestones-preview mt-2">
              <span className="text-xs text-muted font-medium">{milestones.length} Milestones</span>
            </div>
          )}

          <div className="record-ui-footer-action">
            <span className="record-added-indicator">
              <Check size={12} />
              <span>Added to Life Goals</span>
            </span>
            <button type="button" className="record-open-link-btn" onClick={handleGoTo}>
              <span>View in Goals & Vision</span>
              <ArrowUpRight size={12} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- 4. HABIT ---
  if (type === "habit") {
    const habit = record as any;
    const streak = habit.streak || 0;

    return (
      <div className={`record-ui-preview record-ui-habit ${compact ? "is-compact" : ""}`}>
        <div className="record-ui-header-bar">
          <div className="record-ui-location-badge">
            <span className="record-ui-loc-icon">📍</span>
            <span className="record-ui-loc-text">{location.breadcrumb}</span>
          </div>
          <button type="button" className="record-ui-jump-btn" onClick={handleGoTo}>
            <span>Go to in application</span>
            <ArrowUpRight size={13} />
          </button>
        </div>

        <div className="record-habit-card-simulation">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="record-habit-flame">
                <Flame size={16} />
              </span>
              <strong className="text-sm font-semibold">{habit.name}</strong>
            </div>
            <span className="record-meta-chip is-streak">
              <Flame size={12} />
              <span>{streak}-day streak</span>
            </span>
          </div>
          <div className="record-ui-footer-action">
            <span className="record-added-indicator">
              <Check size={12} />
              <span>Added to Daily Habits</span>
            </span>
            <button type="button" className="record-open-link-btn" onClick={handleGoTo}>
              <span>View in Habits</span>
              <ArrowUpRight size={12} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- 5. CALENDAR EVENT ---
  if (type === "event") {
    const event = record as any;

    return (
      <div className={`record-ui-preview record-ui-event ${compact ? "is-compact" : ""}`}>
        <div className="record-ui-header-bar">
          <div className="record-ui-location-badge">
            <span className="record-ui-loc-icon">📍</span>
            <span className="record-ui-loc-text">{location.breadcrumb}</span>
          </div>
          <button type="button" className="record-ui-jump-btn" onClick={handleGoTo}>
            <span>Go to in application</span>
            <ArrowUpRight size={13} />
          </button>
        </div>

        <div className="record-event-card-simulation">
          <div className="flex items-start gap-3">
            <span className="record-event-cal-icon">
              <CalendarClock size={16} />
            </span>
            <div>
              <h4 className="font-semibold text-sm">{event.title}</h4>
              <p className="text-xs text-muted mt-1 flex items-center gap-2">
                <Clock size={12} />
                <span>{eventTimeLabel(event)}</span>
              </p>
              {event.location && (
                <p className="text-xs text-muted mt-1 flex items-center gap-2">
                  <MapPin size={12} />
                  <span>{event.location}</span>
                </p>
              )}
            </div>
          </div>
          <div className="record-ui-footer-action">
            <span className="record-added-indicator">
              <Check size={12} />
              <span>Scheduled on your Calendar</span>
            </span>
            <button type="button" className="record-open-link-btn" onClick={handleGoTo}>
              <span>View in Events & Calendar</span>
              <ArrowUpRight size={12} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- 6. KNOWLEDGE NOTE ---
  if (type === "knowledge") {
    const note = record as any;
    const content = note.content || note.summary || "";

    return (
      <div className={`record-ui-preview record-ui-note ${compact ? "is-compact" : ""}`}>
        <div className="record-ui-header-bar">
          <div className="record-ui-location-badge">
            <span className="record-ui-loc-icon">📍</span>
            <span className="record-ui-loc-text">{location.breadcrumb}</span>
          </div>
          <button type="button" className="record-ui-jump-btn" onClick={handleGoTo}>
            <span>Go to in application</span>
            <ArrowUpRight size={13} />
          </button>
        </div>

        <div className="record-note-card-simulation">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-indigo-500 shrink-0" />
            <h4 className="font-semibold text-sm">{note.title || note.subject || "Untitled Note"}</h4>
          </div>
          {content && (
            <p className="text-xs text-muted mt-2 line-clamp-3">
              {content.slice(0, 240)}
            </p>
          )}
          <div className="record-ui-footer-action">
            <span className="record-added-indicator">
              <Check size={12} />
              <span>Saved in Notes Vault</span>
            </span>
            <button type="button" className="record-open-link-btn" onClick={handleGoTo}>
              <span>Open in Notes & Vault</span>
              <ArrowUpRight size={12} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Generic fallback
  return (
    <div className="record-ui-preview record-ui-generic">
      <div className="record-ui-header-bar">
        <div className="record-ui-location-badge">
          <span className="record-ui-loc-icon">📍</span>
          <span className="record-ui-loc-text">{location.breadcrumb}</span>
        </div>
        <button type="button" className="record-ui-jump-btn" onClick={handleGoTo}>
          <span>Go to in application</span>
          <ArrowUpRight size={13} />
        </button>
      </div>
      <div className="p-3">
        <h4 className="font-semibold text-sm">{resolvedTitle}</h4>
      </div>
    </div>
  );
}

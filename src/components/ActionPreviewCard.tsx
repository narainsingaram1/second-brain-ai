import { useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Box,
  Briefcase,
  CalendarClock,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  FileText,
  Flame,
  Folder,
  GraduationCap,
  Target,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { AppliedAction, BrainState } from "../types";
import { findRecord, formatRecordDate } from "../utils/chatPresentation";
import { eventTimeLabel, formatTime } from "../utils/events";

const TYPE_ICONS: Record<string, LucideIcon> = {
  task: CheckSquare,
  goal: Target,
  habit: Flame,
  journal: BookOpen,
  knowledge: FileText,
  tracker: Briefcase,
  event: CalendarClock,
  health: Activity,
  course: GraduationCap,
  deck: GraduationCap,
  quiz: GraduationCap,
  workspace: Box,
  folder: Folder,
  section: Folder,
};

function actionBadge(action: AppliedAction) {
  if (action.remove) {
    return { label: "Deleted", className: "action-badge is-deleted" };
  }
  if (action.action.startsWith("create_") || action.action.startsWith("log_")) {
    return { label: "Created", className: "action-badge is-created" };
  }
  if (action.action.startsWith("update_") || action.action.startsWith("rename_") || action.action.startsWith("set_") || action.action.startsWith("record_")) {
    return { label: "Updated", className: "action-badge is-updated" };
  }
  return { label: "Applied", className: "action-badge is-applied" };
}

export function ActionPreviewCard({
  actions,
  state,
  onOpenRecord,
}: {
  actions: AppliedAction[];
  state?: BrainState | null;
  onOpenRecord?: (type: string, id: string, title: string) => void;
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (!actions.length) return null;

  return (
    <div className="action-applied-container" aria-label="Changes made by assistant">
      <div className="action-applied-header">
        <div className="action-applied-title">
          <span className="action-applied-icon-wrap" aria-hidden="true">
            <Check size={13} strokeWidth={2.4} />
          </span>
          <span className="action-applied-heading">
            {actions.length === 1 ? "Action executed in your workspace" : `${actions.length} actions executed in your workspace`}
          </span>
        </div>
      </div>

      <div className="action-applied-list">
        {actions.map((action, index) => {
          const Icon = TYPE_ICONS[action.type] || FileText;
          const badge = actionBadge(action);
          const isExpanded = expandedIndex === index;
          const record = findRecord(state, action.type, action.id);

          return (
            <div key={`${action.type}-${action.id}-${index}`} className="action-applied-item">
              <div className="action-item-main">
                <div className="action-item-left">
                  <span className="action-item-type-icon" aria-hidden="true">
                    <Icon size={14} />
                  </span>
                  <span className={badge.className}>{badge.label}</span>
                  <span className="action-item-title" title={action.title}>
                    {action.title}
                  </span>
                </div>

                <div className="action-item-actions">
                  <button
                    type="button"
                    className="action-btn action-preview-btn"
                    onClick={() => setExpandedIndex(isExpanded ? null : index)}
                    aria-expanded={isExpanded}
                    title={isExpanded ? "Hide change preview" : "Preview change details"}
                  >
                    <Eye size={12} />
                    <span>{isExpanded ? "Hide details" : "Preview change"}</span>
                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>

                  {!action.remove && onOpenRecord && (
                    <button
                      type="button"
                      className="action-btn action-open-btn"
                      onClick={() => onOpenRecord(action.type, action.id, action.title)}
                      title="Open full record in workspace"
                    >
                      <span>View record</span>
                      <ArrowUpRight size={12} />
                    </button>
                  )}
                </div>
              </div>

              <div className="action-item-summary">
                <span>{action.summary}</span>
              </div>

              {isExpanded && (
                <div className="action-expanded-panel">
                  {action.details && action.details.length > 0 && (
                    <div className="action-diff-section">
                      <div className="action-diff-title">Modified fields:</div>
                      <ul className="action-diff-list">
                        {action.details.map((detail, dIdx) => (
                          <li key={dIdx} className="action-diff-item">
                            {detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {action.remove ? (
                    <div className="action-record-removed">
                      <Trash2 size={13} className="text-red-500 shrink-0" />
                      <span>This record was removed. You can undo this deletion in the audit log.</span>
                    </div>
                  ) : record ? (
                    <div className="action-live-preview">
                      <div className="action-live-preview-header">
                        <span className="action-preview-label">Live record snapshot</span>
                        {"status" in record && record.status && (
                          <span className="action-live-pill capitalize">
                            {String(record.status).replace(/_/g, " ")}
                          </span>
                        )}
                        {"priority" in record && record.priority && (
                          <span className="action-live-pill capitalize">
                            {String(record.priority)} priority
                          </span>
                        )}
                      </div>

                      <div className="action-live-grid">
                        {"dueDate" in record && record.dueDate && (
                          <div className="action-live-field">
                            <CalendarDays size={12} />
                            <span>Due {formatRecordDate(record.dueDate)}</span>
                            {"dueTime" in record && record.dueTime && (
                              <span>at {formatTime(String(record.dueTime))}</span>
                            )}
                          </div>
                        )}

                        {"targetDate" in record && record.targetDate && (
                          <div className="action-live-field">
                            <CalendarDays size={12} />
                            <span>Target {formatRecordDate(record.targetDate)}</span>
                          </div>
                        )}

                        {"date" in record && record.date && (
                          <div className="action-live-field">
                            <CalendarDays size={12} />
                            <span>Date: {formatRecordDate(record.date)}</span>
                          </div>
                        )}

                        {action.type === "event" && "startTime" in record && record.startTime && (
                          <div className="action-live-field">
                            <Clock size={12} />
                            <span>{eventTimeLabel(record as any)}</span>
                          </div>
                        )}

                        {"section" in record && record.section && (
                          <div className="action-live-field">
                            <Folder size={12} />
                            <span>
                              {record.section}
                              {record.subsection ? ` / ${record.subsection}` : ""}
                            </span>
                          </div>
                        )}

                        {"streak" in record && typeof record.streak === "number" && (
                          <div className="action-live-field">
                            <Flame size={12} />
                            <span>{record.streak}-day streak</span>
                          </div>
                        )}
                      </div>

                      {"description" in record && record.description && (
                        <p className="action-live-snippet">{String(record.description)}</p>
                      )}

                      {"content" in record && record.content && (
                        <p className="action-live-snippet">
                          {String(record.content).slice(0, 240)}
                          {String(record.content).length > 240 ? "…" : ""}
                        </p>
                      )}

                      {"notes" in record && record.notes && (
                        <p className="action-live-snippet">
                          {String(record.notes).slice(0, 240)}
                          {String(record.notes).length > 240 ? "…" : ""}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

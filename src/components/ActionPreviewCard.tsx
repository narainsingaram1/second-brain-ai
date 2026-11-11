import { useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Box,
  Briefcase,
  CalendarClock,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Compass,
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
import { findRecord } from "../utils/chatPresentation";
import { RecordUiPreview } from "./RecordUiPreview";
import { navigateToRecord } from "../utils/recordNavigation";

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

                  {!action.remove && (
                    <>
                      <button
                        type="button"
                        className="action-btn action-goto-btn"
                        onClick={() => navigateToRecord(action.type, action.id, action.title, state)}
                        title={`Go to ${action.title} in application`}
                      >
                        <Compass size={12} />
                        <span>Go to in app</span>
                        <ArrowUpRight size={12} />
                      </button>

                      {onOpenRecord && (
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
                    </>
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
                    <RecordUiPreview
                      type={action.type}
                      id={action.id}
                      title={action.title}
                      state={state}
                      onNavigate={() => navigateToRecord(action.type, action.id, action.title, state)}
                    />
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

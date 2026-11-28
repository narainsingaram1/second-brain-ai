import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Link2,
  Plus,
  Sparkles,
  Tag,
} from "lucide-react";
import type { BrainState } from "../types";
import {
  extractLinksFromText,
  findBacklinksAndMentions,
  type BacklinkHit,
  type LinkCandidate,
  type LinkTargetType,
  type UnlinkedMentionHit,
} from "../utils/noteLinks";
import {
  computeInstantRelatedContext,
  fetchSemanticRelatedContext,
  type RelatedContextItem,
  type RelatedContextSummary,
} from "../utils/relatedContext";
import { navigateToRecord } from "../utils/recordNavigation";
import { RecordTypeIcon } from "./RecordMentionMenu";
import { KnowledgeGraphView } from "./KnowledgeGraphView";

function HighlightSnippet({ snippet, match }: { snippet: string; match: string }) {
  const cleanMatch = match
    .replace(/@\[([^\]\n]+)\]\(synapse:\/\/[a-z]+\/[^\s)]+\)/g, "$1")
    .replace(/\[\[(?:[a-z]+:[^|\]]+\|)?([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => (b || a));
  const idx = cleanMatch ? snippet.toLowerCase().indexOf(cleanMatch.toLowerCase()) : -1;
  if (idx < 0) return <>{snippet}</>;
  return (
    <>
      {snippet.slice(0, idx)}
      <mark className="nx-ctx-mark">{snippet.slice(idx, idx + cleanMatch.length)}</mark>
      {snippet.slice(idx + cleanMatch.length)}
    </>
  );
}

/**
 * Bottom panel in NoteEditor: Outgoing links, Linked Backlinks, and Unlinked Mentions with 1-click linking.
 */
export const NoteConnectionsFooter: React.FC<{
  noteId: string;
  noteTitle: string;
  content: string;
  state: BrainState | null | undefined;
  onOpenNoteById?: (id: string) => void;
  onCreateLinkedNote?: (title: string) => void;
  onLinkUnlinkedMention?: (hit: UnlinkedMentionHit) => void;
}> = ({
  noteId,
  noteTitle,
  content,
  state,
  onOpenNoteById,
  onCreateLinkedNote,
  onLinkUnlinkedMention,
}) => {
  const [open, setOpen] = useState(true);
  const [unlinkedOpen, setUnlinkedOpen] = useState(true);

  const outgoing = useMemo(() => {
    const raw = extractLinksFromText(content, state);
    const seen = new Set<string>();
    return raw.filter(link => {
      const key = `${link.type}:${link.id || link.label.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [content, state]);

  const { backlinks, unlinkedMentions } = useMemo(
    () => findBacklinksAndMentions({ type: "knowledge", id: noteId, title: noteTitle }, state),
    [noteId, noteTitle, state],
  );

  const openHit = (hit: BacklinkHit | UnlinkedMentionHit) => {
    if (hit.sourceType === "knowledge" && onOpenNoteById) {
      onOpenNoteById(hit.sourceId);
      return;
    }
    navigateToRecord(hit.sourceType, hit.sourceId, hit.sourceTitle, state);
  };

  return (
    <section className="nx-backlinks" aria-label="Backlinks and mentions">
      <div className="nx-backlinks-head">
        <button type="button" className="nx-backlinks-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Link2 size={14} />
          <span>Backlinks & Mentions</span>
          <span className="nx-backlinks-count">{backlinks.length}</span>
          {unlinkedMentions.length > 0 && (
            <span className="nx-backlinks-unlinked-pill">{unlinkedMentions.length} unlinked</span>
          )}
        </button>
      </div>

      {open && (
        <div className="nx-backlinks-body">
          {/* Outgoing references */}
          {outgoing.length > 0 && (
            <div className="nx-out-group">
              <span className="nx-sub-label">Links in this note ({outgoing.length})</span>
              <div className="nx-out-chips">
                {outgoing.map((link, idx) => (
                  <button
                    key={`${link.type}:${link.id || link.label}:${idx}`}
                    type="button"
                    className={`nx-out-chip ${link.unresolved ? "is-unresolved" : ""}`}
                    onClick={() => {
                      if (link.unresolved && link.type === "knowledge") {
                        onCreateLinkedNote?.(link.label);
                      } else if (link.type === "knowledge" && link.id && onOpenNoteById) {
                        onOpenNoteById(link.id);
                      } else if (link.id) {
                        navigateToRecord(link.type, link.id, link.label, state);
                      }
                    }}
                    title={link.unresolved ? `Create new note “${link.label}”` : `Open ${link.label}`}
                  >
                    <RecordTypeIcon type={link.type} size={12} />
                    <span>{link.label}</span>
                    {link.unresolved && <small>+ Create</small>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Linked Backlinks */}
          <div className="nx-ref-group">
            <span className="nx-sub-label">Linked references ({backlinks.length})</span>
            {backlinks.length > 0 ? (
              <div className="nx-ref-list">
                {backlinks.map((hit, idx) => (
                  <button
                    key={`${hit.sourceType}:${hit.sourceId}:${hit.start}:${idx}`}
                    type="button"
                    className="nx-ref-card"
                    onClick={() => openHit(hit)}
                  >
                    <div className="nx-ref-card-top">
                      <span className={`nx-ref-icon nx-type-${hit.sourceType}`}>
                        <RecordTypeIcon type={hit.sourceType} size={13} />
                      </span>
                      <strong>{hit.sourceTitle}</strong>
                      <span className="nx-ref-meta">{[hit.sourceMeta, hit.sourceDate].filter(Boolean).join(" · ")}</span>
                      <ArrowUpRight size={13} className="nx-ref-arrow" />
                    </div>
                    <p className="nx-ref-snippet">
                      <HighlightSnippet snippet={hit.snippet} match={hit.matchText} />
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="nx-ref-empty">
                No notes, journal entries, or tasks link here yet. Reference this note anywhere using <code>[[{noteTitle || "Title"}]]</code>.
              </p>
            )}
          </div>

          {/* Unlinked Mentions */}
          {unlinkedMentions.length > 0 && (
            <div className="nx-ref-group">
              <button
                type="button"
                className="nx-sub-label-btn"
                onClick={() => setUnlinkedOpen(o => !o)}
                aria-expanded={unlinkedOpen}
              >
                {unlinkedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>Unlinked mentions ({unlinkedMentions.length})</span>
              </button>
              {unlinkedOpen && (
                <div className="nx-ref-list">
                  {unlinkedMentions.map((hit, idx) => (
                    <div key={`${hit.sourceType}:${hit.sourceId}:${hit.start}:${idx}`} className="nx-ref-card is-unlinked">
                      <div className="nx-ref-card-top">
                        <span className={`nx-ref-icon nx-type-${hit.sourceType}`}>
                          <RecordTypeIcon type={hit.sourceType} size={13} />
                        </span>
                        <button type="button" className="nx-ref-title-btn" onClick={() => openHit(hit)}>
                          {hit.sourceTitle}
                        </button>
                        <span className="nx-ref-meta">{[hit.sourceMeta, hit.sourceDate].filter(Boolean).join(" · ")}</span>
                        {onLinkUnlinkedMention && (
                          <button
                            type="button"
                            className="nx-link-action-btn"
                            onClick={() => onLinkUnlinkedMention(hit)}
                            title={`Convert mention in “${hit.sourceTitle}” into a link`}
                          >
                            <Link2 size={11} />
                            <span>Link</span>
                          </button>
                        )}
                      </div>
                      <p className="nx-ref-snippet">
                        <HighlightSnippet snippet={hit.snippet} match={hit.matchText} />
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

/**
 * Live "Related Context" sidebar (for NoteEditor & JournalView) powered by instant local graph/BM25
 * + debounced `vectorVault` semantic matching, with optional mini ego-graph.
 */
export const RelatedContextPanel: React.FC<{
  state: BrainState | null | undefined;
  current: {
    type: "knowledge" | "journal";
    id: string;
    title: string;
    content: string;
    tags?: string[];
  };
  showMiniGraph?: boolean;
  onOpenNoteById?: (id: string) => void;
  onOpenFullGraph?: (nodeId?: string) => void;
  onInsertLink?: (candidate: Pick<LinkCandidate, "type" | "id" | "label" | "syntax">) => void;
}> = ({
  state,
  current,
  showMiniGraph = false,
  onOpenNoteById,
  onOpenFullGraph,
  onInsertLink,
}) => {
  const instant = useMemo(
    () => computeInstantRelatedContext(state, current, 6),
    [state, current.type, current.id, current.title, current.content, current.tags],
  );
  const [summary, setSummary] = useState<RelatedContextSummary>(instant);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setSummary(instant);
  }, [instant]);

  // Debounced semantic upgrade via vectorVault
  const contentSig = `${current.id}|${current.title}|${current.content.slice(0, 360)}|${(current.tags || []).join(",")}`;
  useEffect(() => {
    if (!state) return;
    const textLen = `${current.title} ${current.content}`.trim().length;
    if (textLen < 20) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      fetchSemanticRelatedContext(state, current, controller.signal, 6)
        .then(res => {
          if (!controller.signal.aborted) setSummary(res);
        })
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 1250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      setSearching(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentSig, state?.knowledgeItems?.length, state?.journalEntries?.length]);

  const openItem = (item: RelatedContextItem) => {
    if (item.type === "knowledge" && onOpenNoteById) {
      onOpenNoteById(item.id);
      return;
    }
    if (item.type === "memory") {
      window.dispatchEvent(new CustomEvent("synapse-open-memory", { detail: { id: item.id } }));
      return;
    }
    navigateToRecord(item.type as LinkTargetType, item.id, item.title, state);
  };

  return (
    <aside className="nx-context-panel" aria-label="Related context">
      {showMiniGraph && (
        <KnowledgeGraphView
          state={state}
          initialFocusNodeId={`${current.type}:${current.id}`}
          compact
          onOpenNoteById={onOpenNoteById}
          onOpenFullGraph={onOpenFullGraph}
        />
      )}

      <div className="nx-ctx-section">
        <div className="nx-ctx-head">
          <div className="nx-ctx-title-row">
            <Sparkles size={13} />
            <h3>Related context</h3>
            {searching && <span className="nx-ctx-pulse" title="Checking semantic matches" />}
          </div>
          <p className="nx-ctx-headline">{summary.headline}</p>
        </div>

        {summary.items.length > 0 ? (
          <div className="nx-ctx-list">
            {summary.items.map(item => (
              <div key={`${item.type}:${item.id}`} className="nx-ctx-card">
                <div className="nx-ctx-card-top">
                  <span className={`nx-ref-icon nx-type-${item.type}`}>
                    {item.type === "memory" ? <Sparkles size={12} /> : <RecordTypeIcon type={item.type as LinkTargetType} size={12} />}
                  </span>
                  <button type="button" className="nx-ctx-item-title" onClick={() => openItem(item)}>
                    {item.title}
                  </button>
                  <span className={`nx-ctx-reason is-${item.reasonKind}`}>
                    {item.reasonKind === "tag" && <Tag size={10} />}
                    {item.reason}
                  </span>
                </div>
                {item.snippet && <p className="nx-ctx-snippet">{item.snippet}</p>}
                <div className="nx-ctx-card-foot">
                  <span className="nx-ctx-sub">{item.subtitle || item.date || item.type}</span>
                  <div className="nx-ctx-actions">
                    {onInsertLink && item.type !== "memory" && !item.alreadyLinked && (
                      <button
                        type="button"
                        className="nx-ctx-btn"
                        onClick={() =>
                          onInsertLink({
                            type: item.type as LinkTargetType,
                            id: item.id,
                            label: item.title,
                            syntax: item.type === "knowledge" ? "wiki" : "mention",
                          })
                        }
                        title={`Insert link to “${item.title}”`}
                      >
                        <Plus size={11} /> Link
                      </button>
                    )}
                    <button type="button" className="nx-ctx-btn" onClick={() => openItem(item)} title={`Open ${item.title}`}>
                      Open <ArrowUpRight size={11} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="nx-ctx-empty">
            Write a few lines or add tags to surface related notes, past journal reflections, tasks, and memories.
          </div>
        )}
      </div>
    </aside>
  );
};

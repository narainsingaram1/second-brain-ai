import { useEffect, useRef, useState } from "react";
import {
  Brain,
  X,
  Search,
  Pin,
  Trash2,
  Pencil,
  Plus,
  Check,
  History,
  ArrowUpRight,
  ShieldCheck,
  Square,
  ChevronDown,
} from "lucide-react";
import type { BrainState } from "../types";
import {
  activeMemories,
  conversationThreads,
  MEMORY_BYTES,
  MEMORY_CATEGORIES,
  memoryBytes,
  normalizeAgentMemory,
  type AgentMemory,
  type MemoryChange,
  type MemoryEntry,
} from "../services/agentMemory";
import { previewHistoryMemories } from "../services/memoryHistory";
import "../memory.css";

export function MemoryModal({
  state,
  onClose,
  onChange,
  onOpenSource,
  selectedId,
}: {
  state: BrainState;
  onClose: () => void;
  onChange: (change: MemoryChange) => Promise<AgentMemory>;
  onOpenSource: (conversationId: string) => void;
  selectedId?: string;
}) {
  const memory = normalizeAgentMemory(state.agentMemory);
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<MemoryEntry | null>(null),
    [draft, setDraft] = useState(""),
    [topic, setTopic] = useState(""),
    [draftCategory, setDraftCategory] =
      useState<MemoryEntry["category"]>("preference"),
    [expiry, setExpiry] = useState("");
  const [adding, setAdding] = useState(false),
    [history, setHistory] = useState(false),
    [selectedThreads, setSelectedThreads] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<MemoryEntry[]>([]),
    [approved, setApproved] = useState<string[]>([]),
    [progress, setProgress] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const dialog = useRef<HTMLElement>(null),
    controller = useRef<AbortController | null>(null),
    saving = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLElement>("input, button")?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        controller.current?.abort();
        if (!saving.current) onClose();
      }
      if (event.key === "Tab") {
        const nodes = [
          ...(dialog.current?.querySelectorAll<HTMLElement>(
 "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary",
          ) || []),
        ];
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keys, true);
    return () => {
      controller.current?.abort();
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keys, true);
      previous?.focus();
    };
  }, [onClose, state.userId]);
  useEffect(() => {
    if (selectedId)
      dialog.current
        ?.querySelector(`[data-memory-id="${CSS.escape(selectedId)}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);
  const change = async (action: MemoryChange) => {
    setError("");
    setBusy(true);
    saving.current = true;
    try {
      await onChange(action);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Memory could not be saved.");
      return false;
    } finally {
      setBusy(false);
      saving.current = false;
    }
  };
  const entries = memory.entries
    .filter(
      (e) =>
        (category === "all" || e.category === category) &&
        `${e.topic} ${e.content}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  const startEdit = (entry?: MemoryEntry) => {
    setAdding(!entry);
    setEditing(entry || null);
    setDraft(entry?.content || "");
    setTopic(entry?.topic || "");
    setDraftCategory(entry?.category || "preference");
    setExpiry(entry?.expiresAt?.slice(0, 10) || "");
    setError("");
  };
  const saveDraft = async () => {
    const expiresAt = expiry
      ? new Date(`${expiry}T23:59:59`).toISOString()
      : undefined;
    const now = new Date().toISOString();
    const action: MemoryChange = editing
      ? {
          kind: "edit",
          id: editing.id,
          expectedUpdatedAt: editing.updatedAt,
          content: draft,
          expiresAt: expiresAt || null,
        }
      : {
          kind: "remember",
          explicit: true,
          restoreForgotten: true,
          entry: {
            id: crypto.randomUUID(),
            topic,
            category: draftCategory,
            content: draft,
            sources: [],
            pinned: false,
            createdAt: now,
            updatedAt: now,
            ...(expiresAt ? { expiresAt } : {}),
          },
        };
    if (await change(action)) {
      setAdding(false);
      setEditing(null);
    }
  };
  const learn = async () => {
    if (!selectedThreads.length) return;
    setError("");
    setBusy(true);
    setCandidates([]);
    setApproved([]);
    setImportNotice("");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await previewHistoryMemories(
        state,
        selectedThreads,
        abort.signal,
        setProgress,
      );
      if (abort.signal.aborted) return;
      setCandidates(result.candidates);
      setImportNotice(
        `${result.candidates.length} suggestions. ${result.rejected} unsafe or unsupported candidates excluded.${result.truncated ? " Selection exceeds the 4-batch limit: only part was analyzed. Choose fewer conversations for full coverage." : ""} Nothing is saved until you approve.`,
      );
    } catch (e) {
      if (!abort.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Could not analyze conversations.",
        );
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
        setProgress("");
      }
    }
  };
  const saveApproved = async () => {
    setError("");
    setBusy(true);
    saving.current = true;
    const savedIds: string[] = [];
    try {
      for (const entry of candidates.filter((e) => approved.includes(e.id))) {
        await onChange({ kind: "remember", explicit: true, entry });
        savedIds.push(entry.id);
      }
      setImportNotice(`${savedIds.length} memories saved.`);
    } catch (e) {
      setError(
        `${savedIds.length} memories saved. ${e instanceof Error ? e.message : "Could not finish saving."}`,
      );
    } finally {
      setCandidates((previous) =>
        previous.filter((e) => !savedIds.includes(e.id)),
      );
      setApproved((previous) =>
        previous.filter((id) => !savedIds.includes(id)),
      );
      setBusy(false);
      saving.current = false;
    }
  };
  const bytes = memoryBytes(memory);
  return (
    <div
      className="memory-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving.current) onClose();
      }}
    >
      <section
        className="memory-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-title"
        ref={dialog}
      >
        <header className="memory-header">
          <div className="memory-brand">
            <span>
              <Brain size={23} />
            </span>
            <div>
              <h2 id="memory-title">Memory</h2>
              <p>What Synapse carries into your next conversation</p>
            </div>
          </div>
          <button
            type="button"
            className="memory-icon-button"
            aria-label="Close memory"
            disabled={busy && !controller.current}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div className="memory-body">
          <div className="memory-controls">
            <label>
              <span>
                <strong>Use saved memory</strong>
                <small>Relevant context, without repeating yourself.</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={memory.enabled}
                disabled={busy}
                onChange={(e) =>
                  void change({ kind: "settings", enabled: e.target.checked })
                }
              />
            </label>
            <label>
              <span>
                <strong>Learn automatically</strong>
                <small>
                  Clear preferences and durable facts from new chats.
                </small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={memory.automaticLearning}
                disabled={busy}
                onChange={(e) =>
                  void change({
                    kind: "settings",
                    automaticLearning: e.target.checked,
                  })
                }
              />
            </label>
          </div>
          <p className="memory-privacy">
            <ShieldCheck size={15} />
            Sensitive details need an explicit request. Credentials are never
            memory. Temporary chats use and learn no saved memory.
          </p>
          <div className="memory-usage">
            <span>
              {memory.entries.length} / 500 memories · {Math.ceil(bytes / 1024)}{" "}
              / 256 KiB
            </span>
            <span>{activeMemories(memory).length} active</span>
            <progress max={MEMORY_BYTES} value={bytes} />
          </div>
          {error && (
            <p className="memory-error" role="alert">
              {error}
            </p>
          )}
          <div className="memory-action-row">
            <button type="button" onClick={() => startEdit()} disabled={busy}>
              <Plus size={15} />
              Add memory
            </button>
            <button
              type="button"
              onClick={() => {
                setHistory(!history);
                setImportNotice("");
              }}
              disabled={busy}
            >
              <History size={15} />
              Learn from past chats
            </button>
            <button
              type="button"
              className="memory-danger"
              disabled={busy || !memory.entries.length}
              onClick={() => {
                if (
                  window.confirm(
 "Forget all saved memories? Original conversations stay intact. Automatic learning will not restore the same sources.",
                  )
                )
                  void change({ kind: "forgetAll" });
              }}
            >
              <Trash2 size={14} />
              Forget all
            </button>
          </div>
          {(adding || editing) && (
            <form
              className="memory-edit"
              onSubmit={(event) => {
                event.preventDefault();
                void saveDraft();
              }}
            >
              <h3>{editing ? "Edit memory" : "Add a memory"}</h3>
              {!editing && (
                <>
                  <input
                    aria-label="Memory topic"
                    placeholder="Topic, e.g. writing style"
                    maxLength={120}
                    required
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                  <select
                    aria-label="Memory category"
                    value={draftCategory}
                    onChange={(e) =>
                      setDraftCategory(
                        e.target.value as MemoryEntry["category"],
                      )
                    }
                  >
                    {MEMORY_CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </>
              )}
              <textarea
                aria-label="Memory content"
                maxLength={1000}
                required
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="What should Synapse remember?"
              />
              <label className="memory-expiry">
                Expires (optional)
                <input
                  aria-label="Memory expiration"
                  type="date"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                />
              </label>
              <div className="memory-action-row">
                <button type="submit" disabled={busy}>
                  <Check size={14} />
                  Save memory
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAdding(false);
                    setEditing(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {history && (
            <section className="memory-history">
              <h3>Learn from past chats</h3>
              <p>
                Select conversations to analyze. Up to four bounded batches per
                run; your AI provider may charge for these requests. Review
                every suggestion before saving.
              </p>
              <div className="memory-thread-list">
                {conversationThreads(state)
                  .filter((t) => t.messages.some((m) => m.role === "user"))
                  .map((t) => (
                    <label key={t.id}>
                      <input
                        type="checkbox"
                        checked={selectedThreads.includes(t.id)}
                        disabled={busy}
                        onChange={(e) =>
                          setSelectedThreads((previous) =>
                            e.target.checked
                              ? [...previous, t.id]
                              : previous.filter((id) => id !== t.id),
                          )
                        }
                      />
                      <span>{t.title}</span>
                      <small>
                        {t.messages.filter((m) => m.role === "user").length}{" "}
                        messages
                      </small>
                    </label>
                  ))}
              </div>
              <div className="memory-action-row">
                <button
                  type="button"
                  disabled={busy || !selectedThreads.length}
                  onClick={() => void learn()}
                >
                  <Brain size={14} />
                  Analyze selection
                </button>
                {controller.current && (
                  <button
                    type="button"
                    onClick={() => controller.current?.abort()}
                  >
                    <Square size={12} />
                    Cancel analysis
                  </button>
                )}
                <span role="status">{progress}</span>
              </div>
              {importNotice && <p role="status">{importNotice}</p>}
              {candidates.map((entry) => (
                <label className="memory-candidate" key={entry.id}>
                  <input
                    type="checkbox"
                    checked={approved.includes(entry.id)}
                    disabled={busy}
                    onChange={(e) =>
                      setApproved((previous) =>
                        e.target.checked
                          ? [...previous, entry.id]
                          : previous.filter((id) => id !== entry.id),
                      )
                    }
                  />
                  <span>
                    <strong>{entry.topic}</strong>
                    <span>{entry.content}</span>
                    <q>{entry.sources[0]?.excerpt}</q>
                  </span>
                </label>
              ))}
              {candidates.length > 0 && (
                <button
                  type="button"
                  className="memory-save-approved"
                  disabled={busy || !approved.length}
                  onClick={() => void saveApproved()}
                >
                  Save {approved.length} approved{" "}
                  {approved.length === 1 ? "memory" : "memories"}
                </button>
              )}
            </section>
          )}
          <div className="memory-filters">
            <label>
              <Search size={15} />
              <input
                aria-label="Search memories"
                value={query}
                placeholder="Search your memories…"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div>
              <select
                aria-label="Filter memory category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">All categories</option>
                {MEMORY_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <ChevronDown size={13} />
            </div>
          </div>
          <div className="memory-list">
            {entries.map((entry) => (
              <article
                key={entry.id}
                data-memory-id={entry.id}
                className={`memory-card ${entry.id === selectedId ? "is-selected" : ""}`}
              >
                <div className="memory-card-top">
                  <div>
                    <span className="memory-category">{entry.category}</span>
                    {entry.expiresAt && (
                      <small>
                        {Date.parse(entry.expiresAt) < Date.now()
                          ? "Expired"
                          : "Expires"}{" "}
                        {new Date(entry.expiresAt).toLocaleDateString()}
                      </small>
                    )}
                  </div>
                  <div className="memory-card-actions">
                    <button
                      type="button"
                      aria-label={`${entry.pinned ? "Unpin" : "Pin"} ${entry.topic}`}
                      aria-pressed={entry.pinned}
                      disabled={busy}
                      onClick={() =>
                        void change({
                          kind: "edit",
                          id: entry.id,
                          expectedUpdatedAt: entry.updatedAt,
                          pinned: !entry.pinned,
                        })
                      }
                    >
                      <Pin size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Edit ${entry.topic}`}
                      disabled={busy}
                      onClick={() => startEdit(entry)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Forget ${entry.topic}`}
                      disabled={busy}
                      onClick={() =>
                        void change({
                          kind: "forget",
                          id: entry.id,
                          expectedUpdatedAt: entry.updatedAt,
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <h3>{entry.topic}</h3>
                <p>{entry.content}</p>
                <details>
                  <summary>
                    {entry.sources.length
                      ? `${entry.sources.length} supporting source${entry.sources.length === 1 ? "" : "s"}`
                      : "Added by you"}{" "}
                    · Updated {new Date(entry.updatedAt).toLocaleDateString()}
                  </summary>
                  {entry.sources.map((source, index) => (
                    <blockquote key={`${source.messageId}-${index}`}>
                      <q>{source.excerpt}</q>
                      {conversationThreads(state).some(
                        (t) => t.id === source.conversationId,
                      ) && (
                        <button
                          type="button"
                          onClick={() => onOpenSource(source.conversationId)}
                        >
                          Open conversation <ArrowUpRight size={12} />
                        </button>
                      )}
                    </blockquote>
                  ))}
                </details>
              </article>
            ))}
            {entries.length === 0 && (
              <div className="memory-empty">
                <Brain size={31} />
                <h3>
                  {query
                    ? "No matching memories"
                    : "A little context goes a long way"}
                </h3>
                <p>
                  {query
                    ? "Try a different search or category."
                    : "As you chat, Synapse can remember useful preferences and facts. You can also add one yourself."}
                </p>
              </div>
            )}
          </div>
        </div>
        <footer className="memory-footer">
          <span>Forgetting removes saved context, not the original chat.</span>
          <button
            type="button"
            disabled={busy && !controller.current}
            onClick={onClose}
          >
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}

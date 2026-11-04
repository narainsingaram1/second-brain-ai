import React, { useState, useEffect, useRef, lazy, Suspense, useLayoutEffect, useCallback } from "react";
import { KnowledgeItem, NoteFolder } from "../types";
import { createPortal } from "react-dom";
import type { NoteRichTextHandle } from "./NoteRichText";
const NoteRichText = lazy(() => import("./NoteRichText").then(module => ({ default: module.NoteRichText })));
import {
  ArrowLeft,
  Folder as FolderIcon,
  Tag,
  Pin,
  Star,
  Trash2,
  Copy,
  Download,
  Sparkles,
  Check,
  Maximize2,
  Minimize2,
  List,
  CheckSquare,
  Code,
  Eye,
  Edit3,
  Loader2,
} from "lucide-react";

interface NoteEditorProps {
  note: KnowledgeItem;
  folders: NoteFolder[];
  onSave: (note: KnowledgeItem) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
  openRouterKey?: string;
  selectedModel?: string;
  onGenerateTasks?: (tasks: { title: string; priority?: string }[]) => void;
}

type EditorMode = "write" | "source" | "preview";

export const NoteEditor: React.FC<NoteEditorProps> = ({
  note,
  folders,
  onSave,
  onDelete,
  onBack,
  openRouterKey,
  selectedModel = "anthropic/claude-3.5-sonnet",
  onGenerateTasks,
}) => {
  const [title, setTitle] = useState(note.title || note.subject || "");
  const [content, setContent] = useState(note.content ?? note.summary ?? "");
  const [folderId, setFolderId] = useState<string | null>(note.folderId || null);
  const [tags, setTags] = useState<string[]>(note.tags || []);
  const [newTagInput, setNewTagInput] = useState("");
  const [pinned, setPinned] = useState(Boolean(note.pinned));
  const [favorite, setFavorite] = useState(Boolean(note.favorite));

  const [mode, setMode] = useState<EditorMode>("write");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // AI assistant state
  const [isAILoading, setIsAILoading] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  const [textSize, setTextSize] = useState(18);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const richEditorRef = useRef<NoteRichTextHandle>(null);
  const contentRef = useRef(content);
  const autoSaveContentRef = useRef<(value: string) => void>(() => {});
  const currentContent = () => richEditorRef.current?.flush() ?? contentRef.current;
  const inlineHostRef = useRef<HTMLDivElement>(null);
  const [portalHost] = useState(() => typeof document === "undefined" ? null : document.createElement("div"));

  // Move a stable portal container so focus mode preserves selection and undo history.
  useLayoutEffect(() => {
    if (!portalHost) return;
    const parent = isFullscreen ? document.body : inlineHostRef.current;
    parent?.appendChild(portalHost);
    return () => { portalHost.remove(); };
  }, [isFullscreen, portalHost]);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const pendingSaveRef = useRef<(() => void) | null>(null);
  const deletedRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushSave = () => {
    richEditorRef.current?.flush();
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    const save = pendingSaveRef.current;
    pendingSaveRef.current = null;
    save?.();
  };
  // Layout cleanup runs before the child editor detaches, preserving the final keystroke.
  useLayoutEffect(() => () => {
    if (!deletedRef.current) flushSave();
    else if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
  }, []);
  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === "hidden") flushSave(); };
    window.addEventListener("pagehide", flushSave);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flushSave);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    editorRootRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setIsFullscreen(false); }
      if (event.key === "Tab") {
        const controls = Array.from(editorRootRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea, [contenteditable="true"], [tabindex="0"]'
        ) || []).filter(el => el.getClientRects().length > 0);
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === editorRootRef.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === editorRootRef.current)) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      if (previousFocus?.isConnected) previousFocus.focus();
      else fullscreenButtonRef.current?.focus();
    };
  }, [isFullscreen]);

  // Update local state when note prop changes
  useEffect(() => {
    setTitle(note.title || note.subject || "");
    contentRef.current = note.content ?? note.summary ?? "";
    setContent(contentRef.current);
    setFolderId(note.folderId || null);
    setTags(note.tags || []);
    setPinned(Boolean(note.pinned));
    setFavorite(Boolean(note.favorite));
  }, [note.id]);

  // Debounced auto-save
  const triggerAutoSave = (
    newTitle: string,
    newContent: string,
    newFolderId: string | null,
    newTags: string[],
    newPinned: boolean,
    newFavorite: boolean
  ) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    pendingSaveRef.current = () => {
      const summarySnippet =
        newContent.trim().length > 200
          ? newContent.trim().slice(0, 197) + "..."
          : newContent.trim() || newTitle;

      const updated: KnowledgeItem = {
        ...note,
        id: note.id,
        title: newTitle.trim() || "Untitled Note",
        subject: newTitle.trim() || "Untitled Note",
        content: newContent,
        summary: summarySnippet,
        folderId: newFolderId,
        tags: newTags,
        pinned: newPinned,
        favorite: newFavorite,
        updatedAt: new Date().toISOString(),
      };

      onSave(updated);
    };
    saveTimeoutRef.current = setTimeout(flushSave, 600);
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    triggerAutoSave(val, currentContent(), folderId, tags, pinned, favorite);
  };

  autoSaveContentRef.current = value => triggerAutoSave(title, value, folderId, tags, pinned, favorite);
  const handleContentChange = useCallback((val: string) => {
    contentRef.current = val;
    setContent(val);
    autoSaveContentRef.current(val);
  }, []);

  const handleFolderChange = (val: string | null) => {
    setFolderId(val);
    triggerAutoSave(title, currentContent(), val, tags, pinned, favorite);
  };

  const handleTogglePin = () => {
    const next = !pinned;
    setPinned(next);
    triggerAutoSave(title, currentContent(), folderId, tags, next, favorite);
  };

  const handleToggleFavorite = () => {
    const next = !favorite;
    setFavorite(next);
    triggerAutoSave(title, currentContent(), folderId, tags, pinned, next);
  };

  const handleAddTag = () => {
    const trimmed = newTagInput.trim().replace(/^#/, "");
    if (trimmed && !tags.includes(trimmed)) {
      const nextTags = [...tags, trimmed];
      setTags(nextTags);
      setNewTagInput("");
      triggerAutoSave(title, currentContent(), folderId, nextTags, pinned, favorite);
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const nextTags = tags.filter((t) => t !== tagToRemove);
    setTags(nextTags);
    triggerAutoSave(title, currentContent(), folderId, nextTags, pinned, favorite);
  };

  // Copy markdown
  const handleCopy = () => {
    navigator.clipboard.writeText(`# ${title}\n\n${currentContent()}`);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Export note as text
  const handleExport = () => {
    const blob = new Blob([`# ${title}\n\n${currentContent()}`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "note").toLowerCase().replace(/[^a-z0-9]/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // AI Assistance actions
  const runAIAssistant = async (action: "summarize" | "tasks" | "polish" | "expand") => {
    if (!openRouterKey) {
      setAiNotice("Configure OpenRouter API Key in Settings to use AI Note Assistant.");
      setTimeout(() => setAiNotice(null), 4000);
      return;
    }

    const latestContent = currentContent();
    setIsAILoading(true);
    setAiMenuOpen(false);

    let prompt = "";
    if (action === "summarize") {
      prompt = `Provide a concise 3-4 bullet executive summary and key takeaways for this note:\n\nTitle: ${title}\n\n${latestContent}`;
    } else if (action === "tasks") {
      prompt = `Extract all concrete, actionable tasks from this note as a JSON array of strings (e.g. ["task 1", "task 2"]). Only output valid JSON with no preamble:\n\nTitle: ${title}\n\n${latestContent}`;
    } else if (action === "polish") {
      prompt = `Improve clarity, fix typos/grammar, and enhance the structure of this note while preserving all original ideas and technical terms. Return only the revised note in markdown:\n\n${latestContent}`;
    } else if (action === "expand") {
      prompt = `Continue and expand this note with comprehensive, high-value technical context, real-world examples, and next steps:\n\nTitle: ${title}\n\n${latestContent}`;
    }

    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://second-brain-ai.local",
          "X-Title": "Second Brain AI",
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!res.ok) throw new Error(`OpenRouter Error: ${res.statusText}`);
      const data = await res.json();
      const aiResponse = data.choices?.[0]?.message?.content || "";

      if (action === "tasks") {
        try {
          const match = aiResponse.match(/\[[\s\S]*\]/);
          const tasksArr = match ? JSON.parse(match[0]) : [];
          if (Array.isArray(tasksArr) && tasksArr.length > 0 && onGenerateTasks) {
            onGenerateTasks(tasksArr.map((t: string) => ({ title: t, priority: "medium" })));
            setAiNotice(`Created ${tasksArr.length} actionable tasks in Tasks tab!`);
          } else {
            // Append as checklist to note
            const checklistStr = "\n\n## Actionable Tasks\n" + aiResponse;
            handleContentChange(currentContent() + checklistStr);
            setAiNotice("Appended action tasks to note!");
          }
        } catch {
          handleContentChange(currentContent() + "\n\n## Actionable Tasks\n" + aiResponse);
        }
      } else if (action === "summarize") {
        handleContentChange(currentContent() + "\n\n## AI Summary & Takeaways\n" + aiResponse);
        setAiNotice("Added summary to note!");
      } else if (action === "polish") {
        handleContentChange(aiResponse);
        setAiNotice("Polished note successfully!");
      } else if (action === "expand") {
        handleContentChange(currentContent() + "\n\n" + aiResponse);
        setAiNotice("Expanded note with AI insights!");
      }
    } catch (err: any) {
      console.error("AI Error:", err);
      setAiNotice(`AI Assistant error: ${err.message}`);
    } finally {
      setIsAILoading(false);
      setTimeout(() => setAiNotice(null), 4000);
    }
  };

  // Word count & read time
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  const readTime = Math.ceil(words / 200);

  const editorView = (
    <div
      ref={editorRootRef}
      tabIndex={-1}
      role={isFullscreen ? "dialog" : undefined}
      aria-modal={isFullscreen ? true : undefined}
      aria-label={isFullscreen ? "Full-screen note editor" : undefined}
      onKeyDownCapture={e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); flushSave(); } }}
      style={{ "--note-font-size": `${textSize}px` } as React.CSSProperties}
      className={`note-editor w-full flex flex-col bg-white dark:bg-[#10131d] rounded-3xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm transition-all ${
        isFullscreen ? "note-editor-fullscreen fixed inset-0 z-[100] rounded-none border-none p-4 sm:p-8 overflow-y-auto" : "p-4 sm:p-6"
      }`}
    >
      {/* Top Navigation & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { flushSave(); onBack(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>

          {/* Folder Selector Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300">
            <FolderIcon className="w-3.5 h-3.5 text-blue-500" />
            <select
              aria-label="Note folder"
              value={folderId || ""}
              onChange={(e) => handleFolderChange(e.target.value ? e.target.value : null)}
              className="bg-transparent focus:outline-none cursor-pointer max-w-[140px] truncate"
            >
              <option value="">📁 Root / Unfiled</option>
              {folders.map((f) => {
                const parent = folders.find((p) => p.id === f.parentId);
                const label = parent ? `${parent.name} / ${f.name}` : f.name;
                return (
                  <option key={f.id} value={f.id}>
                    📁 {label}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Pin & Favorite Buttons */}
          <button
            onClick={handleTogglePin}
            className={`p-1.5 rounded-xl text-xs transition-colors ${
              pinned
                ? "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold"
                : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700"
            }`}
            title={pinned ? "Unpin note" : "Pin note to top"}
          >
            <Pin className={`w-3.5 h-3.5 ${pinned ? "fill-current" : ""}`} />
          </button>

          <button
            onClick={handleToggleFavorite}
            className={`p-1.5 rounded-xl text-xs transition-colors ${
              favorite
                ? "bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400"
                : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700"
            }`}
            title={favorite ? "Remove from favorites" : "Mark as favorite"}
          >
            <Star className={`w-3.5 h-3.5 ${favorite ? "fill-current" : ""}`} />
          </button>
        </div>

        {/* Right Action Tools: Modes, Autosave Status, AI, Fullscreen */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-slate-400 dark:text-slate-500" title="Notes save automatically. Sync issues appear in Workspace & Sync.">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
            <span>Autosave on</span>
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl">
            <button
              onClick={() => { currentContent(); setMode("write"); }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                mode === "write"
                  ? "bg-white dark:bg-[#141721] text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
              title="Edit with live formatting"
            >
              <Edit3 className="w-3 h-3" />
              <span className="hidden md:inline">Edit</span>
            </button>
            <button
              onClick={() => { currentContent(); setMode("source"); }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                mode === "source"
                  ? "bg-white dark:bg-[#141721] text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
              title="Edit Markdown source"
            >
              <Code className="w-3 h-3" />
              <span className="hidden md:inline">Markdown</span>
            </button>
            <button
              onClick={() => { currentContent(); setMode("preview"); }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                mode === "preview"
                  ? "bg-white dark:bg-[#141721] text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
              title="Preview Mode"
            >
              <Eye className="w-3 h-3" />
              <span className="hidden md:inline">Preview</span>
            </button>
          </div>

          {/* AI Note Assistant Dropdown */}
          <div className="relative">
            <button
              onClick={() => setAiMenuOpen(!aiMenuOpen)}
              disabled={isAILoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xs font-bold transition-colors shadow-xs"
            >
              {isAILoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
              )}
              <span>AI</span>
            </button>

            {aiMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-[#141721] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-1.5 z-40 flex flex-col gap-1 text-xs font-semibold animate-fade-in">
                <button
                  onClick={() => runAIAssistant("summarize")}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-left transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                  <span>Summarize Takeaways</span>
                </button>
                <button
                  onClick={() => runAIAssistant("tasks")}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-left transition-colors"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-blue-500" />
                  <span>Extract Action Tasks</span>
                </button>
                <button
                  onClick={() => runAIAssistant("polish")}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-left transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Polish & Clean Grammar</span>
                </button>
                <button
                  onClick={() => runAIAssistant("expand")}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-left transition-colors"
                >
                  <List className="w-3.5 h-3.5 text-amber-500" />
                  <span>Continue / Expand Note</span>
                </button>
              </div>
            )}
          </div>

          {/* More Actions: Copy, Export, Fullscreen, Delete */}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 transition-colors"
            title="Copy Markdown"
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={handleExport}
            className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 transition-colors"
            title="Export as Markdown File"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            ref={fullscreenButtonRef}
            aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
            aria-pressed={isFullscreen}
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Focus"}
            style={{ display: "inline-flex", alignItems: "center", background: "var(--note-focus-bg, #eff6ff)", color: "#2563eb", padding: "7px 10px" }}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline text-xs font-semibold ml-1.5">{isFullscreen ? "Exit full screen" : "Full screen"}</span>
          </button>

          <button
            onClick={() => {
              if (confirm(`Delete note "${title || "Untitled"}"?`)) {
                deletedRef.current = true;
                pendingSaveRef.current = null;
                if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
                onDelete(note.id);
                onBack();
              }
            }}
            className="p-1.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-400 hover:text-rose-600 transition-colors"
            title="Delete Note"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* AI Notice Banner */}
      {aiNotice && (
        <div className="mt-3 px-4 py-2.5 rounded-2xl bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800 text-xs font-semibold text-purple-900 dark:text-purple-200 flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500 shrink-0" />
            <span>{aiNotice}</span>
          </div>
          <button
            onClick={() => setAiNotice(null)}
            className="text-purple-400 hover:text-purple-600"
          >
            ✕
          </button>
        </div>
      )}

      <div className="note-document-header">
      <div className="note-document-eyebrow">YOUR WORKSPACE / NOTE</div>
      {/* Note Title Input */}
      <div className="pt-4 pb-2">
        <input
          type="text"
          aria-label="Note title"
          placeholder="Untitled Note..."
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="w-full text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white bg-transparent focus:outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600"
        />
      </div>

      {/* Tags Chips & Add Tag */}
      <div className="flex items-center gap-1.5 flex-wrap py-2 border-b border-slate-100 dark:border-slate-800/80 mb-3">
        <Tag className="w-3 h-3 text-slate-400 mr-1" />
        {tags.map((t) => (
          <span
            key={t}
            className="group flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300"
          >
            <span>#{t}</span>
            <button
              aria-label={`Remove tag ${t}`}
              onClick={() => handleRemoveTag(t)}
              className="opacity-50 hover:opacity-100 text-slate-400 hover:text-rose-500 ml-0.5"
            >
              ×
            </button>
          </span>
        ))}
        <div className="flex items-center">
          <input
            type="text"
            placeholder="+ Add tag..."
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddTag();
              }
            }}
            className="text-[11px] font-medium bg-transparent text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none w-20 px-1"
          />
        </div>
      </div>

      </div>
      <div className="note-reading-controls">
        <span>{mode === "write" ? "Live editing" : mode === "source" ? "Markdown source" : "Reading view"}</span>
        <label>Text size
          <select aria-label="Note text size" value={textSize} onChange={e => setTextSize(Number(e.target.value))}>
            <option value="16">16</option><option value="18">18</option><option value="20">20</option><option value="22">22</option>
          </select>
        </label>
      </div>
      <div className="note-content-workspace flex-1 min-h-[450px]">
        {mode === "source" ? <textarea
          aria-label="Markdown source"
          value={content}
          onChange={e => handleContentChange(e.target.value)}
          placeholder="Write Markdown here…"
          className="note-source"
        /> : <Suspense fallback={<div className="min-h-[420px] text-slate-400">Loading editor…</div>}><NoteRichText ref={richEditorRef} key={note.id} content={content} onChange={handleContentChange} readOnly={mode === "preview"} /></Suspense>}
      </div>
      <div className="note-editor-footer"><span>{words} words · {content.length.toLocaleString()} characters · {readTime || 1} min read</span><span>{isFullscreen ? "Esc to exit full screen" : "Autosave on"}</span></div>
    </div>
  );
  return <><div ref={inlineHostRef} />{portalHost ? createPortal(editorView, portalHost) : editorView}</>;
};

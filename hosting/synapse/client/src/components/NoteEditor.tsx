import React, { useState, useEffect, useRef } from "react";
import { KnowledgeItem, NoteFolder } from "../types";
import { MarkdownView } from "./MarkdownView";
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
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Code,
  Quote,
  Minus,
  Eye,
  Edit3,
  Columns,
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

type EditorMode = "write" | "split" | "preview";

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
  const [content, setContent] = useState(note.content || note.summary || "");
  const [folderId, setFolderId] = useState<string | null>(note.folderId || null);
  const [tags, setTags] = useState<string[]>(note.tags || []);
  const [newTagInput, setNewTagInput] = useState("");
  const [pinned, setPinned] = useState(Boolean(note.pinned));
  const [favorite, setFavorite] = useState(Boolean(note.favorite));

  const [mode, setMode] = useState<EditorMode>("write");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [isCopied, setIsCopied] = useState(false);

  // AI assistant state
  const [isAILoading, setIsAILoading] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<any>(null);

  // Update local state when note prop changes
  useEffect(() => {
    setTitle(note.title || note.subject || "");
    setContent(note.content || note.summary || "");
    setFolderId(note.folderId || null);
    setTags(note.tags || []);
    setPinned(Boolean(note.pinned));
    setFavorite(Boolean(note.favorite));
    setSaveStatus("saved");
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
    setSaveStatus("unsaved");
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(() => {
      setSaveStatus("saving");
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
      setSaveStatus("saved");
    }, 400);
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    triggerAutoSave(val, content, folderId, tags, pinned, favorite);
  };

  const handleContentChange = (val: string) => {
    setContent(val);
    triggerAutoSave(title, val, folderId, tags, pinned, favorite);
  };

  const handleFolderChange = (val: string | null) => {
    setFolderId(val);
    triggerAutoSave(title, content, val, tags, pinned, favorite);
  };

  const handleTogglePin = () => {
    const next = !pinned;
    setPinned(next);
    triggerAutoSave(title, content, folderId, tags, next, favorite);
  };

  const handleToggleFavorite = () => {
    const next = !favorite;
    setFavorite(next);
    triggerAutoSave(title, content, folderId, tags, pinned, next);
  };

  const handleAddTag = () => {
    const trimmed = newTagInput.trim().replace(/^#/, "");
    if (trimmed && !tags.includes(trimmed)) {
      const nextTags = [...tags, trimmed];
      setTags(nextTags);
      setNewTagInput("");
      triggerAutoSave(title, content, folderId, nextTags, pinned, favorite);
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const nextTags = tags.filter((t) => t !== tagToRemove);
    setTags(nextTags);
    triggerAutoSave(title, content, folderId, nextTags, pinned, favorite);
  };

  // Formatting helpers
  const insertFormatting = (prefix: string, suffix: string = "", defaultText: string = "") => {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end);
    const textToInsert = selected || defaultText;

    const newContent =
      content.slice(0, start) + prefix + textToInsert + suffix + content.slice(end);

    setContent(newContent);
    triggerAutoSave(title, newContent, folderId, tags, pinned, favorite);

    setTimeout(() => {
      el.focus();
      const cursorTarget = start + prefix.length + textToInsert.length;
      el.setSelectionRange(cursorTarget, cursorTarget);
    }, 10);
  };

  const insertLinePrefix = (prefix: string) => {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const lineStart = content.lastIndexOf("\n", start - 1) + 1;
    const newContent = content.slice(0, lineStart) + prefix + content.slice(lineStart);

    setContent(newContent);
    triggerAutoSave(title, newContent, folderId, tags, pinned, favorite);

    setTimeout(() => {
      el.focus();
      const newCursor = start + prefix.length;
      el.setSelectionRange(newCursor, newCursor);
    }, 10);
  };

  // Keyboard navigation & list completion in textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘S or Ctrl+S to save immediately
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      triggerAutoSave(title, content, folderId, tags, pinned, favorite);
      setSaveStatus("saved");
      return;
    }

    // ⌘B for Bold
    if ((e.metaKey || e.ctrlKey) && e.key === "b") {
      e.preventDefault();
      insertFormatting("**", "**", "bold text");
      return;
    }

    // ⌘I for Italic
    if ((e.metaKey || e.ctrlKey) && e.key === "i") {
      e.preventDefault();
      insertFormatting("*", "*", "italic text");
      return;
    }

    // Tab key inserts 2 spaces
    if (e.key === "Tab") {
      e.preventDefault();
      insertFormatting("  ", "", "");
      return;
    }

    // Enter key auto-continues lists
    if (e.key === "Enter") {
      const el = textareaRef.current;
      if (!el) return;

      const cursor = el.selectionStart;
      const currentLineStart = content.lastIndexOf("\n", cursor - 1) + 1;
      const currentLine = content.slice(currentLineStart, cursor);

      // Task list continuation: - [ ] or - [x]
      const taskMatch = currentLine.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/);
      if (taskMatch) {
        if (!taskMatch[3].trim()) {
          // If empty task item, remove list marker on enter
          e.preventDefault();
          const newContent = content.slice(0, currentLineStart) + content.slice(cursor);
          setContent(newContent);
          triggerAutoSave(title, newContent, folderId, tags, pinned, favorite);
          setTimeout(() => {
            el.setSelectionRange(currentLineStart, currentLineStart);
          }, 10);
        } else {
          e.preventDefault();
          insertFormatting("\n- [ ] ", "", "");
        }
        return;
      }

      // Bullet list continuation: - or *
      const bulletMatch = currentLine.match(/^(\s*)[-*]\s+(.*)$/);
      if (bulletMatch) {
        if (!bulletMatch[2].trim()) {
          // Empty bullet, clear line
          e.preventDefault();
          const newContent = content.slice(0, currentLineStart) + content.slice(cursor);
          setContent(newContent);
          triggerAutoSave(title, newContent, folderId, tags, pinned, favorite);
          setTimeout(() => {
            el.setSelectionRange(currentLineStart, currentLineStart);
          }, 10);
        } else {
          e.preventDefault();
          insertFormatting("\n- ", "", "");
        }
        return;
      }

      // Numbered list continuation: 1. 2.
      const numMatch = currentLine.match(/^(\s*)(\d+)\.\s+(.*)$/);
      if (numMatch) {
        if (!numMatch[3].trim()) {
          // Empty number, clear line
          e.preventDefault();
          const newContent = content.slice(0, currentLineStart) + content.slice(cursor);
          setContent(newContent);
          triggerAutoSave(title, newContent, folderId, tags, pinned, favorite);
          setTimeout(() => {
            el.setSelectionRange(currentLineStart, currentLineStart);
          }, 10);
        } else {
          e.preventDefault();
          const nextNum = parseInt(numMatch[2], 10) + 1;
          insertFormatting(`\n${nextNum}. `, "", "");
        }
        return;
      }
    }
  };

  // Toggle checkbox in preview mode
  const handleToggleCheckbox = (lineIndex: number, newChecked: boolean) => {
    const lines = content.split("\n");
    if (lineIndex >= 0 && lineIndex < lines.length) {
      const line = lines[lineIndex];
      lines[lineIndex] = line.replace(/\[([ xX])\]/, newChecked ? "[x]" : "[ ]");
      const updated = lines.join("\n");
      setContent(updated);
      triggerAutoSave(title, updated, folderId, tags, pinned, favorite);
    }
  };

  // Copy markdown
  const handleCopy = () => {
    navigator.clipboard.writeText(`# ${title}\n\n${content}`);
    setIsCopied(true);
    setTimeout(() => setIsCopied(null as any), 2000);
  };

  // Export note as text
  const handleExport = () => {
    const blob = new Blob([`# ${title}\n\n${content}`], { type: "text/markdown" });
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

    setIsAILoading(true);
    setAiMenuOpen(false);

    let prompt = "";
    if (action === "summarize") {
      prompt = `Provide a concise 3-4 bullet executive summary and key takeaways for this note:\n\nTitle: ${title}\n\n${content}`;
    } else if (action === "tasks") {
      prompt = `Extract all concrete, actionable tasks from this note as a JSON array of strings (e.g. ["task 1", "task 2"]). Only output valid JSON with no preamble:\n\nTitle: ${title}\n\n${content}`;
    } else if (action === "polish") {
      prompt = `Improve clarity, fix typos/grammar, and enhance the structure of this note while preserving all original ideas and technical terms. Return only the revised note in markdown:\n\n${content}`;
    } else if (action === "expand") {
      prompt = `Continue and expand this note with comprehensive, high-value technical context, real-world examples, and next steps:\n\nTitle: ${title}\n\n${content}`;
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
            handleContentChange(content + checklistStr);
            setAiNotice("Appended action tasks to note!");
          }
        } catch {
          handleContentChange(content + "\n\n## Actionable Tasks\n" + aiResponse);
        }
      } else if (action === "summarize") {
        handleContentChange(content + "\n\n## AI Summary & Takeaways\n" + aiResponse);
        setAiNotice("Added summary to note!");
      } else if (action === "polish") {
        handleContentChange(aiResponse);
        setAiNotice("Polished note successfully!");
      } else if (action === "expand") {
        handleContentChange(content + "\n\n" + aiResponse);
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

  return (
    <div
      className={`w-full flex flex-col bg-white dark:bg-[#10131d] rounded-3xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm transition-all ${
        isFullscreen ? "fixed inset-0 z-50 rounded-none border-none p-6 overflow-y-auto" : "p-4 sm:p-6"
      }`}
    >
      {/* Top Navigation & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>

          {/* Folder Selector Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300">
            <FolderIcon className="w-3.5 h-3.5 text-blue-500" />
            <select
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
          {/* Save Status Indicator */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {saveStatus === "saving" ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>Saved</span>
              </>
            )}
            <span className="hidden sm:inline">• {words} words ({readTime}m)</span>
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl">
            <button
              onClick={() => setMode("write")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                mode === "write"
                  ? "bg-white dark:bg-[#141721] text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
              title="Edit Note"
            >
              <Edit3 className="w-3 h-3" />
              <span className="hidden md:inline">Write</span>
            </button>
            <button
              onClick={() => setMode("split")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                mode === "split"
                  ? "bg-white dark:bg-[#141721] text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
              title="Split View (Editor + Live Preview)"
            >
              <Columns className="w-3 h-3" />
              <span className="hidden md:inline">Split</span>
            </button>
            <button
              onClick={() => setMode("preview")}
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
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Focus"}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={() => {
              if (confirm(`Delete note "${title || "Untitled"}"?`)) {
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

      {/* Note Title Input */}
      <div className="pt-4 pb-2">
        <input
          type="text"
          placeholder="Untitled Note..."
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="w-full text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white bg-transparent focus:outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600"
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

      {/* Formatting Toolbar (shown in Write and Split modes) */}
      {mode !== "preview" && (
        <div className="flex items-center gap-1 flex-wrap py-1.5 px-2 mb-3 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-300">
          <button
            type="button"
            onClick={() => insertFormatting("**", "**", "bold text")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="Bold (⌘B)"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertFormatting("*", "*", "italic text")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="Italic (⌘I)"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertFormatting("~~", "~~", "strikethrough")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="Strikethrough"
          >
            <Strikethrough className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

          <button
            type="button"
            onClick={() => insertLinePrefix("# ")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="Heading 1"
          >
            <Heading1 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertLinePrefix("## ")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="Heading 2"
          >
            <Heading2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertLinePrefix("### ")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="Heading 3"
          >
            <Heading3 className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

          <button
            type="button"
            onClick={() => insertLinePrefix("- ")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="Bullet List"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertLinePrefix("1. ")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="Numbered List"
          >
            <ListOrdered className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertLinePrefix("- [ ] ")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="Checklist / Task List"
          >
            <CheckSquare className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

          <button
            type="button"
            onClick={() => insertFormatting("```\n", "\n```", "code")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="Code Block"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertLinePrefix("> ")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="Blockquote"
          >
            <Quote className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertFormatting("\n---\n", "", "")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="Horizontal Rule"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Content Workspace: Write, Split, or Preview */}
      <div className="flex-1 min-h-[450px] flex">
        {mode === "write" && (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your notes here... Markdown is supported (# Headings, - Lists, - [ ] Checkboxes, ```code, **bold**)"
            className="w-full h-full min-h-[450px] p-2 bg-transparent text-slate-800 dark:text-slate-100 font-sans text-xs sm:text-[13px] leading-relaxed focus:outline-none resize-none"
          />
        )}

        {mode === "split" && (
          <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 min-h-[450px]">
            <div className="border-r border-slate-100 dark:border-slate-800/80 pr-4">
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your markdown notes here..."
                className="w-full h-full min-h-[450px] p-2 bg-transparent text-slate-800 dark:text-slate-100 font-sans text-xs sm:text-[13px] leading-relaxed focus:outline-none resize-none"
              />
            </div>
            <div className="pl-2 overflow-y-auto max-h-[700px]">
              <MarkdownView
                content={content || "*No content typed yet...*"}
                onToggleCheckbox={handleToggleCheckbox}
              />
            </div>
          </div>
        )}

        {mode === "preview" && (
          <div className="w-full min-h-[450px] p-2 overflow-y-auto">
            <MarkdownView
              content={content || "*Empty note. Switch to Write mode to type...*"}
              onToggleCheckbox={handleToggleCheckbox}
            />
          </div>
        )}
      </div>
    </div>
  );
};

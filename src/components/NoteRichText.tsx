import { forwardRef, lazy, memo, Suspense, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { noteExtensions } from "./noteExtensions";
import { noteHighlightColors, toggleNoteHighlight } from "./noteHighlight";
import { ANNOTATE_EVENT, type AnnotateDetail } from "./noteImage";
import { imageFilesFrom } from "../utils/imageInput";
import { prepareNoteImage } from "../utils/noteImages";
import { storeNoteImage } from "../services/noteImageStore";
import { ImagePlus, Bold, Italic, Strikethrough, Highlighter, ChevronDown, Code, List, ListOrdered, CheckSquare, Quote, Minus, Undo2, Redo2, Link2, Unlink, RemoveFormatting } from "lucide-react";

const PAUSE_MS = 600, MAX_UNSAVED_MS = 5000;
const whenIdle = (run: () => void): number => typeof requestIdleCallback === "function"
  ? requestIdleCallback(run, { timeout: 400 }) : window.setTimeout(run, 0);
const cancelIdle = (handle: number) => { if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle); else clearTimeout(handle); };

const ImageAnnotator = lazy(() => import("./ImageAnnotator").then(m => ({ default: m.ImageAnnotator })));

/** Compresses pasted/dropped/picked images and inserts them at `pos` (or the selection) as one undo step. */
async function insertImages(view: EditorView, files: File[], onError: (message: string) => void, pos?: number) {
  const refs = await Promise.all(files.slice(0, 12).map(file => prepareNoteImage(file).then(storeNoteImage)
    .catch((err: Error) => { onError(err.message || "That image couldn’t be saved."); return null; })));
  const type = view.state.schema.nodes.image;
  const nodes = refs.filter(Boolean).map(src => type.create({ src, alt: null }));
  if (!nodes.length || view.isDestroyed) return;
  const tr = pos == null ? view.state.tr.replaceSelectionWith(nodes[0]) : view.state.tr.insert(Math.min(pos, view.state.doc.content.size), nodes[0]);
  let at = tr.mapping.map(pos ?? view.state.selection.from);
  for (const node of nodes.slice(1)) { tr.insert(at, node); at += node.nodeSize; }
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Moves inline `data:` images (older notes, assistant edits, pasted HTML) into the image store. */
async function externalizeImages(editor: Editor) {
  const inline = new Set<string>();
  editor.state.doc.descendants(node => { if (node.type.name === "image" && /^data:image\//.test(node.attrs.src || "")) inline.add(node.attrs.src); });
  if (!inline.size) return;
  const refs = new Map<string, string>();
  for (const src of inline) {
    try { refs.set(src, await storeNoteImage(await (await fetch(src)).blob())); } catch { /* Leave it inline. */ }
  }
  if (!refs.size || editor.isDestroyed) return;
  const tr = editor.state.tr;
  editor.state.doc.descendants((node, pos) => {
    const ref = node.type.name === "image" && refs.get(node.attrs.src);
    if (ref) tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: ref });
  });
  // Not an edit the user should undo; it still marks the note changed so the smaller text is saved.
  editor.view.dispatch(tr.setMeta("addToHistory", false));
}

interface Props { content: string; onChange: (markdown: string) => void; readOnly?: boolean }

export interface NoteRichTextHandle { flush: () => string }

export const NoteRichText = memo(forwardRef<NoteRichTextHandle, Props>(function NoteRichText({ content, onChange, readOnly = false }, ref) {
  const extensions = useMemo(noteExtensions, []);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const publishedRef = useRef(content);
  const dirtyRef = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleHandle = useRef<number | null>(null);
  const clearTimers = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (maxTimer.current) clearTimeout(maxTimer.current);
    if (idleHandle.current != null) cancelIdle(idleHandle.current);
    idleTimer.current = maxTimer.current = idleHandle.current = null;
  };
  // Serializing and saving run in a gap between keystrokes, never inside one.
  const publishWhenIdle = (instance: Editor) => {
    if (idleHandle.current != null) return;
    idleHandle.current = whenIdle(() => { idleHandle.current = null; publish(instance); });
  };
  const publish = (instance: Editor) => {
    clearTimers();
    if (!dirtyRef.current) return publishedRef.current;
    dirtyRef.current = false;
    const markdown = instance.getMarkdown();
    if (markdown.includes("data:image/")) void externalizeImages(instance); // e.g. images inside pasted HTML
    if (markdown !== publishedRef.current) {
      publishedRef.current = markdown;
      onChangeRef.current(markdown);
    }
    return markdown;
  };
  const [linkOpen, setLinkOpen] = useState(false);
  const [highlightColorsOpen, setHighlightColorsOpen] = useState(false);
  const highlightColorsButton = useRef<HTMLButtonElement>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const [annotating, setAnnotating] = useState<AnnotateDetail | null>(null);
  const [imageError, setImageError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const showImageError = (message: string) => { setImageError(message); setTimeout(() => setImageError(""), 5000); };
  const errorRef = useRef(showImageError);
  errorRef.current = showImageError;
  const editor = useEditor({
    extensions,
    content,
    contentType: "markdown",
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable: !readOnly,
    editorProps: {
      attributes: { class: "note-prose", role: "textbox", "aria-label": "Note content", "aria-multiline": "true" },
      // Screenshots and copied images arrive as files; plain HTML/text pastes go through ProseMirror untouched.
      handlePaste: (view, event) => {
        const files = imageFilesFrom(event.clipboardData);
        if (!files.length || !view.editable) return false;
        event.preventDefault();
        void insertImages(view, files, m => errorRef.current(m));
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = moved ? [] : imageFilesFrom(event.dataTransfer);
        if (!files.length || !view.editable) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertImages(view, files, m => errorRef.current(m), pos);
        return true;
      },
      handleDoubleClickOn: (view, pos, node) => {
        if (node.type.name !== "image" || !view.editable) return false;
        setAnnotating({ pos, src: node.attrs.src });
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      // Editing stays in ProseMirror. Convert the full document only after a pause,
      // with a bounded interval for long uninterrupted writing sessions.
      // Each publish is one save, so it waits for a pause in typing (or at most a few seconds).
      dirtyRef.current = true;
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => publishWhenIdle(editor), PAUSE_MS);
      if (!maxTimer.current) maxTimer.current = setTimeout(() => publishWhenIdle(editor), MAX_UNSAVED_MS);
    },
  });
  useImperativeHandle(ref, () => ({ flush: () => editor ? publish(editor) : publishedRef.current }), [editor]);
  useEffect(() => () => clearTimers(), []);
  useEffect(() => { if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly); }, [editor, readOnly]);
  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    const open = (e: Event) => setAnnotating((e as CustomEvent<AnnotateDetail>).detail);
    dom.addEventListener(ANNOTATE_EVENT, open);
    return () => dom.removeEventListener(ANNOTATE_EVENT, open);
  }, [editor]);
  useEffect(() => {
    // Echoes of our own autosave never reparse the document or move the cursor.
    if (editor && content !== publishedRef.current) {
      clearTimers();
      dirtyRef.current = false;
      publishedRef.current = content;
      editor.commands.setContent(content, { contentType: "markdown", emitUpdate: false });
    }
    if (editor && content.includes("data:image/")) void externalizeImages(editor);
  }, [editor, content]);
  const state = useEditorState({ editor, selector: ({ editor: e }) => e ? {
    bold: e.isActive("bold"), italic: e.isActive("italic"), strike: e.isActive("strike"), highlight: e.isActive("highlight"),
    code: e.isActive("code"), codeBlock: e.isActive("codeBlock"), bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"),
    task: e.isActive("taskList"), quote: e.isActive("blockquote"), link: e.isActive("link"),
    heading: [1, 2, 3].find(level => e.isActive("heading", { level })) || 0,
    undo: e.can().undo(), redo: e.can().redo(),
  } : null });
  if (!editor) return <div className="min-h-[420px]" />;
  const tool = (label: string, Icon: typeof Bold, action: () => void, active = false, disabled = false) => (
    <button key={label} type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled}
      onMouseDown={e => e.preventDefault()} onClick={action} className="note-tool">
      <Icon size={17} strokeWidth={1.8} />
    </button>
  );
  const divider = <span className="note-tool-divider" aria-hidden="true" />;
  return <div className="note-rich-text">
    {!readOnly && <>
      <div className="note-format-bar" role="toolbar" aria-label="Text formatting">
        <select aria-label="Text style" value={state?.heading || 0} onChange={e => {
          const level = Number(e.target.value) as 0 | 1 | 2 | 3;
          if (level) editor.chain().focus().setHeading({ level }).run();
          else editor.chain().focus().setParagraph().run();
        }} className="note-style-select">
          <option value="0">Text</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option>
        </select>
        {divider}
        {tool("Bold (⌘/Ctrl+B)", Bold, () => { editor.chain().focus().toggleBold().run(); }, state?.bold)}
        {tool("Italic (⌘/Ctrl+I)", Italic, () => { editor.chain().focus().toggleItalic().run(); }, state?.italic)}
        {tool("Strikethrough", Strikethrough, () => { editor.chain().focus().toggleStrike().run(); }, state?.strike)}
        <div className="note-highlight-tools">
          <button type="button" className="note-tool" title="Highlight (⌘/Ctrl+Shift+E)" aria-label="Highlight"
            aria-keyshortcuts="Meta+Shift+E Control+Shift+E" aria-pressed={state?.highlight ?? false}
            onMouseDown={e => e.preventDefault()} onClick={() => { editor.commands.focus(); toggleNoteHighlight(editor); }}>
            <Highlighter size={17} strokeWidth={1.8} />
          </button>
          <button ref={highlightColorsButton} type="button" className="note-tool note-highlight-toggle"
            title="Highlight colors" aria-label="Highlight colors" aria-expanded={highlightColorsOpen}
            onMouseDown={e => e.preventDefault()} onClick={() => setHighlightColorsOpen(open => !open)}>
            <ChevronDown size={13} />
          </button>
        </div>
        {tool("Inline code", Code, () => { editor.chain().focus().toggleCode().run(); }, state?.code)}
        {divider}
        {tool("Bullet list", List, () => { editor.chain().focus().toggleBulletList().run(); }, state?.bullet)}
        {tool("Numbered list", ListOrdered, () => { editor.chain().focus().toggleOrderedList().run(); }, state?.ordered)}
        {tool("Checklist", CheckSquare, () => { editor.chain().focus().toggleTaskList().run(); }, state?.task)}
        {tool("Quote", Quote, () => { editor.chain().focus().toggleBlockquote().run(); }, state?.quote)}
        {tool("Code block", Code, () => { editor.chain().focus().toggleCodeBlock().run(); }, state?.codeBlock)}
        {tool("Divider", Minus, () => { editor.chain().focus().setHorizontalRule().run(); })}
        {tool("Insert image (or paste / drop one)", ImagePlus, () => fileInput.current?.click())}
        {divider}
        {tool("Add or edit link", Link2, () => { setLinkUrl(editor.getAttributes("link").href || ""); setLinkError(""); setLinkOpen(!linkOpen); }, state?.link)}
        {state?.link && tool("Remove link", Unlink, () => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); })}
        {tool("Clear formatting", RemoveFormatting, () => { editor.chain().focus().unsetAllMarks().clearNodes().run(); })}
        {divider}
        {tool("Undo", Undo2, () => { editor.chain().focus().undo().run(); }, false, !state?.undo)}
        {tool("Redo", Redo2, () => { editor.chain().focus().redo().run(); }, false, !state?.redo)}
        {highlightColorsOpen && <div className="note-highlight-colors" role="group" aria-label="Highlight palette" onKeyDown={e => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          setHighlightColorsOpen(false);
          highlightColorsButton.current?.focus();
        }}>
          {noteHighlightColors.map(({ name, color, swatch }) => <button key={name} type="button" className="note-highlight-swatch"
            title={name} aria-label={`${name} highlight`} aria-pressed={editor.storage.highlight.preferredColor === color}
            onMouseDown={e => e.preventDefault()} onClick={() => {
              editor.storage.highlight.preferredColor = color;
              editor.chain().focus().setMark("highlight", { color }).run();
              setHighlightColorsOpen(false);
            }}>
            <span style={{ backgroundColor: swatch }} />
          </button>)}
        </div>}
      </div>
      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={e => {
        const files = Array.from(e.target.files || []);
        e.target.value = "";
        if (files.length) void insertImages(editor.view, files, showImageError);
      }} />
      {imageError && <p className="note-image-error" role="alert">{imageError}</p>}
      {linkOpen && <form className="note-link-form" onSubmit={e => {
        e.preventDefault();
        const url = linkUrl.trim();
        if (!/^(https?:\/\/|mailto:)/i.test(url)) { setLinkError("Use an https://, http://, or mailto: link."); return; }
        editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run(); setLinkOpen(false);
      }}>
        <input autoFocus aria-label="Link URL" placeholder="https://example.com" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} />
        <button type="submit">Apply link</button><button type="button" onClick={() => { setLinkOpen(false); editor.commands.focus(); }}>Cancel</button>
        {linkError && <span role="alert">{linkError}</span>}
      </form>}
    </>}
    <EditorContent editor={editor} />
    {!readOnly && <p className="note-writing-hint">Markdown shortcuts work as you type · Paste or drop images, drag their edges to resize, double-click to draw · ⌘/Ctrl+Z to undo</p>}
    {annotating && <Suspense fallback={null}><ImageAnnotator src={annotating.src} onClose={() => { setAnnotating(null); editor.commands.focus(); }} onSave={async blob => {
      const src = await storeNoteImage(blob);
      let pos = annotating.pos, node = editor.state.doc.nodeAt(pos);
      if (node?.type.name !== "image" || node.attrs.src !== annotating.src) { // Find it again if the note changed meanwhile.
        node = null;
        editor.state.doc.descendants((n, p) => { if (!node && n.type.name === "image" && n.attrs.src === annotating.src) { node = n; pos = p; } return !node; });
      }
      if (node) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src }));
      else showImageError("The image moved while you were drawing, so the drawing wasn’t applied.");
      setAnnotating(null);
    }} /></Suspense>}
  </div>;
}));

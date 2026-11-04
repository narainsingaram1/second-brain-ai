import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { noteExtensions } from "./noteExtensions";
import { Bold, Italic, Strikethrough, Highlighter, Code, List, ListOrdered, CheckSquare, Quote, Minus, Undo2, Redo2, Link2, Unlink, RemoveFormatting } from "lucide-react";

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
  const clearTimers = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (maxTimer.current) clearTimeout(maxTimer.current);
    idleTimer.current = maxTimer.current = null;
  };
  const publish = (instance: Editor) => {
    clearTimers();
    if (!dirtyRef.current) return publishedRef.current;
    dirtyRef.current = false;
    const markdown = instance.getMarkdown();
    if (markdown !== publishedRef.current) {
      publishedRef.current = markdown;
      onChangeRef.current(markdown);
    }
    return markdown;
  };
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const editor = useEditor({
    extensions,
    content,
    contentType: "markdown",
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable: !readOnly,
    editorProps: { attributes: { class: "note-prose", role: "textbox", "aria-label": "Note content", "aria-multiline": "true" } },
    onUpdate: ({ editor }) => {
      // Editing stays in ProseMirror. Convert the full document only after a pause,
      // with a bounded interval for long uninterrupted writing sessions.
      dirtyRef.current = true;
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => publish(editor), 300);
      if (!maxTimer.current) maxTimer.current = setTimeout(() => publish(editor), 2000);
    },
  });
  useImperativeHandle(ref, () => ({ flush: () => editor ? publish(editor) : publishedRef.current }), [editor]);
  useEffect(() => () => clearTimers(), []);
  useEffect(() => { if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly); }, [editor, readOnly]);
  useEffect(() => {
    // Echoes of our own autosave never reparse the document or move the cursor.
    if (editor && content !== publishedRef.current) {
      clearTimers();
      dirtyRef.current = false;
      publishedRef.current = content;
      editor.commands.setContent(content, { contentType: "markdown", emitUpdate: false });
    }
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
        {tool("Highlight (⌘/Ctrl+Shift+H)", Highlighter, () => { editor.chain().focus().toggleHighlight().run(); }, state?.highlight)}
        {tool("Inline code", Code, () => { editor.chain().focus().toggleCode().run(); }, state?.code)}
        {divider}
        {tool("Bullet list", List, () => { editor.chain().focus().toggleBulletList().run(); }, state?.bullet)}
        {tool("Numbered list", ListOrdered, () => { editor.chain().focus().toggleOrderedList().run(); }, state?.ordered)}
        {tool("Checklist", CheckSquare, () => { editor.chain().focus().toggleTaskList().run(); }, state?.task)}
        {tool("Quote", Quote, () => { editor.chain().focus().toggleBlockquote().run(); }, state?.quote)}
        {tool("Code block", Code, () => { editor.chain().focus().toggleCodeBlock().run(); }, state?.codeBlock)}
        {tool("Divider", Minus, () => { editor.chain().focus().setHorizontalRule().run(); })}
        {divider}
        {tool("Add or edit link", Link2, () => { setLinkUrl(editor.getAttributes("link").href || ""); setLinkError(""); setLinkOpen(!linkOpen); }, state?.link)}
        {state?.link && tool("Remove link", Unlink, () => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); })}
        {tool("Clear formatting", RemoveFormatting, () => { editor.chain().focus().unsetAllMarks().clearNodes().run(); })}
        {divider}
        {tool("Undo", Undo2, () => { editor.chain().focus().undo().run(); }, false, !state?.undo)}
        {tool("Redo", Redo2, () => { editor.chain().focus().redo().run(); }, false, !state?.redo)}
      </div>
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
    {!readOnly && <p className="note-writing-hint">Markdown shortcuts work as you type · Select text to format · ⌘/Ctrl+Z to undo</p>}
  </div>;
}));

import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { NoteImage } from "./noteImage";
// Keep the same schema in edit/read modes so switching views never drops formatting.
export const noteExtensions = () => [
  StarterKit.configure({ link: { openOnClick: false, autolink: true }, underline: false }),
  Markdown, Highlight, TaskList, TaskItem.configure({ nested: true }),
  TableKit, NoteImage,
  Placeholder.configure({ placeholder: "Start writing… Try # for a heading, - for a list, or ==highlight==." }),
];

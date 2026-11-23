import Highlight from "@tiptap/extension-highlight";
import type { Editor } from "@tiptap/core";

export const noteHighlightColors = [
  { name: "Yellow", color: null, swatch: "#fef08a" },
  { name: "Peach", color: "#fed7aa", swatch: "#fed7aa" },
  { name: "Pink", color: "#fbcfe8", swatch: "#fbcfe8" },
  { name: "Lavender", color: "#ddd6fe", swatch: "#ddd6fe" },
  { name: "Blue", color: "#bae6fd", swatch: "#bae6fd" },
  { name: "Mint", color: "#bbf7d0", swatch: "#bbf7d0" },
] as const;

declare module "@tiptap/core" {
  interface Storage {
    highlight: { preferredColor: string | null };
  }
}

const defaultTokenizer = Highlight.config.markdownTokenizer;
const hexColor = (color: unknown) => typeof color === "string" && /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : null;

export function toggleNoteHighlight(editor: Editor) {
  const color = editor.storage.highlight.preferredColor;
  return editor.isActive("highlight")
    ? editor.commands.unsetHighlight()
    : editor.commands.setHighlight(color ? { color } : undefined);
}

export const NoteHighlight = Highlight.extend({
  addStorage: () => ({ preferredColor: null as string | null }),
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: el => hexColor(el.getAttribute("data-color")),
        renderHTML: attrs => {
          const color = hexColor(attrs.color);
          return color ? { "data-color": color, style: `background-color: ${color}` } : {};
        },
      },
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Shift-e": () => toggleNoteHighlight(this.editor) };
  },
  markdownTokenizer: {
    name: "highlight",
    level: "inline",
    start(src) {
      const positions = [src.indexOf("=="), src.indexOf('<mark data-color="')].filter(pos => pos >= 0);
      return positions.length ? Math.min(...positions) : -1;
    },
    tokenize(src, tokens, helpers) {
      const match = /^<mark data-color="(#[\da-f]{6})">([\s\S]+?)<\/mark>/i.exec(src);
      if (!match) return defaultTokenizer?.tokenize(src, tokens, helpers);
      const [raw, color, text] = match;
      return { type: "highlight", raw, color, tokens: helpers.inlineTokens(text) };
    },
  },
  parseMarkdown: (token, helpers) => {
    const color = hexColor(token.color);
    return helpers.applyMark("highlight", helpers.parseInline(token.tokens || []), color ? { color } : undefined);
  },
  renderMarkdown: (node, helpers) => {
    const text = helpers.renderChildren(node);
    const color = hexColor(node.attrs?.color);
    return color ? `<mark data-color="${color}">${text}</mark>` : `==${text}==`;
  },
});

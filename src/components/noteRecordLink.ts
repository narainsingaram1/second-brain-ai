import { InputRule, mergeAttributes, Node } from "@tiptap/core";
import { LINKABLE_TYPES } from "../utils/noteLinks";

const VALID_TYPES = new Set<string>(LINKABLE_TYPES);

/**
 * Inline atomic node representing a `[[Wiki-Link]]` or `@[Title](synapse://type/id)` record mention.
 * Round-trips cleanly with `@tiptap/markdown` and renders as an interactive inline pill.
 */
export const NoteRecordLink = Node.create({
  name: "recordLink",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      targetType: {
        default: "knowledge",
        parseHTML: el => el.getAttribute("data-link-type") || "knowledge",
        renderHTML: attrs => ({ "data-link-type": attrs.targetType || "knowledge" }),
      },
      targetId: {
        default: null,
        parseHTML: el => el.getAttribute("data-link-id") || null,
        renderHTML: attrs => (attrs.targetId ? { "data-link-id": attrs.targetId } : {}),
      },
      label: {
        default: "",
        parseHTML: el => el.getAttribute("data-link-label") || el.textContent || "",
        renderHTML: attrs => ({ "data-link-label": attrs.label || "" }),
      },
      syntax: {
        default: "wiki",
        parseHTML: el => el.getAttribute("data-link-syntax") || "wiki",
        renderHTML: attrs => ({ "data-link-syntax": attrs.syntax || "wiki" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-record-link="true"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = String(node.attrs.label || "Untitled");
    const type = String(node.attrs.targetType || "knowledge");
    return [
      "span",
      mergeAttributes(
        {
          "data-record-link": "true",
          class: `nx-record-pill nx-pill-${type}`,
          title: `Open ${type === "knowledge" ? "note" : type}: ${label}`,
        },
        HTMLAttributes,
      ),
      label,
    ];
  },

  renderMarkdown: node => {
    const label = String(node.attrs?.label || "Untitled").replace(/[\[\]]/g, "").trim() || "Untitled";
    const type = String(node.attrs?.targetType || "knowledge");
    const id = node.attrs?.targetId ? String(node.attrs.targetId).trim() : "";
    const syntax = node.attrs?.syntax === "mention" ? "mention" : "wiki";

    if (syntax === "mention" && id) {
      return `@[${label}](synapse://${type}/${id})`;
    }
    if (type !== "knowledge" && id) {
      return `[[${type}:${id}|${label}]]`;
    }
    return `[[${label}]]`;
  },

  parseMarkdown: (token, helpers) => {
    const rawToken = token as unknown as {
      targetType?: string;
      targetId?: string | null;
      label?: string;
      syntax?: "wiki" | "mention";
    };
    return helpers.createNode("recordLink", {
      targetType: rawToken.targetType || "knowledge",
      targetId: rawToken.targetId || null,
      label: rawToken.label || "",
      syntax: rawToken.syntax || "wiki",
    });
  },

  markdownTokenizer: {
    name: "recordLink",
    level: "inline",
    start(src: string) {
      const wiki = src.indexOf("[[");
      const mention = src.indexOf("@[");
      if (wiki < 0) return mention;
      if (mention < 0) return wiki;
      return Math.min(wiki, mention);
    },
    tokenize(src: string) {
      const mention = /^@\[([^\]\n]+)\]\(synapse:\/\/([a-z]+)\/([^\s)]+)\)/.exec(src);
      if (mention && VALID_TYPES.has(mention[2])) {
        return {
          type: "recordLink",
          raw: mention[0],
          targetType: mention[2],
          targetId: mention[3].trim(),
          label: mention[1].trim(),
          syntax: "mention" as const,
          tokens: [],
        };
      }
      const wiki = /^\[\[([^\[\]\n]+?)\]\]/.exec(src);
      if (wiki) {
        const inner = wiki[1].trim();
        const typed = /^([a-z]+):([^|\s]+)\|(.+)$/.exec(inner);
        if (typed && VALID_TYPES.has(typed[1])) {
          return {
            type: "recordLink",
            raw: wiki[0],
            targetType: typed[1],
            targetId: typed[2].trim(),
            label: typed[3].trim(),
            syntax: "wiki" as const,
            tokens: [],
          };
        }
        return {
          type: "recordLink",
          raw: wiki[0],
          targetType: "knowledge",
          targetId: null,
          label: inner,
          syntax: "wiki" as const,
          tokens: [],
        };
      }
      return undefined;
    },
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^\[\]\n]+?)\]\]$/,
        handler: ({ state, range, match }) => {
          const inner = match[1]?.trim();
          if (!inner) return null;
          const typed = /^([a-z]+):([^|\s]+)\|(.+)$/.exec(inner);
          const attrs =
            typed && VALID_TYPES.has(typed[1])
              ? { targetType: typed[1], targetId: typed[2].trim(), label: typed[3].trim(), syntax: "wiki" }
              : { targetType: "knowledge", targetId: null, label: inner, syntax: "wiki" };
          state.tr.replaceWith(range.from, range.to, this.type.create(attrs));
        },
      }),
    ];
  },
});

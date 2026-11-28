import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { cachedImageUrl, isImageRef, resolveImageUrl } from "../services/noteImageStore";
import { formatWhiteboardAlt, WHITEBOARD_BLANK_SRC } from "../utils/whiteboard";

export const OPEN_WHITEBOARD_EVENT = "note-whiteboard-open";
export interface OpenWhiteboardDetail {
  pos: number;
  boardId: string;
  title: string;
}

const MIN_WIDTH = 160;
const PRESETS: Array<[label: string, title: string, fraction: number | null]> = [
  ["S", "Small (⅓ width)", 1 / 3],
  ["M", "Medium (½ width)", 1 / 2],
  ["L", "Large (¾ width)", 3 / 4],
  ["Full", "Full width", null],
];

function chipButton(label: string, title: string, className = "note-image-chip") {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.textContent = label;
  el.title = title;
  el.setAttribute("aria-label", title);
  return el;
}

/**
 * Embedded whiteboard block that round-trips through Markdown as `![wb:<id>|<title>|<width>](<previewSrc>)`,
 * with resize handles, width presets, and a Draw button to launch the low-latency canvas modal.
 */
export const NoteWhiteboard = Node.create({
  name: "whiteboard",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      boardId: {
        default: null,
        parseHTML: el => el.getAttribute("data-whiteboard-id") || null,
        renderHTML: attrs => (attrs.boardId ? { "data-whiteboard-id": attrs.boardId } : {}),
      },
      title: {
        default: "Whiteboard",
        parseHTML: el => el.getAttribute("data-whiteboard-title") || "Whiteboard",
        renderHTML: attrs => ({ "data-whiteboard-title": attrs.title || "Whiteboard" }),
      },
      width: {
        default: null,
        parseHTML: el => Number(el.getAttribute("data-width")) || null,
        renderHTML: attrs => (attrs.width ? { "data-width": attrs.width } : {}),
      },
      src: {
        default: WHITEBOARD_BLANK_SRC,
        parseHTML: el => el.getAttribute("data-src") || WHITEBOARD_BLANK_SRC,
        renderHTML: attrs => ({ "data-src": attrs.src || WHITEBOARD_BLANK_SRC }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "figure[data-whiteboard-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes({ class: "note-whiteboard" }, HTMLAttributes)];
  },

  renderMarkdown: node => {
    const boardId = String(node.attrs?.boardId || "").trim();
    const title = String(node.attrs?.title || "Whiteboard");
    const width = node.attrs?.width ? Number(node.attrs.width) : null;
    const src = String(node.attrs?.src || WHITEBOARD_BLANK_SRC);
    return `![${formatWhiteboardAlt(boardId, title, width)}](${src})`;
  },

  addNodeView() {
    return ({ node: initial, getPos, editor }) => {
      let node: PMNode = initial;
      const dom = document.createElement("figure");
      dom.className = "note-image note-whiteboard";
      dom.contentEditable = "false";

      const frame = document.createElement("div");
      frame.className = "note-image-frame note-whiteboard-frame";

      const header = document.createElement("div");
      header.className = "note-whiteboard-header";
      const badge = document.createElement("span");
      badge.className = "note-whiteboard-badge";
      const label = document.createElement("span");
      label.className = "note-whiteboard-title";
      const headerDraw = chipButton("Draw", "Open whiteboard", "note-image-chip note-image-draw note-whiteboard-header-draw");
      header.append(badge, label, headerDraw);

      const preview = document.createElement("div");
      preview.className = "note-whiteboard-body";

      const img = document.createElement("img");
      img.draggable = false;
      img.decoding = "async";

      const emptyState = document.createElement("button");
      emptyState.type = "button";
      emptyState.className = "note-whiteboard-empty";
      emptyState.textContent = "Blank whiteboard — tap to draw with Apple Pencil or mouse";

      preview.append(img, emptyState);
      frame.append(header, preview);

      const openBoard = () => {
        if (!editor.isEditable) return;
        const pos = getPos();
        if (typeof pos === "number" && node.attrs.boardId) {
          dom.dispatchEvent(
            new CustomEvent<OpenWhiteboardDetail>(OPEN_WHITEBOARD_EVENT, {
              bubbles: true,
              detail: {
                pos,
                boardId: String(node.attrs.boardId),
                title: String(node.attrs.title || "Whiteboard"),
              },
            }),
          );
        }
      };

      headerDraw.addEventListener("click", openBoard);
      emptyState.addEventListener("click", openBoard);
      preview.addEventListener("dblclick", openBoard);

      const tools = document.createElement("div");
      tools.className = "note-image-tools";
      const presetButtons = PRESETS.map(([presetLabel, presetTitle, fraction]) => {
        const b = chipButton(presetLabel, presetTitle);
        b.addEventListener("click", () => commit(fraction == null ? null : Math.round(maxWidth() * fraction)));
        return b;
      });
      const draw = chipButton("Draw", "Open whiteboard", "note-image-chip note-image-draw");
      draw.addEventListener("click", openBoard);
      tools.append(...presetButtons, draw);

      const handles = (["left", "right"] as const).map(side => {
        const h = document.createElement("span");
        h.className = `note-image-handle note-image-handle-${side}`;
        h.setAttribute("aria-hidden", "true");
        h.addEventListener("pointerdown", event => startResize(event, side));
        return h;
      });
      frame.append(...handles);
      dom.append(frame, tools);

      const maxWidth = () => dom.parentElement?.clientWidth || dom.clientWidth || 800;
      let shownSrc: string | null = null;
      const showSource = () => {
        const src: string = node.attrs.src || WHITEBOARD_BLANK_SRC;
        if (!src || src === WHITEBOARD_BLANK_SRC) {
          shownSrc = src;
          img.hidden = true;
          emptyState.hidden = false;
          dom.classList.remove("is-loading", "is-missing");
          return;
        }
        img.hidden = false;
        emptyState.hidden = true;
        if (src === shownSrc) return;
        shownSrc = src;
        if (!isImageRef(src)) {
          img.src = src;
          dom.classList.remove("is-loading", "is-missing");
          return;
        }
        const cached = cachedImageUrl(src);
        if (cached) {
          img.src = cached;
          dom.classList.remove("is-loading", "is-missing");
          return;
        }
        dom.classList.add("is-loading");
        dom.classList.remove("is-missing");
        resolveImageUrl(src)
          .then(url => {
            if (shownSrc === src) {
              img.src = url;
              dom.classList.remove("is-loading");
            }
          })
          .catch(() => {
            if (shownSrc === src) {
              dom.classList.remove("is-loading");
              dom.classList.add("is-missing");
              img.removeAttribute("src");
            }
          });
      };

      const apply = () => {
        showSource();
        badge.textContent = "Whiteboard";
        label.textContent = node.attrs.title && node.attrs.title !== "Whiteboard" ? String(node.attrs.title) : "";
        img.alt = node.attrs.title || "Whiteboard";
        frame.style.width = node.attrs.width ? `${node.attrs.width}px` : "100%";
        const w = node.attrs.width;
        presetButtons.forEach((b, i) => {
          const fraction = PRESETS[i][2];
          const on = fraction == null ? !w : !!w && Math.abs(w - maxWidth() * fraction) < 4;
          b.setAttribute("aria-pressed", String(on));
        });
      };

      const commit = (width: number | null) => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        const next = width == null || width >= maxWidth() - 2 ? null : Math.max(MIN_WIDTH, Math.round(width));
        if (next === node.attrs.width) {
          apply();
          return;
        }
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: next }));
      };

      function startResize(event: PointerEvent, side: "left" | "right") {
        if (!editor.isEditable || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const handle = event.currentTarget as HTMLElement;
        handle.setPointerCapture(event.pointerId);
        const startX = event.clientX;
        const startWidth = frame.getBoundingClientRect().width;
        const limit = maxWidth();
        dom.classList.add("is-resizing");
        let width = startWidth;
        let frameRequest = 0;
        const move = (e: PointerEvent) => {
          const delta = (e.clientX - startX) * (side === "left" ? -1 : 1);
          width = Math.min(limit, Math.max(MIN_WIDTH, startWidth + delta));
          if (!frameRequest) {
            frameRequest = requestAnimationFrame(() => {
              frameRequest = 0;
              frame.style.width = `${width}px`;
            });
          }
        };
        const end = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", end);
          handle.removeEventListener("pointercancel", end);
          cancelAnimationFrame(frameRequest);
          dom.classList.remove("is-resizing");
          commit(width);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
      }

      apply();
      return {
        dom,
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated;
          apply();
          return true;
        },
        selectNode() {
          dom.classList.add("is-selected");
        },
        deselectNode() {
          dom.classList.remove("is-selected");
        },
        stopEvent: event => {
          const target = event.target as HTMLElement | null;
          return !!target?.closest?.(".note-image-tools, .note-image-handle, .note-whiteboard-header-draw, .note-whiteboard-empty");
        },
        ignoreMutation: () => true,
      };
    };
  },
});

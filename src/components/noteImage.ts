import Image from "@tiptap/extension-image";
import type { Node as PMNode } from "@tiptap/pm/model";
import { formatImageAlt, parseImageAlt } from "../utils/noteImages";
import { cachedImageUrl, isImageRef, resolveImageUrl } from "../services/noteImageStore";

/** Fired on the editor DOM when someone asks to draw on an image; NoteRichText opens the annotator. */
export const ANNOTATE_EVENT = "note-image-annotate";
export interface AnnotateDetail { pos: number; src: string }

const MIN_WIDTH = 60;
const PRESETS: Array<[label: string, title: string, fraction: number | null]> = [
  ["S", "Small (⅓ width)", 1 / 3], ["M", "Medium (½ width)", 1 / 2], ["L", "Large (¾ width)", 3 / 4], ["Full", "Full width", null],
];

function button(label: string, title: string, className = "note-image-chip") {
  const el = document.createElement("button");
  el.type = "button"; el.className = className; el.textContent = label; el.title = title; el.setAttribute("aria-label", title);
  return el;
}

/**
 * Block image whose display width round-trips through Markdown (`![alt|320](src)`), with pointer-based
 * resize handles (mouse, touch and pen), quick size presets, and a Draw button for annotating.
 */
export const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: el => Number(el.getAttribute("width")) || null, renderHTML: a => a.width ? { width: a.width } : {} },
      height: { default: null, rendered: false },
      // Stored-image references aren't URLs a browser can load: plain HTML (TipTap's first render, copying
      // between notes) carries the reference in data-src and a loadable URL, if there is one yet, in src.
      src: {
        default: null,
        parseHTML: el => el.getAttribute("data-src") || el.getAttribute("src"),
        renderHTML: a => isImageRef(a.src) ? { src: cachedImageUrl(a.src) || null, "data-src": a.src } : { src: a.src },
      },
    };
  },
  parseHTML() {
    return [{ tag: "img[data-src]" }, { tag: "img[src]" }];
  },
  parseMarkdown: (token, helpers) => {
    const { alt, width } = parseImageAlt(token.text);
    return helpers.createNode("image", { src: token.href, title: token.title || null, alt: alt || null, width });
  },
  renderMarkdown: node => {
    const alt = formatImageAlt(node.attrs?.alt, node.attrs?.width);
    const src = node.attrs?.src ?? "", title = node.attrs?.title;
    return title ? `![${alt}](${src} "${String(title).replace(/"/g, "'")}")` : `![${alt}](${src})`;
  },
  addNodeView() {
    return ({ node: initial, getPos, editor }) => {
      let node: PMNode = initial;
      const dom = document.createElement("figure");
      dom.className = "note-image";
      dom.contentEditable = "false";
      const img = document.createElement("img");
      img.draggable = false;
      img.decoding = "async";
      const frame = document.createElement("div");
      frame.className = "note-image-frame";
      frame.append(img);

      const tools = document.createElement("div");
      tools.className = "note-image-tools";
      const presetButtons = PRESETS.map(([label, title, fraction]) => {
        const b = button(label, title);
        b.addEventListener("click", () => commit(fraction == null ? null : Math.round(maxWidth() * fraction)));
        return b;
      });
      const draw = button("Draw", "Draw or annotate on this image", "note-image-chip note-image-draw");
      draw.addEventListener("click", () => {
        const pos = getPos();
        if (typeof pos === "number") dom.dispatchEvent(new CustomEvent<AnnotateDetail>(ANNOTATE_EVENT, { bubbles: true, detail: { pos, src: node.attrs.src } }));
      });
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

      const maxWidth = () => (dom.parentElement?.clientWidth || dom.clientWidth || 800);
      let shownSrc: string | null = null;
      const showSource = () => {
        const src: string = node.attrs.src || "";
        if (src === shownSrc) return;
        shownSrc = src;
        if (!isImageRef(src)) { img.src = src; dom.classList.remove("is-loading", "is-missing"); return; }
        const cached = cachedImageUrl(src);
        if (cached) { img.src = cached; dom.classList.remove("is-loading", "is-missing"); return; }
        dom.classList.add("is-loading");
        dom.classList.remove("is-missing");
        resolveImageUrl(src).then(url => { if (shownSrc === src) { img.src = url; dom.classList.remove("is-loading"); } })
          .catch(() => { if (shownSrc === src) { dom.classList.remove("is-loading"); dom.classList.add("is-missing"); img.removeAttribute("src"); } });
      };
      const apply = () => {
        showSource();
        img.alt = node.attrs.alt || "";
        if (node.attrs.title) img.title = node.attrs.title; else img.removeAttribute("title");
        frame.style.width = node.attrs.width ? `${node.attrs.width}px` : "";
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
        if (next === node.attrs.width) { apply(); return; }
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: next }));
      };

      function startResize(event: PointerEvent, side: "left" | "right") {
        if (!editor.isEditable || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const handle = event.currentTarget as HTMLElement;
        handle.setPointerCapture(event.pointerId);
        const startX = event.clientX, startWidth = frame.getBoundingClientRect().width, limit = maxWidth();
        dom.classList.add("is-resizing");
        let width = startWidth, frameRequest = 0;
        const move = (e: PointerEvent) => {
          const delta = (e.clientX - startX) * (side === "left" ? -1 : 1);
          width = Math.min(limit, Math.max(MIN_WIDTH, startWidth + delta));
          if (!frameRequest) frameRequest = requestAnimationFrame(() => { frameRequest = 0; frame.style.width = `${width}px`; });
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
        selectNode() { dom.classList.add("is-selected"); },
        deselectNode() { dom.classList.remove("is-selected"); },
        stopEvent: event => !!(event.target as HTMLElement | null)?.closest?.(".note-image-tools, .note-image-handle"),
        ignoreMutation: () => true,
      };
    };
  },
}).configure({ allowBase64: true });

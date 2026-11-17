/**
 * Images pasted into notes are stored inline as data URLs so they sync and work offline with the note.
 * Anything that shows note text to a model or a person editing raw Markdown swaps that data for a short
 * token (`note-image:1`) and swaps it back on the way in, so images never flood context or get lost.
 */
const DATA_IMAGE = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;
const TOKEN = /note-image:(\d+)/g;

export const hasInlineImages = (text: string) => text.includes("data:image/");

/** Replaces each inline image's data with `note-image:N` (1-based, in document order). */
export function hideNoteImages(text: string): string {
  if (!text || !hasInlineImages(text)) return text;
  let n = 0;
  return text.replace(DATA_IMAGE, () => `note-image:${++n}`);
}

/** Puts back the image data that `hideNoteImages(original)` replaced. Unknown tokens are left as written. */
export function restoreNoteImages(text: string, original: string): string {
  if (!text || !text.includes("note-image:") || !hasInlineImages(original)) return text;
  const images = original.match(DATA_IMAGE) || [];
  return text.replace(TOKEN, (token, n) => images[Number(n) - 1] ?? token);
}

/** Note text without image Markdown, for summaries and previews. */
export const stripNoteImages = (text: string) =>
  text.replace(/!\[[^\]]*\]\((?:data:image\/[^)\s]+|[^)\s]+)(?:\s+"[^"]*")?\)/g, " ").replace(/<img\b[^>]*>/gi, " ");

/** Alt text carries an optional display width, Obsidian-style: `![diagram|320](src)`. */
export function parseImageAlt(alt: string | null | undefined): { alt: string; width: number | null } {
  const match = /^(.*?)\|(\d{2,4})$/.exec(alt || "");
  return match ? { alt: match[1], width: Number(match[2]) } : { alt: alt || "", width: null };
}
export const formatImageAlt = (alt: string | null | undefined, width: number | null | undefined) =>
  `${(alt || "").replace(/[[\]|]/g, "")}${width ? `|${Math.round(width)}` : ""}`;

export const MAX_NOTE_IMAGE_EDGE = 1600;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const SUPPORTED = /^image\/(png|jpe?g|webp|gif|bmp|avif)$/i;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function encodeCanvas(canvas: HTMLCanvasElement, preferPng = false): string {
  const webp = canvas.toDataURL("image/webp", 0.86);
  if (webp.startsWith("data:image/webp")) return webp; // WebKit can't encode WebP and silently returns PNG.
  const png = preferPng ? canvas.toDataURL("image/png") : "";
  if (png && png.length < 1_200_000) return png;
  const context = canvas.getContext("2d");
  if (context) { // JPEG has no alpha: flatten onto white rather than black.
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "source-over";
  }
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Decodes, orients and downsizes an image for a note. Small GIFs stay as-is so they keep animating. */
export async function prepareNoteImage(file: Blob): Promise<{ src: string; width: number; height: number }> {
  if (!SUPPORTED.test(file.type)) throw new Error("Use a PNG, JPEG, WebP or GIF image.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("That image is larger than 25 MB.");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const ratio = Math.min(1, MAX_NOTE_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio)), height = Math.max(1, Math.round(bitmap.height * ratio));
    if (/gif/i.test(file.type) && file.size < 1_500_000) return { src: await readAsDataUrl(file), width: bitmap.width, height: bitmap.height };
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not process this image.");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    return { src: encodeCanvas(canvas, /png|gif|bmp/i.test(file.type)), width, height };
  } finally {
    bitmap.close();
  }
}

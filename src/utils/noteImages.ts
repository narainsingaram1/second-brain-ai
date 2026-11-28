/**
 * Notes reference images in the image store (`synapse-img:…`). Older notes may still hold inline
 * `data:image/…` images until they are next opened; anything that shows note text to a model or in raw
 * Markdown swaps that data for a short token (`note-image:1`) and back, so it never floods context.
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
const PHOTO_SUPPORTED = /^image\/(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i;
const PHOTO_EXT_FALLBACK = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i;

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));

async function decodeImageSource(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* fallback below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } catch {
    throw new Error("This image format could not be read here. Try converting it to JPEG, PNG, or WebP.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Compact image bytes from a canvas: WebP where the engine can encode it, else PNG for small screenshots, else JPEG. */
export async function canvasBlob(canvas: HTMLCanvasElement, preferPng = false): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp", 0.86);
  if (webp?.type === "image/webp") return webp; // WebKit can't encode WebP and silently returns PNG.
  const png = preferPng ? await toBlob(canvas, "image/png") : null;
  if (png && png.size < 900_000) return png;
  const context = canvas.getContext("2d");
  if (context) { // JPEG has no alpha: flatten onto white rather than black.
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "source-over";
  }
  const jpeg = await toBlob(canvas, "image/jpeg", 0.85);
  if (!jpeg) throw new Error("Your browser could not encode this image.");
  return jpeg;
}

/** Decodes, orients and downsizes an image for a note. Small GIFs stay as-is so they keep animating. */
export async function prepareNoteImage(file: Blob): Promise<Blob> {
  if (!SUPPORTED.test(file.type)) throw new Error("Use a PNG, JPEG, WebP or GIF image.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("That image is larger than 25 MB.");
  if (/gif/i.test(file.type) && file.size < 1_500_000) return file;
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const ratio = Math.min(1, MAX_NOTE_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not process this image.");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvasBlob(canvas, /png|gif|bmp/i.test(file.type));
  } finally {
    bitmap.close();
  }
}

/**
 * Decodes, EXIF-orients and downsizes a progress photo for compact durable storage, returning the
 * encoded blob along with its output pixel dimensions.
 */
export async function prepareProgressPhotoImage(file: Blob, fileName = ""): Promise<{ blob: Blob; width: number; height: number }> {
  const typeOk = file.type ? PHOTO_SUPPORTED.test(file.type) : PHOTO_EXT_FALLBACK.test(fileName);
  if (!typeOk) throw new Error("Use a PNG, JPEG, WebP, GIF, or HEIC image.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("That image is larger than 25 MB.");
  const source = await decodeImageSource(file);
  try {
    const srcW = "naturalWidth" in source ? source.naturalWidth : source.width;
    const srcH = "naturalHeight" in source ? source.naturalHeight : source.height;
    if (!srcW || !srcH) throw new Error("That image appears to be empty.");
    const ratio = Math.min(1, MAX_NOTE_IMAGE_EDGE / Math.max(srcW, srcH));
    const width = Math.max(1, Math.round(srcW * ratio));
    const height = Math.max(1, Math.round(srcH * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not process this image.");
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, width, height);
    const blob = await canvasBlob(canvas, /png|bmp/i.test(file.type));
    return { blob, width, height };
  } finally {
    if ("close" in source) source.close();
  }
}

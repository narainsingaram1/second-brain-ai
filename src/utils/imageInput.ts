import type { ImageAttachment } from "../types";

/** An image ready to send to a vision model, plus the metadata stored with the message. */
export interface PreparedImage extends ImageAttachment {
  /** Full-resolution (downscaled to MAX_IMAGE_EDGE) data URL sent to the model. Never persisted. */
  dataUrl: string;
}

export const MAX_IMAGES_PER_MESSAGE = 4;
/** Longest edge sent to models: keeps text in screenshots legible while bounding tokens and upload size. */
export const MAX_IMAGE_EDGE = 1568;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_ENCODED_CHARS = 1_600_000; // ~1.2 MB of image data per attachment
const THUMBNAIL_EDGE = 160;
const SUPPORTED = /^image\/(png|jpe?g|webp|gif|bmp|avif)$/i;

export class ImageInputError extends Error {}

function scaled(width: number, height: number, maxEdge: number) {
  const ratio = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* fall back to <img> decoding */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } catch {
    throw new ImageInputError("This image format isn’t supported. Try a PNG, JPEG or WebP screenshot.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function render(source: ImageBitmap | HTMLImageElement, width: number, height: number, opaque: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new ImageInputError("Your browser could not process this image.");
  if (opaque) {
    // JPEG has no alpha: flatten transparent screenshots onto white instead of black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

/**
 * Decodes, orients and downscales an image for a vision model. Screenshots stay PNG when that is
 * compact enough (sharper text); everything else becomes high-quality JPEG.
 */
export async function prepareImage(file: Blob, name = "image"): Promise<PreparedImage> {
  if (!SUPPORTED.test(file.type)) throw new ImageInputError(`${name} isn’t a supported image. Use PNG, JPEG, WebP or GIF.`);
  if (file.size > MAX_SOURCE_BYTES) throw new ImageInputError(`${name} is larger than 25 MB.`);
  const source = await decode(file);
  try {
    const sourceWidth = "naturalWidth" in source ? source.naturalWidth : source.width;
    const sourceHeight = "naturalHeight" in source ? source.naturalHeight : source.height;
    if (!sourceWidth || !sourceHeight) throw new ImageInputError(`${name} appears to be empty.`);
    const size = scaled(sourceWidth, sourceHeight, MAX_IMAGE_EDGE);
    let dataUrl = "";
    let mimeType = "image/jpeg";
    if (/png|gif|bmp/i.test(file.type)) {
      dataUrl = render(source, size.width, size.height, false).toDataURL("image/png");
      mimeType = "image/png";
    }
    if (!dataUrl || dataUrl.length > MAX_ENCODED_CHARS) {
      mimeType = "image/jpeg";
      const canvas = render(source, size.width, size.height, true);
      dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      if (dataUrl.length > MAX_ENCODED_CHARS) dataUrl = canvas.toDataURL("image/jpeg", 0.78);
    }
    const thumb = scaled(sourceWidth, sourceHeight, THUMBNAIL_EDGE);
    const thumbnail = render(source, thumb.width, thumb.height, true).toDataURL("image/jpeg", 0.7);
    return { id: crypto.randomUUID(), name, mimeType, width: size.width, height: size.height, thumbnail, dataUrl };
  } finally {
    if ("close" in source) source.close();
  }
}

/** Image files from a paste or drop event (screenshots arrive as unnamed clipboard files). */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files || []).filter(file => file.type.startsWith("image/"));
  if (files.length) return files;
  return Array.from(data.items || [])
    .filter(item => item.kind === "file" && item.type.startsWith("image/"))
    .map(item => item.getAsFile())
    .filter((file): file is File => !!file);
}

export function imageName(file: File, index: number): string {
  return file.name && file.name !== "image.png" ? file.name : `Screenshot ${index + 1}`;
}

/** Full images for this session, so follow-up questions can still look at them. Cleared on reload. */
const sessionImages = new Map<string, string>();
const MAX_SESSION_IMAGES = 24;
export function rememberImage(image: PreparedImage): void {
  sessionImages.delete(image.id);
  sessionImages.set(image.id, image.dataUrl);
  while (sessionImages.size > MAX_SESSION_IMAGES) sessionImages.delete(sessionImages.keys().next().value!);
}
export function sessionImage(id: string): string | undefined {
  return sessionImages.get(id);
}
export function attachmentOf({ dataUrl: _omit, ...attachment }: PreparedImage): ImageAttachment {
  return attachment;
}

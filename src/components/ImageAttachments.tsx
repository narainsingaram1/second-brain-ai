import { ClipboardEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Loader2, X } from "lucide-react";
import type { ImageAttachment } from "../types";
import { imageFilesFrom, imageName, ImageInputError, MAX_IMAGES_PER_MESSAGE, prepareImage, PreparedImage, sessionImage } from "../utils/imageInput";

/** Paste, drop and pick images for a chat composer. */
export function useImageAttachments(onError: (message: string) => void) {
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [processing, setProcessing] = useState(0);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const count = useRef(0);
  count.current = images.length;

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const room = MAX_IMAGES_PER_MESSAGE - count.current;
    if (room <= 0) { onError(`You can attach up to ${MAX_IMAGES_PER_MESSAGE} images per message.`); return; }
    const accepted = files.slice(0, room);
    if (files.length > room) onError(`Only the first ${room} image${room === 1 ? "" : "s"} were added (limit ${MAX_IMAGES_PER_MESSAGE} per message).`);
    setProcessing(n => n + accepted.length);
    await Promise.all(accepted.map(async (file, index) => {
      try {
        const prepared = await prepareImage(file, imageName(file, count.current + index));
        setImages(previous => previous.length >= MAX_IMAGES_PER_MESSAGE ? previous : [...previous, prepared]);
      } catch (err) {
        onError(err instanceof ImageInputError ? err.message : "That image couldn’t be read. Try a PNG or JPEG.");
      } finally {
        setProcessing(n => n - 1);
      }
    }));
  }, [onError]);

  const onPaste = (event: ClipboardEvent) => {
    const files = imageFilesFrom(event.clipboardData);
    if (!files.length) return; // Ordinary text paste.
    event.preventDefault();
    void addFiles(files);
  };
  const dropProps = {
    onDragOver: (event: DragEvent) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      const files = imageFilesFrom(event.dataTransfer);
      setDragging(false);
      if (!files.length) return;
      event.preventDefault();
      void addFiles(files);
    },
  };
  const picker = (
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
      onChange={event => { void addFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
  );
  return {
    images,
    processing: processing > 0,
    dragging,
    addFiles,
    remove: (id: string) => setImages(previous => previous.filter(image => image.id !== id)),
    clear: () => setImages([]),
    restore: (previous: PreparedImage[]) => setImages(previous),
    openPicker: () => input.current?.click(),
    onPaste,
    dropProps,
    picker,
  };
}

export function AttachButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="chat-icon-button" onClick={onClick} disabled={disabled} aria-label="Attach images" title="Attach images (or paste / drop a screenshot)">
    <ImagePlus size={16} />
  </button>;
}

/** Thumbnails of images waiting to be sent. */
export function AttachmentTray({ images, processing, onRemove }: { images: PreparedImage[]; processing: boolean; onRemove: (id: string) => void }) {
  if (!images.length && !processing) return null;
  return <div className="chat-attachments" aria-label="Attached images">
    {images.map(image => <figure key={image.id} className="chat-attachment">
      <img src={image.thumbnail || image.dataUrl} alt={image.name} />
      <button type="button" onClick={() => onRemove(image.id)} aria-label={`Remove ${image.name}`}><X size={12} /></button>
    </figure>)}
    {processing && <div className="chat-attachment is-loading" role="status" aria-label="Preparing image"><Loader2 size={16} className="animate-spin" /></div>}
  </div>;
}

/** Images shown on a sent message; clicking opens the full image when it is still available. */
export function MessageImages({ attachments }: { attachments: ImageAttachment[] }) {
  const [open, setOpen] = useState<ImageAttachment | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const full = open ? sessionImage(open.id) || open.thumbnail : undefined;
  return <>
    <div className="chat-message-images">
      {attachments.map(attachment => <button key={attachment.id} type="button" onClick={() => setOpen(attachment)} aria-label={`View ${attachment.name}`} title={attachment.name}>
        {attachment.thumbnail ? <img src={attachment.thumbnail} alt={attachment.name} /> : <span>{attachment.name}</span>}
      </button>)}
    </div>
    {open && full && createPortal(
      <div className="chat-image-viewer" role="dialog" aria-modal="true" aria-label={open.name} onClick={() => setOpen(null)}>
        <img src={full} alt={open.name} onClick={event => event.stopPropagation()} />
        <p>{open.name}{!sessionImage(open.id) && " · preview (full image not kept after reload)"}</p>
        <button type="button" onClick={() => setOpen(null)} aria-label="Close image"><X size={18} /></button>
      </div>,
      document.body,
    )}
  </>;
}

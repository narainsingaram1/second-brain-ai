import { ChangeEvent, ClipboardEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileSpreadsheet, FileText, ImagePlus, Loader2, Presentation, X } from "lucide-react";
import type { FileAttachment, ImageAttachment } from "../types";
import { ACCEPTED_CHAT_FILES, ChatFileError, checkChatFile, fileKindLabel, formatBytes, MAX_FILES_PER_MESSAGE } from "../utils/chatFiles";
import { imageFilesFrom, imageName, ImageInputError, MAX_IMAGES_PER_MESSAGE, prepareImage, PreparedImage, sessionImage } from "../utils/imageInput";

/** Paste, drop and pick images, and with `documents` also PDFs, Office files, CSV and text, for a chat composer. */
export function useImageAttachments(onError: (message: string) => void, { documents = false }: { documents?: boolean } = {}) {
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [processing, setProcessing] = useState(0);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const count = useRef(0), fileCount = useRef(0);
  count.current = images.length;
  fileCount.current = files.length;

  const addImages = useCallback(async (picked: File[]) => {
    if (!picked.length) return;
    const room = MAX_IMAGES_PER_MESSAGE - count.current;
    if (room <= 0) { onError(`You can attach up to ${MAX_IMAGES_PER_MESSAGE} images per message.`); return; }
    const accepted = picked.slice(0, room);
    if (picked.length > room) onError(`Only the first ${room} image${room === 1 ? "" : "s"} were added (limit ${MAX_IMAGES_PER_MESSAGE} per message).`);
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

  const addDocuments = useCallback(async (picked: File[]) => {
    if (!picked.length) return;
    const room = MAX_FILES_PER_MESSAGE - fileCount.current;
    if (room <= 0) { onError(`You can attach up to ${MAX_FILES_PER_MESSAGE} files per message.`); return; }
    const accepted = picked.slice(0, room);
    if (picked.length > room) onError(`Only the first ${room} file${room === 1 ? "" : "s"} were added (limit ${MAX_FILES_PER_MESSAGE} per message).`);
    setProcessing(n => n + accepted.length);
    await Promise.all(accepted.map(async file => {
      try {
        checkChatFile(file); // Refuse unsupported or oversized files before loading the readers.
        const { extractChatFile } = await import("../services/chatFileExtract");
        const extracted = await extractChatFile(file);
        setFiles(previous => previous.length >= MAX_FILES_PER_MESSAGE ? previous : [...previous, extracted]);
      } catch (err) {
        onError(err instanceof ChatFileError ? err.message : `${file.name} couldn’t be read. Try saving it as PDF or text.`);
      } finally {
        setProcessing(n => n - 1);
      }
    }));
  }, [onError]);

  /** Images go to the vision model; everything else is read into text. */
  const addFiles = useCallback(async (picked: File[]) => {
    const isImage = (file: File) => file.type.startsWith("image/") && file.type !== "image/svg+xml";
    const pictures = picked.filter(isImage), others = picked.filter(file => !isImage(file));
    if (others.length && !documents) onError("Only images can be attached here.");
    await Promise.all([addImages(pictures), documents ? addDocuments(others) : Promise.resolve()]);
  }, [addImages, addDocuments, documents, onError]);

  const onPaste = (event: ClipboardEvent) => {
    const pasted = documents ? Array.from(event.clipboardData?.files || []) : [];
    const picked = pasted.length ? pasted : imageFilesFrom(event.clipboardData);
    if (!picked.length) return; // Ordinary text paste.
    event.preventDefault();
    void addFiles(picked);
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
      const dropped = documents ? Array.from(event.dataTransfer.files || []) : imageFilesFrom(event.dataTransfer);
      setDragging(false);
      if (!dropped.length) return;
      event.preventDefault();
      void addFiles(dropped);
    },
  };
  const onPicked = (event: ChangeEvent<HTMLInputElement>) => { void addFiles(Array.from(event.target.files || [])); event.target.value = ""; };
  const picker = <>
    <input ref={imageInput} type="file" accept={IMAGE_TYPES} multiple hidden data-testid="image-input" onChange={onPicked} />
    {documents && <input ref={input} type="file" accept={`${ACCEPTED_CHAT_FILES},${IMAGE_TYPES}`} multiple hidden data-testid="file-input" onChange={onPicked} />}
  </>;
  return {
    images,
    files,
    processing: processing > 0,
    dragging,
    addFiles,
    remove: (id: string) => { setImages(previous => previous.filter(image => image.id !== id)); setFiles(previous => previous.filter(file => file.id !== id)); },
    clear: () => { setImages([]); setFiles([]); },
    restore: (previous: PreparedImage[], previousFiles: FileAttachment[] = []) => { setImages(previous); setFiles(previousFiles); },
    /** Any file the composer accepts; images only when documents are off. */
    openPicker: () => (documents ? input : imageInput).current?.click(),
    openImagePicker: () => imageInput.current?.click(),
    onPaste,
    dropProps,
    picker,
  };
}
const IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif";

export function AttachButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="chat-icon-button" onClick={onClick} disabled={disabled} aria-label="Attach images" title="Attach images (or paste / drop a screenshot)">
    <ImagePlus size={16} />
  </button>;
}

/** Thumbnails of images, and chips for documents, waiting to be sent. */
export function AttachmentTray({ images, files = [], processing, onRemove }: { images: PreparedImage[]; files?: FileAttachment[]; processing: boolean; onRemove: (id: string) => void }) {
  if (!images.length && !files.length && !processing) return null;
  return <div className="chat-attachments" aria-label="Attachments">
    {images.map(image => <figure key={image.id} className="chat-attachment">
      <img src={image.thumbnail || image.dataUrl} alt={image.name} />
      <button type="button" onClick={() => onRemove(image.id)} aria-label={`Remove ${image.name}`}><X size={12} /></button>
    </figure>)}
    {files.map(file => <FileChip key={file.id} file={file} onRemove={() => onRemove(file.id)} />)}
    {processing && <div className="chat-attachment is-loading" role="status" aria-label="Reading attachment"><Loader2 size={16} className="animate-spin" /></div>}
  </div>;
}

function FileIcon({ file }: { file: FileAttachment }) {
  const Icon = file.kind === "xlsx" || file.kind === "csv" ? FileSpreadsheet : file.kind === "pptx" ? Presentation : FileText;
  return <span className={`chat-file-icon is-${file.kind}`} aria-hidden="true"><Icon size={16} strokeWidth={1.8} /></span>;
}

/** One attached document: name, type and size, with a remove button while it is still in the composer. */
export function FileChip({ file, onRemove }: { file: FileAttachment; onRemove?: () => void }) {
  const detail = [fileKindLabel(file), formatBytes(file.size), file.pages ? `${file.pages} ${file.kind === "xlsx" ? "sheet" : file.kind === "pptx" ? "slide" : "page"}${file.pages === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  return <div className="chat-file-chip" title={`${file.name}${file.truncated ? " · long document, only the first part is read" : ""}`}>
    <FileIcon file={file} />
    <span className="chat-file-text"><strong>{file.name}</strong><span>{detail}{file.truncated ? " · partly read" : ""}</span></span>
    {onRemove && <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`}><X size={12} /></button>}
  </div>;
}

/** Documents shown on a sent message. */
export function MessageFiles({ files }: { files: FileAttachment[] }) {
  return <div className="chat-message-files">{files.map(file => <FileChip key={file.id} file={file} />)}</div>;
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

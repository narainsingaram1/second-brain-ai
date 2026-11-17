import { getSupabase, managedAuthEnabled } from "./managedAuth";

/**
 * Images in notes live outside the note text, so autosaves stay small however many images a note holds.
 * - A note stores a short reference: `synapse-img:<content hash>.<ext>`. The same image is stored once.
 * - IndexedDB keeps the bytes on this device; with managed accounts a private bucket copies them to
 *   other devices. Uploads that fail (offline) are retried later.
 * - Object URLs are cached in memory so rendering a reference is synchronous after the first load.
 */
export const IMAGE_REF = "synapse-img:";
const REF_PATTERN = /synapse-img:([a-f0-9]{32}\.(?:webp|png|jpg|gif))/g;
const BUCKET = "note-images";
const MIME: Record<string, string> = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", gif: "image/gif" };
const EXT: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" };

export const isImageRef = (src: unknown): src is string => typeof src === "string" && src.startsWith(IMAGE_REF);
export const imageRefsIn = (text: string) => [...new Set(Array.from(text.matchAll(REF_PATTERN), m => m[1]))];

let database: Promise<IDBDatabase> | undefined;
const STORES = ["images", "pending"];
function openDatabase(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("synapse_note_images_v1", version);
    request.onupgradeneeded = () => { for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
    request.onsuccess = () => {
      const db = request.result;
      if (STORES.every(name => db.objectStoreNames.contains(name))) return resolve(db);
      // Created elsewhere without our stores (e.g. an interrupted first open): add them in a new version.
      const next = db.version + 1;
      db.close();
      openDatabase(next).then(resolve, reject);
    };
    request.onerror = () => reject(request.error);
  });
}
function localDatabase(): Promise<IDBDatabase> {
  return database ??= openDatabase().catch(error => { database = undefined; throw error; });
}
async function idb<T>(store: "images" | "pending", mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  const db = await localDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = run(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Image storage was interrupted."));
  });
}

const urls = new Map<string, string>();
const loading = new Map<string, Promise<string>>();

async function account(): Promise<string | null> {
  if (!managedAuthEnabled) return null;
  try { return (await getSupabase().auth.getSession()).data.session?.user.id ?? null; } catch { return null; }
}

async function upload(key: string, blob: Blob): Promise<boolean> {
  const user = await account();
  if (!user) return !managedAuthEnabled; // Local-only installs have nothing to upload.
  const { error } = await getSupabase().storage.from(BUCKET).upload(`${user}/${key}`, blob, { contentType: blob.type, upsert: false });
  return !error || /exists|duplicate/i.test(error.message); // Content-addressed: an existing copy is the same image.
}

/** Stores an image and returns its reference. The image shows immediately; the cloud copy follows. */
export async function storeNoteImage(blob: Blob): Promise<string> {
  const ext = EXT[blob.type];
  if (!ext) throw new Error("Use a PNG, JPEG, WebP or GIF image.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  const key = `${Array.from(digest.subarray(0, 16), b => b.toString(16).padStart(2, "0")).join("")}.${ext}`;
  if (!urls.has(key)) urls.set(key, URL.createObjectURL(blob));
  const known = await idb<Blob>("images", "readonly", s => s.get(key)).catch(() => undefined);
  if (!known) {
    await idb("images", "readwrite", s => s.put(blob, key));
    await idb("pending", "readwrite", s => s.put(Date.now(), key));
    void upload(key, blob).then(done => done && idb("pending", "readwrite", s => s.delete(key))).catch(() => {});
  }
  return IMAGE_REF + key;
}

/** Synchronous URL for a reference that is already loaded on this device. */
export const cachedImageUrl = (ref: string) => urls.get(ref.slice(IMAGE_REF.length));

/** A displayable URL for a reference: memory, then this device, then the cloud copy. */
export function resolveImageUrl(ref: string): Promise<string> {
  if (!isImageRef(ref)) return Promise.resolve(ref);
  const key = ref.slice(IMAGE_REF.length);
  const cached = urls.get(key);
  if (cached) return Promise.resolve(cached);
  let pending = loading.get(key);
  if (!pending) {
    pending = (async () => {
      let blob = await idb<Blob>("images", "readonly", s => s.get(key)).catch(() => undefined);
      if (!blob) {
        const user = await account();
        if (!user) throw new Error("This image is not on this device.");
        const { data, error } = await getSupabase().storage.from(BUCKET).download(`${user}/${key}`);
        if (error || !data) throw new Error("Could not download this image.");
        blob = data.type ? data : new Blob([data], { type: MIME[key.split(".").pop()!] });
        await idb("images", "readwrite", s => s.put(blob, key)).catch(() => {});
      }
      const url = URL.createObjectURL(blob);
      urls.set(key, url);
      return url;
    })().finally(() => loading.delete(key));
    loading.set(key, pending);
  }
  return pending;
}

/** The stored bytes for a reference, for export and annotation. */
export async function imageBlob(ref: string): Promise<Blob> {
  return (await fetch(await resolveImageUrl(ref))).blob();
}

/** Uploads images saved while offline or before sign-in finished. */
export async function retryPendingImageUploads(): Promise<void> {
  if (!managedAuthEnabled) return;
  const keys = await idb<IDBValidKey[]>("pending", "readonly", s => s.getAllKeys()).catch(() => undefined);
  for (const key of keys || []) {
    const blob = await idb<Blob>("images", "readonly", s => s.get(key)).catch(() => undefined);
    if (!blob) { await idb("pending", "readwrite", s => s.delete(key)).catch(() => {}); continue; }
    if (await upload(String(key), blob).catch(() => false)) await idb("pending", "readwrite", s => s.delete(key)).catch(() => {});
  }
}

const dataUrlToBlob = async (dataUrl: string) => (await fetch(dataUrl)).blob();
const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/** Moves inline `data:image/...` images in Markdown into the store, returning the rewritten text. */
export async function externalizeInlineImages(markdown: string): Promise<string> {
  const found = markdown.match(/data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+/gi);
  if (!found) return markdown;
  let out = markdown;
  for (const dataUrl of new Set(found)) {
    try { out = out.split(dataUrl).join(await storeNoteImage(await dataUrlToBlob(dataUrl))); } catch { /* Leave that one inline. */ }
  }
  return out;
}

/** Replaces references with inline data, for Markdown that leaves the app (export, copy). */
export async function inlineImageRefs(markdown: string): Promise<string> {
  let out = markdown;
  for (const key of imageRefsIn(markdown)) {
    try { out = out.split(IMAGE_REF + key).join(await blobToDataUrl(await imageBlob(IMAGE_REF + key))); } catch { /* Keep the reference. */ }
  }
  return out;
}

if (typeof window !== "undefined") window.addEventListener("online", () => void retryPendingImageUploads());

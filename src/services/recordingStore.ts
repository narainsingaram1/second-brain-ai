/**
 * Device storage for recordings in progress. Audio is kept here only until it is transcribed; the transcript
 * then moves into the note (which syncs) and the recording is removed.
 * - `sessions`: one small record per recording (status and transcribed parts).
 * - `chunks`: ~1 s of 16-bit PCM each, keyed [sessionId, first sample], so a part's audio is one range read.
 */
export type SegmentStatus = "pending" | "done" | "silent" | "failed";
export interface RecordingSegment {
  index: number;
  startSample: number;
  endSample: number;
  status: SegmentStatus;
  text?: string;
  error?: string;
  attempts: number;
  /** Loudest 100 ms in the part; very quiet parts are not sent. Missing when recovered after a crash. */
  peak?: number;
}
export type SessionStatus = "recording" | "paused" | "processing";
export interface RecordingSession {
  id: string;
  noteId: string;
  /** The note was created for this recording, so the generated title may replace its placeholder. */
  autoTitle: boolean;
  status: SessionStatus;
  source: "mic" | "mic+system";
  deviceId?: string;
  createdAt: string;
  updatedAt: string;
  /** Samples stored so far, and the sample up to which audio has been split into parts. */
  totalSamples: number;
  cutSample: number;
  segments: RecordingSegment[];
  /** The app closed or the microphone went away while recording. */
  interrupted?: boolean;
}
export interface AudioChunk { sessionId: string; start: number; pcm: ArrayBuffer; levels: number[] }

const NAME = "synapse_recordings_v1";
let opened: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      const d = request.result;
      if (!d.objectStoreNames.contains("sessions")) d.createObjectStore("sessions", { keyPath: "id" });
      if (!d.objectStoreNames.contains("chunks")) d.createObjectStore("chunks", { keyPath: ["sessionId", "start"] });
    };
    request.onsuccess = () => {
      // Another tab upgrading later must not be blocked by this connection.
      request.result.onversionchange = () => { request.result.close(); opened = undefined; };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Recording storage is busy in another tab."));
  }).catch(error => { opened = undefined; throw error; });
}

async function run<T>(stores: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  const tx = (await db()).transaction(stores, mode, mode === "readwrite" ? { durability: "strict" } : undefined);
  return new Promise<T>((resolve, reject) => {
    const request = body(tx);
    tx.oncomplete = () => resolve(request ? request.result : (undefined as T));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Saving the recording was interrupted."));
  });
}

const chunkRange = (sessionId: string, from: number, to: number) => IDBKeyRange.bound([sessionId, from], [sessionId, to], false, true);

export const recordingStore = {
  sessions: () => run<RecordingSession[]>(["sessions"], "readonly", tx => tx.objectStore("sessions").getAll()),
  saveSession: (session: RecordingSession) => run(["sessions"], "readwrite", tx => { tx.objectStore("sessions").put(session); }),
  saveChunk: (chunk: AudioChunk) => run(["chunks"], "readwrite", tx => { tx.objectStore("chunks").put(chunk); }),
  /** Chunks that overlap [from, to), in order. Chunks are at most CHUNK_SAMPLES long. */
  chunks: (sessionId: string, from: number, to: number, maxChunk: number) =>
    run<AudioChunk[]>(["chunks"], "readonly", tx => tx.objectStore("chunks").getAll(chunkRange(sessionId, Math.max(0, from - maxChunk + 1), to))),
  /** The last chunk stored, to recover the length of a recording cut off by a crash. */
  lastChunk: async (sessionId: string) => {
    let last: AudioChunk | undefined;
    await run(["chunks"], "readonly", tx => {
      const request = tx.objectStore("chunks").openCursor(chunkRange(sessionId, 0, Number.MAX_SAFE_INTEGER), "prev");
      request.onsuccess = () => { last = request.result?.value; };
    });
    return last;
  },
  /** Removes audio that ends before `before` (already transcribed). */
  dropChunksBefore: (sessionId: string, before: number, maxChunk: number) => before - maxChunk < 0 ? Promise.resolve()
    : run(["chunks"], "readwrite", tx => { tx.objectStore("chunks").delete(IDBKeyRange.bound([sessionId, 0], [sessionId, before - maxChunk])); }),
  deleteSession: (sessionId: string) => run(["sessions", "chunks"], "readwrite", tx => {
    tx.objectStore("sessions").delete(sessionId);
    tx.objectStore("chunks").delete(chunkRange(sessionId, 0, Number.MAX_SAFE_INTEGER));
  }),
};

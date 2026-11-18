// A real file (never an inlined data: URL), which the desktop app's content security policy allows.
import workletUrl from "./recorderWorklet.js?url&no-inline";
import type { KnowledgeItem } from "../types";
import { providerFetch } from "./providerTransport";
import { providerErrorMessage, queryOpenRouter } from "./openrouter";
import { stripNoteImages } from "../utils/noteImages";
import { recordingStore, type RecordingSegment, type RecordingSession } from "./recordingStore";
import {
  appendTranscript, assembleNotes, CHUNK_SAMPLES, cleanTranscription, encodeWav, findCut, formatClock, formatTranscript, FRAME_SAMPLES,
  notesPrompt, NOTES_SYSTEM, overviewPrompt, partNotesPrompt, SAMPLE_RATE, SILENT_PEAK, SINGLE_PASS_CHARS, splitTitle, splitTranscript,
  toBase64, transcribeContext,
} from "../utils/recording";

/**
 * Records lectures and meetings into notes, built to survive long sessions and crashes.
 *
 * Audio path: microphone (and optionally tab/system audio) → AudioWorklet (mono, 16 kHz, 16-bit) → a chunk
 * per second written to IndexedDB. Nothing accumulates in memory, so a two-hour lecture costs the same as
 * a two-minute one, and a closed tab loses at most the last second.
 *
 * As audio arrives it is split into 40–75 s parts that end in a pause, and each part is transcribed in the
 * background (up to three at once) while recording continues. A part's audio is deleted once it has been
 * transcribed, so storage stays small. Failed parts retry with backoff and wait out being offline or having
 * no AI key; their audio is kept until they succeed.
 *
 * Finishing waits for the last parts, saves the transcript into the note, then writes detailed notes from
 * it (in sections for very long recordings). A Web Lock per recording means only one tab works on it; a
 * recording whose tab died is found on the next start and offered to resume.
 */

export const DEFAULT_TRANSCRIPTION_MODEL = "google/gemini-3.8-flash";
export const TRANSCRIPTION_MODELS = [
  { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash", desc: "Recommended: fast, accurate and inexpensive" },
  { id: "openai/gpt-4o-audio-preview", name: "GPT-4o Audio", desc: "Alternative audio model" },
];
const MODEL_KEY = "synapse_transcription_model";
export function getTranscriptionModel(): string {
  try { return localStorage.getItem(MODEL_KEY) || DEFAULT_TRANSCRIPTION_MODEL; } catch { return DEFAULT_TRANSCRIPTION_MODEL; }
}
export function setTranscriptionModel(model: string): void {
  try { localStorage.setItem(MODEL_KEY, model.trim() || DEFAULT_TRANSCRIPTION_MODEL); } catch { /* Preference only. */ }
}

export type AudioSource = "mic" | "mic+system";
export const canCaptureSystemAudio = () => typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
export const canRecord = () => typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof AudioWorkletNode !== "undefined";

export interface RecorderDeps {
  apiKey?: string;
  model?: string;
  getNote(id: string): KnowledgeItem | undefined;
  updateNote(id: string, change: (note: KnowledgeItem) => KnowledgeItem): void;
  createNote(note: KnowledgeItem): void;
}

export interface SessionView extends RecordingSession {
  ownedHere: boolean;
  seconds: number;
  done: number;
  pending: number;
  failed: number;
  /** The most recent transcribed text, for the live preview. */
  recent: { at: string; text: string }[];
}
export interface GenerationView { noteId: string; stage: string; words: number; error?: string; running: boolean; previous?: string }
export interface RecorderSnapshot {
  ready: boolean;
  liveId?: string;
  /** Why transcription is waiting (no key, offline), shown on every recording. */
  blocked?: string;
  sessions: SessionView[];
  generations: GenerationView[];
  /** The note open in the editor, where the full recorder shows (the floating indicator hides for it). */
  viewing?: string;
}

interface Live {
  id: string;
  context: AudioContext;
  node: AudioWorkletNode;
  streams: MediaStream[];
  frames: Int16Array[];
  frameLevels: number[];
  /** Loudness per 100 ms since the current part began (only audio already stored). */
  partLevels: number[];
  wakeLock?: WakeLockSentinel;
  onStopped?: () => void;
  closed?: boolean;
}

const MAX_PARALLEL = 3;
const MAX_ATTEMPTS = 4;
const RETRY_SECONDS = [5, 20, 60];
const PLACEHOLDER_TITLE = /^(untitled( note)?|recording ·.*|new recording)$/i;
const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error)) || "Something went wrong.";

function micError(error: unknown): Error {
  const name = (error as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return new Error("Microphone access is blocked. Allow it for this site in your browser (or in System Settings → Privacy & Security → Microphone for the desktop app), then try again.");
  if (name === "NotFoundError" || name === "OverconstrainedError") return new Error("No microphone was found. Connect one and try again.");
  if (name === "NotReadableError") return new Error("The microphone is in use by another app or couldn't be opened.");
  return error instanceof Error ? error : new Error("Couldn't start the microphone.");
}

class LectureRecorder {
  private deps?: RecorderDeps;
  private sessions = new Map<string, RecordingSession>();
  private owned = new Set<string>();
  private releasers = new Map<string, () => void>();
  private live?: Live;
  private inflight = new Set<string>();
  private retryAt = new Map<string, number>();
  private generations = new Map<string, GenerationView>();
  private finishing = new Set<string>();
  private writes: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private levelListeners = new Set<(level: number) => void>();
  private snapshot: RecorderSnapshot = { ready: false, sessions: [], generations: [] };
  private blocked?: string;
  private started = false;
  private ready = false;
  private viewing?: string;
  level = 0;

  setViewing(noteId: string | undefined) {
    if (this.viewing === noteId) return;
    this.viewing = noteId;
    this.emit();
  }

  // ---- Subscription -------------------------------------------------------------------------------
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  subscribeLevel(listener: (level: number) => void) { this.levelListeners.add(listener); return () => { this.levelListeners.delete(listener); }; }

  private emit() {
    this.snapshot = {
      ready: this.ready,
      viewing: this.viewing,
      liveId: this.live?.id,
      blocked: this.blocked,
      generations: [...this.generations.values()].map(g => ({ ...g })),
      sessions: [...this.sessions.values()].map(s => {
        const count = (status: RecordingSegment["status"]) => s.segments.filter(p => p.status === status).length;
        return {
          ...s, segments: [...s.segments], ownedHere: this.owned.has(s.id), seconds: s.totalSamples / SAMPLE_RATE,
          done: count("done") + count("silent"), pending: count("pending") + (s.status !== "processing" && s.totalSamples > s.cutSample ? 1 : 0), failed: count("failed"),
          recent: s.segments.filter(p => p.status === "done" && p.text).slice(-3).map(p => ({ at: formatClock(p.startSample / SAMPLE_RATE), text: p.text! })),
        };
      }),
    };
    for (const listener of this.listeners) listener();
  }

  // ---- Setup and recovery -------------------------------------------------------------------------
  configure(deps: RecorderDeps) {
    const hadKey = !!this.deps?.apiKey;
    this.deps = deps;
    if (!this.started) { this.started = true; void this.recoverAll(); }
    else if (!hadKey && deps.apiKey) this.pump();
  }

  private lock(id: string, wait = false): Promise<boolean> {
    if (this.owned.has(id)) return Promise.resolve(true);
    if (typeof navigator === "undefined" || !navigator.locks) { this.owned.add(id); return Promise.resolve(true); }
    return new Promise(resolve => {
      navigator.locks.request(`synapse-recording:${id}`, wait ? {} : { ifAvailable: true }, lock => {
        if (!lock) { resolve(false); return; }
        this.owned.add(id);
        resolve(true);
        return new Promise<void>(release => this.releasers.set(id, release));
      }).catch(() => resolve(false));
    });
  }
  private unlock(id: string) {
    this.owned.delete(id);
    this.releasers.get(id)?.();
    this.releasers.delete(id);
  }

  private async recoverAll() {
    let stored: RecordingSession[] = [];
    try { stored = await recordingStore.sessions(); } catch { /* Storage unavailable: recording will report it. */ }
    for (const session of stored) {
      this.sessions.set(session.id, session);
      if (await this.lock(session.id)) await this.recover(session);
      else void this.lock(session.id, true).then(async () => {
        // The tab that had it closed: take it over from what it stored.
        const latest = (await recordingStore.sessions().catch(() => [])).find(s => s.id === session.id);
        if (!latest) { this.sessions.delete(session.id); this.unlock(session.id); this.emit(); return; }
        this.sessions.set(latest.id, latest);
        await this.recover(latest);
        this.emit();
        this.pump();
      });
    }
    this.ready = true;
    this.emit();
    this.pump();
  }

  /** Brings a recording left by a closed tab back to a consistent, paused state. */
  private async recover(s: RecordingSession) {
    const last = await recordingStore.lastChunk(s.id).catch(() => undefined);
    if (last) s.totalSamples = Math.max(s.totalSamples, last.start + last.pcm.byteLength / 2);
    if (s.status === "recording") { s.status = "paused"; s.interrupted = true; }
    this.closePart(s, []);
    if (!s.totalSamples && !s.segments.length) { await this.removeSession(s.id); return; }
    this.save(s);
    if (s.status === "processing") this.checkFinished(s);
  }

  // ---- Recording ----------------------------------------------------------------------------------
  sessionFor(noteId: string) { return [...this.sessions.values()].find(s => s.noteId === noteId); }

  /** Starts recording into a note, or resumes that note's paused recording. Call from a click. */
  async start(noteId: string, opts: { source?: AudioSource; deviceId?: string; autoTitle?: boolean } = {}) {
    const existing = this.sessionFor(noteId);
    if (existing) return this.resume(existing.id, opts);
    if (this.live) throw new Error("Another recording is running. Pause or finish it first.");
    const source = opts.source || "mic";
    const streams = await this.openStreams(source, opts.deviceId);
    const now = new Date().toISOString();
    const s: RecordingSession = { id: crypto.randomUUID(), noteId, autoTitle: !!opts.autoTitle, status: "recording", source, deviceId: opts.deviceId,
      createdAt: now, updatedAt: now, totalSamples: 0, cutSample: 0, segments: [] };
    try {
      await this.lock(s.id);
      this.sessions.set(s.id, s);
      await recordingStore.saveSession(s);
      await this.attach(s, streams);
    } catch (error) {
      streams.forEach(stream => stream.getTracks().forEach(t => t.stop()));
      this.sessions.delete(s.id);
      this.unlock(s.id);
      void recordingStore.deleteSession(s.id).catch(() => {});
      this.emit();
      throw error;
    }
    // Ask the browser not to evict recordings under storage pressure.
    void navigator.storage?.persist?.().catch(() => false);
  }

  async resume(id: string, opts: { source?: AudioSource; deviceId?: string } = {}) {
    const s = this.sessions.get(id);
    if (!s) throw new Error("That recording no longer exists.");
    if (this.live?.id === id) return;
    if (this.live) throw new Error("Another recording is running. Pause or finish it first.");
    if (s.status === "processing") throw new Error("This recording is already finished.");
    const streams = await this.openStreams(opts.source || s.source, opts.deviceId ?? s.deviceId);
    if (!(await this.lock(id))) {
      streams.forEach(stream => stream.getTracks().forEach(t => t.stop()));
      throw new Error("This recording is open in another tab or window.");
    }
    s.source = opts.source || s.source;
    if (opts.deviceId !== undefined) s.deviceId = opts.deviceId;
    s.interrupted = false;
    try { await this.attach(s, streams); }
    catch (error) { streams.forEach(stream => stream.getTracks().forEach(t => t.stop())); throw error; }
  }

  private async openStreams(source: AudioSource, deviceId?: string): Promise<MediaStream[]> {
    if (!canRecord()) throw new Error("This browser can't record audio. Try Chrome, Edge, Safari or the desktop app.");
    // Screen-share audio must be requested first, while the click still counts as a user gesture.
    const display = source === "mic+system" && canCaptureSystemAudio()
      ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, ...({ systemAudio: "include" } as object) } as DisplayMediaStreamOptions)
      : undefined;
    const constraints = (id?: string): MediaStreamConstraints => ({ audio: { ...(id ? { deviceId: { exact: id } } : {}), channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mic = navigator.mediaDevices.getUserMedia(constraints(deviceId))
      .catch(error => deviceId && (error as DOMException)?.name === "OverconstrainedError" ? navigator.mediaDevices.getUserMedia(constraints()) : Promise.reject(error));
    const [micResult, displayResult] = await Promise.allSettled([mic, display ?? Promise.resolve(undefined)]);
    const stopAll = () => [micResult, displayResult].forEach(r => r.status === "fulfilled" && r.value?.getTracks().forEach(t => t.stop()));
    if (micResult.status === "rejected") { stopAll(); throw micError(micResult.reason); }
    if (displayResult.status === "rejected") { stopAll(); throw new Error((displayResult.reason as DOMException)?.name === "NotAllowedError" ? "Screen sharing was cancelled, so tab audio can't be recorded." : "Couldn't capture tab or system audio."); }
    const streams = [micResult.value];
    const shared = displayResult.value;
    if (shared) {
      shared.getVideoTracks().forEach(t => t.stop());
      if (!shared.getAudioTracks().length) { stopAll(); throw new Error("No audio was shared. Choose the tab or screen again and turn on “Share audio”."); }
      streams.push(new MediaStream(shared.getAudioTracks()));
    }
    return streams;
  }

  private async attach(s: RecordingSession, streams: MediaStream[]) {
    const context = new AudioContext({ latencyHint: "playback" });
    try {
      await context.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(context, "synapse-recorder", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers",
        processorOptions: { targetRate: SAMPLE_RATE, frameSamples: FRAME_SAMPLES },
      });
      for (const stream of streams) context.createMediaStreamSource(stream).connect(node);
      // The worklet only runs while connected to the output; a silent gain keeps it running without playback.
      const mute = context.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(context.destination);
      const live: Live = { id: s.id, context, node, streams, frames: [], frameLevels: [], partLevels: [] };
      node.port.onmessage = event => this.onFrame(live, event.data);
      for (const stream of streams) for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => this.onTrackEnded(live, stream));
      // Safari suspends audio when interrupted (a call, another app taking the mic); pick back up when allowed.
      context.onstatechange = () => { if (!live.closed && context.state !== "running" && context.state !== "closed") void context.resume().catch(() => {}); };
      await context.resume();
      this.live = live;
      s.status = "recording";
      s.updatedAt = new Date().toISOString();
      this.save(s);
      void this.keepAwake(live);
      this.emit();
    } catch (error) {
      void context.close().catch(() => {});
      throw error instanceof Error && /addModule|worklet/i.test(error.message) ? new Error("Couldn't start the audio recorder in this browser.") : error;
    }
  }

  private onFrame(live: Live, data: { pcm?: Int16Array; rms?: number; done?: boolean }) {
    if (data.done) { live.onStopped?.(); return; }
    if (!data.pcm) return;
    live.frames.push(data.pcm);
    live.frameLevels.push(data.rms || 0);
    this.level = data.rms || 0;
    for (const listener of this.levelListeners) listener(this.level);
    if (live.frames.length * FRAME_SAMPLES >= CHUNK_SAMPLES) this.flushChunk(live);
  }

  /** Writes the frames gathered so far as one chunk and starts a new part at a pause. */
  private flushChunk(live: Live) {
    const s = this.sessions.get(live.id);
    if (!s || !live.frames.length) return;
    const length = live.frames.reduce((n, f) => n + f.length, 0);
    const pcm = new Int16Array(length);
    let at = 0;
    for (const frame of live.frames) { pcm.set(frame, at); at += frame.length; }
    const levels = live.frameLevels;
    live.frames = [];
    live.frameLevels = [];
    const start = s.totalSamples;
    s.totalSamples += length;
    live.partLevels.push(...levels);
    this.write(() => recordingStore.saveChunk({ sessionId: s.id, start, pcm: pcm.buffer, levels }));
    const cut = findCut(live.partLevels);
    if (cut >= 0) {
      this.addPart(s, s.cutSample + cut * FRAME_SAMPLES, live.partLevels.slice(0, cut));
      live.partLevels = live.partLevels.slice(cut);
    }
    this.emit();
  }

  private addPart(s: RecordingSession, end: number, levels: number[]) {
    const peak = levels.length ? levels.reduce((m, v) => (v > m ? v : m), 0) : undefined;
    s.segments.push({ index: s.segments.length, startSample: s.cutSample, endSample: end, attempts: 0, peak,
      status: peak !== undefined && peak < SILENT_PEAK ? "silent" : "pending" });
    s.cutSample = end;
    this.save(s);
    this.pump();
  }

  /** Makes the audio not yet in a part into the last part (on pause, finish or recovery). */
  private closePart(s: RecordingSession, levels: number[]) {
    if (s.totalSamples - s.cutSample >= SAMPLE_RATE / 2) this.addPart(s, s.totalSamples, levels);
    else s.cutSample = s.totalSamples;
  }

  private async stopAudio(live: Live) {
    // The worklet sends its last partial frame, then confirms.
    await new Promise<void>(resolve => {
      live.onStopped = resolve;
      try { live.node.port.postMessage("stop"); } catch { resolve(); }
      setTimeout(resolve, 800);
    });
    this.flushChunk(live);
    live.closed = true;
    live.node.port.onmessage = null;
    try { live.node.disconnect(); } catch { /* Already disconnected. */ }
    live.streams.forEach(stream => stream.getTracks().forEach(t => t.stop()));
    void live.context.close().catch(() => {});
    void live.wakeLock?.release().catch(() => {});
    if (this.live === live) this.live = undefined;
    this.level = 0;
    for (const listener of this.levelListeners) listener(0);
  }

  async pause(id: string, notice?: string) {
    const live = this.live;
    const s = this.sessions.get(id);
    if (!s || !live || live.id !== id) return;
    await this.stopAudio(live);
    this.closePart(s, live.partLevels);
    s.status = "paused";
    s.interrupted = !!notice;
    s.updatedAt = new Date().toISOString();
    this.save(s);
    this.emit();
    if (notice) this.notify(notice);
  }

  private onTrackEnded(live: Live, stream: MediaStream) {
    if (live.closed || this.live !== live) return;
    const remaining = live.streams.filter(st => st !== stream && st.getAudioTracks().some(t => t.readyState === "live"));
    const micEnded = stream === live.streams[0];
    if (micEnded || !remaining.length) void this.pause(live.id, "The microphone disconnected, so recording paused. Resume when it's back.");
    else this.notify("Tab audio stopped being shared; still recording the microphone.");
  }

  private notify(message: string) { window.dispatchEvent(new CustomEvent("synapse-recorder-notice", { detail: message })); }

  private async keepAwake(live: Live) {
    try { if (!live.closed && document.visibilityState === "visible") live.wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* Not supported or not allowed. */ }
  }

  /** Stops recording (if running) and turns the recording into a transcript and notes. */
  async finish(id: string) {
    if (this.live?.id === id) await this.pause(id);
    const s = this.sessions.get(id);
    if (!s) return;
    s.status = "processing";
    s.interrupted = false;
    s.updatedAt = new Date().toISOString();
    this.save(s);
    this.emit();
    this.pump();
    this.checkFinished(s);
  }

  /** Deletes a recording and its audio without touching the note. */
  async discard(id: string) {
    const live = this.live?.id === id ? this.live : undefined;
    // Forget it first so the last second of audio isn't stored or sent for transcription.
    this.sessions.delete(id);
    if (live) await this.stopAudio(live);
    await this.removeSession(id);
  }

  private async removeSession(id: string) {
    this.sessions.delete(id);
    for (const key of [...this.retryAt.keys()]) if (key.startsWith(`${id}:`)) this.retryAt.delete(key);
    await this.writes.catch(() => {});
    await recordingStore.deleteSession(id).catch(() => {});
    this.unlock(id);
    this.emit();
  }

  // ---- Persistence --------------------------------------------------------------------------------
  /** Writes happen one at a time in order, so a session never refers to audio that isn't stored yet. */
  private write(task: () => Promise<unknown>) {
    this.writes = this.writes.then(task).catch(error => this.onWriteError(error));
  }
  private save(s: RecordingSession) {
    const copy = { ...s, segments: s.segments.map(p => ({ ...p })) };
    this.write(() => this.sessions.has(s.id) ? recordingStore.saveSession(copy) : Promise.resolve());
  }
  private onWriteError(error: unknown) {
    const full = (error as DOMException)?.name === "QuotaExceededError";
    if (this.live) void this.pause(this.live.id, full ? "This device is out of storage, so recording paused. Free up space, then resume." : "Recording paused: audio couldn't be saved on this device.");
    else this.notify(full ? "This device is out of storage for recordings." : "A recording couldn't be saved on this device.");
  }

  // ---- Transcription ------------------------------------------------------------------------------
  private pump() {
    const key = this.deps?.apiKey;
    const blocked = !key ? "Add an AI key in Settings to transcribe. Your audio is saved on this device until then."
      : typeof navigator !== "undefined" && navigator.onLine === false ? "Offline. Transcription continues when you're back online; audio is saved on this device." : undefined;
    if (blocked !== this.blocked) { this.blocked = blocked; this.emit(); }
    for (const s of this.sessions.values()) {
      if (!this.owned.has(s.id)) continue;
      if (!blocked) for (const part of s.segments) {
        if (this.inflight.size >= MAX_PARALLEL) return;
        const id = `${s.id}:${part.index}`;
        if (part.status !== "pending" || this.inflight.has(id) || (this.retryAt.get(id) || 0) > Date.now()) continue;
        this.inflight.add(id);
        void this.runPart(s, part, id);
      }
      this.checkFinished(s);
    }
  }

  private async runPart(s: RecordingSession, part: RecordingSegment, id: string) {
    try {
      const text = await this.transcribe(s, part);
      part.text = text;
      part.status = text ? "done" : "silent";
      part.error = undefined;
      this.retryAt.delete(id);
    } catch (error) {
      part.attempts += 1;
      part.error = describeError(error);
      if (part.attempts >= MAX_ATTEMPTS || /missing/i.test(part.error)) part.status = "failed";
      else {
        const delay = RETRY_SECONDS[Math.min(part.attempts - 1, RETRY_SECONDS.length - 1)] * 1000;
        this.retryAt.set(id, Date.now() + delay);
        setTimeout(() => this.pump(), delay + 50);
      }
    } finally {
      this.inflight.delete(id);
    }
    if (!this.sessions.has(s.id)) return;
    this.save(s);
    // Audio before the first part still waiting for text is no longer needed.
    const waiting = s.segments.find(p => p.status === "pending" || p.status === "failed");
    const safe = waiting ? waiting.startSample : s.cutSample;
    this.write(() => recordingStore.dropChunksBefore(s.id, safe, CHUNK_SAMPLES));
    this.emit();
    this.pump();
  }

  private async transcribe(s: RecordingSession, part: RecordingSegment): Promise<string> {
    const key = this.deps?.apiKey;
    if (!key) throw new Error("No AI key.");
    await this.writes.catch(() => {});
    const chunks = await recordingStore.chunks(s.id, part.startSample, part.endSample, CHUNK_SAMPLES);
    const pcm = new Int16Array(part.endSample - part.startSample);
    let covered = 0;
    for (const chunk of chunks) {
      const data = new Int16Array(chunk.pcm);
      const from = Math.max(part.startSample, chunk.start), to = Math.min(part.endSample, chunk.start + data.length);
      if (to <= from) continue;
      pcm.set(data.subarray(from - chunk.start, to - chunk.start), from - part.startSample);
      covered += to - from;
    }
    if (covered < pcm.length * 0.5) throw new Error("The audio for this part is missing from this device.");
    const previous = s.segments[part.index - 1]?.text;
    const response = await providerFetch("chat/completions", key, {
      model: getTranscriptionModel(),
      temperature: 0,
      max_tokens: 4000,
      messages: [{ role: "user", content: [
        { type: "text", text: transcribeContext(previous) },
        { type: "input_audio", input_audio: { data: toBase64(encodeWav(pcm)), format: "wav" } },
      ] }],
    }, AbortSignal.timeout(120_000));
    if (!response.ok) throw new Error(providerErrorMessage(await response.json().catch(() => ({})), response.status));
    const data = await response.json();
    if (data.error) throw new Error(providerErrorMessage(data));
    const content = data.choices?.[0]?.message?.content;
    const text = Array.isArray(content) ? content.map((c: { text?: string }) => c.text || "").join("") : String(content ?? "");
    return cleanTranscription(text);
  }

  /** Tries failed parts again. */
  retry(id: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    for (const part of s.segments) if (part.status === "failed") { part.status = "pending"; part.attempts = 0; part.error = undefined; this.retryAt.delete(`${id}:${part.index}`); }
    this.save(s);
    this.emit();
    this.pump();
  }

  /** Finishes without the parts that could not be transcribed. */
  finishWithoutFailed(id: string) {
    const s = this.sessions.get(id);
    if (s && s.status === "processing") void this.complete(s);
  }

  private checkFinished(s: RecordingSession) {
    if (s.status !== "processing" || !this.owned.has(s.id)) return;
    if (s.segments.some(p => p.status === "pending" || p.status === "failed")) return;
    void this.complete(s);
  }

  /** Saves the transcript into the note, removes the recording, then writes the notes. */
  private async complete(s: RecordingSession) {
    if (this.finishing.has(s.id) || !this.deps) return;
    this.finishing.add(s.id);
    try {
      const transcript = formatTranscript(s.segments.filter(p => p.status === "done"));
      const seconds = Math.round(s.totalSamples / SAMPLE_RATE);
      // If the app closed right after saving the transcript last time, the note already has it.
      const marker = s.segments.find(p => p.status === "done" && p.text)?.text?.trim().slice(0, 160);
      const alreadySaved = !!marker && !!this.deps.getNote(s.noteId)?.transcript?.includes(marker);
      if (transcript && !alreadySaved) {
        const recordedAt = new Date(s.createdAt);
        const apply = (note: KnowledgeItem): KnowledgeItem => ({
          ...note,
          transcript: appendTranscript(note.transcript, transcript, recordedAt),
          recording: { ...note.recording, durationSec: (note.recording?.durationSec || 0) + seconds, recordedAt: note.recording?.recordedAt || s.createdAt, notesPending: true },
          updatedAt: new Date().toISOString(),
        });
        if (this.deps.getNote(s.noteId)) this.deps.updateNote(s.noteId, apply);
        else {
          // The note was deleted while recording; the transcript gets a new one instead of being lost.
          const now = new Date().toISOString();
          this.deps.createNote(apply({ id: s.noteId, title: "New recording", subject: "New recording", content: "", summary: "", folderId: null, tags: [],
            status: "Synthesized", startDate: now.slice(0, 10), endDate: now.slice(0, 10), createdAt: now, updatedAt: now }));
        }
      } else if (!transcript) this.notify("No speech was detected in that recording.");
      // Give the app a moment to store the note before the recording's own copy goes away.
      await new Promise(resolve => setTimeout(resolve, 3000));
      await this.removeSession(s.id);
      if (transcript && this.deps.getNote(s.noteId)?.recording?.notesPending) void this.generateNotes(s.noteId);
    } finally {
      this.finishing.delete(s.id);
    }
  }

  // ---- Notes ---------------------------------------------------------------------------------------
  /** Writes detailed notes from the note's transcript, replacing the note body (which can be undone). */
  async generateNotes(noteId: string) {
    const deps = this.deps;
    if (!deps || this.generations.get(noteId)?.running) return;
    const progress: GenerationView = { noteId, stage: "Reading the transcript", words: 0, running: true };
    this.generations.set(noteId, progress);
    this.emit();
    // Lets an open editor save the last words typed before they are read.
    window.dispatchEvent(new CustomEvent("synapse-recorder-flush", { detail: { noteId } }));
    try {
      const note = deps.getNote(noteId);
      if (!note?.transcript?.trim()) throw new Error("This note has no transcript.");
      if (!deps.apiKey) throw new Error("Add an AI key in Settings to write notes from the transcript.");
      const typed = note.recording?.notesGeneratedAt ? note.recording.myNotes : note.content;
      const request = {
        title: PLACEHOLDER_TITLE.test(note.title || note.subject || "") ? "(untitled)" : note.title || note.subject,
        date: new Date(note.recording?.recordedAt || note.createdAt || Date.now()).toLocaleString([], { dateStyle: "full", timeStyle: "short" }),
        duration: formatClock(note.recording?.durationSec || 0),
        userNotes: typed ? stripNoteImages(typed).trim() : undefined,
      };
      let last = 0;
      const ask = (prompt: string, stage: string, base = 0) => {
        progress.stage = stage;
        this.emit();
        return queryOpenRouter([{ role: "user", content: prompt }], deps.apiKey!, deps.model, NOTES_SYSTEM, {
          temperature: 0.3, maxTokens: 16000, timeoutMs: 600_000,
          onText: text => {
            progress.words = base + text.split(/\s+/).length;
            if (Date.now() - last > 250) { last = Date.now(); this.emit(); }
          },
        }).then(reply => { if (!reply.trim() || reply === "No response received.") throw new Error("The AI returned no notes. Try again."); return reply; });
      };
      let markdown: string;
      const transcript = note.transcript;
      if (transcript.length <= SINGLE_PASS_CHARS) markdown = await ask(notesPrompt({ ...request, transcript }), "Writing detailed notes");
      else {
        const parts = splitTranscript(transcript, 60000);
        const detailed: string[] = [];
        for (const [i, part] of parts.entries()) {
          detailed.push((await ask(partNotesPrompt({ ...request, transcript: part }, i, parts.length), `Writing notes for part ${i + 1} of ${parts.length}`, progress.words)).trim());
        }
        const overview = await ask(overviewPrompt(request, detailed.join("\n\n")), "Writing the summary", progress.words);
        markdown = assembleNotes(overview, detailed.join("\n\n"));
      }
      const { title, body } = splitTitle(markdown);
      const latest = deps.getNote(noteId);
      if (!latest) throw new Error("The note was deleted.");
      progress.previous = latest.content || "";
      deps.updateNote(noteId, n => {
        const rename = title && PLACEHOLDER_TITLE.test(n.title || n.subject || "");
        return {
          ...n, content: body,
          summary: stripNoteImages(body).replace(/[#*>|`-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200),
          ...(rename ? { title, subject: title } : {}),
          recording: {
            ...n.recording, durationSec: n.recording?.durationSec || 0, recordedAt: n.recording?.recordedAt || n.createdAt || new Date().toISOString(),
            notesGeneratedAt: new Date().toISOString(), notesPending: undefined, revision: (n.recording?.revision || 0) + 1,
            // What the user typed before the first write-up stays available.
            myNotes: n.recording?.myNotes ?? (!n.recording?.notesGeneratedAt && stripNoteImages(n.content || "").trim() ? n.content : undefined),
          },
          updatedAt: new Date().toISOString(),
        };
      });
      progress.running = false;
      progress.stage = "Notes written";
    } catch (error) {
      progress.running = false;
      progress.error = describeError(error);
    }
    this.emit();
  }

  /** Restores the note body from before the last write-up. */
  undoNotes(noteId: string) {
    const previous = this.generations.get(noteId)?.previous;
    if (previous === undefined || !this.deps) return;
    this.deps.updateNote(noteId, n => ({ ...n, content: previous, recording: n.recording && { ...n.recording, revision: (n.recording.revision || 0) + 1 }, updatedAt: new Date().toISOString() }));
    this.generations.delete(noteId);
    this.emit();
  }

  /** Removes a note's transcript (the notes written from it stay). */
  deleteTranscript(noteId: string) {
    this.deps?.updateNote(noteId, n => {
      const { transcript: _removed, ...rest } = n;
      return { ...rest, recording: n.recording && { ...n.recording, notesPending: undefined }, updatedAt: new Date().toISOString() };
    });
  }

  dismissGeneration(noteId: string) {
    if (this.generations.get(noteId)?.running) return;
    this.generations.delete(noteId);
    this.emit();
  }

  /** Keeps the last second of audio when the page is closing, as far as the browser allows. */
  flushForExit() { if (this.live) this.flushChunk(this.live); }
  isRecording() { return !!this.live; }
  wakeAgain() { if (this.live && (!this.live.wakeLock || this.live.wakeLock.released)) void this.keepAwake(this.live); }
  online() { this.pump(); }
}

export const lectureRecorder = new LectureRecorder();

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", event => {
    if (!lectureRecorder.isRecording()) return;
    lectureRecorder.flushForExit();
    event.preventDefault();
    event.returnValue = "";
  });
  window.addEventListener("pagehide", () => lectureRecorder.flushForExit());
  window.addEventListener("online", () => lectureRecorder.online());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") lectureRecorder.wakeAgain(); });
}

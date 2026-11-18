import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Loader2, Mic, MonitorSpeaker, Pause, Play, RotateCcw, Square, Trash2, Undo2, X } from "lucide-react";
import {
  canCaptureSystemAudio, canRecord, getTranscriptionModel, lectureRecorder, setTranscriptionModel, TRANSCRIPTION_MODELS,
  type AudioSource, type GenerationView, type SessionView,
} from "../../services/lectureRecorder";
import { formatClock } from "../../utils/recording";
import "../../recorder.css";

const SOURCE_KEY = "synapse_recorder_source";
const DEVICE_KEY = "synapse_recorder_device";
const pref = (key: string) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
const setPref = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Preference only. */ } };

/** Five bars that follow the input level without re-rendering React. */
export function LevelMeter({ active }: { active: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!active) { ref.current?.style.setProperty("--level", "0"); return; }
    return lectureRecorder.subscribeLevel(level => {
      // Speech RMS sits around 0.02–0.2; a log scale makes quiet rooms still visibly move.
      const scaled = Math.max(0, Math.min(1, (Math.log10(Math.max(level, 1e-4)) + 3.2) / 2.6));
      ref.current?.style.setProperty("--level", scaled.toFixed(2));
    });
  }, [active]);
  return <span ref={ref} className="rec-meter" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i} style={{ "--i": i } as React.CSSProperties} />)}</span>;
}

interface Props {
  noteId: string;
  session?: SessionView;
  generation?: GenerationView;
  blocked?: string;
  /** Another note is recording right now. */
  busyElsewhere: boolean;
  notesPending: boolean;
  hasTranscript: boolean;
  /** Start as soon as the panel opens (the note was created by "Record"). */
  autoStart?: boolean;
  onClose?: () => void;
}

export function RecorderPanel({ noteId, session, generation, blocked, busyElsewhere, notesPending, hasTranscript, autoStart, onClose }: Props) {
  const [source, setSource] = useState<AudioSource>(() => (pref(SOURCE_KEY) === "mic+system" && canCaptureSystemAudio() ? "mic+system" : "mic"));
  const [deviceId, setDeviceId] = useState(() => pref(DEVICE_KEY));
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [model, setModel] = useState(getTranscriptionModel);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [showLive, setShowLive] = useState(true);
  const autoStarted = useRef(false);

  useEffect(() => {
    const list = () => navigator.mediaDevices?.enumerateDevices?.().then(all => setDevices(all.filter(d => d.kind === "audioinput" && d.deviceId))).catch(() => {});
    list();
    navigator.mediaDevices?.addEventListener?.("devicechange", list);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", list);
  }, [session?.status]);

  const act = async (run: () => Promise<unknown> | unknown) => {
    setError(null);
    setWorking(true);
    try { await run(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setWorking(false); }
  };
  const start = () => act(async () => {
    setPref(SOURCE_KEY, source);
    setPref(DEVICE_KEY, deviceId);
    await lectureRecorder.start(noteId, { source, deviceId: deviceId || undefined });
  });

  useEffect(() => {
    if (!autoStart || autoStarted.current || session || busyElsewhere) return;
    autoStarted.current = true;
    void act(() => lectureRecorder.start(noteId, { source: "mic", deviceId: pref(DEVICE_KEY) || undefined, autoTitle: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const errorRow = error && <p className="rec-error" role="alert"><AlertTriangle size={14} /> {error}</p>;

  // ---- Writing notes ---------------------------------------------------------------------------------
  if (!session && generation) {
    if (generation.running) return (
      <section className="rec-panel" aria-live="polite">
        <div className="rec-row">
          <Loader2 size={16} className="rec-spin" />
          <div className="rec-text"><strong>{generation.stage}…</strong><span>{generation.words ? `${generation.words.toLocaleString()} words so far` : "This takes a minute or two for a long recording."}</span></div>
        </div>
      </section>
    );
    if (generation.error) return (
      <section className="rec-panel rec-panel-warn" role="alert">
        <div className="rec-row">
          <AlertTriangle size={16} />
          <div className="rec-text"><strong>Notes couldn't be written</strong><span>{generation.error} The transcript is saved in this note.</span></div>
          <div className="rec-actions">
            <button type="button" className="nx-btn" onClick={() => void lectureRecorder.generateNotes(noteId)}><RotateCcw size={14} /> Try again</button>
            <button type="button" className="rec-icon" aria-label="Dismiss" onClick={() => lectureRecorder.dismissGeneration(noteId)}><X size={15} /></button>
          </div>
        </div>
      </section>
    );
    return (
      <section className="rec-panel rec-panel-done" aria-live="polite">
        <div className="rec-row">
          <Check size={16} />
          <div className="rec-text"><strong>Notes written from the recording</strong><span>The full transcript is in the Transcript tab.</span></div>
          <div className="rec-actions">
            {generation.previous !== undefined && <button type="button" className="nx-btn" onClick={() => lectureRecorder.undoNotes(noteId)}><Undo2 size={14} /> Undo</button>}
            <button type="button" className="rec-icon" aria-label="Dismiss" onClick={() => lectureRecorder.dismissGeneration(noteId)}><X size={15} /></button>
          </div>
        </div>
      </section>
    );
  }

  // ---- No recording yet --------------------------------------------------------------------------
  if (!session) {
    if (notesPending && hasTranscript && !onClose) return (
      <section className="rec-panel">
        <div className="rec-row">
          <Mic size={16} />
          <div className="rec-text"><strong>Transcript saved</strong><span>Notes haven't been written from it yet.</span></div>
          <div className="rec-actions"><button type="button" className="nx-btn nx-btn-primary" onClick={() => void lectureRecorder.generateNotes(noteId)}>Write notes</button></div>
        </div>
      </section>
    );
    if (!onClose) return null;
    if (!canRecord()) return (
      <section className="rec-panel rec-panel-warn">
        <div className="rec-row"><AlertTriangle size={16} /><div className="rec-text"><strong>Recording isn't available here</strong><span>This browser can't capture audio. Try Chrome, Edge, Safari or the desktop app.</span></div>
          <button type="button" className="rec-icon" aria-label="Close" onClick={onClose}><X size={15} /></button></div>
      </section>
    );
    return (
      <section className="rec-panel" aria-label="Record into this note">
        <div className="rec-row">
          <div className="rec-text">
            <strong>{hasTranscript ? "Record more into this note" : "Record a lecture or meeting"}</strong>
            <span>Type your own notes while it records. When you finish, Synapse transcribes everything and writes detailed notes around what you typed.</span>
          </div>
          <button type="button" className="rec-icon" aria-label="Close" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="rec-options">
          <label>Audio
            <select value={source} onChange={e => setSource(e.target.value as AudioSource)}>
              <option value="mic">Microphone (in the room)</option>
              {canCaptureSystemAudio() && <option value="mic+system">Microphone + tab or screen audio (online class, call)</option>}
            </select>
          </label>
          {devices.length > 1 && (
            <label>Microphone
              <select value={deviceId} onChange={e => setDeviceId(e.target.value)}>
                <option value="">System default</option>
                {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
              </select>
            </label>
          )}
          <label>Transcription
            <select value={model} onChange={e => { setModel(e.target.value); setTranscriptionModel(e.target.value); }}>
              {TRANSCRIPTION_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              {!TRANSCRIPTION_MODELS.some(m => m.id === model) && <option value={model}>{model}</option>}
            </select>
          </label>
        </div>
        {source === "mic+system" && <p className="rec-hint"><MonitorSpeaker size={13} /> Your browser will ask which tab or screen to share. Turn on “Share audio”.</p>}
        {busyElsewhere && <p className="rec-hint"><AlertTriangle size={13} /> Another note is recording. Pause or finish it first.</p>}
        {errorRow}
        <div className="rec-actions rec-actions-start">
          <button type="button" className="nx-btn nx-btn-primary rec-start" disabled={working || busyElsewhere} onClick={start}>
            {working ? <Loader2 size={15} className="rec-spin" /> : <span className="rec-dot" />} Start recording
          </button>
          <span className="rec-fine">Saved on this device every second. If the app closes, you can resume where it stopped.</span>
        </div>
      </section>
    );
  }

  // ---- A recording exists ------------------------------------------------------------------------
  const s = session;
  const recording = s.status === "recording" && s.ownedHere;
  const processing = s.status === "processing";
  const progress = s.segments.length ? Math.round((s.done / Math.max(1, s.segments.length)) * 100) : 0;
  const total = s.segments.length + (!processing && s.totalSamples > s.cutSample ? 1 : 0);
  const parts = total ? `${s.done} of ${total} minute-long parts transcribed` : "Listening";
  const confirmDiscard = () => {
    if (confirm(`Delete this ${formatClock(s.seconds)} recording and its audio? The note itself is kept.`)) void act(() => lectureRecorder.discard(s.id));
  };

  return (
    <section className={`rec-panel ${recording ? "is-recording" : ""}`} aria-label="Recording">
      <div className="rec-row">
        <span className={`rec-status ${recording ? "is-live" : ""}`}>{recording ? <span className="rec-dot" /> : processing ? <Loader2 size={14} className="rec-spin" /> : <Pause size={14} />}</span>
        <div className="rec-text">
          <strong>
            <span className="rec-clock">{formatClock(s.seconds)}</span>
            {recording ? "Recording" : processing ? "Finishing up" : !s.ownedHere ? "Recording in another tab" : "Paused"}
            {recording && <LevelMeter active />}
          </strong>
          <span>
            {!s.ownedHere ? "This recording is open in another tab or window. It will continue here if that one closes."
              : processing ? (s.failed ? `${s.failed} part${s.failed === 1 ? "" : "s"} couldn't be transcribed.` : `Transcribing the last ${Math.max(1, s.segments.length - s.done)} part${s.segments.length - s.done === 1 ? "" : "s"}, then writing notes…`)
              : s.interrupted ? "Recording stopped unexpectedly (the app closed or the microphone disconnected). Everything up to here is saved."
              : recording ? `${parts} · keeps going if you switch tabs` : parts}
          </span>
        </div>
        {s.ownedHere && !processing && (
          <div className="rec-actions">
            {recording
              ? <button type="button" className="nx-btn" disabled={working} onClick={() => act(() => lectureRecorder.pause(s.id))}><Pause size={14} /> Pause</button>
              : <button type="button" className="nx-btn" disabled={working || busyElsewhere} onClick={() => act(() => lectureRecorder.resume(s.id))}><Play size={14} /> Resume</button>}
            <button type="button" className="nx-btn nx-btn-primary" disabled={working} onClick={() => act(() => lectureRecorder.finish(s.id))}><Square size={13} /> Finish & write notes</button>
            <button type="button" className="rec-icon" aria-label="Delete recording" title="Delete recording" disabled={working} onClick={confirmDiscard}><Trash2 size={15} /></button>
          </div>
        )}
        {processing && s.failed > 0 && s.ownedHere && (
          <div className="rec-actions">
            <button type="button" className="nx-btn" onClick={() => lectureRecorder.retry(s.id)}><RotateCcw size={14} /> Retry</button>
            <button type="button" className="nx-btn nx-btn-primary" onClick={() => lectureRecorder.finishWithoutFailed(s.id)}>Continue without them</button>
          </div>
        )}
      </div>
      {s.segments.length > 0 && <div className="rec-progress" role="progressbar" aria-label="Transcription progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div>}
      {blocked && s.pending > 0 && <p className="rec-hint"><AlertTriangle size={13} /> {blocked}</p>}
      {s.failed > 0 && !processing && <p className="rec-hint"><AlertTriangle size={13} /> {s.failed} part{s.failed === 1 ? "" : "s"} failed to transcribe: {s.segments.find(p => p.status === "failed")?.error} <button type="button" className="rec-link" onClick={() => lectureRecorder.retry(s.id)}>Retry</button></p>}
      {busyElsewhere && !recording && !processing && <p className="rec-hint"><AlertTriangle size={13} /> Another note is recording. Pause it to resume this one.</p>}
      {errorRow}
      {s.recent.length > 0 && (
        <div className="rec-live">
          <button type="button" className="rec-live-toggle" aria-expanded={showLive} onClick={() => setShowLive(v => !v)}>
            <ChevronDown size={14} className={showLive ? "" : "is-closed"} /> Live transcript <em>updates about once a minute</em>
          </button>
          {showLive && s.recent.map(p => <p key={p.at}><time>{p.at}</time>{p.text}</p>)}
        </div>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import { Loader2, Pause, Play, X } from "lucide-react";
import { useLectureRecorder } from "../../hooks/useLectureRecorder";
import { lectureRecorder } from "../../services/lectureRecorder";
import { formatClock } from "../../utils/recording";
import { LevelMeter } from "./RecorderPanel";
import "../../recorder.css";

/**
 * A small indicator, shown anywhere in the app except the note being recorded, so a running recording is
 * never forgotten. It also brings back a recording interrupted by a crash, and shows recorder notices.
 */
export function RecordingPill({ titleOf, onOpen }: { titleOf: (noteId: string) => string; onOpen: (noteId: string) => void }) {
  const rec = useLectureRecorder();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const show = (event: Event) => {
      setNotice((event as CustomEvent<string>).detail);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setNotice(null), 8000);
    };
    window.addEventListener("synapse-recorder-notice", show);
    return () => { window.removeEventListener("synapse-recorder-notice", show); window.clearTimeout(timer); };
  }, []);

  const live = rec.sessions.find(s => s.id === rec.liveId);
  const waiting = rec.sessions.find(s => s.ownedHere && s.status === "paused" && s.interrupted);
  const finishing = rec.sessions.find(s => s.ownedHere && s.status === "processing");
  const writing = rec.generations.find(g => g.running);
  const session = live || waiting || finishing;
  const noteId = session?.noteId || writing?.noteId;
  const hidden = !noteId || rec.viewing === noteId;

  const run = (task: () => Promise<unknown>) => { setError(null); task().catch(e => setError(e instanceof Error ? e.message : String(e))); };

  return (
    <div className="rec-floating" aria-live="polite">
      {notice && <div className="rec-toast" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={13} /></button></div>}
      {!hidden && (
        <div className={`rec-pill ${live ? "is-recording" : ""}`}>
          {live ? <span className="rec-dot" /> : session?.status === "paused" ? <Pause size={13} /> : <Loader2 size={13} className="rec-spin" />}
          <button type="button" className="rec-pill-main" onClick={() => onOpen(noteId!)} title="Open the note">
            <strong>{session ? formatClock(session.seconds) : "Writing notes"}</strong>
            <span>{live ? "Recording" : waiting ? "Recording interrupted" : finishing ? "Transcribing" : writing?.stage} · {titleOf(noteId!)}</span>
          </button>
          {live && <LevelMeter active />}
          {live && <button type="button" className="rec-icon" aria-label="Pause recording" onClick={() => run(() => lectureRecorder.pause(live.id))}><Pause size={14} /></button>}
          {!live && waiting && !rec.liveId && <button type="button" className="rec-icon" aria-label="Resume recording" onClick={() => run(() => lectureRecorder.resume(waiting.id))}><Play size={14} /></button>}
        </div>
      )}
      {error && <div className="rec-toast is-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss" onClick={() => setError(null)}><X size={13} /></button></div>}
    </div>
  );
}

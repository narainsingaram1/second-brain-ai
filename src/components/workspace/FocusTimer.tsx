import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw, Timer } from "lucide-react";

const timerKey = "iris_focus_session";
function readSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(timerKey) || "null");
    if (
      saved &&
      [25, 45, 60].includes(saved.duration) &&
      Number.isFinite(saved.remaining) &&
      (saved.endsAt === null || Number.isFinite(saved.endsAt))
    )
      return saved as {
        duration: number;
        remaining: number;
        endsAt: number | null;
      };
  } catch {
    /* Storage may be unavailable in a private browser. */
  }
  return { duration: 25, remaining: 25 * 60, endsAt: null };
}
export function FocusTimer() {
  const [saved] = useState(readSession);
  const [duration, setDuration] = useState(saved.duration);
  const [remaining, setRemaining] = useState(
    saved.endsAt
      ? Math.max(0, Math.ceil((saved.endsAt - Date.now()) / 1000))
      : saved.remaining,
  );
  const [endsAt, setEndsAt] = useState<number | null>(saved.endsAt);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        timerKey,
        JSON.stringify({ duration, remaining, endsAt }),
      );
    } catch {
      /* The timer still works without storage. */
    }
  }, [duration, remaining, endsAt]);
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (!seconds) setEndsAt(null);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [endsAt]);
  const reset = () => {
    setEndsAt(null);
    setRemaining(duration * 60);
  };
  return (
    <section className="workspace-card focus-card">
      <div className="card-heading">
        <h2>
          <Timer size={18} /> Time to focus
        </h2>
        <button
          className="icon-control"
          onClick={reset}
          aria-label="Reset focus timer"
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <p className="muted">One thing at a time.</p>
      <div className="focus-time" role="timer" aria-label="Time remaining">
        {Math.floor(remaining / 60)
          .toString()
          .padStart(2, "0")}
        <span>:</span>
        {(remaining % 60).toString().padStart(2, "0")}
      </div>
      <div className="focus-options" aria-label="Focus duration">
        {[25, 45, 60].map((minutes) => (
          <button
            key={minutes}
            disabled={!!endsAt}
            aria-pressed={duration === minutes}
            onClick={() => {
              setDuration(minutes);
              setRemaining(minutes * 60);
            }}
          >
            {minutes} min
          </button>
        ))}
      </div>
      <button
        className="workspace-primary focus-start"
        onClick={() =>
          endsAt
            ? setEndsAt(null)
            : setEndsAt(Date.now() + (remaining || duration * 60) * 1000)
        }
      >
        {endsAt ? <Pause size={15} /> : <Play size={15} />}{" "}
        {endsAt
          ? "Pause session"
          : remaining === 0
            ? "Start again"
            : "Start focus"}
      </button>
      {remaining === 0 && (
        <p role="status" className="focus-complete">
          Session complete. Take a breath.
        </p>
      )}
    </section>
  );
}

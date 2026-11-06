import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";

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
  const total = duration * 60;
  const progress = total ? 1 - remaining / total : 0;
  // A 60-tick dial: elapsed ticks are inked, the rest stay pencil grey.
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  return (
    <section className="workspace-card focus-card">
      <div className="card-heading">
        <h2>Focus</h2>
        <button className="icon-control" onClick={reset} aria-label="Reset focus timer">
          <RotateCcw size={16} strokeWidth={1.5} />
        </button>
      </div>
      <div className="focus-dial">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          {ticks.map((i) => {
            const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
            const major = i % 5 === 0;
            const r1 = major ? 80 : 84;
            return (
              <line
                key={i}
                x1={100 + Math.cos(angle) * r1}
                y1={100 + Math.sin(angle) * r1}
                x2={100 + Math.cos(angle) * 90}
                y2={100 + Math.sin(angle) * 90}
                className={i / 60 < progress ? "tick is-elapsed" : major ? "tick is-major" : "tick"}
              />
            );
          })}
          <circle cx="100" cy="100" r="70" className="dial-face" />
          <line
            x1="100" y1="100"
            x2={100 + Math.cos(progress * Math.PI * 2 - Math.PI / 2) * 62}
            y2={100 + Math.sin(progress * Math.PI * 2 - Math.PI / 2) * 62}
            className="dial-hand"
          />
          <circle cx="100" cy="100" r="3" className="dial-pin" />
        </svg>
        <div className="focus-time" role="timer" aria-label="Time remaining">
          {Math.floor(remaining / 60).toString().padStart(2, "0")}:{(remaining % 60).toString().padStart(2, "0")}
        </div>
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
        onClick={() => (endsAt ? setEndsAt(null) : setEndsAt(Date.now() + (remaining || duration * 60) * 1000))}
      >
        {endsAt ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}
        {endsAt ? "Pause" : remaining === 0 ? "Start again" : remaining < total ? "Resume" : "Start"}
      </button>
      {remaining === 0 && (
        <p role="status" className="focus-complete">Session complete</p>
      )}
    </section>
  );
}

import { useMemo, useState } from "react";
import { Check, Copy, RefreshCw, Search, Trash2 } from "lucide-react";
import { formatClock } from "../../utils/recording";

interface Props {
  transcript: string;
  durationSec?: number;
  generating: boolean;
  onRegenerate: () => void;
  onDelete: () => void;
}

/** The note's transcript, read-only, with times, recording dividers and a filter. */
export function TranscriptView({ transcript, durationSec, generating, onRegenerate, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const paragraphs = useMemo(() => transcript.split(/\n{2,}/).map(p => p.trim()).filter(Boolean), [transcript]);
  const needle = query.trim().toLowerCase();
  const shown = needle ? paragraphs.filter(p => p.toLowerCase().includes(needle)) : paragraphs;
  const words = useMemo(() => transcript.split(/\s+/).filter(Boolean).length, [transcript]);
  const copy = () => { void navigator.clipboard.writeText(transcript); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <div className="rec-transcript">
      <div className="rec-transcript-bar">
        <span>{durationSec ? `${formatClock(durationSec)} recorded · ` : ""}{words.toLocaleString()} words</span>
        <label className="rec-transcript-search">
          <Search size={13} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find in transcript" aria-label="Find in transcript" />
        </label>
        <button type="button" className="nx-btn" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} Copy</button>
        <button type="button" className="nx-btn" disabled={generating} onClick={onRegenerate}><RefreshCw size={14} /> Rewrite notes</button>
        <button type="button" className="rec-icon" aria-label="Delete transcript" title="Delete transcript" onClick={onDelete}><Trash2 size={15} /></button>
      </div>
      {needle && <p className="rec-fine">{shown.length} of {paragraphs.length} paragraphs match.</p>}
      <div className="rec-transcript-body">
        {shown.map((p, i) => {
          const divider = p.match(/^── (.+) ──$/);
          if (divider) return <h4 key={i} className="rec-divider">{divider[1]}</h4>;
          const timed = p.match(/^\[(\d{1,2}(?::\d{2}){1,2})\]\s*([\s\S]*)$/);
          return <p key={i}>{timed && <time>{timed[1]}</time>}{timed ? timed[2] : p}</p>;
        })}
      </div>
    </div>
  );
}

import { useState } from "react";
import { AIMessage, BrainState } from "../types";
import { records, RecordType } from "../services/brainRetrieval";

export function SourceReferences({ sources, state }: { sources?: AIMessage["sources"]; state?: BrainState | null }) {
  const [selected, setSelected] = useState<{ id: string; type: string; offset?: number } | null>(null);
  const [offset, setOffset] = useState(0);
  if (!sources?.length) return null;
  const unique = sources.filter((source, i) => sources.findIndex(s => s.id === source.id && s.type === source.type) === i);
  const record = selected && state ? records(state, selected.type as RecordType).find(r => r.id === selected.id) : undefined;
  return <div className="mt-3 text-xs text-slate-500">
    <details>
      <summary className="cursor-pointer">Sources ({unique.length})</summary>
      <div className="flex flex-wrap gap-2 mt-2">
        {unique.map(source => <button type="button" key={`${source.type}:${source.id}`} className="rounded-lg bg-indigo-50 dark:bg-indigo-950 px-2 py-1 text-indigo-700 dark:text-indigo-300" title={`${source.type}:${source.id}`}
          onClick={() => { setSelected(source); setOffset(source.offset || 0); }}>{source.title}</button>)}
      </div>
    </details>
    {selected && <div role="dialog" aria-modal="true" aria-label="Source record" className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-6" onKeyDown={e => { if (e.key === "Escape") setSelected(null); }}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 max-w-2xl w-full max-h-[80vh] overflow-auto">
        <button type="button" autoFocus className="float-right underline" onClick={() => setSelected(null)}>Close source</button>
        <p className="font-semibold mb-2">{record?.title || "Source unavailable"}</p>
        <p className="mb-3 break-all">{selected.type}:{selected.id} · Current saved record</p>
        <pre className="text-xs whitespace-pre-wrap break-words">{record ? record.text.slice(offset, offset + 12000) : "This source was removed or is unavailable in the current workspace."}</pre>
        {record && <div className="flex gap-4 mt-3">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 12000))}>Previous</button>
          <span>{offset}–{Math.min(offset + 12000, record.text.length)} of {record.text.length} characters</span>
          <button type="button" disabled={offset + 12000 >= record.text.length} onClick={() => setOffset(offset + 12000)}>Next</button>
        </div>}
      </div>
    </div>}
  </div>;
}

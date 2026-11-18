/**
 * Pure helpers for lecture recording: where to split audio, WAV encoding, transcript formatting and the
 * prompts that turn a transcript into notes. Kept free of browser APIs so they can be tested directly.
 */

/** Speech models need no more than 16 kHz mono; it keeps an hour of audio near 115 MB before transcription. */
export const SAMPLE_RATE = 16000;
/** One level reading (and one worklet message) per 100 ms of audio. */
export const FRAME_SAMPLES = 1600;
/** Audio is written to the device once per second, so a crash loses at most a second. */
export const CHUNK_SAMPLES = SAMPLE_RATE;
const FRAMES_PER_SECOND = SAMPLE_RATE / FRAME_SAMPLES;
/** Parts sent for transcription are 40–75 s long and end in a pause, so no word is cut in half. */
export const SEGMENT_MIN_FRAMES = 40 * FRAMES_PER_SECOND;
export const SEGMENT_MAX_FRAMES = 75 * FRAMES_PER_SECOND;
const QUIET_RUN_FRAMES = 4;
/** A part whose loudest moment is below this has no speech worth sending. */
export const SILENT_PEAK = 0.004;

/**
 * Where to end the current part, as a frame index into `levels` (RMS per 100 ms since the part began), or -1
 * to keep listening. Takes the first pause of at least 400 ms after the minimum length; past the maximum it
 * cuts at the quietest moment so a speaker who never pauses still gets transcribed.
 */
export function findCut(levels: ArrayLike<number>, min = SEGMENT_MIN_FRAMES, max = SEGMENT_MAX_FRAMES, run = QUIET_RUN_FRAMES): number {
  const n = levels.length;
  if (n < min + run) return -1;
  const sorted = Array.from(levels).sort((a, b) => a - b);
  // Pauses are quiet relative to this speaker and room, not to a fixed level.
  const quiet = Math.max(0.002, sorted[Math.floor(n * 0.5)] * 0.35);
  const end = Math.min(n, max);
  let start = -1;
  for (let i = min; i < end; i++) {
    if (levels[i] <= quiet) {
      if (start < 0) start = i;
      if (i - start + 1 >= run) return start + Math.floor(run / 2);
    } else start = -1;
  }
  if (n < max) return -1;
  let best = min, bestSum = Infinity, sum = 0;
  for (let i = min; i < max; i++) {
    sum += levels[i];
    if (i - min >= run) sum -= levels[i - run];
    if (i - min >= run - 1 && sum < bestSum) { bestSum = sum; best = i - run + 1; }
  }
  return best + Math.floor(run / 2);
}

/** 16-bit mono PCM as a WAV file. */
export function encodeWav(pcm: Int16Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, 36 + pcm.length * 2, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** 75 → "01:15", 3725 → "1:02:05". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export interface TranscriptPart { startSample: number; text?: string }

/** Transcribed parts as paragraphs, each starting with the time it was said: "[12:34] …". */
export function formatTranscript(parts: TranscriptPart[], sampleRate = SAMPLE_RATE): string {
  return parts.filter(p => p.text?.trim()).map(p => `[${formatClock(p.startSample / sampleRate)}] ${p.text!.trim()}`).join("\n\n");
}

/** Adds a new recording's transcript to a note's existing one, with a divider between recordings. */
export function appendTranscript(existing: string | undefined, next: string, recordedAt: Date): string {
  if (!existing?.trim()) return next;
  // The first recording has no divider, so the new one is dividers + 2.
  const count = (existing.match(/^── Recording \d+/gm)?.length ?? 0) + 2;
  const label = recordedAt.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${existing.trimEnd()}\n\n── Recording ${count} · ${label} ──\n\n${next}`;
}

/** Cleans a transcription reply: drops the no-speech marker, wrapping quotes and fences. */
export function cleanTranscription(raw: string): string {
  const text = raw.replace(/^```[a-z]*\n?|```$/gim, "").trim();
  if (/^\[?\s*no speech\s*\]?\.?$/i.test(text)) return "";
  return text.replace(/\[no speech\]/gi, "").trim();
}

/** Splits a long transcript at paragraph breaks into parts of at most `max` characters. */
export function splitTranscript(transcript: string, max = 60000): string[] {
  const paragraphs = transcript.split(/\n{2,}/);
  const parts: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > max) { parts.push(current); current = ""; }
    current = current ? `${current}\n\n${p}` : p;
  }
  if (current) parts.push(current);
  return parts;
}

/** A transcript this long is written up in parts, then given one overview, so detail isn't squeezed out. */
export const SINGLE_PASS_CHARS = 70000;

export const TRANSCRIBE_PROMPT = `Transcribe this audio verbatim, in the language spoken. It is part of a longer recording (a lecture, class, meeting or talk).
- Output only the spoken words as plain text paragraphs: no title, notes, timestamps or commentary.
- Start a new paragraph at each change of topic or speaker. Prefix lines spoken by someone other than the main speaker (a student question, another participant) with "Audience:" unless you can tell their name.
- Keep technical terms, names, numbers, formulas and code exactly as said. Drop filler sounds (um, uh) but keep every meaningful word.
- If a word at the very start or end is cut off, transcribe what is audible.
- If there is no intelligible speech, output exactly: [no speech]`;

export function transcribeContext(previous?: string): string {
  const tail = previous?.trim().slice(-400);
  return tail ? `${TRANSCRIBE_PROMPT}\n\nFor continuity, the previous part ended with: "…${tail}". Do not repeat it.` : TRANSCRIBE_PROMPT;
}

export const NOTES_SYSTEM = `You turn recording transcripts (lectures, classes, meetings, talks) into extremely detailed, well-organized notes in Markdown, the kind a top student would write.

Rules:
- Be comprehensive. Capture every concept, definition, explanation, example, formula, step, date, name, number and argument that matters. A long recording deserves long notes: never compress an hour into a page.
- Explain, don't just list: for each idea say what it is, why it matters and how it connects to the rest, in the speaker's terms.
- Follow the order things were taught. Use ## and ### headings, nested bullets, numbered lists for procedures, tables for comparisons, and fenced code blocks for code. Write formulas in inline code, e.g. \`F = m·a\`.
- After key bullets, cite where it was said with the transcript time in parentheses, e.g. (12:34).
- When the speaker stresses something ("this will be on the exam", repeats it, says it's important), mark it with **Important:**.
- The user's own notes come first: keep every point they wrote, expand it from the transcript, and follow their structure where they gave one.
- Transcripts contain speech-recognition mistakes. Fix obvious mis-hearings from context (especially technical terms) and never add facts the transcript does not support.
- Leave out small talk. Logistics that matter (deadlines, readings, exam details, assignments) go in Action items.
- Write in the language of the transcript. Output only Markdown, with no preamble.`;

const STRUCTURE = `Format:
Title: <a short, specific title for this recording>

## Summary
3–6 sentences on what was covered and the main conclusions.

## Key takeaways
5–10 bullets.

## Detailed notes
The bulk of the notes: a ### section per topic, in order, as detailed as the material allows.

## Key terms
A table: | Term | Meaning |.

## Examples & worked problems
Each example or problem with its steps and answer. Omit if there were none.

## Questions & discussion
Questions that were asked and the answers given. Omit if there were none.

## Action items
"- [ ] " items for assignments, readings, deadlines and follow-ups that were mentioned. Omit if there were none.

## Review questions
5–10 questions that test understanding of this material.`;

export interface NotesRequest { title: string; date: string; duration: string; userNotes?: string; transcript: string }

const header = (r: NotesRequest) => `Recording: ${r.title}\nDate: ${r.date}\nLength: ${r.duration}\n\n` +
  (r.userNotes?.trim() ? `The user's own notes, taken during the recording:\n<user_notes>\n${r.userNotes.trim()}\n</user_notes>\n\n` : "");

export function notesPrompt(r: NotesRequest): string {
  return `${header(r)}Transcript:\n<transcript>\n${r.transcript}\n</transcript>\n\nWrite the notes. Start with the "Title:" line.\n\n${STRUCTURE}`;
}

/** Detailed notes for one part of a long transcript; the overview is written afterwards from all parts. */
export function partNotesPrompt(r: NotesRequest, index: number, total: number): string {
  return `${header(r)}This is part ${index + 1} of ${total} of the transcript:\n<transcript>\n${r.transcript}\n</transcript>\n\n` +
    `Write only the detailed notes for this part: a ### section per topic, in order, as detailed as the material allows, with (mm:ss) citations. ` +
    `Include worked examples, questions asked and anything stressed as important. No summary, title or other sections.`;
}

export function overviewPrompt(r: Omit<NotesRequest, "transcript">, detailed: string): string {
  return `${header({ ...r, transcript: "" })}These are the detailed notes already written from the full transcript:\n<detailed_notes>\n${detailed}\n</detailed_notes>\n\n` +
    `Write the remaining sections from them. Start with the "Title:" line, then: ## Summary (3–6 sentences), ## Key takeaways (5–10 bullets), ` +
    `## Key terms (table | Term | Meaning |), ## Action items ("- [ ] " items; omit if none), ## Review questions (5–10). Do not repeat the detailed notes.`;
}

/** Splits the model's "Title:" line from the note body. */
export function splitTitle(markdown: string): { title?: string; body: string } {
  const match = markdown.match(/^\s*(?:#+\s*)?\**Title:?\**\s*(.+)\n+/i);
  if (!match) return { body: markdown.trim() };
  return { title: match[1].replace(/[*#"]/g, "").trim().slice(0, 120) || undefined, body: markdown.slice(match[0].length).trim() };
}

/** Puts the overview sections around the detailed notes of a long recording. */
export function assembleNotes(overview: string, detailed: string): string {
  const { title, body } = splitTitle(overview);
  const at = body.search(/^## Key terms/m);
  const head = at < 0 ? body : body.slice(0, at).trimEnd();
  const tail = at < 0 ? "" : body.slice(at).trim();
  return `${title ? `Title: ${title}\n\n` : ""}${head}\n\n## Detailed notes\n\n${detailed.trim()}${tail ? `\n\n${tail}` : ""}`;
}

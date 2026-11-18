// Lecture recording: splitting audio at pauses, WAV encoding, transcripts, note prompts, and assistant access.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ cacheDir: '/private/tmp/synapse-recording-tests', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const R = await server.ssrLoadModule('/src/utils/recording.ts');
const { prepareMutation } = await server.ssrLoadModule('/src/services/brainTools.ts');
const { approvalReason } = await server.ssrLoadModule('/src/services/actionPolicy.ts');
const { recordProse } = await server.ssrLoadModule('/src/services/brainRetrieval.ts');

const speech = n => Array.from({ length: n }, (_, i) => 0.08 + 0.02 * Math.sin(i));

test('parts wait for the minimum length, then end at the first real pause', () => {
  assert.equal(R.findCut(speech(R.SEGMENT_MIN_FRAMES - 1)), -1, 'too short to cut');
  assert.equal(R.findCut(speech(R.SEGMENT_MIN_FRAMES + 50)), -1, 'no pause yet, below the maximum');
  const levels = speech(R.SEGMENT_MIN_FRAMES + 100);
  const pauseAt = R.SEGMENT_MIN_FRAMES + 30;
  for (let i = pauseAt; i < pauseAt + 6; i++) levels[i] = 0.005;
  const cut = R.findCut(levels);
  assert.ok(cut >= pauseAt && cut < pauseAt + 6, `cut ${cut} is inside the pause`);
  // A short dip (a breath, 200 ms) is not a pause.
  const breath = speech(R.SEGMENT_MIN_FRAMES + 100);
  breath[pauseAt] = breath[pauseAt + 1] = 0.005;
  assert.equal(R.findCut(breath), -1);
  // Quiet before the minimum length doesn't count.
  const early = speech(R.SEGMENT_MIN_FRAMES + 20);
  for (let i = 10; i < 20; i++) early[i] = 0.001;
  assert.equal(R.findCut(early), -1);
});

test('a speaker who never pauses is cut at the quietest moment once a part reaches the maximum', () => {
  const levels = speech(R.SEGMENT_MAX_FRAMES);
  const softest = R.SEGMENT_MIN_FRAMES + 120;
  for (let i = softest; i < softest + 4; i++) levels[i] = 0.05; // softer, but not a pause
  assert.equal(R.findCut(speech(R.SEGMENT_MAX_FRAMES - 1)), -1);
  const cut = R.findCut(levels);
  assert.ok(cut >= softest && cut < softest + 4, `forced cut ${cut} lands on the softest stretch`);
  assert.ok(cut < R.SEGMENT_MAX_FRAMES);
});

test('audio is encoded as a valid 16 kHz mono WAV and base64 matches Node', () => {
  const pcm = new Int16Array([0, 1000, -1000, 32767, -32768]);
  const wav = R.encodeWav(pcm);
  const view = new DataView(wav.buffer);
  assert.equal(Buffer.from(wav.subarray(0, 4)).toString(), 'RIFF');
  assert.equal(Buffer.from(wav.subarray(8, 12)).toString(), 'WAVE');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), pcm.length * 2);
  assert.equal(view.getInt16(44 + 6, true), 32767);
  assert.equal(wav.length, 44 + pcm.length * 2);
  const big = new Uint8Array(100000).map((_, i) => i * 7);
  assert.equal(R.toBase64(big), Buffer.from(big).toString('base64'));
  // An hour stays within what one request can carry once it is split into parts.
  const part = R.encodeWav(new Int16Array(75 * R.SAMPLE_RATE));
  assert.ok(R.toBase64(part).length < 4_000_000, 'a maximum-length part is well under the 8 MB proxy limit');
});

test('transcripts carry times, skip silent parts and number later recordings', () => {
  const text = R.formatTranscript([
    { startSample: 0, text: 'Welcome to graph theory.' },
    { startSample: 16000 * 61, text: '' },
    { startSample: 16000 * 3725, text: 'Dijkstra needs non-negative weights.' },
  ]);
  assert.equal(text, '[00:00] Welcome to graph theory.\n\n[1:02:05] Dijkstra needs non-negative weights.');
  assert.equal(R.appendTranscript('', 'a', new Date()), 'a');
  const two = R.appendTranscript('[00:00] first', '[00:00] second', new Date('2026-11-18T15:04:00'));
  assert.match(two, /── Recording 2 · .+ ──\n\n\[00:00\] second$/);
  assert.match(R.appendTranscript(two, '[00:00] third', new Date()), /── Recording 3 · /);
  assert.equal(R.cleanTranscription('[no speech]'), '');
  assert.equal(R.cleanTranscription('```\nHello there.\n```'), 'Hello there.');
  assert.equal(R.formatClock(59.9), '00:59');
});

test('long transcripts are split at paragraph breaks and reassembled around one overview', () => {
  const paragraphs = Array.from({ length: 50 }, (_, i) => `[${String(i).padStart(2, '0')}:00] ${'word '.repeat(400)}`);
  const parts = R.splitTranscript(paragraphs.join('\n\n'), 10000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(p => p.length <= 10000));
  assert.equal(parts.join('\n\n'), paragraphs.join('\n\n'), 'nothing is lost or reordered');

  const { title, body } = R.splitTitle('Title: Graph Search\n\n## Summary\nBFS and DFS.');
  assert.equal(title, 'Graph Search');
  assert.equal(body, '## Summary\nBFS and DFS.');
  assert.equal(R.splitTitle('## Summary\nNo title').title, undefined);
  const notes = R.assembleNotes('Title: Graphs\n\n## Summary\nS\n\n## Key takeaways\n- k\n\n## Key terms\n| Term | Meaning |', '### BFS\n- queue');
  assert.match(notes, /^Title: Graphs\n\n## Summary\nS\n\n## Key takeaways\n- k\n\n## Detailed notes\n\n### BFS\n- queue\n\n## Key terms/);
});

test('note prompts include what the user typed and ask for the full structure', () => {
  const prompt = R.notesPrompt({ title: 'CS 1332', date: 'Tuesday', duration: '1:02:05', userNotes: 'heaps are trees', transcript: '[00:00] hi' });
  assert.match(prompt, /<user_notes>\nheaps are trees\n<\/user_notes>/);
  for (const section of ['## Summary', '## Detailed notes', '## Key terms', '## Action items', '## Review questions']) assert.ok(prompt.includes(section), section);
  assert.doesNotMatch(R.notesPrompt({ title: 't', date: 'd', duration: '1', transcript: 'x' }), /user_notes/);
  assert.match(R.transcribeContext('the previous words'), /previous part ended with: "…the previous words"/);
});

const state = () => ({ userId: 'u', tasks: [], goals: [], habits: [], journalEntries: [], trackerItems: [], events: [], workspaces: [], noteFolders: [],
  sections: [], subsections: {}, chatHistory: [], openRouterKey: '', selectedModel: '', theme: 'light',
  knowledgeItems: [{ id: 'n1', subject: 'Lecture', title: 'Lecture', content: '## Notes', summary: '', status: 'Synthesized', startDate: '', endDate: '',
    transcript: '[00:00] Dykstra is greedy.', recording: { durationSec: 60, recordedAt: '2026-11-18', notesPending: true } }],
  study: { courses: [], folders: [], documents: [], decks: [], quizzes: [] } });

test('the assistant can read, correct and delete a transcript; deleting needs approval', () => {
  const fixed = prepareMutation('update_note', { noteId: 'n1', replaceTranscript: '[00:00] Dijkstra is greedy.' }, state());
  assert.equal(fixed.record.transcript, '[00:00] Dijkstra is greedy.');
  assert.equal(fixed.record.content, '## Notes', 'the note body is untouched');
  const removed = prepareMutation('update_note', { noteId: 'n1', replaceTranscript: '' }, state());
  assert.ok(!('transcript' in removed.record));
  assert.equal(removed.record.recording.notesPending, undefined);
  const ctx = { untrustedRead: false, changes: 0, askBeforeChanges: false };
  assert.match(approvalReason('update_note', ctx, { noteId: 'n1', replaceTranscript: ' ' }), /transcript needs your approval/);
  assert.equal(approvalReason('update_note', ctx, { noteId: 'n1', replaceTranscript: '[00:00] fixed' }), null);
  assert.match(recordProse('knowledge', state().knowledgeItems[0]), /Transcript of the recording:\n\[00:00\] Dykstra is greedy\./, 'transcripts are searchable');
});

test('the recorder keeps working off the main thread and survives a closed tab', async () => {
  const worklet = await readFile(new URL('../src/services/recorderWorklet.js', import.meta.url), 'utf8');
  assert.match(worklet, /registerProcessor\("synapse-recorder"/);
  const recorder = await readFile(new URL('../src/services/lectureRecorder.ts', import.meta.url), 'utf8');
  assert.match(recorder, /navigator\.locks\.request/, 'one tab owns each recording');
  assert.match(recorder, /beforeunload/, 'closing the tab while recording warns first');
  const plist = await readFile(new URL('../src-tauri/Info.plist', import.meta.url), 'utf8');
  assert.match(plist, /NSMicrophoneUsageDescription/, 'the desktop app may ask for the microphone');
});

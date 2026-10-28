import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ cacheDir: "/tmp/synapse-agent-test-cache", configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const { AutonomousBrainAgent } = await server.ssrLoadModule('/src/services/agentDispatcher.ts');
const { executeRead, prepareMutation, validate, BRAIN_TOOLS, applyMutation } = await server.ssrLoadModule('/src/services/brainTools.ts');
const { records, chunks, searchRecords } = await server.ssrLoadModule('/src/services/brainRetrieval.ts');
const { normalizeTask } = await server.ssrLoadModule('/src/utils/taskState.ts');
const state = () => ({ userId: 'test', tasks: Array.from({ length: 105 }, (_, i) => ({ id: `task-${String(i).padStart(3, '0')}`, title: `Assignment ${i}`, dueDate: i === 104 ? '2026-11-02' : '2026-10-29', priority: 'medium', section: 'Academic', status: i === 100 ? 'completed' : 'not_started', completed: i === 100 })),
  goals: [], habits: [], journalEntries: [], knowledgeItems: [], sections: ['Academic'], subsections: { Academic: ['General'] }, noteFolders: [], chatHistory: [], openRouterKey: 'test-key', selectedModel: 'test-model', theme: 'light' });
const call = (name, args, id = crypto.randomUUID()) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const response = (content, tool_calls) => ({ choices: [{ finish_reason: tool_calls ? 'tool_calls' : 'stop', message: { content, tool_calls } }] });
function mockProvider(responses, requests) {
  globalThis.fetch = async (url, opts) => {
    assert.match(url, /chat\/completions$/);
    requests.push(JSON.parse(opts.body));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, 'Unexpected additional provider call');
    return Response.json(next);
  };
}

test('exact task queries cover every page and count, including tasks beyond old sample', async () => {
  const s = state(); let offset = 0; const ids = [];
  do {
    const { output } = await executeRead('query_records', { type: 'task', status: 'pending', dateFrom: '2026-10-28', dateTo: '2026-11-04', offset }, s, '');
    assert.equal(output.total, 104);
    ids.push(...output.records.map(r => r.id)); offset = output.nextOffset;
  } while (offset !== null);
  assert.equal(new Set(ids).size, 104); assert.ok(ids.includes('task-104'));
  const { output } = await executeRead('query_records', { type: 'task', status: 'completed', countOnly: true }, s, '');
  assert.equal(output.total, 1); assert.equal(output.records.length, 0);
});

test('long notes retain tail passages and exact offsets for full reads', async () => {
  const s = state(); s.knowledgeItems = [{ id: 'long', subject: 'Research', title: 'Research', content: 'ordinary context '.repeat(3000) + 'TAIL_NEEDLE', summary: '', startDate: '2026-10-01', endDate: '2026-10-01', status: 'Draft' }];
  const record = records(s, 'knowledge')[0]; const passages = chunks(record);
  assert.ok(passages.some(p => p.snippet.includes('TAIL_NEEDLE')));
  let text = '', offset = 0;
  do { const { output } = await executeRead('read_record', { type: 'knowledge', id: 'long', offset }, s, ''); text += output.content; offset = output.nextOffset; } while (offset !== null);
  assert.equal(text, record.text);
  globalThis.fetch = async () => new Response('', { status: 503 });
  const result = await searchRecords(s, 'TAIL_NEEDLE', 'knowledge', 0, 'test');
  assert.equal(result.mode, 'keyword'); assert.match(result.warning, /keyword/); assert.ok(result.results.some(r => r.snippet.includes('TAIL_NEEDLE')));
  s.knowledgeItems = []; assert.equal((await searchRecords(s, 'TAIL_NEEDLE', 'knowledge', 0, 'test')).total, 0);
});

test('validation rejects malformed arguments, impossible dates, unknown IDs and folders', () => {
  const schema = BRAIN_TOOLS.find(t => t.function.name === 'update_task').function.parameters;
  assert.throws(() => validate({ taskId: 'task-1', status: 'oops' }, schema));
  assert.throws(() => validate({ taskId: 'task-1', unexpected: true }, schema));
  assert.throws(() => prepareMutation('update_task', { taskId: 'missing', status: 'completed' }, state()));
  assert.throws(() => prepareMutation('update_task', { taskId: 'task-001', newDueDate: '2026-02-30' }, state()), /Invalid calendar/);
  assert.throws(() => prepareMutation('create_note', { title: 'x', content: 'x', folderId: 'unknown' }, state()));
});

test('undated tasks remain undated through normalization and persistence normalization', () => {
  const mutation = prepareMutation('create_task', { title: 'Read', section: 'Academic', priority: 'medium' }, state());
  assert.equal(mutation.record.dueDate, ''); assert.equal(normalizeTask(mutation.record).dueDate, '');
});

test('tool loop retrieves exact data, executes multiple writes, and observes saved results', async () => {
  const s = state(), requests = [], saved = [];
  mockProvider([
    response(null, [call('query_records', { type: 'task', dateFrom: '2026-11-02' })]),
    response(null, [call('update_task', { taskId: 'task-104', newDueDate: '2026-11-06' }), call('create_note', { title: 'Plan', content: 'Prepare the assignment.' })]),
    response(null, [call('read_record', { type: 'task', id: 'task-104' })]),
    response('Moved the assignment and saved your plan. [task:task-104]'),
  ], requests);
  const result = await AutonomousBrainAgent.execute('Review and move it to Friday; save a plan.', s, undefined, undefined, { commit: async m => saved.push(m) });
  assert.equal(result.status, 'complete'); assert.equal(saved.length, 2); assert.equal(result.actions.length, 2);
  assert.equal(requests[0].model, 'test-model');
  assert.equal(JSON.parse(requests[2].messages.find(m => m.role === 'tool' && JSON.parse(m.content).saved).content).saved, true);
  const lastRead = requests[3].messages.filter(m => m.role === 'tool').at(-1);
  assert.match(JSON.parse(lastRead.content).content, /2026-11-06/);
  assert.equal(s.tasks.at(-1).dueDate, '2026-11-02', 'input state stays immutable');
});

test('follow-ups receive prior conversation and exact source references', async () => {
  const s = state(), requests = [];
  s.chatHistory = [{ id: 'u', role: 'user', content: 'What is due?', timestamp: '1' }, { id: 'a', role: 'assistant', content: 'Your assignment.', timestamp: '2', sources: [{ id: 'task-104', type: 'task', title: 'Assignment 104' }] }];
  mockProvider([response('Start with that assignment.')], requests);
  await AutonomousBrainAgent.execute('Which should I start?', s);
  assert.ok(requests[0].messages.some(m => m.role === 'assistant' && m.content.includes('task-104')));
  assert.equal(requests[0].messages.filter(m => m.content === 'Which should I start?').length, 1);
});

test('duplicate successful tool calls do not duplicate writes', async () => {
  const requests = [], saved = [], args = { title: 'Note', content: 'Body' };
  mockProvider([response(null, [call('create_note', args), call('create_note', args)]), response('Saved.')], requests);
  const result = await AutonomousBrainAgent.execute('Save this note', state(), undefined, undefined, { commit: async m => saved.push(m) });
  assert.equal(saved.length, 1); assert.equal(result.actions.length, 1);
});

test('failed persistence is returned to model and never counted as saved', async () => {
  const requests = [];
  mockProvider([response(null, [call('update_task', { taskId: 'task-001', status: 'completed' })]), response('The write failed.')], requests);
  const result = await AutonomousBrainAgent.execute('Complete assignment', state(), undefined, undefined, { commit: async () => { throw new Error('Disk full'); } });
  assert.equal(result.actions.length, 0);
  const tool = requests[1].messages.find(m => m.role === 'tool'); assert.deepEqual(JSON.parse(tool.content), { error: 'Disk full', saved: false });
});

test('provider failure after one write reports partial completion without offline fallback', async () => {
  const requests = [];
  mockProvider([response(null, [call('update_task', { taskId: 'task-001', status: 'completed' })]), new Error('Provider offline')], requests);
  const result = await AutonomousBrainAgent.execute('Finish assignment', state(), undefined, undefined, { commit: async () => {} });
  assert.equal(result.status, 'error'); assert.equal(result.actions.length, 1); assert.match(result.queryAnswer, /already saved/); assert.match(result.queryAnswer, /Provider offline/);
  assert.doesNotMatch(result.queryAnswer, /Thought Captured/);
});

test('missing key and cancellation do not fabricate answers or changes', async () => {
  const s = state(); s.openRouterKey = '';
  assert.equal((await AutonomousBrainAgent.execute('Hi', s)).status, 'error');
  const controller = new AbortController(); controller.abort();
  const result = await AutonomousBrainAgent.execute('Hi', state(), undefined, undefined, { signal: controller.signal });
  assert.equal(result.status, 'cancelled'); assert.equal(result.actions.length, 0);
});

test('live mutation application preserves unrelated collections and task completion invariant', () => {
  const s = state(); const m = prepareMutation('update_task', { taskId: 'task-001', status: 'completed' }, s);
  const next = applyMutation(s, m); assert.equal(next.tasks[1].completed, true); assert.equal(next.tasks[1].status, 'completed'); assert.equal(next.knowledgeItems, s.knowledgeItems);
});

test('semantic search batches all long-note passages and surfaces paraphrases', async () => {
  const s = state(); s.knowledgeItems = Array.from({ length: 38 }, (_, i) => ({ id: `note-${i}`, subject: 'Project', content: i === 37 ? 'The launch was postponed because the supplier missed a shipment.' : 'Regular status meeting.', summary: '', startDate: '2026-10-01', endDate: '2026-10-01', status: 'Draft' }));
  const inputs = [];
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body); inputs.push(body.input);
    return Response.json({ data: body.input.map((text, index) => ({ index, embedding: text.includes('postponed') || text.includes('delayed') ? [1, 0] : [0, 1] })) });
  };
  const result = await searchRecords(s, 'Why was delivery delayed?', 'knowledge', 0, 'test');
  assert.equal(result.mode, 'hybrid'); assert.equal(result.results[0].id, 'note-37');
  assert.ok(inputs.some(batch => batch.length === 32)); assert.equal(inputs.flat().length, 39);
});

test('assistant can page back through older conversation rather than guessing', async () => {
  const s = state(); s.chatHistory = Array.from({ length: 30 }, (_, i) => ({ id: String(i), role: i % 2 ? 'assistant' : 'user', content: `Turn ${i}`, timestamp: '' }));
  const { output } = await executeRead('recall_conversation', { offset: 12 }, s, '');
  assert.equal(JSON.parse(output.content).content, 'Turn 12'); assert.equal(output.nextOffset, 13); assert.equal(output.total, 30);
});

test('execution limit reports incomplete work and makes no surprise writes', async () => {
  let count = 0;
  globalThis.fetch = async () => { count++; return Response.json(response(null, [call('query_records', { type: 'task', countOnly: true })])); };
  const result = await AutonomousBrainAgent.execute('Review tasks', state());
  assert.equal(count, 48); assert.equal(result.status, 'error'); assert.match(result.queryAnswer, /incomplete/); assert.equal(result.actions.length, 0);
});

test('tool boundary recovers from malformed JSON and rejects unknown tool calls', async () => {
  const requests = [];
  mockProvider([response(null, [{ id: 'bad', type: 'function', function: { name: 'update_task', arguments: '{broken' } }, call('delete_everything', {})]), response('Please clarify.')], requests);
  const result = await AutonomousBrainAgent.execute('Hello', state());
  const errors = requests[1].messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
  assert.equal(errors.length, 2); assert.ok(errors.every(e => e.error && e.saved === false)); assert.equal(result.actions.length, 0);
});

test('canonical storage failures propagate and the save queue recovers', async () => {
  const { persistBrainState } = await server.ssrLoadModule('/src/services/storage.ts');
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { setItem() { throw new Error('Quota exceeded'); } };
  const originalWarn = console.warn, originalError = console.error;
  console.warn = () => {}; console.error = () => {};
  try {
    await assert.rejects(persistBrainState(state()), /Could not save changes/);
    const saved = new Map();
    globalThis.localStorage = { setItem(key, value) { saved.set(key, value); } };
    await persistBrainState(state());
    assert.equal(JSON.parse(saved.get('synapse_second_brain_envelope')).state.tasks.length, 105);
  } finally { globalThis.localStorage = previousStorage; console.warn = originalWarn; console.error = originalError; }
});

test('neural passage cache reuses unchanged content, refreshes edits and never returns deletions', async () => {
  const previousIDB = globalThis.indexedDB;
  const store = new Map();
  const db = { createObjectStore() {}, transaction() {
    const tx = { objectStore() { return {
      get(key) { const request = {}; queueMicrotask(() => { request.result = store.get(key); request.onsuccess?.(); }); return request; },
      put(value, key) { store.set(key, value); queueMicrotask(() => tx.oncomplete?.()); },
    }; } }; return tx;
  } };
  globalThis.indexedDB = { open() { const request = { result: db }; queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); }); return request; } };
  const isolated = await createServer({ cacheDir: "/tmp/synapse-agent-test-cache", configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { searchRecords: search } = await isolated.ssrLoadModule('/src/services/brainRetrieval.ts');
    const s = state(); s.knowledgeItems = [{ id: 'cached', subject: 'Research', content: 'Original passage', summary: '', startDate: '2026-10-01', endDate: '2026-10-01', status: 'Draft' }];
    const inputs = [];
    globalThis.fetch = async (_url, opts) => {
      const { input } = JSON.parse(opts.body); inputs.push(input);
      return Response.json({ data: input.map((_, index) => ({ index, embedding: [1, 0] })) });
    };
    await search(s, 'Research', 'knowledge', 0, 'test');
    assert.equal(inputs.length, 2);
    inputs.length = 0;
    await search(s, 'Research', 'knowledge', 0, 'test');
    assert.deepEqual(inputs, [['Research']], 'Warm searches embed only the question');
    s.knowledgeItems[0].content = 'Revised passage'; inputs.length = 0;
    const changed = await search(s, 'Research', 'knowledge', 0, 'test');
    assert.equal(inputs.length, 2); assert.match(changed.results[0].snippet, /Revised passage/);
    s.knowledgeItems = []; inputs.length = 0;
    assert.equal((await search(s, 'Research', 'knowledge', 0, 'test')).total, 0);
    assert.equal(inputs.length, 0);
  } finally { globalThis.indexedDB = previousIDB; await isolated.close(); }
});

test('cancellation after a durable write retains and reports the saved action', async () => {
  const requests = [], controller = new AbortController();
  mockProvider([response(null, [call('update_task', { taskId: 'task-001', status: 'completed' })])], requests);
  const result = await AutonomousBrainAgent.execute('Complete assignment', state(), undefined, undefined, { signal: controller.signal, commit: async () => controller.abort() });
  assert.equal(result.status, 'cancelled'); assert.equal(result.actions.length, 1); assert.match(result.queryAnswer, /already saved/);
});

test('general conversation is answered without unnecessary retrieval or mutations', async () => {
  const requests = [];
  mockProvider([response('We can work through that together. What is the main obstacle?')], requests);
  const result = await AutonomousBrainAgent.execute('I need help thinking through an idea', state());
  assert.equal(result.status, 'complete'); assert.equal(result.actions.length, 0); assert.equal(result.citations.length, 0); assert.equal(requests.length, 1);
});

test('long prior messages and source lists remain accessible through bounded recall', async () => {
  const s = state(); s.chatHistory = [{ id: 'long-chat', role: 'assistant', content: 'long discussion '.repeat(5000), timestamp: '', sources: Array.from({ length: 150 }, (_, i) => ({ id: `source-${i}`, type: 'knowledge', title: `Reference ${i}` })) }];
  let text = '', characterOffset = 0;
  do {
    const { output } = await executeRead('recall_conversation', { offset: 0, characterOffset }, s, '');
    assert.ok(output.content.length <= 12000); text += output.content; characterOffset = output.nextCharacterOffset;
  } while (characterOffset !== null);
  assert.deepEqual(JSON.parse(text), s.chatHistory[0]);
});

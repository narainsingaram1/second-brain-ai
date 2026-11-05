import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ cacheDir: "/tmp/synapse-agent-test-cache", configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const { AutonomousBrainAgent } = await server.ssrLoadModule('/src/services/agentDispatcher.ts');
const { executeRead, prepareMutation, validate, parseToolArguments, BRAIN_TOOLS, applyMutation } = await server.ssrLoadModule('/src/services/brainTools.ts');
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
  // Referenced records are listed once in the system context; the transcript itself stays free of IDs.
  assert.match(requests[0].messages[0].content, /Records referenced recently[\s\S]*Assignment 104 \[task:task-104\]/);
  assert.ok(requests[0].messages.some(m => m.role === 'assistant' && m.content === 'Your assignment.'));
  assert.equal(requests[0].messages.filter(m => m.content === 'Which should I start?').length, 1);
});

test('prompt carries a live snapshot and strips internal IDs from the transcript', async () => {
  const s = state(), requests = [];
  s.habits = [{ id: 'h1', name: 'Read', frequency: 'daily', streak: 3, bestStreak: 5, history: {} }];
  s.chatHistory = [
    { id: 'u-old', role: 'user', content: 'Hi', timestamp: '1' },
    { id: 'a-old', role: 'assistant', content: 'Start with Assignment 3 [task:task-003] today.', timestamp: '2', sources: [{ id: 'task-003', type: 'task', title: 'Assignment 3' }] },
  ];
  mockProvider([response('Hey! Your week looks busy.')], requests);
  const result = await AutonomousBrainAgent.execute('How is my week looking?', s);
  assert.equal(result.queryAnswer, 'Hey! Your week looks busy.');
  const system = requests[0].messages[0].content;
  assert.match(system, /## Current context/);
  assert.match(system, /Read — not yet today, 3-day streak \[habit:h1\]/);
  assert.match(system, /Open tasks: \d+ total/);
  const transcript = requests[0].messages.slice(1);
  assert.ok(transcript.every(m => !/User message ID|Source references|\[task:/.test(m.content)));
  assert.ok(transcript.some(m => m.content === 'Start with Assignment 3 today.'));
  assert.equal(requests[0].temperature, 0.7);
});

test('a reply cut off at the length limit is returned instead of discarded', async () => {
  const requests = [];
  mockProvider([{ choices: [{ finish_reason: 'length', message: { content: 'Here is a long plan' } }] }], requests);
  const result = await AutonomousBrainAgent.execute('Plan my semester', state());
  assert.equal(result.status, 'complete'); assert.match(result.queryAnswer, /^Here is a long plan[\s\S]*cut off/);
});

test('duplicate successful tool calls do not duplicate writes', async () => {
  const requests = [], saved = [], args = { title: 'Note', content: 'Body' };
  mockProvider([response(null, [call('create_note', args), call('create_note', args)]), response('Saved.')], requests);
  const result = await AutonomousBrainAgent.execute('Save this note', state(), undefined, undefined, { commit: async m => saved.push(m) });
  assert.equal(saved.length, 1); assert.equal(result.actions.length, 1);
});

test('follow-up task rename preserves the existing record and task count', async () => {
  const s = state(), requests = [], saved = [];
  const original = { ...s.tasks[0], title: 'Interview for Summer 2027 Internship Program – Software Engineering Intern',
    dueDate: '2026-11-08', priority: 'high', subtasks: [{ id: 'prep', title: 'Prepare', completed: true }] };
  s.tasks[0] = original;
  s.chatHistory = [
    { id: 'u', role: 'user', content: 'The company is Dow Jones. Put this interview in tasks.', timestamp: '1' },
    { id: 'a', role: 'assistant', content: `Created ${original.title}.`, timestamp: '2', sources: [{ id: original.id, type: 'task', title: original.title }] },
  ];
  mockProvider([
    response(null, [call('update_task', { taskId: original.id, newTitle: 'Dow Jones Interview' })]),
    response('Renamed the task to Dow Jones Interview.'),
  ], requests);
  const result = await AutonomousBrainAgent.execute('okay make the title shorter and needs to have Dow Jones thats the company', s, undefined, undefined, { commit: async m => saved.push(m) });
  assert.equal(result.status, 'complete'); assert.equal(saved.length, 1);
  assert.equal(saved[0].action, 'update_task');
  assert.deepEqual(saved[0].expected, original);
  const updated = applyMutation(s, saved[0]);
  assert.equal(updated.tasks.length, s.tasks.length);
  assert.deepEqual(updated.tasks.find(t => t.id === original.id), { ...original, title: 'Dow Jones Interview' });
  assert.equal(s.tasks[0].title, original.title);
  assert.ok(requests[0].messages[0].content.includes(`[task:${original.id}]`));
});

test('task renames validate titles and can combine with status and date edits', () => {
  const s = state();
  const schema = BRAIN_TOOLS.find(t => t.function.name === 'update_task').function.parameters;
  const args = { taskId: 'task-001', newTitle: '  Dow Jones Interview  ', status: 'completed', newDueDate: '2026-11-08' };
  validate(args, schema);
  const mutation = prepareMutation('update_task', args, s);
  assert.equal(mutation.record.title, 'Dow Jones Interview');
  assert.equal(mutation.record.status, 'completed'); assert.equal(mutation.record.completed, true);
  assert.equal(mutation.record.dueDate, '2026-11-08');
  assert.throws(() => prepareMutation('update_task', { taskId: 'task-001', newTitle: ' ' }, s), /nonempty/);
  assert.throws(() => prepareMutation('update_task', { taskId: 'task-001' }, s), /Supply/);
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

test('repeated reads stop exploration and synthesize an answer with tools disabled', async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    return Response.json(body.tool_choice === 'none'
      ? response('I found 105 tasks. I have their count, but not their descriptions, so I cannot explain each task yet.')
      : response(null, [call('query_records', { type: 'task', countOnly: true })]));
  };
  const result = await AutonomousBrainAgent.execute('Explain all my tasks', state());
  assert.equal(requests.length, 4); assert.equal(requests.at(-1).tool_choice, 'none');
  assert.equal(result.status, 'partial'); assert.match(result.queryAnswer, /105 tasks/);
  assert.doesNotMatch(result.queryAnswer, /Execution limit reached/); assert.equal(result.actions.length, 0);
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
    // Without IndexedDB, exactly one fallback copy is written for the account.
    assert.equal(JSON.parse(saved.get('synapse_user_data_test')).tasks.length, 105);
    assert.deepEqual([...saved.keys()].filter(k => k !== 'synapse_openrouter_key'), ['synapse_user_data_test']);
  } finally { globalThis.localStorage = previousStorage; console.warn = originalWarn; console.error = originalError; }
});

test('reloading a saved workspace preserves intentionally empty sections and folders', async () => {
  const { loadInitialState } = await server.ssrLoadModule('/src/services/storage.ts');
  const previousStorage = globalThis.localStorage;
  const saved = { ...state(), sections: [], subsections: {}, noteFolders: [], taskAppearance: { accent: 'teal', icons: { '["Work",null]': 'Rocket' }, subsections: { '["Work","General"]': { accent: 'blue', visual: 'book' } } } };
  globalThis.localStorage = { getItem(key) { return key === 'synapse_second_brain_state' ? JSON.stringify(saved) : null; } };
  try {
    const reloaded = await loadInitialState('test');
    assert.deepEqual(reloaded.taskAppearance, saved.taskAppearance);
    assert.deepEqual(reloaded.sections, []);
    assert.deepEqual(reloaded.noteFolders, []);
    assert.equal(reloaded.tasks.length, saved.tasks.length);
  } finally { globalThis.localStorage = previousStorage; }
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

test('a seven-task review retrieves details in one batch and then answers', async () => {
  const s = state(); s.tasks = s.tasks.slice(0, 7).map((task, index) => ({ ...task, description: `Deliverable ${index}`, subtasks: [{ id: `sub-${index}`, title: 'Prepare materials', completed: false }] }));
  const requests = [];
  mockProvider([
    response(null, [call('query_records', { type: 'task', status: 'pending' })]),
    response(null, [call('read_records', { type: 'task', ids: s.tasks.map(t => t.id) })]),
    response('Here are all seven tasks and their preparation steps.'),
  ], requests);
  const result = await AutonomousBrainAgent.execute('Explain all the tasks I need to do', s);
  assert.equal(result.status, 'complete'); assert.equal(requests.length, 3); assert.equal(result.citations.length, 7);
  const batch = JSON.parse(requests[2].messages.filter(m => m.role === 'tool').at(-1).content);
  assert.equal(batch.records.length, 7); assert.ok(batch.records.every(r => r.content.includes('Prepare materials')));
});

test('batch reads validate bounds and expose continuation for long records', async () => {
  const schema = BRAIN_TOOLS.find(t => t.function.name === 'read_records').function.parameters;
  assert.throws(() => validate({ type: 'task', ids: [] }, schema));
  assert.throws(() => validate({ type: 'task', ids: Array(11).fill('task-001') }, schema));
  const s = state(); s.tasks[0].description = 'Detailed requirements '.repeat(500);
  const { output, sources } = await executeRead('read_records', { type: 'task', ids: ['task-000', 'missing'] }, s, '');
  assert.equal(output.records[0].nextOffset, 4000); assert.equal(output.records[0].content.length, 4000);
  assert.equal(output.records[1].error, 'Record not found'); assert.equal(sources.length, 1);
});

test('legitimate pagination makes progress instead of triggering the repetition detector', async () => {
  const requests = [];
  mockProvider([
    response(null, [call('query_records', { type: 'task', offset: 0 })]),
    response(null, [call('query_records', { type: 'task', offset: 40 })]),
    response(null, [call('query_records', { type: 'task', offset: 80 })]),
    response('I reviewed all 105 task summaries.'),
  ], requests);
  const result = await AutonomousBrainAgent.execute('List my tasks', state());
  assert.equal(result.status, 'complete'); assert.equal(result.citations.length, 105);
  assert.ok(requests.every(r => r.tool_choice === 'auto'));
});

test('repeated tool errors produce a final explanation instead of exhausting 48 rounds', async () => {
  const requests = [];
  mockProvider([
    response(null, [call('read_record', { type: 'task', id: 'missing' })]),
    response(null, [call('read_record', { type: 'task', id: 'missing' })]),
    response('That task could not be found. No records were changed.'),
  ], requests);
  const result = await AutonomousBrainAgent.execute('Explain that task', state());
  assert.equal(result.status, 'partial'); assert.equal(requests.at(-1).tool_choice, 'none'); assert.equal(result.actions.length, 0);
});

test('read caches are invalidated after a successful mutation', async () => {
  const requests = [];
  mockProvider([
    response(null, [call('read_record', { type: 'task', id: 'task-001' })]),
    response(null, [call('update_task', { taskId: 'task-001', status: 'completed' })]),
    response(null, [call('read_record', { type: 'task', id: 'task-001' })]),
    response('The task is now completed.'),
  ], requests);
  const result = await AutonomousBrainAgent.execute('Complete and verify the task', state(), undefined, undefined, { commit: async () => {} });
  assert.equal(result.status, 'complete'); assert.equal(result.actions.length, 1);
  const resultAfterWrite = JSON.parse(requests[3].messages.filter(m => m.role === 'tool').at(-1).content);
  assert.match(resultAfterWrite.content, /"status": "completed"/);
});

test('a changing long-running review reserves its last round to answer', async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    return Response.json(body.tool_choice === 'none'
      ? response('I reviewed 47 records; the remaining records have not yet been inspected.')
      : response(null, [call('read_record', { type: 'task', id: `task-${String(requests.length - 1).padStart(3, '0')}` })]));
  };
  const result = await AutonomousBrainAgent.execute('Review everything', state());
  assert.equal(requests.length, 48); assert.equal(requests.at(-1).tool_choice, 'none');
  assert.equal(result.status, 'partial'); assert.equal(result.citations.length, 47); assert.match(result.queryAnswer, /remaining/);
});

test('providers that ignore disabled tools cannot start another execution loop', async () => {
  let count = 0;
  globalThis.fetch = async () => { count++; return Response.json(response(null, [call('query_records', { type: 'task', countOnly: true })])); };
  const result = await AutonomousBrainAgent.execute('Review tasks', state());
  assert.equal(count, 4); assert.equal(result.status, 'error'); assert.match(result.queryAnswer, /provider did not return an answer/i);
});

test('equivalent read arguments cannot evade progress checks by changing key order or defaults', async () => {
  const requests = [];
  mockProvider([
    response(null, [call('query_records', { type: 'task', status: 'pending' })]),
    response(null, [call('query_records', { status: 'pending', type: 'task', offset: 0 })]),
    response(null, [call('query_records', { countOnly: false, offset: 0, type: 'task', status: 'pending' })]),
    response('Here is what the retrieved task summaries show.'),
  ], requests);
  const result = await AutonomousBrainAgent.execute('Explain my tasks', state());
  assert.equal(result.status, 'partial'); assert.equal(requests.at(-1).tool_choice, 'none');
});

test('final synthesis never replays successful writes', async () => {
  const requests = [], writes = [], args = { title: 'Plan', content: 'Prepare the presentation.' };
  mockProvider([
    response(null, [call('create_note', args)]),
    response(null, [call('create_note', args)]),
    response(null, [call('create_note', args)]),
    response('Your plan is saved.'),
  ], requests);
  const result = await AutonomousBrainAgent.execute('Save my plan', state(), undefined, undefined, { commit: async mutation => writes.push(mutation) });
  assert.equal(writes.length, 1); assert.equal(result.actions.length, 1); assert.equal(requests.at(-1).tool_choice, 'none');
});

test('provider pagination variants retrieve tasks instead of failing integer validation', async () => {
  for (const offset of ['0', null, '', '0.0', 0]) {
    const s = state(); s.tasks = s.tasks.slice(0, 7);
    const requests = [];
    mockProvider([
      response(null, [call('query_records', { type: 'task', status: 'pending', offset, dateFrom: null, dateTo: null, section: null, text: null, countOnly: 'false' })]),
      response('Here are your seven pending tasks.'),
    ], requests);
    const result = await AutonomousBrainAgent.execute('Explain all my tasks due soon', s);
    const toolResult = JSON.parse(requests[1].messages.find(m => m.role === 'tool').content);
    assert.equal(toolResult.error, undefined, `offset ${JSON.stringify(offset)} should not fail`);
    assert.equal(toolResult.records.length, 7);
    assert.equal(result.status, 'complete'); assert.equal(result.citations.length, 7);
  }
});

test('all read cursors accept unambiguous numeric strings and absent optional values', () => {
  for (const name of ['query_records', 'read_record', 'search_records', 'recall_conversation']) {
    const schema = BRAIN_TOOLS.find(t => t.function.name === name).function.parameters;
    const base = name === 'query_records' ? { type: 'task' } : name === 'read_record' ? { type: 'task', id: 'task-001' } : name === 'search_records' ? { query: 'coursework' } : {};
    assert.equal(parseToolArguments(JSON.stringify({ ...base, offset: '40' }), schema).offset, 40);
    assert.equal(parseToolArguments(JSON.stringify({ ...base, offset: null }), schema).offset, undefined);
    for (const offset of [-1, '-1', 1.5, '1.5', true, 'NaN', 'Infinity', '1,000', 'next', {}, '9007199254740993', '9007199254740990.5']) {
      assert.throws(() => parseToolArguments(JSON.stringify({ ...base, offset }), schema), `${name} should reject ${JSON.stringify(offset)}`);
    }
  }
});

test('provider normalization preserves required fields, unknown-field rejection and mutation safety', () => {
  const query = BRAIN_TOOLS.find(t => t.function.name === 'query_records').function.parameters;
  const update = BRAIN_TOOLS.find(t => t.function.name === 'update_task').function.parameters;
  assert.deepEqual(parseToolArguments(JSON.stringify({ type: 'task', offset: '0', countOnly: 'false', section: null }), query), { type: 'task', offset: 0, countOnly: false });
  assert.deepEqual(parseToolArguments(JSON.stringify({ taskId: '001', status: null, newDueDate: '2026-11-02' }), update), { taskId: '001', newDueDate: '2026-11-02' });
  assert.throws(() => parseToolArguments(JSON.stringify({ type: null }), query));
  assert.throws(() => parseToolArguments(JSON.stringify({ type: 'task', unknown: null }), query));
  assert.throws(() => parseToolArguments(JSON.stringify({ taskId: 1, status: 'completed' }), update));
  assert.throws(() => parseToolArguments(JSON.stringify({ taskId: null, status: 'completed' }), update));
  assert.throws(() => parseToolArguments(JSON.stringify({ taskId: 'task-001', status: 'finished' }), update));
});

test('archived conversations stay within the cloud size budget, newest first', async () => {
  const { boundConversations, MAX_ARCHIVED_CONVERSATIONS, ARCHIVE_CHAR_BUDGET } = await server.ssrLoadModule('/src/utils/conversationBudget.ts');
  const thread = (i, size) => ({ id: `c${i}`, title: `Chat ${i}`, updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    messages: [{ id: `m${i}`, role: 'user', content: 'x'.repeat(size), timestamp: '1', sources: Array.from({ length: 60 }, (_, j) => ({ id: `t${j}`, type: 'task', title: 'T' })) }] });
  const many = Array.from({ length: 80 }, (_, i) => thread(i, 100));
  const bounded = boundConversations(many);
  assert.equal(bounded.length, MAX_ARCHIVED_CONVERSATIONS); assert.equal(bounded[0].id, 'c79');
  assert.ok(bounded.every(t => t.messages.every(m => m.sources.length <= 40)));
  const big = boundConversations(Array.from({ length: 10 }, (_, i) => thread(i, 200000)));
  assert.ok(JSON.stringify(big).length <= ARCHIVE_CHAR_BUDGET); assert.equal(big[0].id, 'c9');
  const small = [thread(1, 10)]; small[0].messages[0].sources = [];
  assert.equal(boundConversations(small), small, 'unchanged input keeps identity');
  const huge = boundConversations([{ ...thread(1, 0), messages: Array.from({ length: 20 }, (_, i) => ({ id: `h${i}`, role: 'user', content: 'y'.repeat(100000), timestamp: '1' })) }]);
  assert.equal(huge.length, 1); assert.equal(huge[0].messages.at(-1).id, 'h19'); assert.ok(JSON.stringify(huge).length <= ARCHIVE_CHAR_BUDGET + 1000);
});

test('vault indexing coalesces rapid saves and embeds unchanged text once', async () => {
  const { vectorVault } = await server.ssrLoadModule('/src/services/vectorVault.ts');
  let calls = 0;
  globalThis.fetch = async (url, opts) => { calls++; return Response.json({ data: [{ embedding: Array.from({ length: 1536 }, (_, i) => (i % 7) / 7 + JSON.parse(opts.body).input.length) }] }); };
  const note = (content) => ({ id: 'n1', title: 'Draft', subject: 'Draft', content, summary: '', status: 'Synthesized', tags: [] });
  const results = await Promise.all(['a', 'ab', 'abc'].map(c => vectorVault.indexItem(note(c), 'knowledge', 'key', 5)));
  assert.equal(calls, 1); assert.equal(results.filter(Boolean).length, 1);
  await vectorVault.indexItem(note('abc'), 'knowledge', 'key', 0);
  assert.equal(calls, 1, 'unchanged content is not re-embedded');
  const pending = vectorVault.indexItem(note('abcd'), 'knowledge', 'key', 20);
  await vectorVault.removeItem('n1');
  assert.equal(await pending, null); assert.equal(calls, 1, 'deleted items are not indexed later');
});

const { rememberImage } = await server.ssrLoadModule('/src/utils/imageInput.ts');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const image = (name = 'Screenshot 1') => ({ id: crypto.randomUUID(), name, mimeType: 'image/png', width: 1, height: 1, thumbnail: pixel, dataUrl: pixel });
function visionProvider(responses, requests, visionModels = ['test/vision']) {
  globalThis.fetch = async (url, opts) => {
    if (/\/models$/.test(url)) return Response.json({ data: [...visionModels, 'test/model'].map(id => ({ id, architecture: { input_modalities: visionModels.includes(id) ? ['text', 'image'] : ['text'] } })) });
    assert.match(url, /chat\/completions$/);
    requests.push(JSON.parse(opts.body));
    const next = responses.shift();
    assert.ok(next, 'Unexpected additional provider call');
    return Response.json(next);
  };
}

test('vision-capable chat models receive attached images directly, plus recent session images', async () => {
  const s = state(), requests = [];
  const earlier = image('Earlier chart');
  rememberImage(earlier);
  s.chatHistory = [
    { id: 'u0', role: 'user', content: 'What does this show?', timestamp: '1', attachments: [{ id: earlier.id, name: earlier.name, mimeType: 'image/png', width: 1, height: 1 }] },
    { id: 'a0', role: 'assistant', content: 'A rising trend.', timestamp: '2' },
  ];
  visionProvider([response('The new chart dips in March.')], requests);
  const current = image('Revenue chart');
  const result = await AutonomousBrainAgent.execute('Compare with this one', s, 'key', 'test/vision', { images: [current] });
  assert.equal(result.status, 'complete'); assert.equal(result.imageDescription, undefined);
  const last = requests[0].messages.at(-1);
  assert.ok(Array.isArray(last.content));
  assert.equal(last.content[0].text, 'Compare with this one');
  assert.ok(last.content.some(p => p.type === 'image_url' && p.image_url.url === pixel));
  const history = requests[0].messages.find(m => Array.isArray(m.content) && m.content[0].text === 'What does this show?');
  assert.ok(history?.content.some(p => p.type === 'image_url'), 'earlier session image stays viewable');
  assert.match(requests[0].messages[0].content, /## Images/);
});

test('text-only chat models get a vision-model description, kept for follow-ups', async () => {
  const s = state(), requests = [], saved = [];
  visionProvider([
    response('CS 2110 Homework 5 due Friday Nov 14, 11:59 PM on Canvas.'),
    response(null, [call('create_task', { title: 'CS 2110 Homework 5', section: 'Academic', priority: 'high', dueDate: '2026-11-14', description: 'Due 11:59 PM on Canvas' })]),
    response('Added **CS 2110 Homework 5**, due Fri Nov 14.'),
  ], requests);
  const result = await AutonomousBrainAgent.execute('', s, 'key', 'test/model', { images: [image()], visionModel: 'test/vision', commit: async m => saved.push(m) });
  assert.equal(result.status, 'complete');
  assert.equal(requests[0].model, 'test/vision');
  assert.ok(requests[0].messages[0].content.some(p => p.type === 'image_url'));
  assert.equal(requests[1].model, 'test/model');
  const sent = requests[1].messages.at(-1).content;
  assert.equal(typeof sent, 'string'); assert.match(sent, /only the image/); assert.match(sent, /Homework 5 due Friday/);
  assert.ok(!JSON.stringify(requests[1]).includes('base64'), 'text-only model never receives image data');
  assert.match(result.imageDescription, /Homework 5/);
  assert.equal(saved.length, 1); assert.equal(saved[0].record.description, 'Due 11:59 PM on Canvas'); assert.equal(saved[0].record.dueDate, '2026-11-14');
  // After reload the description stands in for the image.
  const later = state(), requests2 = [];
  later.chatHistory = [{ id: 'u1', role: 'user', content: '', timestamp: '1', attachments: [{ id: 'gone', name: 'Screenshot 1', mimeType: 'image/png', width: 1, height: 1 }], imageDescription: result.imageDescription }];
  mockProvider([response('It was due Nov 14.')], requests2);
  await AutonomousBrainAgent.execute('When was that due?', later, 'key', 'test/model');
  assert.ok(requests2[0].messages.some(m => m.role === 'user' && /described by a vision model[\s\S]*Homework 5/.test(m.content)));
});

test('a failed image read reports the error and saves nothing', async () => {
  const requests = [];
  globalThis.fetch = async (url) => /\/models$/.test(url) ? Response.json({ data: [] }) : new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 });
  const result = await AutonomousBrainAgent.execute('add this', state(), 'key', 'test/model', { images: [image()], visionModel: 'bad/model', commit: async () => requests.push(1) });
  assert.equal(result.status, 'error'); assert.match(result.queryAnswer, /couldn’t read the image with bad\/model[\s\S]*No changes were saved/);
  assert.equal(requests.length, 0);
});

test('update_task can replace a task description', () => {
  const s = state();
  const mutation = prepareMutation('update_task', { taskId: 'task-001', newDescription: 'Room 204, bring laptop' }, s);
  const original = s.tasks.find(t => t.id === 'task-001');
  assert.equal(mutation.record.description, 'Room 204, bring laptop');
  assert.equal(mutation.record.title, original.title); assert.equal(mutation.record.dueDate, original.dueDate);
});

test('new mutation tools validate targets and apply goal, note, habit, tracker and delete changes', () => {
  const s = state();
  s.goals = [{ id: 'g1', title: 'Land internship', sector: 'career', timeframe: 'yearly', progress: 0, status: 'not_started', createdAt: '2026-01-01',
    milestones: [{ id: 'm1', title: 'Polish resume', completed: false }, { id: 'm2', title: 'Apply to 20 roles', completed: false }] }];
  s.knowledgeItems = [{ id: 'n1', subject: 'Graphs', title: 'Graphs', content: '# Graphs\n\nBFS uses a queue.', summary: '', startDate: '2026-10-01', endDate: '2026-10-01', status: 'Draft' }];
  s.trackerItems = [];
  const parse = (name, args) => parseToolArguments(JSON.stringify(args), BRAIN_TOOLS.find(t => t.function.name === name).function.parameters);

  const goal = prepareMutation('update_goal', parse('update_goal', { goalId: 'g1', completeMilestones: ['polish resume'], addMilestones: ['Mock interviews'] }), s);
  assert.deepEqual(goal.record.milestones.map(m => m.completed), [true, false, false]);
  assert.equal(goal.record.progress, 33); assert.equal(goal.record.status, 'in_progress');
  assert.throws(() => prepareMutation('update_goal', { goalId: 'g1', completeMilestones: ['Nonexistent'] }, s), /Milestone not found/);

  const note = prepareMutation('update_note', parse('update_note', { noteId: 'n1', appendContent: 'DFS uses a stack.' }), s);
  assert.equal(note.record.content, '# Graphs\n\nBFS uses a queue.\n\nDFS uses a stack.');
  const html = prepareMutation('update_note', { noteId: 'n1', appendContent: 'a < b' }, { ...s, knowledgeItems: [{ ...s.knowledgeItems[0], content: '<p>Hi</p>' }] });
  assert.equal(html.record.content, '<p>Hi</p><p>a &lt; b</p>');
  assert.throws(() => prepareMutation('update_note', { noteId: 'n1', appendContent: 'x', replaceContent: 'y' }, s), /not both/);

  const habit = prepareMutation('create_habit', parse('create_habit', { name: 'Read 20 pages', frequency: 'daily' }), s);
  assert.equal(habit.record.streak, 0); assert.deepEqual(habit.record.history, {});

  const app = prepareMutation('create_tracker_item', parse('create_tracker_item', { kind: 'job_application', title: 'SWE Intern', company: 'Acme', appliedDate: '2026-11-01' }), s);
  assert.equal(app.record.status, 'applied'); assert.equal(app.record.subject, 'Acme'); assert.equal(app.record.fields.appliedDate, '2026-11-01');
  assert.throws(() => prepareMutation('create_tracker_item', { kind: 'leetcode', title: 'Two Sum', status: 'offer' }, s), /not valid/);
  assert.throws(() => prepareMutation('create_tracker_item', { kind: 'job_application', title: 'SWE', company: 'Acme', url: 'javascript:alert(1)' }, s), /http/);
  const withApp = applyMutation(s, app);
  const moved = prepareMutation('update_tracker_item', { trackerId: app.record.id, status: 'onsite', appendNotes: 'Onsite Nov 20' }, withApp);
  assert.equal(applyMutation(withApp, moved).trackerItems[0].status, 'onsite');

  const del = prepareMutation('delete_task', parse('delete_task', { taskId: 'task-003' }), s);
  const after = applyMutation(s, del);
  assert.equal(after.tasks.length, 104); assert.ok(!after.tasks.some(t => t.id === 'task-003'));
  assert.throws(() => prepareMutation('delete_task', { taskId: 'missing' }, s), /not found/);
});

test('search indexes readable prose, ranks rare terms with BM25 and splits notes at headings', async () => {
  const s = state();
  s.knowledgeItems = [{ id: 'n1', subject: 'Algorithms', title: 'Algorithms', status: 'Draft', summary: '', startDate: '2026-10-01', endDate: '2026-10-01',
    content: `# Sorting\n\n${'Merge sort splits the array. '.repeat(50)}\n\n# Graphs\n\n${'Dijkstra finds shortest paths with a priority queue. '.repeat(30)}` }];
  const [task] = records(s, 'task');
  assert.doesNotMatch(task.index, /"id"|task-000|"completed": false/, 'Index text has no JSON keys or IDs');
  assert.match(task.index, /^Task: Assignment 0\nNot started, medium priority, Academic, due 2026-10-29/);
  const passages = chunks(records(s, 'knowledge')[0]);
  assert.ok(passages.length >= 3);
  assert.ok(passages.some(p => p.snippet.startsWith('Algorithms > Graphs\n')), 'Passages carry their heading path');
  globalThis.fetch = async () => new Response('', { status: 503 });
  // "status" used to match every record through its JSON key; now nothing mentions it.
  assert.equal((await searchRecords(s, 'status', undefined, 0, 'k')).total, 0);
  const result = await searchRecords(s, 'shortest path dijkstra', 'knowledge', 0, 'k');
  assert.match(result.results[0].snippet, /Graphs/); assert.equal(result.results[0].offset, undefined);
});

test('anthropic requests cache the system prefix and roll a breakpoint onto the newest message', async () => {
  const { queryOpenRouterWithTools } = await server.ssrLoadModule('/src/services/openrouter.ts');
  const bodies = [];
  globalThis.fetch = async (_url, opts) => { bodies.push(JSON.parse(opts.body)); return Response.json(response('ok')); };
  const system = { role: 'system', content: 'x'.repeat(5000) + '\n\n## Current context\nToday' };
  const turn = [system, { role: 'user', content: 'Hi' }, { role: 'assistant', content: null, tool_calls: [call('query_records', { type: 'task' }, 'c1')] }, { role: 'tool', tool_call_id: 'c1', content: '{"total":1}' }];
  await queryOpenRouterWithTools(turn, [], 'k', 'anthropic/claude-sonnet-5.5');
  const sent = bodies[0].messages;
  assert.equal(sent[0].content[0].cache_control.type, 'ephemeral'); assert.equal(sent[0].content[1].cache_control, undefined);
  assert.deepEqual(sent.at(-1).content, [{ type: 'text', text: '{"total":1}', cache_control: { type: 'ephemeral' } }]);
  assert.equal(sent[1].content, 'Hi', 'Only the newest message carries the rolling breakpoint');
  assert.equal(turn.at(-1).content, '{"total":1}', 'Caller messages are not mutated');
  await queryOpenRouterWithTools(turn, [], 'k', 'google/gemini-3.8-flash');
  assert.equal(bodies[1].messages.at(-1).content, '{"total":1}', 'Other providers are untouched');
});

test('calendar events and task due times: tools validate, snapshot and search expose them', async () => {
  const { lifeSnapshot } = await server.ssrLoadModule('/src/services/agentDispatcher.ts');
  const { normalizeEvents, formatTime } = await server.ssrLoadModule('/src/utils/events.ts');
  const { getLocalDateString } = await server.ssrLoadModule('/src/utils/habitStreaks.ts');
  const today = getLocalDateString();
  const s = { ...state(), events: [] };
  const parse = (name, args) => parseToolArguments(JSON.stringify(args), BRAIN_TOOLS.find(t => t.function.name === name).function.parameters);

  // Task due times
  const task = prepareMutation('create_task', parse('create_task', { title: 'HW 5', section: 'Academic', priority: 'high', dueDate: today, dueTime: '23:59' }), s);
  assert.equal(task.record.dueTime, '23:59');
  assert.throws(() => prepareMutation('create_task', { title: 'X', section: 'Academic', priority: 'low', dueTime: '23:59' }, s), /needs a dueDate/);
  assert.throws(() => prepareMutation('create_task', { title: 'X', section: 'Academic', priority: 'low', dueDate: today, dueTime: '11:59 PM' }, s), /HH:MM/);
  const withTask = applyMutation(s, task);
  const moved = prepareMutation('update_task', parse('update_task', { taskId: task.record.id, newDueTime: '17:00' }), withTask);
  assert.equal(moved.record.dueTime, '17:00');
  const cleared = prepareMutation('update_task', parse('update_task', { taskId: task.record.id, clearDueTime: true }), withTask);
  assert.equal('dueTime' in cleared.record, false);
  assert.equal(normalizeTask({ id: 'a', title: 'a', dueDate: '', dueTime: '10:00' }).dueTime, undefined, 'A time without a date is dropped');
  assert.equal(formatTime('23:59'), '11:59 PM'); assert.equal(formatTime('00:05'), '12:05 AM'); assert.equal(formatTime('12:00'), '12:00 PM');

  // Events
  const event = prepareMutation('create_event', parse('create_event', { title: 'Office hours', kind: 'meeting', date: today, startTime: '14:00', endTime: '15:30', location: 'Klaus 1447', attendees: ['Prof. Smith'], link: 'https://meet.example.com/x' }), s);
  assert.equal(event.type, 'event'); assert.equal(event.record.endTime, '15:30');
  for (const bad of [{ date: today, startTime: '15:00', endTime: '14:00' }, { date: today, endTime: '14:00' }, { date: '2026-02-30' }, { date: today, link: 'javascript:alert(1)' }, { date: today, kind: 'party' }])
    assert.throws(() => prepareMutation('create_event', { title: 'Bad', ...bad }, s));
  const withEvent = applyMutation(withTask, event);
  assert.equal(withEvent.events.length, 1);
  const shifted = prepareMutation('update_event', parse('update_event', { eventId: event.record.id, newStartTime: '16:00' }), withEvent);
  assert.equal(shifted.record.startTime, '16:00'); assert.equal(shifted.record.endTime, '17:30', 'Rescheduling keeps the duration');
  const allDay = prepareMutation('update_event', { eventId: event.record.id, allDay: true }, withEvent);
  assert.equal(allDay.record.startTime, undefined); assert.equal(allDay.record.endTime, undefined);
  assert.equal(applyMutation(withEvent, prepareMutation('delete_event', { eventId: event.record.id }, withEvent)).events.length, 0);
  assert.throws(() => prepareMutation('update_event', { eventId: 'missing', newTitle: 'x' }, withEvent), /not found/);

  // What the model sees
  const snapshot = lifeSnapshot(withEvent);
  assert.match(snapshot, /Events today \(1\):\n- Office hours — today, 2:00 PM – 3:30 PM, at Klaus 1447, with Prof\. Smith \(meeting\) \[event:/);
  assert.match(snapshot, /HW 5 — \d{4}-\d{2}-\d{2} 11:59 PM, high/);
  const { output } = await executeRead('query_records', { type: 'event', dateFrom: today, dateTo: today }, withEvent, '');
  assert.equal(output.total, 1); assert.equal(output.records[0].location, 'Klaus 1447'); assert.equal(output.records[0].startTime, '14:00');
  const [indexed] = records(withEvent, 'event');
  assert.match(indexed.index, /^Meeting: Office hours\n.*2:00 PM – 3:30 PM\nLocation: Klaus 1447\nWith: Prof\. Smith/);

  // Stored data is normalized, never trusted
  const normalized = normalizeEvents([{ id: 'e', title: ' Lunch ', date: today, startTime: '12:00', endTime: '11:00', link: 'ftp://x', kind: 'weird' }, { id: 'e', title: 'dupe', date: today }, { id: 'bad', title: 'x', date: 'soon' }]);
  assert.equal(normalized.length, 1); assert.equal(normalized[0].title, 'Lunch'); assert.equal(normalized[0].kind, 'event');
  assert.equal(normalized[0].endTime, undefined); assert.equal(normalized[0].link, undefined);
});

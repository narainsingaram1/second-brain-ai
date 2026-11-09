import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ cacheDir: '/tmp/synapse-suggestions-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const { localStarters, starterContext, starterFingerprint, parseStarters, parseFollowUps, generateFollowUps } = await server.ssrLoadModule('/src/services/chatSuggestions.ts');

const today = '2026-11-09';
const task = (id, dueDate, extra = {}) => ({ id, title: `Task ${id}`, status: 'not_started', completed: false, dueDate, priority: 'medium', section: 'Academic', subsection: 'CS 2110', ...extra });
const base = (extra = {}) => ({ userId: 'u', tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], trackerItems: [], events: [], chatHistory: [], sections: [], subsections: {}, openRouterKey: 'k', selectedModel: '', theme: 'light', ...extra });
const goal = { id: 'g', title: 'Land a research role', status: 'in_progress', progress: 30, milestones: [] };

test('starters name the user\'s real work and cover different areas', () => {
  const starters = localStarters(base({ tasks: [task('late', '2026-11-05'), task('soon', '2026-11-10')], goals: [goal] }), undefined, today);
  assert.equal(starters.length, 4);
  assert.match(starters[0].title, /Finish Task late/);
  assert.ok(starters.some(s => s.title.includes('Land a research role')));
  assert.ok(starters.some(s => s.detail === 'Due tomorrow'));
});

test('finished work is never suggested, and a new account gets useful first steps', () => {
  const done = localStarters(base({ tasks: [task('x', '2026-11-05', { status: 'completed', completed: true })] }), undefined, today);
  assert.ok(!done.some(s => s.title.includes('Task x')));
  assert.equal(done.length, 3);
  assert.ok(done.some(s => s.title === 'Add my classes'));
});

test('the snapshot leaves out sensitive memories and all memory when it is off', () => {
  const entry = (id, topic, content) => ({ id, topic, category: 'fact', content, pinned: false, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', sources: [{ conversationId: 'c', messageId: 'm', excerpt: 'e' }] });
  const entries = [entry('a', 'major', 'Studies CS at Georgia Tech'), entry('b', 'health', 'Has a medical diagnosis of ADHD')];
  const on = starterContext(base({ agentMemory: { version: 1, enabled: true, automaticLearning: true, entries, suppressed: [] } }), { calendar: false, gmail: false }, new Date('2026-11-09T12:00:00'));
  assert.ok(!JSON.stringify(on.aboutThem).includes('diagnosis'));
  const off = starterContext(base({ agentMemory: { version: 1, enabled: false, automaticLearning: false, entries, suppressed: [] } }), { calendar: false, gmail: false });
  assert.deepEqual(off.aboutThem, []);
});

test('the fingerprint changes with what is coming up, not with distant tasks', () => {
  const state = base({ tasks: [task('a', '2026-11-10')] });
  assert.equal(starterFingerprint(state, today), starterFingerprint({ ...state, tasks: [...state.tasks, task('far', '2027-02-01')] }, today));
  assert.notEqual(starterFingerprint(state, today), starterFingerprint({ ...state, tasks: [...state.tasks, task('b', '2026-11-11')] }, today));
});

test('model output is cleaned: bad entries dropped, filler and repeats removed', () => {
  assert.deepEqual(parseStarters([{ kind: 'nope', title: 'A real one', detail: 'Due soon.', prompt: 'Do it' }, { title: 'A real one', detail: 'x', prompt: 'y' }, { title: 'Missing rest' }, null]),
    [{ kind: 'idea', title: 'A real one', detail: 'Due soon', prompt: 'Do it' }]);
  assert.deepEqual(parseFollowUps(['"Make it due Friday."', 'Tell me more', 'add it', 'Make it due Friday', 7, 'x'.repeat(200), 'Break it into steps', 'Fourth', 'Fifth'], ['Add it']),
    ['Make it due Friday', 'Break it into steps', 'Fourth']);
  assert.deepEqual(parseFollowUps('nope'), []);
});

test('follow-ups come from the exchange, use the fast model, and fail quietly', async () => {
  const realFetch = globalThis.fetch;
  try {
    let sent;
    globalThis.fetch = async (_, init) => {
      sent = JSON.parse(init.body);
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'suggest_follow_ups', arguments: JSON.stringify({ followUps: ['Make it due Friday'] }) } }] }, finish_reason: 'tool_calls' }] });
    };
    const signal = new AbortController().signal;
    const turn = { question: 'add a task to update simplify', answer: 'Added it.', earlierQuestions: [], changes: ['create_task: Update simplify'] };
    assert.deepEqual(await generateFollowUps(base(), turn, signal), ['Make it due Friday']);
    assert.match(sent.model, /haiku/);
    assert.match(JSON.stringify(sent.messages[1]), /create_task: Update simplify/);
    assert.deepEqual(await generateFollowUps(base({ openRouterKey: '' }), turn, signal), []);
  } finally { globalThis.fetch = realFetch; }
});

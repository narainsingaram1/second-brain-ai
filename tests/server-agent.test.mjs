import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { owner, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';
import { pgStore, pgTransport } from './helpers/pgStore.mjs';

const server = await createServer({ cacheDir: '/tmp/synapse-server-agent-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const { agentHandlers } = await load('/server/routes/agent.ts');
const { sealSecret } = await load('/server/lib/crypto.ts');
const { HttpError } = await load('/server/lib/http.ts');
const { RecordSync, PreferencesConflict } = await load('/src/services/recordSync.ts');
const { readEvents } = await load('/src/services/remoteAgent.ts');

const secretsKey = Buffer.alloc(32, 9).toString('base64');
const providerKey = 'sk-or-v1-server-held-test-key-ABCD';
const sse = (...events) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
const toolCall = (name, args) => sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: crypto.randomUUID(), function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });
const answer = text => sse({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] });
const workspace = { tasks: [{ id: 'essay', title: 'Write essay', status: 'not_started', completed: false, priority: 'medium', section: 'Academic', dueDate: '2026-11-10' }],
  goals: [], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [], sections: ['Academic'], subsections: { Academic: ['General'] }, selectedModel: 'test/model' };

async function setup() {
  const { db, asUser } = await supabaseLikeDatabase();
  await asUser(owner);
  await db.query('select public.save_brain($1::jsonb, 0, $2::uuid)', [JSON.stringify(workspace), owner]);
  const store = pgStore(db, owner, PreferencesConflict, HttpError);
  await store.putSecret('openrouter', { ...(await sealSecret(secretsKey, owner, 'openrouter', providerKey)), hint: 'ABCD' });
  const routes = agentHandlers({ caller: async () => ({ userId: owner, store }), secretsKey: () => secretsKey });
  return { db, routes };
}
const message = (content) => ({ id: crypto.randomUUID(), role: 'user', content, timestamp: '10:00' });
async function turn(routes, content, history = []) {
  const response = await routes.POST(new Request('http://app/api/agent', { method: 'POST', body: JSON.stringify({ message: message(content), chatHistory: history, conversationId: 'thread-1' }) }));
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const events = [];
  for await (const event of readEvents(response.body)) events.push(event);
  return events;
}

test('server agent saves changes per record, audits them, and the browser adopts them without re-uploading', async () => {
  const { db, routes } = await setup();
  try {
    const browser = new RecordSync(pgTransport(db, undefined, PreferencesConflict));
    let browserState = await browser.load();
    const provider = [];
    globalThis.fetch = async (url, init) => {
      provider.push({ url, auth: init.headers.Authorization });
      return provider.length === 1 ? toolCall('update_task', { taskId: 'essay', status: 'completed' }) : answer('Marked your essay as done.');
    };
    const events = await turn(routes, 'I finished the essay');
    assert.ok(provider.every(p => p.url === 'https://openrouter.ai/api/v1/chat/completions' && p.auth === `Bearer ${providerKey}`), 'the provider is called with the decrypted key on the server');
    const saved = events.find(e => e.type === 'saved');
    assert.equal(saved.action, 'update_task'); assert.equal(saved.entityType, 'task'); assert.equal(saved.title, 'Write essay');
    assert.deepEqual(saved.records.map(r => [r.collection, r.id, r.revision]), [['tasks', 'essay', 2]]);
    assert.ok(events.some(e => e.type === 'text' && e.text === 'Marked your essay as done.'), 'the answer streams');
    const done = events.at(-1);
    assert.equal(done.type, 'done'); assert.equal(done.result.queryAnswer, 'Marked your essay as done.'); assert.equal(done.result.actions.length, 1);
    assert.equal((await db.query("select data->>'status' as s from public.brain_records where id = 'essay'")).rows[0].s, 'completed');
    assert.deepEqual((await db.query('select actor, action, entity_id from public.audit_events')).rows, [{ actor: 'assistant', action: 'update_task', entity_id: 'essay' }]);
    assert.ok(!JSON.stringify(events).includes(providerKey), 'the key never appears in the stream');

    browserState = browser.adopt(browserState, saved.records, saved.preferences);
    assert.equal(browserState.tasks[0].status, 'completed');
    assert.equal(browser.hasUnsavedChanges(browserState), false, 'adopted changes are not uploaded again');
    assert.equal(await browser.refresh(() => browserState), null, 'and not re-applied as remote changes');
  } finally { await db.close(); }
});

test('server agent never overwrites a record another device changed during the turn', async () => {
  const { db, routes } = await setup();
  try {
    const otherDevice = new RecordSync(pgTransport(db, undefined, PreferencesConflict));
    const otherState = await otherDevice.load();
    let call = 0;
    globalThis.fetch = async () => {
      call++;
      if (call === 1) {
        // While the assistant is deciding, the user renames the task on their phone.
        await otherDevice.save({ ...otherState, tasks: [{ ...otherState.tasks[0], title: 'Write essay (phone edit)' }] });
        return toolCall('update_task', { taskId: 'essay', newTitle: 'Draft essay' });
      }
      return answer('I could not rename it because it changed on another device.');
    };
    const events = await turn(routes, 'Rename the essay task to Draft essay');
    assert.equal(events.filter(e => e.type === 'saved').length, 0);
    assert.equal(events.at(-1).result.actions.length, 0);
    assert.equal((await db.query("select data->>'title' as t from public.brain_records where id = 'essay'")).rows[0].t, 'Write essay (phone edit)');
  } finally { await db.close(); }
});

test('server agent rejects bad requests before running and needs a stored key', async () => {
  const { db, routes } = await setup();
  try {
    const post = body => routes.POST(new Request('http://app/api/agent', { method: 'POST', body: JSON.stringify(body) }));
    assert.equal((await post({ message: { id: 'x', role: 'assistant', content: 'hi' } })).status, 400);
    assert.equal((await post({ message: message('hi'), chatHistory: Array.from({ length: 401 }, () => message('x')) })).status, 400);
    assert.equal((await post({ message: message('hi'), images: [{ name: 'x', dataUrl: 'javascript:alert(1)' }] })).status, 400);
    await db.query("delete from public.user_secrets");
    assert.equal((await post({ message: message('hi') })).status, 412);
  } finally { await db.close(); }
});

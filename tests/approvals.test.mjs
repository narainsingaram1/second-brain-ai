import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { owner, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';
import { pgStore } from './helpers/pgStore.mjs';

const server = await createServer({ cacheDir: '/tmp/synapse-approvals-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const { approvalReason, toolTier, describeMutation } = await load('/src/services/actionPolicy.ts');
const { AutonomousBrainAgent } = await load('/src/services/agentDispatcher.ts');
const { prepareMutation } = await load('/src/services/brainTools.ts');
const { agentHandlers } = await load('/server/routes/agent.ts');
const { actionsHandlers } = await load('/server/routes/actions.ts');
const { sealSecret } = await load('/server/lib/crypto.ts');
const { HttpError } = await load('/server/lib/http.ts');
const { PreferencesConflict } = await load('/src/services/recordSync.ts');
const { readEvents } = await load('/src/services/remoteAgent.ts');

const ctx = (over = {}) => ({ untrustedRead: false, changes: 0, askBeforeChanges: false, ...over });

test('approval policy: reads and memory run, deletions and risky changes wait, unknown tools are external', () => {
  assert.equal(approvalReason('query_records', ctx({ askBeforeChanges: true })), null);
  assert.equal(approvalReason('remember_memory', ctx({ untrustedRead: true, changes: 9 })), null);
  assert.equal(approvalReason('update_task', ctx()), null);
  assert.match(approvalReason('delete_task', ctx()), /Deleting/);
  assert.match(approvalReason('update_task', ctx({ askBeforeChanges: true })), /every change/);
  assert.match(approvalReason('update_note', ctx({ untrustedRead: true })), /uploaded document/);
  assert.equal(approvalReason('create_flashcard_deck', ctx({ untrustedRead: true })), null, 'adding records after reading a document is allowed');
  assert.equal(approvalReason('create_task', ctx({ changes: 4 })), null);
  assert.match(approvalReason('create_task', ctx({ changes: 5 })), /more than 5/);
  assert.equal(toolTier('post_to_slack'), 'external_irreversible', 'an unclassified tool is treated as irreversible');
  assert.match(approvalReason('post_to_slack', ctx()), /always need your approval/);
  assert.equal(toolTier('send_email'), 'external_irreversible');
  assert.match(approvalReason('send_email', ctx()), /always needs your approval/);
});

const tasks = [{ id: 'essay', title: 'Write essay', status: 'not_started', completed: false, priority: 'medium', section: 'Academic', dueDate: '2026-11-10' }];
const state = (over = {}) => ({ userId: 'u', tasks, goals: [], habits: [], journalEntries: [], knowledgeItems: [], trackerItems: [], sections: ['Academic'], subsections: { Academic: ['General'] },
  noteFolders: [], chatHistory: [], openRouterKey: 'k', selectedModel: 'm', theme: 'light', ...over });
const call = (name, args) => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (content, tool_calls) => Response.json({ choices: [{ finish_reason: tool_calls ? 'tool_calls' : 'stop', message: { content, tool_calls } }] });

test('the agent turns a gated call into a proposal and never runs it', async () => {
  const requests = [], commits = [], proposals = [];
  const replies = [reply(null, [call('delete_task', { taskId: 'essay' })]), reply('Deleting the essay task is waiting for your approval below.')];
  globalThis.fetch = async (_url, opts) => { requests.push(JSON.parse(opts.body)); return replies.shift(); };
  const result = await AutonomousBrainAgent.execute('Delete the essay task', state(), 'k', 'm', {
    commit: async m => { commits.push(m); },
    propose: async change => { proposals.push(change); return { id: 'p1', tool: change.tool, summary: change.summary, details: change.details, reason: change.reason, status: 'pending', remote: false, mutation: change.mutation }; },
  });
  assert.equal(commits.length, 0);
  assert.equal(proposals[0].summary, 'Delete task "Write essay"');
  assert.equal(result.approvals[0].id, 'p1');
  const toolMessage = requests[1].messages.find(m => m.role === 'tool');
  assert.equal(JSON.parse(toolMessage.content).status, 'awaiting_approval', 'the model is told nothing was saved');

  // Without a way to ask, the gated change is refused rather than run.
  const replies2 = [reply(null, [call('delete_task', { taskId: 'essay' })]), reply('I could not delete it.')];
  globalThis.fetch = async () => replies2.shift();
  const refused = await AutonomousBrainAgent.execute('Delete the essay task', state(), 'k', 'm', { commit: async m => { commits.push(m); } });
  assert.equal(commits.length, 0); assert.equal(refused.approvals, undefined);

  // "Ask before every change" gates ordinary edits too.
  const replies3 = [reply(null, [call('update_task', { taskId: 'essay', status: 'completed' })]), reply('Waiting for approval.')];
  globalThis.fetch = async () => replies3.shift();
  const asked = await AutonomousBrainAgent.execute('Mark the essay done', state({ preferences: { askBeforeChanges: true } }), 'k', 'm', { commit: async m => { commits.push(m); }, propose: async c => ({ id: 'p2', ...c, status: 'pending', remote: false }) });
  assert.equal(commits.length, 0);
  assert.deepEqual(asked.approvals[0].details, ['Status: not_started → completed', 'Completed: false → true']);
});

test('describing a change lists exactly the fields that change', () => {
  const s = state();
  const m = prepareMutation('update_task', { taskId: 'essay', newTitle: 'Final essay', newDueDate: '2026-11-12' }, s);
  const { summary, details } = describeMutation('update_task', m);
  assert.equal(summary, 'Update task "Write essay"');
  assert.deepEqual(details.sort(), ['Due date: 2026-11-10 → 2026-11-12', 'Title: Write essay → Final essay']);
});

const secretsKey = Buffer.alloc(32, 5).toString('base64');
const sse = (...events) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

test('server approvals: proposed by the agent, approved once by the user, refused if the record changed', async () => {
  const { db, asUser } = await supabaseLikeDatabase();
  try {
    await asUser(owner);
    const blob = { tasks: [...tasks, { ...tasks[0], id: 'reading', title: 'Do the reading' }], goals: [], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [], sections: ['Academic'], subsections: { Academic: ['General'] } };
    await db.query('select public.save_brain($1::jsonb, 0, $2::uuid)', [JSON.stringify(blob), owner]);
    const store = pgStore(db, owner, PreferencesConflict, HttpError);
    await store.putSecret('openrouter', { ...(await sealSecret(secretsKey, owner, 'openrouter', 'sk-or-v1-approval-test-key-0001')), hint: '0001' });
    const deps = { caller: async () => ({ userId: owner, store }), secretsKey: () => secretsKey };
    const agent = agentHandlers(deps), actions = actionsHandlers(deps);

    const runTurn = async (calls) => {
      let n = 0;
      globalThis.fetch = async () => n++ === 0 ? sse({ choices: [{ delta: { tool_calls: calls.map((c, index) => ({ index, ...c })) }, finish_reason: 'tool_calls' }] })
        : sse({ choices: [{ delta: { content: 'Waiting for your approval.' }, finish_reason: 'stop' }] });
      const response = await agent.POST(new Request('http://app/api/agent', { method: 'POST', body: JSON.stringify({ message: { id: crypto.randomUUID(), role: 'user', content: 'Clean up my tasks' }, chatHistory: [] }) }));
      const events = []; for await (const e of readEvents(response.body)) events.push(e);
      return events.at(-1).result;
    };
    const result = await runTurn([call('delete_task', { taskId: 'essay' }), call('delete_task', { taskId: 'reading' })]);
    assert.equal(result.approvals.length, 2);
    assert.equal(result.actions.length, 0);
    assert.equal((await db.query("select count(*)::int as n from public.brain_records where collection = 'tasks' and not deleted")).rows[0].n, 2, 'nothing deleted yet');
    const [first, second] = result.approvals;
    assert.ok(first.remote && /^[0-9a-f]{64}$/.test(first.payloadHash));

    const decide = (approval, decision, hash = approval.payloadHash) => actions.POST(new Request('http://app/api/actions', { method: 'POST', body: JSON.stringify({ id: approval.id, decision, payloadHash: hash }) }));
    assert.equal((await decide(first, 'approve', 'f'.repeat(64))).status, 409, 'a different payload is never approved');
    const approved = await (await decide(first, 'approve')).json();
    assert.equal(approved.status, 'executed');
    assert.deepEqual(approved.records.map(r => [r.id, r.data]), [['essay', null]]);
    assert.equal((await decide(first, 'approve')).status, 409, 'an approval runs once');
    assert.equal((await db.query("select deleted from public.brain_records where id = 'essay'")).rows[0].deleted, true);

    // The second task is edited on another device before the user approves its deletion.
    await db.query(`select public.save_records($1::jsonb)`, [JSON.stringify([{ collection: 'tasks', id: 'reading', baseRevision: 1, data: { ...tasks[0], id: 'reading', title: 'Do the reading (updated)' } }])]);
    const stale = await (await decide(second, 'approve')).json();
    assert.equal(stale.status, 'failed'); assert.match(stale.error, /changed after this was proposed/);
    assert.equal((await db.query("select deleted from public.brain_records where id = 'reading'")).rows[0].deleted, false, 'the edited task survives');

    const rejectedTurn = await runTurn([call('delete_task', { taskId: 'reading' })]);
    assert.deepEqual(await (await decide(rejectedTurn.approvals[0], 'reject')).json(), { status: 'rejected' });
    assert.equal((await db.query("select deleted from public.brain_records where id = 'reading'")).rows[0].deleted, false);

    const trail = (await db.query('select actor, action from public.audit_events order by id')).rows.map(r => `${r.actor}:${r.action}`);
    assert.deepEqual(trail, ['assistant:proposed', 'assistant:proposed', 'user:approved', 'system:executed', 'assistant:delete_task', 'user:approved', 'system:failed', 'assistant:proposed', 'user:rejected']);
  } finally { await db.close(); }
});

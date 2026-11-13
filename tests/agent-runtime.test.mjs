// The agent runtime: plans it must finish, batches of changes that land whole or not at all, and a check
// that the reply never claims a change that did not happen.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { owner, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';
import { pgStore } from './helpers/pgStore.mjs';

const server = await createServer({ cacheDir: '/tmp/synapse-runtime-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const { AutonomousBrainAgent } = await load('/src/services/agentDispatcher.ts');
const { prepareBatch, applyBatch, batchApprovalReason, parseBatchArguments, BatchError } = await load('/src/services/batchChanges.ts');
const { TaskPlan, claimsUnbackedChange } = await load('/src/services/agentPlan.ts');
const { agentHandlers } = await load('/server/routes/agent.ts');
const { actionsHandlers } = await load('/server/routes/actions.ts');
const { sealSecret } = await load('/server/lib/crypto.ts');
const { HttpError } = await load('/server/lib/http.ts');
const { PreferencesConflict } = await load('/src/services/recordSync.ts');
const { readEvents } = await load('/src/services/remoteAgent.ts');

const task = (id, title, over = {}) => ({ id, title, status: 'not_started', completed: false, priority: 'medium', section: 'Academic', dueDate: '2026-11-20', ...over });
const tasks = [task('essay', 'Write essay'), task('reading', 'Do the reading'), task('lab', 'Lab report'), task('pset', 'Problem set'),
  task('slides', 'Make slides'), task('review', 'Review notes'), task('quiz', 'Quiz prep')];
const state = (over = {}) => ({ userId: 'u', tasks, goals: [], habits: [], journalEntries: [], knowledgeItems: [], trackerItems: [], sections: ['Academic'], subsections: { Academic: ['General'] },
  noteFolders: [], chatHistory: [], openRouterKey: 'k', selectedModel: 'm', theme: 'light', ...over });
const call = (name, args) => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (content, tool_calls) => Response.json({ choices: [{ finish_reason: tool_calls ? 'tool_calls' : 'stop', message: { content, tool_calls } }] });
function provider(replies) {
  const requests = [];
  globalThis.fetch = async (_url, opts) => {
    requests.push(JSON.parse(opts.body));
    const next = replies.shift();
    assert.ok(next, 'Unexpected additional provider call');
    return next;
  };
  return requests;
}
const toolResult = (request, index = 0) => JSON.parse(request.messages.filter(m => m.role === 'tool')[index].content);
const text = m => typeof m.content === 'string' ? m.content : (m.content || []).map(p => p.text || '').join('');
const runtimeNotes = request => request.messages.filter(m => m.role === 'user' && text(m).includes('<synapse_runtime>')).map(m => ({ content: text(m) }));
const proposer = proposals => async change => { proposals.push(change); return { id: `p${proposals.length}`, tool: change.tool, summary: change.summary, details: change.details, reason: change.reason, status: 'pending', remote: false, mutation: change.mutations ?? change.mutation }; };

test('a batch is prepared in order against the changes before it and applied whole', () => {
  const s = state();
  const batch = prepareBatch([
    { tool: 'update_task', args: { taskId: 'essay', newTitle: 'Write history essay' } },
    { tool: 'update_task', args: { taskId: 'essay', status: 'completed' } },
    { tool: 'create_task', args: { title: 'Email TA', priority: 'medium', section: 'Academic', subsection: 'Office hours' } },
  ], s);
  assert.equal(batch.mutations.length, 3);
  assert.equal(batch.mutations[1].expected.title, 'Write history essay', 'the second change saw the first');
  const next = applyBatch(s, batch.mutations);
  const essay = next.tasks.find(t => t.id === 'essay');
  assert.equal(essay.title, 'Write history essay'); assert.equal(essay.status, 'completed');
  assert.ok(next.tasks.some(t => t.title === 'Email TA' && t.subsection === 'Office hours'));
  assert.ok(next.subsections.Academic.includes('Office hours'));

  // Edited elsewhere before it was applied: nothing lands.
  const edited = state({ tasks: tasks.map(t => t.id === 'essay' ? { ...t, title: 'Changed on phone' } : t) });
  assert.throws(() => applyBatch(edited, batch.mutations), /edited in the meantime/);
});

test('an invalid change stops the whole batch and every failure is named', () => {
  try {
    prepareBatch([
      { tool: 'update_task', args: { taskId: 'essay', status: 'completed' } },
      { tool: 'update_task', args: { taskId: 'missing', status: 'completed' } },
      { tool: 'send_email', args: {} },
      { tool: 'update_task', args: { taskId: 'lab', bogus: 1 } },
    ], state());
    assert.fail('expected a BatchError');
  } catch (error) {
    assert.ok(error instanceof BatchError);
    assert.deepEqual(error.failures.map(f => f.index), [1, 2, 3]);
    assert.match(error.message, /^Nothing was saved/);
    assert.match(error.message, /#2 update_task: Task ID not found/);
    assert.match(error.message, /#3 send_email: "send_email" is not a change tool/);
  }
  assert.throws(() => prepareBatch([], state()), /at least one/);
  assert.throws(() => prepareBatch(Array.from({ length: 51 }, () => ({ tool: 'create_task', args: { title: 'x' } })), state()), /At most 50/);
  assert.deepEqual(parseBatchArguments(JSON.stringify({ changes: [{ tool: 'create_task', args: '{"title":"x"}' }] })).changes[0].args, { title: 'x' }, 'stringified args are accepted');
  assert.throws(() => parseBatchArguments('{"changes":[],"also":1}'), /Unknown apply_changes argument/);
});

test('batch approval: one reason for the whole batch', () => {
  const ctx = { untrustedRead: false, changes: 0, askBeforeChanges: false };
  const updates = n => Array.from({ length: n }, (_, i) => ({ tool: 'update_task', args: { taskId: tasks[i].id, status: 'completed' } }));
  assert.equal(batchApprovalReason(updates(5), ctx), null, 'five ordinary changes run');
  assert.match(batchApprovalReason(updates(6), ctx), /more than 5/);
  assert.match(batchApprovalReason([...updates(1), { tool: 'delete_task', args: { taskId: 'lab' } }], ctx), /Deleting/);
  assert.match(batchApprovalReason(updates(2), { ...ctx, untrustedRead: true }), /could contain instructions/);
  assert.equal(batchApprovalReason([{ tool: 'create_task', args: { title: 'x' } }], { ...ctx, untrustedRead: true }), null, 'adding after reading is still allowed');
});

test('the agent saves a batch in one write and reports each change', async () => {
  const requests = provider([
    reply(null, [call('apply_changes', { changes: [
      { tool: 'update_task', args: { taskId: 'essay', newDueDate: '2026-11-21' } },
      { tool: 'update_task', args: { taskId: 'reading', newDueDate: '2026-11-21' } },
      { tool: 'update_task', args: { taskId: 'lab', newDueDate: '2026-11-21' } },
    ] })]),
    reply('Moved all three to Saturday.'),
  ]);
  const batches = [], singles = [];
  const result = await AutonomousBrainAgent.execute('Move essay, reading and lab to Saturday', state(), 'k', 'm', {
    commit: async m => { singles.push(m); }, commitBatch: async ms => { batches.push(ms); }, propose: proposer([]),
  });
  assert.equal(singles.length, 0); assert.equal(batches.length, 1); assert.equal(batches[0].length, 3);
  assert.equal(result.actions.length, 3);
  const output = toolResult(requests[1]);
  assert.equal(output.saved, true); assert.equal(output.count, 3);
  assert.match(output.changes[0].summary, /Update task "Write essay"/);
  assert.equal(result.queryAnswer, 'Moved all three to Saturday.');
  assert.ok(result.activity.some(s => s.kind === 'change' && /Made 3 changes together/.test(s.label)));
});

test('a failed batch saves nothing and the agent fixes and resends it', async () => {
  const good = { tool: 'update_task', args: { taskId: 'essay', status: 'completed' } };
  const requests = provider([
    reply(null, [call('apply_changes', { changes: [good, { tool: 'update_task', args: { taskId: 'nope', status: 'completed' } }] })]),
    reply(null, [call('apply_changes', { changes: [good, { tool: 'update_task', args: { taskId: 'reading', status: 'completed' } }] })]),
    reply('Both are checked off.'),
  ]);
  const batches = [];
  const result = await AutonomousBrainAgent.execute('Mark essay and reading done', state(), 'k', 'm', { commit: async () => {}, commitBatch: async ms => { batches.push(ms); } });
  assert.match(toolResult(requests[1]).error, /Nothing was saved.*#2/);
  assert.equal(batches.length, 1, 'only the corrected batch was saved');
  assert.deepEqual(batches[0].map(m => m.record.id), ['essay', 'reading']);
  assert.equal(result.actions.length, 2);
});

test('a large batch becomes one approval covering every change', async () => {
  const changes = tasks.map(t => ({ tool: 'update_task', args: { taskId: t.id, priority: undefined, status: 'in_progress' } })).map(c => ({ ...c, args: { taskId: c.args.taskId, status: 'in_progress' } }));
  const requests = provider([reply(null, [call('apply_changes', { changes })]), reply('Starting all seven is waiting for your approval below.')]);
  const proposals = [], batches = [];
  const result = await AutonomousBrainAgent.execute('Start everything', state(), 'k', 'm', { commit: async () => {}, commitBatch: async ms => { batches.push(ms); }, propose: proposer(proposals) });
  assert.equal(batches.length, 0, 'nothing saved before approval');
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].tool, 'apply_changes');
  assert.equal(proposals[0].mutations.length, 7);
  assert.equal(proposals[0].summary, 'Apply 7 changes');
  assert.equal(proposals[0].details.length, 7);
  assert.equal(result.approvals.length, 1);
  assert.equal(toolResult(requests[1]).status, 'awaiting_approval');
});

test('the plan is shown live and the turn cannot end with steps left open', async () => {
  const requests = provider([
    reply(null, [call('update_plan', { steps: [{ title: 'Find overdue tasks', status: 'in_progress' }, { title: 'Move them to Friday', status: 'pending' }] })]),
    reply('All done, your overdue tasks are on Friday.'),
    reply(null, [call('apply_changes', { changes: [{ tool: 'update_task', args: { taskId: 'essay', newDueDate: '2026-11-20' } }] }),
      call('update_plan', { steps: [{ title: 'Find overdue tasks', status: 'done' }, { title: 'Move them to Friday', status: 'done' }] })]),
    reply('Moved your essay to Friday.'),
  ]);
  const steps = [];
  const result = await AutonomousBrainAgent.execute('Move my overdue tasks to Friday', state(), 'k', 'm', { commit: async () => {}, commitBatch: async () => {}, onStep: s => steps.push(s) });
  assert.equal(runtimeNotes(requests[2]).length, 1, 'the early reply was sent back to finish the plan');
  assert.match(runtimeNotes(requests[2])[0].content, /"Find overdue tasks", "Move them to Friday"/);
  assert.equal(result.queryAnswer, 'Moved your essay to Friday.');
  const planStep = result.activity.find(s => s.kind === 'plan');
  assert.deepEqual(planStep.plan.map(p => p.status), ['done', 'done']);
  assert.ok(steps.some(s => s.kind === 'plan' && s.plan[0].status === 'in_progress'), 'progress was streamed while working');
});

test('plan nudges are bounded so a stuck model still replies', async () => {
  provider([
    reply(null, [call('update_plan', { steps: [{ title: 'Do the thing', status: 'pending' }] })]),
    reply('First try.'), reply('Second try.'), reply('I could not finish the thing.'),
  ]);
  const result = await AutonomousBrainAgent.execute('Do the thing', state(), 'k', 'm', { commit: async () => {} });
  assert.equal(result.queryAnswer, 'I could not finish the thing.');
});

test('plans must explain skipped steps and cannot repeat a step', () => {
  const plan = new TaskPlan();
  assert.throws(() => plan.set([{ title: 'A', status: 'skipped' }]), /Say why/);
  assert.throws(() => plan.set([{ title: 'A', status: 'pending' }, { title: 'a', status: 'pending' }]), /twice/);
  plan.set([{ title: 'A', status: 'done' }, { title: 'B', status: 'blocked', note: 'Needs a date from you' }]);
  assert.equal(plan.unfinished().length, 0);
  assert.equal(plan.completionNudge(), null);
});

test('a reply claiming a change that never happened is sent back once', async () => {
  const requests = provider([reply("I've added \"Call mom\" to your tasks for Friday."), reply(null, [call('create_task', { title: 'Call mom', priority: 'medium', section: 'Academic', dueDate: '2026-11-20' })]), reply('Added "Call mom" for Friday.')]);
  const commits = [];
  const result = await AutonomousBrainAgent.execute('Remind me to call mom friday', state(), 'k', 'm', { commit: async m => { commits.push(m); } });
  assert.equal(runtimeNotes(requests[1]).length, 1);
  assert.equal(commits.length, 1);
  assert.equal(result.queryAnswer, 'Added "Call mom" for Friday.');

  // Checked once only: a second identical claim goes through rather than looping.
  provider([reply("I've added it."), reply("I've added it.")]);
  assert.equal((await AutonomousBrainAgent.execute('ok', state(), 'k', 'm', { commit: async () => {} })).queryAnswer, "I've added it.");
});

test('claim check: offers, approvals and real changes are not claims', () => {
  const none = { saved: 0, proposed: 0, external: 0, memory: 0 };
  assert.equal(claimsUnbackedChange("I've moved your essay to Friday.", none), true);
  assert.equal(claimsUnbackedChange('Done! I updated the deadline.', none), true);
  assert.equal(claimsUnbackedChange('Want me to add these as tasks?', none), false);
  assert.equal(claimsUnbackedChange("I've prepared the deletion; approve it below once you're ready.", none), false);
  assert.equal(claimsUnbackedChange('You have three tasks due Friday. The essay matters most.', none), false);
  assert.equal(claimsUnbackedChange('Your essay has been moved to Friday.', none), true);
  assert.equal(claimsUnbackedChange('All set, added both to your calendar.', none), true);
  assert.equal(claimsUnbackedChange('The essay was assigned last week and is worth 20%.', none), false);
  assert.equal(claimsUnbackedChange('I think the lab is the hardest one.', none), false);
  assert.equal(claimsUnbackedChange('If you want, I can move it to Friday.', none), false);
  assert.equal(claimsUnbackedChange("I've moved your essay to Friday.", { ...none, saved: 1 }), false);
});

const secretsKey = Buffer.alloc(32, 7).toString('base64');
const sse = (...events) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

test('server: a batch approval is stored once, re-checked and applied whole', async () => {
  const { db, asUser } = await supabaseLikeDatabase();
  try {
    await asUser(owner);
    const blob = { tasks, goals: [], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [], sections: ['Academic'], subsections: { Academic: ['General'] } };
    await db.query('select public.save_brain($1::jsonb, 0, $2::uuid)', [JSON.stringify(blob), owner]);
    const store = pgStore(db, owner, PreferencesConflict, HttpError);
    await store.putSecret('openrouter', { ...(await sealSecret(secretsKey, owner, 'openrouter', 'sk-or-v1-runtime-test-key-0001')), hint: '0001' });
    const deps = { caller: async () => ({ userId: owner, store }), secretsKey: () => secretsKey };
    const runTurn = async changes => {
      let n = 0;
      globalThis.fetch = async () => n++ === 0
        ? sse({ choices: [{ delta: { tool_calls: [{ index: 0, ...call('apply_changes', { changes }) }] }, finish_reason: 'tool_calls' }] })
        : sse({ choices: [{ delta: { content: 'Waiting for your approval.' }, finish_reason: 'stop' }] });
      const response = await agentHandlers(deps).POST(new Request('http://app/api/agent', { method: 'POST', body: JSON.stringify({ message: { id: crypto.randomUUID(), role: 'user', content: 'Clean up' }, chatHistory: [] }) }));
      const events = []; for await (const e of readEvents(response.body)) events.push(e);
      return events.at(-1).result;
    };
    const decide = approval => actionsHandlers(deps).POST(new Request('http://app/api/actions', { method: 'POST', body: JSON.stringify({ id: approval.id, decision: 'approve', payloadHash: approval.payloadHash }) }));
    const live = async () => (await db.query("select id, data from public.brain_records where collection = 'tasks' and not deleted order by id")).rows;

    const turn = await runTurn([{ tool: 'delete_task', args: { taskId: 'essay' } }, { tool: 'update_task', args: { taskId: 'lab', status: 'completed' } }]);
    assert.equal(turn.approvals.length, 1); assert.equal(turn.actions.length, 0);
    assert.equal((await live()).length, 7, 'nothing changed before approval');
    const done = await (await decide(turn.approvals[0])).json();
    assert.equal(done.status, 'executed');
    const after = await live();
    assert.ok(!after.some(r => r.id === 'essay'));
    assert.equal(after.find(r => r.id === 'lab').data.status, 'completed');

    // One task in the batch is edited elsewhere before approval: none of the batch is applied.
    const stale = await runTurn([{ tool: 'delete_task', args: { taskId: 'reading' } }, { tool: 'update_task', args: { taskId: 'pset', status: 'completed' } }]);
    const pset = (await live()).find(r => r.id === 'pset');
    await db.query('select public.save_records($1::jsonb)', [JSON.stringify([{ collection: 'tasks', id: 'pset', baseRevision: 1, data: { ...pset.data, title: 'Problem set 5' } }])]);
    const refused = await (await decide(stale.approvals[0])).json();
    assert.equal(refused.status, 'failed'); assert.match(refused.error, /none were applied/);
    const now = await live();
    assert.ok(now.some(r => r.id === 'reading'), 'the deletion in the refused batch did not happen');
    assert.equal(now.find(r => r.id === 'pset').data.status, 'not_started');
  } finally { await db.close(); }
});

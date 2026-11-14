import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { owner, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';
import { pgStore } from './helpers/pgStore.mjs';

const server = await createServer({ cacheDir: '/tmp/synapse-routines-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const { dueSlot, nextRun, conditionHolds, describeSchedule } = await load('/src/utils/routines.ts');
const { prepareMutation, applyMutation } = await load('/src/services/brainTools.ts');
const { approvalReason } = await load('/src/services/actionPolicy.ts');
const { conversationAreas } = await load('/src/services/toolRouting.ts');
const { runRoutine, runDueRoutines } = await load('/server/lib/routines.ts');
const { routinesHandlers } = await load('/server/routes/routines.ts');
const { loadWorkspace, saveWorkspace } = await load('/server/lib/serverAgent.ts');
const { sealSecret } = await load('/server/lib/crypto.ts');
const { HttpError } = await load('/server/lib/http.ts');
const { PreferencesConflict } = await load('/src/services/recordSync.ts');

const NY = 'America/New_York';
const routine = (over = {}) => ({ id: 'r1', name: 'Morning plan', instructions: 'Plan my day.', frequency: 'weekdays', time: '08:00', timeZone: NY,
  onlyIf: 'always', mode: 'act', notify: true, enabled: true, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', ...over });
// Friday 2026-11-13, in New York (UTC-5).
const at = local => new Date(`${local}-05:00`);

test('a routine is due from its time for three hours, once per local day, on the days it runs', () => {
  assert.equal(dueSlot(routine(), at('2026-11-13T07:59')), null, 'not before its time');
  assert.equal(dueSlot(routine(), at('2026-11-13T08:00')), '2026-11-13');
  assert.equal(dueSlot(routine(), at('2026-11-13T10:45')), '2026-11-13', 'a late wake still runs it');
  assert.equal(dueSlot(routine(), at('2026-11-13T11:00')), null, 'but not hours later');
  assert.equal(dueSlot(routine(), at('2026-11-14T08:15')), null, 'weekdays skip Saturday');
  assert.equal(dueSlot(routine({ enabled: false }), at('2026-11-13T08:15')), null, 'paused routines never run');
  assert.equal(dueSlot(routine({ frequency: 'weekly', days: [0, 5] }), at('2026-11-13T08:15')), '2026-11-13');
  assert.equal(dueSlot(routine({ frequency: 'weekly', days: [1] }), at('2026-11-13T08:15')), null);
  assert.equal(dueSlot(routine({ frequency: 'monthly', dayOfMonth: 31 }), new Date('2026-11-30T13:30:00Z')), '2026-11-30', 'the 31st means the last day of shorter months');
  assert.equal(dueSlot(routine({ timeZone: 'Asia/Tokyo' }), new Date('2026-11-12T23:30:00Z')), '2026-11-13', 'the schedule is read in its own time zone');
  assert.deepEqual(nextRun(routine(), at('2026-11-13T09:00')), { date: '2026-11-16', time: '08:00' }, 'after Friday morning comes Monday');
  assert.equal(nextRun(routine({ enabled: false }), at('2026-11-13T09:00')), null);
  assert.equal(describeSchedule(routine({ frequency: 'weekly', days: [0, 3], time: '18:00' })), 'Sundays and Wednesdays at 6:00 PM');
  assert.equal(describeSchedule(routine({ frequency: 'monthly', dayOfMonth: 22 })), 'Monthly on the 22nd at 8:00 AM');
});

test('conditions are plain rules over tasks and events', () => {
  const tasks = [{ id: 'a', title: 'Lab', dueDate: '2026-11-12', status: 'not_started', completed: false }, { id: 'b', title: 'Essay', dueDate: '2026-11-15', status: 'completed', completed: true }];
  assert.equal(conditionHolds('overdue_tasks', tasks, [], '2026-11-13'), true);
  assert.equal(conditionHolds('overdue_tasks', tasks, [], '2026-11-12'), false);
  assert.equal(conditionHolds('due_soon', tasks, [], '2026-11-13'), false, 'completed work does not count');
  assert.equal(conditionHolds('due_today', tasks, [], '2026-11-12'), true);
  assert.equal(conditionHolds('events_today', [], [{ id: 'e', date: '2026-11-13' }], '2026-11-13'), true);
});

test('the assistant creates, changes and deletes routines with checked schedules; deleting waits for approval', () => {
  let state = { tasks: [], routines: [] };
  const created = prepareMutation('create_routine', { name: 'Weekly review', instructions: 'Review my week.', frequency: 'weekly', time: '18:00', days: [0], timeZone: NY, mode: 'suggest' }, state);
  assert.equal(created.type, 'routine');
  assert.deepEqual({ ...created.record, id: 'x', createdAt: '', updatedAt: '' }, { id: 'x', name: 'Weekly review', instructions: 'Review my week.', frequency: 'weekly', time: '18:00', days: [0],
    timeZone: NY, onlyIf: 'always', mode: 'suggest', notify: true, enabled: true, createdAt: '', updatedAt: '' });
  state = applyMutation(state, created);
  const id = state.routines[0].id;
  assert.throws(() => prepareMutation('create_routine', { name: 'weekly review', instructions: 'x', frequency: 'daily', time: '09:00' }, state), /already exists/);
  assert.throws(() => prepareMutation('create_routine', { name: 'B', instructions: 'x', frequency: 'weekly', time: '09:00' }, state), /need days/);
  assert.throws(() => prepareMutation('create_routine', { name: 'B', instructions: 'x', frequency: 'daily', time: '9am' }, state), /HH:MM/);
  assert.throws(() => prepareMutation('create_routine', { name: 'B', instructions: 'x', frequency: 'daily', time: '09:00', timeZone: 'Mars/Base' }, state), /time zone/);
  const paused = prepareMutation('update_routine', { routineId: id, enabled: false, frequency: 'daily' }, state);
  assert.equal(paused.record.enabled, false); assert.equal(paused.record.days, undefined, 'days only apply to weekly routines');
  assert.deepEqual(paused.expected, state.routines[0]);
  state = applyMutation(state, paused);
  const del = prepareMutation('delete_routine', { routineId: id }, state);
  assert.match(approvalReason('delete_routine', { untrustedRead: false, changes: 0, askBeforeChanges: false }), /approval/);
  assert.equal(approvalReason('create_routine', { untrustedRead: false, changes: 0, askBeforeChanges: false }), null);
  assert.equal(applyMutation(state, del).routines.length, 0);
  assert.ok(conversationAreas('every weekday morning plan my day', []).has('routines'), 'routine tools are offered when the user asks for something recurring');
  assert.ok(!conversationAreas('what is due today?', []).has('routines'));
});

// ---- On the server ----

const secretsKey = Buffer.alloc(32, 9).toString('base64');
const sse = (...events) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
const toolCall = (name, args) => sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: crypto.randomUUID(), function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });
const answer = text => sse({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] });
const base = { tasks: [{ id: 'lab', title: 'Lab report', status: 'not_started', completed: false, priority: 'high', section: 'Academic', dueDate: '2026-11-10' }],
  goals: [], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [], sections: ['Academic'], subsections: { Academic: ['General'] }, selectedModel: 'test/model' };

async function setup(routines) {
  const { db, asUser } = await supabaseLikeDatabase();
  await asUser(owner);
  await db.query('select public.save_brain($1::jsonb, 0, $2::uuid)', [JSON.stringify(base), owner]);
  const store = pgStore(db, owner, PreferencesConflict, HttpError);
  await store.putSecret('openrouter', { ...(await sealSecret(secretsKey, owner, 'openrouter', 'sk-or-v1-test-key-ABCD')), hint: 'ABCD' });
  const { engine, workspace } = await loadWorkspace(store);
  await saveWorkspace(engine, { ...workspace, routines });
  return { db, store, deps: { secretsKey: () => secretsKey, caller: async () => ({ userId: owner, store }) } };
}

test('database: routine records are validated and each slot can be claimed once', async () => {
  const { db, store } = await setup([routine()]);
  try {
    assert.equal((await db.query("select count(*)::int as n from public.brain_records where collection = 'routines'")).rows[0].n, 1);
    const bad = [{ collection: 'routines', id: 'bad', baseRevision: 0, data: { ...routine({ id: 'bad' }), frequency: 'hourly' } }];
    await assert.rejects(() => db.query('select public.save_records($1::jsonb)', [JSON.stringify(bad)]));
    const first = await store.claimRoutineRun('r1', '2026-11-13');
    assert.ok(first);
    assert.equal(await store.claimRoutineRun('r1', '2026-11-13'), null, 'a slot never runs twice');
    await store.finishRoutineRun(first, { status: 'done', summary: 'Planned.', changes: 2 });
    const [run] = await store.listRoutineRuns(10);
    assert.equal(run.status, 'done'); assert.equal(run.changes, 2); assert.equal(run.summary, 'Planned.');
  } finally { await db.close(); }
});

test('a scheduled run works unattended, keeps suggest-mode changes for approval, reports in its own chat, and never runs twice', async () => {
  const r = routine({ mode: 'suggest', onlyIf: 'overdue_tasks' });
  const { db, store, deps } = await setup([r]);
  const realFetch = globalThis.fetch;
  try {
    const requests = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return requests.length === 1 ? toolCall('update_task', { taskId: 'lab', newDueDate: '2026-11-16' }) : answer('Your lab report is overdue. I proposed moving it to Monday.');
    };
    const check = { tasks: base.tasks, events: [] };
    const outcome = await runRoutine(deps, store, r, '2026-11-13', { date: '2026-11-13', check });
    assert.equal(outcome.status, 'done');
    assert.equal(outcome.changes, 0); assert.equal(outcome.approvals, 1, 'suggest mode turns the change into an approval');
    assert.equal((await db.query("select data->>'dueDate' as d from public.brain_records where id = 'lab'")).rows[0].d, '2026-11-10', 'nothing changed yet');
    assert.equal((await store.listPendingActions()).length, 1);
    const offered = requests[0].tools.map(t => t.function.name);
    assert.ok(!offered.some(n => n.endsWith('_routine')), 'a routine cannot create or change routines');
    assert.match(JSON.stringify(requests[0].messages[0]), /scheduled run/, 'the model is told nobody is watching');
    const thread = (await db.query("select data from public.brain_records where collection = 'conversations' and id = 'routine-r1'")).rows[0]?.data;
    assert.equal(thread.title, 'Routine: Morning plan');
    assert.match(thread.messages.at(-1).content, /proposed moving it/);
    const [run] = await store.listRoutineRuns(5);
    assert.equal(run.status, 'done'); assert.equal(run.approvals, 1);

    assert.equal((await runRoutine(deps, store, r, '2026-11-13', { date: '2026-11-13', check })).status, 'already_ran');
    const quiet = await runRoutine(deps, store, r, '2026-11-09', { date: '2026-11-09', check });
    assert.equal(quiet.status, 'skipped', 'nothing was overdue on the 9th');
    assert.equal(requests.length, 2, 'skipped runs make no AI calls');
  } finally { globalThis.fetch = realFetch; await db.close(); }
});

test('the scheduler runs due routines through a session per account, and only the scheduler may trigger it', async () => {
  const { db, store, deps } = await setup([routine()]);
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => answer('Here is your plan.');
    const sessions = [];
    const admin = {
      routineOwners: async () => [{ userId: owner, chatId: null, routines: [routine(), routine({ id: 'r2', name: 'Later', time: '15:00' })] }],
      reminderData: async () => ({ tasks: [], events: [] }),
      session: async userId => { sessions.push(userId); return { store, close: async () => {} }; },
    };
    assert.deepEqual(await runDueRoutines(deps, admin, at('2026-11-13T08:10')), { due: 1, ran: 1 });
    assert.deepEqual(sessions, [owner]);
    assert.deepEqual(await runDueRoutines(deps, admin, at('2026-11-13T08:25')), { due: 1, ran: 0 }, 'the next wake finds it already ran');

    const routes = routinesHandlers({ ...deps, cronSecret: () => 's3cret', admin: () => admin, caller: async () => { throw new HttpError(401, 'Sign in.'); } });
    assert.equal((await routes.GET(new Request('http://app/api/routines', { headers: { Authorization: 'Bearer wrong' } }))).status, 401);
    const ok = await routes.GET(new Request('http://app/api/routines', { headers: { Authorization: 'Bearer s3cret' } }));
    assert.equal(ok.status, 200);
  } finally { globalThis.fetch = realFetch; await db.close(); }
});

test('the user can run a routine now and read its history', async () => {
  const { db, deps } = await setup([routine()]);
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => answer('Done planning.');
    const routes = routinesHandlers(deps);
    const response = await routes.POST(new Request('http://app/api/routines', { method: 'POST', body: JSON.stringify({ routineId: 'r1' }) }));
    const body = await response.json();
    assert.equal(body.outcome.status, 'done'); assert.equal(body.outcome.summary, 'Done planning.');
    assert.match(body.runs[0].slot, /^manual-/);
    assert.equal((await routes.POST(new Request('http://app/api/routines', { method: 'POST', body: JSON.stringify({ routineId: 'nope' }) }))).status, 404);
    const history = await (await routes.GET(new Request('http://app/api/routines'))).json();
    assert.equal(history.runs.length, 1);
  } finally { globalThis.fetch = realFetch; await db.close(); }
});

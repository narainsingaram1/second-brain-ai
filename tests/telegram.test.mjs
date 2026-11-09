import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { owner, other, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';
import { pgStore } from './helpers/pgStore.mjs';

const server = await createServer({ cacheDir: '/tmp/synapse-telegram-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const { telegramHandlers } = await load('/server/routes/telegram.ts');
const { notificationsHandlers } = await load('/server/routes/notifications.ts');
const { dueReminders, runReminders } = await load('/server/lib/reminders.ts');
const { webhookSecret, plainText, splitMessage, sha256Hex, telegramClient } = await load('/server/lib/telegram.ts');
const { sealSecret } = await load('/server/lib/crypto.ts');
const { HttpError } = await load('/server/lib/http.ts');
const { PreferencesConflict } = await load('/src/services/recordSync.ts');

const secretsKey = Buffer.alloc(32, 9).toString('base64');
const token = '123456:test-bot-token';
const CHAT = 5550001;
const sse = (...events) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
const toolCall = (name, args) => sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: crypto.randomUUID(), function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });
const answer = text => sse({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] });
const workspace = { tasks: [{ id: 'essay', title: 'Write essay', status: 'not_started', completed: false, priority: 'medium', section: 'Academic', dueDate: '2026-11-10' }],
  goals: [], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [], sections: ['Academic'], subsections: { Academic: ['General'] }, selectedModel: 'test/model' };

/** The service-role store, kept in memory: the real one is a thin layer of table queries over the same columns. */
function fakeAdmin(store) {
  const link = { chatId: null, last: 0, briefEnabled: true, briefHour: 8, alertsEnabled: true, timeZone: 'America/New_York', codeHash: null };
  const sent = new Map();
  let sessions = 0, closed = 0;
  const account = () => ({ userId: owner, chatId: link.chatId, timeZone: link.timeZone, briefEnabled: link.briefEnabled, briefHour: link.briefHour, alertsEnabled: link.alertsEnabled });
  return {
    link, sent, counts: () => ({ sessions, closed }),
    async consumeLinkCode(hash, chatId) { if (hash !== link.codeHash) return null; link.chatId = chatId; link.codeHash = null; return owner; },
    async claimUpdate(chatId, id) { if (chatId !== link.chatId || id <= link.last) return null; link.last = id; return account(); },
    async accountForChat(chatId) { return chatId === link.chatId ? account() : null; },
    async setNotifications(_, on) { link.briefEnabled = link.alertsEnabled = on; },
    async linkedAccounts() { return link.chatId ? [account()] : []; },
    reminderData: async () => ({ tasks: workspace.tasks, events: [] }),
    async claimNotification(_, key, body) { if (sent.has(key)) return false; sent.set(key, body); return true; },
    async recentNotifications() { return [...sent.values()]; },
    async countNotifications() { return sent.size; },
    async pruneNotifications() {},
    async session() { sessions++; return { store, close: async () => { closed++; } }; },
  };
}

async function setup() {
  const { db, asUser } = await supabaseLikeDatabase();
  await asUser(owner);
  await db.query('select public.save_brain($1::jsonb, 0, $2::uuid)', [JSON.stringify(workspace), owner]);
  const store = pgStore(db, owner, PreferencesConflict, HttpError);
  await store.putSecret('openrouter', { ...(await sealSecret(secretsKey, owner, 'openrouter', 'sk-or-v1-server-held-test-key-ABCD')), hint: 'ABCD' });
  const admin = fakeAdmin(store);
  const calls = [];
  const telegramFetch = async (url, init) => {
    const method = String(url).split('/').pop();
    calls.push({ method, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: method === 'getMe' ? { username: 'iris_test_bot' } : true }));
  };
  const deps = { caller: async () => ({ userId: owner, store }), secretsKey: () => secretsKey, telegram: () => ({ token, webhookUrl: 'https://app.example/api/telegram' }), telegramFetch, admin: () => admin, cronSecret: () => 'cron-secret' };
  const routes = telegramHandlers(deps);
  const secret = await webhookSecret(token);
  let updateId = 100;
  const deliver = (update, id = ++updateId) => routes.POST(new Request('http://app/api/telegram', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify({ update_id: id, ...update }) }));
  const say = text => deliver({ message: { message_id: 1, chat: { id: CHAT, type: 'private' }, from: { id: CHAT, username: 'narain' }, text } });
  const sentTexts = () => calls.filter(c => c.method === 'sendMessage').map(c => c.body.text);
  return { db, asUser, store, admin, deps, routes, calls, deliver, say, sentTexts };
}
const linked = async () => { const s = await setup(); s.admin.link.chatId = CHAT; return s; };
const task = async (db, id) => (await db.query("select data from public.brain_records where collection = 'tasks' and id = $1 and not deleted", [id])).rows[0]?.data;

test('a webhook without the right secret is refused and runs nothing', async () => {
  const { db, routes, calls } = await linked();
  try {
    const response = await routes.POST(new Request('http://app/api/telegram', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'wrong' }, body: JSON.stringify({ update_id: 1, message: { chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text: 'delete everything' } }) }));
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  } finally { await db.close(); }
});

test('connecting stores only a hash of a one-time code, and that code links the chat once', async () => {
  const { db, admin, routes, say, sentTexts, calls, store } = await setup();
  try {
    const started = await (await routes.POST(new Request('http://app/api/telegram', { method: 'POST', body: JSON.stringify({ timeZone: 'America/New_York' }) }))).json();
    const code = started.url.split('start=')[1];
    assert.match(started.url, /^https:\/\/t\.me\/iris_test_bot\?start=[\w-]{32}$/);
    assert.equal(calls.find(c => c.method === 'setWebhook').body.url, 'https://app.example/api/telegram');
    const row = (await db.query('select * from public.telegram_links')).rows[0];
    assert.equal(row.link_code_hash, await sha256Hex(code));
    assert.ok(!JSON.stringify(row).includes(code));
    assert.equal((await store.getTelegramLink()).linked, false);

    admin.link.codeHash = row.link_code_hash;
    await say(`/start ${code}`);
    assert.equal(admin.link.chatId, CHAT);
    assert.match(sentTexts().at(-1), /connected/);
    await say(`/start ${code}`);
    assert.match(sentTexts().at(-1), /expired|already used/);
  } finally { await db.close(); }
});

test('a text runs the assistant as the user: the change is saved, the reply sent, the thread kept, the session closed', async () => {
  const { db, admin, say, sentTexts } = await linked();
  const realFetch = globalThis.fetch;
  try {
    let n = 0;
    globalThis.fetch = async () => ++n === 1 ? toolCall('update_task', { taskId: 'essay', status: 'completed' }) : answer('**Done**, marked your essay complete.');
    await say('mark the essay done');
    assert.equal((await task(db, 'essay')).status, 'completed');
    assert.deepEqual(sentTexts(), ['Done, marked your essay complete.']);
    const thread = (await db.query("select data from public.brain_records where collection = 'conversations' and id = 'telegram'")).rows[0].data;
    assert.deepEqual(thread.messages.map(m => m.role), ['user', 'assistant']);
    assert.equal(thread.messages[0].content, 'mark the essay done');
    assert.deepEqual(admin.counts(), { sessions: 1, closed: 1 });
  } finally { globalThis.fetch = realFetch; await db.close(); }
});

test('the same update delivered twice runs once', async () => {
  const { db, deliver, sentTexts } = await linked();
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => answer('Hi.');
    const update = { message: { message_id: 1, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text: 'hello' } };
    await deliver(update, 500);
    await deliver(update, 500);
    assert.equal(sentTexts().length, 1);
  } finally { globalThis.fetch = realFetch; await db.close(); }
});

test('strangers, group chats and other senders get nothing', async () => {
  const { db, say, deliver, sentTexts, admin } = await setup();
  const realFetch = globalThis.fetch;
  try {
    let model = 0;
    globalThis.fetch = async () => { model++; return answer('no'); };
    await say('show me my tasks');
    assert.match(sentTexts()[0], /isn't connected/);
    admin.link.chatId = CHAT;
    await deliver({ message: { message_id: 2, chat: { id: CHAT, type: 'group' }, from: { id: CHAT }, text: 'hi' } });
    await deliver({ message: { message_id: 3, chat: { id: CHAT, type: 'private' }, from: { id: 999 }, text: 'hi' } });
    assert.equal(model, 0);
    assert.equal(sentTexts().length, 1);
  } finally { globalThis.fetch = realFetch; await db.close(); }
});

test('a deletion waits for the button: Approve applies it once, and a second tap does nothing', async () => {
  const { db, say, deliver, calls } = await linked();
  const realFetch = globalThis.fetch;
  try {
    let n = 0;
    globalThis.fetch = async () => ++n === 1 ? toolCall('delete_task', { taskId: 'essay' }) : answer('Want me to delete it?');
    await say('delete the essay');
    assert.ok(await task(db, 'essay'), 'not deleted before approval');
    const ask = calls.find(c => c.method === 'sendMessage' && c.body.reply_markup);
    const [approve, reject] = ask.body.reply_markup.inline_keyboard[0];
    assert.deepEqual([approve.text, reject.text], ['Approve', 'Reject']);
    const tap = data => deliver({ callback_query: { id: 'cb', from: { id: CHAT }, data, message: { message_id: 9, chat: { id: CHAT, type: 'private' }, text: ask.body.text } } });
    await tap(approve.callback_data);
    assert.equal(await task(db, 'essay'), undefined);
    assert.match(calls.filter(c => c.method === 'editMessageText').at(-1).body.text, /Done\.$/);
    await tap(approve.callback_data);
    assert.match(calls.filter(c => c.method === 'editMessageText').at(-1).body.text, /no longer waiting/);
  } finally { globalThis.fetch = realFetch; await db.close(); }
});

test('Reject leaves the record alone, and actions that reach other people can only be approved in the app', async () => {
  const { db, say, deliver, calls, store } = await linked();
  const realFetch = globalThis.fetch;
  try {
    let n = 0;
    globalThis.fetch = async () => ++n === 1 ? toolCall('delete_task', { taskId: 'essay' }) : answer('Ok.');
    await say('delete the essay');
    const ask = calls.find(c => c.method === 'sendMessage' && c.body.reply_markup);
    const tap = data => deliver({ callback_query: { id: 'cb', from: { id: CHAT }, data, message: { message_id: 9, chat: { id: CHAT, type: 'private' }, text: 'x' } } });
    await tap(ask.body.reply_markup.inline_keyboard[0][1].callback_data);
    assert.ok(await task(db, 'essay'));

    const email = await store.proposeAction({ tool: 'send_email', tier: 'external_irreversible', summary: 'Email prof', reason: 'Sends mail', payload: { tool: 'send_email', args: {} } });
    await tap(`y:${email.id}`);
    assert.equal((await store.getAction(email.id)).status, 'proposed');
    assert.match(calls.filter(c => c.method === 'editMessageText').at(-1).body.text, /Open Synapse/);
  } finally { globalThis.fetch = realFetch; await db.close(); }
});

test('a text with no provider key says what to do, and /stop turns reminders off', async () => {
  const { db, store, admin, say, sentTexts } = await linked();
  try {
    await store.deleteSecret('openrouter');
    await say('hello');
    assert.match(sentTexts().at(-1), /provider key/);
    await say('/stop');
    assert.equal(admin.link.briefEnabled, false);
    assert.equal(admin.link.alertsEnabled, false);
  } finally { await db.close(); }
});

test('accounts cannot bind a chat themselves or see anyone else\'s link, and the delivery ledger is server only', async () => {
  const { db, asUser, store } = await setup();
  try {
    await store.beginTelegramLink('a'.repeat(64), 'UTC');
    await assert.rejects(db.query('update public.telegram_links set chat_id = 42'));
    await assert.rejects(db.query('select * from public.telegram_notifications'));
    await asUser(other);
    assert.equal((await db.query('select * from public.telegram_links')).rows.length, 0);
    await db.query('delete from public.telegram_links');
    await asUser(owner);
    assert.equal((await db.query('select * from public.telegram_links')).rows.length, 1);
  } finally { await db.close(); }
});

const prefs = { timeZone: 'America/New_York', briefEnabled: true, briefHour: 8, alertsEnabled: true };
const open = (id, dueDate, dueTime) => ({ id, title: id, status: 'not_started', completed: false, dueDate, ...(dueTime ? { dueTime } : {}) });

test('reminders use the user\'s local time, skip finished work and stay quiet at night', () => {
  // 21:00 in New York on Nov 9.
  const evening = new Date('2026-11-10T02:00:00Z');
  const tasks = [open('soon', '2026-11-09', '22:30'), open('later', '2026-11-10', '09:00'), { ...open('done', '2026-11-09', '22:30'), status: 'completed', completed: true }];
  assert.deepEqual(dueReminders(tasks, [], prefs, evening).map(r => r.key), ['task:soon:2026-11-09:22:30']);
  assert.match(dueReminders(tasks, [], prefs, evening)[0].text, /^Due in 1h 30m: soon/);
  // 03:00 local: inside quiet hours.
  assert.deepEqual(dueReminders([open('dawn', '2026-11-10', '04:00')], [], prefs, new Date('2026-11-10T08:00:00Z')), []);
  assert.deepEqual(dueReminders(tasks, [], { ...prefs, alertsEnabled: false }, evening), []);
  const events = [{ id: 'lab', title: 'Lab', date: '2026-11-09', startTime: '21:20', location: 'Klaus' }];
  assert.equal(dueReminders([], events, prefs, evening)[0].text, 'Starting in 20 min: Lab at Klaus');
});

test('the morning brief goes out at the chosen hour and lists today and overdue work', () => {
  const morning = new Date('2026-11-09T13:05:00Z'); // 08:05 in New York
  const tasks = [open('today', '2026-11-09', '17:00'), open('old', '2026-11-07')];
  const [brief] = dueReminders(tasks, [], prefs, morning);
  assert.equal(brief.key, 'brief:2026-11-09');
  assert.match(brief.text, /Due today\n• today \(5:00 PM\)/);
  assert.match(brief.text, /Overdue\n• old \(Nov 7\)/);
  assert.deepEqual(dueReminders(tasks, [], { ...prefs, briefHour: 9 }, morning), []);
  assert.match(dueReminders([], [], prefs, morning)[0].text, /Nothing due today/);
});

test('the reminder job needs its secret and never sends the same reminder twice', async () => {
  const { db, deps, admin, calls } = await linked();
  try {
    const job = notificationsHandlers(deps);
    assert.equal((await job.GET(new Request('http://app/api/notifications'))).status, 401);
    assert.equal((await job.GET(new Request('http://app/api/notifications', { headers: { Authorization: 'Bearer nope-secret' } }))).status, 401);
    const client = telegramClient(token, deps.telegramFetch);
    const morning = new Date('2026-11-10T13:05:00Z');
    assert.deepEqual(await runReminders(client, admin, morning), { accounts: 1, sent: 1 });
    assert.deepEqual(await runReminders(client, admin, morning), { accounts: 1, sent: 0 });
    assert.equal(calls.filter(c => c.method === 'sendMessage').length, 1);
  } finally { await db.close(); }
});

test('model text is flattened for a text message and long replies are split', () => {
  assert.equal(plainText('## Plan\n- **Essay** due [task:abc] `soon`\n[Doc](https://x.co/a)'), 'Plan\n• Essay due soon\nDoc (https://x.co/a)');
  const parts = splitMessage('line\n'.repeat(2000), 4000);
  assert.ok(parts.length > 1 && parts.every(p => p.length <= 4000));
});

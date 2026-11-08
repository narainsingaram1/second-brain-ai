import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { owner } from './helpers/supabaseDb.mjs';
import { connectedSetup, secretsKey, SEND_SCOPE } from './helpers/googleMock.mjs';

const server = await createServer({ cacheDir: '/tmp/synapse-email-send-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const google = await load('/server/lib/google.ts');
const { googleToolset, DAILY_SEND_LIMIT } = await load('/server/lib/googleTools.ts');
const { agentHandlers } = await load('/server/routes/agent.ts');
const { actionsHandlers } = await load('/server/routes/actions.ts');
const { sealSecret } = await load('/server/lib/crypto.ts');
const { HttpError } = await load('/server/lib/http.ts');
const { PreferencesConflict } = await load('/src/services/recordSync.ts');
const { readEvents } = await load('/src/services/remoteAgent.ts');
const { approvalReason } = await load('/src/services/actionPolicy.ts');

const b64url = text => Buffer.from(text).toString('base64url');
const messages = {
  m1: { id: 'm1', threadId: 't1', snippet: 'Can you confirm?', payload: { mimeType: 'text/plain', body: { data: b64url('Can you confirm the meeting?') },
    headers: [{ name: 'From', value: 'Prof Smith <smith@gatech.edu>' }, { name: 'To', value: 'student@gatech.edu' }, { name: 'Subject', value: 'Meeting' }, { name: 'Message-ID', value: '<m1@gatech.edu>' }] } },
};
const drafts = {
  d1: { id: 'd1', message: { id: 'draft-msg-v1', payload: { mimeType: 'text/plain', body: { data: b64url('Hi Amy, notes attached below.') },
    headers: [{ name: 'To', value: 'Amy <amy@gatech.edu>' }, { name: 'Subject', value: 'Notes' }] } } },
};
const longBody = 'Thanks for the reminder. '.repeat(40) + 'See you Thursday.';

async function setup(scope = SEND_SCOPE) {
  const env = await connectedSetup({ scope, messages, drafts }, PreferencesConflict, HttpError);
  await env.db.query('select public.save_brain($1::jsonb, 0, $2::uuid)', [JSON.stringify({ tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [], sections: [], subsections: {} }), owner]);
  await env.store.putSecret('openrouter', { ...(await sealSecret(secretsKey, owner, 'openrouter', 'sk-or-v1-send-test-key-0000')), hint: '0000' });
  const s = await google.startGoogleConnection(env.deps, new Request('https://synapse.test/api/google'), owner, 'send');
  await google.completeGoogleConnection(env.deps, new Request('https://synapse.test/api/google'), env.store, { code: 'c1', state: new URL(s.url).searchParams.get('state'), verifier: s.verifier });
  return env;
}
const sse = (...events) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
const calls = list => sse({ choices: [{ delta: { tool_calls: list.map(([name, args], index) => ({ index, id: `${name}-${index}`, function: { name, arguments: JSON.stringify(args) } })) }, finish_reason: 'tool_calls' }] });
const say = text => sse({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] });
async function turn(deps, rounds, content) {
  const requests = [];
  globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(init.body)); return rounds.shift() ?? say('Done.'); };
  const response = await agentHandlers(deps).POST(new Request('https://synapse.test/api/agent', { method: 'POST',
    body: JSON.stringify({ message: { id: crypto.randomUUID(), role: 'user', content }, chatHistory: [], timeZone: 'America/New_York' }) }));
  const events = []; for await (const e of readEvents(response.body)) events.push(e);
  return { requests, result: events.at(-1).result };
}
const sent = mock => mock.calls.filter(c => c.method === 'POST' && /\/(messages|drafts)\/send$/.test(c.url));

test('sending always waits for approval, shows the full message, and goes out exactly once', async () => {
  const { db, deps, mock } = await setup();
  try {
    assert.match(approvalReason('send_email', { untrustedRead: false, changes: 0, askBeforeChanges: false }), /always needs your approval/);
    const { requests, result } = await turn(deps, [
      calls([['send_email', { replyToId: 'm1', body: longBody }], ['send_email', { to: ['stranger@evil.example'], subject: 'Hi', body: 'Hello' }]]),
      say('Both messages are waiting for your approval.'),
    ], 'Reply to Prof Smith that I will see them Thursday, and email stranger@evil.example');
    assert.ok(requests[0].tools.some(t => t.function.name === 'send_email'));
    assert.equal(sent(mock).length, 0, 'nothing is sent while waiting for approval');
    const [reply, stranger] = result.approvals;
    assert.equal(reply.summary, 'Send email to smith@gatech.edu: "Re: Meeting"');
    assert.equal(reply.preview, longBody, 'the full message is shown, not a snippet');
    assert.deepEqual(reply.details, ['Sent as a reply in the same thread.']);
    assert.equal(reply.warnings, undefined, 'a known correspondent raises no warning');
    assert.deepEqual(stranger.warnings, ['You have never emailed stranger@evil.example or received email from them. Check the address.']);

    const actions = actionsHandlers(deps);
    const decide = (approval, decision = 'approve') => actions.POST(new Request('https://synapse.test/api/actions', { method: 'POST', body: JSON.stringify({ id: approval.id, decision, payloadHash: approval.payloadHash }) }));
    const done = await (await decide(reply)).json();
    assert.equal(done.status, 'executed'); assert.match(done.link, /#sent\//);
    assert.equal((await decide(reply)).status, 409, 'an approval sends once');
    assert.equal(sent(mock).length, 1);
    const call = sent(mock)[0];
    assert.equal(call.body.threadId, 't1');
    const mime = Buffer.from(call.body.raw, 'base64url').toString();
    assert.match(mime, /^To: smith@gatech\.edu\r\nSubject: Re: Meeting\r\nIn-Reply-To: <m1@gatech\.edu>\r\nReferences: <m1@gatech\.edu>/);
    assert.equal(Buffer.from(mime.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString(), longBody);

    assert.deepEqual(await (await decide(stranger, 'reject')).json(), { status: 'rejected' });
    assert.equal(sent(mock).length, 1, 'a rejected message is never sent');

    const audit = (await db.query("select title, metadata from public.audit_events where action = 'sent email'")).rows;
    assert.deepEqual(audit, [{ title: 'Re: Meeting', metadata: { to: ['smith@gatech.edu'], cc: [] } }]);
    assert.ok(!JSON.stringify((await db.query('select * from public.audit_events')).rows).includes('Thursday'), 'message bodies are not kept in the history');
  } finally { await db.close(); }
});

test('the send tool refuses to run without an approved action, and the daily limit holds', async () => {
  const { db, deps, mock, store } = await setup();
  try {
    const session = await google.googleSession(deps, store);
    const tools = googleToolset(session, store, 'UTC');
    await assert.rejects(tools.execute('send_email', { to: ['amy@gatech.edu'], subject: 'x', body: 'x' }, new AbortController().signal), /needs the user's approval/);
    assert.equal(sent(mock).length, 0);
    for (let i = 0; i < DAILY_SEND_LIMIT; i++) await store.appendAudit({ actor: 'assistant', action: 'sent email', title: `earlier ${i}` });
    await assert.rejects(tools.execute('send_email', { to: ['amy@gatech.edu'], subject: 'x', body: 'x' }, new AbortController().signal, { approvedActionId: crypto.randomUUID() }), /daily limit/);
    assert.equal(sent(mock).length, 0);
    await assert.rejects(tools.prepare('send_email', { to: ['amy@gatech.edu'], subject: 'x', body: 'y'.repeat(10_001) }), /under 10,000 characters/);
  } finally { await db.close(); }
});

test('sending a draft shows it as it is now and refuses if it changed after approval', async () => {
  const { db, deps, mock, store } = await setup();
  try {
    const { result } = await turn(deps, [calls([['send_draft', { draftId: 'd1' }]]), say('Waiting for approval.')], 'Send my notes draft to Amy');
    const [approval] = result.approvals;
    assert.equal(approval.summary, 'Send draft to amy@gatech.edu: "Notes"');
    assert.equal(approval.preview, 'Hi Amy, notes attached below.');
    assert.equal(approval.warnings.length, 1, 'Amy was never emailed before in the fixture');
    drafts.d1.message.id = 'draft-msg-v2'; // The user edits the draft in Gmail after approving the old text.
    const outcome = await (await actionsHandlers(deps).POST(new Request('https://synapse.test/api/actions', { method: 'POST',
      body: JSON.stringify({ id: approval.id, decision: 'approve', payloadHash: approval.payloadHash }) }))).json();
    assert.equal(outcome.status, 'failed'); assert.match(outcome.error, /draft changed/);
    assert.equal(sent(mock).length, 0);
    drafts.d1.message.id = 'draft-msg-v1';
    const session = await google.googleSession(deps, store);
    const ok = await googleToolset(session, store, 'UTC').execute('send_draft', { draftId: 'd1', messageId: 'draft-msg-v1' }, new AbortController().signal, { approvedActionId: crypto.randomUUID() });
    assert.equal(ok.output.sent, true); assert.equal(sent(mock).length, 1);
  } finally { await db.close(); }
});

test('without the send permission, no send tools are offered', async () => {
  const { db, deps } = await setup(SEND_SCOPE.replace(' https://www.googleapis.com/auth/gmail.send', ''));
  try {
    const { requests } = await turn(deps, [say('Hi.')], 'Hello');
    const offered = requests[0].tools.map(t => t.function.name);
    assert.ok(offered.includes('create_email_draft'));
    assert.ok(!offered.some(n => n.startsWith('send_')));
  } finally { await db.close(); }
});

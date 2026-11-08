import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { owner, other, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';
import { pgStore } from './helpers/pgStore.mjs';

const server = await createServer({ cacheDir: '/tmp/synapse-google-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const google = await load('/server/lib/google.ts');
const api = await load('/server/lib/googleApi.ts');
const { googleHandlers } = await load('/server/routes/google.ts');
const { HttpError } = await load('/server/lib/http.ts');
const { PreferencesConflict } = await load('/src/services/recordSync.ts');

export const secretsKey = Buffer.alloc(32, 3).toString('base64');
const b64url = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
export const idToken = email => `${b64url({ alg: 'none' })}.${b64url({ email })}.sig`;

/** Google's OAuth, Calendar and Gmail endpoints, answering from in-memory fixtures and recording calls. */
export function mockGoogle({ scope = google.GOOGLE_SCOPES.gmail.join(' '), email = 'student@gatech.edu', events = [], messages = {}, revokedRefresh = new Set() } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method || 'GET', url: u.origin + u.pathname, params: Object.fromEntries(u.searchParams), body, auth: init.headers?.Authorization });
    if (u.pathname === '/token') {
      if (body.grant_type === 'authorization_code') return Response.json({ access_token: 'at-1', expires_in: 3600, refresh_token: `rt-${body.code}`, scope, id_token: idToken(email) });
      if (revokedRefresh.has(body.refresh_token)) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ access_token: `at-refreshed-${calls.length}`, expires_in: 3600 });
    }
    if (u.pathname === '/revoke') return new Response('', { status: 200 });
    if (u.pathname.endsWith('/calendars/primary/events') && (init.method || 'GET') === 'GET') return Response.json({ items: events });
    if (u.pathname.endsWith('/calendars/primary/events')) return Response.json({ id: 'new-event', htmlLink: 'https://calendar.google.com/event?eid=new' });
    if (u.pathname.endsWith('/messages')) return Response.json({ messages: Object.keys(messages).map(id => ({ id })) });
    const message = u.pathname.match(/\/messages\/([^/]+)$/);
    if (message && messages[message[1]]) return Response.json(messages[message[1]]);
    if (u.pathname.endsWith('/drafts')) return Response.json({ id: 'draft-1', message: { id: 'draft-msg-1' } });
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

export async function connectedSetup(googleOptions) {
  const { db, asUser } = await supabaseLikeDatabase();
  await asUser(owner);
  const mock = mockGoogle(googleOptions);
  const store = pgStore(db, owner, PreferencesConflict, HttpError);
  const deps = { caller: async () => ({ userId: owner, store }), secretsKey: () => secretsKey,
    google: () => ({ clientId: 'client-id', clientSecret: 'client-secret' }), googleFetch: mock.fetch };
  return { db, asUser, mock, store, deps };
}
const request = (path = '/api/google', init) => new Request(`https://synapse.test${path}`, init);

test('connections table and the google secret are owner-only', async () => {
  const { db, asUser } = await supabaseLikeDatabase();
  try {
    await asUser(owner);
    await db.query("insert into public.connections (user_id, provider, account_email, scopes) values ($1, 'google', 'a@b.co', '{openid}')", [owner]);
    await db.query("insert into public.user_secrets (user_id, name, ciphertext, iv, key_version, hint) values ($1, 'google', 'c', 'i', 1, 'a@b')", [owner]);
    await assert.rejects(db.query("insert into public.user_secrets (user_id, name, ciphertext, iv, key_version, hint) values ($1, 'github', 'c', 'i', 1, 'x')", [owner]), e => e.code === '23514');
    await asUser(other);
    assert.equal((await db.query('select * from public.connections')).rows.length, 0);
    await assert.rejects(db.query("insert into public.connections (user_id, provider, account_email, scopes) values ($1, 'google', 'x@y.co', '{openid}')", [owner]), e => e.code === '42501');
    assert.equal((await db.query("update public.connections set status = 'needs_reconnect' returning *")).rows.length, 0);
  } finally { await db.close(); }
});

test('connecting Google: scopes per choice, PKCE and signed state, encrypted refresh token', async () => {
  const { db, mock, store, deps } = await connectedSetup();
  try {
    const routes = googleHandlers(deps);
    const calendarOnly = await (await routes.GET(request('/api/google?action=start&access=calendar'))).json();
    const url = new URL(calendarOnly.url);
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://synapse.test/connect/google');
    assert.ok(!url.searchParams.get('scope').includes('gmail'), 'calendar-only asks for no mail access');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('access_type'), 'offline');

    const start = await (await routes.GET(request('/api/google?action=start&access=gmail'))).json();
    const state = new URL(start.url).searchParams.get('state');
    assert.match(new URL(start.url).searchParams.get('scope'), /gmail\.compose/);
    assert.ok(!new URL(start.url).searchParams.get('scope').includes('gmail.send'), 'never asks to send mail');

    const post = body => routes.POST(request('/api/google', { method: 'POST', body: JSON.stringify(body) }));
    const tampered = state.slice(0, -2) + (state.endsWith('AA') ? 'BB' : 'AA');
    assert.match((await (await post({ code: 'c1', state: tampered, verifier: start.verifier })).json()).error, /invalid/);
    assert.match((await (await post({ code: 'c1', state, verifier: 'someone-elses-verifier' })).json()).error, /different browser/);
    const foreign = await google.startGoogleConnection(deps, request(), other, 'gmail');
    assert.match((await (await post({ code: 'c1', state: new URL(foreign.url).searchParams.get('state'), verifier: foreign.verifier })).json()).error, /different account/);
    const expired = await google.startGoogleConnection(deps, request(), owner, 'gmail', Date.now() - 11 * 60 * 1000);
    assert.match((await (await post({ code: 'c1', state: new URL(expired.url).searchParams.get('state'), verifier: expired.verifier })).json()).error, /expired/);
    assert.equal(mock.calls.filter(c => c.url.endsWith('/token')).length, 0, 'nothing is exchanged for a bad request');

    const connected = await (await post({ code: 'c1', state, verifier: start.verifier })).json();
    assert.deepEqual({ ...connected, connectedAt: undefined }, { connected: true, email: 'student@gatech.edu', calendar: true, gmail: true, status: 'active', connectedAt: undefined, lastError: null });
    const exchange = mock.calls.find(c => c.url.endsWith('/token'));
    assert.equal(exchange.body.code_verifier, start.verifier);
    const secret = (await db.query("select ciphertext from public.user_secrets where name = 'google'")).rows[0];
    assert.ok(!secret.ciphertext.includes('rt-c1'), 'refresh token stored encrypted');
    assert.equal((await (await routes.GET(request('/api/google'))).json()).gmail, true);
    assert.ok(!JSON.stringify(await (await routes.GET(request('/api/google'))).json()).includes('rt-'), 'tokens are never returned');

    // Granting calendar access only is recorded honestly.
    const partial = await connectedSetup({ scope: google.GOOGLE_SCOPES.calendar.join(' ') });
    const s2 = await google.startGoogleConnection(partial.deps, request(), owner, 'gmail');
    const r2 = await google.completeGoogleConnection(partial.deps, request(), partial.store, { code: 'c2', state: new URL(s2.url).searchParams.get('state'), verifier: s2.verifier });
    assert.equal(r2.gmail, false); assert.equal(r2.calendar, true);
    await partial.db.close();
  } finally { await db.close(); }
});

test('calendar events: local dates, all-day spans, refresh on expiry, reconnect on revoked token, disconnect', async () => {
  const revoked = new Set();
  const { db, mock, store, deps } = await connectedSetup({ revokedRefresh: revoked, events: [
    { id: 'e1', summary: 'CS 1332 lecture', start: { dateTime: '2026-11-10T09:30:00-05:00' }, end: { dateTime: '2026-11-10T10:45:00-05:00' }, htmlLink: 'https://calendar.google.com/e1', attendees: [{}, {}] },
    { id: 'e2', summary: 'Thanksgiving break', start: { date: '2026-11-25' }, end: { date: '2026-11-28' } },
    { id: 'e3', summary: 'Cancelled', status: 'cancelled', start: { date: '2026-11-11' }, end: { date: '2026-11-12' } },
    { id: 'e4', summary: 'Outside range', start: { date: '2026-12-15' }, end: { date: '2026-12-16' } },
  ] });
  try {
    const s = await google.startGoogleConnection(deps, request(), owner, 'calendar');
    await google.completeGoogleConnection(deps, request(), store, { code: 'c1', state: new URL(s.url).searchParams.get('state'), verifier: s.verifier });
    const routes = googleHandlers(deps);
    const listed = await (await routes.GET(request('/api/google?action=events&from=2026-11-01&to=2026-11-30&timeZone=America/New_York'))).json();
    assert.deepEqual(listed.events, [
      { id: 'e1', title: 'CS 1332 lecture', date: '2026-11-10', allDay: false, attendees: 2, link: 'https://calendar.google.com/e1', startTime: '09:30', endTime: '10:45' },
      { id: 'e2', title: 'Thanksgiving break', date: '2026-11-25', allDay: true, attendees: 0, endDate: '2026-11-27' },
    ]);
    const eventsCall = mock.calls.find(c => c.url.endsWith('/events'));
    assert.equal(eventsCall.params.timeZone, 'America/New_York');
    assert.match(eventsCall.auth, /^Bearer at-refreshed-/, 'calls use a freshly refreshed access token, not the refresh token');
    assert.equal((await (await routes.GET(request('/api/google?action=events&from=2026-11-30&to=2026-11-01'))).json()).error, 'Use a valid date range (YYYY-MM-DD).');

    // The user revokes access at Google: the next use marks the connection for reconnecting.
    revoked.add('rt-c1');
    const failed = await routes.GET(request('/api/google?action=events&from=2026-11-01&to=2026-11-30'));
    assert.equal(failed.status, 409);
    const status = await (await routes.GET(request('/api/google'))).json();
    assert.equal(status.status, 'needs_reconnect');
    assert.equal(await google.googleSession(deps, store), null, 'no further calls with a dead token');

    await routes.DELETE(request('/api/google', { method: 'DELETE' }));
    assert.ok(mock.calls.some(c => c.url === 'https://oauth2.googleapis.com/revoke' && c.params.token === 'rt-c1'), 'the grant is revoked at Google');
    assert.equal((await db.query("select count(*)::int as n from public.user_secrets where name = 'google'")).rows[0].n, 0);
    assert.deepEqual(await (await routes.GET(request('/api/google'))).json(), { configured: true, connected: false });
    const trail = (await db.query("select action from public.audit_events where entity_type = 'connection' order by id")).rows.map(r => r.action);
    assert.deepEqual(trail, ['connected', 'disconnected']);
  } finally { await db.close(); }
});

test('unconfigured servers refuse to start a connection', async () => {
  const { db, deps } = await connectedSetup();
  try {
    const routes = googleHandlers({ ...deps, google: () => null });
    assert.equal((await routes.GET(request('/api/google?action=start&access=gmail'))).status, 503);
    assert.deepEqual(await (await routes.GET(request('/api/google'))).json(), { configured: false, connected: false });
  } finally { await db.close(); }
});

test('email text: HTML stripped, scripts removed, capped', () => {
  const text = api.htmlToText('<html><head><style>p{}</style></head><body><p>Hi&nbsp;there</p><script>steal()</script><ul><li>One</li><li>Two</li></ul><img src="https://track.example/p.gif"></body></html>');
  assert.equal(text, 'Hi there\n- One\n- Two');
});

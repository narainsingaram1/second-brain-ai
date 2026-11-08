// Google OAuth, Calendar and Gmail endpoints for tests, answering from fixtures and recording every call.
import { owner, supabaseLikeDatabase } from './supabaseDb.mjs';
import { pgStore } from './pgStore.mjs';

const CALENDAR = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'];
export const GMAIL_SCOPE = [...CALENDAR, 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'].join(' ');
export const CALENDAR_SCOPE = CALENDAR.join(' ');

export const secretsKey = Buffer.alloc(32, 3).toString('base64');
const b64url = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
export const idToken = email => `${b64url({ alg: 'none' })}.${b64url({ email })}.sig`;

/** Google's OAuth, Calendar and Gmail endpoints, answering from in-memory fixtures and recording calls. */
export function mockGoogle({ scope = GMAIL_SCOPE, email = 'student@gatech.edu', events = [], messages = {}, revokedRefresh = new Set() } = {}) {
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

/** A PGlite database and a connected-ready store; pass the module's PreferencesConflict and HttpError classes. */
export async function connectedSetup(googleOptions, PreferencesConflict, HttpError) {
  const { db, asUser } = await supabaseLikeDatabase();
  await asUser(owner);
  const mock = mockGoogle(googleOptions);
  const store = pgStore(db, owner, PreferencesConflict, HttpError);
  const deps = { caller: async () => ({ userId: owner, store }), secretsKey: () => secretsKey,
    google: () => ({ clientId: 'client-id', clientSecret: 'client-secret' }), googleFetch: mock.fetch };
  return { db, asUser, mock, store, deps };
}

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'vite';
import { owner, other, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';
import { pgStore } from './helpers/pgStore.mjs';

const server = await createServer({ cacheDir: '/tmp/synapse-server-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const { sealSecret, openSecret } = await load('/server/lib/crypto.ts');
const { HttpError } = await load('/server/lib/http.ts');
const { PreferencesConflict } = await load('/src/services/recordSync.ts');
const { secretsHandlers } = await load('/server/routes/secrets.ts');
const { aiHandlers } = await load('/server/routes/ai.ts');
const { healthHandlers } = await load('/server/routes/health.ts');

const key1 = Buffer.alloc(32, 1).toString('base64');
const key2 = Buffer.alloc(32, 2).toString('base64');

test('secrets are bound to their account and slot, survive key rotation, and reject tampering', async () => {
  const sealed = await sealSecret(key1, owner, 'openrouter', 'sk-or-v1-secret-value');
  assert.notEqual(sealed.ciphertext.includes('secret'), true);
  assert.equal(await openSecret(key1, owner, 'openrouter', sealed), 'sk-or-v1-secret-value');
  await assert.rejects(openSecret(key1, other, 'openrouter', sealed), /could not be decrypted/, 'copied to another account');
  await assert.rejects(openSecret(key2, owner, 'openrouter', sealed), /could not be decrypted/, 'wrong key');
  const tampered = { ...sealed, ciphertext: Buffer.from(Buffer.from(sealed.ciphertext, 'base64').map((b, i) => i === 3 ? b ^ 1 : b)).toString('base64') };
  await assert.rejects(openSecret(key1, owner, 'openrouter', tampered), /could not be decrypted/);
  const sealed1 = await sealSecret(`1:${key1}`, owner, 'openrouter', 'old');
  const rotated = `2:${key2},1:${key1}`;
  assert.equal(await openSecret(rotated, owner, 'openrouter', sealed1), 'old', 'old ciphertexts still open after rotation');
  assert.equal((await sealSecret(rotated, owner, 'openrouter', 'new')).keyVersion, 2, 'new writes use the newest key');
  await assert.rejects(sealSecret('short', owner, 'openrouter', 'x'), /32 random bytes/);
  await assert.rejects(openSecret(`2:${key2}`, owner, 'openrouter', sealed1), /no longer has/);
});

test('secrets route stores keys encrypted, never returns them, and the AI proxy uses them server-side', async () => {
  const { db, asUser } = await supabaseLikeDatabase();
  try {
    let caller = owner;
    const deps = { caller: async () => ({ userId: caller, store: pgStore(db, caller, PreferencesConflict, HttpError) }), secretsKey: () => key1 };
    const validated = [];
    const routes = secretsHandlers(deps, async key => { validated.push(key); return key.endsWith('bad-key-0000') ? { success: false, message: 'Invalid key' } : { success: true, message: 'ok' }; });
    const req = (method, body, query = '') => new Request(`http://app/api/secrets${query}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    await asUser(owner);

    assert.deepEqual(await (await routes.GET(req('GET'))).json(), { openrouter: { configured: false } });
    assert.equal((await routes.POST(req('POST', { name: 'openrouter', value: 'short' }))).status, 400);
    assert.equal((await routes.POST(req('POST', { name: 'github', value: 'x'.repeat(30) }))).status, 400);
    const rejected = await routes.POST(req('POST', { name: 'openrouter', value: 'sk-or-v1-provider-says-bad-key-0000' }));
    assert.equal(rejected.status, 400); assert.match((await rejected.json()).error, /rejected/);
    const saved = await routes.POST(req('POST', { name: 'openrouter', value: 'sk-or-v1-a-perfectly-good-key-WXYZ' }));
    assert.deepEqual(await saved.json(), { openrouter: { configured: true, hint: 'WXYZ' } });
    const row = (await db.query('select ciphertext from public.user_secrets')).rows[0];
    assert.ok(!row.ciphertext.includes('perfectly'), 'stored encrypted');
    const listed = await (await routes.GET(req('GET'))).json();
    assert.equal(listed.openrouter.hint, 'WXYZ');
    assert.ok(!JSON.stringify(listed).includes('perfectly-good'), 'the key is never returned');

    // The proxy forwards only chat and embeddings, with the stored key added on the server.
    const upstreamCalls = [];
    const ai = aiHandlers(deps, async (url, init) => { upstreamCalls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) }); return new Response('data: {"choices":[]}\n\n', { headers: { 'content-type': 'text/event-stream' } }); });
    const aiReq = (endpoint, body) => new Request(`http://app/api/ai?endpoint=${endpoint}`, { method: 'POST', body: JSON.stringify(body) });
    assert.equal((await ai.POST(aiReq('auth/key', { model: 'm' }))).status, 400);
    assert.equal((await ai.POST(aiReq('chat/completions', { messages: [] }))).status, 400);
    const proxied = await ai.POST(aiReq('chat/completions', { model: 'anthropic/claude-sonnet-5.5', stream: true, messages: [{ role: 'user', content: 'hi' }] }));
    assert.equal(proxied.headers.get('content-type'), 'text/event-stream');
    assert.equal(await proxied.text(), 'data: {"choices":[]}\n\n');
    assert.equal(upstreamCalls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(upstreamCalls[0].auth, 'Bearer sk-or-v1-a-perfectly-good-key-WXYZ');

    // Another account has no key, and cannot use this one.
    caller = other; await asUser(other);
    const noKey = await ai.POST(aiReq('embeddings', { model: 'openai/text-embedding-3-small', input: ['x'] }));
    assert.equal(noKey.status, 412);
    caller = owner; await asUser(owner);
    assert.deepEqual(await (await routes.DELETE(req('DELETE', null, '?name=openrouter'))).json(), { openrouter: { configured: false } });
    assert.equal((await ai.POST(aiReq('embeddings', { model: 'm', input: ['x'] }))).status, 412);
    const audit = (await db.query('select action from public.audit_events order by id')).rows.map(r => r.action);
    assert.deepEqual(audit, ['stored credential', 'removed credential']);

    // Without a server key, storage reports unavailable instead of storing plaintext.
    const unconfigured = { ...deps, secretsKey: () => '' };
    assert.equal((await secretsHandlers(unconfigured, async () => ({ success: true })).POST(req('POST', { name: 'openrouter', value: 'sk-or-v1-a-perfectly-good-key-WXYZ' }))).status, 503);
    assert.deepEqual(await (await healthHandlers(unconfigured).GET(new Request('http://app/api/health'))).json(), { ok: true, secrets: false, agent: false, approvals: false });
  } finally { await db.close(); }
});

test('browser requests use the server proxy when the key is held there', async () => {
  const { providerFetch, setProviderProxyAuth, SERVER_HELD_KEY } = await load('/src/services/providerTransport.ts');
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, auth: init.headers.Authorization }); return Response.json({}); };
  await providerFetch('embeddings', 'sk-or-v1-local', { model: 'm' });
  setProviderProxyAuth(async () => 'user-access-token');
  await providerFetch('chat/completions', SERVER_HELD_KEY, { model: 'm' });
  assert.deepEqual(calls, [
    { url: 'https://openrouter.ai/api/v1/embeddings', auth: 'Bearer sk-or-v1-local' },
    { url: '/api/ai?endpoint=chat%2Fcompletions', auth: 'Bearer user-access-token' },
  ]);
  setProviderProxyAuth(null);
  await assert.rejects(providerFetch('chat/completions', SERVER_HELD_KEY, {}), /Sign in again/);
});

test('deployed API bundles match the server source', async () => {
  const { stderr } = await promisify(execFile)('node', ['scripts/build-api.mjs', '--check']).catch(e => e);
  assert.equal(stderr || '', '', 'run npm run build:api');
});

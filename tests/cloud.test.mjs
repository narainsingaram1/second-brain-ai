import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { createServer } from 'vite';

const server = await createServer({ cacheDir: '/private/tmp/synapse-cloud-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());

test('cloud API isolates accounts, rejects stale writes, enforces origin and strips keys', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE brains (user_id TEXT PRIMARY KEY, state TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL)');
  globalThis.__cloudTest = { user: { userId: 'owner', email: 'owner@example.test' }, env: { DB: {
    prepare(sql) { return { bind(...args) { return {
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async run() { return { meta: { changes: sqlite.prepare(sql).run(...args).changes } }; },
    }; } }; },
  } } };
  let source = readFileSync(new URL('../hosting/synapse/app/api/brain/route.ts', import.meta.url), 'utf8');
  source = source.replace(/import .* from "cloudflare:workers";/, 'const env = globalThis.__cloudTest.env;')
    .replace(/import .* from "..\/..\/chatgpt-auth";/, 'const getChatGPTUser = async () => globalThis.__cloudTest.user;');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { GET, PUT } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  const state = { tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [], sections: ['Career'], openRouterKey: 'do-not-store', userId: 'other' };
  const put = (revision, origin = 'https://synapse.test', records = state) => PUT(new Request('https://synapse.test/api/brain', { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, state: records }) }));
  assert.equal((await GET()).status, 200);
  assert.equal((await put(0, 'https://attacker.test')).status, 403);
  assert.equal((await put(0)).status, 200);
  assert.equal((await put(0)).status, 409);
  const saved = await (await GET()).json();
  assert.equal(saved.revision, 1); assert.equal(saved.state.openRouterKey, undefined); assert.equal(saved.state.userId, undefined);
  assert.equal((await put(1)).status, 200);
  assert.equal((await put(1)).status, 409);
  assert.equal((await put(2, undefined, {})).status, 400);
  globalThis.__cloudTest.user = { userId: 'second', email: 'second@example.test' };
  assert.equal((await (await GET()).json()).state, null);
  globalThis.__cloudTest.user = null;
  assert.equal((await GET()).status, 401); assert.equal((await put(0)).status, 401);
  sqlite.close(); delete globalThis.__cloudTest;
});

test('cloud sync excludes API keys, refreshes newer records, and retains unsaved work on conflict', async () => {
  const sync = await server.ssrLoadModule('/src/services/cloudSync.ts');
  globalThis.window = { dispatchEvent() {} };
  let remote = { revision: 1, state: { tasks: [{ id: 'one', title: 'Original' }] }, user: { id: 'owner', email: 'owner@example.test' } };
  let lastBody;
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'PUT') {
      lastBody = JSON.parse(options.body);
      if (lastBody.revision !== remote.revision) return Response.json({}, { status: 409 });
      remote = { ...remote, state: lastBody.state, revision: remote.revision + 1 };
    }
    return Response.json(remote);
  };
  await sync.loadCloud();
  let current = { ...remote.state, userId: 'owner', openRouterKey: 'private-device-key' };
  await sync.saveCloud({ ...current, tasks: [{ id: 'one', title: 'Renamed' }] });
  assert.equal(lastBody.state.openRouterKey, undefined); assert.equal(lastBody.state.userId, undefined);
  current = { ...remote.state, userId: 'owner', openRouterKey: 'private-device-key' };
  remote = { ...remote, revision: 3, state: { tasks: [{ id: 'one', title: 'Other device' }] } };
  const refreshed = await sync.refreshCloud(current);
  assert.equal(refreshed.tasks[0].title, 'Other device'); assert.equal(refreshed.openRouterKey, 'private-device-key');
  remote.revision = 4;
  await assert.rejects(sync.saveCloud({ ...refreshed, tasks: [{ id: 'one', title: 'Unsaved work' }] }), /Another device/);
  assert.equal(await sync.refreshCloud(refreshed), null);
  assert.match(sync.cloudStatus(), /Export your work/);
  delete globalThis.window;
});

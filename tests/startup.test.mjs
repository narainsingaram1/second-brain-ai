import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { owner, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';
import { pgTransport } from './helpers/pgStore.mjs';

const server = await createServer({ cacheDir: '/tmp/synapse-startup-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const { RecordSync, PreferencesConflict } = await server.ssrLoadModule('/src/services/recordSync.ts');
const { rebaseEdits } = await server.ssrLoadModule('/src/utils/rebaseEdits.ts');

const blob = {
  tasks: [{ id: 't1', title: 'Task' }], goals: [], habits: [], journalEntries: [], knowledgeItems: [{ id: 'n1', title: 'Note', content: 'v1' }],
  chatHistory: [], sections: ['Work'], subsections: { Work: ['General'] }, theme: 'light', selectedModel: 'a/model',
};

test('loading an account already on per-record storage skips the migration and reads preferences and records together', async () => {
  const { db, asUser } = await supabaseLikeDatabase();
  try {
    await asUser(owner);
    await db.query('select public.save_brain($1::jsonb, 0, $2::uuid)', [JSON.stringify(blob), owner]);
    const transport = pgTransport(db, undefined, PreferencesConflict);
    let migrations = 0, inFlight = 0, overlapped = false;
    const track = fn => async (...args) => { inFlight++; if (inFlight > 1) overlapped = true; try { return await fn(...args); } finally { inFlight--; } };
    const counted = { ...transport,
      migrate: async () => { migrations++; return transport.migrate(); },
      readPreferences: track(transport.readPreferences), readRecords: track(transport.readRecords) };

    const first = await new RecordSync(counted).load();
    assert.equal(migrations, 1, 'an account on the old layout is migrated first');
    assert.equal(first.tasks[0].title, 'Task');

    overlapped = false;
    const second = await new RecordSync(counted).load();
    assert.equal(migrations, 1, 'a migrated account is not migrated again');
    assert.ok(overlapped, 'preferences and records are read at the same time');
    assert.deepEqual(second.tasks, first.tasks);
    assert.equal(second.theme, 'light');
  } finally { await db.close(); }
});

test('a database without per-record storage still falls back to the snapshot path', async () => {
  let migrations = 0;
  const sync = new RecordSync({
    migrate: async () => { migrations++; return 'unsupported'; },
    readPreferences: async () => { throw new Error('no layout column'); },
    readRecords: async () => { throw new Error('no records table'); },
    preferencesRevision: async () => 0, saveRecords: async () => ({ saved: [], conflicts: [] }), savePreferences: async () => 0,
  });
  assert.equal(await sync.load(), null);
  assert.equal(migrations, 1);
});

test('edits made on the cached copy are carried over onto the fresh cloud copy, and nothing else is', () => {
  const kept = { id: 'a', title: 'Cached A' }, edited = { id: 'b', title: 'Cached B' }, removed = { id: 'c', title: 'Cached C' };
  const base = { userId: 'u', tasks: [kept, edited, removed], goals: [], theme: 'light', sections: ['Work'], openRouterKey: '',
    study: { courses: [{ id: 'k1', code: 'CS' }], folders: [], documents: [], decks: [], quizzes: [] }, agentMemory: { facts: [] } };
  const fresh = { ...base, tasks: [{ id: 'a', title: 'Newer A from cloud' }, { id: 'b', title: 'Cloud B' }, { id: 'c', title: 'Cloud C' }, { id: 'd', title: 'From another device' }],
    sections: ['Work', 'Home'], theme: 'light', agentMemory: { facts: ['cloud'] } };

  assert.equal(rebaseEdits(base, base, fresh), fresh, 'with no edits the cloud copy is used as is');

  const current = { ...base, theme: 'dark',
    tasks: [{ id: 'e', title: 'Added while loading' }, kept, { ...edited, title: 'Edited while loading' }],
    study: { ...base.study, courses: [{ id: 'k1', code: 'CS' }, { id: 'k2', code: 'MATH' }] } };
  const next = rebaseEdits(base, current, fresh);
  const titles = Object.fromEntries(next.tasks.map(t => [t.id, t.title]));
  assert.equal(titles.a, 'Newer A from cloud', 'an untouched record takes the cloud version');
  assert.equal(titles.b, 'Edited while loading', 'an edited record keeps the edit');
  assert.equal(titles.c, undefined, 'a deleted record stays deleted');
  assert.equal(titles.d, 'From another device', 'records added elsewhere are kept');
  assert.equal(titles.e, 'Added while loading', 'a new record is kept');
  assert.equal(next.theme, 'dark', 'a changed preference is kept');
  assert.deepEqual(next.sections, ['Work', 'Home'], 'an unchanged preference takes the cloud value');
  assert.deepEqual(next.agentMemory, { facts: ['cloud'] });
  assert.deepEqual(next.study.courses.map(c => c.id), ['k1', 'k2']);
});

test('the startup cache never stores an API key and is cleared on sign-out', () => {
  const cache = readFileSync(new URL('../src/services/startupCache.ts', import.meta.url), 'utf8');
  assert.match(cache, /openRouterKey: key, \.\.\.rest/);
  assert.match(cache, /key === SERVER_HELD_KEY \? \{ openRouterKey: key \} : \{\}/);
  const auth = readFileSync(new URL('../src/services/managedAuth.ts', import.meta.url), 'utf8');
  assert.match(auth, /signOutManaged[\s\S]*?clearStartupCache\(\)/);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /if \(!state \|\| hydrating\) return;/, 'the cached copy is never saved');
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { owner, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';
import { pgTransport } from './helpers/pgStore.mjs';

const server = await createServer({ cacheDir: '/tmp/synapse-record-sync-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const { RecordSync, PreferencesConflict } = await server.ssrLoadModule('/src/services/recordSync.ts');


const blob = {
  tasks: [{ id: 't2', title: 'Newer task' }, { id: 't1', title: 'Older task' }],
  goals: [], habits: [{ id: 'h1', name: 'Habit' }], journalEntries: [], knowledgeItems: [{ id: 'n1', title: 'Note', content: 'v1' }],
  chatHistory: [], sections: ['Work'], subsections: { Work: ['General'] }, theme: 'light', selectedModel: 'a/model',
  study: { courses: [{ id: 'c1', code: 'CS 1332' }], folders: [], documents: [], decks: [], quizzes: [] },
};

test('record sync sends only changed records and keeps the server version when two devices collide', async () => {
  const { db, asUser } = await supabaseLikeDatabase();
  try {
    await asUser(owner);
    await db.query('select public.save_brain($1::jsonb, 0, $2::uuid)', [JSON.stringify(blob), owner]);
    const sentA = [], sentB = [];
    let remoteChanges = 0;
    const a = new RecordSync(pgTransport(db, sentA, PreferencesConflict));
    const b = new RecordSync(pgTransport(db, sentB, PreferencesConflict), () => remoteChanges++);
    let stateA = await a.load();
    assert.deepEqual(stateA.tasks, blob.tasks, 'newest-first order survives the upgrade');
    assert.deepEqual(stateA.study.courses, blob.study.courses);
    assert.equal(stateA.selectedModel, 'a/model');
    assert.equal(a.hasUnsavedChanges(stateA), false);

    // Edit one task, add one, delete the habit: exactly three record writes.
    stateA = { ...stateA, tasks: [{ id: 't3', title: 'Brand new' }, { ...stateA.tasks[0], title: 'Newer task, edited' }, stateA.tasks[1]], habits: [] };
    assert.equal(a.hasUnsavedChanges(stateA), true);
    await a.save(stateA);
    assert.deepEqual(sentA.flat().map(c => `${c.id}:${c.baseRevision}:${c.data ? 'put' : 'delete'}`).sort(), ['h1:1:delete', 't2:1:put', 't3:0:put']);
    assert.equal(a.hasUnsavedChanges(stateA), false);
    sentA.length = 0;
    await a.save(stateA);
    assert.equal(sentA.length, 0, 'an unchanged workspace sends nothing');

    let stateB = await b.load();
    assert.deepEqual(stateB.tasks.map(t => t.title), ['Brand new', 'Newer task, edited', 'Older task']);
    assert.deepEqual(stateB.habits, []);

    // Both devices edit the same note; A saves first.
    stateA = { ...stateA, knowledgeItems: [{ ...stateA.knowledgeItems[0], content: 'from A' }] };
    stateB = { ...stateB, knowledgeItems: [{ ...stateB.knowledgeItems[0], content: 'from B' }], tasks: [{ ...stateB.tasks[2], title: 'B renamed the old task' }, ...stateB.tasks.slice(0, 2)] };
    await a.save(stateA);
    await b.save(stateB);
    assert.equal(remoteChanges, 1, 'the conflict asks the app to refresh right away');
    assert.equal(b.hasUnsavedChanges(stateB), true);
    stateB = await b.refresh(() => stateB);
    assert.equal(stateB.knowledgeItems[0].content, 'from A', 'the version already saved wins');
    assert.equal(b.lastRefreshConflicts, 1);
    assert.ok(stateB.tasks.some(t => t.title === 'B renamed the old task'), 'B’s non-conflicting edit is kept');
    sentB.length = 0;
    await b.save(stateB);
    assert.deepEqual(sentB.flat().map(c => c.id), [], 'nothing left to send after resolving');

    // A picks up B's rename without disturbing its own unsaved edit.
    stateA = { ...stateA, tasks: stateA.tasks.map(t => t.id === 't3' ? { ...t, title: 'A unsaved edit' } : t) };
    const refreshedA = await a.refresh(() => stateA);
    assert.equal(refreshedA.tasks.find(t => t.id === 't1').title, 'B renamed the old task');
    assert.equal(refreshedA.tasks.find(t => t.id === 't3').title, 'A unsaved edit');
    assert.equal(await a.refresh(() => refreshedA), null, 'no further changes');
    stateA = refreshedA;

    // Preferences merge per field: A changes the theme, B the model, at the same time.
    await a.save({ ...stateA, theme: 'dark' });
    await b.save({ ...stateB, selectedModel: 'b/model' });
    const prefs = (await db.query('select state from public.brains')).rows[0].state;
    assert.equal(prefs.theme, 'dark'); assert.equal(prefs.selectedModel, 'b/model');
    const finalA = await a.refresh(() => ({ ...stateA, theme: 'dark' }));
    assert.equal(finalA.selectedModel, 'b/model');

    // Deleting on one device removes the record on the other.
    await b.save({ ...stateB, selectedModel: 'b/model', study: { ...stateB.study, courses: [] } });
    const afterDelete = await a.refresh(() => finalA);
    assert.deepEqual(afterDelete.study.courses, []);
  } finally { await db.close(); }
});

test('record sync coalesces saves made while one is running', async () => {
  const { db, asUser } = await supabaseLikeDatabase();
  try {
    await asUser(owner);
    const sent = [];
    const transport = pgTransport(db, sent, PreferencesConflict);
    const slow = { ...transport, async saveRecords(changes) { await new Promise(r => setTimeout(r, 20)); return transport.saveRecords(changes); } };
    const sync = new RecordSync(slow);
    const base = await sync.load();
    const saves = [1, 2, 3, 4].map(n => sync.save({ ...base, tasks: [{ id: 'counter', title: `Version ${n}` }] }));
    await Promise.all(saves);
    assert.equal(sent.length, 2, 'the first save runs, the next three collapse into one');
    assert.equal((await db.query("select data->>'title' as t, revision from public.brain_records where id = 'counter'")).rows[0].t, 'Version 4');
  } finally { await db.close(); }
});

test('preference saves send only the changed fields, merge with another device, and fall back on old databases', async () => {
  const { db, asUser } = await supabaseLikeDatabase();
  try {
    await asUser(owner);
    const chat = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `message ${i} `.repeat(50) }));
    await db.query('select public.save_brain($1::jsonb, 0, $2::uuid)', [JSON.stringify({ ...blob, chatHistory: chat, dailyBrief: { on: true } }), owner]);
    const sentPrefs = [];
    const a = new RecordSync(pgTransport(db, [], PreferencesConflict, sentPrefs));
    const b = new RecordSync(pgTransport(db, [], PreferencesConflict));
    let stateA = await a.load();
    let stateB = await b.load();
    const stored = async () => (await db.query('select state from public.brains')).rows[0].state;

    // An edit that adds an audit entry uploads the audit log and the task, not the chat.
    stateA = { ...stateA, tasks: [{ ...stateA.tasks[0], title: 'Renamed' }, stateA.tasks[1]], auditLog: [{ id: 'audit-1', action: 'update' }] };
    await a.save(stateA);
    assert.deepEqual(sentPrefs.map(p => Object.keys(p.changes)), [['auditLog']]);
    assert.equal((await stored()).chatHistory.length, 30, 'unchanged fields stay on the server');

    // Another device changes the theme; this device's next change merges with it instead of overwriting it.
    stateB = { ...stateB, theme: 'dark' };
    await b.save(stateB);
    stateA = { ...stateA, selectedModel: 'b/model' };
    await a.save(stateA);
    const merged = await stored();
    assert.equal(merged.theme, 'dark');
    assert.equal(merged.selectedModel, 'b/model');
    assert.deepEqual(merged.auditLog, [{ id: 'audit-1', action: 'update' }]);

    // A field this device dropped is removed on the server with the next change.
    const { dailyBrief: _dropped, ...withoutBrief } = stateA;
    stateA = { ...withoutBrief, sections: ['Work', 'Home'] };
    await a.save(stateA);
    assert.equal((await stored()).dailyBrief, undefined);
    assert.deepEqual(sentPrefs.at(-1).removed, ['dailyBrief']);

    // A database without the patch function gets whole preferences, as before.
    const full = [];
    const transport = { ...pgTransport(db, [], PreferencesConflict), savePreferencesPatch: async () => 'unsupported' };
    const old = transport.savePreferences;
    transport.savePreferences = (state, revision) => { full.push(state); return old(state, revision); };
    const c = new RecordSync(transport);
    let stateC = await c.load();
    stateC = { ...stateC, theme: 'sepia' };
    await c.save(stateC);
    assert.equal(full.length, 1);
    assert.equal(full[0].chatHistory.length, 30);
    assert.equal((await stored()).theme, 'sepia');
  } finally { await db.close(); }
});

test('a preference save that collides with another device keeps both changes, on the server and on both devices', async () => {
  const { db, asUser } = await supabaseLikeDatabase();
  try {
    await asUser(owner);
    await db.query('select public.save_brain($1::jsonb, 0, $2::uuid)', [JSON.stringify(blob), owner]);
    const stored = async () => (await db.query('select state from public.brains')).rows[0].state;
    for (const patch of [true, false]) {
      const transport = () => patch ? pgTransport(db, [], PreferencesConflict) : { ...pgTransport(db, [], PreferencesConflict), savePreferencesPatch: async () => 'unsupported' };
      const a = new RecordSync(transport());
      const b = new RecordSync(transport());
      let stateA = await a.load();
      let stateB = await b.load();
      const theme = `theme-${patch}`, model = `model-${patch}`, sharedB = `shared-b-${patch}`, sharedA = `shared-a-${patch}`;

      // B changes the theme and a shared field; A, not having seen that, changes the model and the same shared field.
      stateB = { ...stateB, theme, sections: [sharedB] };
      await b.save(stateB);
      stateA = { ...stateA, selectedModel: model, sections: [sharedA] };
      await a.save(stateA); // Conflicts, then merges.
      assert.equal((await stored()).theme, theme, 'B\'s change survives A\'s save');
      assert.deepEqual((await stored()).sections, [sharedA], 'A saved last, so its value of the field both changed wins');

      // A takes B's theme and keeps its own winning value, without a reload.
      stateA = (await a.refresh(() => stateA)) || stateA;
      assert.equal(stateA.theme, theme);
      assert.equal(stateA.selectedModel, model);
      assert.deepEqual(stateA.sections, [sharedA], 'the other device\'s losing value is not shown here');

      // A's next, unrelated save must not put its old theme back.
      stateA = { ...stateA, auditLog: [{ id: `audit-${patch}`, action: 'update' }] };
      await a.save(stateA);
      const after = await stored();
      assert.equal(after.theme, theme, 'a later save does not undo the other device\'s change');
      assert.equal(after.selectedModel, model);
      assert.deepEqual(after.sections, [sharedA]);
      assert.equal(a.hasUnsavedChanges(stateA), false);

      // B catches up to the merged result.
      stateB = (await b.refresh(() => stateB)) || stateB;
      assert.equal(stateB.selectedModel, model);
      assert.deepEqual(stateB.sections, [sharedA]);
    }
  } finally { await db.close(); }
});

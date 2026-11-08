import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { owner, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';

const server = await createServer({ cacheDir: '/tmp/synapse-record-sync-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const { RecordSync, PreferencesConflict } = await server.ssrLoadModule('/src/services/recordSync.ts');


/** The same transport contract as supabaseRecordTransport, over PGlite as the signed-in user. */
function pgTransport(db, sent) {
  const rows = r => r.rows.map(x => ({ ...x, revision: Number(x.revision), seq: Number(x.seq), ord: Number(x.ord) }));
  return {
    async migrate() { await db.query('select public.migrate_brain_to_records()'); return 'records'; },
    async readPreferences() { const r = (await db.query('select state, revision from public.brains')).rows[0]; return { state: r.state, revision: Number(r.revision) }; },
    async preferencesRevision() { return Number((await db.query('select revision from public.brains')).rows[0].revision); },
    async readRecords(since) {
      return since === undefined
        ? rows(await db.query('select collection, id, data, revision, seq, ord, deleted from public.brain_records where not deleted order by seq'))
        : rows(await db.query('select collection, id, data, revision, seq, ord, deleted from public.brain_records where seq > $1 order by seq', [since]));
    },
    async saveRecords(changes) { sent?.push(changes); return (await db.query('select public.save_records($1::jsonb) as r', [JSON.stringify(changes)])).rows[0].r; },
    async savePreferences(state, revision) {
      try { return Number((await db.query('select public.save_brain_prefs($1::jsonb, $2) as r', [JSON.stringify(state), revision])).rows[0].r); }
      catch (error) { if (error.code === '40001') throw new PreferencesConflict(); throw error; }
    },
  };
}

const blob = {
  tasks: [{ id: 't2', title: 'Newer task' }, { id: 't1', title: 'Older task' }],
  goals: [{ id: 'g1', title: 'Goal' }], habits: [], journalEntries: [], knowledgeItems: [{ id: 'n1', title: 'Note', content: 'v1' }],
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
    const a = new RecordSync(pgTransport(db, sentA));
    const b = new RecordSync(pgTransport(db, sentB), () => remoteChanges++);
    let stateA = await a.load();
    assert.deepEqual(stateA.tasks, blob.tasks, 'newest-first order survives the upgrade');
    assert.deepEqual(stateA.study.courses, blob.study.courses);
    assert.equal(stateA.selectedModel, 'a/model');
    assert.equal(a.hasUnsavedChanges(stateA), false);

    // Edit one task, add one, delete the goal: exactly three record writes.
    stateA = { ...stateA, tasks: [{ id: 't3', title: 'Brand new' }, { ...stateA.tasks[0], title: 'Newer task, edited' }, stateA.tasks[1]], goals: [] };
    assert.equal(a.hasUnsavedChanges(stateA), true);
    await a.save(stateA);
    assert.deepEqual(sentA.flat().map(c => `${c.id}:${c.baseRevision}:${c.data ? 'put' : 'delete'}`).sort(), ['g1:1:delete', 't2:1:put', 't3:0:put']);
    assert.equal(a.hasUnsavedChanges(stateA), false);
    sentA.length = 0;
    await a.save(stateA);
    assert.equal(sentA.length, 0, 'an unchanged workspace sends nothing');

    let stateB = await b.load();
    assert.deepEqual(stateB.tasks.map(t => t.title), ['Brand new', 'Newer task, edited', 'Older task']);
    assert.deepEqual(stateB.goals, []);

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
    const transport = pgTransport(db, sent);
    const slow = { ...transport, async saveRecords(changes) { await new Promise(r => setTimeout(r, 20)); return transport.saveRecords(changes); } };
    const sync = new RecordSync(slow);
    const base = await sync.load();
    const saves = [1, 2, 3, 4].map(n => sync.save({ ...base, tasks: [{ id: 'counter', title: `Version ${n}` }] }));
    await Promise.all(saves);
    assert.equal(sent.length, 2, 'the first save runs, the next three collapse into one');
    assert.equal((await db.query("select data->>'title' as t, revision from public.brain_records where id = 'counter'")).rows[0].t, 'Version 4');
  } finally { await db.close(); }
});

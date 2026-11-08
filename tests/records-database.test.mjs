import { test } from 'node:test';
import assert from 'node:assert/strict';
import { owner, other, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';

const blob = {
  tasks: [{ id: 'task-1', title: 'Saved task', completed: false }, { title: 'Task without an id' }],
  goals: [{ id: 'goal-1', title: 'Saved goal', milestones: [] }],
  habits: [{ id: 'habit-1', history: {} }],
  journalEntries: [{ id: 'journal-1', content: 'Reflection' }],
  knowledgeItems: [{ id: 'note-1', title: 'Note', content: 'Body' }],
  chatHistory: [{ id: 'message-1', role: 'user', content: 'Hi' }],
  sections: ['Work'], subsections: { Work: ['General'] },
  noteFolders: [{ id: 'folder-1', name: 'Notes' }],
  conversations: [{ id: 'thread-1', title: 'Old', messages: [], updatedAt: '2026-11-01T00:00:00Z' }],
  selectedModel: 'test/model', theme: 'dark',
  agentMemory: { version: 1, enabled: true, automaticLearning: true, entries: [], suppressed: [] },
  events: [{ id: 'event-1', title: 'Office hours', kind: 'meeting', date: '2026-11-10' }],
  study: { courses: [{ id: 'course-1', code: 'CS 1332' }], folders: [], documents: [{ id: 'doc-1', name: 'Syllabus' }], decks: [], quizzes: [] },
};

test('records: migration moves every collection, isolates accounts, and resolves conflicts per record', async () => {
  const { db, asUser } = await supabaseLikeDatabase();
  try {
    const rpc = (sql, params = []) => db.query(sql, params).then(r => r.rows[0]);
    await asUser(owner);
    await rpc('select public.save_brain($1::jsonb, 0, $2::uuid)', [JSON.stringify(blob), owner]);

    const migrated = (await rpc('select public.migrate_brain_to_records() as r')).r;
    assert.equal(migrated.layout, 2);
    assert.equal((await rpc('select public.migrate_brain_to_records() as r')).r.moved, 0, 'migration is idempotent');
    const rows = (await db.query('select collection, id, data, revision from public.brain_records order by collection, id')).rows;
    const ids = rows.map(r => `${r.collection}:${r.id}`);
    for (const id of ['tasks:task-1', 'goals:goal-1', 'habits:habit-1', 'journalEntries:journal-1', 'knowledgeItems:note-1', 'noteFolders:folder-1',
      'conversations:thread-1', 'events:event-1', 'study.courses:course-1', 'study.documents:doc-1', 'memory:agent']) assert.ok(ids.includes(id), id);
    const legacy = rows.find(r => r.collection === 'tasks' && r.id.startsWith('legacy-'));
    assert.equal(legacy.data.title, 'Task without an id', 'entries without IDs are kept, not dropped');
    const prefs = (await rpc('select state, layout from public.brains')).state;
    assert.deepEqual(Object.keys(prefs).sort(), ['chatHistory', 'sections', 'selectedModel', 'subsections', 'theme']);
    const taskOrder = (await db.query("select data->>'title' as t from public.brain_records where collection = 'tasks' order by ord desc")).rows.map(r => r.t);
    assert.deepEqual(taskOrder, ['Saved task', 'Task without an id'], 'newest-first lists keep their order');
    assert.equal(prefs.tasks, undefined);

    // A tab from before the upgrade cannot write whole collections back over the records.
    const revision = Number((await rpc('select revision from public.brains')).revision);
    await assert.rejects(rpc('select public.save_brain($1::jsonb, $2, $3::uuid)', [JSON.stringify(blob), revision, owner]), e => e.code === '40001');
    assert.equal(Number((await rpc('select public.save_brain_prefs($1::jsonb, $2) as r', [JSON.stringify({ ...prefs, theme: 'light', tasks: [] }), revision])).r), revision + 1);
    assert.equal((await rpc('select state from public.brains')).state.tasks, undefined, 'preference saves drop record collections');
    await assert.rejects(rpc('select public.save_brain_prefs($1::jsonb, $2)', [JSON.stringify(prefs), revision]), e => e.code === '40001');

    const save = changes => rpc('select public.save_records($1::jsonb) as r', [JSON.stringify(changes)]).then(r => r.r);
    // Partial success: one fresh edit saves, one stale edit returns the current row.
    let result = await save([
      { collection: 'tasks', id: 'task-1', baseRevision: 1, data: { id: 'task-1', title: 'Edited', completed: false } },
      { collection: 'goals', id: 'goal-1', baseRevision: 7, data: { id: 'goal-1', title: 'Stale' } },
      { collection: 'tasks', id: 'task-2', baseRevision: 0, data: { id: 'task-2', title: 'New' } },
    ]);
    assert.deepEqual(result.saved.map(s => [s.id, s.revision]), [['task-1', 2], ['task-2', 1]]);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].current.data.title, 'Saved goal');
    const seqAfterEdits = Math.max(...result.saved.map(s => s.seq));

    // Deletes leave a tombstone that other devices can pull; re-creating uses the tombstone's revision.
    result = await save([{ collection: 'tasks', id: 'task-2', baseRevision: 1, data: null }]);
    assert.equal(result.saved[0].deleted, true);
    const pulled = (await db.query('select id, deleted, data from public.brain_records where seq > $1 order by seq', [seqAfterEdits])).rows;
    assert.deepEqual(pulled, [{ id: 'task-2', deleted: true, data: null }]);
    assert.equal((await save([{ collection: 'tasks', id: 'task-2', baseRevision: 0, data: { id: 'task-2', title: 'Again' } }])).conflicts.length, 1);
    assert.equal((await save([{ collection: 'tasks', id: 'task-2', baseRevision: 2, data: { id: 'task-2', title: 'Restored' } }])).saved[0].revision, 3);

    // Validation rejects the whole batch.
    for (const bad of [
      [{ collection: 'secrets', id: 'x', baseRevision: 0, data: { id: 'x' } }],
      [{ collection: 'tasks', id: 'a', baseRevision: 0, data: { id: 'b' } }],
      [{ collection: 'events', id: 'e', baseRevision: 0, data: { id: 'e', title: 'Party', kind: 'meeting', date: 'Nov 10' } }],
      [{ collection: 'events', id: 'e', baseRevision: 0, data: { id: 'e', title: 'Link', kind: 'meeting', date: '2026-11-10', link: 'javascript:alert(1)' } }],
      [{ collection: 'memory', id: 'agent', baseRevision: 1, data: { version: 2 } }],
      [{ collection: 'tasks', id: 'big', baseRevision: 0, data: { id: 'big', notes: 'x'.repeat(600000) } }],
    ]) await assert.rejects(save(bad), e => e.code === '22023', JSON.stringify(bad).slice(0, 80));

    // Clients cannot write the table directly, and other accounts see nothing.
    for (const sql of ["update public.brain_records set revision = 99", "delete from public.brain_records",
      `insert into public.brain_records (user_id, collection, id, data, revision, seq, ord) values ('${owner}', 'tasks', 'x', '{"id":"x"}', 1, 1, 1)`]) {
      await assert.rejects(db.query(sql), e => e.code === '42501', sql);
    }
    await asUser(other);
    assert.equal((await db.query('select * from public.brain_records')).rows.length, 0);
    await assert.rejects(save([{ collection: 'tasks', id: 'task-1', baseRevision: 2, data: { id: 'task-1' } }]), e => e.code === '55000', 'an account that has not upgraded cannot write records');
    assert.equal((await rpc('select public.migrate_brain_to_records() as r')).r.layout, 2, 'a brand-new account starts on records');
    result = await save([{ collection: 'tasks', id: 'task-1', baseRevision: 2, data: { id: 'task-1', title: 'Hijack' } }]);
    assert.equal(result.saved.length, 0, 'IDs are scoped per account');
    await asUser(owner);
    assert.equal((await db.query("select data->>'title' as t from public.brain_records where collection = 'tasks' and id = 'task-1'")).rows[0].t, 'Edited');
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.brain_records'), e => e.code === '42501');
  } finally { await db.close(); }
});

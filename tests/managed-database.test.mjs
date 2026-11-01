import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/202610300001_brain_accounts.sql', import.meta.url), 'utf8');
const appearanceMigration = await readFile(new URL('../supabase/migrations/202611010001_task_appearance.sql', import.meta.url), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const workspace = {
  tasks: [{ id: 'task-1', title: 'Saved task', completed: false }],
  goals: [{ id: 'goal-1', title: 'Saved goal', milestones: [{ id: 'milestone-1', completed: true }] }],
  habits: [{ id: 'habit-1', history: { '2026-10-31': true } }],
  journalEntries: [{ id: 'journal-1', content: 'Saved reflection' }],
  knowledgeItems: [{ id: 'note-1', title: 'Saved note', content: 'Full note contents', folderId: 'folder-1' }],
  chatHistory: [{ id: 'message-1', role: 'user', content: 'Saved conversation' }],
  sections: ['Work'], subsections: { Work: ['General'] },
  noteFolders: [{ id: 'folder-1', name: 'Notes' }],
  conversationId: 'thread-1', conversations: [{ id: 'older-thread', messages: [] }],
  selectedModel: 'test/model', theme: 'dark', dailyBrief: 'Saved brief',
  taskAppearance: { accent: 'green', icons: { '["Work",null]': 'Rocket' } },
  auditLog: [{ id: 'audit-1', action: 'Created task' }],
};
const state = { ...workspace, openRouterKey: 'must-not-persist', userId: other, unexpectedSecret: 'must-not-persist' };

test('actual PostgreSQL enforces owner isolation, RPC-only writes, revision conflicts, and credential exclusion', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;`);
    await db.query('insert into auth.users values ($1), ($2)', [owner, other]);
    await db.exec(migration);
    await db.exec(appearanceMigration);
    const asUser = async id => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]); await db.exec('set role authenticated'); };
    const save = (revision, uid = owner, payload = state) => db.query('select public.save_brain($1::jsonb,$2::bigint,$3::uuid) as revision', [JSON.stringify(payload), revision, uid]);
    await asUser(owner);
    assert.equal((await save(0)).rows[0].revision, 1);
    assert.equal((await save(1)).rows[0].revision, 2);
    const row = (await db.query('select * from public.brains')).rows[0];
    assert.equal(row.user_id, owner); assert.equal(row.state.openRouterKey, undefined);
    assert.equal(row.state.userId, undefined); assert.equal(row.state.unexpectedSecret, undefined);
    assert.deepEqual(row.state, workspace, 'every workspace collection and preference round-trips intact');
    await assert.rejects(save(1), error => error.code === '40001');
    await assert.rejects(save(0), error => error.code === '40001');
    await assert.rejects(save(2, other), error => error.code === '42501');
    await assert.rejects(save(2, owner, {}), error => error.code === '22023');
    await assert.rejects(save(-1), error => error.code === '22023');
    await assert.rejects(save(2, owner, { ...state, selectedModel: 'x'.repeat(2097152) }), error => error.code === '22023');
    for (const sql of ["update public.brains set revision = 99", "delete from public.brains", `insert into public.brains (user_id,state,revision) values ('${other}','{}',1)`]) {
      await assert.rejects(db.query(sql), error => error.code === '42501');
    }
    await asUser(other);
    assert.equal((await db.query('select * from public.brains')).rows.length, 0);
    await assert.rejects(save(2, owner), error => error.code === '42501');
    assert.equal((await save(0, other)).rows[0].revision, 1);
    const ownRows = (await db.query('select * from public.brains')).rows;
    assert.equal(ownRows.length, 1); assert.equal(ownRows[0].user_id, other);
    await asUser(owner);
    assert.deepEqual((await db.query('select state from public.brains')).rows[0].state, workspace, 'records survive changing accounts and signing back in');
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.brains'), error => error.code === '42501');
    await assert.rejects(save(0), error => error.code === '42501');
    await db.exec('reset role; set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await assert.rejects(save(0), error => error.code === '42501');
  } finally { await db.close(); }
});

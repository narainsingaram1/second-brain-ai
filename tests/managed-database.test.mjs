import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/202610300001_brain_accounts.sql', import.meta.url), 'utf8');
const appearanceMigration = await readFile(new URL('../supabase/migrations/202611010001_task_appearance.sql', import.meta.url), 'utf8');
const memoryMigration = await readFile(new URL('../supabase/migrations/202611010002_agent_memory.sql', import.meta.url), 'utf8');
const workspacesMigration = await readFile(new URL('../supabase/migrations/202611050001_workspaces.sql', import.meta.url), 'utf8');
const eventsMigration = await readFile(new URL('../supabase/migrations/202611060001_calendar_events.sql', import.meta.url), 'utf8');
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
  taskAppearance: { accent: 'green', icons: { '["Work",null]': 'Rocket' }, subsections: { '["Work","General"]': { accent: 'blue', visual: 'book' } } },
  agentMemory: { version: 1, enabled: true, automaticLearning: true, entries: [{ id: 'memory-1', topic: 'writing style', category: 'preference', content: 'Prefers concise answers.', sources: [{ conversationId: 'thread-1', messageId: 'message-1', excerpt: 'I prefer concise answers.' }], createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-01T12:00:00Z', pinned: true }], suppressed: [{ topicHash: 'ab123', sourceIds: ['forgotten'], forgottenAt: '2026-11-01T12:00:00Z' }] },
  workspaces: [{ id: 'career', name: 'Career', description: 'Interview prep', template: 'career', color: 'purple', notes: 'Prepare stories', createdAt: '2026-11-05T12:00:00Z' }],
  trackerItems: [{ id: 'lc-1', workspaceId: 'career', kind: 'leetcode', title: 'Two Sum', status: 'done', fields: { difficulty: 'Easy', nextReview: '2026-11-12' }, history: { '2026-11-05': 1 } }, { id: 'job-1', workspaceId: 'career', kind: 'job_application', title: 'Engineer', subject: 'Example Co', status: 'screening', fields: { appliedDate: '2026-11-05' }, history: {} }],
  events: [{ id: 'event-1', title: 'Office hours', kind: 'meeting', date: '2026-11-10', startTime: '14:00', endTime: '15:00', location: 'Klaus 1447', link: 'https://meet.example.com/x', attendees: ['Prof. Smith'], notes: 'Bring HW3', createdAt: '2026-11-06T12:00:00Z', updatedAt: '2026-11-06T12:00:00Z' }],
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
    await db.exec(memoryMigration);
    await db.exec(workspacesMigration);
    await db.exec(eventsMigration);
    const asUser = async id => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]); await db.exec('set role authenticated'); };
    const save = (revision, uid = owner, payload = state) => db.query('select public.save_brain($1::jsonb,$2::bigint,$3::uuid) as revision', [JSON.stringify(payload), revision, uid]);
    await asUser(owner);
    assert.equal((await save(0)).rows[0].revision, 1);
    assert.equal((await save(1)).rows[0].revision, 2);
    const row = (await db.query('select * from public.brains')).rows[0];
    assert.equal(row.user_id, owner); assert.equal(row.state.openRouterKey, undefined);
    assert.equal(row.state.userId, undefined); assert.equal(row.state.unexpectedSecret, undefined);
    assert.deepEqual(row.state, workspace, 'every workspace collection and preference round-trips intact');
    await db.exec('begin');
    try {
      const { agentMemory: _memory, workspaces: _spaces, trackerItems: _trackers, events: _events, ...legacyState } = state;
      assert.equal((await save(2, owner, legacyState)).rows[0].revision, 3);
      assert.deepEqual((await db.query('select state from public.brains')).rows[0].state.agentMemory, workspace.agentMemory, 'older clients preserve memory when they omit the new field');
      const preserved = (await db.query('select state from public.brains')).rows[0].state;
      assert.deepEqual(preserved.workspaces, workspace.workspaces);
      assert.deepEqual(preserved.trackerItems, workspace.trackerItems);
      assert.deepEqual(preserved.events, workspace.events, 'older clients preserve calendar events when they omit the field');
      assert.equal((await save(3, owner, { ...state, workspaces: [], trackerItems: [], events: [] })).rows[0].revision, 4);
      const cleared = (await db.query('select state from public.brains')).rows[0].state;
      assert.deepEqual(cleared.workspaces, []); assert.deepEqual(cleared.trackerItems, []); assert.deepEqual(cleared.events, []);
    } finally { await db.exec('rollback'); }
    await assert.rejects(save(1), error => error.code === '40001');
    await assert.rejects(save(0), error => error.code === '40001');
    await assert.rejects(save(2, other), error => error.code === '42501');
    for (const invalid of [null, {}, { ...workspace.agentMemory, version: 2 }, { ...workspace.agentMemory, entries: Array.from({ length: 501 }, (_, i) => ({ ...workspace.agentMemory.entries[0], id: `id-${i}`, topic: `topic-${i}` })) }, { ...workspace.agentMemory, entries: [{ ...workspace.agentMemory.entries[0], content: 'api_key=sk-do-not-store-1234567890' }] }, { ...workspace.agentMemory, entries: [{ ...workspace.agentMemory.entries[0], sources: [{ conversationId: 'x', messageId: 'x', excerpt: 'ok', secret: 'hidden' }] }] }]) {
      await assert.rejects(save(2, owner, { ...state, agentMemory: invalid }), error => error.code === '22023');
    }
    for (const invalid of [{ ...state, workspaces: null }, { ...state, trackerItems: {} }, { ...state, workspaces: [{ ...workspace.workspaces[0], name: '' }] }, { ...state, workspaces: [workspace.workspaces[0], workspace.workspaces[0]] }, { ...state, trackerItems: [{ ...workspace.trackerItems[0], kind: 'invalid' }] },
      { ...state, events: {} }, { ...state, events: [{ ...workspace.events[0], date: 'Nov 10' }] }, { ...state, events: [{ ...workspace.events[0], startTime: '25:00' }] },
      { ...state, events: [{ ...workspace.events[0], link: 'javascript:alert(1)' }] }, { ...state, events: [{ ...workspace.events[0], kind: 'party' }] }, { ...state, events: [workspace.events[0], workspace.events[0]] }]) {
      await assert.rejects(save(2, owner, invalid), error => error.code === '22023');
    }
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

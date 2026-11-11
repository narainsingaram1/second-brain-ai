import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const now = '2026-11-11T12:00:00Z';

test('snapshot-only accounts save Health pages and days without dropping pending records or restoring the size cap', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;`);
    await db.query('insert into auth.users values ($1), ($2)', [owner, other]);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql') && f < '202611080001').sort()) {
      await db.exec(await readFile(new URL(file, dir), 'utf8'));
    }
    const asUser = async id => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
      await db.exec('set role authenticated');
    };
    const state = {
      tasks: [{ id: 'pending-task', title: 'Keep pending work' }], goals: [], habits: [], journalEntries: [],
      knowledgeItems: [{ id: 'pending-note', content: 'Keep the full note' }], chatHistory: [], sections: [], subsections: {},
      events: [{ id: 'meeting', title: 'Team meeting', kind: 'meeting', date: '2026-11-11' }],
      workspaces: [{ id: 'health', name: 'Health', description: '', template: 'health', color: 'green', notes: '', createdAt: now }],
      healthDays: [{ id: 'health-2026-11-11', date: '2026-11-11', metrics: { steps: 5000 }, workouts: [], tags: [], note: 'Morning walk', updatedAt: now }],
      preferences: { askBeforeChanges: true },
    };
    const save = (payload, revision, uid = owner) => db.query('select public.save_brain($1::jsonb, $2, $3::uuid) as revision', [JSON.stringify(payload), revision, uid]);
    await asUser(owner);
    await assert.rejects(save(state, 0), /Invalid workspace page/);
    await db.exec('reset role');
    const fix = await readFile(new URL('202611140001_snapshot_health_compatibility.sql', dir), 'utf8');
    await db.exec(fix);
    await db.exec(fix);
    await asUser(owner);
    await save({ ...state, openRouterKey: 'must-not-persist' }, 0);
    const saved = (await db.query('select state from public.brains')).rows[0].state;
    assert.deepEqual(saved, state);
    const { healthDays, preferences, ...olderClient } = state;
    await save(olderClient, 1);
    const preserved = (await db.query('select state from public.brains')).rows[0].state;
    assert.deepEqual(preserved.healthDays, healthDays);
    assert.deepEqual(preserved.preferences, preferences);
    await save({ ...state, chatHistory: [{ id: 'large', role: 'user', content: 'x'.repeat(3 * 1024 * 1024) }] }, 2);
    await assert.rejects(save(state, 2), e => e.code === '40001');
    for (const invalid of [
      { ...state, workspaces: [{ ...state.workspaces[0], template: 'unknown' }] },
      { ...state, workspaces: [{ ...state.workspaces[0], health: 'invalid' }] },
      { ...state, healthDays: {} },
      { ...state, healthDays: [{ ...healthDays[0], id: 'wrong' }] },
      { ...state, healthDays: [{ ...healthDays[0], metrics: { steps: 'many' } }] },
      { ...state, healthDays: [healthDays[0], healthDays[0]] },
      { ...state, healthDays: [{ ...healthDays[0], note: 'x'.repeat(2001) }] },
      { ...state, preferences: [] },
    ]) await assert.rejects(save(invalid, 3), e => e.code === '22023');
    await assert.rejects(save(state, 3, other), e => e.code === '42501');
    await save({ ...state, healthDays: [] }, 3);
    assert.deepEqual((await db.query('select state from public.brains')).rows[0].state.healthDays, []);
    await asUser(other);
    assert.equal((await db.query('select * from public.brains')).rows.length, 0);
    await db.exec('reset role; set role anon');
    await assert.rejects(save(state, 4), e => e.code === '42501');
  } finally { await db.close(); }
});

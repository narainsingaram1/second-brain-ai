import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/202610300001_brain_accounts.sql', import.meta.url), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const state = { tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [], sections: [], subsections: {}, openRouterKey: 'must-not-persist', userId: other, unexpectedSecret: 'must-not-persist' };

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
    const asUser = async id => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]); await db.exec('set role authenticated'); };
    const save = (revision, uid = owner, payload = state) => db.query('select public.save_brain($1::jsonb,$2::bigint,$3::uuid) as revision', [JSON.stringify(payload), revision, uid]);
    await asUser(owner);
    assert.equal((await save(0)).rows[0].revision, 1);
    assert.equal((await save(1)).rows[0].revision, 2);
    const row = (await db.query('select * from public.brains')).rows[0];
    assert.equal(row.user_id, owner); assert.equal(row.state.openRouterKey, undefined);
    assert.equal(row.state.userId, undefined); assert.equal(row.state.unexpectedSecret, undefined);
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
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.brains'), error => error.code === '42501');
    await assert.rejects(save(0), error => error.code === '42501');
    await db.exec('reset role; set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await assert.rejects(save(0), error => error.code === '42501');
  } finally { await db.close(); }
});

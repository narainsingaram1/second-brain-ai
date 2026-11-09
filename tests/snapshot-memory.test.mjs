import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const { writeManagedBrain } = await server.ssrLoadModule('/src/services/supabaseBrain.ts');
const owner = '11111111-1111-4111-8111-111111111111';
const now = '2026-11-09T12:00:00Z';
const state = () => ({
  tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [], sections: [], subsections: {},
  agentMemory: { version: 1, enabled: true, automaticLearning: true, suppressed: [], entries: [{
    id: 'fact', topic: 'major', category: 'person', content: 'Studies computer science.', sources: [],
    createdAt: now, updatedAt: now, pinned: false, origin: 'auto', mentions: 1, entities: ['CS'],
  }] },
});

test('learning saves successive batches to the old snapshot schema without changing local connected memory', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select '${owner}'::uuid $$;
      grant usage on schema auth, public to authenticated; grant execute on function auth.uid() to authenticated;`);
    await db.query('insert into auth.users values ($1)', [owner]);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql') && f < '202611080001').sort()) {
      await db.exec(await readFile(new URL(file, dir), 'utf8'));
    }
    await db.exec('set role authenticated');
    const calls = [];
    const client = { async rpc(name, args) {
      calls.push(name);
      try {
        const result = name === 'save_brain'
          ? await db.query('select public.save_brain($1::jsonb, $2::bigint, $3::uuid) as result', [JSON.stringify(args.p_state), args.p_revision, args.p_owner_id])
          : await db.query('select public.valid_agent_memory($1::jsonb) as result', [JSON.stringify(args.m)]);
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
    } };
    const local = state(), before = structuredClone(local);
    assert.deepEqual(await writeManagedBrain(local, 0, owner, client), { revision: 1 });
    assert.deepEqual(local, before);
    assert.deepEqual(calls, ['save_brain', 'valid_agent_memory', 'valid_agent_memory', 'save_brain']);
    local.agentMemory.entries.push({ ...local.agentMemory.entries[0], id: 'second', topic: 'school', content: 'Studies at Georgia Tech.' });
    assert.deepEqual(await writeManagedBrain(local, 1, owner, client), { revision: 2 });
    const saved = (await db.query('select state from public.brains')).rows[0].state;
    assert.equal(saved.agentMemory.entries.length, 2);
    assert.equal(saved.agentMemory.entries[0].category, 'fact');
    assert.equal(saved.agentMemory.entries[0].entities, undefined);
    await assert.rejects(writeManagedBrain(local, 0, owner, client), /Another device/);
    // Apply the real connected-memory update and confirm full fields now persist on the first attempt.
    await db.exec('reset role');
    await db.exec(await readFile(new URL('202611100001_connected_memory.sql', dir), 'utf8'));
    await db.exec('set role authenticated');
    calls.length = 0;
    await writeManagedBrain(local, 2, owner, client);
    assert.deepEqual(calls, ['save_brain']);
    assert.deepEqual((await db.query('select state from public.brains')).rows[0].state.agentMemory, local.agentMemory);
  } finally { await db.close(); }
});

test('size, invalid memory, permissions and revision failures are not bypassed', async () => {
  for (const [code, message, expected] of [
    ['22023', 'Invalid workspace', /2 MB snapshot/],
    ['42501', 'Not authorized', /account changed/],
    ['40001', 'Workspace changed', /Another device/],
  ]) {
    let calls = 0;
    await assert.rejects(writeManagedBrain(state(), 0, owner, { async rpc() { calls++; return { error: { code, message } }; } }), expected);
    assert.equal(calls, 1);
  }
  let saves = 0;
  const client = { async rpc(name) {
    if (name === 'save_brain') { saves++; return { error: { code: '22023', message: 'Invalid agent memory or memory limit exceeded' } }; }
    return { data: false, error: null };
  } };
  await assert.rejects(writeManagedBrain(state(), 0, owner, client), /Cloud memory validation failed/);
  assert.equal(saves, 1, 'No retry when even legacy memory is invalid');
});

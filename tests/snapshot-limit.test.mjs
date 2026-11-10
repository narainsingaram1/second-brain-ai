import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { owner, other, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';

test('preferences above 2 MiB round-trip after the cap migration, preserving ownership and revisions', async () => {
  const { db, asUser } = await supabaseLikeDatabase();
  try {
    const migration = await readFile(new URL('../supabase/migrations/202611130001_remove_snapshot_limit.sql', import.meta.url), 'utf8');
    await db.exec(migration); // Idempotent on the current record-based schema.
    await asUser(owner);
    const snapshot = { tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [], sections: [], subsections: {} };
    await db.query('select public.save_brain($1::jsonb, 0, $2::uuid)', [JSON.stringify(snapshot), owner]);
    await db.query('select public.migrate_brain_to_records()');
    const revision = Number((await db.query('select revision from public.brains')).rows[0].revision);
    const prefs = { chatHistory: [{ id: 'large-message', role: 'user', content: 'x'.repeat(3 * 1024 * 1024) }], sections: [], subsections: {}, openRouterKey: 'excluded' };
    const save = (value, rev = revision) => db.query('select public.save_brain_prefs($1::jsonb, $2)', [JSON.stringify(value), rev]);
    await save(prefs);
    const saved = (await db.query('select state, revision from public.brains')).rows[0];
    assert.deepEqual(saved.state.chatHistory, prefs.chatHistory);
    assert.equal(saved.state.openRouterKey, undefined);
    assert.equal(Number(saved.revision), revision + 1);
    await assert.rejects(save(prefs), e => e.code === '40001');
    await assert.rejects(save({ ...prefs, chatHistory: {} }, revision + 1), e => e.code === '22023');
    await asUser(other);
    assert.equal((await db.query('select * from public.brains')).rows.length, 0);
    await assert.rejects(save(prefs, revision + 1), e => e.code === '40001');
    await db.exec('reset role; set role anon');
    await assert.rejects(save(prefs, revision + 1), e => e.code === '42501');
  } finally { await db.close(); }
});

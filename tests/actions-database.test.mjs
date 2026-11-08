import { test } from 'node:test';
import assert from 'node:assert/strict';
import { owner, other, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';

test('approvals run once, only as approved, and the audit trail cannot be rewritten', async () => {
  const { db, asUser } = await supabaseLikeDatabase();
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  try {
    await asUser(owner);
    const payload = { tool: 'delete_task', args: { taskId: 'task-1' } };
    const proposed = await one("select * from public.propose_action('delete_task', 'internal', 'Delete task \"Essay\"', 'Deletions need approval', $1::jsonb, 'thread-1', 'msg-1')", [JSON.stringify(payload)]);
    assert.equal(proposed.status, 'proposed');
    assert.match(proposed.payload_hash, /^[0-9a-f]{64}$/);
    const decide = (id, decision, hash) => one('select * from public.decide_action($1, $2, $3)', [id, decision, hash]);

    // A different payload hash (the action changed after the user looked at it) is refused.
    await assert.rejects(decide(proposed.id, 'approve', '0'.repeat(64)), e => e.code === '40001');
    // Not approved yet: nothing can run it.
    await assert.rejects(one('select * from public.claim_action($1)', [proposed.id]), e => e.code === '40001');

    // Another account can neither see nor decide it.
    await asUser(other);
    assert.equal((await db.query('select * from public.agent_actions')).rows.length, 0);
    await assert.rejects(decide(proposed.id, 'approve', proposed.payload_hash), e => e.code === '40001');
    await asUser(owner);

    assert.equal((await decide(proposed.id, 'approve', proposed.payload_hash)).status, 'approved');
    await assert.rejects(decide(proposed.id, 'reject', proposed.payload_hash), e => e.code === '40001', 'decisions are final');
    assert.equal((await one('select * from public.claim_action($1)', [proposed.id])).status, 'executing');
    await assert.rejects(one('select * from public.claim_action($1)', [proposed.id]), e => e.code === '40001', 'an approved action runs at most once');
    await one("select public.complete_action($1, true, '{\"deleted\":\"task-1\"}'::jsonb)", [proposed.id]);
    assert.equal((await one('select status from public.agent_actions where id = $1', [proposed.id])).status, 'executed');

    // Rejected and expired actions never run.
    const rejected = await one("select * from public.propose_action('delete_event', 'internal', 'Delete event', 'Deletions need approval', '{}'::jsonb)");
    await decide(rejected.id, 'reject', rejected.payload_hash);
    await assert.rejects(one('select * from public.claim_action($1)', [rejected.id]), e => e.code === '40001');
    const stale = await one("select * from public.propose_action('delete_event', 'internal', 'Old', 'Deletions need approval', '{\"a\":1}'::jsonb)");
    await db.exec('reset role');
    await db.query("update public.agent_actions set expires_at = now() - interval '1 minute' where id = $1", [stale.id]);
    await asUser(owner);
    await assert.rejects(decide(stale.id, 'approve', stale.payload_hash), e => e.code === '40001');

    // Clients cannot write actions directly or forge their status.
    for (const sql of [`update public.agent_actions set status = 'approved'`, 'delete from public.agent_actions',
      `insert into public.agent_actions (user_id, tool, tier, summary, reason, payload, payload_hash, status) values ('${owner}', 'x', 'internal', 'x', 'x', '{}', '${'0'.repeat(64)}', 'approved')`]) {
      await assert.rejects(db.query(sql), e => e.code === '42501', sql);
    }

    // The audit trail records proposals and decisions, and is append-only.
    const audit = (await db.query('select actor, action from public.audit_events order by id')).rows.map(r => `${r.actor}:${r.action}`);
    assert.deepEqual(audit.slice(0, 5), ['assistant:proposed', 'user:approved', 'system:executed', 'assistant:proposed', 'user:rejected']);
    await one("select public.append_audit('assistant', 'updated', 'task', 'task-2', 'Renamed task')");
    for (const sql of ["update public.audit_events set action = 'nothing'", 'delete from public.audit_events',
      `insert into public.audit_events (user_id, actor, action) values ('${owner}', 'user', 'forged')`]) {
      await assert.rejects(db.query(sql), e => e.code === '42501', sql);
    }
    await asUser(other);
    assert.equal((await db.query('select * from public.audit_events')).rows.length, 0);
    await one("select public.append_audit('user', 'created', 'task', 'x', 'Mine')");
    assert.equal((await db.query('select * from public.audit_events')).rows.length, 1, 'each account sees only its own trail');

    // Secrets and the embedding cache are per account.
    await asUser(owner);
    await db.query("insert into public.user_secrets (user_id, name, ciphertext, iv, key_version, hint) values ($1, 'openrouter', 'abc', 'iv', 1, '1234')", [owner]);
    await assert.rejects(db.query("insert into public.user_secrets (user_id, name, ciphertext, iv, key_version, hint) values ($1, 'openrouter', 'abc', 'iv', 1, '1234')", [other]), e => e.code === '42501');
    await db.query("insert into public.passage_embeddings (user_id, key, vector) values ($1, 'k', '{0.1,0.2}')", [owner]);
    await asUser(other);
    assert.equal((await db.query('select * from public.user_secrets')).rows.length, 0);
    assert.equal((await db.query('select * from public.passage_embeddings')).rows.length, 0);
  } finally { await db.close(); }
});

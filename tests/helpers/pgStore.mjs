// Server store and record transport over PGlite, calling the same SQL functions the Supabase versions call.
// Tests pass the PreferencesConflict class from the module instance they loaded.

/** The same transport contract as supabaseRecordTransport, over PGlite as the signed-in user. */
export function pgTransport(db, sent, PreferencesConflict = Error) {
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


/** A ServerStore (server/lib/store.ts) for one user, backed by PGlite. Call asUser(userId) before using it. */
export function pgStore(db, userId, PreferencesConflict, HttpError) {
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const rpc = async (fn, fallback) => {
    try { return await fn(); }
    catch (error) {
      if (!HttpError) throw error;
      if (error.code === '40001') throw new HttpError(409, error.message || fallback);
      if (error.code === '54000') throw new HttpError(429, error.message);
      throw new HttpError(400, fallback);
    }
  };
  return {
    userId,
    records: pgTransport(db, undefined, PreferencesConflict),
    async getSecret(name) {
      const r = await one('select ciphertext, iv, key_version, hint, updated_at from public.user_secrets where name = $1', [name]);
      return r ? { ciphertext: r.ciphertext, iv: r.iv, keyVersion: r.key_version, hint: r.hint, updatedAt: String(r.updated_at) } : null;
    },
    async putSecret(name, row) {
      await db.query(`insert into public.user_secrets (user_id, name, ciphertext, iv, key_version, hint) values ($1, $2, $3, $4, $5, $6)
        on conflict (user_id, name) do update set ciphertext = excluded.ciphertext, iv = excluded.iv, key_version = excluded.key_version, hint = excluded.hint, updated_at = now()`,
        [userId, name, row.ciphertext, row.iv, row.keyVersion, row.hint]);
    },
    async deleteSecret(name) { await db.query('delete from public.user_secrets where name = $1', [name]); },
    async appendAudit(e) {
      await db.query('select public.append_audit($1, $2, $3, $4, $5, $6, $7::jsonb)', [e.actor, e.action, e.entityType ?? null, e.entityId ?? null, e.title ?? null, e.actionId ?? null, JSON.stringify(e.metadata ?? {})]);
    },
    proposeAction: i => rpc(() => one('select * from public.propose_action($1, $2, $3, $4, $5::jsonb, $6, $7)', [i.tool, i.tier, i.summary, i.reason, JSON.stringify(i.payload), i.conversationId ?? null, i.messageId ?? null]), 'Could not ask for approval.'),
    async getAction(id) { return (await one('select * from public.agent_actions where id = $1', [id])) || null; },
    async listPendingActions() { return (await db.query("select * from public.agent_actions where status = 'proposed' and expires_at > now() order by created_at desc")).rows; },
    decideAction: (id, decision, hash) => rpc(() => one('select * from public.decide_action($1, $2, $3)', [id, decision, hash]), 'This action is no longer waiting for a decision.'),
    claimAction: id => rpc(() => one('select * from public.claim_action($1)', [id]), 'This action is not approved or has already run.'),
    async completeAction(id, ok, result) { await db.query('select public.complete_action($1, $2, $3::jsonb)', [id, ok, JSON.stringify(result ?? null)]); },
    async getEmbedding(key) { return (await one('select vector from public.passage_embeddings where key = $1', [key]))?.vector; },
    async putEmbedding(key, vector) { await db.query('insert into public.passage_embeddings (user_id, key, vector) values ($1, $2, $3) on conflict do nothing', [userId, key, vector]); },
    async getConnection(provider) {
      const r = await one('select * from public.connections where provider = $1', [provider]);
      return r ? { provider: r.provider, accountEmail: r.account_email, scopes: r.scopes, status: r.status, connectedAt: String(r.connected_at), lastUsedAt: r.last_used_at && String(r.last_used_at), lastError: r.last_error } : null;
    },
    async putConnection(row) {
      await db.query(`insert into public.connections (user_id, provider, account_email, scopes, status) values ($1, $2, $3, $4, $5)
        on conflict (user_id, provider) do update set account_email = excluded.account_email, scopes = excluded.scopes, status = excluded.status, connected_at = now(), last_error = null`,
        [userId, row.provider, row.accountEmail, row.scopes, row.status]);
    },
    async markConnection(provider, patch) {
      if (patch.status) await db.query('update public.connections set status = $2 where provider = $1', [provider, patch.status]);
      if (patch.lastError !== undefined) await db.query('update public.connections set last_error = $2 where provider = $1', [provider, patch.lastError]);
      if (patch.used) await db.query('update public.connections set last_used_at = now() where provider = $1', [provider]);
    },
    async deleteConnection(provider) { await db.query('delete from public.connections where provider = $1', [provider]); },
    async documentTexts(ids) { return new Map((await db.query('select id, content from public.study_documents where id = any($1)', [ids])).rows.map(r => [r.id, r.content])); },
  };
}

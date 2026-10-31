import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const server = await createServer({ cacheDir: '/private/tmp/synapse-managed-ui-tests', configFile: false, define: { 'import.meta.env.VITE_AUTH_PROVIDER': JSON.stringify('supabase') }, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('managed login never falls back to local authentication when configuration is absent', async () => {
  const { getSupabase } = await server.ssrLoadModule('/src/services/managedAuth.ts');
  assert.throws(() => getSupabase(), /not configured/);
});

test('account identity uses provider-verified ID, not editable user metadata', async () => {
  const { authSession } = await server.ssrLoadModule('/src/services/managedAuth.ts');
  const session = authSession({ id: 'verified', email: 'verified@example.test', created_at: '2026-10-30', app_metadata: { provider: 'email' }, user_metadata: { id: 'attacker', email: 'other@example.test', provider: 'google', full_name: '<script>alert(1)</script>' } });
  assert.equal(session.currentUser.id, 'verified'); assert.equal(session.currentUser.email, 'verified@example.test');
  assert.equal(session.currentUser.provider, 'email'); assert.equal(session.currentUser.passwordHash, undefined);
  const { ManagedAccountModal } = await server.ssrLoadModule('/src/components/ManagedAccountModal.tsx');
  const markup = renderToStaticMarkup(React.createElement(ManagedAccountModal, { isOpen: true, onClose() {}, session }));
  assert.ok(markup.includes('verified@example.test')); assert.ok(!markup.includes('<script>'));
});


test('markdown links reject executable schemes while preserving HTTPS links', async () => {
  const { MarkdownView } = await server.ssrLoadModule('/src/components/MarkdownView.tsx');
  const html = renderToStaticMarkup(React.createElement(MarkdownView, { content: '[bad](javascript:alert) [bad2](data:text/html,evil) [good](https://example.test)' }));
  assert.ok(!html.includes('href="javascript:')); assert.ok(!html.includes('href="data:'));
  assert.ok(html.includes('href="https://example.test"'));
});


test('hosted semantic cache clears between accounts and drops in-flight indexing from the prior account', async () => {
  const { vectorVault } = await server.ssrLoadModule('/src/services/vectorVault.ts');
  const item = { id: 'private-task', title: 'Private interview notes', dueDate: '', priority: 'medium', section: 'Career', status: 'not_started', completed: false };
  vectorVault.setAccount('alice');
  await vectorVault.indexItem(item, 'task');
  assert.equal((await vectorVault.getVaultStats()).total_chunks, 1);
  vectorVault.setAccount('bob');
  assert.equal((await vectorVault.getVaultStats()).total_chunks, 0);
  assert.equal((await vectorVault.search('interview')).length, 0);
  vectorVault.setAccount('alice');
  const pending = vectorVault.indexItem(item, 'task');
  vectorVault.setAccount('bob');
  await pending;
  assert.equal((await vectorVault.getVaultStats()).total_chunks, 0);
});

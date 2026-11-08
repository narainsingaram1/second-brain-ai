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


test('the shared index never reuses one account\'s embeddings for another, and clears on sign-out', async () => {
  const { warmIndex, clearRetrievalMemory } = await server.ssrLoadModule('/src/services/brainRetrieval.ts');
  const { vectorVault } = await server.ssrLoadModule('/src/services/vectorVault.ts');
  let embedded = 0;
  globalThis.fetch = async (_url, opts) => { const input = JSON.parse(opts.body).input; embedded += input.length; return Response.json({ data: input.map((_, index) => ({ index, embedding: [1, 0, 0] })) }); };
  const task = { id: 'private-task', title: 'Private interview notes', dueDate: '', priority: 'medium', section: 'Career', status: 'not_started', completed: false };
  const brain = (userId, tasks) => ({ userId, openRouterKey: 'k', tasks, goals: [], habits: [], journalEntries: [], knowledgeItems: [], events: [], trackerItems: [] });
  await warmIndex(brain('alice', [task]), 'k');
  assert.equal(embedded, 1);
  await warmIndex(brain('alice', [task]), 'k');
  assert.equal(embedded, 1, 'unchanged passages are not re-embedded');
  await warmIndex(brain('bob', [task]), 'k');
  assert.equal(embedded, 2, 'another account embeds its own copy');
  assert.equal((await vectorVault.search(brain('bob', []), 'interview')).length, 0);
  assert.equal((await vectorVault.getVaultStats(brain('alice', [task]))).embedded_chunks, 1);
  clearRetrievalMemory();
  assert.equal((await vectorVault.getVaultStats(brain('alice', [task]))).embedded_chunks, 0, 'in-memory vectors are dropped on sign-out');
});

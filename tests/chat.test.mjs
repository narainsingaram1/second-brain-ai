import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const server = await createServer({ cacheDir: "/tmp/synapse-chat-test-cache", configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const { ConversationMessage } = await server.ssrLoadModule('/src/components/ConversationMessage.tsx');
const { ChatWorkspace } = await server.ssrLoadModule('/src/components/ChatWorkspace.tsx');
const { readableMessage, referenceTitle, isNearBottom } = await server.ssrLoadModule('/src/utils/chatPresentation.ts');
const state = { tasks: [{ id: 'task-123', title: 'Prepare presentation', dueDate: '2026-11-02', status: 'in_progress', completed: false, priority: 'high', section: 'Career' }], goals: [{ id: 'goal-456', title: 'Research opportunity', progress: 35, milestones: [], status: 'in_progress' }], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [], conversations: [], selectedModel: 'test/model' };
const message = { id: 'answer', role: 'assistant', content: 'Start with [task:task-123]. Then review [goal:goal-456].', timestamp: '', sources: [{ id: 'task-123', type: 'task', title: 'Prepare presentation' }, { id: 'goal-456', type: 'goal', title: 'Research opportunity' }] };
const conversation = { busy: false, progress: '', run: async () => {}, stop() {}, startNew() {}, resume() {} };

test('existing task and goal citations render as readable inline references', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationMessage, { message, state }));
  assert.match(html, /chat-inline-reference/);
  assert.match(html, /Prepare presentation/);
  assert.match(html, /Research opportunity/);
  assert.doesNotMatch(html, /\[task:task-123\]|\[goal:goal-456\]/);
  assert.doesNotMatch(html, />task-123<|>goal-456</);
});
test('copy and save text use record titles rather than implementation identifiers', () => {
  assert.equal(readableMessage(message, state), 'Start with Prepare presentation. Then review Research opportunity.');
  assert.equal(referenceTitle('task', 'removed', [{ id: 'removed', type: 'task', title: 'Archived task' }], state), 'Archived task');
  assert.equal(referenceTitle('task', 'unknown', [], state), 'Unavailable task');
});
test('chat uses one scroll viewport and a single composer without the duplicate result card', () => {
  const messages = [{ id: 'question', role: 'user', content: 'Help me plan', timestamp: '' }, message];
  const html = renderToStaticMarkup(React.createElement(ChatWorkspace, { conversation, state, messages }));
  assert.equal((html.match(/data-testid="chat-scroll"/g) || []).length, 1);
  assert.equal((html.match(/<textarea/g) || []).length, 1);
  assert.match(html, /Ask a follow-up/);
  assert.doesNotMatch(html, /Response added to the conversation above|Vault Context|What’s on/);
});
test('initial assistant greeting does not turn welcome into an active chat', () => {
  const html = renderToStaticMarkup(React.createElement(ChatWorkspace, { conversation, state, messages: [{ id: 'greeting', role: 'assistant', content: 'Welcome', timestamp: '' }] }));
  assert.match(html, /What’s on/); assert.match(html, /chat-suggestions/); assert.doesNotMatch(html, /chat-toolbar/);
});
test('scroll pinning respects reading older answers', () => {
  assert.equal(isNearBottom(2000, 0, 600), false);
  assert.equal(isNearBottom(2000, 1380, 600), true);
  assert.equal(isNearBottom(400, 0, 600), true);
});

test('task and goal tables render as structured tables with readable citations', async () => {
  const { MarkdownView } = await server.ssrLoadModule('/src/components/MarkdownView.tsx');
  const html = renderToStaticMarkup(React.createElement(MarkdownView, {
    content: '| Task | Due | Status |\n| --- | --- | --- |\n| Presentation | Nov 2 | In progress |',
  }));
  assert.match(html, /<table/); assert.match(html, /<th[^>]*>Task<\/th>/); assert.match(html, /<td[^>]*>Nov 2<\/td>/);
});

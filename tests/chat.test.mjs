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
const { AgentActivity, closeMarkdown } = await server.ssrLoadModule('/src/components/AgentActivity.tsx');
const { describeCall, describeResult, pastTense, ActivityTracker } = await server.ssrLoadModule('/src/services/agentActivity.ts');
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
  assert.match(html, /<h1>Ask Iris<\/h1>/); assert.match(html, /chat-suggestions/); assert.doesNotMatch(html, /chat-toolbar/);
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


test('streamed text never shows half-written markdown', () => {
  assert.equal(closeMarkdown('**Short ans'), '**Short ans**');
  assert.equal(closeMarkdown('Use `LD'), 'Use `LD`');
  assert.equal(closeMarkdown('See [the docs](https://exa'), 'See the docs');
  assert.equal(closeMarkdown('Start with [task:ab'), 'Start with ');
  assert.equal(closeMarkdown('```js\nconst x'), '```js\nconst x\n```');
  assert.equal(closeMarkdown('- item one\n* item two'), '- item one\n* item two');
  assert.equal(closeMarkdown('Done **bold** and *it'), 'Done **bold** and *it*');
});

test('steps describe what the assistant is doing in plain words', () => {
  assert.equal(describeCall('web_search', { query: 'LC-3 ISA' }).label, 'Searching the web for “LC-3 ISA”');
  assert.equal(describeCall('search_records', { query: 'heaps', type: 'knowledge' }).label, 'Searching your notes for “heaps”');
  assert.equal(describeCall('query_records', { type: 'task', dateFrom: '2026-11-01', dateTo: '2026-11-07' }).label, 'Looking through your tasks from 2026-11-01 to 2026-11-07');
  assert.equal(describeCall('read_url', { url: 'https://www.example.com/a' }).label, 'Reading example.com');
  assert.equal(describeCall('create_tracker_item', { kind: 'leetcode', title: 'Two Sum' }).label, 'Adding tracker entry “Two Sum”');
  assert.equal(pastTense('Searching the web for “x”'), 'Searched the web for “x”');
  assert.deepEqual(describeResult('web_search', {}, { sources: [{ title: 'Wiki', url: 'https://w.org' }] }).items, ['Wiki|https://w.org']);
  assert.match(describeResult('delete_task', {}, { status: 'awaiting_approval', summary: 'Delete task "X"' }).label, /approval/);
});

test('activity renders a live status while working and an expandable summary when done', () => {
  const now = Date.now();
  const live = renderToStaticMarkup(React.createElement(AgentActivity, { live: true, steps: [
    { id: 'a', kind: 'think', label: 'Thinking', detail: 'Checking the notes first.', status: 'running', startedAt: now }] }));
  assert.match(live, /agent-shimmer/); assert.match(live, />Thinking</); assert.match(live, /Checking the notes first/);
  const done = renderToStaticMarkup(React.createElement(AgentActivity, { steps: [
    { id: 'a', kind: 'think', label: 'Thought for 2s', detail: 'Plan', status: 'done', startedAt: now - 9000, endedAt: now - 7000 },
    { id: 'b', kind: 'web', label: 'Searched the web for “x”', items: ['Wiki|https://w.org'], status: 'done', startedAt: now - 7000, endedAt: now },
    { id: 'c', kind: 'think', label: 'Thinking', status: 'done', startedAt: now, endedAt: now, hidden: true }] }));
  assert.match(done, /Worked for 9s/); assert.match(done, /1 step</); assert.match(done, /href="https:\/\/w.org"/);
  assert.equal(renderToStaticMarkup(React.createElement(AgentActivity, { steps: [] })), '');
  const tracker = new ActivityTracker();
  const id = tracker.start('think', 'Thinking'); tracker.hide(id);
  assert.deepEqual(tracker.list(), []);
});

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
const { AgentActivity, closeMarkdown, thoughtHeadline } = await server.ssrLoadModule('/src/components/AgentActivity.tsx');
const { describeCall, describeResult, pastTense, ActivityTracker, splitStepItem } = await server.ssrLoadModule('/src/services/agentActivity.ts');
const state = { tasks: [{ id: 'task-123', title: 'Prepare presentation', dueDate: '2026-11-02', status: 'in_progress', completed: false, priority: 'high', section: 'Career' }], goals: [], habits: [], journalEntries: [], events: [{ id: 'event-456', title: 'Research opportunity', date: '2026-11-03' }], knowledgeItems: [], chatHistory: [], conversations: [], selectedModel: 'test/model' };
const message = { id: 'answer', role: 'assistant', content: 'Start with [task:task-123]. Then review [event:event-456].', timestamp: '', sources: [{ id: 'task-123', type: 'task', title: 'Prepare presentation' }, { id: 'event-456', type: 'event', title: 'Research opportunity' }] };
const conversation = { busy: false, progress: '', run: async () => {}, stop() {}, startNew() {}, resume() {} };

test('existing task and event citations render as readable inline references', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationMessage, { message, state }));
  assert.match(html, /chat-inline-reference/);
  assert.match(html, /Prepare presentation/);
  assert.match(html, /Research opportunity/);
  assert.doesNotMatch(html, /\[task:task-123\]|\[event:event-456\]/);
  assert.doesNotMatch(html, />task-123<|>event-456</);
});
test('web sources render as visible links, and a reply shows its time, tokens and cost', () => {
  const reply = { id: 'web-answer', role: 'assistant', content: 'One report mentions three sections.', timestamp: '',
    sources: [{ id: 'https://www.glassdoor.com/Interview/q.htm', type: 'web', title: 'Interview Questions | Glassdoor', url: 'https://www.glassdoor.com/Interview/q.htm' }],
    usage: { ms: 12400, model: 'test/model', calls: 2, inputTokens: 17000, outputTokens: 1200, cost: 0.0312, costComplete: true, webSearches: 1 } };
  const html = renderToStaticMarkup(React.createElement(ConversationMessage, { message: reply, state }));
  assert.match(html, /href="https:\/\/www\.glassdoor\.com\/Interview\/q\.htm"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /Interview Questions \| Glassdoor/);
  assert.doesNotMatch(html, /<details/, 'sources are shown, not hidden behind a toggle');
  assert.match(html, /12s/); assert.match(html, /18k tokens/); assert.match(html, /\$0\.031/);
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
test('new chat renders even when a cached starter has a retired category', () => {
  const previousStorage = globalThis.localStorage;
  const cache = {
    date: '2026-11-22',
    at: Date.now(),
    fingerprint: 'previous-version',
    starters: [{ kind: 'goal', title: 'Review project milestones', detail: 'Plan the next step', prompt: 'Review my project milestones' }],
  };
  globalThis.localStorage = { getItem: key => key === 'synapse_chat_starters_guest' ? JSON.stringify(cache) : null };
  try {
    const html = renderToStaticMarkup(React.createElement(ChatWorkspace, { conversation, state, messages: [] }));
    assert.match(html, /<h1>Ask Iris<\/h1>/);
    assert.match(html, /data-kind="idea"/);
    assert.match(html, /Review project milestones/);
  } finally {
    globalThis.localStorage = previousStorage;
  }
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
  // Page titles often contain "|" themselves; the link is what follows the last one, and only a real web address.
  assert.deepEqual(splitStepItem('Interview Questions | Glassdoor|https://www.glassdoor.com/x'), { title: 'Interview Questions | Glassdoor', url: 'https://www.glassdoor.com/x' });
  assert.deepEqual(splitStepItem('Notes | Week 3'), { title: 'Notes | Week 3' });
  assert.deepEqual(splitStepItem('Bad|javascript:alert(1)'), { title: 'Bad|javascript:alert(1)' });
  assert.match(describeResult('delete_task', {}, { status: 'awaiting_approval', summary: 'Delete task "X"' }).label, /approval/);
});

test('the live status follows the model\'s latest thought in a few words', () => {
  assert.equal(thoughtHeadline('Okay, the user wants a study plan.'), 'Understanding the request');
  assert.equal(thoughtHeadline("The user wants a plan. I'll check their tasks and deadlines first."), 'Checking their tasks and deadlines first');
  assert.equal(thoughtHeadline('Then I need to compare the workload across days, so nothing piles up.'), 'Comparing the workload across days');
  assert.equal(thoughtHeadline('Let me plan the week.'), 'Planning the week');
  assert.equal(thoughtHeadline('I should also look at **exam** dates.'), 'Looking at exam dates');
  assert.equal(thoughtHeadline('Still writing the first sent'), '', 'nothing until a sentence is complete');
  assert.ok(thoughtHeadline(`${'word '.repeat(40)}end.`).length <= 65);
});

test('activity renders a live status while working and an expandable summary when done', () => {
  const now = Date.now();
  const live = renderToStaticMarkup(React.createElement(AgentActivity, { live: true, steps: [
    { id: 'a', kind: 'think', label: 'Thinking', detail: 'Checking the notes first.', status: 'running', startedAt: now }] }));
  assert.match(live, /agent-shimmer/); assert.match(live, /agent-loader is-think/); assert.match(live, /Checking the notes first/);
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

test('agentic actions render preview card with badges, details and change inspector', () => {
  const msgWithActions = {
    ...message,
    actions: [
      {
        action: 'create_task',
        type: 'task',
        id: 'task-123',
        title: 'Prepare presentation',
        summary: 'Create task "Prepare presentation"',
        details: ['Due date: — → 2026-11-02', 'Priority: — → high'],
      },
    ],
  };
  const html = renderToStaticMarkup(React.createElement(ConversationMessage, { message: msgWithActions, state }));
  assert.match(html, /action-applied-container/);
  assert.match(html, /Action executed in your workspace/);
  assert.match(html, /Created/);
  assert.match(html, /Prepare presentation/);
  assert.match(html, /Preview change/);
  assert.match(html, /View record/);
  assert.match(html, /Go to in app/);
});

test('tracker actions render direct navigation to workspace and job application UI preview', async () => {
  const { getRecordLocation } = await server.ssrLoadModule('/src/utils/recordNavigation.ts');
  const careerState = {
    ...state,
    workspaces: [{ id: 'ws-career', name: 'Career', template: 'career' }],
    trackerItems: [
      {
        id: 'tracker-epic-1',
        workspaceId: 'ws-career',
        kind: 'job_application',
        title: 'AI Programmer Intern (Research Engineering Intern)',
        subject: 'Epic Games',
        status: 'applied',
        fields: { location: 'Cary, NC', jobType: 'Internship' },
        streak: 0,
        notes: 'Unreal Engine AI team. ML/generative research.',
      },
    ],
  };

  const loc = getRecordLocation(careerState, 'tracker', 'tracker-epic-1');
  assert.equal(loc.tab, 'workspace:ws-career');
  assert.equal(loc.panel, 'job_application');
  assert.equal(loc.breadcrumb, 'Career Workspace › Job Applications');

  const trackerMsg = {
    ...message,
    actions: [
      {
        action: 'create_tracker',
        type: 'tracker',
        id: 'tracker-epic-1',
        title: 'AI Programmer Intern (Research Engineering Intern)',
        summary: 'Create tracker entry "AI Programmer Intern (Research Engineering Intern)"',
      },
    ],
  };

  const html = renderToStaticMarkup(React.createElement(ConversationMessage, { message: trackerMsg, state: careerState }));
  assert.match(html, /Go to in app/);
  assert.match(html, /View record/);
  assert.match(html, /AI Programmer Intern \(Research Engineering Intern\)/);
});


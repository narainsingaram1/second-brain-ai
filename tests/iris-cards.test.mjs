import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const server = await createServer({ cacheDir: '/tmp/synapse-iris-cards-cache', configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const { parseIrisUi, plainIrisUi, habitWeeks } = await server.ssrLoadModule('/src/utils/irisUi.ts');
const { prepareChecklistTasks } = await server.ssrLoadModule('/src/services/irisCards.ts');
const { ConversationMessage } = await server.ssrLoadModule('/src/components/ConversationMessage.tsx');
const { readableMessage } = await server.ssrLoadModule('/src/utils/chatPresentation.ts');
const { SYNAPSE_INSTRUCTIONS } = await server.ssrLoadModule('/src/services/agentDispatcher.ts');

const checklist = { type: 'checklist', title: 'This week', section: 'Academic', items: [{ title: 'Review chapter 4', dueDate: '2026-11-11', priority: 'high' }, { title: 'Practice quiz' }] };
const fenced = spec => '```iris-ui\n' + JSON.stringify(spec) + '\n```';
const render = (content, extra = {}) => renderToStaticMarkup(React.createElement(ConversationMessage, { message: { id: 'a', role: 'assistant', content, timestamp: '', ...extra.message }, state: extra.state, streaming: extra.streaming }));
const state = () => ({ tasks: [], sections: ['Academic'], subsections: { Academic: ['General'] }, habits: [], goals: [], journalEntries: [], knowledgeItems: [], chatHistory: [] });

test('parser accepts each card and drops anything it cannot trust', () => {
  assert.equal(parseIrisUi(JSON.stringify(checklist)).items.length, 2);
  assert.equal(parseIrisUi('{not json'), null);
  assert.equal(parseIrisUi(JSON.stringify({ type: 'script', src: 'x' })), null);
  assert.equal(parseIrisUi(JSON.stringify({ type: 'choices', options: ['Only one'] })), null);
  assert.equal(parseIrisUi(JSON.stringify({ type: 'quiz', title: 'Q', questions: [{ question: 'A?', options: ['x', 'y'], answer: 2 }] })), null);
  const cleaned = parseIrisUi(JSON.stringify({ type: 'checklist', title: 'T', items: [{ title: 'Bad date', dueDate: 'next week', dueTime: '09:00', priority: 'mega' }, { title: '  ' }] }));
  assert.deepEqual(cleaned.items, [{ title: 'Bad date' }]);
});
test('a finished block renders the card, never the raw JSON', () => {
  const html = render(`Here is a plan.\n\n${fenced(checklist)}`);
  assert.match(html, /iris-card/); assert.match(html, /Review chapter 4/); assert.match(html, /Add 2 tasks/);
  assert.doesNotMatch(html, /&quot;type&quot;|iris-ui/);
});
test('a block still streaming shows a placeholder instead of partial JSON', () => {
  const html = render('Here is a plan.\n\n```iris-ui\n{"type":"check');
  assert.match(html, /iris-skeleton/); assert.doesNotMatch(html, /&quot;type|check&quot;/);
});
test('an invalid card is reported quietly and ordinary code blocks are untouched', () => {
  assert.match(render('```iris-ui\n{nope}\n```'), /couldn’t be displayed/);
  const code = render('```js\nconst a = 1;\n```');
  assert.match(code, /const a = 1/); assert.doesNotMatch(code, /iris-/);
});
test('copy, notes and Telegram get readable text', () => {
  const plain = readableMessage({ content: `Plan:\n\n${fenced(checklist)}\n\nGood luck.` });
  assert.match(plain, /- Review chapter 4 \(2026-11-11\)/); assert.match(plain, /Good luck\./); assert.doesNotMatch(plain, /iris-ui|"type"/);
  assert.equal(plainIrisUi('No cards here.\n\n\nStill as written.'), 'No cards here.\n\n\nStill as written.');
  assert.equal(plainIrisUi('Before\n```iris-ui\n{"type":"che'), 'Before');
});
test('ticked rows become validated tasks and only those', () => {
  const { mutations, added } = prepareChecklistTasks(state(), parseIrisUi(JSON.stringify(checklist)), [0]);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].action, 'create_task');
  assert.equal(mutations[0].record.title, 'Review chapter 4');
  assert.equal(mutations[0].record.section, 'Academic');
  assert.equal(mutations[0].record.dueDate, '2026-11-11');
  assert.equal(added[0], mutations[0].record.id);
});
test('saved progress survives: added rows link to their task and cannot be added twice', () => {
  const html = render(fenced(checklist), { message: { cardState: { 0: { added: { 0: 't1', 1: 't2' } } } } });
  assert.match(html, /Added 2 tasks/); assert.match(html, /Open task: Review chapter 4/); assert.doesNotMatch(html, /iris-primary/);
});
test('quiz shows the explanation and marks the answer after it is answered', () => {
  const quiz = { type: 'quiz', title: 'Traps', questions: [{ question: 'Halt?', options: ['x20', 'x25'], answer: 1, why: 'x25 is HALT.' }, { question: 'Puts?', options: ['x22', 'x21'], answer: 0 }] };
  assert.doesNotMatch(render(fenced(quiz)), /x25 is HALT/);
  const done = render(fenced(quiz), { message: { cardState: { 0: { answers: [1, 1] } } } });
  assert.match(done, /iris-score/); assert.match(done, /1 question to go back over/);
});
test('charts use the habit record, and a wrong ID shows no invented numbers', () => {
  const today = new Date(2026, 10, 11, 12); // A Wednesday.
  const weeks = habitWeeks({ history: { '2026-11-09': true, '2026-11-10': true, '2026-11-03': true, '2026-11-15': true } }, 4, today);
  assert.deepEqual(weeks.map(w => w.done), [0, 0, 1, 3]);
  assert.equal(weeks[3].current, true);
  const spec = { type: 'chart', habitId: 'h1', weeks: 4 };
  assert.match(render(fenced(spec), { state: { ...state(), habits: [{ id: 'h1', name: 'Morning run', frequency: 'daily', streak: 3, bestStreak: 9, history: {} }] } }), /Morning run/);
  assert.match(render(fenced(spec), { state: state() }), /couldn’t be displayed/);
});
test('the assistant is told about each card and that checklists only propose', () => {
  for (const type of ['checklist', 'choices', 'quiz', 'chart']) assert.ok(SYNAPSE_INSTRUCTIONS.includes(`"type":"${type}"`), type);
  assert.match(SYNAPSE_INSTRUCTIONS, /do not also call create_task/);
});
test('pressing Add saves the tasks, records them on the card, and a repeat press adds nothing', async () => {
  const store = new Map();
  globalThis.localStorage ??= { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const { useBrainConversation } = await server.ssrLoadModule('/src/hooks/useBrainConversation.ts');
  const message = { id: 'm1', role: 'assistant', content: fenced(checklist), timestamp: '' };
  const initial = { ...state(), userId: 'guest', chatHistory: [message], auditLog: [] };
  let saved = initial, conversation, snapshots = 0;
  const setState = next => { saved = typeof next === 'function' ? next(saved) : next; };
  function Probe() { conversation = useBrainConversation(initial, setState, () => { snapshots++; }); return null; }
  renderToStaticMarkup(React.createElement(Probe));
  const spec = parseIrisUi(JSON.stringify(checklist));
  await conversation.addCardTasks('m1', 0, spec, [1]);
  assert.deepEqual(saved.tasks.map(t => t.title), ['Practice quiz']);
  assert.equal(saved.chatHistory[0].cardState[0].added[1], saved.tasks[0].id);
  assert.equal(saved.auditLog[0].action, 'create_task');
  assert.equal(snapshots, 1, 'one undo point');
  await conversation.addCardTasks('m1', 0, spec, [1]);
  assert.equal(saved.tasks.length, 1, 'no duplicate on a repeat press');
  conversation.setCardState('m1', 1, { picked: 'Exam prep' });
  assert.equal(saved.chatHistory[0].cardState[1].picked, 'Exam prep');
});

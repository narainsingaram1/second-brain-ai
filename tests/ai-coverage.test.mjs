// Keeps the assistant able to change everything the app stores.
//
// Every collection and preference the app saves must be listed in COVERAGE below, either with the tools that
// create, update and delete it, or with a written reason it is left to the app. Adding a new kind of data
// (or a new tracker field) without giving the assistant a way to change it fails this test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ cacheDir: '/tmp/synapse-coverage-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const { BRAIN_TOOLS, MUTATION_TOOLS, prepareMutation, applyMutation, mutationRecords } = await load('/src/services/brainTools.ts');
const { RECORD_COLLECTIONS, PREFERENCE_KEYS } = await load('/src/services/brainRecords.ts');
const { INTERNAL_TOOLS, approvalReason, describeMutation } = await load('/src/services/actionPolicy.ts');
const { TRACKER_FIELDS, TRACKER_FIELD_KEYS } = await load('/src/utils/trackerFields.ts');

const COVERAGE = {
  tasks: { create: 'create_task', update: 'update_task', delete: 'delete_task' },
  goals: { create: 'create_goal', update: 'update_goal', delete: 'delete_goal' },
  habits: { create: 'create_habit', update: 'update_habit', delete: 'delete_habit' },
  journalEntries: { create: 'log_journal', update: 'update_journal_entry', delete: 'delete_journal_entry' },
  knowledgeItems: { create: 'create_note', update: 'update_note', delete: 'delete_note' },
  events: { create: 'create_event', update: 'update_event', delete: 'delete_event' },
  trackerItems: { create: 'create_tracker_item', update: 'update_tracker_item', delete: 'delete_tracker_item' },
  workspaces: { create: 'create_workspace', update: 'update_workspace', delete: 'delete_workspace' },
  noteFolders: { create: 'create_note_folder', update: 'update_note_folder', delete: 'delete_note_folder' },
  sections: { create: 'create_section', update: 'rename_section', delete: 'delete_section' },
  subsections: { create: 'create_section', update: 'rename_subsection', delete: 'delete_subsection' },
  'study.courses': { create: 'create_course', update: 'update_course', delete: 'delete_course' },
  'study.decks': { create: 'create_flashcard_deck', update: 'update_flashcard_deck', delete: 'delete_flashcard_deck' },
  'study.quizzes': { create: 'create_quiz', update: 'update_quiz', delete: 'delete_quiz' },
  memory: { create: 'remember_memory', update: 'update_memory', delete: 'forget_memory' },
  // Left to the app, on purpose:
  'study.documents': { exempt: 'Uploaded files: the user uploads them; their text is stored apart from records and removed by the app.' },
  'study.folders': { exempt: 'Folders that organize uploaded course files, which only exist through uploads.' },
  conversations: { exempt: 'The chat history itself.' },
  chatHistory: { exempt: 'The current chat.' },
  conversationId: { exempt: 'Which chat is open.' },
  selectedModel: { exempt: 'AI settings, changed in Settings.' },
  theme: { exempt: 'Display setting.' },
  taskAppearance: { exempt: 'Display setting.' },
  dailyBrief: { exempt: 'Generated summary, not user data.' },
  auditLog: { exempt: 'History of changes; must not be rewritten by the assistant.' },
  preferences: { exempt: 'App settings, including the approval setting the assistant must not change.' },
};

const toolNames = new Set(BRAIN_TOOLS.map(t => t.function.name));
const schema = name => BRAIN_TOOLS.find(t => t.function.name === name).function.parameters.properties;

test('every collection and preference the app stores is covered or deliberately left to the app', () => {
  const stored = [...RECORD_COLLECTIONS, ...PREFERENCE_KEYS];
  const missing = stored.filter(key => !COVERAGE[key]);
  assert.deepEqual(missing, [], `Give the assistant tools for these (or add an exemption with a reason): ${missing.join(', ')}`);
  for (const [key, entry] of Object.entries(COVERAGE)) {
    assert.ok(stored.includes(key), `${key} is listed but no longer stored; remove it from COVERAGE`);
    if (entry.exempt) { assert.ok(entry.exempt.length > 10, `${key} needs a real reason`); continue; }
    for (const op of ['create', 'update', 'delete']) assert.ok(toolNames.has(entry[op]), `${key}: ${op} tool ${entry[op]} does not exist`);
  }
});

test('every change tool is implemented and classified, so it runs in chat and after approval', () => {
  for (const tool of MUTATION_TOOLS.map(t => t.function.name)) {
    assert.ok(INTERNAL_TOOLS.has(tool), `${tool} is not in actionPolicy INTERNAL; it would be treated as an outside action`);
    let message = '';
    try { prepareMutation(tool, {}, emptyState()); } catch (error) { message = error.message; }
    assert.doesNotMatch(message, /Unknown mutation/, `${tool} has no case in prepareMutation`);
  }
  for (const tool of INTERNAL_TOOLS) assert.ok(toolNames.has(tool), `actionPolicy lists ${tool}, which is not a tool`);
});

test('every tracker field in the app form can be set and changed by the assistant', async () => {
  const form = await readFile(new URL('../src/components/WorkspacesView.tsx', import.meta.url), 'utf8');
  const used = new Set([...form.matchAll(/(?:setField|value)\(\s*(?:problem\s*\?\s*)?"(\w+)"(?:\s*:\s*"(\w+)")?/g)].flatMap(m => [m[1], m[2]]).filter(Boolean));
  assert.ok(used.size >= 8, `expected to find the form's fields, found ${[...used]}`);
  const unknown = [...used].filter(k => !TRACKER_FIELD_KEYS.includes(k));
  assert.deepEqual(unknown, [], `Add these form fields to TRACKER_FIELDS in src/utils/trackerFields.ts: ${unknown.join(', ')}`);
  for (const f of TRACKER_FIELDS) {
    assert.ok(schema('create_tracker_item')[f.key], `create_tracker_item can't set ${f.key}`);
    assert.ok(schema('update_tracker_item')[f.key], `update_tracker_item can't change ${f.key}`);
  }
  for (const key of ['newTitle', 'newCompany', 'newUrl', 'status', 'appendNotes', 'replaceNotes', 'clearFields'])
    assert.ok(schema('update_tracker_item')[key], `update_tracker_item can't change ${key}`);
});

// ---- Behavior of the tools ----

function emptyState() {
  return { userId: 'u', tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], trackerItems: [], events: [], workspaces: [], noteFolders: [],
    sections: ['Academic', 'Career'], subsections: { Academic: ['General', 'CS 1332'], Career: ['General'] }, chatHistory: [], openRouterKey: '', selectedModel: '', theme: 'light',
    study: { courses: [], folders: [], documents: [], decks: [], quizzes: [] } };
}
const career = { id: 'workspace-career', name: 'Career', description: '', template: 'career', color: 'purple', notes: '', createdAt: '2026-01-01' };
/** Runs a tool the way the assistant does and returns the new state. */
function run(state, tool, args) {
  const m = prepareMutation(tool, args, state);
  if (m.expected) assert.deepEqual(mutationRecords(state, m.type).find(r => r.id === m.record.id), m.expected, `${tool}: expected matches the stored record`);
  assert.ok(describeMutation(tool, m).summary, `${tool} has an approval summary`);
  return { state: applyMutation(state, m), m };
}

test('LeetCode: add a problem with every detail, log practice, edit it, delete it', () => {
  let s = { ...emptyState(), workspaces: [career] };
  let r = run(s, 'create_tracker_item', { kind: 'leetcode', title: 'Two Sum', number: 1, difficulty: 'Easy', topic: 'Arrays, Hash maps', url: 'https://leetcode.com/problems/two-sum/' });
  s = r.state; const id = r.m.record.id;
  assert.deepEqual(s.trackerItems[0].fields, { number: 1, difficulty: 'Easy', topic: 'Arrays, Hash maps' });
  s = run(s, 'log_practice', { trackerId: id, date: '2026-11-08' }).state;
  const solved = s.trackerItems[0];
  assert.equal(solved.status, 'done'); assert.equal(solved.history['2026-11-08'], 1);
  assert.equal(solved.fields.lastPractice, '2026-11-08'); assert.equal(solved.fields.nextReview, '2026-11-15');
  s = run(s, 'update_tracker_item', { trackerId: id, difficulty: 'Medium', newUrl: 'https://leetcode.com/problems/two-sum/description/', clearFields: ['topic'], appendNotes: 'Use a hash map.' }).state;
  assert.equal(s.trackerItems[0].fields.difficulty, 'Medium'); assert.equal(s.trackerItems[0].fields.topic, undefined); assert.match(s.trackerItems[0].notes, /hash map/);
  assert.throws(() => prepareMutation('update_tracker_item', { trackerId: id, jobType: 'Internship' }, s), /doesn't apply/);
  const del = prepareMutation('delete_tracker_item', { trackerId: id }, s);
  assert.match(approvalReason('delete_tracker_item', { untrustedRead: false, changes: 0, askBeforeChanges: false }), /approval/);
  assert.equal(applyMutation(s, del).trackerItems.length, 0);
});

test('Job applications: every field, company and link can change', () => {
  let s = { ...emptyState(), workspaces: [career] };
  let r = run(s, 'create_tracker_item', { kind: 'job_application', title: 'SWE Intern', company: 'Stripe', appliedDate: '2026-11-08', jobType: 'Internship', contact: 'jane@stripe.com', location: 'Remote' });
  s = r.state;
  assert.equal(s.trackerItems[0].status, 'applied');
  assert.deepEqual(s.trackerItems[0].fields, { location: 'Remote', jobType: 'Internship', appliedDate: '2026-11-08', contact: 'jane@stripe.com' });
  s = run(s, 'update_tracker_item', { trackerId: r.m.record.id, status: 'onsite', newCompany: 'Stripe Inc', followUpDate: '2026-11-20', jobType: 'Full-time' }).state;
  assert.equal(s.trackerItems[0].subject, 'Stripe Inc'); assert.equal(s.trackerItems[0].fields.jobType, 'Full-time');
  assert.throws(() => prepareMutation('update_tracker_item', { trackerId: r.m.record.id, jobType: 'Gig' }, s), /must be one of/);
  assert.throws(() => prepareMutation('log_practice', { trackerId: r.m.record.id }, s), /Only practice problems/);
});

test('Workspaces: create, add entries to the new one, update notes, delete with its entries', () => {
  let r = run({ ...emptyState(), workspaces: [career] }, 'create_workspace', { name: 'Summer Recruiting', template: 'career' });
  let s = r.state; const ws = r.m.record.id;
  s = run(s, 'create_tracker_item', { kind: 'job_application', title: 'PM Intern', company: 'Figma', workspaceId: ws }).state;
  assert.equal(s.trackerItems[0].workspaceId, ws);
  s = run(s, 'update_workspace', { workspaceId: ws, appendNotes: 'Target 30 applications.', color: 'green' }).state;
  assert.equal(s.workspaces[1].notes, 'Target 30 applications.');
  assert.throws(() => prepareMutation('create_tracker_item', { kind: 'leetcode', title: 'x', workspaceId: run(s, 'create_workspace', { name: 'Ideas', template: 'blank' }).m.record.id }, run(s, 'create_workspace', { name: 'Ideas', template: 'blank' }).state));
  s = run(s, 'delete_workspace', { workspaceId: ws }).state;
  assert.equal(s.workspaces.length, 1); assert.equal(s.trackerItems.length, 0);
});

test('Sections and subsections: create, rename and delete move their tasks', () => {
  let s = emptyState();
  s = run(s, 'create_task', { title: 'Problem set', section: 'Academic', subsection: 'CS 1332', priority: 'medium' }).state;
  s = run(s, 'create_section', { section: 'Projects', subsection: 'Web' }).state;
  assert.deepEqual(s.subsections.Projects, ['Web']);
  s = run(s, 'rename_subsection', { section: 'academic', subsection: 'cs 1332', newName: 'Data Structures' }).state;
  assert.equal(s.tasks[0].subsection, 'Data Structures');
  s = run(s, 'rename_section', { section: 'Academic', newName: 'School' }).state;
  assert.equal(s.tasks[0].section, 'School'); assert.deepEqual(s.subsections.School, ['General', 'Data Structures']); assert.equal(s.subsections.Academic, undefined);
  s = run(s, 'delete_subsection', { section: 'School', subsection: 'Data Structures' }).state;
  assert.equal(s.tasks[0].subsection, 'General');
  s = run(s, 'delete_section', { section: 'School' }).state;
  assert.equal(s.tasks[0].section, 'Career'); assert.ok(!s.sections.includes('School'));
  assert.throws(() => prepareMutation('delete_section', { section: 'Projects' }, { ...s, sections: ['Projects'] }), /last section/);
});

test('Goals, habits, journal entries and notes can be edited and deleted', () => {
  let s = emptyState();
  let r = run(s, 'create_goal', { title: 'Get an internship', sector: 'career', timeframe: 'quarterly' }); s = run(r.state, 'delete_goal', { goalId: r.m.record.id }).state;
  assert.equal(s.goals.length, 0);
  r = run(s, 'create_habit', { name: 'Run', frequency: 'daily' }); s = r.state;
  s = run(s, 'complete_habit', { habitId: r.m.record.id }).state;
  const today = Object.keys(s.habits[0].history)[0];
  s = run(s, 'update_habit', { habitId: r.m.record.id, newName: 'Morning run', unmarkDate: today }).state;
  assert.equal(s.habits[0].name, 'Morning run'); assert.equal(s.habits[0].history[today], undefined);
  s = run(s, 'delete_habit', { habitId: r.m.record.id }).state; assert.equal(s.habits.length, 0);
  r = run(s, 'log_journal', { title: 'Day', content: 'Good day', mood: 'great' }); s = r.state;
  s = run(s, 'update_journal_entry', { entryId: r.m.record.id, appendContent: 'Shipped it.', addWins: ['Shipped'] }).state;
  assert.match(s.journalEntries[0].content, /Good day\n\nShipped it\./); assert.deepEqual(s.journalEntries[0].wins, ['Shipped']);
  s = run(s, 'delete_journal_entry', { entryId: r.m.record.id }).state; assert.equal(s.journalEntries.length, 0);
});

test('Note folders: create, nest, rename; deleting one keeps its notes', () => {
  let s = emptyState();
  let r = run(s, 'create_note_folder', { name: 'School' }); s = r.state; const parent = r.m.record.id;
  r = run(s, 'create_note_folder', { name: 'CS', parentId: parent }); s = r.state; const child = r.m.record.id;
  s = run(s, 'create_note', { title: 'Heaps', content: 'Min-heap notes', folderId: child }).state;
  assert.throws(() => prepareMutation('update_note_folder', { folderId: parent, parentId: child }, s), /inside itself/);
  s = run(s, 'update_note_folder', { folderId: child, newName: 'Computer Science' }).state;
  s = run(s, 'delete_note_folder', { folderId: child }).state;
  assert.equal(s.knowledgeItems[0].folderId, parent); assert.equal(s.noteFolders.length, 1);
  s = run(s, 'delete_note', { noteId: s.knowledgeItems[0].id }).state; assert.equal(s.knowledgeItems.length, 0);
});

test('Courses, decks and quizzes can be edited and deleted', () => {
  let s = emptyState();
  let r = run(s, 'create_course', { name: 'Data Structures', code: 'CS 1332' }); s = r.state; const course = r.m.record.id;
  s = run(s, 'create_task', { title: 'HW 1', section: 'Academic', subsection: 'CS 1332', priority: 'high' }).state;
  s = run(s, 'update_course', { courseId: course, newCode: 'CS 1331', instructor: 'Dr. Smith' }).state;
  assert.equal(s.tasks[0].subsection, 'CS 1331'); assert.ok(s.subsections.Academic.includes('CS 1331')); assert.ok(!s.subsections.Academic.includes('CS 1332'));
  r = run(s, 'create_flashcard_deck', { courseId: course, title: 'Trees', cards: [{ front: 'BST?', back: 'Ordered tree' }, { front: 'AVL?', back: 'Balanced' }, { front: 'x', back: 'y' }] }); s = r.state;
  s = run(s, 'update_flashcard_deck', { deckId: r.m.record.id, newTitle: 'Trees & Heaps', editCards: [{ number: 2, back: 'Self-balancing BST' }], removeCards: [3] }).state;
  assert.deepEqual(s.study.decks[0].cards.map(c => c.back), ['Ordered tree', 'Self-balancing BST']); assert.equal(s.study.decks[0].title, 'Trees & Heaps');
  r = run(s, 'create_quiz', { courseId: course, title: 'Quiz 1', questions: [{ type: 'short', prompt: 'Define BST', answer: 'Ordered binary tree' }] }); s = r.state;
  s = run(s, 'update_quiz', { quizId: r.m.record.id, addQuestions: [{ type: 'mcq', prompt: 'Heap root?', choices: ['min', 'max', 'mid', 'none'], answerIndex: 0 }], removeQuestions: [1] }).state;
  assert.deepEqual(s.study.quizzes[0].questions.map(q => q.prompt), ['Heap root?']);
  s = run(s, 'delete_quiz', { quizId: r.m.record.id }).state; assert.equal(s.study.quizzes.length, 0);
  s = run(s, 'delete_course', { courseId: course }).state;
  assert.equal(s.study.courses.length, 0); assert.equal(s.study.decks.length, 0); assert.equal(s.tasks.length, 1, 'tasks stay');
  const withDoc = { ...s, study: { ...s.study, courses: [{ id: 'c2', workspaceId: 'w', code: 'X', name: 'X', createdAt: '', updatedAt: '' }], documents: [{ id: 'd', courseId: 'c2' }] } };
  assert.throws(() => prepareMutation('delete_course', { courseId: 'c2' }, withDoc), /uploaded document/);
});

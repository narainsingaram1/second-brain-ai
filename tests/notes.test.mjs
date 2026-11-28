import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { MarkdownManager } from '@tiptap/markdown';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { owner, other } from './helpers/supabaseDb.mjs';
const server = await createServer({ cacheDir: '/private/tmp/synapse-notes-tests', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const { noteExtensions } = await server.ssrLoadModule('/src/components/noteExtensions.ts');
const manager = new MarkdownManager({ extensions: noteExtensions() });
const allNodes = node => [node, ...(node.content || []).flatMap(allNodes)];

test('rich notes round-trip formatting, links, nested lists, checkboxes, code, tables and images', () => {
  const markdown = '# Heading\n\n**bold** *italic* ~~strike~~ ==highlight== `inline` [link](https://example.com)\n\n- first\n  - nested\n\n1. ordered\n2. second\n\n- [ ] unchecked\n- [x] checked\n\n> quote\n\n```js\nconst value = 1;\n```\n\n---\n\n| A | B |\n| --- | --- |\n| one | two |\n\n![picture](https://example.com/image.png)';
  const parsed = manager.parse(markdown);
  const nodes = allNodes(parsed);
  for (const type of ['heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'image']) assert.ok(nodes.some(n => n.type === type), type);
  for (const mark of ['bold', 'italic', 'strike', 'highlight', 'code', 'link']) assert.ok(nodes.some(n => n.marks?.some(m => m.type === mark)), mark);
  assert.ok(nodes.some(n => n.type === 'taskItem' && n.attrs.checked));
  assert.deepEqual(manager.parse(manager.serialize(parsed)), parsed);
});

test('nested formatting inside highlighting survives reload and Markdown export', () => {
  const parsed = manager.parse('==a **bold** idea== and **==another==**');
  assert.deepEqual(manager.parse(manager.serialize(parsed)), parsed);
  assert.match(manager.serialize(parsed), /==/);
});

test('opening and reading blank or literal text does not require a content mutation', () => {
  assert.equal(manager.serialize(manager.parse('')), '');
  const literal = 'Keep <script>alert(1)</script> as text, and [knowledge:abc] references.';
  const result = manager.serialize(manager.parse(literal));
  assert.match(result, /alert\(1\)/);
  assert.match(result, /knowledge:abc/);
});

test('pasted image width survives Markdown and image data stays out of AI text', async () => {
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const markdown = `Before\n\n![diagram|320](${src})\n\n![](https://example.com/b.png)`;
  const parsed = manager.parse(markdown);
  const images = allNodes(parsed).filter(n => n.type === 'image');
  assert.equal(images[0].attrs.width, 320);
  assert.equal(images[0].attrs.alt, 'diagram');
  assert.equal(images[1].attrs.width, null);
  assert.deepEqual(manager.parse(manager.serialize(parsed)), parsed);
  assert.match(manager.serialize(parsed), /!\[diagram\|320\]\(data:image\/png/);

  const { hideNoteImages, restoreNoteImages, stripNoteImages } = await server.ssrLoadModule('/src/utils/noteImages.ts');
  const hidden = hideNoteImages(markdown);
  assert.doesNotMatch(hidden, /base64/);
  assert.match(hidden, /note-image:1/);
  assert.equal(restoreNoteImages(hidden, markdown), markdown);
  assert.equal(restoreNoteImages(`Rewritten\n\n${hidden.split('\n\n')[1]}`, markdown), `Rewritten\n\n![diagram|320](${src})`);
  assert.doesNotMatch(stripNoteImages(markdown), /data:|example\.com/);
});

test('notes keep short image references that round-trip and are found for export', async () => {
  const ref = 'synapse-img:0123456789abcdef0123456789abcdef.webp';
  const parsed = manager.parse(`Text\n\n![chart|300](${ref})`);
  const image = allNodes(parsed).find(n => n.type === 'image');
  assert.equal(image.attrs.src, ref);
  assert.equal(image.attrs.width, 300);
  assert.match(manager.serialize(parsed), /!\[chart\|300\]\(synapse-img:0123456789abcdef0123456789abcdef\.webp\)/);
  const { imageRefsIn, isImageRef } = await server.ssrLoadModule('/src/services/noteImageStore.ts');
  assert.deepEqual(imageRefsIn(`![](${ref}) and again ![](${ref}) ![](https://x.test/a.png)`), ['0123456789abcdef0123456789abcdef.webp']);
  assert.ok(isImageRef(ref));
  assert.ok(!isImageRef('data:image/png;base64,AAAA'));
});

test('note image bucket is private and only the owner can add or read images', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
     create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
     create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
     create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
     alter table storage.objects enable row level security;
     grant usage on schema auth,storage to authenticated,anon;
     grant select,insert on storage.objects to authenticated;`);
    const migration = await readFile(new URL('../supabase/migrations/202611190001_note_images.sql', import.meta.url), 'utf8');
    await db.exec(migration); await db.exec(migration);
    const bucket = (await db.query("select * from storage.buckets where id='note-images'")).rows[0];
    assert.equal(bucket.public, false);
    assert.deepEqual(bucket.allowed_mime_types, ['image/webp', 'image/png', 'image/jpeg', 'image/gif']);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); await db.exec('set role authenticated');
    await db.query("insert into storage.objects values('note-images',$1)", [`${owner}/abc.webp`]);
    await assert.rejects(db.query("insert into storage.objects values('note-images',$1)", [`${other}/abc.webp`]), e => e.code === '42501');
    await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]); await db.exec('set role authenticated');
    assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
  } finally { await db.close(); }
});

test('older notes with inline images are moved to the image store one at a time, and stop when cancelled', async () => {
  const { migrateInlineNoteImages } = await server.ssrLoadModule('/src/services/noteImageStore.ts');
  const inline = 'data:image/png;base64,AAAA';
  const notes = [
    { id: 'plain', content: 'No images here' },
    { id: 'old-1', content: `Before ![chart](${inline}) after` },
    { id: 'empty' },
    { id: 'old-2', content: `![a](${inline})` },
  ];
  const applied = [], seen = [];
  let idles = 0;
  const run = {
    externalize: async content => { seen.push(content); return content.split(inline).join('synapse-img:0123456789abcdef0123456789abcdef.png'); },
    apply: (id, from, to) => applied.push({ id, from, to }),
    idle: async () => { idles++; },
    cancelled: () => false,
  };
  assert.equal(await migrateInlineNoteImages(notes, run), 2);
  assert.equal(idles, 2, 'one idle wait per note that needs work; notes without images cost nothing');
  assert.deepEqual(applied.map(a => a.id), ['old-1', 'old-2']);
  assert.equal(applied[0].from, notes[1].content, 'the original text is passed so a note edited meanwhile is left alone');
  assert.match(applied[0].to, /^Before !\[chart\]\(synapse-img:[a-f0-9]{32}\.png\) after$/);

  // An image that could not be stored stays inline, and the note is not rewritten.
  applied.length = 0;
  assert.equal(await migrateInlineNoteImages(notes, { ...run, externalize: async content => content }), 0);
  assert.deepEqual(applied, []);

  // Closing or switching accounts stops the pass before the next note.
  let stop = false;
  assert.equal(await migrateInlineNoteImages(notes, { ...run, apply: (...args) => { run.apply(...args); stop = true; }, cancelled: () => stop }), 1);
});

test('wiki-links and @record mentions round-trip cleanly in Tiptap Markdown without touching literal [knowledge:id] refs', () => {
  const md = 'Review [[Dynamic Programming]] before @[Submit HW 3](synapse://task/t-3) and keep [knowledge:abc] literal.';
  const parsed = manager.parse(md);
  const nodes = allNodes(parsed).filter(n => n.type === 'recordLink');
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].attrs.syntax, 'wiki');
  assert.equal(nodes[0].attrs.label, 'Dynamic Programming');
  assert.equal(nodes[1].attrs.syntax, 'mention');
  assert.equal(nodes[1].attrs.targetType, 'task');
  assert.equal(nodes[1].attrs.targetId, 't-3');
  assert.equal(nodes[1].attrs.label, 'Submit HW 3');
  const serialized = manager.serialize(parsed);
  assert.match(serialized, /\[\[Dynamic Programming\]\]/);
  assert.match(serialized, /@\[Submit HW 3\]\(synapse:\/\/task\/t-3\)/);
  assert.match(serialized, /knowledge:abc/);
  assert.deepEqual(manager.parse(serialized), parsed);
});

test('backlinks, unlinked mentions, trigger detection, related context and knowledge graph connect records', async () => {
  const {
    extractLinksFromText,
    detectMentionTrigger,
    searchLinkCandidates,
    findBacklinksAndMentions,
    linkMentionRange,
  } = await server.ssrLoadModule('/src/utils/noteLinks.ts');
  const { computeInstantRelatedContext } = await server.ssrLoadModule('/src/utils/relatedContext.ts');
  const { buildKnowledgeGraph } = await server.ssrLoadModule('/src/utils/knowledgeGraph.ts');

  const state = {
    tasks: [
      { id: 't-1', title: 'Implement Dijkstra', description: 'See Graph Algorithms note for edge weights', dueDate: '2026-11-30', priority: 'high', section: 'Academic', subsection: 'CS 1332', status: 'not_started', completed: false, tags: ['algorithms'] },
    ],
    habits: [],
    journalEntries: [
      { id: 'j-1', date: '2026-11-25', title: 'Exam prep', content: 'Reviewed [[Graph Algorithms]] and @[Implement Dijkstra](synapse://task/t-1).', mood: 'great', wins: [], challenges: [], tags: ['Reflection', 'algorithms'] },
    ],
    knowledgeItems: [
      { id: 'n-1', title: 'Graph Algorithms', subject: 'Graph Algorithms', content: 'Shortest paths with BFS and Dijkstra.\n\n```js\nconst x = [[1]];\n```', summary: '', tags: ['algorithms', 'cs1332'], status: 'Synthesized', startDate: '2026-11-20', endDate: '2026-11-20' },
      { id: 'n-2', title: 'Shortest Path Proof', subject: 'Shortest Path Proof', content: 'Builds on [[Graph Algorithms]] and mentions Dynamic Programming directly in prose.', summary: '', tags: ['algorithms'], status: 'Synthesized', startDate: '2026-11-22', endDate: '2026-11-22' },
      { id: 'n-3', title: 'Dynamic Programming', subject: 'Dynamic Programming', content: 'Memoization and tabulation patterns for CS 1332.', summary: '', tags: ['cs1332'], status: 'Synthesized', startDate: '2026-11-23', endDate: '2026-11-23' },
    ],
    trackerItems: [
      { id: 'tr-1', kind: 'job_application', title: 'SWE Intern', subject: 'Stripe', status: 'screening', fields: {}, history: {}, streak: 0, bestStreak: 0, notes: 'Prep Graph Algorithms', createdAt: '2026-11-01', updatedAt: '2026-11-20' },
    ],
    events: [],
    study: {
      courses: [{ id: 'c-1', workspaceId: 'ws-1', code: 'CS 1332', name: 'Data Structures & Algorithms', createdAt: '2026-09-01', updatedAt: '2026-09-01' }],
      folders: [],
      documents: [],
      decks: [],
      quizzes: [],
    },
    sections: ['Academic'],
    subsections: { Academic: ['General', 'CS 1332'] },
    workspaces: [{ id: 'ws-1', name: 'School', description: '', template: 'academic', color: 'purple', notes: '', createdAt: '2026-09-01' }],
    noteFolders: [],
    chatHistory: [],
    openRouterKey: '',
    selectedModel: '',
    theme: 'light',
  };

  assert.deepEqual(detectMentionTrigger('Working on [[Dyn'), { trigger: '[[', query: 'Dyn', offsetFromEnd: 5 });
  assert.deepEqual(detectMentionTrigger('Ping @Dijk'), { trigger: '@', query: 'Dijk', offsetFromEnd: 5 });
  assert.equal(detectMentionTrigger('email@example.com'), null);

  const candidates = searchLinkCandidates(state, 'Dijk', '@');
  assert.ok(candidates.some(c => c.type === 'task' && c.id === 't-1'));

  const links = extractLinksFromText(state.journalEntries[0].content, state);
  assert.equal(links.length, 2);
  assert.equal(links[0].id, 'n-1');
  assert.equal(links[1].id, 't-1');

  const n1Backlinks = findBacklinksAndMentions({ type: 'knowledge', id: 'n-1', title: 'Graph Algorithms' }, state);
  assert.equal(n1Backlinks.backlinks.length, 2); // n-2 and j-1
  assert.equal(n1Backlinks.unlinkedMentions.length, 2); // t-1 description and tr-1 notes

  const dpBacklinks = findBacklinksAndMentions({ type: 'knowledge', id: 'n-3', title: 'Dynamic Programming' }, state);
  assert.equal(dpBacklinks.unlinkedMentions.length, 1);
  const linked = linkMentionRange(state.knowledgeItems[1].content, dpBacklinks.unlinkedMentions[0].start, dpBacklinks.unlinkedMentions[0].end, { type: 'knowledge', id: 'n-3', label: 'Dynamic Programming' });
  assert.match(linked, /\[\[Dynamic Programming\]\]/);

  const related = computeInstantRelatedContext(state, { type: 'knowledge', id: 'n-1', title: 'Graph Algorithms', content: state.knowledgeItems[0].content, tags: state.knowledgeItems[0].tags });
  assert.ok(related.items.length >= 2);
  assert.ok(related.items.some(item => item.id === 'n-2'));

  const graph = buildKnowledgeGraph(state);
  assert.ok(graph.nodes.some(n => n.id === 'knowledge:n-1'));
  assert.ok(graph.nodes.some(n => n.id === 'tag:algorithms'));
  assert.ok(graph.edges.some(e => e.kind === 'explicit' && e.source === 'knowledge:n-2' && e.target === 'knowledge:n-1'));
  assert.ok(graph.edges.some(e => e.kind === 'structure' && e.source === 'course:c-1' && e.target === 'task:t-1'));
});

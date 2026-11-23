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

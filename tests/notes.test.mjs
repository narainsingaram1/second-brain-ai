import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { MarkdownManager } from '@tiptap/markdown';
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

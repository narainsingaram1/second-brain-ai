import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, cacheDir: '/private/tmp/synapse-note-folders-test-cache', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
const f = await server.ssrLoadModule('/src/utils/noteFolders.ts');
test.after(() => server.close());

const base = () => ({ tasks: [], goals: [], habits: [], journalEntries: [], trackerItems: [], sections: [], subsections: {}, chatHistory: [],
  knowledgeItems: [{ id: 'n1', title: 'A', subject: 'A', summary: '', folderId: 'b', status: 'Draft', startDate: '', endDate: '' }],
  noteFolders: [{ id: 'a', name: 'A', parentId: null, createdAt: '' }, { id: 'b', name: 'B', parentId: 'a', createdAt: '' }, { id: 'c', name: 'C', parentId: 'b', createdAt: '' }],
  workspaces: [] });

test('folders move anywhere except inside themselves', () => {
  const s = base();
  assert.match(f.folderMoveBlocked(s.noteFolders, 'a', 'c'), /inside itself/);
  assert.equal(f.folderMoveBlocked(s.noteFolders, 'c', null), null);
  const moved = f.moveFolder(s, 'c', null);
  assert.equal(moved.noteFolders.find(x => x.id === 'c').parentId, null);
  assert.equal(f.moveFolder(s, 'a', 'b'), s, 'a blocked move changes nothing');
  assert.deepEqual(f.folderPath(s.noteFolders, 'c').map(x => x.id), ['a', 'b', 'c']);
  assert.deepEqual([...f.subtreeIds(s.noteFolders, 'b')].sort(), ['b', 'c']);
});

test('notes move in and out of folders; deleting a folder keeps its contents', () => {
  let s = f.moveNotes(base(), ['n1'], null);
  assert.equal(s.knowledgeItems[0].folderId, null);
  s = f.removeFolder(base(), 'b');
  assert.equal(s.knowledgeItems[0].folderId, 'a');
  assert.equal(s.noteFolders.find(x => x.id === 'c').parentId, 'a');
});

test('each workspace gets a folder that follows it, and old workspace notes move into a note once', () => {
  const s = { ...base(), workspaces: [{ id: 'w', name: 'Career', description: '', template: 'career', color: 'green', notes: 'Prep list', createdAt: '' }] };
  const synced = f.syncWorkspaceFolders(s);
  const folder = synced.noteFolders.find(x => x.workspaceId === 'w');
  assert.equal(folder.name, 'Career'); assert.equal(folder.color, 'emerald'); assert.equal(folder.parentId, null);
  const note = synced.knowledgeItems.find(n => n.id === f.workspaceNoteId('w'));
  assert.equal(note.content, 'Prep list'); assert.equal(note.folderId, folder.id);
  assert.equal(synced.workspaces[0].notes, '');
  assert.equal(f.syncWorkspaceFolders(synced), synced, 'already in sync returns the same state');
  const renamed = f.syncWorkspaceFolders({ ...synced, workspaces: [{ ...synced.workspaces[0], name: 'Jobs' }] });
  assert.equal(renamed.noteFolders.find(x => x.id === folder.id).name, 'Jobs');
  assert.match(f.folderMoveBlocked(synced.noteFolders, folder.id, 'a'), /top level/);
  const orphaned = f.syncWorkspaceFolders({ ...synced, workspaces: [] });
  assert.equal(orphaned.noteFolders.find(x => x.id === folder.id).workspaceId, undefined);
});

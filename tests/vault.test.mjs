// Saved logins (src-tauri/src/vault): what the assistant can see of them, and the rules the Rust side must keep.
// The Keychain and Touch ID parts are covered by the Rust unit tests (cargo test vault).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ cacheDir: '/tmp/synapse-vault-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const { vaultToolset, needsVault, VAULT_TOOLS } = await load('/src/services/vaultAgent.ts');
const { parseCsv } = await load('/src/vault/csv.ts');
const { toolTier, approvalReason } = await load('/src/services/actionPolicy.ts');
const { describeCall } = await load('/src/services/agentActivity.ts');

const rust = async rel => readFile(new URL(`../src-tauri/src/${rel}`, import.meta.url), 'utf8');
async function rustFiles(dir = '') {
  const out = [];
  for (const entry of await readdir(new URL(`../src-tauri/src/${dir}`, import.meta.url), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await rustFiles(rel));
    else if (rel.endsWith('.rs')) out.push(rel);
  }
  return out;
}

test('the assistant sees sites, nicknames and partly hidden usernames, never more', async () => {
  const tools = vaultToolset(async cmd => {
    assert.equal(cmd, 'vault_list');
    return [{ nickname: 'cred_1', site: 'https://github.com', username: 'n•••@gmail.com', status: 'saved', created: 1, lastUsed: 5 },
      { nickname: 'cred_2', site: 'https://example.com', username: 'a•••', status: 'pending', created: 2 }];
  });
  const { output, summary } = await tools.execute('vault_list', {}, new AbortController().signal);
  assert.deepEqual(output.logins, [{ nickname: 'cred_1', site: 'https://github.com', username: 'n•••@gmail.com' }, { nickname: 'cred_2', site: 'https://example.com', username: 'a•••', pending: true }]);
  assert.equal(summary, '2 saved logins');
  assert.deepEqual(VAULT_TOOLS.map(t => t.function.name), ['vault_list'], 'no tool takes or returns a password');
  assert.equal(toolTier('vault_list'), 'read');
  assert.equal(approvalReason('vault_list', { untrustedRead: true, changes: 0, askBeforeChanges: true }), null);
  assert.equal(describeCall('vault_list', {}).label, 'Checking your saved logins');
  assert.ok(needsVault('sign in to github for me')); assert.ok(needsVault('do I have a login saved for canvas?'));
  assert.ok(!needsVault('what is on my calendar today?'));
});

test('Chrome password exports parse, quotes and commas included', () => {
  const rows = parseCsv('name,url,username,password,note\r\ngithub.com,https://github.com/login,n@x.io,"pa,ss""word",\n\nshop,https://shop.example/,me,p2,"two\nlines"\n');
  assert.deepEqual(rows, [['name', 'url', 'username', 'password', 'note'], ['github.com', 'https://github.com/login', 'n@x.io', 'pa,ss"word', ''], ['shop', 'https://shop.example/', 'me', 'p2', 'two\nlines']]);
});

test('Rust: no command hands out a password, and only the vault reads the Keychain', async () => {
  const files = await rustFiles();
  let commands = 0;
  for (const file of files) {
    const src = await rust(file);
    for (const m of src.matchAll(/#\[tauri::command\]\s*pub (?:async )?fn (\w+)\(([^)]*)\)\s*->\s*([^{]+)\{/g)) {
      commands++;
      assert.doesNotMatch(m[3], /Zeroizing|Entry\b|password/i, `${file}: command ${m[1]} must not return a password (${m[3].trim()})`);
    }
    if (!file.startsWith('vault/')) {
      assert.doesNotMatch(src, /security_framework|SecItem/, `${file}: only src-tauri/src/vault may touch the Keychain`);
      assert.doesNotMatch(src, /\.read_password\(/, `${file}: read_password belongs to the sign-in flow in Rust, added in Phase 2`);
    }
  }
  assert.ok(commands >= 20, `expected to find the app's commands, found ${commands}`);
  const vault = await rust('vault/mod.rs');
  for (const cmd of ['vault_add', 'vault_remove', 'vault_verify']) {
    const body = vault.slice(vault.indexOf(`pub async fn ${cmd}(`)).split('#[tauri::command]')[0];
    assert.match(body, /vault_only\(&window\)\?/, `${cmd} must only run for the Saved logins window`);
  }
  assert.match(vault.slice(vault.indexOf('pub async fn vault_remove(')), /remove\(&nickname, &authenticate\)/, 'removing asks for Touch ID');
  assert.match(vault.slice(vault.indexOf('pub async fn vault_verify(')), /read_password\([^)]*&authenticate\)/, 'checking asks for Touch ID');
  const lib = await rust('lib.rs');
  for (const cmd of ['vault_open', 'vault_list', 'vault_add', 'vault_remove', 'vault_verify']) assert.ok(lib.includes(`vault::${cmd}`), `${cmd} is registered`);
  assert.doesNotMatch(lib, /vault::read_password|vault::authenticate/, 'never exposed as a command');
});

test('the Saved logins window has no plugins and a strict page policy', async () => {
  const cap = JSON.parse(await readFile(new URL('../src-tauri/capabilities/vault.json', import.meta.url), 'utf8'));
  assert.deepEqual(cap.windows, ['vault']); assert.deepEqual(cap.permissions, ['core:default']);
  const html = await readFile(new URL('../vault.html', import.meta.url), 'utf8');
  assert.match(html, /script-src 'self'/); assert.match(html, /form-action 'none'/);
  const page = await readFile(new URL('../src/vault/vault.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /innerHTML|localStorage|sessionStorage|fetch\(/, 'no markup from data, no storage, no network');
  assert.match(page, /password\.value = ""/, 'the password field is cleared after saving');
});

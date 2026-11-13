// The agent's execution layer on the app side: risk tiers, policy, the tool router's gates, and the audit log.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ cacheDir: '/tmp/synapse-router-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const tiers = await load('/src/services/riskTiers.ts');
const { normalizePolicy, mergePolicies, decide, DEFAULT_POLICY } = await load('/src/services/agentPolicy.ts');
const { createAgentRouter, describeSteps } = await load('/src/services/toolRouter.ts');
const { AgentAuditLog, memoryAuditStore } = await load('/src/services/agentAudit.ts');

test('page-agent.js uses exactly the shared tier vocabulary', async () => {
  const page = await readFile(new URL('../extension/page-agent.js', import.meta.url), 'utf8');
  for (const [name, source] of [['SECRET_AUTOCOMPLETE', tiers.SECRET_AUTOCOMPLETE_SOURCE], ['SECRET_LABEL', tiers.SECRET_LABEL_SOURCE], ['CONSEQUENTIAL', tiers.CONSEQUENTIAL_SOURCE]])
    assert.ok(page.includes(`const ${name} = /${source}/i;`), `${name} in page-agent.js differs from riskTiers.ts`);
});

test('committing button labels are hard, ordinary ones are not', () => {
  const hard = ['Place your order', 'Pay now', 'Send', 'Post', 'Delete', 'Merge pull request', 'Approve', 'Submit application', 'Transfer', 'Confirm purchase', 'Publish', 'Unsubscribe', 'Deploy'];
  const soft = ['Next', 'Search', 'Show more', 'Filters', 'Add filter', 'Sort by price', 'Size: M', 'Back', 'Details', 'Menu'];
  for (const label of hard) assert.match(label, tiers.CONSEQUENTIAL, label);
  for (const label of soft) assert.doesNotMatch(label, tiers.CONSEQUENTIAL, label);
  for (const label of ['Password', 'Card number', 'CVV', 'Routing number', 'SSN']) assert.match(label, tiers.SECRET_LABEL, label);
});

test('step and call tiers', () => {
  assert.equal(tiers.classifyBrowserStep({ action: 'scroll' }), 0);
  assert.equal(tiers.classifyBrowserStep({ action: 'type', text: 'hi' }), 1);
  assert.equal(tiers.classifyBrowserStep({ action: 'click' }, { consequential: true }), 2);
  assert.equal(tiers.classifyBrowserStep({ action: 'type', submit: true }, { submitsText: true }), 2);
  assert.equal(tiers.classifyBrowserStep({ action: 'type' }, { userOnly: 'password field', consequential: true }), 3);
  assert.equal(tiers.browserCallFloor('browser_look'), 0);
  assert.equal(tiers.browserCallFloor('browser_open'), 1);
  assert.equal(tiers.browserCallFloor('browser_act', { steps: [{ action: 'scroll' }, { action: 'hover', ref: 2 }] }), 0);
  assert.equal(tiers.browserCallFloor('browser_act', { steps: [{ action: 'scroll' }, { action: 'click', ref: 2 }] }), 1);
  assert.equal(tiers.browserCallFloor('browser_teleport'), 2);
});

test('policy: normalizing, merging the stricter side, deciding', () => {
  const user = normalizePolicy({ deniedHosts: ['https://www.Bank.com/login'], confirmHosts: ['github.com'], maxActsPerMinute: 100 });
  assert.deepEqual(user.deniedHosts, ['bank.com']);
  const merged = mergePolicies(user, { deniedHosts: ['casino.com'], maxActsPerMinute: 20, maxHardPerTurn: 99 });
  assert.deepEqual(merged.deniedHosts.sort(), ['bank.com', 'casino.com']);
  assert.equal(merged.maxActsPerMinute, 20);
  assert.equal(merged.maxHardPerTurn, DEFAULT_POLICY.maxHardPerTurn, 'a managed policy cannot loosen the user');
  assert.match(decide(merged, 'online.bank.com').deny, /turned off/);
  assert.equal(decide(merged, 'gist.github.com').floor, 2);
  assert.equal(decide(merged, 'amazon.com').floor, 0);
  // Allow-lists intersect; no overlap means nothing is allowed.
  const none = mergePolicies(normalizePolicy({ allowedHosts: ['amazon.com'] }), { allowedHosts: ['ebay.com'] });
  assert.ok(decide(none, 'amazon.com').deny && decide(none, 'ebay.com').deny);
  const sub = mergePolicies(normalizePolicy({ allowedHosts: ['smile.amazon.com'] }), { allowedHosts: ['amazon.com'] });
  assert.ok(!decide(sub, 'smile.amazon.com').deny);
});

function harness({ policy = {}, answers = [] } = {}) {
  const store = memoryAuditStore();
  const audit = new AgentAuditLog(store);
  const asked = [], toasts = [], calls = [];
  let t = 1_000_000;
  const router = createAgentRouter({
    policy: normalizePolicy(policy), audit, turnId: 'turn-1', now: () => t,
    confirm: async request => { asked.push(request); return answers.length ? answers.shift() : true; },
    notify: toast => toasts.push(toast),
  });
  const pages = { 'mail.example.com': 'Your verification code and the secret quarterly numbers are 4411-9921-0007 for project Falcon', 'shop.example.com': 'Results' };
  const inner = {
    definitions: [], instructions: '',
    async execute(name, args) {
      calls.push({ name, args });
      const tabId = args.tabId ?? (name === 'browser_open' ? Object.keys(pages).indexOf(new URL(args.url).hostname) + 1 : 0);
      const host = Object.keys(pages)[tabId - 1] || 'shop.example.com';
      return { output: { tabId, url: `https://${host}/`, site: host, text: pages[host], done: name === 'browser_act' ? args.steps.map(s => s.action) : undefined }, summary: `${name} done` };
    },
  };
  return { router, tools: router.wrap(inner), audit, store, asked, toasts, calls, tick: ms => { t += ms; } };
}
const signal = new AbortController().signal;

test('router: denied sites are refused before anything runs, and audited', async () => {
  const h = harness({ policy: { deniedHosts: ['shop.example.com'] } });
  await assert.rejects(h.tools.execute('browser_open', { url: 'https://shop.example.com/' }, signal), /turned off/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.store.entries[0].outcome, 'denied');
});

test('router: soft steps run with a toast; always-confirm sites ask first', async () => {
  const h = harness({ policy: { confirmHosts: ['mail.example.com'] } });
  await h.tools.execute('browser_open', { url: 'https://shop.example.com/' }, signal);
  await h.tools.execute('browser_act', { tabId: 2, steps: [{ action: 'type', ref: 3, text: 'usb hub' }] }, signal);
  assert.equal(h.asked.length, 0);
  assert.equal(h.toasts.length, 2);
  await h.tools.execute('browser_open', { url: 'https://mail.example.com/' }, signal);
  assert.equal(h.asked.length, 1, 'opening a confirm-site asks');
  await h.tools.execute('browser_act', { tabId: 1, steps: [{ action: 'click', ref: 1 }] }, signal);
  assert.equal(h.asked.length, 2, 'every change there asks');
  assert.match(h.asked[1].reason, /every change on mail\.example\.com/);
  await h.tools.execute('browser_look', { tabId: 1 }, signal);
  assert.equal(h.asked.length, 2, 'looking never asks');
  assert.equal(h.store.entries.at(-2).approval, 'user');
});

test('router: declining a gate runs nothing', async () => {
  const h = harness({ policy: { confirmHosts: ['shop.example.com'] }, answers: [false] });
  const out = await h.tools.execute('browser_open', { url: 'https://shop.example.com/' }, signal);
  assert.equal(out.output.confirmed, false);
  assert.equal(h.calls.length, 0);
  assert.ok(h.store.entries.some(e => e.outcome === 'declined'));
});

test('router: text read on one site and typed into another needs a go-ahead', async () => {
  const h = harness({ answers: [false] });
  await h.tools.execute('browser_open', { url: 'https://mail.example.com/' }, signal);
  await h.tools.execute('browser_open', { url: 'https://shop.example.com/' }, signal);
  const leak = 'the secret quarterly numbers are 4411-9921-0007';
  const out = await h.tools.execute('browser_act', { tabId: 2, steps: [{ action: 'type', ref: 4, text: leak }] }, signal);
  assert.equal(h.asked.length, 1);
  assert.match(h.asked[0].reason, /mail\.example\.com/);
  assert.equal(out.output.confirmed, false);
  assert.equal(h.calls.filter(c => c.name === 'browser_act').length, 0);
  // Short text (a search term) isn't treated as carried.
  await h.tools.execute('browser_act', { tabId: 2, steps: [{ action: 'type', ref: 4, text: 'Falcon' }] }, signal);
  assert.equal(h.asked.length, 1);
});

test('router: rate limit per site per minute', async () => {
  const h = harness({ policy: { maxActsPerMinute: 5 } });
  await h.tools.execute('browser_open', { url: 'https://shop.example.com/' }, signal);
  const steps = n => Array.from({ length: n }, (_, i) => ({ action: 'click', ref: i + 1 }));
  await h.tools.execute('browser_act', { tabId: 2, steps: steps(4) }, signal);
  await assert.rejects(h.tools.execute('browser_act', { tabId: 2, steps: steps(1) }, signal), /steps a minute/);
  await h.tools.execute('browser_act', { tabId: 2, steps: [{ action: 'scroll' }] }, signal); // Reading isn't limited.
  h.tick(61_000);
  await h.tools.execute('browser_act', { tabId: 2, steps: steps(3) }, signal);
});

test('router: caps live go-aheads per request', async () => {
  const h = harness({ policy: { maxHardPerTurn: 2 } });
  const req = { id: 'x', label: 'Click "Send"', site: 'mail.example.com', tabId: 1 };
  assert.equal(await h.router.confirm(req, signal), true);
  assert.equal(await h.router.confirm(req, signal), true);
  await assert.rejects(h.router.confirm(req, signal), /already asked for 2/);
  assert.equal(h.asked.length, 2);
});

test('audit: hash chain verifies, detects edits and removals, never stores typed text', async () => {
  const h = harness();
  await h.tools.execute('browser_open', { url: 'https://shop.example.com/' }, signal);
  await h.tools.execute('browser_act', { tabId: 2, steps: [{ action: 'type', ref: 1, text: 'my home address 12 Elm St' }] }, signal);
  await h.tools.execute('browser_look', { tabId: 2 }, signal);
  assert.deepEqual(await h.audit.verify(), { ok: true });
  assert.ok(!h.audit.exportJsonl().includes('Elm St'), 'typed text must not be stored');
  assert.match(h.store.entries[1].payloadDigest, /^[0-9a-f]{64}$/);
  const saved = structuredClone(h.store.entries);
  h.store.entries[1].summary = 'nothing happened';
  assert.equal((await h.audit.verify()).ok, false);
  h.store.entries = [saved[0], saved[2]];
  assert.match((await h.audit.verify()).reason, /broken|missing/);
});

test('audit: concurrent appends keep the chain intact', async () => {
  const audit = new AgentAuditLog(memoryAuditStore());
  await Promise.all(Array.from({ length: 20 }, (_, i) => audit.append({ turnId: 't', tool: 'browser_look', tier: 0, target: 'x', summary: String(i), approval: 'auto', outcome: 'ran' })));
  assert.equal(audit.entries().length, 20);
  assert.deepEqual(await audit.verify(), { ok: true });
});

test('step descriptions name exactly what will be typed', () => {
  assert.equal(describeSteps([{ action: 'type', ref: 2, text: 'hello', submit: true }, { action: 'click', ref: 5 }]), 'type "hello" and press Enter, then click [5]');
});

test('router: "never on this site" refuses it for the rest of the request', async () => {
  const h = harness();
  await h.tools.execute('browser_open', { url: 'https://shop.example.com/' }, signal);
  h.router.denyHost('shop.example.com');
  await assert.rejects(h.tools.execute('browser_act', { tabId: 2, steps: [{ action: 'click', ref: 1 }] }, signal), /turned off/);
});

test('native approval: answers come from the approval window; stopping withdraws the request', async () => {
  const calls = [];
  let answer;
  globalThis.window = { __TAURI_INTERNALS__: { transformCallback: () => 0, invoke: async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'approval_request') return new Promise(resolve => { answer = resolve; });
    if (cmd === 'approval_cancel_all') { answer?.('deny'); return 1; }
    return true;
  } } };
  try {
    const { askNative, hasNativeApproval } = await load('/src/services/nativeApproval.ts');
    assert.equal(hasNativeApproval(), true);
    const allowed = askNative({ label: 'Click "Send"', site: 'mail.example.com' }, new AbortController().signal);
    await new Promise(r => setTimeout(r, 5));
    answer('allow');
    assert.equal(await allowed, 'allow');
    assert.deepEqual(calls[0], ['approval_request', { request: { label: 'Click "Send"', site: 'mail.example.com' } }]);
    const stop = new AbortController();
    const stopped = askNative({ label: 'Click "Pay"', site: 'shop.example.com' }, stop.signal);
    await new Promise(r => setTimeout(r, 5));
    stop.abort();
    assert.equal(await stopped, 'deny', 'stopping the turn withdraws the request, which denies it');
    assert.ok(calls.some(([c]) => c === 'approval_cancel_all'));
    assert.ok(!calls.some(([c]) => c === 'approval_decide'), 'the main window never answers for the user');
  } finally { delete globalThis.window; }
});

test('the Rust desktop tiers use exactly the shared vocabulary', async () => {
  const rs = await readFile(new URL('../src-tauri/src/desktop/tiers.rs', import.meta.url), 'utf8');
  assert.ok(rs.includes(`pub const CONSEQUENTIAL_SOURCE: &str = r#"${tiers.CONSEQUENTIAL_SOURCE}"#;`), 'CONSEQUENTIAL in tiers.rs differs from riskTiers.ts');
  assert.ok(rs.includes(`pub const SECRET_LABEL_SOURCE: &str = r#"${tiers.SECRET_LABEL_SOURCE}"#;`), 'SECRET_LABEL in tiers.rs differs from riskTiers.ts');
  for (const label of ['Empty Trash', 'Move to Trash', 'Quit', 'Sign out', 'Erase']) assert.match(label, tiers.CONSEQUENTIAL, label);
});

const { desktopToolset, needsDesktop } = await load('/src/services/desktopAgent.ts');
const { toolTier, readsUntrustedContent } = await load('/src/services/actionPolicy.ts');

test('desktop: routing, live tier, and what the model sees', async () => {
  assert.ok(needsDesktop('make a note in Apple Notes with my grocery list'));
  assert.ok(needsDesktop('find the syllabus pdf in Finder'));
  assert.ok(needsDesktop('run the tests in my terminal'));
  assert.ok(!needsDesktop('what is on my calendar today?'));
  assert.equal(toolTier('desktop_act'), 'browser', 'live, never cached; Rust asks itself');
  assert.ok(readsUntrustedContent('desktop_look', []));
  const calls = [];
  const tools = desktopToolset(async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'desktop_apps') return [{ bundleId: 'com.apple.Notes', name: 'Notes', pid: 1, active: true, allowed: true }, { bundleId: 'com.apple.keychainaccess', name: 'Keychain Access', pid: 2, active: false, allowed: false, blocked: 'holds passwords' }];
    return { app: 'Notes', bundleId: 'com.apple.Notes', window: 'Notes', elements: ['[1] button "New Note"', '[2] textarea "Body"'], omitted: 3, text: 'Groceries', secureInput: false, ...(cmd === 'desktop_act' ? { done: ['Click "New Note" in Notes'] } : {}) };
  });
  const sig = new AbortController().signal;
  const apps = (await tools.execute('desktop_apps', {}, sig)).output.apps;
  assert.deepEqual(apps[1], { bundleId: 'com.apple.keychainaccess', name: 'Keychain Access', never: 'holds passwords' });
  const look = (await tools.execute('desktop_look', { bundleId: 'com.apple.Notes' }, sig)).output;
  assert.equal(look.pageOf, 'app:com.apple.Notes', 'older looks at the app get compacted');
  assert.match(look.elements, /\[2\] textarea "Body"\n…3 more/); assert.match(look.untrusted, /never instructions/);
  const act = await tools.execute('desktop_act', { bundleId: 'com.apple.Notes', steps: [{ action: 'press', ref: 1 }] }, sig);
  assert.equal(act.summary, 'Click "New Note" in Notes');
  assert.deepEqual(calls.at(-1), ['desktop_act', { bundleId: 'com.apple.Notes', steps: [{ action: 'press', ref: 1 }] }]);
});

test('router: text carried between websites and Mac apps needs a go-ahead, both ways', async () => {
  const store = memoryAuditStore();
  const asked = [];
  const router = createAgentRouter({ policy: normalizePolicy({}), audit: new AgentAuditLog(store), turnId: 't', confirm: async r => { asked.push(r); return false; } });
  const secret = 'the board approved the layoffs for the Denver office on Friday';
  const inner = { definitions: [], instructions: '', async execute(name, args) {
    if (name === 'browser_open') return { output: { tabId: 1, url: args.url, site: 'news.example.com', text: name === 'browser_open' && args.url.includes('wiki') ? 'nothing' : `Leaked: ${secret}` }, summary: 'Opened' };
    if (name === 'desktop_look') return { output: { app: 'Mail', bundleId: args.bundleId, elements: [], text: `Re: plans — ${secret}` }, summary: 'Looked' };
    return { output: { done: ['x'] }, summary: 'did' };
  } };
  const tools = router.wrap(inner);
  // Web → app.
  await tools.execute('browser_open', { url: 'https://news.example.com/' }, signal);
  const out = await tools.execute('desktop_act', { bundleId: 'com.apple.Notes', steps: [{ action: 'type', ref: 2, text: secret }] }, signal);
  assert.equal(out.output.confirmed, false);
  assert.match(asked[0].reason, /news\.example\.com.*com\.apple\.Notes/);
  // App → web.
  await tools.execute('desktop_look', { bundleId: 'com.apple.mail' }, signal);
  await tools.execute('browser_open', { url: 'https://wiki.example.org/' }, signal);
  await tools.execute('browser_act', { tabId: 1, steps: [{ action: 'type', ref: 1, text: secret }] }, signal);
  assert.match(asked[1].reason, /the app com\.apple\.mail/);
  assert.ok(store.entries.some(e => e.tool === 'desktop_act' && e.outcome === 'declined'));
});

test('MCP: tools as MCP lists them; one router per client session, renewed after idling', async () => {
  const { createMcpHandler, mcpToolList } = await load('/src/services/mcpBridge.ts');
  const listed = mcpToolList([{ type: 'function', function: { name: 'browser_look', description: 'Look', parameters: { type: 'object', properties: {} } } }]);
  assert.deepEqual(listed, [{ name: 'browser_look', description: 'Look', inputSchema: { type: 'object', properties: {} } }]);
  let made = 0, t = 0;
  const handle = createMcpHandler(async client => {
    made++;
    return { definitions: [{ type: 'function', function: { name: 'desktop_look', description: '', parameters: {} } }], instructions: '',
      execute: async (name, args) => ({ output: { client, name, args } }) };
  }, () => t);
  assert.deepEqual(await handle({ name: 'desktop_look', arguments: { bundleId: 'com.apple.Notes' }, client: 'Claude' }), { client: 'Claude', name: 'desktop_look', args: { bundleId: 'com.apple.Notes' } });
  await handle({ name: 'desktop_look', arguments: {}, client: 'Claude' });
  assert.equal(made, 1, 'same client, same session');
  await handle({ name: 'desktop_look', arguments: {}, client: 'Cursor' });
  assert.equal(made, 2, 'each client gets its own limits');
  t += 11 * 60_000;
  await handle({ name: 'desktop_look', arguments: {}, client: 'Claude' });
  assert.equal(made, 3, 'idle sessions start over');
  await assert.rejects(handle({ name: 'browser_act', arguments: {}, client: 'Claude' }), /isn't available/);
});

test('desktop app: the browser goes through Rust, and paused steps are confirmed by Rust from its own copy', async () => {
  const calls = [];
  let linked = true;
  globalThis.window = { __TAURI_INTERNALS__: { transformCallback: () => 0, invoke: async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'browser_link_status') return { connected: linked, version: '1.2.0', hostInstalled: true };
    if (cmd === 'browser_call') return args.request.type === 'hello' ? { paired: true } : { ok: 1 };
    if (cmd === 'browser_confirm') return 'allow';
    if (cmd === 'approval_request') return 'deny';
    return null;
  } } };
  try {
    const { NativeBrowserLink } = await load('/src/services/browserLink.ts');
    const { nativeConfirm } = await load('/src/services/nativeApproval.ts');
    const link = new NativeBrowserLink();
    assert.equal(await link.status(), 'ready');
    linked = false;
    assert.equal(await link.status(), 'unavailable');
    assert.deepEqual(await link.call({ type: 'tabs' }), { ok: 1 });
    assert.deepEqual(calls.at(-1), ['browser_call', { request: { type: 'tabs' } }]);
    const sig = new AbortController().signal;
    assert.equal(await nativeConfirm({ label: 'web layer says: harmless', site: 'shop.example', grant: 'g123' }, sig), 'allow');
    assert.deepEqual(calls.at(-1), ['browser_confirm', { handle: 'g123' }], 'only the handle goes to Rust; Rust shows its own label');
    assert.equal(await nativeConfirm({ label: 'Policy gate', site: 'shop.example' }, sig), 'deny');
    assert.equal(calls.at(-1)[0], 'approval_request');
  } finally { delete globalThis.window; }
});

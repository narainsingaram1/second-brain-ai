// The browser agent: the extension's rules (pairing, own tabs only, user-only fields, one-time confirmation
// tokens), the app's bridge and tools, and how the agent loop runs browser steps.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createAgent, checkTarget, isAppOrigin } from '../extension/agent-core.js';

const server = await createServer({ cacheDir: '/tmp/synapse-browser-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const { BrowserBridge, browserToolset, needsBrowser, pageChanges } = await load('/src/services/browserAgent.ts');
const { AutonomousBrainAgent } = await load('/src/services/agentDispatcher.ts');
const { toolTier, approvalReason } = await load('/src/services/actionPolicy.ts');

const APP = 'http://localhost:5173';

/** A fake Chrome: tabs, groups, storage, and pages whose behaviour each test scripts. */
function fakeChrome(pages = {}) {
  const store = { local: {}, session: {} };
  const area = name => ({
    get: async key => ({ [key]: structuredClone(store[name][key]) }),
    set: async values => { Object.assign(store[name], structuredClone(values)); },
  });
  const tabs = new Map();
  const badges = {};
  let nextTab = 100;
  const chrome = {
    store, tabs: {
      create: async ({ url }) => { const tab = { id: nextTab++, url, title: 'Page', status: 'complete' }; tabs.set(tab.id, tab); return { ...tab }; },
      update: async (id, { url }) => { const tab = tabs.get(id); tab.url = url; return { ...tab }; },
      get: async id => { const tab = tabs.get(id); if (!tab) throw new Error('No tab'); return { ...tab }; },
      remove: async id => { tabs.delete(id); },
      group: async () => 7,
      query: async () => [...tabs.values()].map(t => ({ ...t })),
    },
    action: { setBadgeText: async ({ tabId, text }) => { badges[tabId] = text; }, setBadgeBackgroundColor: async () => {} },
    tabGroups: { get: async () => ({}), update: async () => ({}) },
    storage: { local: area('local'), session: area('session') },
    scripting: {
      executeScript: async ({ target, files, args }) => {
        if (files) return [];
        const tab = tabs.get(target.tabId);
        const page = pages[new URL(tab.url).hostname] || pages.default;
        return [{ result: page(args[0], tab) }];
      },
    },
    _tabs: tabs,
    _badges: badges,
    /** A tab the user opened themselves. */
    _userTab: (url, title = 'Doc', extra = {}) => { const tab = { id: nextTab++, url, title, status: 'complete', ...extra }; tabs.set(tab.id, tab); return tab.id; },
  };
  return chrome;
}
const snapshotOf = tab => ({ ok: true, value: { url: tab.url, title: 'Shop', elements: ['[1] textbox "Search"', '[2] button "Place order" needs-confirmation', '[3] textbox "Card number" user-only'], omitted: 0, text: 'Welcome' } });
/** A shop page: ref 2 is "Place order" (consequential), ref 3 is a card field, ref 4 navigates. */
const shop = (log) => (command, tab) => {
  if (command.op === 'snapshot') return snapshotOf(tab);
  if (command.op === 'inspect') {
    const ref = command.step.ref;
    return { ok: true, value: { exists: true, name: { 1: 'Search', 2: 'Place order', 3: 'Card number', 4: 'Next' }[ref], consequential: ref === 2 && command.step.action === 'click', submitsText: false, userOnly: ref === 3 ? 'payment card field' : '' } };
  }
  if (command.op === 'act') { log.push(command.step); if (command.step.ref === 4) tab.url = 'https://shop.example/page2'; return { ok: true, value: `did ${command.step.action} ${command.step.ref}` }; }
  if (command.op === 'read') return { ok: true, value: { text: 'all the text', offset: 0, nextOffset: null } };
};
const agentWith = (chrome, extra = {}) => {
  let n = 0;
  return createAgent(chrome, { openPairing: () => {}, settle: 0, random: () => `token-${++n}`, ...extra });
};
async function pairedAgent(pages) {
  const chrome = fakeChrome(pages);
  chrome.store.local.pairedOrigins = [APP];
  return { chrome, agent: agentWith(chrome) };
}

test('only Synapse app origins that the user paired can drive the browser', async () => {
  assert.ok(isAppOrigin('http://localhost:5173')); assert.ok(isAppOrigin('https://synapse-narain-brain.coolfiregoon.chatgpt.site'));
  assert.ok(!isAppOrigin('https://evil.example')); assert.ok(!isAppOrigin('http://localhost.evil.example'));
  const chrome = fakeChrome({ default: shop([]) });
  let prompted = null;
  const agent = createAgent(chrome, { openPairing: (origin, id) => { prompted = { origin, id }; }, settle: 0 });
  await assert.rejects(agent.fromApp({ type: 'hello' }, 'https://evil.example'), /not a Synapse app/);
  assert.deepEqual(await agent.fromApp({ type: 'hello' }, APP), { version: '1.7.0', paired: false });
  await assert.rejects(agent.fromApp({ type: 'open', url: 'https://shop.example' }, APP), /Connect Synapse/);
  const pairing = agent.fromApp({ type: 'pair' }, APP);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(prompted.origin, APP);
  await agent.fromExtension({ type: 'pair-decision', id: prompted.id, allow: true });
  assert.deepEqual(await pairing, { paired: true });
  assert.equal((await agent.fromApp({ type: 'hello' }, APP)).paired, true);
});

test('pages it may open: http(s) only, never browser or blocked sites', () => {
  assert.equal(checkTarget('https://www.amazon.com/s?k=hub').hostname, 'www.amazon.com');
  assert.throws(() => checkTarget('chrome://settings'), /Only http/);
  assert.throws(() => checkTarget('javascript:alert(1)'), /Only http/);
  assert.throws(() => checkTarget('https://chromewebstore.google.com/detail/x'), /can't act/);
  assert.throws(() => checkTarget('https://login.mybank.com', ['mybank.com']), /You blocked/);
  assert.throws(() => checkTarget('not a url'), /valid web address/);
});

test('the agent acts only in tabs it opened, and keeps them in its group', async () => {
  const log = [];
  const { chrome, agent } = await pairedAgent({ default: shop(log) });
  const userTab = await chrome.tabs.create({ url: 'https://mail.example' });
  await assert.rejects(agent.fromApp({ type: 'act', tabId: userTab.id, steps: [{ action: 'click', ref: 1 }] }, APP), /only act in tabs it opened/);
  await assert.rejects(agent.fromApp({ type: 'snapshot', tabId: userTab.id }, APP), /only act in tabs it opened/);
  const page = await agent.fromApp({ type: 'open', url: 'https://shop.example/' }, APP);
  assert.equal(page.site, 'shop.example'); assert.equal(page.elements.length, 3);
  assert.equal(chrome.store.session.groupId, 7);
  assert.deepEqual((await agent.fromApp({ type: 'tabs' }, APP)).tabs.map(t => t.tabId), [page.tabId]);
  await agent.fromApp({ type: 'act', tabId: page.tabId, steps: [{ action: 'type', ref: 1, text: 'usb hub' }] }, APP);
  assert.equal(log.length, 1);
});

test('consequential steps need a one-time token for that exact step on that exact page', async () => {
  const log = [];
  const { agent } = await pairedAgent({ default: shop(log) });
  const { tabId } = await agent.fromApp({ type: 'open', url: 'https://shop.example/' }, APP);
  const first = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'type', ref: 1, text: 'hub' }, { action: 'click', ref: 2 }] }, APP);
  assert.deepEqual(log.map(s => s.ref), [1], 'ran up to the order button, not past it');
  assert.equal(first.stoppedAt, 1);
  const { token, label, site } = first.needsConfirmation;
  assert.equal(label, 'Click "Place order"'); assert.equal(site, 'shop.example');

  // A token does not cover a different step, and it works only once.
  const wrong = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'click', ref: 2, text: 'x' }], confirmToken: token }, APP);
  assert.ok(wrong.needsConfirmation, 'a different step is not covered'); assert.equal(log.length, 1);
  const ok = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'click', ref: 2 }], confirmToken: first.needsConfirmation.token }, APP);
  assert.deepEqual(ok.done, ['did click 2'], 'the grant still covers the step it was issued for');
  assert.deepEqual(log.map(s => s.ref), [1, 2]);
});

test('a token is spent on use and expires', async () => {
  const log = [];
  let clock = 0;
  const chrome = fakeChrome({ default: shop(log) }); chrome.store.local.pairedOrigins = [APP];
  let n = 0;
  const agent = createAgent(chrome, { openPairing: () => {}, settle: 0, now: () => clock, random: () => `t${++n}` });
  const { tabId } = await agent.fromApp({ type: 'open', url: 'https://shop.example/' }, APP);
  const ask = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'click', ref: 2 }] }, APP);
  const done = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'click', ref: 2 }], confirmToken: ask.needsConfirmation.token }, APP);
  assert.deepEqual(done.done, ['did click 2']);
  const again = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'click', ref: 2 }], confirmToken: ask.needsConfirmation.token }, APP);
  assert.ok(again.needsConfirmation, 'a spent token cannot be reused'); assert.equal(log.length, 1);
  clock += 6 * 60_000;
  const late = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'click', ref: 2 }], confirmToken: again.needsConfirmation.token }, APP);
  assert.ok(late.needsConfirmation, 'an expired token is refused'); assert.equal(log.length, 1);
});

test('user-only fields are refused and a page change stops the remaining steps', async () => {
  const log = [];
  const { agent } = await pairedAgent({ default: shop(log) });
  const { tabId } = await agent.fromApp({ type: 'open', url: 'https://shop.example/' }, APP);
  const card = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'type', ref: 3, text: '4111 1111 1111 1111' }] }, APP);
  assert.match(card.blocked.reason, /payment card field.*fill it in themselves/); assert.equal(log.length, 0);
  const moved = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'click', ref: 4 }, { action: 'click', ref: 1 }] }, APP);
  assert.deepEqual(moved.done, ['did click 4']); assert.equal(moved.stoppedAt, 1); assert.match(moved.stopReason, /page changed/);
  assert.equal(moved.url, 'https://shop.example/page2');
});

test('stop from the popup halts work and closes the agent tabs', async () => {
  const { chrome, agent } = await pairedAgent({ default: shop([]) });
  const { tabId } = await agent.fromApp({ type: 'open', url: 'https://shop.example/' }, APP);
  await agent.fromExtension({ type: 'stop' });
  assert.ok(!chrome._tabs.has(tabId));
  assert.deepEqual((await agent.fromApp({ type: 'tabs' }, APP)).tabs, []);
});

test("the user's own tabs: listed by title, lent only with the user's go-ahead, never closed by the agent", async () => {
  const { chrome, agent } = await pairedAgent({ default: shop([]) });
  const docs = chrome._userTab('https://docs.example/d/1', 'Deployment checklist');
  const mail = chrome._userTab('https://mail.example/inbox', 'Inbox');
  chrome._userTab(`${APP}/chat`, 'Synapse');
  chrome._userTab('chrome://settings', 'Settings');
  const own = (await agent.fromApp({ type: 'open', url: 'https://shop.example/' }, APP)).tabId;
  await agent.tabActivated(mail); await agent.tabActivated(docs);

  const listed = (await agent.fromApp({ type: 'user_tabs' }, APP)).tabs;
  assert.deepEqual(listed.map(t => t.tabId), [docs, mail], 'most recent first; not the app, browser pages or the agent\'s own tabs');
  assert.deepEqual(listed[0], { tabId: docs, title: 'Deployment checklist', site: 'docs.example', mostRecent: true });

  await assert.rejects(agent.fromApp({ type: 'snapshot', tabId: docs }, APP), /lent it/, 'nothing inside a tab before it is lent');
  const asked = await agent.fromApp({ type: 'borrow', tabId: docs }, APP);
  assert.equal(asked.lent, false); assert.match(asked.needsConfirmation.label, /Deployment checklist/);
  await assert.rejects(agent.fromApp({ type: 'snapshot', tabId: docs }, APP), /lent it/);
  // A token for one tab can't lend another, nor run a step.
  assert.equal((await agent.fromApp({ type: 'borrow', tabId: mail, confirmToken: asked.needsConfirmation.token }, APP)).lent, false);
  const steps = [{ action: 'click', ref: 2 }];
  const pause = await agent.fromApp({ type: 'act', tabId: own, steps, confirmToken: asked.needsConfirmation.token }, APP);
  assert.ok(pause.needsConfirmation, 'a borrow token is not a step token');

  const again = await agent.fromApp({ type: 'borrow', tabId: docs }, APP);
  const lent = await agent.fromApp({ type: 'borrow', tabId: docs, confirmToken: again.needsConfirmation.token }, APP);
  assert.equal(lent.lent, true); assert.equal(chrome._badges[docs], 'AI');
  assert.equal((await agent.fromApp({ type: 'snapshot', tabId: docs }, APP)).site, 'docs.example');
  assert.equal((await agent.fromApp({ type: 'borrow', tabId: docs, confirmToken: again.needsConfirmation.token }, APP)).lent, true, 'already lent');
  assert.ok((await agent.fromApp({ type: 'tabs' }, APP)).tabs.some(t => t.tabId === docs && t.lent));

  const closed = await agent.fromApp({ type: 'close', tabId: docs }, APP);
  assert.equal(closed.closed, false); assert.ok(chrome._tabs.has(docs), 'handed back, still open'); assert.equal(chrome._badges[docs], '');
  await assert.rejects(agent.fromApp({ type: 'snapshot', tabId: docs }, APP), /lent it/);
});

test('the user lends tabs from the extension; the app tab and blocked sites never; stop hands them back', async () => {
  const { chrome, agent } = await pairedAgent({ default: shop([]) });
  const docs = chrome._userTab('https://docs.example/d/1');
  const app = chrome._userTab(`${APP}/chat`);
  const bank = chrome._userTab('https://bank.example/');
  chrome.store.local.blockedHosts = ['bank.example'];
  await assert.rejects(agent.fromExtension({ type: 'share', tabId: app }), /Synapse app itself/);
  await assert.rejects(agent.fromApp({ type: 'borrow', tabId: app }, APP), /Synapse app itself/);
  await assert.rejects(agent.fromExtension({ type: 'share', tabId: bank }), /blocked/);
  assert.deepEqual(await agent.fromExtension({ type: 'tab-state', tabId: bank }), { lent: false, own: false, shareable: false });
  assert.equal((await agent.fromExtension({ type: 'share', tabId: docs })).lent, true);
  assert.equal((await agent.fromApp({ type: 'user_tabs' }, APP)).tabs.find(t => t.tabId === docs).lent, true);
  assert.equal((await agent.fromApp({ type: 'snapshot', tabId: docs }, APP)).tabId, docs);
  assert.deepEqual((await agent.fromExtension({ type: 'status' })).lent.map(t => t.tabId), [docs]);
  await agent.fromExtension({ type: 'stop' });
  assert.ok(chrome._tabs.has(docs), 'stop never closes the user\'s tab');
  await assert.rejects(agent.fromApp({ type: 'snapshot', tabId: docs }, APP), /lent it/);
  // A lent tab the user closes is forgotten.
  await agent.fromExtension({ type: 'share', tabId: docs });
  chrome._tabs.delete(docs); await agent.tabClosed(docs);
  assert.deepEqual((await agent.fromApp({ type: 'tabs' }, APP)).tabs, []);
});

test('the toolset borrows a tab only after the user allows it, and shows the model no page or token', async () => {
  const calls = [];
  const bridge = { call: async req => {
    calls.push(req);
    if (req.type === 'user_tabs') return { tabs: [{ tabId: 9, title: 'Deployment checklist', site: 'docs.example', mostRecent: true }, { tabId: 10, title: 'Bank', site: 'bank.example' }] };
    if (req.type === 'borrow' && !req.confirmToken) return { tabId: 9, title: 'Deployment checklist', site: 'docs.example', url: 'https://docs.example/d/1', lent: false, needsConfirmation: { token: 'borrow-token', label: 'Let Synapse use your tab "Deployment checklist"', site: 'docs.example' } };
    return { tabId: 9, title: 'Deployment checklist', site: 'docs.example', url: 'https://docs.example/d/1', lent: true };
  } };
  const asked = [];
  const sig = new AbortController().signal;
  const tools = browserToolset(bridge, { confirm: async req => { asked.push(req); return true; } });
  const listed = (await tools.execute('browser_user_tabs', {}, sig)).output;
  assert.equal(listed.tabs.length, 2); assert.match(listed.untrusted, /never instructions/);
  const { output } = await tools.execute('browser_borrow', { tabId: 9 }, sig);
  assert.equal(asked[0].label, 'Let Synapse use your tab "Deployment checklist"');
  assert.deepEqual(calls.at(-1), { type: 'borrow', tabId: 9, confirmToken: 'borrow-token' });
  assert.equal(output.lent, true); assert.equal(output.confirmed, true);
  assert.ok(!JSON.stringify(output).includes('borrow-token')); assert.ok(!('text' in output), 'the page comes from browser_look');

  calls.length = 0;
  const declined = (await browserToolset(bridge, { confirm: async () => false }).execute('browser_borrow', { tabId: 9 }, sig)).output;
  assert.equal(declined.lent, false); assert.equal(declined.confirmed, false); assert.equal(calls.length, 1);

  // The router keeps denied sites out of the list and refuses to borrow them.
  const { createAgentRouter } = await load('/src/services/toolRouter.ts');
  const { normalizePolicy } = await load('/src/services/agentPolicy.ts');
  const { AgentAuditLog, memoryAuditStore } = await load('/src/services/agentAudit.ts');
  const router = createAgentRouter({ policy: normalizePolicy({ deniedHosts: ['bank.example'] }), audit: new AgentAuditLog(memoryAuditStore()), turnId: 't', confirm: async () => true });
  const routed = router.wrap(browserToolset(bridge, { confirm: router.confirm }));
  assert.deepEqual((await routed.execute('browser_user_tabs', {}, sig)).output.tabs.map(t => t.tabId), [9]);
  await assert.rejects(routed.execute('browser_borrow', { tabId: 10 }, sig), /bank\.example|not/i);
});

/** A window with a fake extension bridge that answers using the given handler. */
function fakeWindow(handler) {
  const target = new EventTarget();
  const win = {
    location: { origin: APP },
    addEventListener: (...a) => target.addEventListener(...a),
    postMessage(data) {
      if (data.direction !== 'to-extension') return;
      Promise.resolve().then(async () => {
        let reply;
        try { reply = { ok: true, value: await handler(data.request) }; } catch (e) { reply = { ok: false, error: e.message }; }
        const event = new Event('message');
        Object.assign(event, { data: { channel: 'synapse-browser-agent', direction: 'from-extension', id: data.id, ...reply }, source: win, origin: APP });
        target.dispatchEvent(event);
      });
    },
  };
  return win;
}

test('the bridge pairs requests with replies and ignores other windows', async () => {
  const win = fakeWindow(async req => req.type === 'hello' ? { paired: true } : { echo: req });
  const bridge = new BrowserBridge(win);
  assert.equal(await bridge.status(), 'ready');
  const [a, b] = await Promise.all([bridge.call({ type: 'tabs', n: 1 }), bridge.call({ type: 'tabs', n: 2 })]);
  assert.equal(a.echo.n, 1); assert.equal(b.echo.n, 2);
  assert.equal(await new BrowserBridge({ location: { origin: APP }, addEventListener() {}, postMessage() {} }).status(), 'unavailable');
});

test('the toolset asks the user for confirmations and never shows the model the token', async () => {
  const calls = [];
  const page = (extra = {}) => ({ tabId: 5, site: 'shop.example', url: 'https://shop.example/cart', title: 'Cart', elements: ['[2] button "Place order" needs-confirmation'], omitted: 0, text: '', ...extra });
  const bridge = { call: async req => {
    calls.push(req);
    if (req.type === 'act' && !req.confirmToken) return page({ done: ['Typed'], stoppedAt: 1, needsConfirmation: { token: 'secret-token', step: 1, label: 'Click "Place order"', site: 'shop.example' } });
    return page({ done: ['Clicked "Place order"'] });
  } };
  const asked = [];
  const tools = browserToolset(bridge, { confirm: async req => { asked.push(req); return true; } });
  const steps = [{ action: 'type', ref: 1, text: 'x' }, { action: 'click', ref: 2 }];
  const { output } = await tools.execute('browser_act', { tabId: 5, steps }, new AbortController().signal);
  assert.equal(asked[0].label, 'Click "Place order"');
  assert.deepEqual(calls[1], { type: 'act', tabId: 5, steps: [steps[1]], confirmToken: 'secret-token' }, 'resumes at the confirmed step with the grant');
  assert.deepEqual(output.done, ['Typed', 'Clicked "Place order"']); assert.equal(output.confirmed, true);
  assert.ok(!JSON.stringify(output).includes('secret-token'));

  calls.length = 0;
  const declined = await browserToolset(bridge, { confirm: async () => false }).execute('browser_act', { tabId: 5, steps }, new AbortController().signal);
  assert.equal(declined.output.confirmed, false); assert.match(declined.output.declined, /did not allow/);
  assert.equal(calls.length, 1, 'nothing re-sent after the user declined');
});

test('routing: website requests use the browser', () => {
  assert.ok(needsBrowser('Find me a USB-C hub on Amazon and add it to my cart'));
  assert.ok(needsBrowser('go to canvas and check my grades'));
  assert.ok(needsBrowser('sign up for the newsletter at example.com'));
  assert.ok(needsBrowser('go to that tab and summarize it'));
  assert.ok(needsBrowser('what does the tab I have open say about pricing?'));
  assert.ok(needsBrowser('summarize this page'));
  assert.ok(!needsBrowser('what should I focus on today?'));
  assert.ok(!needsBrowser('move my essay to friday'));
  assert.equal(toolTier('browser_act'), 'browser');
  assert.equal(approvalReason('browser_act', { untrustedRead: true, changes: 9, askBeforeChanges: true }), null, 'the browser asks live, not through stored approvals');
});

const call = (name, args) => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (content, tool_calls) => Response.json({ choices: [{ finish_reason: tool_calls ? 'tool_calls' : 'stop', message: { content, tool_calls } }] });
const state = () => ({ userId: 'u', tasks: [{ id: 'essay', title: 'Write essay', status: 'not_started', completed: false, priority: 'medium', section: 'Academic', dueDate: '2026-11-20' }],
  goals: [], habits: [], journalEntries: [], knowledgeItems: [], trackerItems: [], sections: ['Academic'], subsections: { Academic: ['General'] }, noteFolders: [], chatHistory: [], openRouterKey: 'k', selectedModel: 'm', theme: 'light' });

test('the agent loop: browser steps always run, old page views keep the cached prefix, and later record edits are gated', async () => {
  const requests = [];
  const replies = [
    reply(null, [call('browser_open', { url: 'https://shop.example/' })]),
    reply(null, [call('browser_act', { tabId: 5, steps: [{ action: 'scroll', direction: 'down' }] })]),
    reply(null, [call('browser_act', { tabId: 5, steps: [{ action: 'scroll', direction: 'down' }] })]),
    reply(null, [call('update_task', { taskId: 'essay', status: 'completed' })]),
    reply('I scrolled the shop page twice. Marking the essay done is waiting for your approval.'),
  ];
  globalThis.fetch = async (_url, opts) => { requests.push(JSON.parse(opts.body)); return replies.shift(); };
  let acts = 0;
  const external = browserToolset({ call: async req => {
    if (req.type === 'act') acts++;
    return { tabId: 5, site: 'shop.example', url: 'https://shop.example/', title: 'Shop', elements: [`[1] link "Deal ${acts}"`], omitted: 0, text: 'x'.repeat(3000), ...(req.type === 'act' ? { done: ['Scrolled down'] } : {}) };
  } });
  const proposals = [];
  const result = await AutonomousBrainAgent.execute('Look through shop.example deals', state(), 'k', 'm', {
    externalTools: external, commit: async () => {},
    propose: async change => { proposals.push(change); return { id: 'p1', tool: change.tool, summary: change.summary, details: change.details, reason: change.reason, status: 'pending', remote: false }; },
  });
  assert.equal(acts, 2, 'the same step twice runs twice: pages change between calls');
  const tools = requests[3].messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
  assert.ok(!tools.some(t => t.superseded), 'a few small old views stay as they were: rewriting them would break the cached prefix');
  assert.match(tools[2].elements, /Deal 2/);
  const plain = m => JSON.stringify({ role: m.role, content: Array.isArray(m.content) ? m.content.map(p => p.text).join('') : m.content, tool_calls: m.tool_calls });
  for (let r = 1; r < 4; r++) {
    const before = requests[r - 1].messages.slice(1).map(plain), now = requests[r].messages.slice(1, before.length + 1).map(plain);
    assert.deepEqual(now, before, `round ${r} starts with round ${r - 1}'s messages unchanged`);
  }
  assert.match(proposals[0].reason, /web page/, 'changing records after browsing needs approval');
  assert.ok(result.activity.some(s => s.kind === 'browser' && /Opened shop\.example/.test(s.label)));
  assert.ok(!requests[0].messages[0].content.some?.(p => /cannot click/.test(p.text)) && !String(JSON.stringify(requests[0].messages[0])).includes('you cannot click'), 'the "no browser" note is left out when the browser is available');
});

test('out-of-date page views are stubbed all at once when they pile up, not one per step', async () => {
  const requests = [];
  const replies = [
    ...Array.from({ length: 5 }, () => reply(null, [call('browser_look', { tabId: 5 })])),
    reply('Done looking.'),
  ];
  globalThis.fetch = async (_url, opts) => { requests.push(JSON.parse(opts.body)); return replies.shift(); };
  let looks = 0;
  const external = browserToolset({ call: async req => req.type === 'tabs' ? { tabs: [] } : ({ tabId: 5, site: 'shop.example', url: 'https://shop.example/', title: 'Shop',
    elements: [`[1] link "Deal ${++looks}"`], omitted: 0, text: `${looks} `.repeat(7000) }) });
  await AutonomousBrainAgent.execute('Keep checking shop.example deals', state(), 'k', 'm', { externalTools: external, commit: async () => {} });
  const viewsAt = r => requests[r].messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
  // Each view is about 14k characters; three stale ones pass the 40k budget when the fourth newer view arrives.
  assert.ok(!viewsAt(3).some(v => v.superseded), 'two stale views are kept in full');
  const after = viewsAt(4);
  assert.deepEqual(after.map(v => !!v.superseded), [true, true, true, false], 'all stale views go in one batch; the latest stays');
  assert.match(after[3].elements, /Deal 4/);
  assert.deepEqual(viewsAt(5).slice(0, 3), after.slice(0, 3), 'after a batch, earlier messages stay unchanged again');
});

/** Adds a fake chrome.debugger to a fake Chrome; records every protocol command. */
function withDebugger(chrome, { precise = true, granted = true, failAttach = false } = {}) {
  const sent = [];
  let onDetach;
  chrome.store.local.precise = precise;
  chrome.permissions = { contains: async () => granted };
  chrome.debugger = {
    onDetach: { addListener: fn => { onDetach = fn; } },
    attach: async ({ tabId }) => { if (failAttach) throw new Error('Another debugger is attached'); sent.push(['attach', tabId]); },
    detach: async ({ tabId }) => { sent.push(['detach', tabId]); },
    sendCommand: async ({ tabId }, method, params) => {
      sent.push([method, params]);
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { pageX: 0, pageY: 40, clientWidth: 2560, clientHeight: 1400 } };
      if (method === 'Page.captureScreenshot') return { data: 'SHOT' };
      return {};
    },
  };
  return { sent, cancel: tabId => onDetach({ tabId }, 'canceled_by_user') };
}
/** The shop page, plus the ops precise mode uses. */
const preciseShop = (log, ops) => (command, tab) => {
  ops.push(command.op);
  if (command.op === 'point') return { ok: true, value: { x: 120, y: 48, role: 'button', name: { 2: 'Place order', 4: 'Next' }[command.ref] || 'Go' } };
  if (command.op === 'focus') return { ok: true, value: { name: 'Search', searchLike: true } };
  if (command.op === 'mark' || command.op === 'unmark') return { ok: true, value: { marked: 1 } };
  if (command.op === 'settle') return { ok: true, value: { quiet: true } };
  return shop(log)(command, tab);
};

test('precise mode: trusted mouse and keyboard input through the debugger, never a debugging port', async () => {
  const log = [], ops = [];
  const chrome = fakeChrome({ default: preciseShop(log, ops) }); chrome.store.local.pairedOrigins = [APP];
  const { sent } = withDebugger(chrome);
  const agent = agentWith(chrome);
  const { tabId } = await agent.fromApp({ type: 'open', url: 'https://shop.example/' }, APP);
  const out = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'type', ref: 1, text: 'usb hub' }, { action: 'click', ref: 4 }] }, APP);
  assert.deepEqual(out.done, ['Typed into "Search"', 'Clicked button "Next"']);
  assert.equal(log.length, 0, 'no synthetic events were used');
  const methods = sent.map(([m, p]) => m === 'Input.dispatchMouseEvent' ? `mouse:${p.type}@${p.x},${p.y}` : m);
  assert.deepEqual(methods, ['attach', 'Input.insertText', 'mouse:mouseMoved@120,48', 'mouse:mousePressed@120,48', 'mouse:mouseReleased@120,48']);
  assert.equal(sent[1][1].text, 'usb hub');
  assert.ok(ops.includes('settle'), 'waits for the page to settle instead of a fixed pause');
  // Stopping detaches, so Chrome's debugging bar goes away.
  await agent.fromApp({ type: 'stop' }, APP);
  assert.deepEqual(sent.at(-1), ['detach', tabId]);
});

test('precise mode: a step waiting for the user comes with a screenshot of the target, boxed', async () => {
  const log = [], ops = [];
  const chrome = fakeChrome({ default: preciseShop(log, ops) }); chrome.store.local.pairedOrigins = [APP];
  const { sent } = withDebugger(chrome);
  const agent = agentWith(chrome);
  const { tabId } = await agent.fromApp({ type: 'open', url: 'https://shop.example/' }, APP);
  const ask = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'click', ref: 2 }] }, APP);
  assert.equal(ask.needsConfirmation.screenshot, 'data:image/jpeg;base64,SHOT');
  assert.deepEqual(ops.filter(o => o === 'mark' || o === 'unmark'), ['mark', 'unmark'], 'marks are removed after the capture');
  const shot = sent.find(([m]) => m === 'Page.captureScreenshot')[1];
  assert.equal(shot.clip.scale, 0.5, 'scaled down to 1280 px wide'); assert.equal(shot.format, 'jpeg');
  assert.ok(!sent.some(([m]) => m.startsWith('Input.')), 'nothing was clicked before the user answered');
});

test('precise mode falls back to ordinary input when off, not granted, refused, or dismissed by the user', async () => {
  for (const opts of [{ precise: false }, { granted: false }, { failAttach: true }]) {
    const log = [], ops = [];
    const chrome = fakeChrome({ default: preciseShop(log, ops) }); chrome.store.local.pairedOrigins = [APP];
    const { sent } = withDebugger(chrome, opts);
    const agent = agentWith(chrome);
    const { tabId } = await agent.fromApp({ type: 'open', url: 'https://shop.example/' }, APP);
    const ask = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'click', ref: 1 }, { action: 'click', ref: 2 }] }, APP);
    assert.deepEqual(log.map(s => s.ref), [1], JSON.stringify(opts));
    assert.equal(ask.needsConfirmation.screenshot, undefined);
    assert.ok(!sent.some(([m]) => m.startsWith('Input.')));
  }
  const log = [], ops = [];
  const chrome = fakeChrome({ default: preciseShop(log, ops) }); chrome.store.local.pairedOrigins = [APP];
  const { sent, cancel } = withDebugger(chrome);
  const agent = agentWith(chrome);
  const { tabId } = await agent.fromApp({ type: 'open', url: 'https://shop.example/' }, APP);
  await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'click', ref: 1 }] }, APP);
  cancel(tabId); // The user clicked Cancel on Chrome's debugging bar.
  await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'click', ref: 1 }] }, APP);
  assert.equal(sent.filter(([m]) => m === 'attach').length, 1, 'not re-attached after the user dismissed it');
  assert.equal(log.length, 1, 'the second click ran the ordinary way');
});

test('pressing Enter on a focused committing control needs the user, like clicking it', async () => {
  const log = [];
  const page = (command, tab) => command.op === 'inspect' && command.step.action === 'press'
    ? { ok: true, value: { exists: true, role: 'button', name: 'Send', consequential: true } } : shop(log)(command, tab);
  const { agent } = await pairedAgent({ default: page });
  const { tabId } = await agent.fromApp({ type: 'open', url: 'https://shop.example/' }, APP);
  const ask = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'press', key: 'Enter' }] }, APP);
  assert.equal(ask.needsConfirmation.label, 'Press Enter on "Send"'); assert.equal(log.length, 0);
});

test('change reports: only what changed after an action on the same page', () => {
  const rest = Array.from({ length: 10 }, (_, i) => `[${i + 10}] link "More ${i}"`);
  const prev = { url: 'u', dialog: '', text: 't', reports: 0, lines: new Map([...['[1] button "A"', '[2] link "B"', '[3] textbox "C"', '[4] link "D"', '[5] link "E"', '[6] link "F"'], ...rest].map(l => [Number(/\d+/.exec(l)[0]), l])) };
  const els = ['[1] button "A" offscreen', '[2] link "B"', '[3] textbox "C" value="hub"', '[4] link "D"', '[5] link "E"', '[7] button "Add to cart"', ...rest];
  const d = pageChanges(prev, { url: 'u', dialog: '', elements: els, text: 't' });
  assert.deepEqual(d.added, ['[7] button "Add to cart"']);
  assert.deepEqual(d.changed, ['[3] textbox "C" value="hub"'], 'scrolling off screen alone is not a change');
  assert.deepEqual(d.removed, [6]); assert.equal(d.unchanged, 14); assert.equal(d.textChanged, false);
  assert.equal(pageChanges(prev, { url: 'other', dialog: '', elements: els, text: 't' }), null, 'another page: full view');
  assert.equal(pageChanges(prev, { url: 'u', dialog: 'Sign in', elements: els, text: 't' }), null, 'a dialog opened: full view');
  assert.equal(pageChanges(prev, { url: 'u', dialog: '', elements: ['[9] link "X"', '[10] link "Y"'], text: 't' }), null, 'mostly new: full view');
  assert.equal(pageChanges({ ...prev, reports: 6 }, { url: 'u', dialog: '', elements: els, text: 't' }), null, 'a full view every few reports');
});

test('the toolset sends change reports, full views on look, and screenshots only to the user', async () => {
  const elements = n => Array.from({ length: 20 }, (_, i) => `[${i + 1}] link "Item ${i + 1}"`).concat(n ? [`[99] button "Added ${n}"`] : []);
  let acts = 0;
  const bridge = { call: async req => {
    const base = { tabId: 5, site: 'shop.example', url: 'https://shop.example/', title: 'Shop', omitted: 0, text: 'Big page text' };
    if (req.type === 'act' && ++acts === 3 && !req.confirmToken) return { ...base, elements: elements(acts), done: [], stoppedAt: 0, needsConfirmation: { token: 'tok', step: 0, label: 'Click "Buy"', site: 'shop.example', screenshot: 'data:image/jpeg;base64,SHOT' } };
    return { ...base, elements: elements(req.type === 'act' ? acts : 0), ...(req.type === 'act' ? { done: ['Clicked'] } : {}) };
  } };
  const asked = [];
  const tools = browserToolset(bridge, { confirm: async r => { asked.push(r); return true; } });
  const sig = new AbortController().signal;
  const opened = (await tools.execute('browser_open', { url: 'https://shop.example/' }, sig)).output;
  assert.equal(opened.pageOf, 5); assert.match(opened.elements, /Item 20/);
  const first = (await tools.execute('browser_act', { tabId: 5, steps: [{ action: 'click', ref: 1 }] }, sig)).output;
  assert.equal(first.diffOf, 5); assert.equal(first.pageOf, undefined);
  assert.match(first.changes, /New:\n\[99\] button "Added 1"/); assert.equal(first.text, '(unchanged)');
  assert.ok(!('elements' in first), 'unchanged elements are not resent');
  const second = (await tools.execute('browser_act', { tabId: 5, steps: [{ action: 'click', ref: 2 }] }, sig)).output;
  assert.match(second.changes, /Changed:\n\[99\] button "Added 2"/);
  const buy = (await tools.execute('browser_act', { tabId: 5, steps: [{ action: 'click', ref: 3 }] }, sig)).output;
  assert.equal(asked[0].screenshot, 'data:image/jpeg;base64,SHOT', 'the user sees the screenshot');
  assert.ok(!JSON.stringify(buy).includes('SHOT'), 'the model never gets it');
  const look = (await tools.execute('browser_look', { tabId: 5 }, sig)).output;
  assert.equal(look.pageOf, 5, 'a look is always a full view');
});

test('the desktop app (native messaging) is an app origin that the user must still pair', async () => {
  const chrome = fakeChrome({ default: shop([]) });
  let prompted = null;
  const agent = createAgent(chrome, { openPairing: (origin, id) => { prompted = { origin, id }; }, settle: 0 });
  assert.ok(isAppOrigin('native:desktop'));
  assert.ok(!isAppOrigin('native:other'));
  await assert.rejects(agent.fromApp({ type: 'open', url: 'https://shop.example' }, 'native:desktop'), /Connect Synapse/);
  const pairing = agent.fromApp({ type: 'pair' }, 'native:desktop');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(prompted.origin, 'native:desktop');
  await agent.fromExtension({ type: 'pair-decision', id: prompted.id, allow: true });
  assert.deepEqual(await pairing, { paired: true });
  const page = await agent.fromApp({ type: 'open', url: 'https://shop.example/' }, 'native:desktop');
  assert.equal(page.site, 'shop.example');
});

test('manifest: fixed ID for the native host, optional native messaging and debugger', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const id = [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
  const hub = await readFile(new URL('../src-tauri/src/hub.rs', import.meta.url), 'utf8');
  assert.ok(hub.includes(`chrome-extension://${id}/`), `hub.rs must admit exactly this extension (${id})`);
  assert.deepEqual(manifest.optional_permissions.sort(), ['debugger', 'nativeMessaging']);
  assert.ok(!manifest.permissions.includes('nativeMessaging') && !manifest.permissions.includes('debugger'));
  assert.equal(manifest.version, (await import('../extension/agent-core.js')).VERSION);
});

test('timings: the extension reports where each request spent its time', async () => {
  let clock = 0;
  const chrome = fakeChrome({ default: (command, tab) => { clock += { snapshot: 30, inspect: 5, act: 10, settle: 200 }[command.op] || 0; return shop([])(command, tab) || { ok: true, value: { quiet: true } }; } });
  chrome.store.local.pairedOrigins = [APP];
  const agent = agentWith(chrome, { now: () => clock });
  const opened = await agent.fromApp({ type: 'open', url: 'https://shop.example/' }, APP);
  assert.equal(opened.timings.snapshot, 30); assert.equal(opened.timings.settle, 200);
  assert.ok(opened.timings.total >= 230, 'the total covers every phase');
  const acted = await agent.fromApp({ type: 'act', tabId: opened.tabId, steps: [{ action: 'click', ref: 1 }, { action: 'click', ref: 1 }] }, APP);
  assert.equal(acted.timings.inspect, 10, 'phases add up across the steps of one request');
  assert.equal(acted.timings.act, 20);
  assert.ok('inject' in acted.timings, 'injecting the page agent is measured on its own');
  const read = await agent.fromApp({ type: 'read', tabId: opened.tabId }, APP);
  assert.ok(read.timings.total >= 0);
});

test('timings: the toolset keeps them from the model and adds the approval wait', async () => {
  const base = { tabId: 5, site: 'shop.example', url: 'https://shop.example/', title: 'Shop', elements: ['[1] button "Buy"'], omitted: 0, text: 't' };
  const bridge = { call: async req => {
    if (req.type === 'act' && !req.confirmToken) return { ...base, done: [], stoppedAt: 0, needsConfirmation: { token: 'tok', step: 0, label: 'Click "Buy"', site: 'shop.example' }, timings: { inspect: 4, total: 9 } };
    return { ...base, ...(req.type === 'act' ? { done: ['Clicked'] } : {}), timings: { snapshot: 7, act: 3, inspect: 2, total: 20 } };
  } };
  const tools = browserToolset(bridge, { confirm: async () => true });
  const sig = new AbortController().signal;
  const open = await tools.execute('browser_open', { url: 'https://shop.example/' }, sig);
  assert.deepEqual(open.timings, { snapshot: 7, act: 3, inspect: 2, total: 20 });
  assert.ok(!JSON.stringify(open.output).includes('timings'), 'the model never sees timings');
  const act = await tools.execute('browser_act', { tabId: 5, steps: [{ action: 'click', ref: 1 }] }, sig);
  assert.equal(act.timings.inspect, 6, 'both rounds of a confirmed step are counted');
  assert.equal(act.timings.total, 29);
  assert.ok(act.timings.approval >= 0, 'the wait for the user is its own phase');
  assert.ok(!JSON.stringify(act.output).includes('timings'));
});

test('timings: the agent loop records a trace per round and on each live step', async () => {
  const replies = [
    reply(null, [call('browser_open', { url: 'https://shop.example/' })]),
    reply(null, [call('browser_act', { tabId: 5, steps: [{ action: 'scroll', direction: 'down' }] })]),
    reply('Scrolled the shop page.'),
  ];
  globalThis.fetch = async () => replies.shift();
  const external = browserToolset({ call: async req => ({ tabId: 5, site: 'shop.example', url: 'https://shop.example/', title: 'Shop', elements: ['[1] link "Deal"'], omitted: 0, text: 'x',
    ...(req.type === 'act' ? { done: ['Scrolled down'] } : {}), timings: { settle: 120, snapshot: 15, total: 140 } }) });
  delete globalThis.__synapseAgentTraces;
  const result = await AutonomousBrainAgent.execute('Look through shop.example deals', state(), 'k', 'm', { externalTools: external, commit: async () => {} });
  const { trace } = result;
  assert.ok(trace, 'a turn with live steps carries a trace');
  assert.equal(trace.summary.liveSteps, 2);
  assert.equal(trace.summary.phases.settle, 240);
  assert.equal(trace.summary.phases.total, undefined, 'per-step totals are not summed as a phase');
  assert.ok(trace.rounds.length >= 3, 'every model request is a round');
  assert.deepEqual(trace.rounds[0].tools.map(t => t.tool), ['browser_open']);
  assert.ok(trace.rounds[0].tools[0].chars > 0, 'the size of what the model received is recorded');
  const steps = result.activity.filter(s => s.kind === 'browser');
  assert.ok(steps.every(s => s.timing && s.timing.phases.settle === 120), 'each live step shows its timing');
  assert.equal(globalThis.__synapseAgentTraces.length, 1, 'the trace is kept in memory for export');
  globalThis.fetch = async () => reply('Hello!');
  const plain = await AutonomousBrainAgent.execute('hi', state(), 'k', 'm', {});
  assert.equal(plain.status, 'complete');
  assert.equal(plain.trace, undefined, 'turns without live tools carry no trace');
});

test('upload steps: the app hands the file over in pieces, and the page gets it whole', async () => {
  const log = [];
  const { agent } = await pairedAgent({ default: (command, tab) => {
    if (command.op === 'act' && command.step.action === 'upload') { log.push(command.step.payload); return { ok: true, value: `Attached "${command.step.payload.name}"` }; }
    return shop([])(command, tab);
  } });
  const { tabId } = await agent.fromApp({ type: 'open', url: 'https://jobs.example/' }, APP);
  await assert.rejects(agent.fromApp({ type: 'act', tabId, steps: [{ action: 'upload', ref: 1, file: 'resume-1' }] }, APP), /wasn't handed over/);
  await agent.fromApp({ type: 'stage_file', fileId: 'resume-1', name: 'cv.pdf', mime: 'application/pdf', index: 0, total: 2, data: 'JVBERi0x' }, APP);
  await assert.rejects(agent.fromApp({ type: 'act', tabId, steps: [{ action: 'upload', ref: 1, file: 'resume-1' }] }, APP), /wasn't handed over/, 'not until every piece is in');
  await agent.fromApp({ type: 'stage_file', fileId: 'resume-1', name: 'c/v.pdf', mime: 'application/pdf', index: 1, total: 2, data: 'LjQ=' }, APP);
  const out = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'upload', ref: 1, file: 'resume-1' }] }, APP);
  assert.deepEqual(out.done, ['Attached "cv.pdf"']);
  assert.deepEqual(log, [{ name: 'cv.pdf', mime: 'application/pdf', data: 'JVBERi0xLjQ=' }]);
  await assert.rejects(agent.fromApp({ type: 'stage_file', fileId: '../x', index: 0, total: 1, data: '' }, APP), /Bad file id/);
});

test('a failed step after others ran reports what ran; an open dropdown is closed and the step retried', async () => {
  let dismissed = 0, covered = true;
  const { agent } = await pairedAgent({ default: (command, tab) => {
    if (command.op === 'dismiss') { dismissed++; covered = false; return { ok: true, value: { dismissed: true } }; }
    if (command.op === 'act' && command.step.ref === 9) return { ok: false, error: 'Element 9 is no longer on the page.' };
    if (command.op === 'act' && command.step.ref === 5 && covered) return { ok: false, error: 'A dropdown list is still open over that element.', code: 'popup' };
    return shop([])(command, tab);
  } });
  const { tabId } = await agent.fromApp({ type: 'open', url: 'https://jobs.example/' }, APP);
  const retried = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'click', ref: 5 }] }, APP);
  assert.equal(dismissed, 1); assert.deepEqual(retried.done, ['did click 5']);
  const partial = await agent.fromApp({ type: 'act', tabId, steps: [{ action: 'type', ref: 1, text: 'Ada' }, { action: 'click', ref: 9 }, { action: 'click', ref: 1 }] }, APP);
  assert.deepEqual(partial.done, ['did type 1']); assert.equal(partial.stoppedAt, 1);
  assert.match(partial.stopReason, /Step 2 \(click\) failed: Element 9.*Steps before it ran/);
  await assert.rejects(agent.fromApp({ type: 'act', tabId, steps: [{ action: 'click', ref: 9 }] }, APP), /no longer on the page/, 'a first-step failure is an error');
  const many = Array.from({ length: 25 }, () => ({ action: 'scroll' }));
  assert.equal((await agent.fromApp({ type: 'act', tabId, steps: many }, APP)).done.length, 25);
  await assert.rejects(agent.fromApp({ type: 'act', tabId, steps: [...many, { action: 'scroll' }] }, APP), /At most 25/);
});

test('the toolset attaches a file without asking, staging it in pieces under the 1 MB link limit', async () => {
  const calls = [];
  const bridge = { call: async req => { calls.push(req); return req.type === 'stage_file' ? { staged: true } : { tabId: 5, site: 'jobs.example', url: 'https://jobs.example/apply', title: 'Apply', elements: [], omitted: 0, text: '', done: ['Attached "cv.pdf"'] }; } };
  const big = new Blob([new Uint8Array(900 * 1024).fill(65)], { type: 'application/pdf' });
  const files = { list: () => [], load: async id => ({ file: { id, name: 'cv.pdf', mime: 'application/pdf', size: big.size, kind: 'résumé' }, blob: big }) };
  const asked = [];
  const steps = [{ action: 'type', ref: 1, text: 'Ada' }, { action: 'upload', ref: 2, file: 'resume-1' }];
  const tools = browserToolset(bridge, { files, confirm: async req => { asked.push(req); return true; } });
  const { output } = await tools.execute('browser_act', { tabId: 5, steps }, new AbortController().signal);
  assert.equal(asked.length, 0, 'attaching does not ask; the final Submit does');
  const pieces = calls.filter(c => c.type === 'stage_file');
  assert.equal(pieces.length, 3); assert.ok(pieces.every(p => JSON.stringify(p).length < 1024 * 1024));
  assert.equal(atob(pieces.map(p => p.data).join('')).length, big.size);
  assert.deepEqual(output.done, ['Attached "cv.pdf"']);

  await assert.rejects(browserToolset(bridge, {}).execute('browser_act', { tabId: 5, steps: [steps[1]] }, new AbortController().signal), /isn't available/);
});

test('screenshots go to the model as an image beside the page, steps that did nothing are reported and their page is kept for a fixture', async () => {
  delete globalThis.__synapseAgentFailures;
  const base = { tabId: 5, site: 'shop.example', url: 'https://shop.example/', title: 'Shop', omitted: 0, text: 'Text', elements: ['[1] button "Load"'] };
  const calls = [];
  const bridge = { call: async req => {
    calls.push(req.type);
    if (req.type === 'screenshot') return { ...base, screenshot: 'data:image/jpeg;base64,PIXELS', shotSize: { width: 1280, height: 800 }, timings: { screenshot: 40 } };
    if (req.type === 'act') return { ...base, done: ['Clicked button "Load"'], noEffect: ['Step 1 (Clicked button "Load"): It changed nothing on the page.'] };
    if (req.type === 'capture') return { url: base.url, title: 'Shop', html: '<!doctype html><html><body><button>Load</button></body></html>', frames: [] };
    return { ...base };
  } };
  const tools = browserToolset(bridge, { confirm: async () => true });
  const sig = new AbortController().signal;
  const shot = await tools.execute('browser_screenshot', { tabId: 5 }, sig);
  assert.equal(shot.image.dataUrl, 'data:image/jpeg;base64,PIXELS');
  assert.ok(!JSON.stringify(shot.output).includes('PIXELS'), 'the image is not inside the JSON the model reads');
  assert.match(shot.output.screenshot, /1280×800/);
  assert.match(shot.output.elements, /\[1\] button "Load"/);
  const acted = (await tools.execute('browser_act', { tabId: 5, steps: [{ action: 'click', ref: 1 }] }, sig)).output;
  assert.match(acted.noEffect[0], /changed nothing/);
  assert.ok(calls.includes('capture'));
  const [failure] = globalThis.__synapseAgentFailures;
  assert.equal(failure.site, 'shop.example'); assert.match(failure.problem, /changed nothing/); assert.match(failure.html, /<button>Load/);
});

test('point steps and screenshots: the tools offer them, and a screenshot is a read', async () => {
  const { BROWSER_TOOLS } = await load('/src/services/browserAgent.ts');
  const { browserCallFloor } = await load('/src/services/riskTiers.ts');
  const step = BROWSER_TOOLS.find(t => t.function.name === 'browser_act').function.parameters.properties.steps.items.properties;
  assert.ok(step.x && step.y);
  assert.ok(BROWSER_TOOLS.some(t => t.function.name === 'browser_screenshot'));
  assert.equal(browserCallFloor('browser_screenshot'), 0);
});

test('captured failures become fixture pages with their frames beside them', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { writeFixtures } = await import('../scripts/agent-fixture.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'fixtures-'));
  try {
    const names = await writeFixtures([{ at: '2026-11-18T10:00:00Z', site: 'careers.example.com', url: 'https://careers.example.com/job', problem: 'It changed nothing on the page.', steps: [{ action: 'click', ref: 4 }],
      html: '<html><body><iframe src="https://boards.greenhouse.io/embed/job_app?for=x&amp;token=1"></iframe></body></html>',
      frames: [{ url: 'https://boards.greenhouse.io/embed/job_app?for=x&token=1', html: '<html><body><input id="first"></body></html>' }] }], { dir, list: join(dir, 'captured.json') });
    assert.deepEqual(names, ['careers-example-com-2026-11-18']);
    const page = await readFile(join(dir, `${names[0]}.html`), 'utf8');
    assert.match(page, /src="careers-example-com-2026-11-18-frame-1\.html"/, 'the frame points at its local copy');
    assert.match(await readFile(join(dir, `${names[0]}-frame-1.html`), 'utf8'), /id="first"/);
    const [task] = JSON.parse(await readFile(join(dir, 'captured.json'), 'utf8'));
    assert.equal(task.page, `captured/${names[0]}.html`); assert.deepEqual(task.view.has, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('opening a page that is already open goes back to that tab as it was, instead of loading a fresh copy', async () => {
  const log = [];
  const { chrome, agent } = await pairedAgent({ default: shop(log) });
  const first = await agent.fromApp({ type: 'open', url: 'https://shop.example/apply?ref=x' }, APP);
  const tabsBefore = chrome._tabs.size;
  const again = await agent.fromApp({ type: 'open', url: 'https://shop.example/apply?ref=x#form' }, APP);
  assert.equal(again.tabId, first.tabId); assert.equal(again.reused, true);
  assert.equal(chrome._tabs.size, tabsBefore, 'no new tab');
  const other = await agent.fromApp({ type: 'open', url: 'https://shop.example/other' }, APP);
  assert.notEqual(other.tabId, first.tabId);
  const reload = await agent.fromApp({ type: 'open', tabId: first.tabId, url: 'https://shop.example/apply?ref=x' }, APP);
  assert.equal(reload.reused, undefined, 'passing the tab reloads it on purpose');
});

test('the toolset tells the next message which tabs are still open, and says so when a page was reused', async () => {
  const bridge = { call: async req => {
    if (req.type === 'tabs') return { tabs: [{ tabId: 7, url: 'https://careers.example.com/apply', title: 'Apply now', site: 'careers.example.com' }] };
    if (req.type === 'open') return { tabId: 7, site: 'careers.example.com', url: 'https://careers.example.com/apply', title: 'Apply now', elements: [], omitted: 0, text: '', reused: true };
    return {};
  } };
  const tools = browserToolset(bridge);
  const sig = new AbortController().signal;
  assert.match(await tools.context(sig), /tab 7: Apply now — https:\/\/careers\.example\.com\/apply/);
  const opened = await tools.execute('browser_open', { url: 'https://careers.example.com/apply' }, sig);
  assert.match(opened.output.reused, /already open in tab 7/);
  assert.equal(opened.summary, 'Went back to careers.example.com');
  const empty = browserToolset({ call: async () => ({ tabs: [] }) });
  assert.equal(await empty.context(sig), '');
});

test('questions from the model are cleaned up before the chat shows them', async () => {
  const { questionRequest, answersOutput } = await load('/src/services/askUser.ts');
  const request = questionRequest({ context: '  For   your form ', questions: [{ question: 'Degree?', choices: ['BS', 'BS', 'MS'], multiple: true }, { question: 'Why?', choices: ['Only one'] }, { question: '  ' }] }, 'r1');
  assert.deepEqual(request, { id: 'r1', context: 'For your form', questions: [{ id: 'q1', question: 'Degree?', choices: ['BS', 'MS'], multiple: true }, { id: 'q2', question: 'Why?' }] });
  assert.throws(() => questionRequest({ questions: [] }), /at least one question/);
  assert.deepEqual(answersOutput(request, { q1: 'BS, MS' }).answers.map(a => a.answer), ['BS, MS', '(skipped: the user chose not to answer)']);
});

test('browser_open runs steps by name after loading, and falls back to the loaded page when they cannot start', async () => {
  const requests = [];
  const page = (extra = {}) => ({ tabId: 7, site: 'shop.example', url: 'https://shop.example/', title: 'Shop', omitted: 0, text: 'Hello', elements: ['[1] button "Accept"', '[2] button "Buy"'], ...extra });
  let failAct = false;
  const bridge = { call: async req => {
    requests.push(req);
    if (req.type === 'open') return page();
    if (req.type === 'act') { if (failAct) throw new Error('Nothing named "Reject" is on the page.'); return page({ done: ['Clicked "Accept"'], expect: { met: true }, elements: ['[2] button "Buy"'] }); }
    if (req.type === 'find') return { tabId: 7, url: 'https://shop.example/', query: req.query, elements: ['[9] link "Item 450 details"'], moreElements: 2, text: ['Item 450: a fine product'], moreText: 0 };
    throw new Error(req.type);
  } };
  const tools = browserToolset(bridge, { confirm: async () => true });
  const sig = new AbortController().signal;

  const opened = await tools.execute('browser_open', { url: 'https://shop.example/', steps: [{ action: 'click', target: { name: 'Accept' } }], expect: { text: 'Cart' } }, sig);
  const act = requests.find(r => r.type === 'act');
  assert.deepEqual(act.steps, [{ action: 'click', target: { name: 'Accept' } }]);
  assert.deepEqual(act.expect, { text: 'Cart' }, 'expect reaches the extension');
  assert.equal(opened.output.pageOf, 7, 'after open + steps the model gets a full view, not a diff');
  assert.deepEqual(opened.output.expect, { met: true });
  assert.match(opened.summary, /Opened shop\.example; Clicked "Accept"/);

  requests.length = 0;
  const byRef = await tools.execute('browser_open', { url: 'https://shop.example/', steps: [{ action: 'click', ref: 1 }] }, sig);
  assert.ok(!requests.some(r => r.type === 'act'), 'refs before a look are refused without running anything');
  assert.match(byRef.output.stepsNotRun, /target/);

  failAct = true;
  const missing = await tools.execute('browser_open', { url: 'https://shop.example/', steps: [{ action: 'click', target: { name: 'Reject' } }] }, sig);
  assert.match(missing.output.stepsNotRun, /Nothing named "Reject"/);
  assert.match(missing.output.elements, /button "Accept"/, 'the loaded page is still shown');

  const found = (await tools.execute('browser_find', { tabId: 7, query: 'Item 450' }, sig)).output;
  assert.equal(requests.at(-1).query, 'Item 450');
  assert.match(found.elements, /\[9\] link "Item 450 details"\n…2 more matches/);
  assert.match(found.text, /a fine product/);
  assert.ok(found.untrusted, 'page text found is marked as data');
});

test('browser call floors: find reads, open with steps counts its steps', async () => {
  const { browserCallFloor } = await load('/src/services/riskTiers.ts');
  assert.equal(browserCallFloor('browser_find'), 0);
  assert.equal(browserCallFloor('browser_open', { url: 'https://x' }), 1);
  assert.equal(browserCallFloor('browser_open', { url: 'https://x', steps: [{ action: 'upload', target: { name: 'Attach' } }] }), 1);
  assert.equal(browserCallFloor('browser_act', { steps: [{ action: 'wait', text: 'Done' }] }), 0);
});

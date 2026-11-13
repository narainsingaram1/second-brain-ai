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
  let nextTab = 100;
  const chrome = {
    store, tabs: {
      create: async ({ url }) => { const tab = { id: nextTab++, url, title: 'Page', status: 'complete' }; tabs.set(tab.id, tab); return { ...tab }; },
      update: async (id, { url }) => { const tab = tabs.get(id); tab.url = url; return { ...tab }; },
      get: async id => { const tab = tabs.get(id); if (!tab) throw new Error('No tab'); return { ...tab }; },
      remove: async id => { tabs.delete(id); },
      group: async () => 7,
    },
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
  assert.deepEqual(await agent.fromApp({ type: 'hello' }, APP), { version: '1.2.0', paired: false });
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
  assert.ok(!needsBrowser('what should I focus on today?'));
  assert.ok(!needsBrowser('move my essay to friday'));
  assert.equal(toolTier('browser_act'), 'browser');
  assert.equal(approvalReason('browser_act', { untrustedRead: true, changes: 9, askBeforeChanges: true }), null, 'the browser asks live, not through stored approvals');
});

const call = (name, args) => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (content, tool_calls) => Response.json({ choices: [{ finish_reason: tool_calls ? 'tool_calls' : 'stop', message: { content, tool_calls } }] });
const state = () => ({ userId: 'u', tasks: [{ id: 'essay', title: 'Write essay', status: 'not_started', completed: false, priority: 'medium', section: 'Academic', dueDate: '2026-11-20' }],
  goals: [], habits: [], journalEntries: [], knowledgeItems: [], trackerItems: [], sections: ['Academic'], subsections: { Academic: ['General'] }, noteFolders: [], chatHistory: [], openRouterKey: 'k', selectedModel: 'm', theme: 'light' });

test('the agent loop: browser steps always run, old page views are compacted, and later record edits are gated', async () => {
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
  assert.ok(tools[0].superseded && tools[1].superseded, 'older views of the tab were compacted');
  assert.match(tools[2].elements, /Deal 2/);
  assert.match(proposals[0].reason, /web page/, 'changing records after browsing needs approval');
  assert.ok(result.activity.some(s => s.kind === 'browser' && /Opened shop\.example/.test(s.label)));
  assert.ok(!requests[0].messages[0].content.some?.(p => /cannot click/.test(p.text)) && !String(JSON.stringify(requests[0].messages[0])).includes('you cannot click'), 'the "no browser" note is left out when the browser is available');
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
});

// The real extension core (extension/agent-core.js) and page agent in a real Chrome, on pages whose form sits in
// a cross-origin frame, like a job posting with an embedded Greenhouse application. The agent must see the
// frame's fields, act in them, keep its safety rules there, and wait for a frame that loads after a tab switch.
// Skipped where Chrome isn't installed (set CHROME_PATH to point at one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromeAvailable, launch, serve } from '../scripts/agent-bench.mjs';
import { createAgent } from '../extension/agent-core.js';

const APP = 'http://localhost:5173';
const agentSource = await readFile(new URL('../extension/page-agent.js', import.meta.url), 'utf8');

/** Enough of the extension API, over the DevTools protocol, for one tab. Frame ids: 0 is the page. */
async function cdpChrome(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Page.enable'); await send('Runtime.enable');
  const ids = new Map(); // CDP frame id -> number
  let nextId = 1;
  const worlds = new Map(); // CDP frame id -> isolated world context
  const evalIn = async (expression, contextId) => {
    const r = await send('Runtime.evaluate', { expression, ...(contextId ? { contextId } : {}), awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  async function frames() {
    const { frameTree } = await send('Page.getFrameTree');
    const list = [];
    const visit = (node, top) => {
      if (!ids.has(node.frame.id)) ids.set(node.frame.id, top ? 0 : nextId++);
      list.push({ cdpId: node.frame.id, frameId: ids.get(node.frame.id), url: node.frame.url });
      for (const child of node.childFrames || []) visit(child, false);
    };
    visit(frameTree, true);
    return list;
  }
  async function inWorld(frame, expression) {
    for (let attempt = 0; ; attempt++) {
      try {
        if (!worlds.has(frame.cdpId)) worlds.set(frame.cdpId, (await send('Page.createIsolatedWorld', { frameId: frame.cdpId, worldName: 'synapse-agent' })).executionContextId);
        return await evalIn(expression, worlds.get(frame.cdpId));
      } catch (error) {
        if (attempt === 0 && /context|Cannot find|destroyed/i.test(error.message)) { worlds.delete(frame.cdpId); continue; }
        throw error;
      }
    }
  }
  const store = { local: { pairedOrigins: [APP] }, session: {} };
  const area = name => ({ get: async key => ({ [key]: store[name][key] }), set: async values => { Object.assign(store[name], values); } });
  const TAB = 1;
  const tabInfo = async () => ({ id: TAB, url: await evalIn('location.href'), title: await evalIn('document.title'), status: (await evalIn('document.readyState')) === 'complete' ? 'complete' : 'loading' });
  const navigate = async url => { worlds.clear(); await send('Page.navigate', { url }); };
  const chrome = {
    tabs: {
      create: async ({ url }) => { await navigate(url); return { id: TAB, url, status: 'loading' }; },
      update: async (_id, { url }) => { await navigate(url); return { id: TAB, url, status: 'loading' }; },
      get: async () => tabInfo(),
      remove: async () => {}, group: async () => 1, query: async () => [await tabInfo()],
    },
    tabGroups: { get: async () => ({}), update: async () => ({}) },
    storage: { local: area('local'), session: area('session') },
    scripting: {
      async executeScript({ target, files, func, args }) {
        const all = await frames();
        const chosen = target.allFrames ? all : target.frameIds ? all.filter(f => target.frameIds.includes(f.frameId)) : all.filter(f => f.frameId === 0);
        if (target.frameIds && !chosen.length) throw new Error(`No frame with id ${target.frameIds[0]}.`);
        const out = [];
        for (const frame of chosen) {
          if (!/^https?:/.test(frame.url)) continue; // Like Chrome: nothing is injected into about:blank here.
          if (files) { await inWorld(frame, agentSource); out.push({ frameId: frame.frameId }); continue; }
          out.push({ frameId: frame.frameId, result: await inWorld(frame, `(${func})(${JSON.stringify(args[0])})`) });
        }
        return out;
      },
    },
  };
  return { chrome, evalIn, frames, close: () => cdp.send('Target.closeTarget', { targetId }) };
}

const refOf = (page, re) => { const line = page.elements.find(l => re.test(l)); const m = line && /^\[(\d+)\]/.exec(line); return m ? Number(m[1]) : null; };

test('cross-origin frames: the embedded form is seen, filled and kept safe', { skip: !chromeAvailable() && 'Chrome not installed', timeout: 90_000 }, async () => {
  const server = await serve();
  // One renderer for both origins, so the test can reach the frame the way the extension's allFrames does.
  const cdp = await launch(['--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process']);
  const base = `http://localhost:${server.address().port}`;
  try {
    const tab = await cdpChrome(cdp);
    let n = 0;
    const agent = createAgent(tab.chrome, { openPairing: () => {}, random: () => `token-${++n}`, cdp: { ready: async () => false, detach: async () => {}, detachAll: async () => {} } });

    // A frame on the page from the start.
    let page = await agent.fromApp({ type: 'open', url: `${base}/fixtures/iframe-form.html` }, APP);
    const city = refOf(page, /textbox "Partner city"/);
    assert.ok(city > 100000, `the partner frame's field is listed with a frame ref: ${page.elements.join('\n')}`);
    assert.ok(refOf(page, /textbox "Home city"/) < 100000, 'the same-origin frame stays part of the page');
    assert.ok(page.elements.some(l => /^\(inside an embedded frame from 127\.0\.0\.1\)$/.test(l)), 'the frame is labelled');
    assert.ok(page.elements.some(l => /textbox "Password" user-only/.test(l) && /^\[1\d{5}\]/.test(l)), 'a password in the frame is still user-only');

    page = await agent.fromApp({ type: 'act', tabId: 1, steps: [{ action: 'type', ref: city, text: 'Rome' }, { action: 'click', ref: refOf(page, /button "Partner next"/) }] }, APP);
    assert.equal(page.done?.length, 2, JSON.stringify(page.stopped || page.done));
    assert.match(page.text, /City: Rome/, 'the frame reacted, and its text is in the view');

    const send = refOf(page, /^\[1\d{5}\] button "Send message"/);
    assert.ok(send > 100000);
    const paused = await agent.fromApp({ type: 'act', tabId: 1, steps: [{ action: 'click', ref: send }] }, APP);
    assert.ok(paused.needsConfirmation, 'a consequential click inside a frame still waits for the user');
    const blocked = await agent.fromApp({ type: 'act', tabId: 1, steps: [{ action: 'type', ref: refOf(page, /^\[1\d{5}\] textbox "Password"/), text: 'x' }] }, APP);
    assert.ok(blocked.blocked, 'typing a password inside a frame is refused');

    // A Greenhouse-style embed that loads only after its tab is opened.
    page = await agent.fromApp({ type: 'open', tabId: 1, url: `${base}/fixtures/embedded-application.html` }, APP);
    assert.equal(refOf(page, /textbox "First name"/), null, 'nothing from the form before its tab opens');
    page = await agent.fromApp({ type: 'act', tabId: 1, steps: [{ action: 'click', ref: refOf(page, /tab "Application"/) }] }, APP);
    const first = refOf(page, /textbox "First name"/);
    assert.ok(first > 100000, `the embedded application shows up once it loads: ${page.elements.join('\n')}`);
    page = await agent.fromApp({ type: 'act', tabId: 1, steps: [
      { action: 'type', ref: first, text: 'Ada' },
      { action: 'select', ref: refOf(page, /combobox "School"/), value: 'Georgia Tech' },
    ] }, APP);
    assert.equal(page.done.length, 2, JSON.stringify(page));
    const frame = (await tab.frames()).find(f => f.frameId !== 0);
    assert.ok(frame, 'the embed is loaded');
  } finally {
    await cdp.close();
    server.close();
  }
});

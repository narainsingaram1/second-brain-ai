// The real extension core (extension/agent-core.js) and page agent in a real Chrome, on pages whose form sits in
// a cross-origin frame, like a job posting with an embedded Greenhouse application. The agent must see the
// frame's fields, act in them, keep its safety rules there, and wait for a frame that loads after a tab switch.
// Skipped where Chrome isn't installed (set CHROME_PATH to point at one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromeAvailable, launch, serve } from '../scripts/agent-bench.mjs';
import { cdpChrome as chromeFor, realInput, APP } from '../scripts/agent-chrome.mjs';
import { createAgent } from '../extension/agent-core.js';

const agentSource = await readFile(new URL('../extension/page-agent.js', import.meta.url), 'utf8');
const cdpChrome = cdp => chromeFor(cdp, agentSource);

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

test('any site: script-made clickables, canvases by point, and a step that did nothing is retried with real input', { skip: !chromeAvailable() && 'Chrome not installed', timeout: 90_000 }, async () => {
  const server = await serve();
  const cdp = await launch(['--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process']);
  const base = `http://localhost:${server.address().port}`;
  try {
    const tab = await cdpChrome(cdp);
    const make = ready => createAgent(tab.chrome, { openPairing: () => {}, random: () => 'token', cdp: realInput(tab.send, ready) });

    // Without real input: the clickable card is found and works; the button that ignores scripted clicks is
    // reported as having done nothing, instead of passing silently.
    let agent = make(async () => false);
    let page = await agent.fromApp({ type: 'open', url: `${base}/fixtures/widgets.html` }, APP);
    const card = refOf(page, /clickable "Basic plan/);
    assert.ok(card, `a div made clickable by a script is listed: ${page.elements.join('\n')}`);
    assert.equal(page.elements.filter(l => /Basic plan/.test(l)).length, 1, 'its text inside is not listed again');
    page = await agent.fromApp({ type: 'act', tabId: 1, steps: [{ action: 'click', ref: card }] }, APP);
    assert.match(page.text, /Chose basic/);
    assert.equal(page.noEffect, undefined, 'a click that worked is not reported');
    page = await agent.fromApp({ type: 'act', tabId: 1, steps: [{ action: 'click', ref: refOf(page, /button "Load details"/) }] }, APP);
    assert.ok(!/Details loaded/.test(page.text));
    assert.match(page.noEffect?.[0] || '', /changed nothing/, 'a click with no effect is reported');
    await assert.rejects(agent.fromApp({ type: 'screenshot', tabId: 1 }, APP), /real input/, 'no screenshot without the debugger, with a way forward');

    // Real input that only becomes available on the retry: ordinary input did nothing, real input works.
    let calls = 0;
    agent = make(async () => calls++ % 2 === 1);
    page = await agent.fromApp({ type: 'open', tabId: 1, url: `${base}/fixtures/widgets.html` }, APP);
    calls = 0;
    page = await agent.fromApp({ type: 'act', tabId: 1, steps: [{ action: 'click', ref: refOf(page, /button "Load details"/) }] }, APP);
    assert.match(page.text, /Details loaded/);
    assert.match(page.done[0], /with real input/);
    assert.equal(page.noEffect, undefined);

    // Screenshots and points: a seat on a canvas has no element; it is clicked by its place on the screenshot.
    agent = make(async () => true);
    const shot = await agent.fromApp({ type: 'screenshot', tabId: 1 }, APP);
    assert.match(shot.screenshot, /^data:image\/jpeg;base64,/);
    assert.ok(shot.shotSize.width > 0 && shot.elements.length);
    const rect = await tab.evalIn("JSON.stringify(document.getElementById('seats').getBoundingClientRect())").then(JSON.parse);
    page = await agent.fromApp({ type: 'act', tabId: 1, steps: [{ action: 'click', x: rect.left + 150, y: rect.top + 50 }] }, APP);
    assert.match(page.text, /Seat B/, JSON.stringify(page.done));
    await tab.evalIn("document.body.style.minHeight = '3000px'; scrollBy(0, 40)");
    await assert.rejects(agent.fromApp({ type: 'act', tabId: 1, steps: [{ action: 'click', x: 10, y: 10 }] }, APP), /moved since your last screenshot/, 'stale points are refused');

    // A point inside a cross-origin frame: found in that frame, clicked with real input at the exact spot.
    page = await agent.fromApp({ type: 'open', tabId: 1, url: `${base}/fixtures/iframe-form.html` }, APP);
    await agent.fromApp({ type: 'screenshot', tabId: 1 }, APP);
    const frame = await tab.evalIn("JSON.stringify(document.getElementById('cross').getBoundingClientRect())").then(JSON.parse);
    // Type into the partner city by point (the field is first in the frame's form), then press its button by ref.
    const fieldAt = { x: frame.left + 120, y: frame.top + 18 };
    page = await agent.fromApp({ type: 'act', tabId: 1, steps: [{ action: 'type', x: fieldAt.x, y: fieldAt.y, text: 'Oslo' }] }, APP);
    assert.match(page.done[0], /Partner city/, JSON.stringify(page));
    page = await agent.fromApp({ type: 'act', tabId: 1, steps: [{ action: 'click', ref: refOf(page, /button "Partner next"/) }] }, APP);
    assert.match(page.text, /City: Oslo/);
  } finally {
    await cdp.close();
    server.close();
  }
});

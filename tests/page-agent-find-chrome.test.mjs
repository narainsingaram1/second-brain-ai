// Fewer model rounds per task: the real extension core (extension/agent-core.js) and page agent in a real Chrome
// find things anywhere on a page, act on elements by name, wait for something to load in the middle of a call,
// and check the outcome, all without another look. Skipped where Chrome isn't installed (set CHROME_PATH).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromeAvailable, launch, serve } from '../scripts/agent-bench.mjs';
import { cdpChrome, APP } from '../scripts/agent-chrome.mjs';
import { createAgent } from '../extension/agent-core.js';

const agentSource = await readFile(new URL('../extension/page-agent.js', import.meta.url), 'utf8');
const refOf = (lines, re) => { const line = lines.find(l => re.test(l)); const m = line && /^\[(\d+)\]/.exec(line); return m ? Number(m[1]) : null; };

test('find, act by name, wait and expect on real pages', { skip: !chromeAvailable() && 'Chrome not installed', timeout: 90_000 }, async () => {
  const server = await serve();
  const cdp = await launch(['--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process']);
  const base = `http://localhost:${server.address().port}`;
  try {
    const tab = await cdpChrome(cdp, agentSource);
    const agent = createAgent(tab.chrome, { openPairing: () => {}, random: () => 'token', cdp: { ready: async () => false, detach: async () => {}, detachAll: async () => {} } });
    const call = request => agent.fromApp(request, APP);

    // A 600-card catalog: the item is far past what a look lists, and one find reaches it.
    let page = await call({ type: 'open', url: `${base}/fixtures/big-page.html` });
    assert.ok(!page.elements.some(l => /Item 450 details/.test(l)), 'a look does not reach item 450');
    const found = await call({ type: 'find', tabId: 1, query: 'Item 450 details' });
    assert.match(found.elements[0], /link "Item 450 details"/, found.elements.join('\n'));
    assert.ok(!/offscreen/.test(found.elements[0]), 'the best match is scrolled into view');
    page = await call({ type: 'act', tabId: 1, steps: [{ action: 'click', ref: refOf(found.elements, /Item 450 details/) }], expect: { text: 'Picked #item-450' } });
    assert.deepEqual(page.expect, { met: true });
    assert.equal(await tab.evalIn("document.getElementById('picked').textContent"), 'Picked #item-450');

    // Text in a long article: the line that says it, without reading chunk by chunk.
    await call({ type: 'open', tabId: 1, url: `${base}/fixtures/long-article.html` });
    const answer = await call({ type: 'find', tabId: 1, query: 'the answer is' });
    assert.match(answer.text.join('\n'), /the answer is 42/);

    // Load more, wait for the new item, and click it by name: one call where it took three rounds.
    await call({ type: 'open', tabId: 1, url: `${base}/fixtures/late-load.html` });
    page = await call({ type: 'act', tabId: 1, steps: [
      { action: 'click', target: { name: 'Load more' } },
      { action: 'wait', text: 'Item 21' },
      { action: 'click', target: { name: 'Item 21', role: 'button' } },
    ], expect: { text: 'Picked Item 21' } });
    assert.equal(page.done.length, 3, JSON.stringify(page.stopped || page.done));
    assert.deepEqual(page.expect, { met: true });

    // An expectation that doesn't hold is reported with what is missing, quickly.
    page = await call({ type: 'act', tabId: 1, steps: [{ action: 'scroll', direction: 'top' }], expect: { text: 'Picked Item 99', ms: 300 } });
    assert.equal(page.expect.met, false);
    assert.match(page.expect.missing, /Picked Item 99/);

    // A wait that never comes true stops the steps after it, and says why.
    page = await call({ type: 'act', tabId: 1, steps: [{ action: 'wait', text: 'Item 999', ms: 300 }, { action: 'click', target: { name: 'Item 1', role: 'button' } }] });
    assert.match(page.stopped || page.stopReason || '', /timed out/);
    assert.equal(page.done.length, 0);

    // Names that match more than one element, or none, fail with the candidates rather than a guess.
    await assert.rejects(call({ type: 'act', tabId: 1, steps: [{ action: 'click', target: { name: 'Item' } }] }), /\d+ elements match "Item": \[\d+\] button/);
    page = await call({ type: 'act', tabId: 1, steps: [{ action: 'click', target: { name: 'Item 2' } }], expect: { text: 'Picked Item 2' } });
    assert.deepEqual(page.expect, { met: true }, 'an exact name wins over names that only contain it (Item 20…)');
    await assert.rejects(call({ type: 'act', tabId: 1, steps: [{ action: 'click', target: { name: 'Checkout now' } }] }), /Nothing named "Checkout now"/);

    // Safety still applies to steps by name: the card field is refused and placing the order asks first.
    await call({ type: 'open', tabId: 1, url: `${base}/fixtures/checkout.html` });
    page = await call({ type: 'act', tabId: 1, steps: [{ action: 'type', target: { name: 'Card number' }, text: '4242424242424242' }] });
    assert.ok(page.blocked, 'a card number named by target is still user-only');
    page = await call({ type: 'act', tabId: 1, steps: [{ action: 'click', target: { name: 'Place order' } }] });
    assert.ok(page.needsConfirmation, 'a consequential click named by target still waits for the user');
    assert.equal(await tab.evalIn("document.getElementById('out').textContent"), '');

    // Inside a cross-origin frame: find and targets reach it too.
    await call({ type: 'open', tabId: 1, url: `${base}/fixtures/iframe-form.html` });
    const inFrame = await call({ type: 'find', tabId: 1, query: 'Partner city' });
    assert.ok(refOf(inFrame.elements, /textbox "Partner city"/) > 100000, inFrame.elements.join('\n'));
    page = await call({ type: 'act', tabId: 1, steps: [{ action: 'type', target: { name: 'Partner city' }, text: 'Rome' }, { action: 'click', target: { name: 'Partner next' } }], expect: { text: 'City: Rome' } });
    assert.deepEqual(page.expect, { met: true }, JSON.stringify(page.stopped || page.done));
  } finally {
    await cdp.close();
    server.close();
  }
});

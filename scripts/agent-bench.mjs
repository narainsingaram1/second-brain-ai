#!/usr/bin/env node
// Replay benchmark for the browser agent's page layer (extension/page-agent.js).
//
// Drives headless Chrome over the DevTools protocol through the same sequence the extension uses for each
// step (inject → inspect → act → pause → settle → load wait → snapshot), on the fixture pages in
// bench/agent/fixtures, with scripted "model" decisions. It measures where the time goes, how big each view of
// the page is (what the model would read), how many model rounds a task takes, and which tasks fail.
//
//   npm run bench:agent                          ordinary (synthetic) input, 3 runs
//   npm run bench:agent -- --precise             trusted input through CDP, like the extension's precise mode
//   npm run bench:agent -- --runs 5 --only search,modal --out bench/agent/results/mine.json
//
// Needs Google Chrome or Chromium (set CHROME_PATH to override). Nothing leaves this machine: the pages are
// served from 127.0.0.1/localhost and Chrome runs with a throwaway profile.
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "bench/agent/fixtures");
const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const PRECISE = flag("precise");
const RUNS = Math.max(1, Number(option("runs", "3")) || 3);
const ONLY = option("only", "").split(",").filter(Boolean);
const OUT = option("out", "");
const SETTLE_PAUSE = 60; // agent-core's default `settle`
const LOAD_TIMEOUT = 20_000;
const MAX_ROUNDS = 20;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => performance.now();

// ---- Fixture server (two origins: localhost and 127.0.0.1 on one port, for the cross-origin frame) ----

function generated(name) {
  if (name === "long-article.html") {
    const words = "agent browser latency token cache snapshot runtime driver model planner executor approval network idle frame layout render".split(" ");
    let seed = 7;
    const pick = () => words[(seed = (seed * 1103515245 + 12345) % 2147483648) % words.length];
    const paras = Array.from({ length: 220 }, () => `<p>${Array.from({ length: 45 }, pick).join(" ")}.</p>`).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><title>A long article</title></head><body><nav><a href="#">Home</a></nav><main><article><h1>A long article</h1>${paras}<p id="end">THE END: the answer is 42.</p></article></main></body></html>`;
  }
  if (name === "big-page.html") {
    const cards = Array.from({ length: 600 }, (_, k) => { const i = k + 1; return `<div class="card"><h3>Item ${i}</h3><p>Description for item ${i}, a fine product.</p><a href="#item-${i}">Item ${i} details</a> <button>Compare</button> <button>Save</button></div>`; }).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><title>Catalog</title></head><body><main><h1>Catalog</h1><p id="picked"></p>${cards}</main><script>addEventListener("hashchange",()=>{document.getElementById("picked").textContent="Picked "+location.hash})</script></body></html>`;
  }
  return null;
}

export function serve() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const name = path.basename(url.pathname);
    try {
      const body = url.pathname.startsWith("/fixtures/") ? (generated(name) ?? await readFile(path.join(FIXTURES, name), "utf8")) : null;
      if (body === null) { res.writeHead(404).end(); return; }
      if (url.searchParams.has("slow")) await sleep(700); // A frame that loads after the page has settled.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ---- Chrome over the DevTools protocol ----

function chromePath() {
  const candidates = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  return candidates.find(p => existsSync(p));
}

/** @param extraArgs more Chrome flags (the frame test keeps cross-origin frames in one process so it can reach them). */
export async function launch(extraArgs = []) {
  const exe = chromePath();
  if (!exe) throw new Error("Chrome not found. Install Google Chrome or set CHROME_PATH.");
  const profile = await mkdtemp(path.join(tmpdir(), "synapse-bench-"));
  const proc = spawn(exe, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--window-size=1280,900", "--host-resolver-rules=MAP localhost 127.0.0.1", ...extraArgs, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Chrome didn't start in time.")), 15_000);
    proc.stderr.on("data", chunk => { buffer += chunk; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffer); if (m) { clearTimeout(timer); resolve(m[1]); } });
    proc.on("exit", code => reject(new Error(`Chrome exited (${code}).`)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
    else if (msg.method) for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const close = async () => { try { ws.close(); } catch { /* Gone. */ } proc.kill("SIGTERM"); await sleep(200); await rm(profile, { recursive: true, force: true }).catch(() => {}); };
  return { send, listeners, close, version: (await send("Browser.getVersion")).product };
}

// ---- One tab, run the way agent-core runs it ----

export async function openTab(cdp, agentSource, usePrecise) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send("Page.enable"); await send("Runtime.enable");
  let world = null;
  const phases = {};
  const time = async (phase, work) => { const t = now(); try { return await work(); } finally { phases[phase] = (phases[phase] || 0) + (now() - t); } };

  const evalIn = async (expression, contextId) => {
    const r = await send("Runtime.evaluate", { expression, ...(contextId ? { contextId } : {}), awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  async function ensureWorld() {
    if (world) return world;
    const { frameTree } = await send("Page.getFrameTree");
    ({ executionContextId: world } = await send("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "synapse-agent" }));
    return world;
  }
  /** chrome.scripting.executeScript(files) then (func): two round trips, as in agent-core's run(). */
  async function run(command) {
    for (let attempt = 0; ; attempt++) {
      try {
        const ctx = await ensureWorld();
        await time("inject", () => evalIn(agentSource, ctx));
        const value = await time(command.op, () => evalIn(`globalThis.__synapseAgent.run(${JSON.stringify(command)})`, ctx));
        if (!value) throw new Error("The page didn't respond.");
        if (!value.ok) throw Object.assign(new Error(value.error), { code: value.code });
        return value.value;
      } catch (error) {
        if (attempt === 0 && /context|Cannot find|destroyed/i.test(error.message)) { world = null; continue; }
        throw error;
      }
    }
  }
  const status = () => evalIn("document.readyState");
  async function waitForLoad() {
    const start = now();
    for (;;) {
      if ((await status()) === "complete") return;
      if (now() - start > LOAD_TIMEOUT) return;
      await sleep(150);
    }
  }
  const quiet = async () => { try { return await run({ op: "settle" }); } catch { return { navigating: true }; } };
  async function afterAction() {
    await time("pause", () => sleep(SETTLE_PAUSE));
    const first = await quiet();
    await time("load", waitForLoad);
    if (first?.navigating) { world = null; await time("load", waitForLoad); await quiet(); }
  }
  async function navigate(url) {
    await send("Page.navigate", { url });
    world = null;
    await time("pause", () => sleep(SETTLE_PAUSE));
    await time("load", waitForLoad);
    await quiet();
  }
  // Trusted input, like cdp.js in precise mode.
  const KEYS = { Enter: { code: "Enter", keyCode: 13, text: "\r" }, Escape: { code: "Escape", keyCode: 27 }, Tab: { code: "Tab", keyCode: 9 } };
  async function key(name) {
    const k = KEYS[name]; const base = { key: name, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
    await send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
  async function precise(step) {
    if (step.action === "click") {
      const at = await run({ op: "point", ref: step.ref });
      await time("input", async () => {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
      });
      return true;
    }
    if (step.action === "type") {
      await run({ op: "focus", ref: step.ref, append: !!step.append });
      await time("input", async () => { if (step.text) await send("Input.insertText", { text: step.text }); if (step.submit) await key("Enter"); });
      return true;
    }
    return false;
  }
  return {
    phases, run, navigate, afterAction, evalMain: expr => evalIn(expr), evalWorld: async expr => evalIn(expr, await ensureWorld()),
    snapshot: () => run({ op: "snapshot" }),
    async step(step) { if (!(usePrecise && await precise(step))) await run({ op: "act", step }); },
    close: () => cdp.send("Target.closeTarget", { targetId }),
  };
}

// ---- Tasks: what a model would do on each page, scripted ----
// A batch is one browser_act call (one model round). `find` picks the element line in the latest view; when no
// line matches, the scripted model looks again (another round), or scrolls when `scrollToFind` is set.

const TASKS = [
  { name: "search", page: "search.html", about: "Search, wait for slow results, add one to the cart",
    batches: [[{ action: "type", find: /searchbox "Search products"/, text: "usb hub", submit: true }], [{ action: "click", find: /"Add Anker 7-in-1 USB-C Hub to cart"/ }]],
    check: "document.getElementById('cart').textContent === 'Cart (1)'" },
  { name: "react-form", page: "react-form.html", about: "Fill a controlled form that re-renders on every keystroke, then save",
    batches: [[{ action: "type", find: /textbox "Full name"/, text: "Ada Lovelace" }, { action: "type", find: /textbox "Email"/, text: "ada@example.com" },
      { action: "select", find: /combobox "Country/, value: "GB" }, { action: "check", find: /checkbox "I accept/ }, { action: "click", find: /button "Save profile"/ }]],
    check: "document.getElementById('out').textContent === 'Saved Ada Lovelace | ada@example.com | GB | terms=true'",
    // A select is named by its label alone, and ticking a box never asks for approval.
    view: { has: [/combobox "Country" selected="US"/], lacks: [/checkbox[^\n]*needs-confirmation/] } },
  { name: "cookie-banner", page: "cookie-banner.html", about: "A cookie banner covers the button the task needs",
    batches: [[{ action: "click", find: /button "Show report"/ }]], recover: { error: /covering/, batches: [[{ action: "click", find: /button "Reject non-essential"/ }], [{ action: "click", find: /button "Show report"/ }]] },
    check: "document.getElementById('report').textContent === 'Revenue grew 12%.'" },
  { name: "modal", page: "modal.html", about: "Open a dialog, type into it, confirm",
    batches: [[{ action: "click", find: /button "Rename"/ }], [{ action: "type", find: /textbox "New name"/, text: "Q4 launch" }, { action: "click", find: /button "Done"/ }]],
    check: "document.getElementById('name').textContent === 'Q4 launch'" },
  { name: "long-article", page: "long-article.html", about: "Read a long article to the end in chunks", read: true,
    check: null },
  { name: "big-page", page: "big-page.html", about: "Find an item far down a 600-card catalog by scrolling", scrollToFind: true, maxRounds: 90,
    batches: [[{ action: "click", find: /link "Item 450 details"/ }]],
    check: "document.getElementById('picked').textContent === 'Picked #item-450'" },
  { name: "iframe-same", page: "iframe-form.html", about: "Fill a form inside a same-origin frame",
    batches: [[{ action: "type", find: /textbox "Home city"/, text: "Paris" }, { action: "click", find: /button "Next"/ }]],
    check: "document.getElementById('same').contentDocument.getElementById('out').textContent === 'City: Paris'" },
  { name: "iframe-secret", page: "iframe-form.html", about: "Inside a same-origin frame, a password stays user-only and Enter on a focused Send asks first",
    batches: [[{ action: "type", find: /textbox "Password"/, text: "hunter2", expectUserOnly: true }],
      [{ action: "press", key: "Enter", before: "document.getElementById('same').contentDocument.getElementById('send').focus()" }]],
    check: "document.getElementById('same').contentDocument.getElementById('pw').value === ''", expect: { confirmations: 1, userOnly: 1 },
    view: { has: [/textbox "Password" user-only/, /button "Send message" needs-confirmation/] } },
  { name: "iframe-cross", page: "iframe-form.html", about: "Fill a form inside a cross-origin frame", knownGap: "This replay drives only the top frame; agent-core reads cross-origin frames separately (tests/page-agent-frames-chrome.test.mjs)",
    batches: [[{ action: "type", find: /textbox "Partner city"/, text: "Rome" }]], check: null },
  { name: "late-load", page: "late-load.html", about: "Load more, then pick an item that arrives after a 1.5 s CSS-only spinner",
    batches: [[{ action: "click", find: /button "Load more"/ }], [{ action: "click", find: /button "Item 21"/ }]],
    check: "document.getElementById('picked').textContent === 'Picked Item 21'" },
  { name: "checkout", page: "checkout.html", about: "Notes are typed, the card field is refused, the order needs the user's go-ahead",
    batches: [[{ action: "type", find: /textbox "Delivery notes"/, text: "Leave at the door" }, { action: "type", find: /textbox "Card number"/, text: "4242 4242 4242 4242", expectUserOnly: true }],
      [{ action: "click", find: /button "Place order"/ }]],
    check: "document.getElementById('out').textContent === 'Order placed'", expect: { confirmations: 1, userOnly: 1 } },
  { name: "flyout-dialog", page: "flyout-dialog.html", about: "An empty, 1px-wide open role=dialog (like Amazon's cart flyout) must not hide the page",
    batches: [[{ action: "click", find: /button "Add Aluminium laptop stand to cart"/ }]],
    check: "document.getElementById('cart').textContent === 'Cart (1)'",
    view: { has: [/button "Add Aluminium laptop stand to cart"/, /searchbox "Search"/] } },
  { name: "consent-dialog", page: "consent-dialog.html", about: "A real cookie dialog on top of the page takes over the view until it is dismissed",
    batches: [[{ action: "click", find: /button "Necessary cookies only"/ }], [{ action: "click", find: /button "Ask question"/ }]],
    check: "document.getElementById('out').textContent === 'Asking'",
    view: { has: [/button "Necessary cookies only"/], lacks: [/button "Ask question"/] } },
  { name: "job-form", page: "job-form.html", about: "A job application: search-as-you-type school, button dropdown, résumé behind an Attach button",
    batches: [[{ action: "type", find: /textbox "First name"/, text: "Ada" }, { action: "select", find: /combobox "School"/, value: "Georgia Tech" },
      { action: "select", find: /combobox "Degree"/, value: "Bachelor's Degree" },
      { action: "upload", find: /button "Attach"/, payload: { name: "resume.pdf", mime: "application/pdf", data: "JVBERi0xLjQgdGVzdA==" } }]],
    check: "document.getElementById('out').textContent === \"Ada | School: Georgia Institute of Technology | Bachelor's Degree | resume.pdf (application/pdf, %PDF-1.4)\"",
    view: { has: [/file-upload "Resume\/CV" accepts=".pdf,.docx"/] } },
  { name: "open-dropdown", page: "job-form.html", about: "A dropdown list left open over the next field is closed, not reported as a blocker",
    batches: [[{ action: "click", find: /combobox "School"/ }, { action: "click", find: /combobox "Degree"/ }]],
    check: "document.getElementById('degree').getAttribute('aria-expanded') === 'true' && document.getElementById('school-list').hidden" },
];

const refOf = (page, find) => { const line = page.elements.find(l => find.test(l)); const m = line && /^\[(\d+)\]/.exec(line); return m ? Number(m[1]) : null; };
/** About what browserToolset sends for a full view (forModel): the element list and the main text. */
const viewChars = page => JSON.stringify({ url: page.url, title: page.title, elements: page.elements.join("\n"), text: page.text }).length;

async function runTask(cdp, agentSource, base, task, usePrecise) {
  const tab = await openTab(cdp, agentSource, usePrecise);
  const views = [];
  const look = async () => { const page = await tab.snapshot(); views.push({ chars: viewChars(page), elements: page.elements.length, omitted: page.omitted }); return page; };
  const result = { task: task.name, ok: false, rounds: 0, steps: 0, errors: [], confirmations: 0, userOnly: 0, extraLooks: 0, scrolls: 0 };
  const started = now();
  let waited = 0;
  try {
    await tab.navigate(`${base}/fixtures/${task.page}`);
    let page = await look();
    result.rounds++; // browser_open
    // What the first view must (not) say, e.g. how a control is named or flagged.
    const viewProblems = [...(task.view?.has || []).filter(re => !page.elements.some(l => re.test(l))).map(re => `view lacks ${re}`),
      ...(task.view?.lacks || []).filter(re => page.elements.some(l => re.test(l))).map(re => `view has ${re}`)];
    for (const message of viewProblems) result.errors.push({ code: "view", message });
    if (task.read) {
      for (let offset = 0; offset !== null && result.rounds < MAX_ROUNDS;) {
        const chunk = await tab.run({ op: "read", offset });
        result.rounds++;
        views.push({ chars: JSON.stringify(chunk).length, elements: 0, omitted: 0, read: true });
        offset = chunk.nextOffset;
        if (offset === null) result.ok = chunk.text.includes("THE END: the answer is 42.");
      }
    } else {
      let queue = task.batches.map(b => b.slice());
      let recovered = false;
      const maxRounds = task.maxRounds || MAX_ROUNDS;
      while (queue.length && result.rounds < maxRounds) {
        const batch = queue[0];
        // Resolve refs against the latest view; a missing element costs the model another look (or a scroll).
        const missing = batch.find(s => s.find && refOf(page, s.find) === null);
        if (missing) {
          result.rounds++;
          if (task.scrollToFind) { result.scrolls++; await tab.step({ action: "scroll", direction: "down" }); await tab.afterAction(); }
          else { result.extraLooks++; const t = now(); await sleep(400); waited += now() - t; } // The model taking its time to look again.
          page = await look();
          if (result.rounds >= maxRounds) { result.errors.push({ code: "not_found", message: `Never found ${missing.find}`, ...(flag("verbose") ? { view: page.elements.slice(0, 25), body: await tab.evalMain("document.body.innerText.slice(0, 300)"),
            frames: await tab.evalWorld("[...document.querySelectorAll('iframe')].map(f => { try { return f.contentDocument ? f.contentDocument.body.innerText.slice(0, 80) : 'null'; } catch (e) { return 'blocked'; } })") } : {}) }); break; }
          continue;
        }
        queue.shift();
        result.rounds++;
        let failed = null, failedAt = -1;
        for (const [index, spec] of batch.entries()) {
          failedAt = index;
          const step = { ...spec, ...(spec.find ? { ref: refOf(page, spec.find) } : {}) };
          delete step.find; delete step.expectUserOnly; delete step.before;
          try {
            if (spec.before) await tab.evalMain(spec.before);
            const info = await tab.run({ op: "inspect", step });
            if (info.userOnly) { result.userOnly++; if (!spec.expectUserOnly) failed = { code: "user_only", message: info.userOnly }; break; }
            if (info.consequential || info.submitsText) result.confirmations++; // The user approves; the bench goes on.
            await tab.step(step);
            result.steps++;
            await tab.afterAction();
          } catch (error) { failed = { code: error.code || "error", message: error.message }; break; }
        }
        page = await look();
        if (failed) {
          result.errors.push(failed);
          if (task.recover && !recovered && task.recover.error.test(failed.message)) { recovered = true; queue = task.recover.batches.map(b => b.slice()); continue; }
          // A stale element: the model looks again (done above) and re-sends the rest of the batch.
          if (/no longer on the page/.test(failed.message) && result.errors.length < 8) { queue.unshift(batch.slice(failedAt)); continue; }
          break;
        }
      }
      result.ok = task.check ? !!(await tab.evalMain(task.check)) : false;
      if (task.expect) result.ok &&= result.confirmations === task.expect.confirmations && result.userOnly === task.expect.userOnly;
      if (viewProblems.length) result.ok = false;
    }
  } catch (error) { result.errors.push({ code: "crash", message: error.message }); }
  // Task time without the scripted model's own pauses: what the page layer cost.
  result.ms = Math.round(now() - started - waited);
  result.phases = Object.fromEntries(Object.entries(tab.phases).map(([k, v]) => [k, Math.round(v)]));
  result.views = { count: views.length, avgChars: Math.round(views.reduce((n, v) => n + v.chars, 0) / Math.max(1, views.length)),
    maxChars: Math.max(0, ...views.map(v => v.chars)), maxElements: Math.max(0, ...views.map(v => v.elements)), maxOmitted: Math.max(0, ...views.map(v => v.omitted)),
    totalChars: views.reduce((n, v) => n + v.chars, 0) };
  if (task.knownGap) result.knownGap = task.knownGap;
  await tab.close().catch(() => {});
  return result;
}

const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

function combine(runs) {
  const first = runs[0];
  const phases = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.phases)) (phases[k] ||= []).push(v);
  return { ...first, ok: runs.every(r => r.ok), okRuns: runs.filter(r => r.ok).length, ms: median(runs.map(r => r.ms)), msRange: [Math.min(...runs.map(r => r.ms)), Math.max(...runs.map(r => r.ms))],
    rounds: median(runs.map(r => r.rounds)), phases: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, median(v)])) };
}

export const TASK_NAMES = TASKS.map(t => t.name);
export const BENCH_TASKS = TASKS;
export const chromeAvailable = () => !!chromePath();

/** Runs the benchmark and returns its report. `onTask` hears each task's combined result as it finishes. */
export async function runBench({ only = [], runs = 1, precise = false, onTask } = {}) {
  const agentSource = await readFile(path.join(ROOT, "extension/page-agent.js"), "utf8");
  const server = await serve();
  const base = `http://localhost:${server.address().port}`;
  const cdp = await launch();
  const tasks = TASKS.filter(t => !only.length || only.includes(t.name));
  const results = [];
  try {
    for (const task of tasks) {
      const list = [];
      for (let i = 0; i < runs; i++) list.push(await runTask(cdp, agentSource, base, task, precise));
      const combined = combine(list);
      results.push(combined);
      onTask?.(combined);
    }
  } finally { await cdp.close(); server.close(); }

  const all = results;
  const phaseTotals = {};
  for (const r of all) for (const [k, v] of Object.entries(r.phases)) phaseTotals[k] = (phaseTotals[k] || 0) + v;
  const stepMs = all.reduce((n, r) => n + r.ms, 0), steps = all.reduce((n, r) => n + r.steps, 0);
  const summary = {
    tasks: all.length, passed: all.filter(r => r.ok).length, knownGaps: all.filter(r => !r.ok && r.knownGap).length, failed: all.filter(r => !r.ok && !r.knownGap).map(r => r.task),
    rounds: all.reduce((n, r) => n + r.rounds, 0), steps, totalMs: stepMs,
    /** Page-layer time per model round (each round is one browser_open, browser_act, look or read). */
    msPerRound: Math.round(stepMs / Math.max(1, all.reduce((n, r) => n + r.rounds, 0))),
    staleRefErrors: all.reduce((n, r) => n + r.errors.filter(e => /no longer on the page/.test(e.message)).length, 0),
    confirmations: all.reduce((n, r) => n + r.confirmations, 0),
    phaseShare: Object.fromEntries(Object.entries(phaseTotals).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round((v / Math.max(1, stepMs)) * 1000) / 10])),
    avgViewTokens: Math.round(all.reduce((n, r) => n + r.views.avgChars, 0) / Math.max(1, all.length) / 4),
  };
  return { date: new Date().toISOString(), mode: precise ? "precise" : "ordinary", runs, chrome: cdp.version, node: process.version, summary, tasks: all };
}

async function main() {
  const report = await runBench({ only: ONLY, runs: RUNS, precise: PRECISE, onTask: r =>
    process.stdout.write(`${r.ok ? "✔" : r.knownGap ? "○" : "✖"} ${r.task.padEnd(14)} ${String(r.ms).padStart(6)} ms  rounds ${r.rounds}  views ~${Math.round(r.views.avgChars / 4)} tok avg${!r.ok && !r.knownGap && r.errors.length ? `  (${r.errors.at(-1).message.slice(0, 90)})` : ""}\n`) });
  const { summary } = report;

  console.log(`\n${summary.passed}/${summary.tasks} passed (${summary.knownGaps} known gaps)${summary.failed.length ? `, failed: ${summary.failed.join(", ")}` : ""}`);
  console.log(`${summary.rounds} model rounds, ${summary.steps} steps, ${summary.msPerRound} ms of page work per round (no model time), ~${summary.avgViewTokens} tokens per view, ${summary.staleRefErrors} stale-ref errors`);
  console.log(`Where the time goes (% of task time): ${Object.entries(summary.phaseShare).map(([k, v]) => `${k} ${v}%`).join(", ")}`);
  const out = OUT || path.join(ROOT, "bench/agent/results", `${report.date.slice(0, 10)}-${report.mode}.json`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  console.log(`Saved ${path.relative(ROOT, out)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exit(1); });

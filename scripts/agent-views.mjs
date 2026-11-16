#!/usr/bin/env node
// How big the browser agent's view of real websites is, next to the alternatives other agents send the model.
//
// For each page: raw HTML, the page's full text, Chrome's full accessibility tree (one line per named node,
// as AXTree-based agents feed it), and the page agent's snapshot shaped the way the model receives it
// (present() in src/services/browserAgent.ts). Tokens are estimated as characters ÷ 4, like agent-bench.
//
//   npm run bench:views                                   the default list of public pages
//   npm run bench:views -- --urls https://a.example,https://b.example --out mine.json
//
// This visits live public sites from this machine in headless Chrome with a throwaway profile. Some sites
// refuse headless browsers; those rows are marked blocked and left out of the averages.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./agent-bench.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const DEFAULT_URLS = [
  "https://en.wikipedia.org/wiki/Large_language_model", "https://github.com/microsoft/vscode", "https://news.ycombinator.com/",
  "https://www.bbc.com/news", "https://docs.python.org/3/library/asyncio-task.html", "https://www.amazon.com/s?k=laptop+stand",
  "https://stackoverflow.com/questions", "https://www.craigslist.org/about/sites",
];
const URLS = option("urls", "").split(",").filter(Boolean);
const OUT = option("out", "");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tokens = chars => Math.round(chars / 4);
/** A 1280×900 screenshot as Claude counts image tokens (width × height ÷ 750), for comparison. */
const SCREENSHOT_TOKENS = Math.round((1280 * 900) / 750);

function axText(nodes) {
  const lines = [];
  for (const n of nodes) {
    if (n.ignored) continue;
    const role = n.role?.value;
    if (!role || ["none", "generic", "InlineTextBox"].includes(role)) continue;
    const name = n.name?.value || "";
    lines.push(`[${n.nodeId}] ${role}${name ? ` ${JSON.stringify(name.slice(0, 100))}` : ""}`);
  }
  return lines;
}

export async function measureViews(urls = DEFAULT_URLS) {
  const agentSource = await readFile(path.join(ROOT, "extension/page-agent.js"), "utf8");
  const cdp = await launch();
  const rows = [];
  try {
    for (const url of urls) {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      const send = (method, params) => cdp.send(method, params, sessionId);
      const evaluate = async (expression, contextId) => {
        const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      };
      try {
        await send("Page.enable"); await send("Runtime.enable"); await send("Accessibility.enable");
        await send("Page.navigate", { url });
        for (let i = 0; i < 80 && (await evaluate("document.readyState")) !== "complete"; i++) await sleep(250);
        await sleep(2500); // Late content.
        const raw = await evaluate("({ html: document.documentElement.outerHTML.length, text: (document.body?.innerText || '').length, title: document.title })");
        const { frameTree } = await send("Page.getFrameTree");
        const { executionContextId } = await send("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "synapse-views" });
        await evaluate(agentSource, executionContextId);
        const started = performance.now();
        const snap = await evaluate(`globalThis.__synapseAgent.run({ op: "snapshot" })`, executionContextId);
        const snapshotMs = Math.round(performance.now() - started);
        if (!snap?.ok) throw new Error(snap?.error || "No snapshot");
        const page = snap.value;
        const { nodes } = await send("Accessibility.getFullAXTree", {});
        const ax = axText(nodes);
        const view = JSON.stringify({ tabId: 1, site: new URL(page.url).hostname, url: page.url, title: page.title, ...(page.dialog ? { dialog: page.dialog } : {}),
          elements: page.elements.join("\n") + (page.omitted ? `\n…${page.omitted} more further down (scroll to reach them)` : ""), text: page.text, scroll: page.scroll });
        const blocked = page.elements.length === 0 && raw.text < 400;
        rows.push({ url, title: raw.title.slice(0, 80), ...(blocked ? { blocked: true } : {}), rawHtml: tokens(raw.html), fullText: tokens(raw.text), axTree: tokens(ax.join("\n").length), axNodes: ax.length,
          view: tokens(view.length), elements: page.elements.length, omitted: page.omitted, viewText: tokens(page.text.length), dialog: page.dialog || null, snapshotMs });
      } catch (error) { rows.push({ url, error: error.message }); }
      finally { await cdp.send("Target.closeTarget", { targetId }).catch(() => {}); }
    }
  } finally { await cdp.close(); }
  const ok = rows.filter(r => !r.error && !r.blocked);
  const avg = key => Math.round(ok.reduce((n, r) => n + r[key], 0) / Math.max(1, ok.length));
  return { date: new Date().toISOString(), chrome: cdp.version, pages: ok.length,
    summary: { rawHtml: avg("rawHtml"), fullText: avg("fullText"), axTree: avg("axTree"), screenshot: SCREENSHOT_TOKENS, view: avg("view"), emptyViews: ok.filter(r => r.elements === 0).map(r => r.url) }, rows };
}

async function main() {
  const report = await measureViews(URLS.length ? URLS : DEFAULT_URLS);
  for (const r of report.rows) {
    if (r.error) { console.log(`✖ ${r.url}  ${r.error.slice(0, 80)}`); continue; }
    if (r.blocked) { console.log(`○ ${r.url}  blocked headless Chrome`); continue; }
    console.log(`${r.elements ? "✔" : "✖"} ${r.title.slice(0, 40).padEnd(40)} view ${String(r.view).padStart(6)}  ax ${String(r.axTree).padStart(6)}  html ${String(r.rawHtml).padStart(7)}  ${r.elements} el${r.omitted ? ` +${r.omitted}` : ""}${r.dialog ? `  dialog "${r.dialog}"` : ""}`);
  }
  const s = report.summary;
  console.log(`\nAverage tokens per page over ${report.pages} pages: agent view ${s.view}, full AX tree ${s.axTree}, full text ${s.fullText}, raw HTML ${s.rawHtml}, screenshot ${s.screenshot}`);
  if (s.emptyViews.length) console.log(`Pages where the agent saw no controls: ${s.emptyViews.join(", ")}`);
  const out = OUT || path.join(ROOT, "bench/agent/results", `${report.date.slice(0, 10)}-views.json`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  console.log(`Saved ${path.relative(ROOT, out)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exit(1); });

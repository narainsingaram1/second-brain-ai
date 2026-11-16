#!/usr/bin/env node
// Model-in-the-loop benchmark: a real model drives the browser agent through the app's own agent loop
// (AutonomousBrainAgent with browserToolset: the same prompts, tool list, page diffs, compaction and prompt
// caching the app uses) on the fixture pages of agent-bench, in headless Chrome.
//
// It records, per task: success, model rounds, live steps, input / cached / output tokens, cache hit rate,
// cost (when the provider reports it), and model vs page time. This is what tells whether a change to the agent
// actually made it cheaper, faster or better, rather than only smaller on paper.
//
//   OPENROUTER_API_KEY=… npm run bench:model
//   OPENROUTER_API_KEY=… npm run bench:model -- --model anthropic/claude-haiku-5.5 --runs 3 --only search,modal
//
// Costs money: each task is a handful of model calls on the key you give it. Pages are local fixtures; the only
// network traffic is to the model provider. Steps that would ask the user (buy, send…) are approved
// automatically, and user-only fields are refused exactly as in the extension.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { serve, launch, openTab, BENCH_TASKS } from "./agent-bench.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const RUNS = Math.max(1, Number(option("runs", "1")) || 1);
const ONLY = option("only", "").split(",").filter(Boolean);
const OUT = option("out", "");

/** What a user would ask on each fixture. Tasks without a goal (scripted-only checks) are skipped. */
const GOALS = {
  "search": "search the shop for a usb hub and add the Anker 7-in-1 USB-C Hub to the cart",
  "react-form": "fill in the profile: full name Ada Lovelace, email ada@example.com, country United Kingdom, accept the terms, and save it",
  "cookie-banner": "show the quarterly report and tell me what it says",
  "modal": "rename the project to Q4 launch",
  "long-article": "read the article and tell me what the answer at the very end is",
  "big-page": "open the details of Item 450 in the catalog",
  "iframe-same": "set the home city to Paris in the form and go to the next step",
  "late-load": "load more items and pick Item 21",
  "flyout-dialog": "add the aluminium laptop stand to the cart",
  "consent-dialog": "click Ask question",
};
const CHECK_ANSWER = { "long-article": /\b42\b/, "cookie-banner": /12\s*%/ };

function bridgeFor(tab, base, counts) {
  const tabId = 1;
  const site = url => { try { return new URL(url).hostname; } catch { return "localhost"; } };
  const snapshot = async () => { const page = await tab.snapshot(); return { tabId, site: site(page.url), ...page }; };
  return {
    async call(request) {
      switch (request.type) {
        case "open": {
          const url = String(request.url || "");
          if (!url.startsWith(base)) throw new Error(`The benchmark only serves ${base}/fixtures/…`);
          await tab.navigate(url);
          return snapshot();
        }
        case "snapshot": return snapshot();
        case "read": return tab.run({ op: "read", offset: request.offset || 0 });
        case "act": {
          const done = [];
          const before = (await tab.snapshot()).url;
          for (const [i, step] of (request.steps || []).entries()) {
            const info = await tab.run({ op: "inspect", step });
            if (info.userOnly) { counts.userOnly++; return { ...(await snapshot()), done, stoppedAt: i, blocked: { step: i, reason: `"${info.name || "That field"}" is a ${info.userOnly}. Ask the user to fill it in.` } }; }
            if (info.consequential || info.submitsText) counts.confirmations++;
            await tab.step(step);
            done.push(`${step.action} ${step.ref ?? step.key ?? step.direction ?? ""}`.trim());
            await tab.afterAction();
            const now = (await tab.snapshot()).url;
            if (now !== before && i < request.steps.length - 1) return { ...(await snapshot()), done, stoppedAt: i + 1, stopReason: "The page changed, so the remaining steps were not run. Plan them against the new page." };
          }
          return { ...(await snapshot()), done };
        }
        case "tabs": return { tabs: [{ tabId, url: (await tab.snapshot()).url, title: "", site: "localhost" }] };
        case "user_tabs": return { tabs: [] };
        case "close": return { closed: true };
        case "stop": return { stopped: true };
        default: throw new Error(`The benchmark doesn't support ${request.type}.`);
      }
    },
  };
}

const state = (key, model) => ({ userId: "bench", tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], trackerItems: [], sections: ["General"],
  subsections: { General: ["General"] }, noteFolders: [], chatHistory: [], openRouterKey: key, selectedModel: model, theme: "light" });

export async function runModelBench({ key, model, only = [], runs = 1, onTask } = {}) {
  const vite = await createServer({ root: ROOT, cacheDir: "/tmp/synapse-model-bench-cache", configFile: false, logLevel: "error", server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  const { AutonomousBrainAgent } = await vite.ssrLoadModule("/src/services/agentDispatcher.ts");
  const { browserToolset } = await vite.ssrLoadModule("/src/services/browserAgent.ts");
  const { DEFAULT_MODEL } = await vite.ssrLoadModule("/src/services/openrouter.ts");
  model ||= DEFAULT_MODEL;
  const agentSource = await readFile(path.join(ROOT, "extension/page-agent.js"), "utf8");
  const server = await serve();
  const base = `http://localhost:${server.address().port}`;
  const cdp = await launch();
  const results = [];
  try {
    for (const task of BENCH_TASKS.filter(t => GOALS[t.name] && (!only.length || only.includes(t.name)))) {
      for (let run = 0; run < runs; run++) {
        const tab = await openTab(cdp, agentSource, false);
        const counts = { confirmations: 0, userOnly: 0 };
        const started = performance.now();
        const row = { task: task.name, run, ok: false };
        try {
          const prompt = `On ${base}/fixtures/${task.page}, ${GOALS[task.name]}.`;
          const result = await AutonomousBrainAgent.execute(prompt, state(key, model), key, model, {
            externalTools: browserToolset(bridgeFor(tab, base, counts), { confirm: async () => true }), commit: async () => {}, temporary: true });
          const pageOk = task.check ? !!(await tab.evalMain(task.check)) : true;
          const answerOk = CHECK_ANSWER[task.name] ? CHECK_ANSWER[task.name].test(result.queryAnswer || "") : true;
          const s = result.trace?.summary || {};
          Object.assign(row, { ok: pageOk && answerOk, rounds: s.rounds ?? null, liveSteps: s.liveSteps ?? null, inputTokens: s.inputTokens ?? null, cachedTokens: s.cachedTokens ?? null,
            outputTokens: s.outputTokens ?? null, cacheRate: s.cacheRate ?? null, modelMs: s.modelMs ?? null, toolMs: s.toolMs ?? null, cost: result.usage?.cost ?? null,
            errors: s.errors ?? 0, ...counts, status: result.status, answer: String(result.queryAnswer || "").slice(0, 200) });
        } catch (error) { row.error = error.message; }
        row.ms = Math.round(performance.now() - started);
        await tab.close().catch(() => {});
        results.push(row);
        onTask?.(row);
      }
    }
  } finally { await cdp.close(); server.close(); await vite.close(); }
  const sum = key => results.reduce((n, r) => n + (r[key] || 0), 0);
  const input = sum("inputTokens");
  const summary = { tasks: results.length, passed: results.filter(r => r.ok).length, failed: [...new Set(results.filter(r => !r.ok).map(r => r.task))],
    rounds: sum("rounds"), liveSteps: sum("liveSteps"), inputTokens: input, cachedTokens: sum("cachedTokens"), outputTokens: sum("outputTokens"),
    cacheRate: input ? Math.round((sum("cachedTokens") / input) * 1000) / 1000 : null, cost: results.some(r => r.cost !== null) ? Math.round(sum("cost") * 10000) / 10000 : null,
    modelMs: sum("modelMs"), toolMs: sum("toolMs"), ms: sum("ms") };
  return { date: new Date().toISOString(), model, runs, chrome: cdp.version, summary, tasks: results };
}

async function main() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Set OPENROUTER_API_KEY. This benchmark calls a real model and costs a little money per task.");
  const report = await runModelBench({ key, model: option("model", ""), only: ONLY, runs: RUNS, onTask: r =>
    process.stdout.write(`${r.ok ? "✔" : "✖"} ${r.task.padEnd(15)} ${String(r.ms).padStart(7)} ms  rounds ${r.rounds ?? "?"}  in ${r.inputTokens ?? "?"} (cached ${r.cacheRate !== null && r.cacheRate !== undefined ? Math.round(r.cacheRate * 100) + "%" : "?"})  out ${r.outputTokens ?? "?"}${r.cost !== null && r.cost !== undefined ? `  $${r.cost.toFixed(4)}` : ""}${r.error ? `  (${r.error.slice(0, 80)})` : ""}\n`) });
  const s = report.summary;
  console.log(`\n${s.passed}/${s.tasks} passed with ${report.model}${s.failed.length ? `, failed: ${s.failed.join(", ")}` : ""}`);
  console.log(`${s.rounds} model rounds, ${s.inputTokens} input tokens (${s.cacheRate !== null ? Math.round(s.cacheRate * 100) : "?"}% cached), ${s.outputTokens} output tokens${s.cost !== null ? `, $${s.cost}` : ""}`);
  console.log(`Time: ${Math.round(s.modelMs / 1000)} s in the model, ${Math.round(s.toolMs / 1000)} s on pages, ${Math.round(s.ms / 1000)} s in all`);
  const out = OUT || path.join(ROOT, "bench/agent/results", `${report.date.slice(0, 10)}-model-${report.model.replace(/[^\w.-]+/g, "_")}.json`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  console.log(`Saved ${path.relative(ROOT, out)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exit(1); });

#!/usr/bin/env node
// Turns pages where the browser agent failed into benchmark fixtures, so a fix covers that kind of page for good.
//
// In the Synapse app, after a step failed or did nothing, copy the captured pages out of the devtools console:
//   copy(JSON.stringify(__synapseAgentFailures))
// save them to a file, then:
//   node scripts/agent-fixture.mjs failures.json
//
// Each page is written to bench/agent/fixtures/captured/<name>.html (its embedded frames beside it, served from
// the fixture server) and listed in bench/agent/captured.json. Fill in that entry's `view.has` with patterns for
// the elements the agent should have seen (e.g. "textbox \"First name\""); `npm run bench:agent` then checks
// them on every run. The pages have scripts and typed text removed, but they can still show personal details
// (names, emails on the page): read them before committing.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "bench/agent/fixtures/captured");
const LIST = path.join(ROOT, "bench/agent/captured.json");

const slug = text => String(text || "page").toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "page";
const escapeAttr = text => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const sameFrame = (src, url) => {
  try { const a = new URL(src), b = new URL(url); return a.origin === b.origin && a.pathname === b.pathname; } catch { return false; }
};

export async function writeFixtures(failures, { dir = DIR, list = LIST } = {}) {
  if (!Array.isArray(failures)) throw new Error("Expected the array copied from __synapseAgentFailures.");
  await mkdir(dir, { recursive: true });
  const tasks = existsSync(list) ? JSON.parse(await readFile(list, "utf8")) : [];
  const written = [];
  for (const failure of failures) {
    if (!failure?.html) continue;
    let name = `${slug(failure.site)}-${String(failure.at || "").slice(0, 10) || "undated"}`;
    for (let n = 2; tasks.some(t => t.name === name) || written.includes(name); n++) name = `${slug(failure.site)}-${String(failure.at || "").slice(0, 10)}-${n}`;
    let html = String(failure.html);
    // Embedded frames become files of their own, and the page points at them.
    for (const [k, frame] of (failure.frames || []).entries()) {
      const file = `${name}-frame-${k + 1}.html`;
      await writeFile(path.join(dir, file), String(frame.html));
      html = html.replace(/(<i?frame\b[^>]*?\bsrc=")([^"]*)(")/gi, (all, open, src, close) => {
        const resolved = src.replace(/&amp;/g, "&");
        return sameFrame(resolved, frame.url) ? `${open}${escapeAttr(file)}${close}` : all;
      });
    }
    await writeFile(path.join(dir, `${name}.html`), html);
    tasks.push({ name, page: `captured/${name}.html`, url: failure.url, about: String(failure.problem || "").slice(0, 300), steps: failure.steps ?? null, view: { has: [] } });
    written.push(name);
  }
  await writeFile(list, `${JSON.stringify(tasks, null, 2)}\n`);
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) { console.error("Usage: node scripts/agent-fixture.mjs failures.json"); process.exit(1); }
  const names = await writeFixtures(JSON.parse(await readFile(file, "utf8")));
  console.log(names.length ? `Wrote ${names.length} fixture(s): ${names.join(", ")}.\nAdd what the agent should see to each entry's view.has in bench/agent/captured.json, and check the pages for personal details before committing.` : "No captured pages in that file.");
}

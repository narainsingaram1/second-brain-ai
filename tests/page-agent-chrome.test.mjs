// The page agent (extension/page-agent.js) in a real Chrome, on the benchmark's fixture pages: forms submit
// once, same-origin frames are seen and keep their safety rules, controls are named well, and ticking a box
// never asks for approval. Skipped where Chrome isn't installed (set CHROME_PATH to point at one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBench, chromeAvailable } from '../scripts/agent-bench.mjs';

const TASKS = ['search', 'react-form', 'cookie-banner', 'modal', 'iframe-same', 'iframe-secret', 'checkout', 'flyout-dialog', 'consent-dialog', 'job-form', 'open-dropdown'];

test('page agent in Chrome: the regression tasks pass with ordinary input', { skip: !chromeAvailable() && 'Chrome not installed', timeout: 120_000 }, async () => {
  const report = await runBench({ only: TASKS, runs: 1 });
  for (const task of report.tasks) {
    assert.ok(task.ok, `${task.task} failed: ${JSON.stringify(task.errors)}`);
  }
  const search = report.tasks.find(t => t.task === 'search');
  assert.equal(search.rounds, 5, 'one submit: results arrive without the page reloading');
  const secret = report.tasks.find(t => t.task === 'iframe-secret');
  assert.equal(secret.userOnly, 1, 'a password inside a frame is the user\'s to type');
  assert.equal(secret.confirmations, 1, 'Enter on a focused Send inside a frame asks first');
});

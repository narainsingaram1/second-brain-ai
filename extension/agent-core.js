// Synapse browser agent: the extension's decision-making, separate from Chrome wiring so it can be tested.
//
// Rules it enforces no matter what the assistant asks:
// - Only a Synapse app the user paired with in the extension can drive the browser.
// - The agent acts only in tabs it opened itself (kept in a "Synapse" tab group), never in the user's own tabs.
// - Only http(s) pages; browser pages, the extension store and sites the user blocked are off limits.
// - It never types into password, payment or identity fields: the user fills those in.
// - A click that commits something (buy, send, post, delete, submit…) or text sent with Enter outside a search
//   box stops and asks first. It runs only with a one-time token issued for that exact step on that exact page,
//   which the app obtains from the user, not from the model.

import { createCdp } from "./cdp.js";

export const VERSION = "1.1.0";
export const STATIC_APP_ORIGINS = ["https://synapse-narain-brain.coolfiregoon.chatgpt.site", "https://second-brain-ai-src-tauri.vercel.app"];
const LOCAL_APP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const BLOCKED_HOSTS = ["chrome.google.com", "chromewebstore.google.com", "accounts.google.com/signin/v2/challenge"];
const TOKEN_TTL_MS = 5 * 60_000;
const LOAD_TIMEOUT_MS = 20_000;
const MAX_STEPS = 10;

export function isAppOrigin(origin, extra = []) {
  return LOCAL_APP.test(origin) || STATIC_APP_ORIGINS.includes(origin) || extra.includes(origin);
}

/** Checks a URL the agent wants to open. Throws a message the assistant can relay. */
export function checkTarget(raw, blocked = []) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new Error("That isn't a valid web address. Use a full https:// URL."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http:// and https:// pages can be opened.");
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.some(b => host === b || `${host}${url.pathname}`.startsWith(b))) throw new Error("The agent can't act on this page (it belongs to the browser or your Google sign-in).");
  if (blocked.some(b => host === b || host.endsWith(`.${b}`))) throw new Error(`You blocked the agent on ${host} in the Synapse extension.`);
  return url;
}

const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "this page"; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * @param chrome the extension API (or a fake with the same shape)
 * @param options.openPairing (origin, requestId) => void, shows the pairing prompt
 */
/**
 * @param options.settle the least time (ms) to let a page react after an action, before watching it settle
 */
export function createAgent(chrome, { openPairing, now = () => Date.now(), random = () => crypto.randomUUID(), settle = 60, cdp = createCdp(chrome) } = {}) {
  const pendingPairs = new Map(); // requestId -> resolve
  const tokens = new Map(); // token -> { tabId, url, step, expires }
  let stopped = false;

  const local = async key => (await chrome.storage.local.get(key))[key];
  const session = async key => (await chrome.storage.session.get(key))[key];
  const settings = async () => ({ paired: (await local("pairedOrigins")) || [], extraOrigins: (await local("appOrigins")) || [], blocked: (await local("blockedHosts")) || [] });
  const ownTabs = async () => (await session("agentTabs")) || [];
  const setOwnTabs = tabs => chrome.storage.session.set({ agentTabs: tabs });

  async function requireOwnTab(tabId) {
    const id = Number(tabId);
    if (!(await ownTabs()).includes(id)) throw new Error("The agent can only act in tabs it opened. Open the page with browser_open first.");
    let tab;
    try { tab = await chrome.tabs.get(id); } catch { await setOwnTabs((await ownTabs()).filter(t => t !== id)); throw new Error("That tab was closed. Open the page again."); }
    checkTarget(tab.url || tab.pendingUrl || "about:blank", (await settings()).blocked);
    return tab;
  }

  async function waitForLoad(tabId, timeout = LOAD_TIMEOUT_MS) {
    const start = now();
    for (;;) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return tab;
      if (now() - start > timeout) return tab; // Slow page: work with what has loaded.
      await sleep(150);
    }
  }

  async function run(tabId, command) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["page-agent.js"] });
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: c => globalThis.__synapseAgent.run(c), args: [command] });
    const value = result?.result;
    if (!value) throw new Error("The page didn't respond. It may still be loading, or the browser doesn't allow scripts on it.");
    if (!value.ok) throw Object.assign(new Error(value.error), { code: value.code });
    return value.value;
  }

  /** Waits until the page stops changing (or starts navigating). Never fails: a page mid-navigation can't answer. */
  async function quiet(tabId) {
    try { return await run(tabId, { op: "settle" }); } catch { return { navigating: true }; }
  }

  /** After an action: give the page a moment, wait for it to settle and finish any load it started. */
  async function afterAction(tabId) {
    await sleep(settle);
    const first = await quiet(tabId);
    let tab = await waitForLoad(tabId);
    if (first?.navigating || tab.status !== "complete") { tab = await waitForLoad(tabId); await quiet(tabId); }
    return chrome.tabs.get(tabId);
  }

  /** A screenshot with the target boxed, for the user to see before allowing a step. Optional: null if unavailable. */
  async function capture(tabId, focusRef) {
    if (!(await cdp.ready(tabId))) return null;
    try {
      await run(tabId, { op: "mark", refs: focusRef ? [focusRef] : [], focus: focusRef });
      return await cdp.screenshot(tabId);
    } catch { return null; }
    finally { try { await run(tabId, { op: "unmark" }); } catch { /* Page moved on. */ } }
  }

  /** Runs a step as trusted input when precise mode is on; null when it should run the ordinary way. */
  async function preciseStep(tabId, step) {
    if (!["click", "type", "press", "check", "uncheck"].includes(step.action) || !(await cdp.ready(tabId))) return null;
    if (step.action === "press") { await cdp.key(tabId, String(step.key || "")); return `Pressed ${step.key}`; }
    if (step.action === "check" || step.action === "uncheck") return null; // Needs the current state: the page agent handles it.
    if (step.action === "click") {
      const at = await run(tabId, { op: "point", ref: step.ref });
      await cdp.click(tabId, at.x, at.y);
      return `Clicked ${at.role} "${at.name}"`;
    }
    const field = await run(tabId, { op: "focus", ref: step.ref, append: !!step.append });
    const text = String(step.text ?? "");
    if (text) await cdp.insertText(tabId, text);
    else if (!step.append) await cdp.key(tabId, "Backspace"); // Empty text clears the selected contents.
    let note = `Typed into "${field.name}"`;
    if (step.submit) { await cdp.key(tabId, "Enter"); note += " and pressed Enter"; }
    return note;
  }

  async function snapshot(tabId) {
    const page = await run(tabId, { op: "snapshot" });
    return { tabId, site: hostOf(page.url), ...page };
  }

  async function addToGroup(tabId) {
    try {
      let groupId = await session("groupId");
      if (groupId !== undefined) { try { await chrome.tabGroups.get(groupId); } catch { groupId = undefined; } }
      groupId = await chrome.tabs.group({ tabIds: [tabId], ...(groupId !== undefined ? { groupId } : {}) });
      await chrome.tabGroups.update(groupId, { title: "Synapse", color: "purple", collapsed: false });
      await chrome.storage.session.set({ groupId });
    } catch { /* Tab groups are a convenience; the tab is still tracked. */ }
  }

  async function open({ url, tabId }) {
    const target = checkTarget(url, (await settings()).blocked);
    let tab;
    if (tabId !== undefined && tabId !== null) {
      tab = await requireOwnTab(tabId);
      tab = await chrome.tabs.update(tab.id, { url: target.href });
    } else {
      tab = await chrome.tabs.create({ url: target.href, active: false });
      await setOwnTabs([...(await ownTabs()), tab.id]);
      await addToGroup(tab.id);
    }
    await sleep(settle);
    await waitForLoad(tab.id);
    await quiet(tab.id);
    const loaded = await chrome.tabs.get(tab.id);
    checkTarget(loaded.url || target.href, (await settings()).blocked); // A redirect may land somewhere blocked.
    return snapshot(tab.id);
  }

  const stepKey = step => JSON.stringify({ action: step.action, ref: step.ref ?? null, text: step.text ?? null, value: step.value ?? null, key: step.key ?? null,
    direction: step.direction ?? null, submit: !!step.submit, append: !!step.append });

  async function act({ tabId, steps, confirmToken }) {
    if (!Array.isArray(steps) || !steps.length) throw new Error("Send at least one step.");
    if (steps.length > MAX_STEPS) throw new Error(`At most ${MAX_STEPS} steps at a time.`);
    stopped = false;
    let tab = await requireOwnTab(tabId);
    const done = [];
    for (let i = 0; i < steps.length; i++) {
      if (stopped) return { ...(await snapshot(tab.id)), done, stoppedAt: i, stopReason: "Stopped by the user." };
      const step = steps[i];
      const info = await run(tab.id, { op: "inspect", step });
      if (info.userOnly) {
        return { ...(await snapshot(tab.id)), done, stoppedAt: i, blocked: { step: i, reason: `"${info.name || "That field"}" is a ${info.userOnly}. Ask the user to fill it in themselves in the Synapse tab group, then continue.` } };
      }
      if (info.consequential || info.submitsText) {
        const grant = confirmToken && tokens.get(confirmToken);
        const valid = grant && i === 0 && grant.tabId === tab.id && grant.url === tab.url && grant.step === stepKey(step) && grant.expires > now();
        if (!valid) {
          const token = random();
          tokens.set(token, { tabId: tab.id, url: tab.url, step: stepKey(step), expires: now() + TOKEN_TTL_MS });
          const label = step.action === "type" ? `Send "${String(step.text || "").slice(0, 120)}" in "${info.name || "a text box"}"`
            : step.action === "press" ? `Press ${step.key} on "${info.name || "the focused control"}"` : `Click "${info.name || "this button"}"`;
          const screenshot = await capture(tab.id, step.ref);
          return { ...(await snapshot(tab.id)), done, stoppedAt: i, needsConfirmation: { token, step: i, label, site: hostOf(tab.url), ...(screenshot ? { screenshot } : {}) } };
        }
        tokens.delete(confirmToken); // One use only.
      }
      const before = tab.url;
      const note = (await preciseStep(tab.id, step)) ?? await run(tab.id, { op: "act", step });
      done.push(note);
      tab = await afterAction(tab.id);
      if (tab.url !== before) {
        checkTarget(tab.url, (await settings()).blocked);
        // Refs belong to the old page; the rest of the steps must be planned against the new one.
        if (i < steps.length - 1) return { ...(await snapshot(tab.id)), done, stoppedAt: i + 1, stopReason: "The page changed, so the remaining steps were not run. Plan them against the new page." };
      }
    }
    return { ...(await snapshot(tab.id)), done };
  }

  async function tabs() {
    const list = [];
    for (const id of await ownTabs()) {
      try { const t = await chrome.tabs.get(id); list.push({ tabId: id, url: t.url, title: t.title, site: hostOf(t.url) }); } catch { /* Closed. */ }
    }
    await setOwnTabs(list.map(t => t.tabId));
    return { tabs: list };
  }

  async function close({ tabId }) {
    const tab = await requireOwnTab(tabId);
    await chrome.tabs.remove(tab.id);
    await setOwnTabs((await ownTabs()).filter(t => t !== tab.id));
    return { closed: true };
  }

  async function stopAll() {
    stopped = true;
    tokens.clear();
    await cdp.detachAll();
    return { stopped: true };
  }

  async function pair(origin) {
    const { paired } = await settings();
    if (paired.includes(origin)) return { paired: true };
    const id = random();
    const decision = new Promise(resolve => pendingPairs.set(id, resolve));
    openPairing(origin, id);
    let timer;
    const allow = await Promise.race([decision, new Promise(resolve => { timer = setTimeout(() => resolve(false), 120_000); })]);
    clearTimeout(timer);
    pendingPairs.delete(id);
    if (!allow) return { paired: false };
    const latest = (await settings()).paired;
    await chrome.storage.local.set({ pairedOrigins: [...new Set([...latest, origin])] });
    return { paired: true };
  }

  /** A message from the Synapse app (through the bridge on its page). `origin` comes from Chrome, not the page. */
  async function fromApp(message, origin) {
    const { paired, extraOrigins } = await settings();
    if (!isAppOrigin(origin, extraOrigins)) throw new Error("This site is not a Synapse app.");
    if (message.type === "hello") return { version: VERSION, paired: paired.includes(origin) };
    if (message.type === "pair") return pair(origin);
    if (!paired.includes(origin)) throw Object.assign(new Error("Connect Synapse to the browser extension first (Settings → Browser agent)."), { code: "not_paired" });
    switch (message.type) {
      case "open": return open(message);
      case "snapshot": return snapshot((await requireOwnTab(message.tabId)).id);
      case "act": return act(message);
      case "read": return run((await requireOwnTab(message.tabId)).id, { op: "read", offset: message.offset || 0 });
      case "tabs": return tabs();
      case "close": return close(message);
      case "stop": return stopAll();
      default: throw new Error(`Unknown request ${message.type}`);
    }
  }

  /** A message from the extension's own pages (pairing prompt, popup). */
  async function fromExtension(message) {
    if (message.type === "pair-decision") { pendingPairs.get(message.id)?.(!!message.allow); return { ok: true }; }
    if (message.type === "status") return { version: VERSION, ...(await settings()), ...(await tabs()), precise: !!(await local("precise")) };
    if (message.type === "set-precise") { await chrome.storage.local.set({ precise: !!message.on }); if (!message.on) await cdp.detachAll(); return { ok: true }; }
    if (message.type === "stop") { await stopAll(); for (const id of await ownTabs()) { try { await chrome.tabs.remove(id); } catch { /* Gone. */ } } await setOwnTabs([]); return { stopped: true }; }
    if (message.type === "unpair") { const { paired } = await settings(); await chrome.storage.local.set({ pairedOrigins: paired.filter(o => o !== message.origin) }); return { ok: true }; }
    if (message.type === "set-blocked") { await chrome.storage.local.set({ blockedHosts: (message.hosts || []).map(h => String(h).trim().toLowerCase().replace(/^www\./, "")).filter(Boolean) }); return { ok: true }; }
    throw new Error(`Unknown request ${message.type}`);
  }

  /** Forget tabs the user closed. */
  async function tabClosed(tabId) { await cdp.detach(tabId); await setOwnTabs((await ownTabs()).filter(t => t !== tabId)); }

  return { fromApp, fromExtension, tabClosed };
}

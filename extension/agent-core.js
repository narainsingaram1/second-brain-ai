// Synapse browser agent: the extension's decision-making, separate from Chrome wiring so it can be tested.
//
// Rules it enforces no matter what the assistant asks:
// - Only a Synapse app the user paired with in the extension can drive the browser.
// - The agent acts only in tabs it opened itself (kept in a "Synapse" tab group), or in one of the user's own
//   tabs they lent it: shared from the extension (popup or right-click menu), or borrowed with a one-time token
//   the app obtains from the user's approval, never from the model. It can list the user's tabs (title and site)
//   but not look into one until it is lent. A lent tab is never closed by the agent, only handed back.
// - Only http(s) pages; browser pages, the extension store and sites the user blocked are off limits.
// - It never types into password, payment or identity fields: the user fills those in.
// - A click that commits something (buy, send, post, delete, submit…) or text sent with Enter outside a search
//   box stops and asks first. It runs only with a one-time token issued for that exact step on that exact page,
//   which the app obtains from the user, not from the model.

import { createCdp } from "./cdp.js";

export const VERSION = "1.6.0";
/** The Synapse desktop app, connected through Chrome native messaging (see background.js). */
export const NATIVE_ORIGIN = "native:desktop";
export const STATIC_APP_ORIGINS = ["https://synapse-narain-brain.coolfiregoon.chatgpt.site", "https://second-brain-ai-src-tauri.vercel.app"];
const LOCAL_APP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const BLOCKED_HOSTS = ["chrome.google.com", "chromewebstore.google.com", "accounts.google.com/signin/v2/challenge"];
const TOKEN_TTL_MS = 5 * 60_000;
const LOAD_TIMEOUT_MS = 20_000;
const MAX_STEPS = 25;
/** Files the app hands over for upload steps, in pieces that fit the desktop link's 1 MB message limit. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILE_PARTS = 64;
const FILE_TTL_MS = 10 * 60_000;
/**
 * Cross-origin frames (an embedded Greenhouse or Lever application, a sign-up or booking widget) are read and
 * driven separately. Each gets a block of refs: frame slot k numbers its elements from k * FRAME_SPAN + 1, so a
 * ref alone says which frame it belongs to. Keep equal to FRAME_SPAN in page-agent.js.
 */
const FRAME_SPAN = 100000;
const MAX_FRAME_ELEMENTS = 160;
const MAX_ELEMENTS_TOTAL = 300;
const FRAME_TEXT = 2500;
/** How long to wait for a visible cross-origin frame that hasn't answered yet (still loading). */
const FRAME_WAIT_MS = 2400;
/** Frames that hold a CAPTCHA: the agent doesn't touch them, the user solves it. */
/** Ad frames: never what the user asked about, and they crowd the view. */
const AD_FRAME = /(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.|amazon-adsystem\.com|adnxs\.com|taboola\.com|outbrain\.com|criteo\.(?:com|net)|moatads\.com)/i;
const CAPTCHA_FRAME = /(?:google\.com\/recaptcha|recaptcha\.net|hcaptcha\.com|challenges\.cloudflare\.com|arkoselabs\.com|funcaptcha\.com|captcha-delivery\.com)/i;

export function isAppOrigin(origin, extra = []) {
  return origin === NATIVE_ORIGIN || LOCAL_APP.test(origin) || STATIC_APP_ORIGINS.includes(origin) || extra.includes(origin);
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
 * Where a request's time goes (inject, inspect, act, settle, load, snapshot…), in whole milliseconds. Returned
 * with each result as `timings` for tracing only; the app strips it before the model sees the page.
 */
function stopwatch(now) {
  const start = now();
  const phases = {};
  return {
    async time(phase, work) {
      const t = now();
      try { return await work(); } finally { phases[phase] = (phases[phase] || 0) + Math.max(0, Math.round(now() - t)); }
    },
    result: () => ({ ...phases, total: Math.max(0, Math.round(now() - start)) }),
  };
}
/** For internal calls nobody is timing. */
const untimed = { time: (_phase, work) => work() };

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
  const files = new Map(); // fileId -> { name, mime, parts, total, expires }
  let stopped = false;

  const local = async key => (await chrome.storage.local.get(key))[key];
  const session = async key => (await chrome.storage.session.get(key))[key];
  const settings = async () => ({ paired: (await local("pairedOrigins")) || [], extraOrigins: (await local("appOrigins")) || [], blocked: (await local("blockedHosts")) || [] });
  const ownTabs = async () => (await session("agentTabs")) || [];
  const setOwnTabs = tabs => chrome.storage.session.set({ agentTabs: tabs });
  /** The user's own tabs lent to the agent (shared or borrowed). */
  const lentTabs = async () => (await session("lentTabs")) || [];
  const setLentTabs = tabs => chrome.storage.session.set({ lentTabs: tabs });
  /** Per tab, the cross-origin frames the agent reads: frameId -> { slot, url }. Survives the worker sleeping. */
  const frameMaps = async () => (await session("frameSlots")) || {};
  const framesOf = async tabId => (await frameMaps())[tabId] || {};
  async function setFrames(tabId, map) {
    const all = await frameMaps();
    if (map && Object.keys(map).length) all[tabId] = map; else delete all[tabId];
    await chrome.storage.session.set({ frameSlots: all });
  }
  /** The frame that ran the last step in each tab: where a key press without a ref goes. */
  const lastFrame = new Map();

  /** Which frame a ref lives in (0 is the page itself), and the ref block the frame was given. */
  async function frameOfRef(tabId, ref) {
    const slot = Math.floor(Number(ref) / FRAME_SPAN);
    if (!slot) return { frameId: 0, base: 0 };
    const entry = Object.entries(await framesOf(tabId)).find(([, f]) => f.slot === slot);
    if (!entry) throw new Error(`Element ${ref} is no longer on the page. Take a new look at the page and use a current ref.`);
    // Never act in a frame from a site the user blocked. (A sandboxed or srcdoc frame has no web address.)
    if (/^https?:/i.test(entry[1].url || "")) checkTarget(entry[1].url, (await settings()).blocked);
    return { frameId: Number(entry[0]), base: slot * FRAME_SPAN };
  }
  /** Where a step runs: its ref's frame, or for a key press without one, the frame the agent last worked in. */
  async function frameOfStep(tabId, step) {
    if (step.ref !== undefined && step.ref !== null) return frameOfRef(tabId, step.ref);
    if (step.action === "press" && lastFrame.get(tabId)) {
      try { return await frameOfRef(tabId, lastFrame.get(tabId)); } catch { /* That frame is gone: the page itself. */ }
    }
    return { frameId: 0, base: 0 };
  }

  async function requireOwnTab(tabId) {
    const id = Number(tabId);
    const lent = (await lentTabs()).includes(id);
    if (!lent && !(await ownTabs()).includes(id)) throw new Error("The agent can only act in tabs it opened or tabs the user lent it. Open the page with browser_open, or borrow the user's tab with browser_borrow first.");
    let tab;
    try { tab = await chrome.tabs.get(id); } catch {
      await setOwnTabs((await ownTabs()).filter(t => t !== id)); await setLentTabs((await lentTabs()).filter(t => t !== id));
      throw new Error(lent ? "The user closed that tab." : "That tab was closed. Open the page again.");
    }
    checkTarget(tab.url || tab.pendingUrl || "about:blank", (await settings()).blocked);
    return tab;
  }

  /** Marks a lent tab in the toolbar so the user can see which of their tabs the agent may use. */
  async function badge(tabId, on) {
    try {
      await chrome.action?.setBadgeText({ tabId, text: on ? "AI" : "" });
      if (on) await chrome.action?.setBadgeBackgroundColor({ tabId, color: "#7c3aed" });
    } catch { /* The badge is a convenience. */ }
  }

  /** A tab of the user's that may be lent: a normal web page, not the Synapse app itself, not blocked. */
  async function lendable(tabId) {
    let tab;
    try { tab = await chrome.tabs.get(Number(tabId)); } catch { throw new Error("That tab isn't open any more. List the user's tabs again."); }
    const url = tab.url || tab.pendingUrl || "";
    let origin = "";
    try { origin = new URL(url).origin; } catch { /* Checked below. */ }
    const { extraOrigins, blocked } = await settings();
    if (isAppOrigin(origin, extraOrigins)) throw new Error("That tab is the Synapse app itself; it can't be lent to the agent.");
    checkTarget(url || "about:blank", blocked);
    return tab;
  }

  async function lend(tabId) {
    const id = Number(tabId);
    if (!(await lentTabs()).includes(id)) await setLentTabs([...(await lentTabs()), id]);
    await badge(id, true);
  }

  /** The user's tabs as the agent may know them: title and site only, the ones they used last first. */
  async function userTabs() {
    const own = new Set(await ownTabs());
    const lent = new Set(await lentTabs());
    const used = (await session("tabUsed")) || {};
    const { extraOrigins } = await settings();
    const all = await chrome.tabs.query({});
    const list = [];
    for (const t of all) {
      if (own.has(t.id) || t.incognito) continue;
      let url;
      try { url = new URL(t.url || t.pendingUrl || ""); } catch { continue; }
      if ((url.protocol !== "https:" && url.protocol !== "http:") || isAppOrigin(url.origin, extraOrigins)) continue;
      list.push({ tabId: t.id, title: String(t.title || "").slice(0, 160), site: hostOf(url.href), ...(lent.has(t.id) ? { lent: true } : {}), lastUsed: used[t.id] || t.lastAccessed || 0 });
    }
    list.sort((a, b) => b.lastUsed - a.lastUsed);
    return { tabs: list.slice(0, 50).map(({ lastUsed, ...t }, i) => ({ ...t, ...(i === 0 ? { mostRecent: true } : {}) })) };
  }

  /**
   * Asks to use one of the user's tabs. Without a token for this exact tab and page it returns a pause, like a
   * consequential step; the app asks the user and calls again with the token.
   */
  async function borrow({ tabId, confirmToken }) {
    const tab = await lendable(tabId);
    const info = { tabId: tab.id, title: tab.title || "", site: hostOf(tab.url), url: tab.url };
    if ((await lentTabs()).includes(tab.id)) return { ...info, lent: true };
    if ((await ownTabs()).includes(tab.id)) return { ...info, lent: false, own: true };
    const grant = confirmToken && tokens.get(confirmToken);
    if (grant && grant.tabId === tab.id && grant.url === tab.url && grant.step === "borrow" && grant.expires > now()) {
      tokens.delete(confirmToken);
      await lend(tab.id);
      return { ...info, lent: true };
    }
    const token = random();
    tokens.set(token, { tabId: tab.id, url: tab.url, step: "borrow", expires: now() + TOKEN_TTL_MS });
    const title = String(tab.title || info.site).slice(0, 100);
    return { ...info, lent: false, needsConfirmation: { token, step: 0, label: `Let Synapse use your tab "${title}"`, site: info.site, where: "One of your own tabs in Chrome. It can read the page and act there; anything that buys, sends or deletes still asks you." } };
  }

  /** Hands a lent tab back to the user: it stays open. */
  async function release(tabId) {
    const id = Number(tabId);
    await setLentTabs((await lentTabs()).filter(t => t !== id));
    await cdp.detach?.(id);
    await badge(id, false);
    return { released: true, tabId: id };
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

  async function run(tabId, command, sw = untimed, frame = { frameId: 0, base: 0 }) {
    const target = frame.frameId ? { tabId, frameIds: [frame.frameId] } : { tabId };
    const args = [frame.frameId ? { ...command, base: frame.base } : command];
    let result;
    try {
      await sw.time("inject", () => chrome.scripting.executeScript({ target, files: ["page-agent.js"] }));
      [result] = await sw.time(command.op, () => chrome.scripting.executeScript({ target, func: c => globalThis.__synapseAgent.run(c), args }));
    } catch (error) {
      // The frame went away (the embed reloaded or navigated): its refs are gone with it.
      if (frame.frameId && /frame/i.test(error?.message || "")) throw new Error("That part of the page reloaded. Take a new look at the page and use a current ref.");
      throw error;
    }
    const value = result?.result;
    if (!value) throw new Error("The page didn't respond. It may still be loading, or the browser doesn't allow scripts on it.");
    if (!value.ok) throw Object.assign(new Error(value.error), { code: value.code });
    return value.value;
  }

  /** Waits until the page stops changing (or starts navigating). Never fails: a page mid-navigation can't answer. */
  async function quiet(tabId, sw = untimed) {
    try { return await run(tabId, { op: "settle" }, sw); } catch { return { navigating: true }; }
  }

  /** After an action: give the page a moment, wait for it to settle and finish any load it started. */
  async function afterAction(tabId, sw = untimed, frame = { frameId: 0, base: 0 }) {
    await sw.time("pause", () => sleep(settle));
    // An embedded form reacts inside its own frame: let it settle too.
    if (frame.frameId) { try { await run(tabId, { op: "settle" }, sw, frame); } catch { /* It navigated or went away. */ } }
    const first = await quiet(tabId, sw);
    let tab = await sw.time("load", () => waitForLoad(tabId));
    if (first?.navigating || tab.status !== "complete") { tab = await sw.time("load", () => waitForLoad(tabId)); await quiet(tabId, sw); }
    return chrome.tabs.get(tabId);
  }

  /** A screenshot with the target boxed, for the user to see before allowing a step. Optional: null if unavailable. */
  async function capture(tabId, focusRef, sw = untimed, frame = { frameId: 0, base: 0 }) {
    return sw.time("screenshot", () => captureNow(tabId, focusRef, frame));
  }
  async function captureNow(tabId, focusRef, frame) {
    if (!(await cdp.ready(tabId))) return null;
    try {
      await run(tabId, { op: "mark", refs: focusRef ? [focusRef] : [], focus: focusRef }, untimed, frame);
      return await cdp.screenshot(tabId);
    } catch { return null; }
    finally { try { await run(tabId, { op: "unmark" }, untimed, frame); } catch { /* Page moved on. */ } }
  }

  /**
   * Where a cross-origin frame's viewport sits in the window: matched among the page's frames by address and
   * size. Null when it can't be told apart (then that frame gets ordinary input).
   */
  async function frameOffset(tabId, frame) {
    if (!frame.frameId) return { x: 0, y: 0 };
    try {
      const info = await run(tabId, { op: "frameInfo" }, untimed, frame);
      const origin = new URL(info.url).origin;
      const rects = (await run(tabId, { op: "frameRects" })).filter(r => {
        let same = true;
        try { same = !r.src || new URL(r.src).origin === origin; } catch { /* No address: size decides. */ }
        return same && Math.abs(r.width - info.width) <= 2 && Math.abs(r.height - info.height) <= 2;
      });
      return rects.length === 1 ? { x: rects[0].x, y: rects[0].y } : null;
    } catch { return null; }
  }

  /** Runs a step as trusted input when it can; null when it should run the ordinary way. */
  async function preciseStep(tabId, step, sw = untimed, frame = { frameId: 0, base: 0 }) {
    if (!["click", "type", "press"].includes(step.action) || !(await cdp.ready(tabId))) return null;
    const input = work => sw.time("input", work);
    if (step.action === "press") { await input(() => cdp.key(tabId, String(step.key || ""))); return `Pressed ${step.key}`; }
    if (step.action === "click") {
      const offset = await frameOffset(tabId, frame);
      if (!offset) return null;
      const at = await run(tabId, { op: "point", ref: step.ref }, sw, frame);
      const x = at.x + offset.x, y = at.y + offset.y;
      // Inside a frame, make sure nothing on the page itself covers the frame at that point.
      if (frame.frameId) { const top = await run(tabId, { op: "at", x, y }); if (!top.frame) return null; }
      await input(() => cdp.click(tabId, x, y));
      return `Clicked ${at.role} "${at.name}"`;
    }
    if (frame.frameId) {
      // Keys go to the window's focused frame: click the field first so that is this frame, not the page.
      const offset = await frameOffset(tabId, frame);
      if (!offset) return null;
      const at = await run(tabId, { op: "point", ref: step.ref }, sw, frame);
      const x = at.x + offset.x, y = at.y + offset.y;
      if (!(await run(tabId, { op: "at", x, y })).frame) return null;
      await input(() => cdp.click(tabId, x, y));
    }
    const field = await run(tabId, { op: "focus", ref: step.ref, append: !!step.append }, sw, frame);
    const text = String(step.text ?? "");
    if (text) await input(() => cdp.insertText(tabId, text));
    else if (!step.append) await input(() => cdp.key(tabId, "Backspace")); // Empty text clears the selected contents.
    let note = `Typed into "${field.name}"`;
    if (step.submit) { await input(() => cdp.key(tabId, "Enter")); note += " and pressed Enter"; }
    return note;
  }

  async function snapshot(tabId, sw = untimed) {
    const { frames: expected = [], ...page } = await run(tabId, { op: "snapshot" }, sw);
    // Most pages have no cross-origin frame worth reading: skip the extra round trips unless one is showing or
    // the model may still hold refs into one.
    const known = Object.keys(await framesOf(tabId)).length;
    const views = expected.length || known ? await sw.time("frames", () => frameViews(tabId, expected.length)) : [];
    return { tabId, site: hostOf(page.url), ...mergeFrames(page, views, (await settings()).blocked, expected) };
  }

  /** Asks every frame in the tab for its view (one injection for all of them). Null if the browser refused. */
  async function askFrames(tabId) {
    try {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["page-agent.js"] });
      return await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: c => globalThis.__synapseAgent?.run(c), args: [{ op: "frame", textLimit: FRAME_TEXT }] });
    } catch { return null; } // A frame mid-navigation can fail the whole call: the page itself still works.
  }

  /**
   * The views of the tab's cross-origin frames, each with its own block of refs. Waits a little for visible
   * frames the page shows that haven't answered yet (an embedded form still loading after a tab switch).
   */
  async function frameViews(tabId, expected) {
    const started = now();
    for (;;) {
      const results = await askFrames(tabId);
      if (!results) return [];
      const known = await framesOf(tabId);
      const map = {};
      const used = new Set(Object.values(known).map(f => f.slot));
      const views = [];
      for (const r of results) {
        const frameId = Number(r?.frameId);
        if (!frameId) continue; // The page itself (or a test double without frames).
        let view = r.result?.ok ? r.result.value : null;
        if (!view || view.covered) continue;
        let slot = known[frameId]?.slot;
        if (!slot) { slot = 1; while (used.has(slot)) slot++; used.add(slot); }
        if (view.needsBase || view.base !== slot * FRAME_SPAN) {
          const [again] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: c => globalThis.__synapseAgent?.run(c), args: [{ op: "frame", base: slot * FRAME_SPAN, textLimit: FRAME_TEXT }] }).catch(() => []);
          view = again?.result?.ok ? again.result.value : null;
          if (!view || view.covered || view.needsBase) continue;
        }
        map[frameId] = { slot, url: String(view.url || "") };
        views.push({ frameId, ...view });
      }
      await setFrames(tabId, map); // Frames that are gone drop out, and their refs with them.
      const answered = views.filter(v => !v.hidden).length;
      if (answered >= expected || now() - started > FRAME_WAIT_MS) return views;
      await sleep(300);
    }
  }

  /** The page's own view plus what its frames show, within one element budget. */
  function mergeFrames(page, views, blockedHosts, expected = []) {
    const elements = [...page.elements];
    let { omitted = 0, text = "" } = page;
    const notes = [];
    for (const view of views) {
      if (view.hidden || view.kind !== "frame") continue;
      const host = hostOf(view.url);
      let blocked = false;
      try { checkTarget(view.url || "about:blank", blockedHosts); } catch { blocked = true; }
      if (blocked) { notes.push(`An embedded frame from ${host} is on a site you can't act on; the user has to do that part.`); continue; }
      if (AD_FRAME.test(view.url || "")) continue;
      if (CAPTCHA_FRAME.test(view.url || "")) { notes.push(`A CAPTCHA (from ${host}) is on the page: the user has to solve it themselves.`); continue; }
      const room = Math.max(0, Math.min(MAX_FRAME_ELEMENTS, MAX_ELEMENTS_TOTAL - elements.length, view.elements.length));
      // A busy page shouldn't crowd out the embedded form: give the frame at least a fair share.
      const take = view.elements.slice(0, Math.max(room, Math.min(view.elements.length, 80)));
      omitted += (view.omitted || 0) + view.elements.length - take.length;
      if (take.length) elements.push(`(inside an embedded frame from ${host})`, ...take);
      if (view.text) text += `\n\n[Embedded frame from ${host}]\n${view.text}`;
    }
    // A frame that never answered (the browser wouldn't let the agent in, or it is still loading): name its
    // address, so the assistant can open the embedded page on its own instead of giving up.
    const origins = new Set(views.map(v => { try { return new URL(v.url).origin; } catch { return ""; } }));
    for (const frame of expected) {
      let origin = "";
      try { origin = new URL(frame.src).origin; } catch { continue; }
      if (!origins.has(origin)) notes.push(`An embedded frame${frame.title ? ` "${frame.title}"` : ""} from ${hostOf(frame.src)} couldn't be read in place. If the task is in it, open its address directly with browser_open: ${frame.src}`);
    }
    return { ...page, elements, omitted, text: notes.length ? `${notes.join("\n")}\n\n${text}` : text };
  }

  /** A request's result with where its time went. */
  const timed = async (work) => {
    const sw = stopwatch(now);
    const value = await work(sw);
    return { ...value, timings: sw.result() };
  };

  async function addToGroup(tabId) {
    try {
      let groupId = await session("groupId");
      if (groupId !== undefined) { try { await chrome.tabGroups.get(groupId); } catch { groupId = undefined; } }
      groupId = await chrome.tabs.group({ tabIds: [tabId], ...(groupId !== undefined ? { groupId } : {}) });
      await chrome.tabGroups.update(groupId, { title: "Synapse", color: "purple", collapsed: false });
      await chrome.storage.session.set({ groupId });
    } catch { /* Tab groups are a convenience; the tab is still tracked. */ }
  }

  const open = ({ url, tabId }) => timed(async sw => {
    const target = checkTarget(url, (await settings()).blocked);
    let tab;
    if (tabId !== undefined && tabId !== null) {
      tab = await sw.time("checks", () => requireOwnTab(tabId));
      tab = await chrome.tabs.update(tab.id, { url: target.href });
    } else {
      tab = await chrome.tabs.create({ url: target.href, active: false });
      await setOwnTabs([...(await ownTabs()), tab.id]);
      await sw.time("group", () => addToGroup(tab.id));
    }
    await setFrames(tab.id, null); // A new page: its frames will be numbered afresh.
    lastFrame.delete(tab.id);
    await sw.time("pause", () => sleep(settle));
    await sw.time("load", () => waitForLoad(tab.id));
    await quiet(tab.id, sw);
    const loaded = await chrome.tabs.get(tab.id);
    checkTarget(loaded.url || target.href, (await settings()).blocked); // A redirect may land somewhere blocked.
    return snapshot(tab.id, sw);
  });

  /** Receives one piece of a file the app will attach in an upload step. */
  function stageFile({ fileId, name, mime, index, total, data }) {
    const id = String(fileId || "");
    if (!/^[\w.-]{1,80}$/.test(id)) throw new Error("Bad file id.");
    const count = Number(total), at = Number(index);
    if (!Number.isInteger(count) || count < 1 || count > MAX_FILE_PARTS || !Number.isInteger(at) || at < 0 || at >= count || typeof data !== "string") throw new Error("Bad file piece.");
    for (const [key, f] of files) if (f.expires < now()) files.delete(key);
    let file = files.get(id);
    if (!file || at === 0) {
      file = { name: String(name || "file").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 200), mime: String(mime || "application/octet-stream").slice(0, 120), parts: Array.from({ length: count }, () => undefined), total: count, expires: now() + FILE_TTL_MS };
      files.set(id, file);
    }
    file.parts[at] = data;
    if (file.parts.reduce((n, p) => n + (p ? p.length : 0), 0) * 0.75 > MAX_FILE_BYTES) { files.delete(id); throw new Error("That file is too large to attach (25 MB at most)."); }
    return { staged: true, received: file.parts.filter(p => p !== undefined).length, total: count };
  }
  function stagedFile(id) {
    const file = files.get(String(id || ""));
    if (!file || file.expires < now() || file.parts.some(p => p === undefined) || file.parts.length !== file.total) throw new Error("That file wasn't handed over yet. Try the upload step again.");
    return { name: file.name, mime: file.mime, data: file.parts.join("") };
  }

  const stepKey = step => JSON.stringify({ action: step.action, ref: step.ref ?? null, x: step.x ?? null, y: step.y ?? null, text: step.text ?? null, value: step.value ?? null, key: step.key ?? null,
    direction: step.direction ?? null, submit: !!step.submit, append: !!step.append });

  // ---- Screenshots, and steps given as a point on one ----

  /** The latest screenshot of each tab: image pixels per CSS pixel, and where the page was scrolled. */
  const shots = async () => (await session("shots")) || {};
  async function setShot(tabId, shot) { const all = await shots(); if (shot) all[tabId] = shot; else delete all[tabId]; await chrome.storage.session.set({ shots: all }); }

  /** Every frame the agent reads in a tab, the page itself first. */
  const allFrames = async tabId => [{ frameId: 0, base: 0 }, ...Object.entries(await framesOf(tabId)).map(([id, f]) => ({ frameId: Number(id), base: f.slot * FRAME_SPAN }))];

  /** The visible part of the tab with each element's ref boxed, at most 1280 px wide. Null if the browser won't. */
  async function shoot(tabId) {
    const frames = await allFrames(tabId);
    await Promise.all(frames.map(f => run(tabId, { op: "mark", refs: [] }, untimed, f).catch(() => null)));
    try {
      if (await cdp.ready(tabId)) return await cdp.shot(tabId);
      // Without the debugger, Chrome can only capture the tab the user has in front.
      const tab = await chrome.tabs.get(tabId);
      if (!tab.active || !chrome.tabs.captureVisibleTab) return null;
      const raw = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
      const view = await run(tabId, { op: "frameInfo" });
      return await downscale(raw, view.width, view.height);
    } catch { return null; }
    finally { await Promise.all(frames.map(f => run(tabId, { op: "unmark" }, untimed, f).catch(() => null))); }
  }
  async function downscale(dataUrl, cssWidth, cssHeight) {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const scale = Math.min(1, 1280 / Math.max(1, cssWidth));
    const width = Math.round(cssWidth * scale), height = Math.round(cssHeight * scale);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.6 })).arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { dataUrl: `data:image/jpeg;base64,${btoa(binary)}`, scale, width, height };
  }

  const screenshot = ({ tabId }) => timed(async sw => {
    const tab = await sw.time("checks", () => requireOwnTab(tabId));
    const page = await snapshot(tab.id, sw); // Fresh refs everywhere, so the boxes match the element list.
    const shot = await sw.time("screenshot", () => shoot(tab.id));
    if (!shot) throw Object.assign(new Error("Screenshots need real input turned on in the Synapse extension (open its popup and tick \"Use real mouse and keyboard input\"). Work from the element list meanwhile; if the page can't be worked from it, tell the user."), { code: "no_screenshot" });
    const top = await run(tab.id, { op: "pulse" });
    await setShot(tab.id, { scale: shot.scale, scroll: top.scroll, url: top.url });
    return { ...page, screenshot: shot.dataUrl, shotSize: { width: shot.width, height: shot.height } };
  });

  /** Which known frame a point landed in: matched by address and size. Reads the frames again if needed. */
  async function frameAtPoint(tabId, rect) {
    for (let pass = 0; pass < 2; pass++) {
      if (pass) await frameViews(tabId, 0);
      const matches = [];
      for (const frame of (await allFrames(tabId)).slice(1)) {
        try {
          const info = await run(tabId, { op: "frameInfo" }, untimed, frame);
          let same = true;
          try { same = !rect.src || new URL(rect.src).origin === new URL(info.url).origin; } catch { /* Size decides. */ }
          if (same && Math.abs(info.width - rect.width) <= 2 && Math.abs(info.height - rect.height) <= 2) matches.push(frame);
        } catch { /* Gone. */ }
      }
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) return null;
    }
    return null;
  }

  /** A step given as a point on the latest screenshot: what is there, looking into embedded frames. */
  async function locate(tabId, step) {
    const shot = (await shots())[tabId];
    if (!shot) throw new Error("Points refer to a screenshot: take one with browser_screenshot first, or use a ref.");
    const top = await run(tabId, { op: "pulse" });
    if (top.url !== shot.url || Math.abs(top.scroll - shot.scroll) > 2) throw new Error("The page moved since your last screenshot, so that point is out of date. Take a new screenshot.");
    const x = Number(step.x) / shot.scale, y = Number(step.y) / shot.scale;
    let hit = await run(tabId, { op: "at", x, y });
    let frame = { frameId: 0, base: 0 };
    if (hit.frame) {
      const found = await frameAtPoint(tabId, hit.frame);
      if (!found) return { x, y, frame: null, hit: { unknown: true, name: `something in an embedded frame from ${hostOf(hit.frame.src)}` } };
      frame = found;
      hit = await run(tabId, { op: "at", x: hit.frame.x, y: hit.frame.y }, untimed, frame);
      if (hit.frame) return { x, y, frame: null, hit: { unknown: true, name: "something in a nested embedded frame" } };
    }
    if (hit.nothing) throw new Error("There's nothing at that point of the page. Take a new screenshot.");
    return { x, y, frame, hit };
  }

  /** Clicks or hovers at a located point: real input at the exact spot when it can, else ordinary input there. */
  async function pointAction(tabId, step, located, sw) {
    const { x, y, frame, hit } = located;
    if (await cdp.ready(tabId)) {
      if (step.action === "hover") { await sw.time("input", () => cdp.move(tabId, x, y)); return { note: `Hovered over ${hit.name ? `"${hit.name}"` : "the point"}`, real: true }; }
      await sw.time("input", () => cdp.click(tabId, x, y));
      return { note: `Clicked ${hit.role || ""} "${hit.name || "at the point"}" at (${Math.round(step.x)}, ${Math.round(step.y)})`.replace(/\s+/g, " "), real: true };
    }
    if (!frame) throw new Error("That point is inside an embedded frame the agent can only reach with real input. Ask the user to turn it on in the Synapse extension, or use a ref.");
    if (step.action === "hover") return { note: await run(tabId, { op: "act", step: { action: "hover", ref: hit.ref } }, sw, frame), real: false };
    return { note: await run(tabId, { op: "clickAt", x: hit.x, y: hit.y }, sw, frame), real: false };
  }

  // ---- Did the step work? ----

  const norm = text => String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  /** What a field should show after typing, allowing for formatting the site adds (phone numbers, dates). */
  function typedOk(step, value) {
    if (value === undefined || step.submit) return true; // Not a text field we can read, or submitting cleared it.
    const want = norm(step.text), got = norm(value);
    if (!want) return step.append || got === "";
    return step.append ? got.endsWith(want) || got.includes(want) : got === want || got.includes(want) || (want.includes(got) && got.length >= want.length * 0.6);
  }
  // (Focus landing on the clicked element itself is just the click, not the page reacting.)
  const moved = (a, b, ref) => !a || !b || a.url !== b.url || a.mutations !== b.mutations || a.scroll !== b.scroll || a.state !== b.state
    || (a.focus !== b.focus && !(ref !== undefined && b.focus === Number(ref)));

  /** Compares the page after a step with before it. Returns a problem in words, or "". */
  async function check(tabId, step, frame, before, sw) {
    if (step.action !== "click" && step.action !== "type") return "";
    const ref = step.ref ?? before.ref;
    const after = { top: await run(tabId, { op: "pulse", ref: frame.frameId ? undefined : ref }, sw).catch(() => null) };
    if (frame.frameId) after.frame = await run(tabId, { op: "pulse", ref }, sw, frame).catch(() => null);
    const here = frame.frameId ? after.frame : after.top;
    if (step.action === "type") {
      if (!here) return "";
      return typedOk(step, here.value) ? "" : `The field shows "${String(here.value || "").slice(0, 80)}", not what was typed.`;
    }
    const changed = moved(before.top, after.top, frame.frameId ? undefined : ref) || (frame.frameId && moved(before.frame, after.frame, ref));
    return changed ? "" : "It changed nothing on the page.";
  }

  const act = ({ tabId, steps, confirmToken }) => timed(async sw => {
    if (!Array.isArray(steps) || !steps.length) throw new Error("Send at least one step.");
    if (steps.length > MAX_STEPS) throw new Error(`At most ${MAX_STEPS} steps at a time.`);
    stopped = false;
    let tab = await sw.time("checks", () => requireOwnTab(tabId));
    const done = [];
    const noEffect = [];
    const finish = async extra => ({ ...(await snapshot(tab.id, sw)), done, ...(noEffect.length ? { noEffect } : {}), ...extra });
    for (let i = 0; i < steps.length; i++) {
      if (stopped) return finish({ stoppedAt: i, stopReason: "Stopped by the user." });
      let step = steps[i];
      try {
        // ---- What the step acts on, and whether it may run ----
        let frame, info, located = null;
        const isPoint = (step.ref === undefined || step.ref === null) && step.x !== undefined && step.y !== undefined;
        if (isPoint) {
          if (!["click", "hover", "type"].includes(step.action)) throw new Error("Only click, hover and type can be given as a point; use a ref.");
          located = await locate(tab.id, step);
          const { hit } = located;
          if (step.action === "type") {
            if (hit.unknown || !hit.textField) throw new Error("There's no text field at that point. Click it first, then take a new look.");
            const { x, y, ...rest } = step;
            step = { ...rest, ref: hit.ref }; // Typing goes to the field itself, with all the usual checks.
            frame = located.frame;
            located = null;
          } else {
            frame = located.frame || { frameId: 0, base: 0 };
            // What can't be looked into counts as consequential: the user decides.
            info = { name: hit.name, consequential: step.action === "click" && (!!hit.unknown || !!hit.consequential), once: true,
              pulse: hit.unknown ? null : await run(tab.id, { op: "pulse", ref: hit.ref }, sw, frame), ref: hit.ref };
          }
        }
        frame ??= await frameOfStep(tab.id, step);
        info ??= await run(tab.id, { op: "inspect", step }, sw, frame);
        if (info.userOnly) {
          return finish({ stoppedAt: i, blocked: { step: i, reason: `"${info.name || "That field"}" is a ${info.userOnly}. Ask the user to fill it in themselves in the Synapse tab group, then continue.` } });
        }
        if (info.consequential || info.submitsText) {
          const grant = confirmToken && tokens.get(confirmToken);
          const valid = grant && i === 0 && grant.tabId === tab.id && grant.url === tab.url && grant.step === stepKey(step) && grant.expires > now();
          if (!valid) {
            const token = random();
            tokens.set(token, { tabId: tab.id, url: tab.url, step: stepKey(step), expires: now() + TOKEN_TTL_MS });
            const label = step.action === "type" ? `Send "${String(step.text || "").slice(0, 120)}" in "${info.name || "a text box"}"`
              : step.action === "press" ? `Press ${step.key} on "${info.name || "the focused control"}"` : `Click "${info.name || "this button"}"`;
            const shot = await capture(tab.id, step.ref, sw, frame);
            return finish({ stoppedAt: i, needsConfirmation: { token, step: i, label, site: hostOf(tab.url), ...(shot ? { screenshot: shot } : {}) } });
          }
          tokens.delete(confirmToken); // One use only.
        }

        // ---- Run it ----
        const verify = step.action === "click" || step.action === "type";
        const before = { url: tab.url, ref: info.ref, frame: frame.frameId ? info.pulse : null,
          top: !verify ? null : frame.frameId ? await run(tab.id, { op: "pulse" }, sw).catch(() => null) : info.pulse };
        let real = false;
        const ordinary = () => run(tab.id, { op: "act", step }, sw, frame);
        const attempt = async () => {
          if (located) { const r = await pointAction(tab.id, step, located, sw); real = r.real; return r.note; }
          if (step.action === "upload") return run(tab.id, { op: "act", step: { ...step, payload: stagedFile(step.file) } }, sw, frame);
          const precise = await preciseStep(tab.id, step, sw, frame);
          real = precise !== null;
          return precise ?? ordinary();
        };
        let note;
        try { note = await attempt(); }
        catch (error) {
          // A dropdown left open by the previous field: close it, let the page settle, and try once more.
          if (error?.code !== "popup") throw error;
          await run(tab.id, { op: "dismiss" }, sw, frame);
          await quiet(tab.id, sw);
          note = await attempt();
        }
        done.push(note);
        if (step.ref !== undefined && step.ref !== null) lastFrame.set(tab.id, frame.frameId ? frame.base + 1 : 0);
        tab = await afterAction(tab.id, sw, frame);

        // ---- Did it work? If ordinary input did nothing, try real input once ----
        if (tab.url === before.url && (before.top || before.frame)) {
          let problem = await check(tab.id, step, frame, before, sw);
          const retry = problem && !real && !located && !info.consequential && !info.submitsText && !info.once && (step.action === "type" ? !step.submit : true);
          if (retry) {
            const again = await preciseStep(tab.id, step, sw, frame).catch(() => null);
            if (again !== null) {
              tab = await afterAction(tab.id, sw, frame);
              const after = tab.url !== before.url ? "" : await check(tab.id, step, frame, before, sw);
              if (!after) { done[done.length - 1] = `${again} (with real input: ordinary input did nothing)`; problem = ""; }
              else problem = after;
            }
          }
          if (problem) noEffect.push(`Step ${i + 1} (${done[done.length - 1]}): ${problem}`);
        }
        if (tab.url !== before.url) {
          checkTarget(tab.url, (await settings()).blocked);
          // Refs belong to the old page; the rest of the steps must be planned against the new one.
          if (i < steps.length - 1) return finish({ stoppedAt: i + 1, stopReason: "The page changed, so the remaining steps were not run. Plan them against the new page." });
        }
      } catch (error) {
        if (i === 0) throw error;
        // Earlier steps did run: say so, rather than losing them behind the error.
        const message = error?.message || String(error);
        return finish({ stoppedAt: i, stopReason: `Step ${i + 1} (${step.action}) failed: ${message} Steps before it ran; it and the ones after it did not.` });
      }
    }
    return finish({});
  });

  /**
   * The page (and its embedded frames) as HTML for a test fixture, after a step failed: scripts and typed text
   * removed. Kept under the desktop link's 1 MB message limit.
   */
  const capturePage = ({ tabId }) => timed(async sw => {
    const tab = await sw.time("checks", () => requireOwnTab(tabId));
    const top = await run(tab.id, { op: "capture" }, sw);
    const html = top.html.slice(0, 600_000);
    let budget = 900_000 - html.length;
    const frames = [];
    for (const frame of (await allFrames(tab.id)).slice(1)) {
      try {
        const c = await run(tab.id, { op: "capture" }, sw, frame);
        if (c.html.length <= budget) { frames.push({ url: c.url, html: c.html }); budget -= c.html.length; }
      } catch { /* Gone. */ }
    }
    return { url: top.url, title: top.title, html, frames };
  });

  async function tabs() {
    const list = [];
    for (const id of await ownTabs()) {
      try { const t = await chrome.tabs.get(id); list.push({ tabId: id, url: t.url, title: t.title, site: hostOf(t.url) }); } catch { /* Closed. */ }
    }
    await setOwnTabs(list.map(t => t.tabId));
    const lent = [];
    for (const id of await lentTabs()) {
      try { const t = await chrome.tabs.get(id); lent.push({ tabId: id, url: t.url, title: t.title, site: hostOf(t.url), lent: true }); } catch { /* Closed. */ }
    }
    await setLentTabs(lent.map(t => t.tabId));
    return { tabs: [...list, ...lent] };
  }

  async function close({ tabId }) {
    const tab = await requireOwnTab(tabId);
    // The user's own tab: hand it back, never close it.
    if ((await lentTabs()).includes(tab.id)) return { ...(await release(tab.id)), closed: false, note: "That was the user's own tab: it stays open and is handed back." };
    await chrome.tabs.remove(tab.id);
    await setOwnTabs((await ownTabs()).filter(t => t !== tab.id));
    return { closed: true };
  }

  async function stopAll() {
    stopped = true;
    tokens.clear();
    files.clear();
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
      case "snapshot": return timed(async sw => snapshot((await sw.time("checks", () => requireOwnTab(message.tabId))).id, sw));
      case "act": return act(message);
      case "screenshot": return screenshot(message);
      case "capture": return capturePage(message);
      case "stage_file": return stageFile(message);
      case "read": return timed(async sw => run((await sw.time("checks", () => requireOwnTab(message.tabId))).id, { op: "read", offset: message.offset || 0 }, sw));
      case "tabs": return tabs();
      case "user_tabs": return userTabs();
      case "borrow": return borrow(message);
      case "release": { await requireOwnTab(message.tabId); if (!(await lentTabs()).includes(Number(message.tabId))) throw new Error("That tab is the agent's own; close it instead."); return release(message.tabId); }
      case "close": return close(message);
      case "stop": return stopAll();
      default: throw new Error(`Unknown request ${message.type}`);
    }
  }

  /** A message from the extension's own pages (pairing prompt, popup). */
  async function fromExtension(message) {
    if (message.type === "pair-decision") { pendingPairs.get(message.id)?.(!!message.allow); return { ok: true }; }
    if (message.type === "status") { const all = (await tabs()).tabs; return { version: VERSION, ...(await settings()), tabs: all.filter(t => !t.lent), lent: all.filter(t => t.lent), precise: await cdp.enabled() }; }
    if (message.type === "set-precise") { await chrome.storage.local.set({ precise: !!message.on }); if (!message.on) await cdp.detachAll(); return { ok: true }; }
    if (message.type === "stop") {
      await stopAll();
      for (const id of await ownTabs()) { try { await chrome.tabs.remove(id); } catch { /* Gone. */ } }
      await setOwnTabs([]);
      for (const id of await lentTabs()) await release(id); // The user's tabs stay open.
      return { stopped: true };
    }
    // The user lends or takes back one of their tabs themselves (popup or right-click menu): no token needed.
    if (message.type === "share") { const tab = await lendable(message.tabId); await lend(tab.id); return { lent: true, tabId: tab.id }; }
    if (message.type === "unshare") return release(message.tabId);
    if (message.type === "tab-state") {
      const id = Number(message.tabId);
      let shareable = true;
      try { await lendable(id); } catch { shareable = false; }
      return { lent: (await lentTabs()).includes(id), own: (await ownTabs()).includes(id), shareable };
    }
    if (message.type === "unpair") { const { paired } = await settings(); await chrome.storage.local.set({ pairedOrigins: paired.filter(o => o !== message.origin) }); return { ok: true }; }
    if (message.type === "set-blocked") { await chrome.storage.local.set({ blockedHosts: (message.hosts || []).map(h => String(h).trim().toLowerCase().replace(/^www\./, "")).filter(Boolean) }); return { ok: true }; }
    throw new Error(`Unknown request ${message.type}`);
  }

  /** Forget tabs the user closed. */
  async function tabClosed(tabId) {
    await cdp.detach(tabId);
    await setFrames(tabId, null);
    await setShot(tabId, null);
    lastFrame.delete(tabId);
    await setOwnTabs((await ownTabs()).filter(t => t !== tabId));
    await setLentTabs((await lentTabs()).filter(t => t !== tabId));
  }

  /** Remembers when the user last switched to a tab, so "the tab I was just on" can be found. */
  async function tabActivated(tabId) {
    const used = (await session("tabUsed")) || {};
    used[tabId] = now();
    const recent = Object.entries(used).sort((a, b) => b[1] - a[1]).slice(0, 200);
    await chrome.storage.session.set({ tabUsed: Object.fromEntries(recent) });
  }

  return { fromApp, fromExtension, tabClosed, tabActivated };
}

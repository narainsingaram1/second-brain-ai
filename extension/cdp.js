// Synapse browser agent: precise mode, through chrome.debugger (the Chrome DevTools Protocol, without opening
// a debugging port that any local program could use).
//
// Input sent this way arrives as real (trusted) user input, so sites that ignore synthetic events still work,
// and screenshots work on the agent's background tabs. It attaches only to tabs the agent opened, only when
// the user turned precise mode on in the extension popup (which also grants the optional "debugger"
// permission), and Chrome shows its "is debugging this browser" bar while it is attached.

const PROTOCOL = "1.3";
const KEYS = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" }, Tab: { code: "Tab", keyCode: 9 }, Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 }, ArrowDown: { code: "ArrowDown", keyCode: 40 }, ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 }, ArrowRight: { code: "ArrowRight", keyCode: 39 }, Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 }, PageDown: { code: "PageDown", keyCode: 34 }, PageUp: { code: "PageUp", keyCode: 33 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
};
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}

export function createCdp(chrome) {
  const attached = new Set();
  const refused = new Set(); // Tabs where attaching failed or the user dismissed the bar: use ordinary input there.

  chrome.debugger?.onDetach?.addListener?.((source, reason) => {
    attached.delete(source.tabId);
    if (reason === "canceled_by_user") refused.add(source.tabId);
  });

  async function enabled() {
    if (!chrome.debugger?.attach) return false;
    const { precise } = await chrome.storage.local.get("precise");
    if (!precise) return false;
    try { return await chrome.permissions.contains({ permissions: ["debugger"] }); } catch { return false; }
  }

  /** Attaches to the tab if precise mode is on and it can; false means "use ordinary input". */
  async function ready(tabId) {
    if (attached.has(tabId)) return true;
    if (refused.has(tabId) || !(await enabled())) return false;
    try { await chrome.debugger.attach({ tabId }, PROTOCOL); attached.add(tabId); return true; }
    catch { refused.add(tabId); return false; } // DevTools already open on it, or a page Chrome won't let us attach to.
  }

  const send = (tabId, method, params = {}) => withTimeout(chrome.debugger.sendCommand({ tabId }, method, params), 8000, `The browser didn't answer (${method}).`);

  async function click(tabId, x, y) {
    await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  }
  const insertText = (tabId, text) => send(tabId, "Input.insertText", { text });
  async function key(tabId, name) {
    const k = KEYS[name];
    if (!k) throw new Error(`Unsupported key "${name}".`);
    const base = { key: k.key ?? name, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
    await send(tabId, "Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) });
    await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  /** The visible part of the page as a JPEG data URL, at most `maxWidth` CSS pixels wide. */
  async function screenshot(tabId, maxWidth = 1280) {
    const { cssVisualViewport: v } = await send(tabId, "Page.getLayoutMetrics");
    const scale = Math.min(1, maxWidth / Math.max(1, v.clientWidth));
    const { data } = await withTimeout(send(tabId, "Page.captureScreenshot", {
      format: "jpeg", quality: 60, captureBeyondViewport: false,
      clip: { x: v.pageX, y: v.pageY, width: v.clientWidth, height: v.clientHeight, scale },
    }), 5000, "Screenshot timed out.");
    return `data:image/jpeg;base64,${data}`;
  }

  async function detach(tabId) {
    attached.delete(tabId); refused.delete(tabId);
    try { await chrome.debugger.detach({ tabId }); } catch { /* Already detached. */ }
  }
  async function detachAll() { await Promise.all([...attached].map(detach)); }

  return { enabled, ready, click, insertText, key, screenshot, detach, detachAll, isAttached: tabId => attached.has(tabId) };
}

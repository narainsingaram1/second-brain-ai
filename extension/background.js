// Service worker: connects Chrome to the agent core. Messages are only accepted from this extension's own
// bridge script running on a Synapse app page, or from the extension's own pages.
import { createAgent, NATIVE_ORIGIN } from "./agent-core.js";

const agent = createAgent(chrome, {
  openPairing: (origin, id) => chrome.windows.create({
    url: chrome.runtime.getURL(`pair.html?origin=${encodeURIComponent(origin)}&id=${encodeURIComponent(id)}`),
    type: "popup", width: 440, height: 400, focused: true,
  }),
});

const extensionPage = sender => sender.url?.startsWith(chrome.runtime.getURL("")) && !sender.tab?.url?.startsWith("http");

// ---- The Synapse desktop app, through native messaging ----
// Off until the user turns it on in the popup (which also grants the optional nativeMessaging permission).
// Chrome starts the Synapse app's binary as the host; only this extension's ID may (see its host manifest).
const HOST = "com.synapse.agent";
let port = null;
const setLinkState = state => chrome.storage.session.set({ desktopLinkState: state });
async function linkWanted() {
  if (!chrome.runtime.connectNative) return false;
  const { desktopLink } = await chrome.storage.local.get("desktopLink");
  return !!desktopLink;
}
async function connectDesktop() {
  if (port || !(await linkWanted())) return;
  try { port = chrome.runtime.connectNative(HOST); } catch { port = null; await setLinkState("unavailable"); return; }
  await setLinkState("connecting");
  port.onMessage.addListener(async message => {
    if (message?.type === "app-unavailable") { await setLinkState("app-closed"); return; }
    if (!message || typeof message.id !== "string" || !message.request || typeof message.request.type !== "string") return;
    await setLinkState("connected");
    const reply = await agent.fromApp(message.request, NATIVE_ORIGIN)
      .then(value => ({ id: message.id, ok: true, value }), error => ({ id: message.id, ok: false, error: error?.message || String(error), code: error?.code }));
    try { port?.postMessage(reply); } catch { /* Disconnected meanwhile. */ }
  });
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message;
    port = null;
    void setLinkState(error ? (/not found/i.test(error) ? "not-installed" : `error: ${error}`) : "disconnected");
  });
  port.postMessage({ type: "hello", version: chrome.runtime.getManifest().version });
}
async function disconnectDesktop() { try { port?.disconnect(); } catch { /* Gone. */ } port = null; await setLinkState("off"); }
// Reconnect when the app starts later: a light check every minute while the link is on.
chrome.alarms?.onAlarm.addListener(alarm => { if (alarm.name === "desktop-link") void connectDesktop(); });
async function syncLinkAlarm() {
  if (await linkWanted()) { await chrome.alarms?.create("desktop-link", { periodInMinutes: 1 }); void connectDesktop(); }
  else { await chrome.alarms?.clear("desktop-link"); await disconnectDesktop(); }
}
void syncLinkAlarm();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== "object") return false;
  if (extensionPage(sender) && message.type === "set-desktop-link") {
    chrome.storage.local.set({ desktopLink: !!message.on }).then(syncLinkAlarm).then(() => sendResponse({ ok: true, value: { on: !!message.on } }));
    return true;
  }
  if (extensionPage(sender) && message.type === "desktop-link-status") {
    Promise.all([chrome.storage.local.get("desktopLink"), chrome.storage.session.get("desktopLinkState")])
      .then(([a, b]) => sendResponse({ ok: true, value: { on: !!a.desktopLink, state: b.desktopLinkState || "off", connected: !!port } }));
    return true;
  }
  const work = extensionPage(sender) ? agent.fromExtension(message)
    // sender.origin is set by Chrome from the frame that sent it; the page cannot forge it.
    : sender.tab && sender.frameId === 0 && sender.origin ? agent.fromApp(message, sender.origin)
    : Promise.reject(new Error("Unrecognized sender."));
  work.then(value => sendResponse({ ok: true, value }), error => sendResponse({ ok: false, error: error?.message || String(error), code: error?.code }));
  return true; // Responds asynchronously.
});

chrome.tabs.onRemoved.addListener(tabId => { void agent.tabClosed(tabId); });

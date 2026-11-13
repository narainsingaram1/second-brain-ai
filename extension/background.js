// Service worker: connects Chrome to the agent core. Messages are only accepted from this extension's own
// bridge script running on a Synapse app page, or from the extension's own pages.
import { createAgent } from "./agent-core.js";

const agent = createAgent(chrome, {
  openPairing: (origin, id) => chrome.windows.create({
    url: chrome.runtime.getURL(`pair.html?origin=${encodeURIComponent(origin)}&id=${encodeURIComponent(id)}`),
    type: "popup", width: 440, height: 400, focused: true,
  }),
});

const extensionPage = sender => sender.url?.startsWith(chrome.runtime.getURL("")) && !sender.tab?.url?.startsWith("http");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== "object") return false;
  const work = extensionPage(sender) ? agent.fromExtension(message)
    // sender.origin is set by Chrome from the frame that sent it; the page cannot forge it.
    : sender.tab && sender.frameId === 0 && sender.origin ? agent.fromApp(message, sender.origin)
    : Promise.reject(new Error("Unrecognized sender."));
  work.then(value => sendResponse({ ok: true, value }), error => sendResponse({ ok: false, error: error?.message || String(error), code: error?.code }));
  return true; // Responds asynchronously.
});

chrome.tabs.onRemoved.addListener(tabId => { void agent.tabClosed(tabId); });

// Runs on Synapse app pages only. Relays requests between the app and the extension. The page talks to it
// with window.postMessage on the "synapse-browser-agent" channel; replies carry the request's id.
(() => {
  const CHANNEL = "synapse-browser-agent";
  const post = data => window.postMessage({ channel: CHANNEL, direction: "from-extension", ...data }, location.origin);
  window.addEventListener("message", event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || !data || data.channel !== CHANNEL || data.direction !== "to-extension") return;
    if (typeof data.id !== "string" || !data.request || typeof data.request.type !== "string") return;
    try {
      chrome.runtime.sendMessage(data.request, response => {
        const failure = chrome.runtime.lastError;
        if (failure) post({ id: data.id, ok: false, error: "The Synapse extension was updated or reloaded. Reload this page." });
        else post({ id: data.id, ...(response || { ok: false, error: "No response from the extension." }) });
      });
    } catch {
      post({ id: data.id, ok: false, error: "The Synapse extension was updated or reloaded. Reload this page." });
    }
  });
  post({ type: "ready", version: chrome.runtime.getManifest().version });
})();

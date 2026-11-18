const send = message => new Promise(resolve => chrome.runtime.sendMessage(message, resolve));
async function render() {
  const res = await send({ type: "status" });
  const status = res?.value;
  if (!status) { document.getElementById("state").textContent = res?.error || "Unavailable."; return; }
  document.getElementById("state").textContent = status.tabs.length ? `Working in ${status.tabs.length} tab${status.tabs.length === 1 ? "" : "s"}.` : "Idle.";
  const list = document.getElementById("paired");
  list.replaceChildren(...(status.paired.length ? status.paired.map(origin => {
    const li = document.createElement("li");
    const span = document.createElement("span"); span.textContent = origin;
    const button = document.createElement("button"); button.type = "button"; button.textContent = "Disconnect";
    button.addEventListener("click", async () => { await send({ type: "unpair", origin }); render(); });
    li.append(span, button);
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: "None yet. Connect from Synapse → Settings → Browser agent.", className: "muted" })]));
  const lent = document.getElementById("lent");
  lent.replaceChildren(...(status.lent.length ? status.lent.map(tab => {
    const li = document.createElement("li");
    const span = document.createElement("span"); span.textContent = tab.title || tab.site;
    const button = document.createElement("button"); button.type = "button"; button.textContent = "Take back";
    button.addEventListener("click", async () => { await send({ type: "unshare", tabId: tab.tabId }); render(); });
    li.append(span, button);
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: "None. The assistant asks before using one of your tabs.", className: "muted" })]));
  await renderShare();
  document.getElementById("blocked").value = status.blocked.join("\n");
  document.getElementById("precise").checked = !!status.precise; // On by default once the debugger permission is granted.
}
async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }
async function renderShare() {
  const tab = await activeTab();
  const button = document.getElementById("share");
  const state = tab?.id !== undefined ? (await send({ type: "tab-state", tabId: tab.id }))?.value : null;
  button.hidden = !state || state.own || !state.shareable;
  button.textContent = state?.lent ? "Take this tab back" : "Let Synapse use this tab";
  document.getElementById("share-state").textContent = !state || !state.shareable ? "This page can't be lent (browser pages, the Synapse app and blocked sites)."
    : state.own ? "This is one of the assistant's own tabs." : state.lent ? "Synapse may read and work in this tab." : "Lend the tab you're on so the assistant can read it and work there when you ask.";
  button.onclick = async () => { await send({ type: state?.lent ? "unshare" : "share", tabId: tab.id }); render(); };
}
document.getElementById("stop").addEventListener("click", async () => { await send({ type: "stop" }); render(); });
document.getElementById("save").addEventListener("click", async () => {
  await send({ type: "set-blocked", hosts: document.getElementById("blocked").value.split(/[\s,]+/) });
  render();
});
document.getElementById("precise").addEventListener("change", async event => {
  const box = event.target;
  // The debugger permission is optional: asked for here, from the user's own click, and given back when turned off.
  if (box.checked && !(await chrome.permissions.request({ permissions: ["debugger"] }))) { box.checked = false; return; }
  await send({ type: "set-precise", on: box.checked });
  if (!box.checked) await chrome.permissions.remove({ permissions: ["debugger"] }).catch(() => {});
  render();
});
const LINK_STATES = { connected: "Connected.", connecting: "Connecting…", "app-closed": "Open the Synapse app; it connects within a minute.",
  "not-installed": "In the Synapse app, open Settings → Browser agent and click Connect Chrome first.", disconnected: "Disconnected. It retries every minute.", off: "", unavailable: "This browser can't connect to apps." };
async function renderLink() {
  const res = await send({ type: "desktop-link-status" });
  const link = res?.value || { on: false, state: "off" };
  document.getElementById("desktop").checked = link.on;
  if (link.on) document.getElementById("desktop-state").textContent = LINK_STATES[link.state] || link.state;
}
document.getElementById("desktop").addEventListener("change", async event => {
  const box = event.target;
  if (box.checked && !(await chrome.permissions.request({ permissions: ["nativeMessaging"] }))) { box.checked = false; return; }
  await send({ type: "set-desktop-link", on: box.checked });
  if (!box.checked) await chrome.permissions.remove({ permissions: ["nativeMessaging"] }).catch(() => {});
  setTimeout(renderLink, 600);
});
renderLink();
render();

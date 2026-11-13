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
  document.getElementById("blocked").value = status.blocked.join("\n");
  document.getElementById("precise").checked = !!status.precise;
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
render();

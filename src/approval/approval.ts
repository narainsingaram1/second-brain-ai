import { invoke } from "@tauri-apps/api/core";

/**
 * The native approval window: one request, the user's answer. Deny is the default (focused, and Escape);
 * Allow is held for a moment so a click meant for something else can't land on it, and from the keyboard
 * needs ⌘↩. Only this window can send the answer; Rust checks that.
 */
interface Payload { label: string; site: string; reason?: string | null; details?: string[]; screenshot?: string | null }
type Decision = "allow" | "deny" | "deny_site";

const ARM_DELAY_MS = 700;
const id = new URLSearchParams(location.search).get("id") || "";
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
let answered = false;

async function decide(decision: Decision) {
  if (answered) return;
  answered = true;
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  try { await invoke("approval_decide", { id, decision }); }
  catch { answered = false; $("#hint").textContent = "Couldn't send your answer. Try again."; }
}

function item(text: string, className = "") {
  const li = document.createElement("li");
  li.textContent = text; // Text only: page-derived strings never become markup here.
  if (className) li.className = className;
  return li;
}

async function load() {
  let payload: Payload;
  try { payload = await invoke<Payload>("approval_payload", { id }); }
  catch (error) { $("#label").textContent = String(error); $("#label").classList.add("error"); $<HTMLButtonElement>("#deny").textContent = "Close"; return; }
  document.title = `Allow on ${payload.site}?`;
  $("#site").textContent = payload.site;
  $("#label").textContent = payload.label;
  const list = $("#details");
  if (payload.reason) list.append(item(`Why you’re asked: ${payload.reason}`, "why"));
  for (const d of payload.details || []) list.append(item(d));
  list.append(item("This happens on the website as you. It may not be undoable."));
  if (payload.screenshot && /^data:image\/(jpeg|png);base64,/.test(payload.screenshot)) {
    const box = $("#shot");
    box.classList.remove("empty"); box.textContent = "";
    const img = document.createElement("img");
    img.src = payload.screenshot; img.alt = `The page on ${payload.site}; the element that will be used is outlined in red.`;
    box.append(img);
  }
  $<HTMLButtonElement>("#deny").focus();
  setTimeout(() => { if (!answered) { $<HTMLButtonElement>("#allow").disabled = false; $("#hint").textContent = "⌘↩ to allow"; } }, ARM_DELAY_MS);
}

$("#allow").addEventListener("click", () => void decide("allow"));
$("#deny").addEventListener("click", () => void decide("deny"));
$("#never").addEventListener("click", () => void decide("deny_site"));
document.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Escape") { event.preventDefault(); void decide("deny"); }
  else if (event.key === "Enter" && event.metaKey && !$<HTMLButtonElement>("#allow").disabled) { event.preventDefault(); void decide("allow"); }
});
void load();

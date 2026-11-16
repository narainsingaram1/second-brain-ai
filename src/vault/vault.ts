import { invoke } from "@tauri-apps/api/core";
import { parseCsv } from "./csv";

/**
 * The Saved logins window (src-tauri/src/vault). Only this window can add, check or remove logins; Rust checks
 * the window. Passwords typed or imported here go straight to Rust and the Keychain, and are cleared from the
 * page right after. Nothing here ever reads a password back.
 */
interface Login { nickname: string; site: string; username: string; status: "saved" | "pending"; created: number; lastUsed?: number }

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const status = (text: string, error = false) => { const el = $("#status"); el.textContent = text; el.classList.toggle("error", error); };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const siteName = (site: string) => site.replace(/^https:\/\//, "");
const when = (seconds?: number) => seconds ? new Date(seconds * 1000).toLocaleDateString() : "never";

async function render() {
  let logins: Login[];
  try { logins = await invoke<Login[]>("vault_list"); } catch (error) { status(errorText(error), true); return; }
  const list = $("#logins");
  if (!logins.length) {
    const empty = document.createElement("li");
    empty.className = "muted"; empty.textContent = "No saved logins yet.";
    list.replaceChildren(empty);
    return;
  }
  logins.sort((a, b) => a.site.localeCompare(b.site) || a.username.localeCompare(b.username));
  list.replaceChildren(...logins.map(login => {
    const li = document.createElement("li");
    const who = document.createElement("div"); who.className = "who";
    const site = document.createElement("b"); site.textContent = siteName(login.site); // Text only, never markup.
    const user = document.createElement("span"); user.textContent = `${login.username} · last used ${when(login.lastUsed)}`;
    who.append(site, user);
    li.append(who);
    if (login.status === "pending") { const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "Not confirmed"; li.append(tag); }
    const check = document.createElement("button"); check.type = "button"; check.className = "quiet"; check.textContent = "Check";
    check.title = "Unlock it with Touch ID to make sure it's readable";
    check.addEventListener("click", async () => {
      check.disabled = true; status(`Confirm with Touch ID to check the login for ${siteName(login.site)}…`);
      try { status(await invoke<boolean>("vault_verify", { nickname: login.nickname }) ? "That login unlocks correctly." : "That login has an empty password.", false); }
      catch (error) { status(errorText(error), true); }
      finally { check.disabled = false; void render(); }
    });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "quiet danger"; remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      remove.disabled = true; status(`Confirm with Touch ID to remove the login for ${siteName(login.site)}…`);
      try { await invoke("vault_remove", { nickname: login.nickname }); status("Removed."); }
      catch (error) { status(errorText(error), true); }
      finally { void render(); }
    });
    li.append(check, remove);
    return li;
  }));
}

$("#add").addEventListener("submit", async event => {
  event.preventDefault();
  const site = $<HTMLInputElement>("#site"), username = $<HTMLInputElement>("#username"), password = $<HTMLInputElement>("#password");
  const button = $<HTMLButtonElement>("#save");
  button.disabled = true;
  try {
    const saved = await invoke<Login>("vault_add", { site: site.value, username: username.value, password: password.value });
    site.value = ""; username.value = "";
    status(`Saved the login for ${siteName(saved.site)}.`);
  } catch (error) { status(errorText(error), true); }
  finally { password.value = ""; button.disabled = false; void render(); }
});

$("#csv").addEventListener("change", async () => {
  const input = $<HTMLInputElement>("#csv");
  const file = input.files?.[0];
  if (!file) return;
  let rows: string[][] = [];
  try {
    rows = parseCsv(await file.text());
    const header = (rows.shift() || []).map(h => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    const [url, user, pass] = [col("url"), col("username"), col("password")];
    if (url < 0 || user < 0 || pass < 0) throw new Error("That file isn't a Chrome password export (it needs url, username and password columns).");
    let saved = 0;
    const failed: string[] = [];
    for (const r of rows) {
      if (!r[url] || !r[pass]) continue;
      try { await invoke("vault_add", { site: r[url], username: r[user] || "", password: r[pass] }); saved++; }
      catch { failed.push(r[url]); }
    }
    status(`Imported ${saved} login${saved === 1 ? "" : "s"}${failed.length ? `; skipped ${failed.length} (not https, or no username)` : ""}. Now delete the export file: it holds your passwords as plain text.`, false);
  } catch (error) { status(errorText(error), true); }
  finally {
    // Drop the plain-text passwords from this page.
    for (const r of rows) r.fill("");
    rows.length = 0;
    input.value = "";
    void render();
  }
});

void render();

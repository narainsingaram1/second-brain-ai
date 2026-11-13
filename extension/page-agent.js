// Synapse browser agent: the part that runs inside a web page.
//
// Injected by the extension into tabs the agent opened (isolated world, so the page's own scripts cannot
// see or call it). It turns the page into a compact list of the things a person could click or type into,
// each with a ref that stays the same for the same element across snapshots, and performs actions on those
// refs the way a person's input would arrive. It never reads password values and refuses to type into
// password or payment fields. Plain DOM code with no extension APIs, so it can be tested in any page.
(() => {
  if (globalThis.__synapseAgent?.version === 1) return;

  const MAX_ELEMENTS = 180;
  const MAX_TEXT = 6000;
  const READ_CHUNK = 12000;
  const refs = new Map(); // ref -> WeakRef(element)
  const ids = new WeakMap(); // element -> ref
  let nextRef = 1;

  const INTERACTIVE = "a[href], button, input, textarea, select, summary, [contenteditable=''], [contenteditable='true'], [tabindex]:not([tabindex='-1']), " +
    "[role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], " +
    "[role=switch], [role=combobox], [role=textbox], [role=searchbox], [role=slider], [role=spinbutton], [role=treeitem], [onclick]";

  // Fields the agent must never fill: the user types these themselves.
  const SECRET_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp|cc-exp-month|cc-exp-year)\b/i;
  const SECRET_LABEL = /\b(password|passcode|card ?number|credit card|debit card|cvv|cvc|csc|security code|expir\w* date|ssn|social security|routing number|account number|iban|swift|pin)\b/i;
  // Buttons whose click commits something on the user's behalf: these wait for the user's go-ahead.
  const CONSEQUENTIAL = /\b(buy|purchase|place (?:your )?order|pay(?: now)?|checkout|check out|complete (?:order|purchase|booking)|confirm|submit|send|post|publish|tweet|share|reply|comment|delete|remove|discard|cancel (?:my |your )?(?:order|subscription|account|membership|booking|reservation)|unsubscribe|transfer|withdraw|deposit|book(?: now)?|reserve|subscribe|sign up|create (?:an )?account|register|apply|donate|accept|agree|authori[sz]e|allow|grant|follow|connect|invite|upload|save changes|update (?:payment|account)|close account)\b/i;
  const SEARCHY = /\b(search|find|query|look ?up|where|destination|location|city|zip|postal|keyword|filter)\b/i;

  // ---- Visibility and naming ----
  function visible(el) {
    if (!el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      // A visually hidden native checkbox or radio styled through its label still counts.
      if (!(el instanceof HTMLInputElement && /^(checkbox|radio)$/.test(el.type) && el.labels?.length)) return false;
    }
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0 && !(el instanceof HTMLInputElement)) return false;
    if (el.closest("[aria-hidden='true'], [inert]")) return false;
    return true;
  }
  const clean = (text, max = 100) => {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  };
  function labelText(el) {
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const root = el.getRootNode();
      const text = by.split(/\s+/).map(id => (root.getElementById?.(id) || document.getElementById(id))?.textContent || "").join(" ");
      if (clean(text)) return clean(text);
    }
    const aria = el.getAttribute("aria-label");
    if (clean(aria)) return clean(aria);
    if (el.labels?.length) { const text = [...el.labels].map(l => l.innerText || l.textContent).join(" "); if (clean(text)) return clean(text); }
    return "";
  }
  function nameOf(el) {
    const label = labelText(el);
    if (label) return label;
    if (el instanceof HTMLInputElement && /^(submit|button|reset)$/.test(el.type)) return clean(el.value || el.type);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return clean(el.placeholder || el.title || el.name || "");
    if (el instanceof HTMLSelectElement) return clean(el.title || el.name || "");
    if (el instanceof HTMLImageElement) return clean(el.alt);
    const text = clean(el.innerText || el.textContent || "", 100);
    if (text) return text;
    const img = el.querySelector("img[alt], svg[aria-label], [aria-label]");
    return clean(img?.getAttribute("alt") || img?.getAttribute("aria-label") || el.title || el.getAttribute("data-tooltip") || "");
  }
  function roleOf(el) {
    const role = el.getAttribute("role");
    if (role) return role;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return el.multiple ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (el.type || "text").toLowerCase();
      if (/^(submit|button|reset|image)$/.test(type)) return "button";
      if (type === "checkbox" || type === "radio") return type;
      if (type === "range") return "slider";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    return "clickable";
  }
  const isTextField = el => (el instanceof HTMLInputElement && !/^(submit|button|reset|image|checkbox|radio|range|color|file|hidden)$/.test(el.type))
    || el instanceof HTMLTextAreaElement || el.isContentEditable || /^(textbox|searchbox|combobox)$/.test(el.getAttribute("role") || "");

  /** Why a field must be filled by the user, or "" if the agent may type into it. */
  function secretReason(el) {
    if (el instanceof HTMLInputElement && el.type === "password") return "password field";
    const ac = el.getAttribute("autocomplete") || "";
    if (SECRET_AUTOCOMPLETE.test(ac)) return /cc-/.test(ac) ? "payment card field" : "password or one-time code field";
    const hint = [labelText(el), el.getAttribute("name"), el.id, el.getAttribute("placeholder")].filter(Boolean).join(" ");
    if (SECRET_LABEL.test(hint)) return "sensitive field (password, payment or identity number)";
    return "";
  }
  /** True when clicking this commits something for the user (an order, a message, a deletion). */
  function consequential(el) {
    const name = nameOf(el);
    if (CONSEQUENTIAL.test(name)) return true;
    const form = el.form || el.closest?.("form");
    if (form && (el.type === "submit" || (el.tagName === "BUTTON" && !el.getAttribute("type")))) {
      // Submitting a form that holds a password or card field is consequential whatever the button says.
      if ([...form.elements].some(f => f instanceof HTMLElement && secretReason(f))) return true;
    }
    return false;
  }
  function searchLike(el) {
    if (el instanceof HTMLInputElement && el.type === "search") return true;
    if (/^(searchbox|combobox)$/.test(el.getAttribute("role") || "")) return true;
    if (el.closest("[role=search], form[role=search], search")) return true;
    return SEARCHY.test([labelText(el), el.getAttribute("placeholder"), el.getAttribute("name"), el.id].filter(Boolean).join(" "));
  }

  function refFor(el) {
    let ref = ids.get(el);
    if (!ref) { ref = nextRef++; ids.set(el, ref); refs.set(ref, new WeakRef(el)); }
    return ref;
  }
  function resolve(ref) {
    const el = refs.get(Number(ref))?.deref();
    if (!el || !el.isConnected) throw new Error(`Element ${ref} is no longer on the page. Take a new look at the page and use a current ref.`);
    return el;
  }

  /** Every element in the document, including inside open shadow roots and same-origin frames. */
  function* walk(root) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      const children = node.children || [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      if (node.shadowRoot) stack.push(node.shadowRoot);
      if (node instanceof HTMLIFrameElement) { try { if (node.contentDocument?.body) stack.push(node.contentDocument.body); } catch { /* Cross-origin frame. */ } }
      if (node instanceof Element) yield node;
    }
  }

  function describe(el) {
    const role = roleOf(el);
    const parts = [`[${refFor(el)}]`, role];
    const name = nameOf(el);
    if (name) parts.push(JSON.stringify(name));
    const flags = [];
    if (isTextField(el)) {
      if (secretReason(el)) flags.push("user-only");
      else if ("value" in el && el.value) flags.push(`value=${JSON.stringify(clean(el.value, 60))}`);
      else if (el.isContentEditable && clean(el.innerText)) flags.push(`value=${JSON.stringify(clean(el.innerText, 60))}`);
    }
    if (el instanceof HTMLSelectElement) {
      flags.push(`selected=${JSON.stringify(clean(el.selectedOptions[0]?.text || "", 40))}`);
      const options = [...el.options].slice(0, 12).map(o => clean(o.text, 30)).filter(Boolean);
      if (options.length) flags.push(`options=${JSON.stringify(options)}${el.options.length > 12 ? `+${el.options.length - 12}` : ""}`);
    }
    if (el instanceof HTMLInputElement && /^(checkbox|radio)$/.test(el.type)) flags.push(el.checked ? "checked" : "unchecked");
    const ariaChecked = el.getAttribute("aria-checked"), expanded = el.getAttribute("aria-expanded"), selected = el.getAttribute("aria-selected");
    if (ariaChecked) flags.push(ariaChecked === "true" ? "checked" : "unchecked");
    if (expanded) flags.push(expanded === "true" ? "expanded" : "collapsed");
    if (selected === "true") flags.push("selected");
    if (el.disabled || el.getAttribute("aria-disabled") === "true") flags.push("disabled");
    if (el.required) flags.push("required");
    if (el instanceof HTMLAnchorElement && el.href && !el.href.startsWith("javascript:")) {
      try { const u = new URL(el.href); if (u.host !== location.host) flags.push(`→${u.host}`); } catch { /* Ignore. */ }
    }
    if (consequential(el)) flags.push("needs-confirmation");
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) flags.push("offscreen");
    return [...parts, ...flags].join(" ");
  }

  /** The page as the agent sees it: what can be acted on (on screen first) and the main readable text. */
  function snapshot() {
    const dialog = [...document.querySelectorAll("dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]")].filter(visible).pop();
    const scope = dialog || document.body || document.documentElement;
    const seen = new Set();
    const found = [];
    for (const el of walk(scope)) {
      if (!el.matches?.(INTERACTIVE) || seen.has(el)) continue;
      if (el instanceof HTMLInputElement && el.type === "hidden") continue;
      if (!visible(el)) continue;
      // A link wrapping a single button (or the reverse) is one target.
      if (el.parentElement && seen.has(el.parentElement) && el.parentElement.matches("a[href], button") && clean(el.innerText) === clean(el.parentElement.innerText)) continue;
      seen.add(el);
      const rect = el.getBoundingClientRect();
      const onScreen = rect.bottom > 0 && rect.top < innerHeight;
      found.push({ el, order: onScreen ? 0 : Math.abs(rect.top) / innerHeight + 1 });
    }
    found.sort((a, b) => a.order - b.order);
    const elements = found.slice(0, MAX_ELEMENTS).map(f => describe(f.el));
    const main = dialog || document.querySelector("main, [role=main]") || document.body;
    const text = clean(main?.innerText || "", MAX_TEXT * 2).slice(0, MAX_TEXT);
    return {
      url: location.href, title: document.title, dialog: dialog ? clean(nameOf(dialog) || "A dialog is open", 80) : "",
      elements, omitted: Math.max(0, found.length - MAX_ELEMENTS), text,
      scroll: { y: Math.round(scrollY), height: Math.round(document.documentElement.scrollHeight), viewport: innerHeight },
    };
  }

  // ---- Input that arrives the way a person's would ----
  function point(el) {
    const r = el.getBoundingClientRect();
    return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  }
  function pointer(el, type, extra = {}) {
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, ...point(el), ...extra };
    const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, type.startsWith("pointer") ? { pointerId: 1, pointerType: "mouse", isPrimary: true, ...opts } : opts));
  }
  function keyEvent(el, type, key) {
    const codes = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, " ": 32, Space: 32, Home: 36, End: 35, PageDown: 34, PageUp: 33 };
    const k = key === "Space" ? " " : key;
    return el.dispatchEvent(new KeyboardEvent(type, { key: k, code: k === " " ? "Space" : k, keyCode: codes[key] || 0, which: codes[key] || 0, bubbles: true, cancelable: true, composed: true }));
  }
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value); // Bypasses frameworks' cached value so they see the change.
  }
  function reveal(el) {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  }
  function coveredBy(el) {
    const { clientX, clientY } = point(el);
    if (clientX < 0 || clientY < 0 || clientX > innerWidth || clientY > innerHeight) return null;
    const top = el.getRootNode().elementFromPoint?.(clientX, clientY) || document.elementFromPoint(clientX, clientY);
    if (!top || top === el || el.contains(top) || top.contains(el)) return null;
    // A label for this input is not an obstruction.
    if (top instanceof HTMLLabelElement && top.control === el) return null;
    return top;
  }

  function click(el) {
    if (el.disabled || el.getAttribute("aria-disabled") === "true") throw new Error(`"${nameOf(el) || "That element"}" is disabled. Check what the page still needs first.`);
    reveal(el);
    const cover = coveredBy(el);
    if (cover && !cover.closest("[role=dialog], dialog, [aria-modal=true]")?.contains(el)) {
      const blocker = clean(nameOf(cover) || cover.tagName.toLowerCase(), 60);
      // Something (a cookie banner, a popup) sits on top: report it instead of clicking the wrong thing.
      throw new Error(`Something is covering that element (${blocker}). Close or dismiss it first, then try again.`);
    }
    el.focus?.({ preventScroll: true });
    pointer(el, "pointerover"); pointer(el, "mouseover");
    pointer(el, "pointerdown"); pointer(el, "mousedown");
    pointer(el, "pointerup"); pointer(el, "mouseup");
    el.click(); // Fires the click event and default actions (follow a link, toggle a checkbox, submit a form).
    return `Clicked ${roleOf(el)} "${nameOf(el)}"`;
  }

  function type(el, text, { submit = false, append = false } = {}) {
    if (!isTextField(el)) throw new Error(`"${nameOf(el) || roleOf(el)}" is not a text field. Pick a textbox, or click it first if it opens one.`);
    const secret = secretReason(el);
    if (secret) throw Object.assign(new Error(`That is a ${secret}. The user has to fill it in themselves.`), { code: "user_only" });
    if (el.disabled || el.readOnly) throw new Error(`"${nameOf(el)}" can't be edited right now.`);
    reveal(el);
    el.focus({ preventScroll: true });
    pointer(el, "mousedown"); pointer(el, "mouseup"); el.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    if (el.isContentEditable) {
      const range = document.createRange(); range.selectNodeContents(el);
      if (append) range.collapse(false);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      if (!document.execCommand("insertText", false, text)) { if (!append) el.textContent = ""; el.append(text); el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" })); }
    } else {
      const next = append ? el.value + text : text;
      keyEvent(el, "keydown", text.slice(-1) || "Unidentified");
      setNativeValue(el, next);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: text, inputType: "insertText" }));
      keyEvent(el, "keyup", text.slice(-1) || "Unidentified");
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    let note = `Typed into "${nameOf(el)}"`;
    if (submit) {
      const proceed = keyEvent(el, "keydown", "Enter");
      keyEvent(el, "keypress", "Enter");
      keyEvent(el, "keyup", "Enter");
      const form = el.form || el.closest("form");
      if (proceed && form && !(el instanceof HTMLTextAreaElement)) { form.requestSubmit?.() ?? form.submit(); note += " and submitted the form"; }
      else note += " and pressed Enter";
    }
    return note;
  }

  function select(el, choice) {
    const want = String(choice).trim().toLowerCase();
    if (el instanceof HTMLSelectElement) {
      const option = [...el.options].find(o => o.value.toLowerCase() === want || clean(o.text).toLowerCase() === want)
        || [...el.options].find(o => clean(o.text).toLowerCase().includes(want));
      if (!option) throw new Error(`No option matches "${choice}". Options: ${[...el.options].map(o => clean(o.text, 30)).slice(0, 20).join(", ")}`);
      reveal(el); el.focus({ preventScroll: true });
      setNativeValue(el, option.value);
      option.selected = true;
      el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
      return `Selected "${clean(option.text)}" in "${nameOf(el)}"`;
    }
    throw new Error("That is not a dropdown list. For custom menus, click it to open, then click the option.");
  }

  function check(el, on) {
    const current = el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-checked") === "true";
    if (current === on) return `"${nameOf(el)}" was already ${on ? "checked" : "unchecked"}`;
    click(el);
    return `${on ? "Checked" : "Unchecked"} "${nameOf(el)}"`;
  }

  function press(key) {
    const el = document.activeElement || document.body;
    const allowed = /^(Enter|Escape|Tab|Backspace|ArrowDown|ArrowUp|ArrowLeft|ArrowRight|Space|Home|End|PageDown|PageUp)$/;
    if (!allowed.test(key)) throw new Error(`Unsupported key "${key}".`);
    const proceed = keyEvent(el, "keydown", key);
    keyEvent(el, "keyup", key);
    if (proceed && key === "Enter" && el instanceof HTMLElement && /^(A|BUTTON)$/.test(el.tagName)) el.click();
    if (proceed && (key === "PageDown" || key === "PageUp")) scrollBy({ top: (key === "PageDown" ? 1 : -1) * innerHeight * 0.8, behavior: "instant" });
    return `Pressed ${key}`;
  }

  function scroll(direction, el) {
    if (el) { reveal(el); return `Scrolled to "${nameOf(el)}"`; }
    const amount = innerHeight * 0.8;
    if (direction === "top") scrollTo({ top: 0, behavior: "instant" });
    else if (direction === "bottom") scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    else scrollBy({ top: direction === "up" ? -amount : amount, behavior: "instant" });
    return `Scrolled ${direction || "down"}`;
  }

  function hover(el) {
    reveal(el);
    for (const t of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]) pointer(el, t);
    return `Hovered over "${nameOf(el)}"`;
  }

  /** What the extension needs to decide whether an action is allowed, without performing it. */
  function inspect(step) {
    if (step.ref === undefined || step.ref === null) return { exists: true };
    const el = resolve(step.ref);
    return { exists: true, role: roleOf(el), name: nameOf(el), consequential: step.action === "click" && consequential(el),
      submitsText: step.action === "type" && !!step.submit && !searchLike(el), userOnly: step.action === "type" ? secretReason(el) : "" };
  }

  function act(step) {
    const el = step.ref === undefined || step.ref === null ? null : resolve(step.ref);
    switch (step.action) {
      case "click": return click(el ?? fail("click needs a ref"));
      case "type": return type(el ?? fail("type needs a ref"), String(step.text ?? ""), { submit: !!step.submit, append: !!step.append });
      case "select": return select(el ?? fail("select needs a ref"), step.value ?? step.text ?? "");
      case "check": return check(el ?? fail("check needs a ref"), true);
      case "uncheck": return check(el ?? fail("uncheck needs a ref"), false);
      case "press": return press(String(step.key || ""));
      case "scroll": return scroll(step.direction, el);
      case "hover": return hover(el ?? fail("hover needs a ref"));
      default: throw new Error(`Unknown action "${step.action}".`);
    }
  }
  function fail(message) { throw new Error(message); }

  function read(offset = 0) {
    const text = clean(document.body?.innerText || "", 2_000_000);
    const start = Math.max(0, Math.min(Number(offset) || 0, text.length));
    const end = Math.min(text.length, start + READ_CHUNK);
    return { url: location.href, title: document.title, text: text.slice(start, end), offset: start, nextOffset: end < text.length ? end : null, total: text.length };
  }

  globalThis.__synapseAgent = {
    version: 1,
    run(command) {
      try {
        if (command.op === "snapshot") return { ok: true, value: snapshot() };
        if (command.op === "inspect") return { ok: true, value: inspect(command.step) };
        if (command.op === "act") return { ok: true, value: act(command.step) };
        if (command.op === "read") return { ok: true, value: read(command.offset) };
        return { ok: false, error: `Unknown operation ${command.op}` };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), code: error?.code };
      }
    },
  };
})();

//! macOS Accessibility (AXUIElement) and keyboard events, for desktop control.
//!
//! Reads an app's focused window as a compact list of the things a person could click or type into (the same
//! `[ref] role "name" flags` shape the browser agent uses), and performs steps on them through the app's own
//! accessibility actions (AXPress, AXValue, AXSelected) rather than moving the user's mouse. Keys are posted
//! to the target app's process only. Needs the Accessibility permission (System Settings → Privacy).

#![allow(non_upper_case_globals)]

use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::base::{CFGetTypeID, CFType, CFTypeID, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::number::CFNumber;
use core_foundation::string::{CFString, CFStringRef};
use core_graphics::event::{CGEvent, CGEventFlags};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

use super::tiers::Target;

type AXUIElementRef = CFTypeRef;
type AXError = i32;
const kAXErrorSuccess: AXError = 0;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(element: AXUIElementRef, attribute: CFStringRef, value: *mut CFTypeRef) -> AXError;
    fn AXUIElementCopyMultipleAttributeValues(element: AXUIElementRef, attributes: CFArrayRef, options: u32, values: *mut CFArrayRef) -> AXError;
    fn AXUIElementSetAttributeValue(element: AXUIElementRef, attribute: CFStringRef, value: CFTypeRef) -> AXError;
    fn AXUIElementPerformAction(element: AXUIElementRef, action: CFStringRef) -> AXError;
    fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, seconds: f32) -> AXError;
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
    fn AXValueGetTypeID() -> CFTypeID;
    static kAXTrustedCheckOptionPrompt: CFStringRef;
}
#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn IsSecureEventInputEnabled() -> u8;
}

/// An accessibility element. CF objects are reference counted and safe to retain and release across threads.
#[derive(Clone)]
pub struct El(CFType);
unsafe impl Send for El {}
unsafe impl Sync for El {}

impl El {
    fn raw(&self) -> AXUIElementRef { self.0.as_CFTypeRef() }
    fn attr(&self, name: &str) -> Option<CFType> {
        let mut value: CFTypeRef = std::ptr::null();
        let err = unsafe { AXUIElementCopyAttributeValue(self.raw(), CFString::new(name).as_concrete_TypeRef(), &mut value) };
        (err == kAXErrorSuccess && !value.is_null()).then(|| unsafe { CFType::wrap_under_create_rule(value) })
    }
    /// Several attributes in one round trip to the app. Missing ones come back as None.
    fn attrs(&self, names: &[&str]) -> Vec<Option<CFType>> {
        let keys: Vec<CFString> = names.iter().map(|n| CFString::new(n)).collect();
        let array = CFArray::from_CFTypes(&keys);
        let mut out: CFArrayRef = std::ptr::null();
        let err = unsafe { AXUIElementCopyMultipleAttributeValues(self.raw(), array.as_concrete_TypeRef(), 0, &mut out) };
        if err != kAXErrorSuccess || out.is_null() { return vec![None; names.len()]; }
        let values: CFArray<CFType> = unsafe { CFArray::wrap_under_create_rule(out) };
        let error_type = unsafe { AXValueGetTypeID() };
        (0..names.len()).map(|i| values.get(i as isize).map(|v| v.clone()).filter(|v| unsafe { CFGetTypeID(v.as_CFTypeRef()) } != error_type)).collect()
    }
    fn set(&self, name: &str, value: &CFType) -> Result<(), String> {
        let err = unsafe { AXUIElementSetAttributeValue(self.raw(), CFString::new(name).as_concrete_TypeRef(), value.as_CFTypeRef()) };
        if err == kAXErrorSuccess { Ok(()) } else { Err(format!("The app refused to change {name} (error {err}).")) }
    }
    fn perform(&self, action: &str) -> Result<(), String> {
        let err = unsafe { AXUIElementPerformAction(self.raw(), CFString::new(action).as_concrete_TypeRef()) };
        if err == kAXErrorSuccess { Ok(()) } else { Err(format!("The app refused {action} (error {err}). Look again; the element may have changed.")) }
    }
}

fn as_string(v: &Option<CFType>) -> String {
    v.as_ref().and_then(|v| v.downcast::<CFString>()).map(|s| s.to_string()).unwrap_or_default()
}
fn as_bool(v: &Option<CFType>) -> Option<bool> {
    let v = v.as_ref()?;
    v.downcast::<CFBoolean>().map(bool::from).or_else(|| v.downcast::<CFNumber>().and_then(|n| n.to_i64()).map(|n| n != 0))
}
fn as_children(v: &Option<CFType>) -> Vec<El> {
    let Some(v) = v else { return vec![] };
    if v.type_of() != CFArray::<CFType>::type_id() { return vec![]; }
    let array: CFArray<CFType> = unsafe { CFArray::wrap_under_get_rule(v.as_CFTypeRef() as CFArrayRef) };
    array.iter().map(|c| El(c.clone())).collect()
}
fn clean(text: &str, max: usize) -> String {
    let t = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().count() > max { format!("{}…", t.chars().take(max - 1).collect::<String>()) } else { t }
}

pub fn trusted(prompt: bool) -> bool {
    if !prompt { return unsafe { AXIsProcessTrusted() } != 0; }
    let key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
    let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), CFBoolean::true_value().as_CFType())]);
    unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) != 0 }
}
pub fn secure_input() -> bool { unsafe { IsSecureEventInputEnabled() != 0 } }

pub fn application(pid: i32) -> El {
    let raw = unsafe { AXUIElementCreateApplication(pid) };
    unsafe { AXUIElementSetMessagingTimeout(raw, 1.0) }; // A hung app can't stall the agent for long.
    El(unsafe { CFType::wrap_under_create_rule(raw) })
}

const ATTRS: [&str; 11] = ["AXRole", "AXSubrole", "AXTitle", "AXDescription", "AXValue", "AXEnabled", "AXFocused", "AXChildren", "AXPlaceholderValue", "AXSelected", "AXHelp"];
const INTERACTIVE: &[&str] = &["AXButton", "AXTextField", "AXTextArea", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXComboBox",
    "AXLink", "AXSlider", "AXDisclosureTriangle", "AXMenuItem", "AXIncrementor", "AXRow", "AXCell", "AXTabGroup"];
const MAX_ELEMENTS: usize = 200;
const MAX_VISITED: usize = 4000;
const MAX_DEPTH: usize = 40;
const MAX_TEXT: usize = 4000;

pub struct Node { pub el: El, pub target: Target, pub line_rest: String }
pub struct Snapshot { pub window: String, pub nodes: Vec<Node>, pub omitted: usize, pub text: String, pub focused: Option<Target> }

/// The app's focused window as interactive elements (in reading order) and its visible text.
pub fn look(app: &El) -> Result<Snapshot, String> {
    if !trusted(false) { return Err("Synapse needs the Accessibility permission (System Settings → Privacy & Security → Accessibility).".into()); }
    let window = app.attr("AXFocusedWindow").map(El)
        .or_else(|| as_children(&app.attr("AXWindows")).into_iter().next())
        .ok_or("That app has no open window. Open one (or activate the app) and look again.")?;
    let title = as_string(&window.attr("AXTitle"));
    let mut nodes = Vec::new();
    let mut text = String::new();
    let mut omitted = 0;
    let mut visited = 0;
    let mut focused = None;
    // Depth-first, children in order, so the list reads top to bottom.
    let mut stack = vec![(window, 0usize)];
    while let Some((el, depth)) = stack.pop() {
        visited += 1;
        if visited > MAX_VISITED { break; }
        let v = el.attrs(&ATTRS);
        let role = as_string(&v[0]);
        let subrole = as_string(&v[1]);
        let mut name = [as_string(&v[2]), as_string(&v[3]), as_string(&v[8]), as_string(&v[10])].into_iter().find(|s| !s.trim().is_empty()).unwrap_or_default();
        let children = as_children(&v[7]);
        if role == "AXStaticText" {
            let value = clean(&as_string(&v[4]), 400);
            if !value.is_empty() && text.len() < MAX_TEXT && !text.contains(&value) { text.push_str(&value); text.push('\n'); }
        }
        if (role == "AXRow" || role == "AXCell") && name.is_empty() {
            // Rows (a note, a file, a message) are named by the text inside them.
            name = children.iter().take(4).map(|c| as_string(&c.attr("AXValue")).trim().to_string()).find(|s| !s.is_empty()).unwrap_or_default();
        }
        let target = Target { role: role.clone(), subrole: subrole.clone(), name: clean(&name, 100) };
        if as_bool(&v[6]) == Some(true) { focused = Some(target.clone()); }
        if INTERACTIVE.contains(&role.as_str()) && !(role == "AXCell" && target.name.is_empty()) {
            if nodes.len() >= MAX_ELEMENTS { omitted += 1; } else {
                let mut flags = Vec::new();
                if target.is_text() {
                    if target.is_secure() { flags.push("user-only".to_string()); }
                    else { let val = clean(&as_string(&v[4]), 60); if !val.is_empty() { flags.push(format!("value={val:?}")); } }
                }
                if matches!(role.as_str(), "AXCheckBox" | "AXRadioButton") { flags.push(if as_bool(&v[4]) == Some(true) { "checked".into() } else { "unchecked".into() }); }
                if as_bool(&v[9]) == Some(true) { flags.push("selected".into()); }
                if as_bool(&v[5]) == Some(false) { flags.push("disabled".into()); }
                if as_bool(&v[6]) == Some(true) { flags.push("focused".into()); }
                if subrole == "AXSearchField" { flags.push("search".into()); }
                nodes.push(Node { el: el.clone(), target, line_rest: flags.join(" ") });
            }
        }
        if depth < MAX_DEPTH { for child in children.into_iter().rev() { stack.push((child, depth + 1)); } }
    }
    Ok(Snapshot { window: title, nodes, omitted, text: text.chars().take(MAX_TEXT).collect(), focused })
}

/// One-line description of a node for the model.
pub fn describe(r: usize, node: &Node, consequential: bool) -> String {
    let role = node.target.role.trim_start_matches("AX").to_lowercase();
    let mut line = format!("[{r}] {role}");
    if !node.target.name.is_empty() { line.push_str(&format!(" {:?}", node.target.name)); }
    if !node.line_rest.is_empty() { line.push(' '); line.push_str(&node.line_rest); }
    if consequential { line.push_str(" needs-confirmation"); }
    line
}

pub fn press(el: &El) -> Result<(), String> {
    el.perform("AXPress").or_else(|_| el.perform("AXConfirm")).or_else(|_| el.perform("AXPick"))
}
pub fn select(el: &El) -> Result<(), String> {
    el.set("AXSelected", &CFBoolean::true_value().as_CFType())
}
pub fn set_text(el: &El, text: &str, append: bool) -> Result<(), String> {
    let _ = el.set("AXFocused", &CFBoolean::true_value().as_CFType());
    let value = if append { format!("{}{}", as_string(&el.attr("AXValue")), text) } else { text.to_string() };
    el.set("AXValue", &CFString::new(&value).as_CFType())
}

fn keycode(key: &str) -> Option<u16> {
    let k = key.to_lowercase();
    Some(match k.as_str() {
        "return" | "enter" => 36, "tab" => 48, "space" => 49, "delete" | "backspace" => 51, "escape" | "esc" => 53, "forwarddelete" => 117,
        "left" | "arrowleft" => 123, "right" | "arrowright" => 124, "down" | "arrowdown" => 125, "up" | "arrowup" => 126,
        "home" => 115, "end" => 119, "pageup" => 116, "pagedown" => 121,
        _ if k.len() == 1 => match k.as_bytes()[0] {
            b'a' => 0, b's' => 1, b'd' => 2, b'f' => 3, b'h' => 4, b'g' => 5, b'z' => 6, b'x' => 7, b'c' => 8, b'v' => 9, b'b' => 11, b'q' => 12,
            b'w' => 13, b'e' => 14, b'r' => 15, b'y' => 16, b't' => 17, b'1' => 18, b'2' => 19, b'3' => 20, b'4' => 21, b'6' => 22, b'5' => 23,
            b'9' => 25, b'7' => 26, b'8' => 28, b'0' => 29, b'o' => 31, b'u' => 32, b'i' => 34, b'p' => 35, b'l' => 37, b'j' => 38, b'k' => 40,
            b'n' => 45, b'm' => 46, _ => return None,
        },
        _ => return None,
    })
}

/// Sends a key (with modifiers) to one app's process, not to whatever is frontmost.
pub fn key(pid: i32, key: &str, modifiers: &[String]) -> Result<(), String> {
    let code = keycode(key).ok_or_else(|| format!("Unsupported key \"{key}\"."))?;
    let mut flags = CGEventFlags::empty();
    for m in modifiers {
        flags |= match m.as_str() {
            "cmd" => CGEventFlags::CGEventFlagCommand, "shift" => CGEventFlags::CGEventFlagShift,
            "option" | "alt" => CGEventFlags::CGEventFlagAlternate, "ctrl" | "control" => CGEventFlags::CGEventFlagControl,
            other => return Err(format!("Unsupported modifier \"{other}\".")),
        };
    }
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| "Couldn't create a keyboard event.")?;
    for down in [true, false] {
        let event = CGEvent::new_keyboard_event(source.clone(), code, down).map_err(|_| "Couldn't create a keyboard event.")?;
        event.set_flags(flags);
        event.post_to_pid(pid);
    }
    Ok(())
}

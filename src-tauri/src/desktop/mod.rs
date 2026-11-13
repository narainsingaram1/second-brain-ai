//! Desktop control: the assistant working in native macOS apps the user allowed, one by one.
//!
//! Rules enforced here, whatever the web layer asks:
//! - Only the main Synapse window can use these commands.
//! - Apps are off until the user allows each one (in a native approval window), and an organization's managed
//!   policy can switch the feature off or narrow the list. Password managers, Keychain, System Settings,
//!   security prompts and Synapse itself are never controllable.
//! - Every step is classified from the element it targets. Steps that send, delete, quit or type into a
//!   terminal wait for the user's go-ahead in the native approval window, asked from Rust: the web layer never
//!   holds that decision. Password fields and secure input are the user's to type.
//! - A global shortcut (⌘⌥.) stops it at the next step.

pub mod tiers;
#[cfg(target_os = "macos")]
mod ax;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, Window};
use tiers::{classify, denied_reason, preview, Step, Target, Tier};

use crate::approval::{self, ApprovalPayload, Decision};

const MAIN_WINDOW: &str = "main";
static STOP: AtomicBool = AtomicBool::new(false);

/// Asks the current desktop step loop to stop (kill switch). The next step does not run.
pub fn request_stop() {
    STOP.store(true, Ordering::SeqCst);
}

// ---- Policy ----

#[derive(serde::Serialize, serde::Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UserPolicy {
    #[serde(default)]
    pub allowed_apps: Vec<String>,
}

#[derive(serde::Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ManagedDesktop {
    pub enabled: Option<bool>,
    pub allowed_apps: Option<Vec<String>>,
    #[serde(default)]
    pub denied_apps: Vec<String>,
}
#[derive(serde::Deserialize, Default)]
struct ManagedFile {
    #[serde(default)]
    desktop: ManagedDesktop,
}

fn user_policy_path() -> PathBuf {
    crate::get_storage_dir().join("desktop_agent.json")
}
fn managed_policy_path() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(|h| PathBuf::from(h).join("Library/Application Support/Synapse/policy.json"))
}
fn load_user() -> UserPolicy {
    std::fs::read_to_string(user_policy_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
fn save_user(policy: &UserPolicy) -> Result<(), String> {
    std::fs::write(user_policy_path(), serde_json::to_string_pretty(policy).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn load_managed() -> ManagedDesktop {
    managed_policy_path().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str::<ManagedFile>(&s).ok()).map(|f| f.desktop).unwrap_or_default()
}

/// Whether the assistant may control `bundle`: never for denied apps; otherwise the stricter of the
/// organization's managed policy and the user's own allow-list.
pub fn decide_app(bundle: &str, user: &UserPolicy, managed: &ManagedDesktop) -> Result<(), String> {
    if let Some(why) = denied_reason(bundle) { return Err(why.to_string()); }
    if managed.enabled == Some(false) { return Err("Desktop control is turned off by your organization.".into()); }
    if managed.denied_apps.iter().any(|a| a == bundle) { return Err("Your organization doesn't allow the assistant in this app.".into()); }
    if let Some(allowed) = &managed.allowed_apps {
        if !allowed.iter().any(|a| a == bundle) { return Err("This app isn't on your organization's list for the assistant.".into()); }
    }
    if !user.allowed_apps.iter().any(|a| a == bundle) {
        return Err("You haven't allowed the assistant in this app. Allow it in Settings → Desktop control first.".into());
    }
    Ok(())
}

fn main_only(window: &Window) -> Result<(), String> {
    if window.label() == MAIN_WINDOW { Ok(()) } else { Err("Only the Synapse window can use desktop control.".into()) }
}

// ---- State ----

#[cfg(target_os = "macos")]
type Handle = ax::El;
#[cfg(not(target_os = "macos"))]
type Handle = ();

struct Session { pid: i32, app_name: String, window: String, nodes: Vec<(Handle, Target)>, focused: Option<Target> }
#[derive(Default)]
pub struct DesktopState { sessions: Mutex<HashMap<String, Session>> }

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo { pub bundle_id: String, pub name: String, pub pid: i32, pub active: bool, pub allowed: bool, #[serde(skip_serializing_if = "Option::is_none")] pub blocked: Option<String> }

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub app: String, pub bundle_id: String, pub window: String, pub elements: Vec<String>, pub omitted: usize, pub text: String, pub secure_input: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")] pub done: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub stopped_at: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")] pub stopped: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub user_only: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub declined: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub confirmed: Option<bool>,
}

// ---- Platform ----

#[cfg(target_os = "macos")]
fn running_apps() -> Vec<(String, String, i32, bool)> {
    use objc2_app_kit::{NSApplicationActivationPolicy, NSWorkspace};
    let own = std::process::id() as i32;
    let workspace = NSWorkspace::sharedWorkspace();
    workspace.runningApplications().iter()
        .filter(|a| a.activationPolicy() == NSApplicationActivationPolicy::Regular && a.processIdentifier() != own)
        .filter_map(|a| Some((a.bundleIdentifier()?.to_string(), a.localizedName().map(|n| n.to_string()).unwrap_or_default(), a.processIdentifier(), a.isActive())))
        .collect()
}
#[cfg(not(target_os = "macos"))]
fn running_apps() -> Vec<(String, String, i32, bool)> { vec![] }

#[cfg(target_os = "macos")]
fn activate(pid: i32) -> Result<(), String> {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid).ok_or("That app is no longer running.")?;
    #[allow(deprecated)]
    let ok = app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows);
    if ok { Ok(()) } else { Err("macOS didn't bring the app to the front.".into()) }
}

#[cfg(not(target_os = "macos"))]
fn unsupported<T>() -> Result<T, String> { Err("Desktop control is only available in the Synapse app for macOS.".into()) }

fn resolve(bundle: &str) -> Result<(i32, String), String> {
    let found = running_apps().into_iter().find(|(b, ..)| b == bundle);
    found.map(|(_, name, pid, _)| (pid, name)).ok_or_else(|| "That app isn't running. Ask the user to open it, or open it yourself if you can.".into())
}

/// Reads the app's window and stores its elements as this app's current refs.
fn look_and_store(state: &DesktopState, bundle: &str, pid: i32, app_name: &str) -> Result<View, String> {
    #[cfg(target_os = "macos")]
    {
        if !ax::trusted(false) { return Err("Synapse needs the Accessibility permission. Turn it on in Settings → Desktop control.".into()); }
        let snap = ax::look(&ax::application(pid))?;
        let elements: Vec<String> = snap.nodes.iter().enumerate().map(|(i, n)| {
            let pressable = !n.target.is_text();
            ax::describe(i + 1, n, pressable && tiers::is_consequential(&n.target.name))
        }).collect();
        let view = View { app: app_name.into(), bundle_id: bundle.into(), window: snap.window.clone(), elements, omitted: snap.omitted, text: snap.text, secure_input: ax::secure_input(), ..Default::default() };
        let nodes = snap.nodes.into_iter().map(|n| (n.el, n.target)).collect();
        state.sessions.lock().map_err(|_| "Desktop state unavailable.")?
            .insert(bundle.into(), Session { pid, app_name: app_name.into(), window: snap.window, nodes, focused: snap.focused });
        Ok(view)
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = (state, bundle, pid, app_name); unsupported() }
}

#[cfg(target_os = "macos")]
fn perform(pid: i32, step: &Step, el: Option<&Handle>) -> Result<String, String> {
    match step {
        Step::Activate => { activate(pid)?; Ok("Brought the app to the front".into()) }
        Step::Press { .. } => { ax::press(el.ok_or("No element")?)?; Ok("Pressed".into()) }
        Step::Select { .. } => { ax::select(el.ok_or("No element")?)?; Ok("Selected".into()) }
        Step::Type { text, submit, append, .. } => {
            ax::set_text(el.ok_or("No element")?, text, *append)?;
            if *submit { ax::key(pid, "Return", &[])?; Ok("Typed and pressed Return".into()) } else { Ok("Typed".into()) }
        }
        Step::Key { key, modifiers } => { ax::key(pid, key, modifiers)?; Ok(format!("Pressed {}{key}", modifiers.iter().map(|m| format!("{m}+")).collect::<String>())) }
    }
}
#[cfg(not(target_os = "macos"))]
fn perform(_: i32, _: &Step, _: Option<&Handle>) -> Result<String, String> { unsupported() }

fn label_for(step: &Step, target: Option<&Target>, app_name: &str) -> String {
    let name = target.map(|t| t.name.as_str()).filter(|n| !n.is_empty()).unwrap_or("the selected element");
    match step {
        Step::Press { .. } => format!("Click \"{name}\" in {app_name}"),
        Step::Select { .. } => format!("Select \"{name}\" in {app_name}"),
        Step::Type { text, submit, .. } => format!("Type \"{}\" in \"{name}\" in {app_name}{}", preview(text), if *submit { " and press Return" } else { "" }),
        Step::Key { key, modifiers } => format!("Press {}{key} in {app_name}", modifiers.iter().map(|m| format!("{m}+")).collect::<String>()),
        Step::Activate => format!("Bring {app_name} to the front"),
    }
}

// ---- Commands ----

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status { supported: bool, trusted: bool, secure_input: bool, allowed_apps: Vec<String>, managed_off: bool }

#[tauri::command]
pub fn desktop_status(window: Window) -> Result<Status, String> {
    main_only(&window)?;
    #[cfg(target_os = "macos")]
    let (supported, trusted, secure) = (true, ax::trusted(false), ax::secure_input());
    #[cfg(not(target_os = "macos"))]
    let (supported, trusted, secure) = (false, false, false);
    Ok(Status { supported, trusted, secure_input: secure, allowed_apps: load_user().allowed_apps, managed_off: load_managed().enabled == Some(false) })
}

/// Shows macOS's Accessibility prompt (it opens System Settings). Returns whether access is already granted.
#[tauri::command]
pub fn desktop_request_access(window: Window) -> Result<bool, String> {
    main_only(&window)?;
    #[cfg(target_os = "macos")]
    { Ok(ax::trusted(true)) }
    #[cfg(not(target_os = "macos"))]
    { unsupported() }
}

#[tauri::command]
pub fn desktop_apps(window: Window) -> Result<Vec<AppInfo>, String> {
    main_only(&window)?;
    let (user, managed) = (load_user(), load_managed());
    let mut apps: Vec<AppInfo> = running_apps().into_iter().map(|(bundle_id, name, pid, active)| {
        let decision = decide_app(&bundle_id, &user, &managed);
        let blocked = denied_reason(&bundle_id).map(String::from);
        AppInfo { allowed: decision.is_ok(), blocked, bundle_id, name, pid, active }
    }).collect();
    apps.sort_by(|a, b| b.active.cmp(&a.active).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(apps)
}

/// Allows or stops the assistant in an app. Allowing asks the user in the native approval window first.
#[tauri::command]
pub async fn desktop_allow_app(app: AppHandle, window: Window, bundle_id: String, name: String, allow: bool) -> Result<Vec<String>, String> {
    main_only(&window)?;
    let mut user = load_user();
    if !allow {
        user.allowed_apps.retain(|a| a != &bundle_id);
        save_user(&user)?;
        if let Ok(mut s) = app.state::<DesktopState>().sessions.lock() { s.remove(&bundle_id); }
        return Ok(user.allowed_apps);
    }
    if let Some(why) = denied_reason(&bundle_id) { return Err(why.into()); }
    let mut details = vec![
        format!("It can read what's in {name}'s windows, and click and type there."),
        "Anything that sends, deletes or quits still asks you first.".to_string(),
    ];
    if tiers::is_terminal(&bundle_id) { details.push("This app can run commands: every keystroke batch will ask you first.".into()); }
    let decision = approval::ask(&app, ApprovalPayload { label: format!("Let Synapse control {name}?"), site: name.clone(), reason: None, details, screenshot: None }).await?;
    if decision != Decision::Allow { return Ok(user.allowed_apps); }
    user = load_user();
    if !user.allowed_apps.contains(&bundle_id) { user.allowed_apps.push(bundle_id); }
    save_user(&user)?;
    Ok(user.allowed_apps)
}

#[tauri::command]
pub fn desktop_look(app: AppHandle, window: Window, bundle_id: String) -> Result<View, String> {
    main_only(&window)?;
    decide_app(&bundle_id, &load_user(), &load_managed())?;
    let (pid, name) = resolve(&bundle_id)?;
    look_and_store(&app.state::<DesktopState>(), &bundle_id, pid, &name)
}

#[tauri::command]
pub async fn desktop_act(app: AppHandle, window: Window, bundle_id: String, steps: Vec<Step>) -> Result<View, String> {
    main_only(&window)?;
    if steps.is_empty() || steps.len() > 10 { return Err("Send between 1 and 10 steps.".into()); }
    decide_app(&bundle_id, &load_user(), &load_managed())?;
    let (pid, _) = resolve(&bundle_id)?;
    STOP.store(false, Ordering::SeqCst);
    // Copy what this batch needs out of the lock: the approval window is awaited below.
    let (app_name, window_title, nodes, focused) = {
        let sessions = app.state::<DesktopState>();
        let guard = sessions.sessions.lock().map_err(|_| "Desktop state unavailable.")?;
        let s = guard.get(&bundle_id).filter(|s| s.pid == pid).ok_or("Look at the app first (desktop_look); refs come from your latest look.")?;
        (s.app_name.clone(), s.window.clone(), s.nodes.clone(), s.focused.clone())
    };
    #[cfg(target_os = "macos")]
    let secure = ax::secure_input();
    #[cfg(not(target_os = "macos"))]
    let secure = false;

    let mut done = Vec::new();
    let mut outcome = View::default();
    for (i, step) in steps.iter().enumerate() {
        if STOP.load(Ordering::SeqCst) { outcome.stopped_at = Some(i); outcome.stopped = Some("Stopped by the user.".into()); break; }
        let node = match step.target_ref() {
            Some(r) => Some(nodes.get(r.wrapping_sub(1)).ok_or_else(|| format!("Element {r} isn't in your latest look at {app_name}. Look again."))?),
            None => None,
        };
        let target = node.map(|(_, t)| t);
        let (tier, reason) = classify(&bundle_id, step, target, focused.as_ref(), secure);
        let label = label_for(step, target, &app_name);
        match tier {
            Tier::UserOnly => { outcome.stopped_at = Some(i); outcome.user_only = Some(reason.unwrap_or_default()); break; }
            Tier::Hard => {
                let mut details = vec![format!("In {app_name}, window \"{window_title}\".")];
                if let Step::Type { text, .. } = step { details.push(format!("Exact text: {}", preview(text))); }
                let decision = approval::ask(&app, ApprovalPayload { label: label.clone(), site: app_name.clone(), reason, details, screenshot: None }).await?;
                if decision == Decision::DenySite {
                    let mut user = load_user();
                    user.allowed_apps.retain(|a| a != &bundle_id);
                    save_user(&user)?;
                }
                if decision != Decision::Allow {
                    outcome.stopped_at = Some(i);
                    outcome.confirmed = Some(false);
                    outcome.declined = Some(format!("The user did not allow: {label}. That step and the ones after it were not run. Don't try another way."));
                    break;
                }
                outcome.confirmed = Some(true);
            }
            _ => {}
        }
        perform(pid, step, node.map(|(h, _)| h)).map_err(|e| format!("{label}: {e}"))?;
        done.push(label);
        std::thread::sleep(std::time::Duration::from_millis(if matches!(step, Step::Activate) { 300 } else { 120 }));
    }
    // A fresh look after the batch: refs for the next step.
    let mut view = look_and_store(&app.state::<DesktopState>(), &bundle_id, pid, &app_name)?;
    view.done = done;
    view.stopped_at = outcome.stopped_at;
    view.stopped = outcome.stopped;
    view.user_only = outcome.user_only;
    view.declined = outcome.declined;
    view.confirmed = outcome.confirmed;
    Ok(view)
}

#[tauri::command]
pub fn desktop_stop(window: Window) -> Result<(), String> {
    main_only(&window)?;
    request_stop();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apps_are_off_until_allowed_and_managed_policy_wins() {
        let none = UserPolicy::default();
        let notes = UserPolicy { allowed_apps: vec!["com.apple.Notes".into()] };
        let open = ManagedDesktop::default();
        assert!(decide_app("com.apple.Notes", &none, &open).is_err(), "default deny");
        assert!(decide_app("com.apple.Notes", &notes, &open).is_ok());
        let keychain = UserPolicy { allowed_apps: vec!["com.apple.keychainaccess".into()] };
        assert!(decide_app("com.apple.keychainaccess", &keychain, &open).is_err(), "denied apps can't be allowed");
        let off = ManagedDesktop { enabled: Some(false), ..Default::default() };
        assert!(decide_app("com.apple.Notes", &notes, &off).unwrap_err().contains("organization"));
        let narrow = ManagedDesktop { allowed_apps: Some(vec!["com.apple.finder".into()]), ..Default::default() };
        assert!(decide_app("com.apple.Notes", &notes, &narrow).is_err());
        let deny = ManagedDesktop { denied_apps: vec!["com.apple.Notes".into()], ..Default::default() };
        assert!(decide_app("com.apple.Notes", &notes, &deny).is_err());
    }

    #[test]
    fn approval_labels_show_the_exact_action() {
        let t = Target { role: "AXButton".into(), subrole: String::new(), name: "Send".into() };
        assert_eq!(label_for(&Step::Press { r#ref: 1 }, Some(&t), "Mail"), "Click \"Send\" in Mail");
        let field = Target { role: "AXTextArea".into(), subrole: String::new(), name: "shell".into() };
        assert_eq!(label_for(&Step::Type { r#ref: 1, text: "ls -la\n".into(), submit: true, append: false }, Some(&field), "Terminal"),
            "Type \"ls -la⏎\" in \"shell\" in Terminal and press Return");
        assert_eq!(label_for(&Step::Key { key: "q".into(), modifiers: vec!["cmd".into()] }, None, "Notes"), "Press cmd+q in Notes");
    }

    #[test]
    fn managed_policy_file_shape() {
        let f: ManagedFile = serde_json::from_str(r#"{"desktop":{"enabled":true,"allowedApps":["com.apple.Notes"],"deniedApps":["com.apple.mail"]}}"#).unwrap();
        assert_eq!(f.desktop.allowed_apps.unwrap(), vec!["com.apple.Notes".to_string()]);
        assert_eq!(f.desktop.denied_apps, vec!["com.apple.mail".to_string()]);
        let empty: ManagedFile = serde_json::from_str("{}").unwrap();
        assert!(empty.desktop.enabled.is_none());
    }
}

/// Live check against this Mac (read-only): `cargo test --lib live_look_at_finder -- --ignored --nocapture`.
/// Needs the Accessibility permission for the process running the tests.
#[cfg(all(test, target_os = "macos"))]
mod live {
    use super::*;
    #[test]
    #[ignore]
    fn live_look_at_finder() {
        println!("trusted: {}", ax::trusted(false));
        println!("secure input: {}", ax::secure_input());
        let apps = running_apps();
        println!("{} regular apps, e.g. {:?}", apps.len(), apps.iter().take(5).map(|a| &a.0).collect::<Vec<_>>());
        let (pid, name) = resolve("com.apple.finder").expect("Finder runs");
        let start = std::time::Instant::now();
        let snap = ax::look(&ax::application(pid));
        match snap {
            Ok(s) => {
                println!("{name} window {:?}: {} elements (+{} omitted), {} chars of text, in {:?}", s.window, s.nodes.len(), s.omitted, s.text.len(), start.elapsed());
                for (i, n) in s.nodes.iter().take(25).enumerate() { println!("  {}", ax::describe(i + 1, n, tiers::is_consequential(&n.target.name))); }
            }
            Err(e) => println!("look failed: {e}"),
        }
    }
}

//! Native approval window for steps that commit something on the user's behalf (send, pay, delete, post…).
//!
//! The main window asks with `approval_request`. Rust opens a separate, always-on-top window for that one
//! request and waits. Only that window can answer (`approval_decide` checks the caller's window label), so
//! script in the main window cannot approve a step by itself; it can only withdraw a request
//! (`approval_cancel`), which counts as Deny. Closing the window also counts as Deny.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::async_runtime::{channel, Sender};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};

const MAIN_WINDOW: &str = "main";
const WINDOW_PREFIX: &str = "approval-";
const MAX_SCREENSHOT_BYTES: usize = 4 * 1024 * 1024;
const MAX_TEXT: usize = 2000;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalPayload {
    pub label: String,
    pub site: String,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub details: Vec<String>,
    /// A JPEG/PNG data URL of the page with the target boxed.
    #[serde(default)]
    pub screenshot: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Allow,
    Deny,
    /// Deny, and never act on this site again (the app adds it to the user's policy).
    DenySite,
}

struct Pending {
    payload: ApprovalPayload,
    reply: Sender<Decision>,
}

#[derive(Default)]
pub struct Approvals {
    pending: Mutex<HashMap<String, Pending>>,
}

impl Approvals {
    /// Sends the decision for `id` once; later answers for the same request are ignored.
    fn settle(&self, id: &str, decision: Decision) -> bool {
        let entry = self.pending.lock().map(|mut p| p.remove(id)).ok().flatten();
        match entry {
            Some(pending) => pending.reply.try_send(decision).is_ok(),
            None => false,
        }
    }
}

static COUNTER: AtomicU64 = AtomicU64::new(1);
fn new_id() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{:016x}{:08x}", nanos ^ n.wrapping_mul(0x9E37_79B9_7F4A_7C15), n as u32)
}

pub fn window_label(id: &str) -> String {
    format!("{WINDOW_PREFIX}{id}")
}

/// The caller may answer request `id` only from that request's own approval window.
pub fn may_decide(caller_label: &str, id: &str) -> bool {
    !id.is_empty() && caller_label == window_label(id)
}

/// Rejects payloads that are too large or malformed before any window opens.
pub fn validate(payload: &ApprovalPayload) -> Result<(), String> {
    if payload.label.trim().is_empty() {
        return Err("An approval needs a description of the step.".into());
    }
    let texts = [&payload.label, &payload.site].into_iter().chain(payload.reason.iter()).chain(payload.details.iter());
    if texts.into_iter().any(|t| t.chars().count() > MAX_TEXT) || payload.details.len() > 12 {
        return Err("The approval text is too long.".into());
    }
    if let Some(shot) = &payload.screenshot {
        let image = shot.starts_with("data:image/jpeg;base64,") || shot.starts_with("data:image/png;base64,");
        if !image || shot.len() > MAX_SCREENSHOT_BYTES {
            return Err("The screenshot must be a JPEG or PNG data URL under 4 MB.".into());
        }
    }
    Ok(())
}

/// Opens the approval window and waits for the user's answer. Only the main window may ask.
#[tauri::command]
pub async fn approval_request(app: AppHandle, window: Window, request: ApprovalPayload) -> Result<Decision, String> {
    if window.label() != MAIN_WINDOW {
        return Err("Only the Synapse window can ask for approval.".into());
    }
    validate(&request)?;
    let id = new_id();
    let (reply, mut answer) = channel::<Decision>(1);
    let title = format!("Allow on {}?", request.site);
    app.state::<Approvals>().pending.lock().map_err(|_| "Approval state is unavailable.")?
        .insert(id.clone(), Pending { payload: request, reply });

    let url = WebviewUrl::App(format!("approval.html?id={id}").into());
    let built = WebviewWindowBuilder::new(&app, window_label(&id), url)
        .title(title)
        .inner_size(560.0, 660.0)
        .resizable(false)
        .minimizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .center()
        .focused(true)
        .build();
    let approval_window = match built {
        Ok(w) => w,
        Err(error) => {
            app.state::<Approvals>().settle(&id, Decision::Deny);
            return Err(format!("Couldn't open the approval window: {error}"));
        }
    };
    // Closing the window without answering is a Deny.
    let handle = app.clone();
    let closing_id = id.clone();
    approval_window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed | WindowEvent::CloseRequested { .. }) {
            handle.state::<Approvals>().settle(&closing_id, Decision::Deny);
        }
    });

    let decision = answer.recv().await.unwrap_or(Decision::Deny);
    if let Some(w) = app.get_webview_window(&window_label(&id)) {
        let _ = w.destroy();
    }
    Ok(decision)
}

/// What the approval window shows. Only that request's window can read it.
#[tauri::command]
pub fn approval_payload(app: AppHandle, window: Window, id: String) -> Result<ApprovalPayload, String> {
    if !may_decide(window.label(), &id) {
        return Err("Not this window's request.".into());
    }
    let pending = app.state::<Approvals>();
    let guard = pending.pending.lock().map_err(|_| "Approval state is unavailable.")?;
    guard.get(&id).map(|p| p.payload.clone()).ok_or_else(|| "This request was already answered or withdrawn.".into())
}

/// The user's answer, from the approval window only.
#[tauri::command]
pub fn approval_decide(app: AppHandle, window: Window, id: String, decision: Decision) -> Result<bool, String> {
    if !may_decide(window.label(), &id) {
        return Err("Only the approval window can answer this request.".into());
    }
    Ok(app.state::<Approvals>().settle(&id, decision))
}

/// The main window withdraws its open requests (the turn was stopped or timed out). Always a Deny.
#[tauri::command]
pub fn approval_cancel_all(app: AppHandle, window: Window) -> Result<usize, String> {
    if window.label() != MAIN_WINDOW {
        return Err("Only the Synapse window can withdraw a request.".into());
    }
    let ids: Vec<String> = app.state::<Approvals>().pending.lock().map(|p| p.keys().cloned().collect()).unwrap_or_default();
    Ok(ids.iter().filter(|id| app.state::<Approvals>().settle(id, Decision::Deny)).count())
}

/// Brings an open approval window to the front (from the "Show it" button in chat).
#[tauri::command]
pub fn approval_focus(app: AppHandle) -> bool {
    app.webview_windows().iter().filter(|(label, _)| label.starts_with(WINDOW_PREFIX)).fold(false, |_, (_, w)| {
        let _ = w.unminimize();
        let _ = w.show();
        w.set_focus().is_ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload() -> ApprovalPayload {
        ApprovalPayload { label: "Click \"Place order\"".into(), site: "shop.example".into(), reason: None, details: vec![], screenshot: None }
    }

    #[test]
    fn only_the_requests_own_window_may_answer() {
        let id = new_id();
        assert!(may_decide(&window_label(&id), &id));
        assert!(!may_decide("main", &id));
        assert!(!may_decide(&window_label("other"), &id));
        assert!(!may_decide("approval-", ""));
    }

    #[test]
    fn ids_are_unique() {
        let ids: std::collections::HashSet<_> = (0..1000).map(|_| new_id()).collect();
        assert_eq!(ids.len(), 1000);
    }

    #[test]
    fn payloads_are_checked() {
        assert!(validate(&payload()).is_ok());
        assert!(validate(&ApprovalPayload { label: " ".into(), ..payload() }).is_err());
        assert!(validate(&ApprovalPayload { label: "x".repeat(MAX_TEXT + 1), ..payload() }).is_err());
        assert!(validate(&ApprovalPayload { screenshot: Some("data:image/jpeg;base64,AAAA".into()), ..payload() }).is_ok());
        assert!(validate(&ApprovalPayload { screenshot: Some("https://evil.example/x.png".into()), ..payload() }).is_err());
        assert!(validate(&ApprovalPayload { screenshot: Some("data:text/html;base64,PHNjcmlwdD4=".into()), ..payload() }).is_err());
        let huge = format!("data:image/png;base64,{}", "A".repeat(MAX_SCREENSHOT_BYTES));
        assert!(validate(&ApprovalPayload { screenshot: Some(huge), ..payload() }).is_err());
    }

    #[test]
    fn a_request_is_answered_once() {
        let approvals = Approvals::default();
        let (reply, mut rx) = channel::<Decision>(1);
        approvals.pending.lock().unwrap().insert("a".into(), Pending { payload: payload(), reply });
        assert!(approvals.settle("a", Decision::Allow));
        assert!(!approvals.settle("a", Decision::Deny), "a second answer is ignored");
        assert_eq!(rx.try_recv().ok(), Some(Decision::Allow));
    }

    #[test]
    fn decisions_use_snake_case_names() {
        assert_eq!(serde_json::to_string(&Decision::DenySite).unwrap(), "\"deny_site\"");
        assert_eq!(serde_json::from_str::<Decision>("\"allow\"").unwrap(), Decision::Allow);
    }
}

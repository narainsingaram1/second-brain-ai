mod approval;
mod desktop;
mod vault;
mod hub;

use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, Code, ShortcutState};

fn get_storage_dir() -> PathBuf {
    let dir = if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".second_brain_ai")
    } else if let Ok(profile) = std::env::var("USERPROFILE") {
        PathBuf::from(profile).join(".second_brain_ai")
    } else {
        PathBuf::from(".second_brain_ai")
    };
    let _ = fs::create_dir_all(&dir);
    dir
}

static WRITE_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Replaces `path` without ever leaving it half-written: the data goes to a temporary file in the same
/// directory, is flushed to disk, and is then renamed over the old file (an atomic step on one filesystem).
/// A crash mid-save leaves the previous complete file in place instead of a truncated one.
fn write_atomic(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let n = WRITE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let name = path.file_name().and_then(|f| f.to_str()).unwrap_or("data");
    let tmp = path.with_file_name(format!(".{}.{}.{}.tmp", name, std::process::id(), n));
    let result = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(data)?;
        file.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Runs blocking file work off the main thread, so saving a large workspace never stalls the window.
async fn off_main<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("Storage task failed: {}", e))?
}

#[tauri::command]
async fn save_brain_data(data: String) -> Result<bool, String> {
    off_main(move || {
        let path = get_storage_dir().join("brain_state.json");
        write_atomic(&path, data.as_bytes()).map_err(|e| format!("Failed to save data: {}", e))?;
        Ok(true)
    })
    .await
}

// Synchronous commands run on the main thread, which also drives the window: reading a large workspace there
// freezes the UI at startup. File reads and writes go through `off_main` instead.
#[tauri::command]
async fn load_brain_data() -> Result<Option<String>, String> {
    off_main(|| {
        let path = get_storage_dir().join("brain_state.json");
        if path.exists() {
            let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read data: {}", e))?;
            Ok(Some(content))
        } else {
            Ok(None)
        }
    })
    .await
}

#[tauri::command]
fn save_openrouter_api_key(api_key: String) -> Result<bool, String> {
    let path = get_storage_dir().join("openrouter.key");
    fs::write(&path, api_key.trim()).map_err(|e| format!("Failed to save API key: {}", e))?;
    Ok(true)
}

#[tauri::command]
fn get_openrouter_api_key() -> Result<Option<String>, String> {
    if let Ok(env_key) = std::env::var("OPENROUTER_API_KEY") {
        if !env_key.trim().is_empty() {
            return Ok(Some(env_key.trim().to_string()));
        }
    }
    let path = get_storage_dir().join("openrouter.key");
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read API key: {}", e))?;
        let trimmed = content.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed));
        }
    }
    Ok(None)
}

#[tauri::command]
async fn export_backup(content: String, filename: String) -> Result<String, String> {
    off_main(move || {
        let desktop_dir = if let Ok(home) = std::env::var("HOME") {
            PathBuf::from(home).join("Desktop")
        } else {
            get_storage_dir()
        };
        let file_path = desktop_dir.join(&filename);
        fs::write(&file_path, content).map_err(|e| format!("Failed to export backup: {}", e))?;
        Ok(file_path.to_string_lossy().to_string())
    })
    .await
}

#[tauri::command]
async fn save_user_state(user_id: String, data: String) -> Result<bool, String> {
    off_main(move || {
        let dir = get_storage_dir().join("users");
        let _ = fs::create_dir_all(&dir);
        let safe_id: String = user_id
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect();
        let path = dir.join(format!("{}.json", safe_id));
        write_atomic(&path, data.as_bytes()).map_err(|e| format!("Failed to save user state: {}", e))?;
        Ok(true)
    })
    .await
}

#[tauri::command]
async fn load_user_state(user_id: String) -> Result<Option<String>, String> {
    off_main(move || {
        let dir = get_storage_dir().join("users");
        let safe_id: String = user_id
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect();
        let path = dir.join(format!("{}.json", safe_id));
        if path.exists() {
            let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read user state: {}", e))?;
            Ok(Some(content))
        } else {
            Ok(None)
        }
    })
    .await
}

#[tauri::command]
async fn save_auth_database(users_json: String, session_json: String) -> Result<bool, String> {
    off_main(move || {
        let dir = get_storage_dir();
        write_atomic(&dir.join("auth_users.json"), users_json.as_bytes()).map_err(|e| format!("Failed to save auth users: {}", e))?;
        write_atomic(&dir.join("auth_session.json"), session_json.as_bytes()).map_err(|e| format!("Failed to save auth session: {}", e))?;
        Ok(true)
    })
    .await
}

#[tauri::command]
async fn load_auth_database() -> Result<(Option<String>, Option<String>), String> {
    off_main(|| {
        let dir = get_storage_dir();
        let users = fs::read_to_string(dir.join("auth_users.json")).ok();
        let session = fs::read_to_string(dir.join("auth_session.json")).ok();
        Ok((users, session))
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Started by an MCP client (`--mcp`) or by Chrome for the extension: relay to the running app, no window.
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--mcp") { hub::run_mcp_proxy(); return; }
    if let Some(origin) = args.get(1).filter(|a| a.starts_with("chrome-extension://")) { hub::run_native_host(origin); return; }

    let mut builder = tauri::Builder::default();

    // Configure global hotkey: ⌘⌥N (CommandOrControl+Alt+N) & ⌥⇧N (Alt+Shift+N)
    // Avoids browser collisions like ⌘⇧N (Incognito window in Chrome/Brave/Edge)
    if let Ok(shortcut_plugin) = ShortcutBuilder::new()
        // ⌘⌥. stops the assistant: the desktop step loop at its next step, and the turn in the main window.
        .with_shortcuts(["CommandOrControl+Alt+N", "Alt+Shift+N", "CommandOrControl+Alt+Period"])
        .and_then(|b| {
            Ok(b.with_handler(|app, shortcut, event| {
                if event.state() == ShortcutState::Pressed && shortcut.key == Code::Period {
                    desktop::request_stop();
                    let _ = app.emit("agent-stop", ());
                    return;
                }
                if event.state() == ShortcutState::Pressed {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        let _ = window.emit("open-quick-capture", ());
                    }
                }
            })
            .build())
        })
    {
        builder = builder.plugin(shortcut_plugin);
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .manage(approval::Approvals::default())
        .manage(desktop::DesktopState::default())
        .manage(vault::VaultState::default())
        .manage(hub::Hub::default())
        .setup(|app| { hub::start(app.handle().clone()); Ok(()) })
        .invoke_handler(tauri::generate_handler![
            approval::approval_request,
            approval::approval_payload,
            approval::approval_decide,
            approval::approval_cancel_all,
            approval::approval_focus,
            desktop::desktop_status,
            desktop::desktop_request_access,
            desktop::desktop_apps,
            desktop::desktop_allow_app,
            desktop::desktop_look,
            desktop::desktop_act,
            desktop::desktop_read,
            desktop::desktop_document,
            vault::vault_open,
            vault::vault_list,
            vault::vault_add,
            vault::vault_remove,
            vault::vault_verify,
            desktop::desktop_stop,
            hub::browser_link_status,
            hub::browser_call,
            hub::browser_confirm,
            hub::browser_install_link,
            hub::mcp_register_tools,
            hub::mcp_status,
            hub::mcp_set_enabled,
            hub::mcp_result,
            save_brain_data,
            load_brain_data,
            save_openrouter_api_key,
            get_openrouter_api_key,
            export_backup,
            save_user_state,
            load_user_state,
            save_auth_database,
            load_auth_database
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
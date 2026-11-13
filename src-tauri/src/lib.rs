mod approval;
mod desktop;
mod hub;

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, Code, ShortcutState};

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct VectorChunk {
    pub id: String,
    pub item_id: String,
    pub item_type: String, // "task" | "journal" | "knowledge" | "habit"
    pub title: String,
    pub content: String,
    pub date: Option<String>,
    pub metadata: serde_json::Value,
    pub embedding: Vec<f32>,
    pub norm: f32,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct SearchResult {
    pub chunk: VectorChunk,
    pub score: f32,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct VaultStats {
    pub total_chunks: usize,
    pub total_items: usize,
    pub vector_dim: usize,
    pub last_indexed: String,
    pub storage_path: String,
}

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

fn get_vault_path() -> PathBuf {
    get_storage_dir().join("vector_vault.json")
}

fn load_all_chunks() -> Vec<VectorChunk> {
    let path = get_vault_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(chunks) = serde_json::from_str::<Vec<VectorChunk>>(&content) {
                return chunks;
            }
        }
    }
    Vec::new()
}

fn save_all_chunks(chunks: &[VectorChunk]) -> Result<(), String> {
    let path = get_vault_path();
    let json = serde_json::to_string(chunks).map_err(|e| format!("Serialization error: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write vector vault: {}", e))
}

#[tauri::command]
fn save_brain_data(data: String) -> Result<bool, String> {
    let path = get_storage_dir().join("brain_state.json");
    fs::write(&path, data).map_err(|e| format!("Failed to save data: {}", e))?;
    Ok(true)
}

#[tauri::command]
fn load_brain_data() -> Result<Option<String>, String> {
    let path = get_storage_dir().join("brain_state.json");
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read data: {}", e))?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
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
fn export_backup(content: String, filename: String) -> Result<String, String> {
    let desktop_dir = if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join("Desktop")
    } else {
        get_storage_dir()
    };
    let file_path = desktop_dir.join(&filename);
    fs::write(&file_path, content).map_err(|e| format!("Failed to export backup: {}", e))?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn save_user_state(user_id: String, data: String) -> Result<bool, String> {
    let dir = get_storage_dir().join("users");
    let _ = fs::create_dir_all(&dir);
    let safe_id: String = user_id
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let path = dir.join(format!("{}.json", safe_id));
    fs::write(&path, data).map_err(|e| format!("Failed to save user state: {}", e))?;
    Ok(true)
}

#[tauri::command]
fn load_user_state(user_id: String) -> Result<Option<String>, String> {
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
}

#[tauri::command]
fn save_auth_database(users_json: String, session_json: String) -> Result<bool, String> {
    let dir = get_storage_dir();
    let path_users = dir.join("auth_users.json");
    let path_session = dir.join("auth_session.json");
    fs::write(&path_users, users_json).map_err(|e| format!("Failed to save auth users: {}", e))?;
    fs::write(&path_session, session_json).map_err(|e| format!("Failed to save auth session: {}", e))?;
    Ok(true)
}

#[tauri::command]
fn load_auth_database() -> Result<(Option<String>, Option<String>), String> {
    let dir = get_storage_dir();
    let path_users = dir.join("auth_users.json");
    let path_session = dir.join("auth_session.json");
    let users = if path_users.exists() {
        fs::read_to_string(&path_users).ok()
    } else {
        None
    };
    let session = if path_session.exists() {
        fs::read_to_string(&path_session).ok()
    } else {
        None
    };
    Ok((users, session))
}

// =========================================================================
// SEMANTIC MEMORY VAULT (RAG VECTOR STORE) COMMANDS
// =========================================================================

#[tauri::command]
fn save_vector_chunks(chunks: Vec<VectorChunk>) -> Result<usize, String> {
    let mut current = load_all_chunks();
    for incoming in chunks {
        let mut replaced = false;
        for existing in current.iter_mut() {
            if existing.id == incoming.id {
                *existing = incoming.clone();
                replaced = true;
                break;
            }
        }
        if !replaced {
            current.push(incoming);
        }
    }
    let total = current.len();
    save_all_chunks(&current)?;
    Ok(total)
}

#[tauri::command]
fn search_vector_chunks(
    query_embedding: Vec<f32>,
    top_k: usize,
    item_type: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    if query_embedding.is_empty() {
        return Ok(Vec::new());
    }

    let q_norm: f32 = query_embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
    if q_norm <= 0.0 {
        return Ok(Vec::new());
    }

    let chunks = load_all_chunks();
    let mut scored: Vec<SearchResult> = chunks
        .into_iter()
        .filter(|c| {
            if let Some(ref t) = item_type {
                if !t.is_empty() && t != "all" {
                    return &c.item_type == t;
                }
            }
            true
        })
        .filter_map(|c| {
            if c.embedding.len() != query_embedding.len() {
                return None;
            }
            let dot: f32 = query_embedding
                .iter()
                .zip(c.embedding.iter())
                .map(|(a, b)| a * b)
                .sum();
            let score = if c.norm > 0.0 {
                (dot / (q_norm * c.norm)).clamp(-1.0, 1.0)
            } else {
                0.0
            };
            Some(SearchResult { chunk: c, score })
        })
        .collect();

    // Sort descending by similarity score
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(top_k);
    Ok(scored)
}

#[tauri::command]
fn delete_vector_chunks_by_item(item_id: String) -> Result<usize, String> {
    let mut chunks = load_all_chunks();
    let before = chunks.len();
    chunks.retain(|c| c.item_id != item_id);
    let deleted = before - chunks.len();
    save_all_chunks(&chunks)?;
    Ok(deleted)
}

#[tauri::command]
fn get_vector_vault_stats() -> Result<VaultStats, String> {
    let chunks = load_all_chunks();
    let total_chunks = chunks.len();
    let mut item_ids = HashSet::new();
    let mut dim = 0;
    for c in &chunks {
        item_ids.insert(c.item_id.clone());
        if dim == 0 && !c.embedding.is_empty() {
            dim = c.embedding.len();
        }
    }
    let last_indexed = if let Ok(meta) = fs::metadata(get_vault_path()) {
        if let Ok(modified) = meta.modified() {
            format!("{:?}", modified)
        } else {
            "Active".to_string()
        }
    } else {
        "Empty".to_string()
    };

    Ok(VaultStats {
        total_chunks,
        total_items: item_ids.len(),
        vector_dim: dim,
        last_indexed,
        storage_path: get_vault_path().to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn clear_vector_vault() -> Result<bool, String> {
    let path = get_vault_path();
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
    Ok(true)
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Welcome to your AI Second Brain, {}!", name)
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
            desktop::desktop_stop,
            hub::browser_link_status,
            hub::browser_call,
            hub::browser_confirm,
            hub::browser_install_link,
            hub::mcp_register_tools,
            hub::mcp_status,
            hub::mcp_set_enabled,
            hub::mcp_result,
            greet,
            save_brain_data,
            load_brain_data,
            save_openrouter_api_key,
            get_openrouter_api_key,
            export_backup,
            save_user_state,
            load_user_state,
            save_auth_database,
            load_auth_database,
            // Semantic Memory Vault commands
            save_vector_chunks,
            search_vector_chunks,
            delete_vector_chunks_by_item,
            get_vector_vault_stats,
            clear_vector_vault
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
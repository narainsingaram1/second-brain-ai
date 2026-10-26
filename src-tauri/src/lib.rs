use std::fs;
use std::path::PathBuf;

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
    // First check environment variable
    if let Ok(env_key) = std::env::var("OPENROUTER_API_KEY") {
        if !env_key.trim().is_empty() {
            return Ok(Some(env_key.trim().to_string()));
        }
    }
    // Then check stored key file
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
fn greet(name: &str) -> String {
    format!("Welcome to your AI Second Brain, {}!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            save_brain_data,
            load_brain_data,
            save_openrouter_api_key,
            get_openrouter_api_key,
            export_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

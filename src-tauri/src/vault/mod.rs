//! Saved logins for the assistant's sign-in (Phase 1: the store).
//!
//! Rules enforced here, whatever the web layer asks:
//! - Passwords live only in the macOS Keychain. Nothing here writes them to disk, logs or the web layer.
//! - No command returns a password. The main window (and the assistant) sees nicknames, sites and partly hidden
//!   usernames; the vault window, which only the user drives, also sees full usernames.
//! - Logins are added, checked and removed only from the vault window, never from the main window.
//! - Every read of a password asks the user first (Touch ID or the Mac password), through LocalAuthentication,
//!   and every removal does too.
//! - Each login is locked to one exact site (see `site.rs`).

pub mod site;

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Window};
use zeroize::Zeroizing;

use site::{mask_username, normalize_site};

const MAIN_WINDOW: &str = "main";
pub const VAULT_WINDOW: &str = "vault";
/// The Keychain service every Synapse login is stored under.
const SERVICE: &str = "com.narainsingaram.secondbrain.vault";
/// The Keychain item holding the list of logins (sites, usernames, nicknames; no passwords).
const INDEX_ACCOUNT: &str = "__synapse_index__";
const MAX_USERNAME: usize = 256;
const MAX_PASSWORD: usize = 1024;
const MAX_LOGINS: usize = 2000;
/// errSecItemNotFound.
#[cfg(target_os = "macos")]
const ERR_ITEM_NOT_FOUND: i32 = -25300;

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    #[default]
    Saved,
    /// Created by a sign-up that hasn't been confirmed yet (Phase 3).
    Pending,
}

/// One saved login, without its password.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub nickname: String,
    pub site: String,
    pub username: String,
    #[serde(default)]
    pub status: Status,
    pub created: u64,
    #[serde(default)]
    pub last_used: Option<u64>,
}

/// Where passwords and the list are kept: the Keychain in the app, memory in tests.
pub trait Backend: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, String>;
    fn set(&self, account: &str, value: &[u8]) -> Result<(), String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

#[cfg(target_os = "macos")]
pub struct Keychain;

#[cfg(target_os = "macos")]
impl Backend for Keychain {
    fn get(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        use security_framework::passwords::get_generic_password;
        match get_generic_password(SERVICE, account) {
            Ok(value) => Ok(Some(Zeroizing::new(value))),
            Err(e) if e.code() == ERR_ITEM_NOT_FOUND => Ok(None),
            Err(e) => Err(format!("The Keychain couldn't be read ({}).", e.code())),
        }
    }
    fn set(&self, account: &str, value: &[u8]) -> Result<(), String> {
        security_framework::passwords::set_generic_password(SERVICE, account, value).map_err(|e| format!("The Keychain couldn't be written ({}).", e.code()))
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        match security_framework::passwords::delete_generic_password(SERVICE, account) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == ERR_ITEM_NOT_FOUND => Ok(()),
            Err(e) => Err(format!("The Keychain item couldn't be removed ({}).", e.code())),
        }
    }
}

/// Asks the user to confirm with Touch ID or their Mac password. Blocks until they answer (at most 2 minutes).
#[cfg(target_os = "macos")]
pub fn authenticate(reason: &str) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};

    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let tx = Mutex::new(Some(tx));
    let reply = RcBlock::new(move |ok: Bool, error: *mut NSError| {
        let result = if ok.as_bool() { Ok(()) } else {
            // SAFETY: LocalAuthentication passes a valid NSError (or null) for the duration of the call.
            let why = unsafe { error.as_ref() }.map(|e| e.localizedDescription().to_string()).unwrap_or_else(|| "Not confirmed.".into());
            Err(why)
        };
        if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) { let _ = tx.send(result); }
    });
    // SAFETY: plain LocalAuthentication calls; the context stays alive until the reply arrives or we give up.
    let context = unsafe { LAContext::new() };
    unsafe { context.evaluatePolicy_localizedReason_reply(LAPolicy::DeviceOwnerAuthentication, &NSString::from_str(reason), &reply) };
    let answer = rx.recv_timeout(std::time::Duration::from_secs(120)).map_err(|_| "No answer from Touch ID.".to_string())?;
    drop(context);
    answer.map_err(|why| format!("Not confirmed: {why}"))
}

#[cfg(not(target_os = "macos"))]
pub fn authenticate(_reason: &str) -> Result<(), String> {
    Err("Saved logins are only available in the Synapse app for macOS.".into())
}

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

#[cfg(target_os = "macos")]
fn random_bytes(buf: &mut [u8]) {
    if security_framework::random::SecRandom::default().copy_bytes(buf).is_err() {
        panic!("The system random number generator failed.");
    }
}
#[cfg(not(target_os = "macos"))]
fn random_bytes(buf: &mut [u8]) {
    use std::hash::{BuildHasher, Hasher};
    for chunk in buf.chunks_mut(8) {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(now());
        chunk.copy_from_slice(&h.finish().to_le_bytes()[..chunk.len()]);
    }
}

/// The store: a list of logins plus one Keychain item per password, changed under one lock.
pub struct Vault<B: Backend> {
    backend: B,
    lock: Mutex<()>,
    random: fn(&mut [u8]),
}

impl<B: Backend> Vault<B> {
    pub fn new(backend: B) -> Self { Self { backend, lock: Mutex::new(()), random: random_bytes } }

    fn load(&self) -> Result<Vec<Entry>, String> {
        match self.backend.get(INDEX_ACCOUNT)? {
            None => Ok(Vec::new()),
            Some(bytes) => serde_json::from_slice(&bytes).map_err(|_| "The list of saved logins is damaged.".to_string()),
        }
    }
    fn save(&self, entries: &[Entry]) -> Result<(), String> {
        self.backend.set(INDEX_ACCOUNT, &serde_json::to_vec(entries).map_err(|e| e.to_string())?)
    }
    fn nickname(&self, taken: &[Entry]) -> String {
        loop {
            let mut bytes = [0u8; 4];
            (self.random)(&mut bytes);
            let name = format!("cred_{}", bytes.iter().map(|b| format!("{b:02x}")).collect::<String>());
            if !taken.iter().any(|e| e.nickname == name) { return name; }
        }
    }

    pub fn list(&self) -> Result<Vec<Entry>, String> {
        let _guard = self.lock.lock().map_err(|_| "The vault is busy.")?;
        self.load()
    }

    /// Saves a login. The same site and username again replaces the password and keeps the nickname.
    pub fn add(&self, site: &str, username: &str, password: Zeroizing<String>, status: Status) -> Result<Entry, String> {
        let site = normalize_site(site)?;
        let username = username.trim();
        if username.is_empty() { return Err("Enter the username or email for this login.".into()); }
        if username.chars().count() > MAX_USERNAME { return Err("That username is too long.".into()); }
        if password.is_empty() { return Err("Enter the password.".into()); }
        if password.chars().count() > MAX_PASSWORD || password.contains('\0') { return Err("That password can't be saved.".into()); }
        let _guard = self.lock.lock().map_err(|_| "The vault is busy.")?;
        let mut entries = self.load()?;
        let existing = entries.iter().position(|e| e.site == site && e.username == username);
        if existing.is_none() && entries.len() >= MAX_LOGINS { return Err("The vault is full.".into()); }
        let entry = match existing {
            Some(i) => { entries[i].status = status; entries[i].clone() }
            None => {
                let entry = Entry { nickname: self.nickname(&entries), site, username: username.to_string(), status, created: now(), last_used: None };
                entries.push(entry.clone());
                entry
            }
        };
        // The password first: a list entry never points at a password that wasn't saved.
        self.backend.set(&entry.nickname, password.as_bytes())?;
        self.save(&entries)?;
        Ok(entry)
    }

    pub fn find(&self, nickname: &str) -> Result<Entry, String> {
        self.list()?.into_iter().find(|e| e.nickname == nickname).ok_or_else(|| "There's no saved login with that name.".into())
    }

    /// Removes a login, after `confirm` (the user's Touch ID) says yes.
    pub fn remove(&self, nickname: &str, confirm: &dyn Fn(&str) -> Result<(), String>) -> Result<(), String> {
        let entry = self.find(nickname)?;
        confirm(&format!("remove your saved login for {}", entry.site))?;
        let _guard = self.lock.lock().map_err(|_| "The vault is busy.")?;
        let mut entries = self.load()?;
        entries.retain(|e| e.nickname != nickname);
        self.save(&entries)?;
        self.backend.delete(nickname)
    }

    /// The password of a login, after `confirm` (the user's Touch ID) says yes. The only way to read one.
    /// Never pass the result to the web layer: it goes to the extension (Phase 2) or is dropped.
    pub fn read_password(&self, nickname: &str, purpose: &str, confirm: &dyn Fn(&str) -> Result<(), String>) -> Result<Zeroizing<String>, String> {
        let entry = self.find(nickname)?;
        confirm(&format!("{purpose} for {} as {}", entry.site, mask_username(&entry.username)))?;
        let _guard = self.lock.lock().map_err(|_| "The vault is busy.")?;
        let bytes = self.backend.get(nickname)?.ok_or("That login's password is missing from the Keychain.")?;
        let password = Zeroizing::new(String::from_utf8(bytes.to_vec()).map_err(|_| "That password isn't readable text.")?);
        let mut entries = self.load()?;
        if let Some(e) = entries.iter_mut().find(|e| e.nickname == nickname) { e.last_used = Some(now()); }
        self.save(&entries)?;
        Ok(password)
    }
}

/// The app's vault (the Keychain).
pub struct VaultState {
    #[cfg(target_os = "macos")]
    vault: Vault<Keychain>,
}
impl Default for VaultState {
    fn default() -> Self {
        Self { #[cfg(target_os = "macos")] vault: Vault::new(Keychain) }
    }
}
impl VaultState {
    #[cfg(target_os = "macos")]
    fn vault(&self) -> Result<&Vault<Keychain>, String> { Ok(&self.vault) }
    #[cfg(not(target_os = "macos"))]
    fn vault(&self) -> Result<&Vault<NoBackend>, String> { Err("Saved logins are only available in the Synapse app for macOS.".into()) }
}
#[cfg(not(target_os = "macos"))]
pub struct NoBackend;
#[cfg(not(target_os = "macos"))]
impl Backend for NoBackend {
    fn get(&self, _: &str) -> Result<Option<Zeroizing<Vec<u8>>>, String> { Err("Unsupported.".into()) }
    fn set(&self, _: &str, _: &[u8]) -> Result<(), String> { Err("Unsupported.".into()) }
    fn delete(&self, _: &str) -> Result<(), String> { Err("Unsupported.".into()) }
}

// ---- Commands ----

/// A login as a window sees it. Never a password.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    pub nickname: String,
    pub site: String,
    pub username: String,
    pub status: Status,
    pub created: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used: Option<u64>,
}
/// Full usernames only for the vault window; everyone else gets them partly hidden.
pub fn listed(entry: &Entry, full: bool) -> Listed {
    Listed {
        nickname: entry.nickname.clone(), site: entry.site.clone(),
        username: if full { entry.username.clone() } else { mask_username(&entry.username) },
        status: entry.status, created: entry.created, last_used: entry.last_used,
    }
}

fn vault_only(window: &Window) -> Result<(), String> {
    if window.label() == VAULT_WINDOW { Ok(()) } else { Err("Only the Saved logins window can change saved logins.".into()) }
}

/// Runs Keychain and Touch ID work off the main thread.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| e.to_string())?
}

/// Opens the Saved logins window (or brings it to the front). Only the main window may ask.
#[tauri::command]
pub fn vault_open(app: AppHandle, window: Window) -> Result<(), String> {
    if window.label() != MAIN_WINDOW { return Err("Only the Synapse window can open Saved logins.".into()); }
    if let Some(existing) = app.get_webview_window(VAULT_WINDOW) {
        let _ = existing.unminimize();
        let _ = existing.show();
        return existing.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(&app, VAULT_WINDOW, WebviewUrl::App("vault.html".into()))
        .title("Saved logins")
        .inner_size(620.0, 680.0)
        .min_inner_size(480.0, 520.0)
        .center()
        .focused(true)
        .build()
        .map(|_| ())
        .map_err(|e| format!("Couldn't open Saved logins: {e}"))
}

#[tauri::command]
pub async fn vault_list(app: AppHandle, window: Window) -> Result<Vec<Listed>, String> {
    let full = match window.label() { VAULT_WINDOW => true, MAIN_WINDOW => false, _ => return Err("Not allowed.".into()) };
    blocking(move || {
        let state = app.state::<VaultState>();
        Ok(state.vault()?.list()?.iter().map(|e| listed(e, full)).collect())
    }).await
}

#[tauri::command]
pub async fn vault_add(app: AppHandle, window: Window, site: String, username: String, password: String) -> Result<Listed, String> {
    let password = Zeroizing::new(password);
    vault_only(&window)?;
    blocking(move || {
        let state = app.state::<VaultState>();
        state.vault()?.add(&site, &username, password, Status::Saved).map(|e| listed(&e, true))
    }).await
}

#[tauri::command]
pub async fn vault_remove(app: AppHandle, window: Window, nickname: String) -> Result<(), String> {
    vault_only(&window)?;
    blocking(move || app.state::<VaultState>().vault()?.remove(&nickname, &authenticate)).await
}

/// Checks that a login's password can be unlocked: asks for Touch ID, reads it, and drops it. Answers yes or no.
#[tauri::command]
pub async fn vault_verify(app: AppHandle, window: Window, nickname: String) -> Result<bool, String> {
    vault_only(&window)?;
    blocking(move || {
        let password = app.state::<VaultState>().vault()?.read_password(&nickname, "check your saved login", &authenticate)?;
        Ok(!password.is_empty())
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct Memory(Mutex<HashMap<String, Vec<u8>>>);
    impl Backend for Memory {
        fn get(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, String> { Ok(self.0.lock().unwrap().get(account).cloned().map(Zeroizing::new)) }
        fn set(&self, account: &str, value: &[u8]) -> Result<(), String> { self.0.lock().unwrap().insert(account.into(), value.to_vec()); Ok(()) }
        fn delete(&self, account: &str) -> Result<(), String> { self.0.lock().unwrap().remove(account); Ok(()) }
    }
    fn vault() -> Vault<Memory> {
        let mut v = Vault::new(Memory::default());
        v.random = |buf| { static N: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(1); buf.fill(N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)); };
        v
    }
    fn yes(_: &str) -> Result<(), String> { Ok(()) }
    fn no(_: &str) -> Result<(), String> { Err("Not confirmed: Canceled by user.".into()) }
    fn pw(s: &str) -> Zeroizing<String> { Zeroizing::new(s.to_string()) }

    #[test]
    fn logins_are_saved_without_their_passwords_in_the_list() {
        let v = vault();
        let e = v.add("GitHub.com/login", " n@x.io ", pw("hunter2-long"), Status::Saved).unwrap();
        assert_eq!(e.site, "https://github.com");
        assert_eq!(e.username, "n@x.io");
        assert!(e.nickname.starts_with("cred_") && e.nickname.len() == 13);
        let index = String::from_utf8(v.backend.get(INDEX_ACCOUNT).unwrap().unwrap().to_vec()).unwrap();
        assert!(!index.contains("hunter2"), "the list never holds a password");
        assert_eq!(v.backend.get(&e.nickname).unwrap().unwrap().as_slice(), b"hunter2-long");
        // The same site and username replaces the password and keeps the nickname.
        let again = v.add("https://github.com", "n@x.io", pw("new-password"), Status::Saved).unwrap();
        assert_eq!(again.nickname, e.nickname);
        assert_eq!(v.list().unwrap().len(), 1);
        assert_eq!(v.backend.get(&e.nickname).unwrap().unwrap().as_slice(), b"new-password");
        v.add("github.com", "other@x.io", pw("x"), Status::Saved).unwrap();
        assert_eq!(v.list().unwrap().len(), 2);
    }

    #[test]
    fn bad_input_is_refused_and_saves_nothing() {
        let v = vault();
        assert!(v.add("http://bank.com", "a", pw("p"), Status::Saved).is_err());
        assert!(v.add("bank.com", "  ", pw("p"), Status::Saved).is_err());
        assert!(v.add("bank.com", "a", pw(""), Status::Saved).is_err());
        assert!(v.add("bank.com", "a", pw("a\0b"), Status::Saved).is_err());
        assert!(v.add("bank.com", "a", pw(&"x".repeat(2000)), Status::Saved).is_err());
        assert!(v.list().unwrap().is_empty());
    }

    #[test]
    fn reading_or_removing_needs_the_users_confirmation() {
        let v = vault();
        let e = v.add("github.com", "narain@gmail.com", pw("s3cret-pass"), Status::Saved).unwrap();
        let asked = Mutex::new(String::new());
        let record = |reason: &str| { *asked.lock().unwrap() = reason.to_string(); Ok(()) };
        assert_eq!(v.read_password(&e.nickname, "sign in", &record).unwrap().as_str(), "s3cret-pass");
        assert_eq!(*asked.lock().unwrap(), "sign in for https://github.com as n•••@gmail.com", "the prompt names the site, not the password");
        assert!(v.find(&e.nickname).unwrap().last_used.is_some());
        assert!(v.read_password(&e.nickname, "sign in", &no).is_err());
        assert!(v.remove(&e.nickname, &no).is_err());
        assert_eq!(v.list().unwrap().len(), 1, "a declined removal keeps the login");
        v.remove(&e.nickname, &yes).unwrap();
        assert!(v.list().unwrap().is_empty());
        assert!(v.backend.get(&e.nickname).unwrap().is_none(), "the password is gone too");
        assert!(v.read_password(&e.nickname, "sign in", &yes).is_err());
    }

    #[test]
    fn other_windows_see_partly_hidden_usernames() {
        let e = Entry { nickname: "cred_1".into(), site: "https://github.com".into(), username: "narain@gmail.com".into(), status: Status::Saved, created: 1, last_used: None };
        assert_eq!(listed(&e, false).username, "n•••@gmail.com");
        assert_eq!(listed(&e, true).username, "narain@gmail.com");
        let json = serde_json::to_string(&listed(&e, false)).unwrap();
        assert!(!json.contains("password"));
    }
}

//! Risk tiers for steps in native macOS apps. Same vocabulary as the browser (src/services/riskTiers.ts; a test
//! fails if these patterns drift), decided here in Rust from the element the step targets, never from the
//! model's description of it.

use regex::Regex;
use std::sync::OnceLock;

pub const CONSEQUENTIAL_SOURCE: &str = r#"\b(buy|purchase|place (?:your )?order|pay(?: now)?|checkout|check out|complete (?:order|purchase|booking)|confirm|submit|send|post|publish|tweet|share|reply|comment|delete|remove|discard|cancel (?:my |your )?(?:order|subscription|account|membership|booking|reservation)|unsubscribe|transfer|withdraw|deposit|book(?: now)?|reserve|subscribe|sign up|create (?:an )?account|register|apply|donate|accept|agree|authori[sz]e|allow|grant|follow|connect|invite|upload|save changes|update (?:payment|account)|close account|merge|approve|archive|revoke|deploy|release|empty trash|erase|move to (?:the )?trash|shut down|restart|log out|sign out|quit)\b"#;
pub const SECRET_LABEL_SOURCE: &str = r#"\b(password|passcode|card ?number|credit card|debit card|cvv|cvc|csc|security code|expir\w* date|ssn|social security|routing number|account number|iban|swift|pin)\b"#;

fn consequential() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(&format!("(?i){CONSEQUENTIAL_SOURCE}")).expect("valid pattern"))
}
fn secret_label() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(&format!("(?i){SECRET_LABEL_SOURCE}")).expect("valid pattern"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
pub enum Tier {
    /// Observes only (looks). Listed for the shared scale; looks are never gated.
    #[allow(dead_code)]
    Read = 0,
    /// Reversible or local: runs.
    Soft = 1,
    /// Commits something: waits for the user's go-ahead in the native approval window.
    Hard = 2,
    /// The user does it themselves.
    UserOnly = 3,
}

/// Apps the assistant may never control, whatever the user or an organization allows.
const DENIED: &[(&str, &str)] = &[
    ("com.narainsingaram.secondbrain", "Synapse can't control itself (that would let it approve its own steps)."),
    ("com.apple.keychainaccess", "Keychain Access holds your passwords."),
    ("com.apple.Passwords", "Passwords holds your passwords."),
    ("com.1password", "1Password holds your passwords."),
    ("com.agilebits", "1Password holds your passwords."),
    ("com.bitwarden", "Bitwarden holds your passwords."),
    ("com.lastpass", "LastPass holds your passwords."),
    ("com.dashlane", "Dashlane holds your passwords."),
    ("com.apple.systempreferences", "System Settings controls your Mac's security and privacy."),
    ("com.apple.Settings", "System Settings controls your Mac's security and privacy."),
    ("com.apple.SecurityAgent", "Security prompts are for you to answer."),
    ("com.apple.loginwindow", "The login window is for you."),
    ("com.apple.ScreenTime", "Screen Time settings are for you."),
];

/// Apps where typed text can run commands: every keystroke batch needs the user's go-ahead.
const TERMINALS: &[&str] = &[
    "com.apple.Terminal", "com.googlecode.iterm2", "dev.warp", "net.kovidgoyal.kitty", "co.zeit.hyper", "org.alacritty",
    "com.mitchellh.ghostty", "com.github.wez.wezterm", "com.microsoft.VSCode", "com.todesktop.230313mzl4w4u92", "com.apple.ScriptEditor2",
    "com.apple.Automator",
];

fn matches_prefix(bundle: &str, prefix: &str) -> bool {
    bundle == prefix || bundle.starts_with(&format!("{prefix}."))
}
pub fn denied_reason(bundle: &str) -> Option<&'static str> {
    DENIED.iter().find(|(p, _)| matches_prefix(bundle, p)).map(|(_, why)| *why)
}
pub fn is_terminal(bundle: &str) -> bool {
    TERMINALS.iter().any(|p| matches_prefix(bundle, p))
}

/// What a step targets, read from the app's accessibility tree.
#[derive(Clone, Debug, Default)]
pub struct Target {
    pub role: String,
    pub subrole: String,
    pub name: String,
}
impl Target {
    pub fn is_secure(&self) -> bool {
        self.subrole == "AXSecureTextField" || secret_label().is_match(&self.name)
    }
    pub fn is_search(&self) -> bool {
        self.subrole == "AXSearchField" || self.name.to_lowercase().contains("search")
    }
    pub fn is_text(&self) -> bool {
        matches!(self.role.as_str(), "AXTextField" | "AXTextArea" | "AXComboBox")
    }
}

pub fn is_consequential(name: &str) -> bool {
    consequential().is_match(name)
}

/// Shortcuts that quit, close, send or delete.
fn risky_shortcut(key: &str, modifiers: &[String]) -> bool {
    let cmd = modifiers.iter().any(|m| m == "cmd");
    cmd && matches!(key.to_lowercase().as_str(), "q" | "w" | "return" | "enter" | "delete" | "backspace" | "forwarddelete" | "d" | "e")
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "action")]
pub enum Step {
    /// Clicks a button, link, checkbox or menu item (its AXPress action).
    #[serde(rename = "press")]
    Press { r#ref: usize },
    /// Puts text in a field (replacing it unless `append`); `submit` presses Return afterwards.
    #[serde(rename = "type")]
    Type { r#ref: usize, text: String, #[serde(default)] submit: bool, #[serde(default)] append: bool },
    /// Selects a row or tab (AXSelected).
    #[serde(rename = "select")]
    Select { r#ref: usize },
    /// A key, optionally with modifiers ("cmd", "shift", "option", "ctrl"), sent to the app.
    #[serde(rename = "key")]
    Key { key: String, #[serde(default)] modifiers: Vec<String> },
    /// Brings the app to the front.
    #[serde(rename = "activate")]
    Activate,
}

impl Step {
    pub fn target_ref(&self) -> Option<usize> {
        match self {
            Step::Press { r#ref } | Step::Type { r#ref, .. } | Step::Select { r#ref } => Some(*r#ref),
            _ => None,
        }
    }
}

/// The tier of a step and, when it isn't soft, why. `focused` is the element that has keyboard focus (for keys).
pub fn classify(bundle: &str, step: &Step, target: Option<&Target>, focused: Option<&Target>, secure_input: bool) -> (Tier, Option<String>) {
    let terminal = is_terminal(bundle);
    match step {
        Step::Activate => (Tier::Soft, None),
        Step::Press { .. } | Step::Select { .. } => {
            let name = target.map(|t| t.name.as_str()).unwrap_or("");
            if is_consequential(name) { (Tier::Hard, Some(format!("\"{name}\" commits something for you."))) } else { (Tier::Soft, None) }
        }
        Step::Type { text, submit, .. } => {
            if secure_input { return (Tier::UserOnly, Some("A password field has the keyboard (secure input is on). Type it yourself.".into())); }
            if target.is_some_and(Target::is_secure) { return (Tier::UserOnly, Some("That's a password or other secret field. Type it yourself.".into())); }
            if terminal { return (Tier::Hard, Some(format!("Typing in this app can run commands: {}", preview(text)))); }
            if *submit && !target.is_some_and(Target::is_search) { return (Tier::Hard, Some("Pressing Return here may send or submit it.".into())); }
            (Tier::Soft, None)
        }
        Step::Key { key, modifiers } => {
            if secure_input { return (Tier::UserOnly, Some("A password field has the keyboard (secure input is on).".into())); }
            if terminal { return (Tier::Hard, Some("Keys in this app can run commands.".into())); }
            if risky_shortcut(key, modifiers) { return (Tier::Hard, Some("This shortcut can quit, close, send or delete.".into())); }
            let ret = matches!(key.to_lowercase().as_str(), "return" | "enter");
            if ret && modifiers.is_empty() {
                if let Some(f) = focused {
                    if f.is_text() && !f.is_search() { return (Tier::Hard, Some(format!("Return in \"{}\" may send or submit it.", f.name))); }
                    if is_consequential(&f.name) { return (Tier::Hard, Some(format!("\"{}\" has focus; Return activates it.", f.name))); }
                }
            }
            (Tier::Soft, None)
        }
    }
}

pub fn preview(text: &str) -> String {
    let one_line: String = text.chars().map(|c| if c == '\n' { '⏎' } else { c }).collect();
    if one_line.chars().count() > 300 { format!("{}…", one_line.chars().take(299).collect::<String>()) } else { one_line }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn t(role: &str, subrole: &str, name: &str) -> Target { Target { role: role.into(), subrole: subrole.into(), name: name.into() } }
    fn press() -> Step { Step::Press { r#ref: 1 } }
    fn typed(text: &str, submit: bool) -> Step { Step::Type { r#ref: 1, text: text.into(), submit, append: false } }
    fn key(k: &str, m: &[&str]) -> Step { Step::Key { key: k.into(), modifiers: m.iter().map(|s| s.to_string()).collect() } }

    #[test]
    fn denied_and_terminal_apps() {
        assert!(denied_reason("com.apple.keychainaccess").is_some());
        assert!(denied_reason("com.1password.1password").is_some());
        assert!(denied_reason("com.narainsingaram.secondbrain").is_some(), "never itself");
        assert!(denied_reason("com.apple.Notes").is_none());
        assert!(denied_reason("com.1passwordx.fake").is_none(), "prefix matches whole segments only");
        assert!(is_terminal("com.apple.Terminal") && is_terminal("dev.warp.Warp-Stable"));
        assert!(!is_terminal("com.apple.Notes"));
    }

    #[test]
    fn presses() {
        assert_eq!(classify("com.apple.mail", &press(), Some(&t("AXButton", "", "Send")), None, false).0, Tier::Hard);
        assert_eq!(classify("com.apple.finder", &press(), Some(&t("AXButton", "", "Empty Trash")), None, false).0, Tier::Hard);
        assert_eq!(classify("com.apple.finder", &press(), Some(&t("AXMenuItem", "", "Move to Trash")), None, false).0, Tier::Hard);
        assert_eq!(classify("com.apple.Notes", &press(), Some(&t("AXButton", "", "New Note")), None, false).0, Tier::Soft);
    }

    #[test]
    fn typing() {
        let notes = t("AXTextArea", "", "Note body");
        assert_eq!(classify("com.apple.Notes", &typed("groceries", false), Some(&notes), None, false).0, Tier::Soft);
        assert_eq!(classify("com.apple.Notes", &typed("groceries", false), Some(&notes), None, true).0, Tier::UserOnly, "secure input");
        assert_eq!(classify("com.apple.Notes", &typed("x", false), Some(&t("AXTextField", "AXSecureTextField", "")), None, false).0, Tier::UserOnly);
        assert_eq!(classify("com.apple.Notes", &typed("x", false), Some(&t("AXTextField", "", "Card number")), None, false).0, Tier::UserOnly);
        let (tier, why) = classify("com.apple.Terminal", &typed("rm -rf ~", false), Some(&t("AXTextArea", "", "shell")), None, false);
        assert_eq!(tier, Tier::Hard);
        assert!(why.unwrap().contains("rm -rf ~"), "the exact command is shown");
        assert_eq!(classify("com.apple.MobileSMS", &typed("hi", true), Some(&t("AXTextField", "", "Message")), None, false).0, Tier::Hard);
        assert_eq!(classify("com.apple.Notes", &typed("milk", true), Some(&t("AXTextField", "AXSearchField", "Search")), None, false).0, Tier::Soft);
    }

    #[test]
    fn keys() {
        let message = t("AXTextField", "", "Message");
        assert_eq!(classify("com.apple.MobileSMS", &key("Return", &[]), None, Some(&message), false).0, Tier::Hard);
        assert_eq!(classify("com.apple.Notes", &key("Return", &[]), None, Some(&t("AXTextField", "AXSearchField", "Search")), false).0, Tier::Soft);
        assert_eq!(classify("com.apple.mail", &key("Return", &[]), None, Some(&t("AXButton", "", "Send")), false).0, Tier::Hard);
        assert_eq!(classify("com.apple.Notes", &key("q", &["cmd"]), None, None, false).0, Tier::Hard);
        assert_eq!(classify("com.apple.Notes", &key("n", &["cmd"]), None, None, false).0, Tier::Soft);
        assert_eq!(classify("com.apple.Terminal", &key("c", &["ctrl"]), None, None, false).0, Tier::Hard);
        assert_eq!(classify("com.apple.Notes", &key("Down", &[]), None, None, true).0, Tier::UserOnly);
    }

    #[test]
    fn steps_parse_from_the_tool_call() {
        let step: Step = serde_json::from_str(r#"{"action":"type","ref":3,"text":"hi","submit":true}"#).unwrap();
        assert!(matches!(step, Step::Type { r#ref: 3, submit: true, append: false, .. }));
        assert!(serde_json::from_str::<Step>(r#"{"action":"shell","cmd":"ls"}"#).is_err(), "unknown actions are refused");
    }
}

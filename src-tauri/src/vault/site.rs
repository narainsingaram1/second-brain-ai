//! Which site a saved login belongs to, and how a username is shown outside the vault window.

use url::Url;

pub const MAX_SITE: usize = 512;

/// The site a login is locked to: `scheme://host[:port]`, lowercase, international names in their `xn--`
/// form so a lookalike can't hide behind similar letters. Only https, except for local development hosts.
pub fn normalize_site(input: &str) -> Result<String, String> {
    let raw = input.trim();
    if raw.is_empty() { return Err("Enter the site's address, for example github.com.".into()); }
    if raw.len() > MAX_SITE { return Err("That address is too long.".into()); }
    let with_scheme = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    let url = Url::parse(&with_scheme).map_err(|_| format!("\"{raw}\" isn't a web address."))?;
    if !url.username().is_empty() || url.password().is_some() { return Err("The address can't contain a username or password.".into()); }
    let host = url.host_str().filter(|h| !h.is_empty()).ok_or_else(|| format!("\"{raw}\" has no site name."))?;
    let local = host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host.ends_with(".localhost");
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        "http" => return Err("Only https sites can have saved logins.".into()),
        _ => return Err("Only web addresses (https) can have saved logins.".into()),
    }
    if !local && !host.contains('.') && !host.starts_with('[') { return Err(format!("\"{host}\" isn't a full site name.")); }
    Ok(url.origin().ascii_serialization())
}

/// "narain@gmail.com" → "n•••@gmail.com"; "narain" → "n•••n". What the assistant and the main window see.
pub fn mask_username(username: &str) -> String {
    let name = username.trim();
    if let Some((local, domain)) = name.split_once('@') {
        let first: String = local.chars().take(1).collect();
        return format!("{first}•••@{domain}");
    }
    let chars: Vec<char> = name.chars().collect();
    match chars.len() {
        0 => String::new(),
        1..=3 => format!("{}•••", chars[0]),
        _ => format!("{}•••{}", chars[0], chars[chars.len() - 1]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sites_are_exact_origins() {
        assert_eq!(normalize_site("github.com").unwrap(), "https://github.com");
        assert_eq!(normalize_site(" https://GitHub.com/login?x=1 ").unwrap(), "https://github.com");
        assert_eq!(normalize_site("https://accounts.google.com/signin").unwrap(), "https://accounts.google.com");
        assert_eq!(normalize_site("https://example.com:8443/a").unwrap(), "https://example.com:8443");
        assert_eq!(normalize_site("http://localhost:5173").unwrap(), "http://localhost:5173");
        // A lookalike name is stored in its plain-letter form, so it never looks like the real one.
        assert_eq!(normalize_site("gіthub.com").unwrap(), "https://xn--gthub-n2e.com");
    }

    #[test]
    fn unsafe_or_vague_sites_are_refused() {
        for bad in ["", "http://example.com", "ftp://example.com", "javascript:alert(1)", "https://user:pw@example.com", "intranet", "file:///etc/passwd"] {
            assert!(normalize_site(bad).is_err(), "{bad} should be refused");
        }
        assert!(normalize_site(&"a".repeat(600)).is_err());
    }

    #[test]
    fn usernames_are_partly_hidden() {
        assert_eq!(mask_username("narain@gmail.com"), "n•••@gmail.com");
        assert_eq!(mask_username("narain"), "n•••n");
        assert_eq!(mask_username("ab"), "a•••");
        assert_eq!(mask_username(""), "");
    }
}

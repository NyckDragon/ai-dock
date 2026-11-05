//! DeepSeek Harness slot.
//!
//! The install is a directory or an executable, not a running process.
//! A window is added only when a real Open Platform key can read
//! `GET https://api.deepseek.com/user/balance`. The text is that payload's
//! currency figure. It is not a percentage of a plan.

use reqwest::header::{ACCEPT, AUTHORIZATION};
use serde_json::Value;
use std::{env, fs, path::{Path, PathBuf}};

use super::providers::{disconnected, ProviderUsage, UsageWindow};

const BALANCE_URL: &str = "https://api.deepseek.com/user/balance";
const NOT_FOUND: &str = "DeepSeek Harness não encontrado neste PC.";
const NO_QUOTA: &str = "Conectado, sem leitura de cota.";
const KEY_NAMES: [&str; 2] = ["DEEPSEEK_BALANCE_API_KEY", "DEEPSEEK_API_KEY"];

enum Install {
    Home(PathBuf),
    Executable,
}

pub(crate) async fn usage(client: &reqwest::Client) -> ProviderUsage {
    let Some(install) = locate_install() else {
        return disconnected("deepseek", "DeepSeek", NOT_FOUND);
    };
    let home = match install {
        Install::Home(path) => Some(path),
        Install::Executable => None,
    };
    let Some(key) = resolve_api_key(home.as_deref()) else {
        return connected_unmetered();
    };
    match fetch_balance(client, &key).await {
        Some(amount) => ProviderUsage {
            id: "deepseek".into(),
            name: "DeepSeek".into(),
            connected: true,
            plan: None,
            email: None,
            windows: vec![balance_window(amount)],
            error: None,
        },
        None => connected_unmetered(),
    }
}

/// Client failed before any request. The slot still follows the install.
pub(crate) fn without_http_client() -> ProviderUsage {
    if locate_install().is_some() {
        connected_unmetered()
    } else {
        disconnected("deepseek", "DeepSeek", NOT_FOUND)
    }
}

fn connected_unmetered() -> ProviderUsage {
    ProviderUsage {
        id: "deepseek".into(),
        name: "DeepSeek".into(),
        connected: true,
        plan: None,
        email: None,
        windows: vec![],
        error: Some(NO_QUOTA.into()),
    }
}

fn locate_install() -> Option<Install> {
    if let Some(path) = env_home() {
        return Some(Install::Home(path));
    }
    if let Some(path) = default_home() {
        return Some(Install::Home(path));
    }
    if find_executable().is_some() {
        return Some(Install::Executable);
    }
    None
}

fn env_home() -> Option<PathBuf> {
    let raw = env::var_os("DSH_HOME")?;
    if raw.is_empty() {
        return None;
    }
    let path = PathBuf::from(raw);
    path.is_dir().then_some(path)
}

fn default_home() -> Option<PathBuf> {
    let path = dirs::home_dir()?.join(".dsh");
    path.is_dir().then_some(path)
}

fn find_executable() -> Option<PathBuf> {
    for candidate in executable_candidates() {
        if is_app(&candidate) {
            return Some(candidate);
        }
    }
    on_path()
}

fn is_app(path: &Path) -> bool {
    if path.extension().and_then(|ext| ext.to_str()) == Some("app") {
        return path.is_dir();
    }
    path.is_file()
}

fn executable_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if let Some(local) = dirs::data_local_dir() {
            paths.push(local.join("Programs").join("DeepSeek Harness").join("DeepSeek Harness.exe"));
        }
        if let Some(program_files) = env::var_os("PROGRAMFILES") {
            paths.push(PathBuf::from(program_files).join("DeepSeek Harness").join("DeepSeek Harness.exe"));
        }
        for shortcut in shortcut_files() {
            if let Some(target) = shortcut_target(&shortcut) {
                paths.push(target);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        paths.push(PathBuf::from("/Applications/DeepSeek Harness.app"));
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join("Applications").join("DeepSeek Harness.app"));
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        paths.push(PathBuf::from("/usr/bin/dsh"));
        paths.push(PathBuf::from("/usr/local/bin/dsh"));
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join(".local").join("bin").join("dsh"));
        }
    }
    paths
}

fn on_path() -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    let names: &[&str] = if cfg!(target_os = "windows") {
        &["DeepSeek Harness.exe", "dsh.exe"]
    } else {
        &["dsh"]
    };
    for dir in env::split_paths(&path) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn shortcut_files() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(roaming) = dirs::config_dir() {
        paths.push(
            roaming
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
                .join("DeepSeek Harness.lnk"),
        );
    }
    if let Some(program_data) = env::var_os("PROGRAMDATA") {
        paths.push(
            PathBuf::from(program_data)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
                .join("DeepSeek Harness.lnk"),
        );
    }
    if let Some(desktop) = dirs::desktop_dir() {
        paths.push(desktop.join("DeepSeek Harness.lnk"));
    }
    paths
}

#[cfg(target_os = "windows")]
fn shortcut_target(path: &Path) -> Option<PathBuf> {
    let bytes = fs::read(path).ok()?;
    utf16le_exe_paths(&bytes).into_iter().map(PathBuf::from).find(|candidate| candidate.is_file())
}

/// Pulls `X:\...\DeepSeek Harness.exe` (or `dsh.exe`) out of a `.lnk`.
fn utf16le_exe_paths(bytes: &[u8]) -> Vec<String> {
    let mut found = Vec::new();
    let mut i = 0;
    while i + 5 < bytes.len() {
        let unit = u16::from_le_bytes([bytes[i], bytes[i + 1]]);
        let drive = unit <= 127
            && (unit as u8).is_ascii_alphabetic()
            && bytes[i + 2] == b':'
            && bytes[i + 3] == 0
            && (bytes[i + 4] == b'\\' || bytes[i + 4] == b'/')
            && bytes[i + 5] == 0;
        if !drive {
            i += 1;
            continue;
        }
        let mut units = Vec::new();
        let mut j = i;
        while j + 1 < bytes.len() {
            let c = u16::from_le_bytes([bytes[j], bytes[j + 1]]);
            if c < 32 {
                break;
            }
            units.push(c);
            j += 2;
        }
        if let Ok(text) = String::from_utf16(&units) {
            let lower = text.to_ascii_lowercase();
            if lower.ends_with("deepseek harness.exe") || lower.ends_with("\\dsh.exe") || lower.ends_with("/dsh.exe") {
                found.push(text);
            }
        }
        i = j.max(i + 2);
    }
    found
}

/// File refs win, then the process environment, then `$DSH_HOME/.env`.
fn resolve_api_key(home: Option<&Path>) -> Option<String> {
    if let Some(home) = home {
        if let Some(key) = key_from_yaml_file(&home.join(".credentials.yaml")) {
            return Some(key);
        }
    }
    if let Some(key) = key_from_env() {
        return Some(key);
    }
    if let Some(home) = home {
        if let Some(key) = key_from_dotenv_file(&home.join(".env")) {
            return Some(key);
        }
    }
    None
}

fn key_from_yaml_file(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let doc = serde_yaml::from_str::<serde_yaml::Value>(&text).ok()?;
    key_from_yaml(&doc)
}

fn key_from_yaml(doc: &serde_yaml::Value) -> Option<String> {
    let refs = doc.get("refs")?.as_mapping()?;
    for name in KEY_NAMES {
        let key = serde_yaml::Value::String(name.to_string());
        let Some(raw) = refs.get(&key).and_then(serde_yaml::Value::as_str) else {
            continue;
        };
        if let Some(key) = real_api_key(raw) {
            return Some(key);
        }
    }
    None
}

fn key_from_env() -> Option<String> {
    for name in KEY_NAMES {
        if let Ok(value) = env::var(name) {
            if let Some(key) = real_api_key(&value) {
                return Some(key);
            }
        }
    }
    None
}

fn key_from_dotenv_file(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    key_from_dotenv(&text)
}

fn key_from_dotenv(text: &str) -> Option<String> {
    for name in KEY_NAMES {
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let line = line.strip_prefix("export ").unwrap_or(line);
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            if key.trim() != name {
                continue;
            }
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if let Some(key) = real_api_key(value) {
                return Some(key);
            }
        }
    }
    None
}

/// An Open Platform key. Account grants and empty refs are not one.
fn real_api_key(value: &str) -> Option<String> {
    let value = value.trim();
    if value.len() < 20 || !value.starts_with("sk-") {
        return None;
    }
    if value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') {
        Some(value.to_string())
    } else {
        None
    }
}

async fn fetch_balance(client: &reqwest::Client, key: &str) -> Option<String> {
    let response = client
        .get(BALANCE_URL)
        .header(AUTHORIZATION, format!("Bearer {key}"))
        .header(ACCEPT, "application/json")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body = response.json::<Value>().await.ok()?;
    balance_amount(&body)
}

/// One window's text: each `total_balance` plus its currency, as the API spelled them.
fn balance_amount(body: &Value) -> Option<String> {
    let infos = body.get("balance_infos")?.as_array()?;
    let mut parts = Vec::new();
    for info in infos {
        let total = info.get("total_balance").and_then(Value::as_str)?.trim();
        let currency = info.get("currency").and_then(Value::as_str)?.trim();
        if total.is_empty() || currency.is_empty() {
            continue;
        }
        if !total.chars().all(|c| c.is_ascii_digit() || c == '.' || c == ',' || c == '-') {
            continue;
        }
        if !currency.chars().all(|c| c.is_ascii_alphanumeric()) {
            continue;
        }
        parts.push(format!("{total} {currency}"));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" · "))
    }
}

fn balance_window(amount: String) -> UsageWindow {
    UsageWindow {
        id: "balance".into(),
        label: "Saldo".into(),
        // Not a quota ratio. Callers show `amount` and skip this field.
        remaining_percent: 0.0,
        reset_at: None,
        amount: Some(amount),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn balance_keeps_the_api_spelling_in_one_window() {
        let body = json!({
            "is_available": true,
            "balance_infos": [
                { "currency": "CNY", "total_balance": "110.00", "granted_balance": "10.00", "topped_up_balance": "100.00" },
                { "currency": "USD", "total_balance": "1.50", "granted_balance": "0.00", "topped_up_balance": "1.50" }
            ]
        });
        let amount = balance_amount(&body).unwrap();
        assert_eq!(amount, "110.00 CNY · 1.50 USD");
        let window = balance_window(amount);
        assert_eq!(window.amount.as_deref(), Some("110.00 CNY · 1.50 USD"));
        assert_eq!(window.remaining_percent, 0.0);
    }

    #[test]
    fn empty_or_non_string_balance_is_not_a_reading() {
        assert!(balance_amount(&json!({ "is_available": true, "balance_infos": [] })).is_none());
        assert!(balance_amount(&json!({ "balance_infos": [{ "currency": "CNY", "total_balance": 110.0 }] })).is_none());
        assert!(balance_amount(&json!({})).is_none());
    }

    #[test]
    fn only_an_open_platform_key_counts() {
        assert!(real_api_key("").is_none());
        assert!(real_api_key("sk-short").is_none());
        assert!(real_api_key("not-a-key-0123456789").is_none());
        assert_eq!(
            real_api_key("  sk-testkey-0123456789abcdef  ").as_deref(),
            Some("sk-testkey-0123456789abcdef")
        );
    }

    #[test]
    fn yaml_refs_win_and_grants_are_ignored() {
        let doc = serde_yaml::from_str::<serde_yaml::Value>(
            "version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-fromfile-0123456789ab\nrecords:\n  deepseek-account-platform/default:\n    kind: grant\n    payload:\n      token: not-the-api-key\n",
        )
        .unwrap();
        assert_eq!(key_from_yaml(&doc).as_deref(), Some("sk-fromfile-0123456789ab"));

        let balance_first = serde_yaml::from_str::<serde_yaml::Value>(
            "version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-api-0123456789abcdef\n  DEEPSEEK_BALANCE_API_KEY: sk-balance-0123456789abcd\n",
        )
        .unwrap();
        assert_eq!(key_from_yaml(&balance_first).as_deref(), Some("sk-balance-0123456789abcd"));

        let grants_only = serde_yaml::from_str::<serde_yaml::Value>(
            "version: 1\nrecords:\n  deepseek-account-platform/default:\n    kind: grant\n    payload:\n      token: abcdefghijklmnopqrstuvwxyz\n      issuer: https://platform.deepseek.com\n",
        )
        .unwrap();
        assert!(key_from_yaml(&grants_only).is_none());
    }

    #[test]
    fn dotenv_reads_the_balance_key_first() {
        let text = "DEEPSEEK_API_KEY=sk-api-0123456789abcdef\nDEEPSEEK_BALANCE_API_KEY=\"sk-balance-0123456789abcd\"\n";
        assert_eq!(key_from_dotenv(text).as_deref(), Some("sk-balance-0123456789abcd"));
        assert!(key_from_dotenv("DEEPSEEK_API_KEY=\n").is_none());
    }

    #[test]
    fn shortcut_bytes_yield_the_exe_path() {
        let path = "D:\\Apps\\DeepSeek Harness.exe";
        let mut bytes = Vec::new();
        for unit in path.encode_utf16() {
            bytes.extend(unit.to_le_bytes());
        }
        bytes.extend([0, 0]);
        assert_eq!(utf16le_exe_paths(&bytes), vec![path.to_string()]);
    }
}

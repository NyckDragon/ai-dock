//! Claude usage through the claude.ai web session.
//!
//! The session comes from one of three places, freshest first:
//! 1. the "Entrar com claude.ai" window, a login page inside AI Dock whose
//!    cookies live in AI Dock's own WebView2 profile (never Chrome or Edge);
//! 2. a Cookie header or DevTools cookie table pasted by hand;
//! 3. cookies claude.ai itself rotates through `Set-Cookie` on our requests.
//!
//! When the session stops working, a hidden AI Dock window reopens claude.ai so
//! the site can renew its own cookies and Cloudflare clearance, the same way a
//! browser tab left open stays logged in. Only when that fails is the user asked
//! to sign in again.

use keyring::Entry;
use reqwest::header::{ACCEPT, SET_COOKIE, USER_AGENT};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::webview::{Cookie, Url};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use super::providers::{disconnected, ProviderUsage, UsageWindow};

const KEYRING_SERVICE: &str = "app.aidock.desktop";
const KEYRING_ACCOUNT: &str = "claude-web-cookie";
const LEGACY_KEYRING_ACCOUNT: &str = "claude-web-session";
const CLOUDFLARE_COOLDOWN: Duration = Duration::from_secs(5 * 60);

const CLAUDE_ORIGIN: &str = "https://claude.ai/";
const LOGIN_URL: &str = "https://claude.ai/login";
const RENEW_URL: &str = "https://claude.ai/new";
const LOGIN_LABEL: &str = "claude-login";
const RENEW_LABEL: &str = "claude-renew";
const LOGIN_EVENT: &str = "claude-login";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const RENEW_GAP: Duration = Duration::from_secs(20 * 60);
const RENEW_WAIT: Duration = Duration::from_secs(7);
const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

/// The only claude.ai cookies AI Dock keeps.
const ALLOWED: [&str; 4] = ["sessionKey", "cf_clearance", "__cf_bm", "anthropic-device-id"];

static CLOUDFLARE_BLOCKED_UNTIL: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
static LAST_RENEW: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
static RENEWING: AtomicBool = AtomicBool::new(false);
static USER_AGENT_OVERRIDE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
/// sessionKey from the WebView2 store that claude.ai already refused; skipped until it changes.
static REJECTED_WEBVIEW_KEY: OnceLock<Mutex<Option<String>>> = OnceLock::new();

#[derive(Debug)]
enum WebError {
    Network,
    Unauthorized,
    Cloudflare,
    Forbidden(String),
    Http(u16),
    InvalidResponse,
    NoOrganization,
}

impl std::fmt::Display for WebError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Network => write!(f, "Falha de rede ao consultar o Claude Web."),
            Self::Unauthorized => write!(
                f,
                "A sessão do Claude expirou. Clique em Reconectar e entre no claude.ai de novo."
            ),
            Self::Cloudflare => write!(
                f,
                "O Cloudflare do claude.ai bloqueou a consulta por enquanto. A última leitura continua visível e o AI Dock tenta de novo sozinho."
            ),
            Self::Forbidden(message) => {
                if message.is_empty() {
                    write!(f, "Claude Web recusou a consulta (HTTP 403).")
                } else {
                    write!(f, "Claude Web recusou a consulta (HTTP 403): {message}")
                }
            }
            Self::Http(code) => write!(f, "Claude Web retornou HTTP {code}."),
            Self::InvalidResponse => write!(f, "O Claude Web respondeu em um formato inesperado."),
            Self::NoOrganization => write!(f, "Nenhuma organização Claude válida foi encontrada nessa sessão."),
        }
    }
}

fn state<T>(cell: &'static OnceLock<Mutex<Option<T>>>) -> &'static Mutex<Option<T>> {
    cell.get_or_init(|| Mutex::new(None))
}

// Credential storage ---------------------------------------------------------

fn credential_entry(account: &str) -> Result<Entry, String> {
    #[cfg(target_os = "linux")]
    ensure_secret_service();
    Entry::new(KEYRING_SERVICE, account).map_err(|_| credential_store_unavailable())
}

fn credential_store_unavailable() -> String {
    #[cfg(target_os = "windows")]
    {
        "Não foi possível acessar o Gerenciador de Credenciais do Windows.".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        "Não foi possível acessar o cofre de segredos do Linux.".to_string()
    }
}

fn credential_store_save_failed() -> String {
    #[cfg(target_os = "windows")]
    {
        "Não consegui salvar o Cookie do Claude no Gerenciador de Credenciais.".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        "Não consegui salvar o cookie do Claude no cofre de segredos do Linux.".to_string()
    }
}

/// Secret Service persists across reboots. If it is installed but not running,
/// start it once. The persistent keyring still falls back to the kernel store.
#[cfg(target_os = "linux")]
fn ensure_secret_service() {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let daemon = std::path::Path::new("/usr/bin/gnome-keyring-daemon");
        if !daemon.is_file() {
            return;
        }
        let _ = std::process::Command::new(daemon)
            .args(["--start", "--components=secrets"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    });
}

fn legacy_session_file() -> Option<PathBuf> {
    dirs::data_local_dir().map(|root| root.join("AI Dock").join("claude-web-session"))
}

fn delete_legacy_session_file() {
    if let Some(path) = legacy_session_file() {
        let _ = fs::remove_file(path);
    }
}

fn persist_cookie_header(cookie_header: &str) -> Result<(), String> {
    credential_entry(KEYRING_ACCOUNT)?
        .set_password(cookie_header)
        .map_err(|_| credential_store_save_failed())?;
    delete_legacy_session_file();
    if let Ok(entry) = credential_entry(LEGACY_KEYRING_ACCOUNT) {
        let _ = entry.delete_credential();
    }
    Ok(())
}

fn migrate_legacy_cookie() -> Option<String> {
    let from_keyring = credential_entry(LEGACY_KEYRING_ACCOUNT)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|value| !value.trim().is_empty());

    let from_file = legacy_session_file()
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let session_key = from_keyring.or(from_file)?;
    let header = format!("sessionKey={session_key}");
    if persist_cookie_header(&header).is_ok() {
        delete_legacy_session_file();
    }
    Some(header)
}

fn stored_cookie_header() -> Option<String> {
    credential_entry(KEYRING_ACCOUNT)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|value| !value.trim().is_empty())
        .or_else(migrate_legacy_cookie)
}

/// Saves the header when it differs from what is stored, so rotations survive restarts.
fn remember_header(header: &str) {
    if stored_cookie_header().as_deref() != Some(header) {
        let _ = persist_cookie_header(header);
    }
}

// Cookie parsing -------------------------------------------------------------

fn normalize_cookie_input(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Cole o Cookie completo de uma requisição do claude.ai.".to_string());
    }

    let cookie_value = trimmed
        .lines()
        .find_map(|line| {
            let line = line.trim();
            let lower = line.to_ascii_lowercase();
            lower
                .starts_with("cookie:")
                .then(|| line.split_once(':').map(|(_, value)| value.trim()).unwrap_or(""))
        })
        .unwrap_or(trimmed)
        .trim();

    if !cookie_value.contains("sessionKey=") {
        if cookie_value.len() < 20 || cookie_value.chars().any(char::is_whitespace) {
            return Err(
                "Cookie incompleto. Cole o cabeçalho Cookie completo ou o valor inteiro do sessionKey."
                    .to_string(),
            );
        }
        return Ok(format!("sessionKey={cookie_value}"));
    }

    let mut pairs = Vec::new();
    let mut has_session_key = false;

    for part in cookie_value.split(';') {
        let part = part.trim();
        let Some((name, value)) = part.split_once('=') else {
            continue;
        };
        let name = name.trim();
        let value = value.trim();
        if value.is_empty() || !ALLOWED.contains(&name) {
            continue;
        }
        if name == "sessionKey" {
            has_session_key = true;
        }
        pairs.push(format!("{name}={value}"));
    }

    if !has_session_key {
        return Err("O Cookie não contém sessionKey.".to_string());
    }

    Ok(pairs.join("; "))
}

fn header_pairs(header: &str) -> Vec<(String, String)> {
    header
        .split(';')
        .filter_map(|part| part.trim().split_once('='))
        .map(|(name, value)| (name.trim().to_string(), value.trim().to_string()))
        .filter(|(name, value)| !value.is_empty() && ALLOWED.contains(&name.as_str()))
        .collect()
}

fn join_pairs(pairs: &[(String, String)]) -> String {
    pairs
        .iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn session_key(header: &str) -> Option<String> {
    header_pairs(header)
        .into_iter()
        .find(|(name, _)| name == "sessionKey")
        .map(|(_, value)| value)
}

/// Builds the request header from WebView2 cookies, keeping only the allowed names.
fn header_from_cookies(cookies: &[Cookie<'static>]) -> Option<String> {
    let mut pairs = Vec::new();
    for name in ALLOWED {
        if let Some(cookie) = cookies.iter().find(|cookie| cookie.name() == name && !cookie.value().is_empty()) {
            pairs.push((name.to_string(), cookie.value().to_string()));
        }
    }
    pairs.iter().any(|(name, _)| name == "sessionKey").then(|| join_pairs(&pairs))
}

/// Applies `Set-Cookie` values from a claude.ai response, so rotated cookies are not lost.
fn apply_set_cookies(header: &str, response_headers: &reqwest::header::HeaderMap) -> Option<String> {
    let mut pairs = header_pairs(header);
    let mut changed = false;
    for raw in response_headers.get_all(SET_COOKIE) {
        let Ok(raw) = raw.to_str() else { continue };
        let first = raw.split(';').next().unwrap_or("");
        let Some((name, value)) = first.split_once('=') else { continue };
        let (name, value) = (name.trim(), value.trim());
        if !ALLOWED.contains(&name) || value.is_empty() {
            continue;
        }
        match pairs.iter_mut().find(|(existing, _)| existing == name) {
            Some(pair) if pair.1 != value => {
                pair.1 = value.to_string();
                changed = true;
            }
            Some(_) => {}
            None => {
                pairs.push((name.to_string(), value.to_string()));
                changed = true;
            }
        }
    }
    changed.then(|| join_pairs(&pairs))
}

// Cloudflare cooldown --------------------------------------------------------

fn cloudflare_cooldown_active() -> bool {
    let Ok(mut guard) = state(&CLOUDFLARE_BLOCKED_UNTIL).lock() else {
        return false;
    };
    match *guard {
        Some(until) if Instant::now() < until => true,
        Some(_) => {
            *guard = None;
            false
        }
        None => false,
    }
}

fn mark_cloudflare_cooldown() {
    if let Ok(mut guard) = state(&CLOUDFLARE_BLOCKED_UNTIL).lock() {
        *guard = Some(Instant::now() + CLOUDFLARE_COOLDOWN);
    }
}

fn clear_cloudflare_cooldown() {
    if let Ok(mut guard) = state(&CLOUDFLARE_BLOCKED_UNTIL).lock() {
        *guard = None;
    }
}

// HTTP -----------------------------------------------------------------------

fn user_agent() -> String {
    state(&USER_AGENT_OVERRIDE)
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .unwrap_or_else(|| DEFAULT_USER_AGENT.to_string())
}

/// Cloudflare ties `cf_clearance` to the browser's user agent, so requests reuse
/// the exact one AI Dock's WebView2 sends.
#[tauri::command]
pub fn set_web_user_agent(user_agent: String) {
    let user_agent = user_agent.trim().to_string();
    if !user_agent.starts_with("Mozilla/") || user_agent.len() > 512 {
        return;
    }
    if let Ok(mut guard) = state(&USER_AGENT_OVERRIDE).lock() {
        *guard = Some(user_agent);
    }
}

fn http_client() -> Result<reqwest::Client, WebError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| WebError::Network)
}

async fn send_request(
    client: &reqwest::Client,
    url: &str,
    cookie_header: &str,
) -> Result<reqwest::Response, WebError> {
    client
        .get(url)
        .header("Cookie", cookie_header)
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, user_agent())
        .header("Origin", "https://claude.ai")
        .header("Referer", "https://claude.ai/settings/usage")
        .send()
        .await
        .map_err(|_| WebError::Network)
}

fn is_cloudflare_challenge(headers: &reqwest::header::HeaderMap, body: &str) -> bool {
    let mitigated = headers
        .get("cf-mitigated")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.eq_ignore_ascii_case("challenge"))
        .unwrap_or(false);

    mitigated
        || body.contains("Just a moment")
        || body.contains("cf-chl-")
        || body.to_ascii_lowercase().contains("cloudflare")
}

fn sanitized_error_message(body: &str) -> String {
    if let Ok(json) = serde_json::from_str::<Value>(body) {
        return json
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .take(180)
            .collect();
    }
    String::new()
}

async fn fetch_json(
    client: &reqwest::Client,
    url: &str,
    cookie_header: &mut String,
) -> Result<Value, WebError> {
    let mut response = send_request(client, url, cookie_header).await?;

    // Sessões recém-renovadas podem receber um 401 transitório.
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        tokio::time::sleep(Duration::from_millis(1_500)).await;
        response = send_request(client, url, cookie_header).await?;
    }

    let status = response.status();
    let headers = response.headers().clone();
    if let Some(updated) = apply_set_cookies(cookie_header, &headers) {
        *cookie_header = updated;
    }
    let body = response
        .text()
        .await
        .map_err(|_| WebError::InvalidResponse)?;

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(WebError::Unauthorized);
    }

    if status == reqwest::StatusCode::FORBIDDEN {
        if is_cloudflare_challenge(&headers, &body) {
            mark_cloudflare_cooldown();
            return Err(WebError::Cloudflare);
        }
        return Err(WebError::Forbidden(sanitized_error_message(&body)));
    }

    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(WebError::Http(429));
    }

    if !status.is_success() {
        return Err(WebError::Http(status.as_u16()));
    }

    serde_json::from_str::<Value>(&body).map_err(|_| WebError::InvalidResponse)
}

fn number(value: Option<&Value>) -> Option<f64> {
    value.and_then(|item| item.as_f64().or_else(|| item.as_i64().map(|n| n as f64)))
}

fn remaining(consumed: f64) -> f64 {
    (100.0 - consumed).clamp(0.0, 100.0)
}

fn reset(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_string)
}

fn organization_ids(document: &Value) -> Vec<String> {
    if let Some(id) = document
        .get("uuid")
        .or_else(|| document.get("id"))
        .and_then(Value::as_str)
    {
        return vec![id.to_string()];
    }

    document
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|org| {
                    org.get("uuid")
                        .or_else(|| org.get("id"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_usage(usage: &Value) -> Result<Vec<UsageWindow>, WebError> {
    let mut windows = Vec::new();
    for (key, id, label) in [
        ("five_hour", "session", "Sessão · 5h"),
        ("seven_day", "weekly", "Semanal"),
        ("seven_day_sonnet", "weekly-sonnet", "Sonnet · semanal"),
        ("seven_day_opus", "weekly-opus", "Opus · semanal"),
    ] {
        if let Some(window) = usage.get(key) {
            if let Some(utilization) = number(window.get("utilization")) {
                windows.push(UsageWindow {
                    id: id.to_string(),
                    label: label.to_string(),
                    remaining_percent: remaining(utilization),
                    reset_at: reset(window.get("resets_at")),
                });
            }
        }
    }

    if windows.is_empty() {
        return Err(WebError::InvalidResponse);
    }
    Ok(windows)
}

/// Human plan name ("Max 5x", "Pro", "Team"...) from the tier and capability
/// strings claude.ai and Claude Code expose. `None` when nothing is recognized.
pub(crate) fn plan_label(tier: Option<&str>, capabilities: &[String], subscription: Option<&str>) -> Option<String> {
    let tier = tier.unwrap_or_default().to_ascii_lowercase();
    let subscription = subscription.unwrap_or_default().to_ascii_lowercase();
    let has = |name: &str| capabilities.iter().any(|capability| capability.eq_ignore_ascii_case(name));

    let label = if tier.contains("max_20x") {
        "Max 20x"
    } else if tier.contains("max_5x") {
        "Max 5x"
    } else if has("claude_max") || subscription == "max" || tier.contains("claude_max") {
        "Max"
    } else if has("claude_pro") || subscription == "pro" || tier.contains("claude_pro") {
        "Pro"
    } else if has("raven") || subscription == "team" || tier.contains("team") {
        "Team"
    } else if subscription == "enterprise" || tier.contains("enterprise") {
        "Enterprise"
    } else if subscription == "free" || tier == "default_claude_ai" {
        "Free"
    } else {
        return None;
    };
    Some(label.to_string())
}

fn organization_plan(organizations: &Value, org_id: &str) -> Option<String> {
    let orgs: Vec<&Value> = match organizations.as_array() {
        Some(list) => list.iter().collect(),
        None => vec![organizations],
    };
    let org = orgs.into_iter().find(|org| {
        org.get("uuid").or_else(|| org.get("id")).and_then(Value::as_str) == Some(org_id)
    })?;
    let capabilities: Vec<String> = org
        .get("capabilities")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    plan_label(org.get("rate_limit_tier").and_then(Value::as_str), &capabilities, None)
}

async fn usage_with_cookie(
    client: &reqwest::Client,
    cookie_header: &mut String,
) -> Result<ProviderUsage, WebError> {
    let organizations =
        fetch_json(client, "https://claude.ai/api/organizations", cookie_header).await?;
    let org_ids = organization_ids(&organizations);
    if org_ids.is_empty() {
        return Err(WebError::NoOrganization);
    }

    let mut last_forbidden: Option<WebError> = None;

    for org_id in org_ids {
        let usage_url = format!("https://claude.ai/api/organizations/{org_id}/usage");
        match fetch_json(client, &usage_url, cookie_header).await {
            Ok(usage) => {
                clear_cloudflare_cooldown();
                return Ok(ProviderUsage {
                    id: "claude".into(),
                    name: "Claude".into(),
                    connected: true,
                    plan: organization_plan(&organizations, &org_id).or_else(|| Some("Web".into())),
                    windows: parse_usage(&usage)?,
                    error: None,
                });
            }
            Err(WebError::Forbidden(message))
                if message
                    .to_ascii_lowercase()
                    .contains("invalid authorization for organization") =>
            {
                last_forbidden = Some(WebError::Forbidden(message));
                continue;
            }
            Err(error) => return Err(error),
        }
    }

    Err(last_forbidden.unwrap_or(WebError::NoOrganization))
}

// AI Dock's own WebView2 session -------------------------------------------

/// Reads claude.ai cookies from the WebView2 profile of one AI Dock window.
/// WebView2 deadlocks when cookies are read on the UI thread, so this runs on a worker.
async fn webview_cookie_header(app: &AppHandle, label: &str) -> Option<String> {
    let window = app.get_webview_window(label)?;
    let url = Url::parse(CLAUDE_ORIGIN).ok()?;
    let cookies = tauri::async_runtime::spawn_blocking(move || window.cookies_for_url(url))
        .await
        .ok()?
        .ok()?;
    header_from_cookies(&cookies)
}

fn webview_key_rejected(key: &str) -> bool {
    state(&REJECTED_WEBVIEW_KEY)
        .lock()
        .map(|guard| guard.as_deref() == Some(key))
        .unwrap_or(false)
}

fn reject_webview_key(key: Option<String>) {
    if let Ok(mut guard) = state(&REJECTED_WEBVIEW_KEY).lock() {
        *guard = key;
    }
}

fn claim_renew_slot() -> bool {
    if RENEWING.swap(true, Ordering::SeqCst) {
        return false;
    }
    let allowed = state(&LAST_RENEW)
        .lock()
        .map(|mut guard| {
            let ok = guard.map_or(true, |last| last.elapsed() >= RENEW_GAP);
            if ok {
                *guard = Some(Instant::now());
            }
            ok
        })
        .unwrap_or(false);
    if !allowed {
        RENEWING.store(false, Ordering::SeqCst);
    }
    allowed
}

/// Opens claude.ai in a hidden AI Dock window for a few seconds so the site can
/// renew its session and Cloudflare cookies, then reads them back.
async fn renew_in_background(app: &AppHandle) -> Option<String> {
    if !claim_renew_slot() {
        return None;
    }
    let result = async {
        let url = Url::parse(RENEW_URL).ok()?;
        let window = WebviewWindowBuilder::new(app, RENEW_LABEL, WebviewUrl::External(url))
            .title("AI Dock · renovando sessão do Claude")
            .inner_size(900.0, 700.0)
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .build()
            .ok()?;
        tokio::time::sleep(RENEW_WAIT).await;
        let header = webview_cookie_header(app, RENEW_LABEL).await;
        let _ = window.destroy();
        header
    }
    .await;
    RENEWING.store(false, Ordering::SeqCst);
    result
}

/// Candidate cookie headers, freshest first, without duplicates.
async fn candidate_headers(app: Option<&AppHandle>) -> Vec<(String, bool)> {
    let mut candidates: Vec<(String, bool)> = Vec::new();
    if let Some(app) = app {
        if let Some(header) = webview_cookie_header(app, "main").await {
            let rejected = session_key(&header).is_some_and(|key| webview_key_rejected(&key));
            if !rejected {
                candidates.push((header, true));
            }
        }
    }
    if let Some(stored) = stored_cookie_header() {
        if !candidates.iter().any(|(header, _)| session_key(header) == session_key(&stored)) {
            candidates.push((stored, false));
        }
    }
    candidates
}

async fn try_headers(
    client: &reqwest::Client,
    candidates: Vec<(String, bool)>,
) -> Result<ProviderUsage, WebError> {
    let mut last_error = WebError::Unauthorized;
    for (mut header, from_webview) in candidates {
        match usage_with_cookie(client, &mut header).await {
            Ok(usage) => {
                remember_header(&header);
                return Ok(usage);
            }
            Err(WebError::Unauthorized) => {
                if from_webview {
                    reject_webview_key(session_key(&header));
                }
                last_error = WebError::Unauthorized;
            }
            Err(error) => return Err(error),
        }
    }
    Err(last_error)
}

/// Claude usage from the web session, renewing it in the background when needed.
/// Returns `None` when no claude.ai session exists anywhere yet.
pub async fn web_usage(app: Option<&AppHandle>) -> Option<ProviderUsage> {
    let candidates = candidate_headers(app).await;
    if candidates.is_empty() {
        return None;
    }

    if cloudflare_cooldown_active() {
        return Some(disconnected("claude", "Claude", WebError::Cloudflare.to_string()));
    }

    let client = match http_client() {
        Ok(client) => client,
        Err(_) => return Some(disconnected("claude", "Claude", "Não foi possível iniciar a conexão com o Claude Web.")),
    };

    let result = match try_headers(&client, candidates).await {
        Err(error @ (WebError::Unauthorized | WebError::Cloudflare)) => match app {
            Some(app) => match renew_in_background(app).await {
                Some(header) => {
                    reject_webview_key(None);
                    clear_cloudflare_cooldown();
                    try_headers(&client, vec![(header, true)]).await
                }
                None => Err(error),
            },
            None => Err(error),
        },
        other => other,
    };

    Some(result.unwrap_or_else(|error| disconnected("claude", "Claude", error.to_string())))
}

// Sign-in window -------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginEvent {
    /// "connected", "closed" or "timeout".
    status: &'static str,
    message: Option<String>,
}

fn emit_login(app: &AppHandle, status: &'static str, message: Option<String>) {
    let _ = app.emit(LOGIN_EVENT, LoginEvent { status, message });
}

/// Opens claude.ai's login page in an AI Dock window. Once the user is signed in,
/// the session is captured, checked, saved and the window closes by itself.
#[tauri::command]
pub async fn claude_login(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LOGIN_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let url = Url::parse(LOGIN_URL).map_err(|error| error.to_string())?;
    WebviewWindowBuilder::new(&app, LOGIN_LABEL, WebviewUrl::External(url))
        .title("Entrar no Claude · AI Dock")
        .inner_size(480.0, 720.0)
        .min_inner_size(380.0, 560.0)
        .center()
        .always_on_top(true)
        .build()
        .map_err(|_| "Não foi possível abrir a janela de login do Claude.".to_string())?;

    let handle = app.clone();
    tauri::async_runtime::spawn(async move { watch_login(handle).await });
    Ok(())
}

async fn watch_login(app: AppHandle) {
    let started = Instant::now();
    let mut last_tried: Option<String> = None;
    let Ok(client) = http_client() else {
        emit_login(&app, "closed", Some("Não foi possível iniciar a conexão com o Claude.".into()));
        return;
    };

    loop {
        tokio::time::sleep(Duration::from_millis(1_500)).await;

        let Some(window) = app.get_webview_window(LOGIN_LABEL) else {
            emit_login(&app, "closed", None);
            return;
        };
        if started.elapsed() > LOGIN_TIMEOUT {
            let _ = window.destroy();
            emit_login(&app, "timeout", Some("O login demorou demais. Tente de novo.".into()));
            return;
        }

        let Some(mut header) = webview_cookie_header(&app, LOGIN_LABEL).await else {
            continue;
        };
        let key = session_key(&header);
        if key.is_none() || key == last_tried {
            continue;
        }
        last_tried = key;

        match usage_with_cookie(&client, &mut header).await {
            // A sessionKey left over from an old login: wait for the new one.
            Err(WebError::Unauthorized) => continue,
            Ok(_) => {
                let _ = persist_cookie_header(&header);
                reject_webview_key(None);
                let _ = window.destroy();
                emit_login(&app, "connected", None);
                return;
            }
            Err(error) => {
                // Signed in, but the usage call hit Cloudflare or the network. Keep the
                // session: the next refresh or background renewal will use it.
                let _ = persist_cookie_header(&header);
                reject_webview_key(None);
                let _ = window.destroy();
                emit_login(&app, "connected", Some(error.to_string()));
                return;
            }
        }
    }
}

// Commands -------------------------------------------------------------------

#[tauri::command]
pub async fn claude_web_status(app: AppHandle) -> ProviderUsage {
    web_usage(Some(&app)).await.unwrap_or_else(|| {
        disconnected(
            "claude",
            "Claude",
            "Claude Web ainda não conectado. Em Configurações → Conexões, clique em Entrar com claude.ai.",
        )
    })
}

#[tauri::command]
pub async fn set_claude_web_session(session_key: String) -> Result<ProviderUsage, String> {
    let mut cookie_header = normalize_cookie_input(&session_key)?;
    clear_cloudflare_cooldown();

    let client = http_client().map_err(|_| "Não foi possível iniciar a conexão com o Claude.".to_string())?;
    let snapshot = usage_with_cookie(&client, &mut cookie_header)
        .await
        .map_err(|error| error.to_string())?;
    persist_cookie_header(&cookie_header)?;
    Ok(snapshot)
}

/// Forgets the Claude session: Credential Manager, the legacy file and the
/// claude.ai cookies in AI Dock's WebView2 profile (a logout for the login window).
#[tauri::command]
pub async fn clear_claude_web_session(app: AppHandle) -> Result<(), String> {
    clear_cloudflare_cooldown();
    reject_webview_key(None);
    delete_legacy_session_file();

    for account in [KEYRING_ACCOUNT, LEGACY_KEYRING_ACCOUNT] {
        if let Ok(entry) = credential_entry(account) {
            let _ = entry.delete_credential();
        }
    }

    if let (Some(window), Ok(url)) = (app.get_webview_window("main"), Url::parse(CLAUDE_ORIGIN)) {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            if let Ok(cookies) = window.cookies_for_url(url) {
                for cookie in cookies {
                    let _ = window.delete_cookie(cookie);
                }
            }
        })
        .await;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue};
    use serde_json::json;

    #[test]
    fn normalizes_full_cookie_and_filters_unrelated_values() {
        let raw = "Cookie: sessionKey=sk-test-12345678901234567890; cf_clearance=cf-token; __cf_bm=bm-token; anthropic-device-id=device-1; unrelated=ignore-me";
        let normalized = normalize_cookie_input(raw).expect("cookie should normalize");

        assert_eq!(
            normalized,
            "sessionKey=sk-test-12345678901234567890; cf_clearance=cf-token; __cf_bm=bm-token; anthropic-device-id=device-1"
        );
        assert!(!normalized.contains("unrelated"));
    }

    #[test]
    fn accepts_legacy_raw_session_key() {
        let raw = "sk-ant-session-key-12345678901234567890";
        let normalized = normalize_cookie_input(raw).expect("legacy session key should normalize");

        assert_eq!(normalized, format!("sessionKey={raw}"));
    }

    #[test]
    fn rejects_empty_or_whitespace_only_cookie() {
        assert!(normalize_cookie_input("   \n  ").is_err());
    }

    #[test]
    fn detects_cloudflare_from_header_or_body() {
        let mut headers = HeaderMap::new();
        headers.insert("cf-mitigated", HeaderValue::from_static("challenge"));
        assert!(is_cloudflare_challenge(&headers, "{}"));

        let headers = HeaderMap::new();
        assert!(is_cloudflare_challenge(
            &headers,
            "<html><title>Just a moment</title></html>"
        ));
        assert!(is_cloudflare_challenge(&headers, "cf-chl-token"));
        assert!(!is_cloudflare_challenge(&headers, r#"{"ok":true}"#));
    }

    #[test]
    fn sanitizes_json_error_message() {
        let body = r#"{"error":{"message":"Invalid authorization for organization"}}"#;
        assert_eq!(
            sanitized_error_message(body),
            "Invalid authorization for organization"
        );
        assert_eq!(sanitized_error_message("<html>not json</html>"), "");
    }

    #[test]
    fn extracts_multiple_organization_ids() {
        let document = json!([
            {"uuid": "org-a"},
            {"id": "org-b"},
            {"name": "missing-id"}
        ]);

        assert_eq!(
            organization_ids(&document),
            vec!["org-a".to_string(), "org-b".to_string()]
        );
    }

    #[test]
    fn parses_claude_usage_as_internal_headroom() {
        let usage = json!({
            "five_hour": {
                "utilization": 76.0,
                "resets_at": "2026-09-23T07:20:00Z"
            },
            "seven_day": {
                "utilization": 30.0,
                "resets_at": "2026-09-29T18:00:00Z"
            }
        });

        let windows = parse_usage(&usage).expect("usage should parse");
        let session = windows.iter().find(|window| window.id == "session").unwrap();
        let weekly = windows.iter().find(|window| window.id == "weekly").unwrap();

        assert_eq!(session.remaining_percent, 24.0);
        assert_eq!(weekly.remaining_percent, 70.0);
        assert_eq!(session.reset_at.as_deref(), Some("2026-09-23T07:20:00Z"));
    }

    #[test]
    fn applies_rotated_set_cookie_values() {
        let mut headers = HeaderMap::new();
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static("sessionKey=sk-new; Path=/; HttpOnly; Secure"),
        );
        headers.append(SET_COOKIE, HeaderValue::from_static("__cf_bm=bm-new; Path=/"));
        headers.append(SET_COOKIE, HeaderValue::from_static("tracking=ignore-me; Path=/"));

        let updated = apply_set_cookies("sessionKey=sk-old; cf_clearance=cf-token", &headers)
            .expect("rotated cookies should update the header");
        assert_eq!(updated, "sessionKey=sk-new; cf_clearance=cf-token; __cf_bm=bm-new");
    }

    #[test]
    fn ignores_set_cookie_without_changes() {
        let mut headers = HeaderMap::new();
        headers.append(SET_COOKIE, HeaderValue::from_static("sessionKey=sk-same; Path=/"));
        assert!(apply_set_cookies("sessionKey=sk-same", &headers).is_none());
        assert!(apply_set_cookies("sessionKey=sk-same", &HeaderMap::new()).is_none());
    }

    #[test]
    fn builds_header_from_webview_cookies_in_a_stable_order() {
        let cookies = vec![
            Cookie::new("__cf_bm", "bm"),
            Cookie::new("unrelated", "x"),
            Cookie::new("sessionKey", "sk"),
            Cookie::new("cf_clearance", "cf"),
        ];
        assert_eq!(
            header_from_cookies(&cookies).as_deref(),
            Some("sessionKey=sk; cf_clearance=cf; __cf_bm=bm")
        );
        assert!(header_from_cookies(&[Cookie::new("cf_clearance", "cf")]).is_none());
    }

    #[test]
    fn plan_label_reads_tiers_capabilities_and_subscriptions() {
        let none: Vec<String> = vec![];
        assert_eq!(plan_label(Some("default_claude_max_20x"), &none, None).as_deref(), Some("Max 20x"));
        assert_eq!(plan_label(Some("default_claude_max_5x"), &none, None).as_deref(), Some("Max 5x"));
        assert_eq!(plan_label(None, &["chat".into(), "claude_pro".into()], None).as_deref(), Some("Pro"));
        assert_eq!(plan_label(None, &none, Some("max")).as_deref(), Some("Max"));
        assert_eq!(plan_label(None, &none, Some("team")).as_deref(), Some("Team"));
        assert_eq!(plan_label(Some("something_new"), &none, None), None);
    }

    #[test]
    fn organization_plan_uses_the_org_that_answered() {
        let orgs = json!([
            { "uuid": "a", "rate_limit_tier": "default_claude_ai", "capabilities": ["chat"] },
            { "uuid": "b", "rate_limit_tier": "default_claude_max_5x", "capabilities": ["chat", "claude_max"] }
        ]);
        assert_eq!(organization_plan(&orgs, "b").as_deref(), Some("Max 5x"));
        assert_eq!(organization_plan(&orgs, "a").as_deref(), Some("Free"));
        assert_eq!(organization_plan(&orgs, "missing"), None);
    }

    #[test]
    fn reads_session_key_from_header() {
        assert_eq!(
            session_key("cf_clearance=cf; sessionKey=sk-1").as_deref(),
            Some("sk-1")
        );
        assert!(session_key("cf_clearance=cf").is_none());
    }
}

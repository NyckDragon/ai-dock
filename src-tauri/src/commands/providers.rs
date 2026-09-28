use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::Serialize;
use serde_json::Value;
use std::{env, fs, path::PathBuf, process::Command};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::AppHandle;

use super::{antigravity, claude_web, cursor};

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageWindow {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) remaining_percent: f64,
    pub(crate) reset_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderUsage {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) connected: bool,
    pub(crate) plan: Option<String>,
    pub(crate) windows: Vec<UsageWindow>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSetupStatus {
    installed: bool,
    authenticated: bool,
    version: Option<String>,
    npm_available: bool,
}

pub(crate) fn disconnected(id: &str, name: &str, error: impl Into<String>) -> ProviderUsage {
    ProviderUsage {
        id: id.to_string(),
        name: name.to_string(),
        connected: false,
        plan: None,
        windows: vec![],
        error: Some(error.into()),
    }
}

fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

fn percent(value: Option<&Value>) -> Option<f64> {
    value.and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|n| n as f64)))
}

fn remaining_percent(consumed: f64) -> f64 {
    (100.0 - consumed).clamp(0.0, 100.0)
}

fn string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_string)
}

fn run_hidden(program: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command.output()
}

async fn codex_usage(client: &reqwest::Client) -> ProviderUsage {
    let auth_path = env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|p| p.join(".codex")))
        .map(|p| p.join("auth.json"));

    let Some(auth_path) = auth_path else {
        return disconnected("codex", "Codex", "Não foi possível localizar a pasta do usuário.");
    };
    let Ok(raw) = fs::read_to_string(&auth_path) else {
        return disconnected("codex", "Codex", "Codex não conectado.");
    };
    let Ok(json) = serde_json::from_str::<Value>(&raw) else {
        return disconnected("codex", "Codex", "O auth.json do Codex não pôde ser lido.");
    };

    let access_token = json
        .get("tokens")
        .and_then(|tokens| tokens.get("access_token").or_else(|| tokens.get("accessToken")))
        .and_then(Value::as_str);
    let Some(access_token) = access_token else {
        return disconnected("codex", "Codex", "Nenhum token OAuth do Codex foi encontrado.");
    };
    let account_id = json
        .get("tokens")
        .and_then(|tokens| tokens.get("account_id").or_else(|| tokens.get("accountId")))
        .and_then(Value::as_str);

    let mut request = client
        .get("https://chatgpt.com/backend-api/wham/usage")
        .header(AUTHORIZATION, format!("Bearer {access_token}"))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "codex-cli");
    if let Some(account_id) = account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(_) => return disconnected("codex", "Codex", "Falha de rede ao consultar o uso do Codex."),
    };
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return disconnected("codex", "Codex", "Sessão do Codex expirou.");
    }
    if !response.status().is_success() {
        return disconnected("codex", "Codex", format!("Codex retornou HTTP {}.", response.status().as_u16()));
    }
    let Ok(usage) = response.json::<Value>().await else {
        return disconnected("codex", "Codex", "Resposta de uso do Codex inválida.");
    };

    let mut windows = vec![];
    if let Some(primary) = usage.pointer("/rate_limit/primary_window") {
        if let Some(used) = percent(primary.get("used_percent")) {
            windows.push(UsageWindow {
                id: "session".into(),
                label: "Sessão · 5h".into(),
                remaining_percent: remaining_percent(used),
                reset_at: primary.get("reset_at").and_then(Value::as_i64).map(format_unix),
            });
        }
    }
    if let Some(secondary) = usage.pointer("/rate_limit/secondary_window") {
        if let Some(used) = percent(secondary.get("used_percent")) {
            windows.push(UsageWindow {
                id: "weekly".into(),
                label: "Semanal".into(),
                remaining_percent: remaining_percent(used),
                reset_at: secondary.get("reset_at").and_then(Value::as_i64).map(format_unix),
            });
        }
    }

    ProviderUsage {
        id: "codex".into(),
        name: "Codex".into(),
        connected: true,
        plan: string(usage.get("plan_type")),
        windows,
        error: None,
    }
}

fn claude_credentials_path() -> Option<PathBuf> {
    env::var_os("CLAUDE_SECURESTORAGE_CONFIG_DIR")
        .or_else(|| env::var_os("CLAUDE_CONFIG_DIR"))
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|p| p.join(".claude")))
        .map(|p| p.join(".credentials.json"))
}

/// Plan from Claude Code's credentials (`subscriptionType`, `rateLimitTier`), when present.
fn claude_code_plan() -> Option<String> {
    let raw = fs::read_to_string(claude_credentials_path()?).ok()?;
    let json = serde_json::from_str::<Value>(&raw).ok()?;
    let oauth = json.get("claudeAiOauth")?;
    claude_web::plan_label(
        oauth.get("rateLimitTier").and_then(Value::as_str),
        &[],
        oauth.get("subscriptionType").and_then(Value::as_str),
    )
}

fn claude_oauth_token() -> Option<String> {
    env::var("CLAUDE_CODE_OAUTH_TOKEN")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .or_else(|| {
            claude_credentials_path()
                .and_then(|path| fs::read_to_string(path).ok())
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .and_then(|json| {
                    json.get("claudeAiOauth")
                        .and_then(|oauth| oauth.get("accessToken"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
        })
}

async fn claude_usage(client: &reqwest::Client) -> ProviderUsage {
    let Some(access_token) = claude_oauth_token() else {
        return disconnected(
            "claude",
            "Claude",
            "Claude Code ainda não vinculado.",
        );
    };

    let response = match client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header(AUTHORIZATION, format!("Bearer {access_token}"))
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .header("anthropic-beta", "oauth-2025-04-20")
        .header(USER_AGENT, "claude-code/2.1.0")
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return disconnected("claude", "Claude", "Falha de rede ao consultar o uso do Claude."),
    };

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return disconnected("claude", "Claude", "Sessão do Claude Code expirou. Reconecte em Configurações → Claude.");
    }
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return disconnected("claude", "Claude", "A Anthropic limitou temporariamente a consulta de uso. Tente atualizar depois.");
    }
    if !response.status().is_success() {
        return disconnected("claude", "Claude", format!("Claude retornou HTTP {}.", response.status().as_u16()));
    }

    let Ok(usage) = response.json::<Value>().await else {
        return disconnected("claude", "Claude", "Resposta de uso do Claude inválida.");
    };
    let mut windows = vec![];
    for (key, id, label) in [
        ("five_hour", "session", "Sessão · 5h"),
        ("seven_day", "weekly", "Semanal"),
        ("seven_day_sonnet", "weekly-sonnet", "Sonnet · semanal"),
        ("seven_day_opus", "weekly-opus", "Opus · semanal"),
    ] {
        if let Some(window) = usage.get(key) {
            if let Some(utilization) = percent(window.get("utilization")) {
                windows.push(UsageWindow {
                    id: id.into(),
                    label: label.into(),
                    remaining_percent: remaining_percent(utilization),
                    reset_at: string(window.get("resets_at")),
                });
            }
        }
    }

    ProviderUsage {
        id: "claude".into(),
        name: "Claude".into(),
        connected: true,
        plan: claude_code_plan().or_else(|| Some("Code".into())),
        windows,
        error: None,
    }
}

async fn resolve_claude(client: &reqwest::Client, app: &AppHandle) -> ProviderUsage {
    let code = claude_usage(client).await;
    if code.connected {
        return code;
    }

    if let Some(web) = claude_web::web_usage(Some(app)).await {
        return web;
    }

    disconnected(
        "claude",
        "Claude",
        "Claude ainda não vinculado. Em Configurações → Conexões, clique em Entrar com claude.ai.",
    )
}

#[cfg(target_os = "windows")]
fn provider_executable() -> Option<PathBuf> {
    if let Some(home) = home_dir() {
        let native = home.join(".local").join("bin").join("claude.exe");
        if native.is_file() {
            return Some(native);
        }
    }

    if let Some(appdata) = env::var_os("APPDATA") {
        let npm = PathBuf::from(appdata).join("npm").join("claude.cmd");
        if npm.is_file() {
            return Some(npm);
        }
    }

    let output = run_hidden("where.exe", &["claude"]).ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .next()
}

#[cfg(target_os = "windows")]
fn provider_version(executable: &PathBuf) -> Option<String> {
    let command_line = format!("\"{}\" --version", executable.display());
    let output = run_hidden("cmd.exe", &["/C", &command_line]).ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

#[cfg(target_os = "windows")]
fn npm_available() -> bool {
    run_hidden("where.exe", &["npm.cmd"])
        .map(|output| output.status.success())
        .unwrap_or(false)
        || run_hidden("where.exe", &["npm"])
            .map(|output| output.status.success())
            .unwrap_or(false)
}

/// The tray does not inherit a login-shell PATH, so the usual install
/// locations are checked as files before `which` is asked.
#[cfg(target_os = "linux")]
fn provider_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = home_dir() {
        candidates.push(home.join(".local").join("bin").join("claude"));
        candidates.push(home.join(".claude").join("local").join("claude"));
    }
    candidates.push(PathBuf::from("/usr/bin/claude"));
    if let Some(found) = candidates.into_iter().find(|path| path.is_file()) {
        return Some(found);
    }
    let output = Command::new("which").arg("claude").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    path.is_file().then_some(path)
}

#[cfg(target_os = "linux")]
fn provider_version(executable: &PathBuf) -> Option<String> {
    let output = Command::new(executable).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// A bare `npm` is invisible to the tray. Only the two absolute installs count.
#[cfg(target_os = "linux")]
fn linux_npm() -> Option<PathBuf> {
    let system = PathBuf::from("/usr/bin/npm");
    if system.is_file() {
        return Some(system);
    }
    let local = home_dir()?.join(".local").join("bin").join("npm");
    local.is_file().then_some(local)
}

#[cfg(target_os = "linux")]
fn npm_available() -> bool {
    linux_npm().is_some()
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn provider_executable() -> Option<PathBuf> {
    None
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn provider_version(_executable: &PathBuf) -> Option<String> {
    None
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn npm_available() -> bool {
    false
}

#[tauri::command]
pub fn provider_setup_status() -> ProviderSetupStatus {
    let executable = provider_executable();
    ProviderSetupStatus {
        installed: executable.is_some(),
        authenticated: claude_oauth_token().is_some(),
        version: executable.as_ref().and_then(provider_version),
        npm_available: npm_available(),
    }
}

#[tauri::command]
pub async fn install_provider_cli() -> Result<ProviderSetupStatus, String> {
    if provider_executable().is_some() {
        return Ok(provider_setup_status());
    }
    if !npm_available() {
        return Err("O Node/npm não foi encontrado neste PC. Preciso instalar essa dependência antes de instalar o Claude Code.".to_string());
    }

    let output = tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            run_hidden("cmd.exe", &["/C", "npm install -g @anthropic-ai/claude-code"])
        }
        #[cfg(target_os = "linux")]
        {
            let Some(npm) = linux_npm() else {
                return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "npm"));
            };
            Command::new(npm)
                .args(["install", "-g", "@anthropic-ai/claude-code"])
                .output()
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "npm"))
        }
    })
    .await
    .map_err(|_| "A instalação do Claude Code foi interrompida.".to_string())?
    .map_err(|_| "Não foi possível iniciar o instalador do Claude Code.".to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "A instalação do Claude Code falhou. Tente novamente.".to_string()
        } else {
            format!("A instalação do Claude Code falhou: {stderr}")
        });
    }

    let status = provider_setup_status();
    if !status.installed {
        return Err("O npm concluiu a instalação, mas o AI Dock ainda não encontrou o Claude Code. Feche e abra o AI Dock e tente novamente.".to_string());
    }
    Ok(status)
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn open_provider_setup() -> Result<(), String> {
    let executable = provider_executable().ok_or_else(|| {
        "Claude Code não está instalado. Use o botão Instalar Claude Code primeiro.".to_string()
    })?;
    let command_line = format!("\"{}\"", executable.display());

    if run_hidden("where.exe", &["wt.exe"])
        .map(|output| output.status.success())
        .unwrap_or(false)
    {
        Command::new("wt.exe")
            .args([
                "new-tab",
                "--title",
                "Conectar Claude ao AI Dock",
                "cmd.exe",
                "/K",
                &command_line,
            ])
            .spawn()
            .map(|_| ())
            .map_err(|_| "Não foi possível abrir o Claude no Windows Terminal.".to_string())
    } else {
        Command::new("cmd.exe")
            .args(["/K", &command_line])
            .spawn()
            .map(|_| ())
            .map_err(|_| "Não foi possível abrir o Claude para autenticação.".to_string())
    }
}

/// Each terminal has its own way to keep a command open. The tray's PATH is
/// empty, so a missing file is skipped instead of trusting the bare name.
#[cfg(target_os = "linux")]
fn spawn_login_terminal(executable: &std::path::Path) -> Result<(), ()> {
    let program = executable.as_os_str();
    let attempts: [(&str, Vec<std::ffi::OsString>); 6] = [
        ("xdg-terminal-exec", vec![program.into()]),
        ("kitty", vec![program.into()]),
        ("foot", vec![program.into()]),
        ("alacritty", vec!["-e".into(), program.into()]),
        ("ghostty", vec!["-e".into(), program.into()]),
        ("wezterm", vec!["start".into(), "--".into(), program.into()]),
    ];
    for (name, args) in attempts {
        let Some(bin) = linux_tool(name) else { continue };
        if Command::new(bin).args(args).spawn().is_ok() {
            return Ok(());
        }
    }
    Err(())
}

#[cfg(target_os = "linux")]
fn linux_tool(name: &str) -> Option<PathBuf> {
    let system = PathBuf::from("/usr/bin").join(name);
    if system.is_file() {
        return Some(system);
    }
    if let Some(home) = home_dir() {
        let local = home.join(".local").join("bin").join(name);
        if local.is_file() {
            return Some(local);
        }
    }
    let output = Command::new("which").arg(name).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    path.is_file().then_some(path)
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn open_provider_setup() -> Result<(), String> {
    let executable = provider_executable().ok_or_else(|| {
        "Claude Code não está instalado. Use o botão Instalar Claude Code primeiro.".to_string()
    })?;
    spawn_login_terminal(&executable)
        .map_err(|_| "Não foi possível abrir o Claude para autenticação.".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
#[tauri::command]
pub fn open_provider_setup() -> Result<(), String> {
    Err("Não foi possível abrir o Claude para autenticação.".to_string())
}

fn format_unix(timestamp: i64) -> String {
    unix_to_iso(timestamp.max(0))
}

fn unix_to_iso(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    let sod = seconds.rem_euclid(86_400);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    y += if m <= 2 { 1 } else { 0 };
    let h = sod / 3600;
    let min = (sod % 3600) / 60;
    let sec = sod % 60;
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{min:02}:{sec:02}Z")
}

#[tauri::command]
pub async fn get_provider_usage(app: AppHandle) -> Vec<ProviderUsage> {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            return vec![
                disconnected("claude", "Claude", "Não foi possível iniciar o cliente HTTP."),
                disconnected("codex", "Codex", "Não foi possível iniciar o cliente HTTP."),
                disconnected("cursor", "Cursor", "Não foi possível iniciar o cliente HTTP."),
                disconnected("antigravity", "Antigravity", "Não foi possível iniciar o cliente HTTP."),
            ];
        }
    };

    let (claude, codex, cursor, antigravity) = tokio::join!(
        resolve_claude(&client, &app),
        codex_usage(&client),
        cursor::usage(&client),
        antigravity::usage(),
    );
    vec![claude, codex, cursor, antigravity]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn percent_accepts_numeric_json_values_only() {
        assert_eq!(percent(Some(&json!(42))), Some(42.0));
        assert_eq!(percent(Some(&json!(42.5))), Some(42.5));
        assert_eq!(percent(Some(&json!("42"))), None);
        assert_eq!(percent(None), None);
    }

    #[test]
    fn remaining_percent_inverts_and_clamps_consumed_usage() {
        assert_eq!(remaining_percent(0.0), 100.0);
        assert_eq!(remaining_percent(76.0), 24.0);
        assert_eq!(remaining_percent(100.0), 0.0);
        assert_eq!(remaining_percent(-10.0), 100.0);
        assert_eq!(remaining_percent(125.0), 0.0);
    }

    #[test]
    fn unix_time_conversion_is_stable_and_negative_input_is_clamped() {
        assert_eq!(unix_to_iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(unix_to_iso(1_609_459_200), "2021-01-01T00:00:00Z");
        assert_eq!(format_unix(-1), "1970-01-01T00:00:00Z");
    }
}

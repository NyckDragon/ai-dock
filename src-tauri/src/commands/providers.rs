use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::Serialize;
use serde_json::Value;
use std::{env, fs, path::PathBuf, process::Command};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use super::antigravity;

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
            "Claude Code não conectado. Em Configurações → Claude, use Conectar Claude uma vez.",
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
        plan: None,
        windows,
        error: None,
    }
}

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

fn provider_version(executable: &PathBuf) -> Option<String> {
    let command_line = format!("\"{}\" --version", executable.display());
    let output = run_hidden("cmd.exe", &["/C", &command_line]).ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

#[tauri::command]
pub fn provider_setup_status() -> ProviderSetupStatus {
    let executable = provider_executable();
    ProviderSetupStatus {
        installed: executable.is_some(),
        authenticated: claude_oauth_token().is_some(),
        version: executable.as_ref().and_then(provider_version),
    }
}

#[tauri::command]
pub fn open_provider_setup() -> Result<(), String> {
    let executable = provider_executable().ok_or_else(|| {
        "Claude Code não está instalado. Instale o Claude Code oficial para vincular os limites da sua conta.".to_string()
    })?;
    let command_line = format!("\"{}\" auth login", executable.display());

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
                &format!("{command_line} & echo. & echo Login concluido? Feche esta janela e volte ao AI Dock."),
            ])
            .spawn()
            .map(|_| ())
            .map_err(|_| "Não foi possível abrir a autenticação no Windows Terminal.".to_string())
    } else {
        Command::new("cmd.exe")
            .args([
                "/K",
                &format!("{command_line} & echo. & echo Login concluido? Feche esta janela e volte ao AI Dock."),
            ])
            .spawn()
            .map(|_| ())
            .map_err(|_| "Não foi possível abrir a autenticação do Claude Code.".to_string())
    }
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
pub async fn get_provider_usage() -> Vec<ProviderUsage> {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            return vec![
                disconnected("claude", "Claude", "Não foi possível iniciar o cliente HTTP."),
                disconnected("codex", "Codex", "Não foi possível iniciar o cliente HTTP."),
                disconnected("antigravity", "Antigravity", "Não foi possível iniciar o cliente HTTP."),
            ];
        }
    };

    let claude_future = claude_usage(&client);
    let codex_future = codex_usage(&client);
    let antigravity_future = antigravity::usage();
    let (claude, codex, antigravity) = tokio_join(claude_future, codex_future, antigravity_future).await;
    vec![claude, codex, antigravity]
}

async fn tokio_join<A, B, C>(a: A, b: B, c: C) -> (ProviderUsage, ProviderUsage, ProviderUsage)
where
    A: std::future::Future<Output = ProviderUsage>,
    B: std::future::Future<Output = ProviderUsage>,
    C: std::future::Future<Output = ProviderUsage>,
{
    let a = a.await;
    let b = b.await;
    let c = c.await;
    (a, b, c)
}

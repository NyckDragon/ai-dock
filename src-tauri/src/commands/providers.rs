use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::Serialize;
use serde_json::Value;
use std::{env, fs, path::PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    id: String,
    label: String,
    used_percent: f64,
    reset_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    id: String,
    name: String,
    connected: bool,
    plan: Option<String>,
    windows: Vec<UsageWindow>,
    error: Option<String>,
}

fn disconnected(id: &str, name: &str, error: impl Into<String>) -> ProviderUsage {
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

fn string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_string)
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
        return disconnected("codex", "Codex", "Codex não conectado. Execute `codex login`.");
    };
    let Ok(json) = serde_json::from_str::<Value>(&raw) else {
        return disconnected("codex", "Codex", "O auth.json do Codex não pôde ser lido.");
    };

    let tokens = json.get("tokens").unwrap_or(&Value::Null);
    let access_token = tokens
        .get("access_token")
        .or_else(|| tokens.get("accessToken"))
        .and_then(Value::as_str);
    let Some(access_token) = access_token else {
        return disconnected("codex", "Codex", "Nenhum token OAuth do Codex foi encontrado.");
    };
    let account_id = tokens
        .get("account_id")
        .or_else(|| tokens.get("accountId"))
        .and_then(Value::as_str);

    let mut request = client
        .get("https://chatgpt.com/backend-api/wham/usage")
        .header(AUTHORIZATION, format!("Bearer {access_token}"))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "AI-Dock/0.1");
    if let Some(account_id) = account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(_) => return disconnected("codex", "Codex", "Falha de rede ao consultar o uso do Codex."),
    };
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return disconnected("codex", "Codex", "Sessão do Codex expirou. Execute `codex login` novamente.");
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
                used_percent: used,
                reset_at: primary.get("reset_at").and_then(Value::as_i64).map(|s| format_unix(s)),
            });
        }
    }
    if let Some(secondary) = usage.pointer("/rate_limit/secondary_window") {
        if let Some(used) = percent(secondary.get("used_percent")) {
            windows.push(UsageWindow {
                id: "weekly".into(),
                label: "Semanal".into(),
                used_percent: used,
                reset_at: secondary.get("reset_at").and_then(Value::as_i64).map(|s| format_unix(s)),
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

async fn claude_usage(client: &reqwest::Client) -> ProviderUsage {
    let Some(path) = home_dir().map(|p| p.join(".claude").join(".credentials.json")) else {
        return disconnected("claude", "Claude", "Não foi possível localizar a pasta do usuário.");
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return disconnected("claude", "Claude", "Claude Code não conectado. Execute `claude login`.");
    };
    let Ok(json) = serde_json::from_str::<Value>(&raw) else {
        return disconnected("claude", "Claude", "As credenciais do Claude não puderam ser lidas.");
    };
    let oauth = json.get("claudeAiOauth").unwrap_or(&Value::Null);
    let Some(access_token) = oauth.get("accessToken").and_then(Value::as_str) else {
        return disconnected("claude", "Claude", "Nenhum token OAuth do Claude Code foi encontrado.");
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
        return disconnected("claude", "Claude", "Sessão do Claude expirou. Execute `claude logout` e `claude login`.");
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
    if let Some(five) = usage.get("five_hour") {
        if let Some(used) = percent(five.get("utilization")) {
            windows.push(UsageWindow {
                id: "session".into(),
                label: "Sessão · 5h".into(),
                used_percent: used,
                reset_at: string(five.get("resets_at")),
            });
        }
    }
    if let Some(seven) = usage.get("seven_day") {
        if let Some(used) = percent(seven.get("utilization")) {
            windows.push(UsageWindow {
                id: "weekly".into(),
                label: "Semanal".into(),
                used_percent: used,
                reset_at: string(seven.get("resets_at")),
            });
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

fn format_unix(timestamp: i64) -> String {
    // JavaScript's Date can parse this ISO representation reliably.
    let seconds = timestamp.max(0);
    let dt = std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds as u64);
    let system_now = std::time::SystemTime::now();
    let offset = dt.duration_since(system_now).ok().map(|d| d.as_secs() as i64).unwrap_or(0);
    // Keep dependency surface small: return a millisecond timestamp encoded as an ISO-compatible JS date via frontend fallback.
    let target_ms = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i128 + offset as i128 * 1000) as i64;
    // Date accepts numeric strings poorly, so produce a UTC timestamp manually using a tiny conversion helper.
    unix_to_iso(target_ms / 1000)
}

fn unix_to_iso(seconds: i64) -> String {
    // Howard Hinnant civil-from-days algorithm; avoids another runtime dependency for one display field.
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
    let client = match reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build() {
        Ok(client) => client,
        Err(_) => {
            return vec![
                disconnected("claude", "Claude", "Não foi possível iniciar o cliente HTTP."),
                disconnected("codex", "Codex", "Não foi possível iniciar o cliente HTTP."),
            ];
        }
    };

    // Kept explicit for the MVP. Each provider is isolated and can be parallelized later.
    let claude = claude_usage(&client).await;
    let codex = codex_usage(&client).await;
    vec![claude, codex]
}

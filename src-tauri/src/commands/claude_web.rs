use keyring::Entry;
use reqwest::header::{ACCEPT, USER_AGENT};
use serde_json::Value;

use super::providers::{disconnected, ProviderUsage, UsageWindow};

const KEYRING_SERVICE: &str = "AI Dock";
const KEYRING_ACCOUNT: &str = "claude-web-session";

fn credential_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|_| "Não foi possível acessar o Gerenciador de Credenciais do Windows.".to_string())
}

fn normalize_session_key(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Cole o valor do cookie sessionKey do Claude.".to_string());
    }

    let value = if trimmed.contains("sessionKey=") {
        trimmed
            .split(';')
            .find_map(|part| {
                let part = part.trim();
                part.strip_prefix("sessionKey=").map(str::trim)
            })
            .unwrap_or(trimmed)
    } else {
        trimmed
    };

    if value.len() < 20 || value.chars().any(char::is_whitespace) {
        return Err("Esse sessionKey parece incompleto. Copie apenas o valor inteiro do cookie sessionKey.".to_string());
    }

    Ok(value.to_string())
}

pub(crate) fn stored_session_key() -> Option<String> {
    credential_entry().ok()?.get_password().ok().filter(|value| !value.trim().is_empty())
}

pub(crate) fn has_session_key() -> bool {
    stored_session_key().is_some()
}

fn cookie_header(session_key: &str) -> String {
    format!("sessionKey={session_key}")
}

async fn fetch_json(client: &reqwest::Client, url: &str, session_key: &str) -> Result<Value, String> {
    let response = client
        .get(url)
        .header("Cookie", cookie_header(session_key))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "Mozilla/5.0 AI-Dock/0.2.2")
        .header("Origin", "https://claude.ai")
        .header("Referer", "https://claude.ai/settings/usage")
        .send()
        .await
        .map_err(|_| "Falha de rede ao consultar o Claude Web.".to_string())?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err("O sessionKey do Claude expirou ou não é válido. Copie um novo em claude.ai.".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("Claude Web retornou HTTP {}.", response.status().as_u16()));
    }

    response
        .json::<Value>()
        .await
        .map_err(|_| "O Claude Web respondeu em um formato inesperado.".to_string())
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

fn organization_id(document: &Value) -> Option<String> {
    let list = document.as_array()?;
    list.iter().find_map(|org| {
        org.get("uuid")
            .or_else(|| org.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string)
    })
}

async fn usage_with_key(client: &reqwest::Client, session_key: &str) -> Result<ProviderUsage, String> {
    let organizations = fetch_json(client, "https://claude.ai/api/organizations", session_key).await?;
    let org_id = organization_id(&organizations)
        .ok_or_else(|| "Nenhuma organização Claude foi encontrada nessa sessão.".to_string())?;

    let usage_url = format!("https://claude.ai/api/organizations/{org_id}/usage");
    let usage = fetch_json(client, &usage_url, session_key).await?;

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
        return Err("O Claude conectou, mas não devolveu janelas de uso para essa conta.".to_string());
    }

    Ok(ProviderUsage {
        id: "claude".into(),
        name: "Claude".into(),
        connected: true,
        plan: None,
        windows,
        error: None,
    })
}

pub(crate) async fn usage(client: &reqwest::Client) -> ProviderUsage {
    let Some(session_key) = stored_session_key() else {
        return disconnected(
            "claude",
            "Claude",
            "Claude ainda não vinculado. Em Configurações → Claude, conecte sua sessão Web uma vez.",
        );
    };

    usage_with_key(client, &session_key)
        .await
        .unwrap_or_else(|error| disconnected("claude", "Claude", error))
}

#[tauri::command]
pub async fn claude_web_usage() -> ProviderUsage {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
    {
        Ok(client) => client,
        Err(_) => return disconnected("claude", "Claude", "Não foi possível iniciar a conexão com o Claude Web."),
    };
    usage(&client).await
}

#[tauri::command]
pub fn claude_web_status() -> bool {
    has_session_key()
}

#[tauri::command]
pub async fn set_claude_web_session(session_key: String) -> Result<ProviderUsage, String> {
    let session_key = normalize_session_key(&session_key)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|_| "Não foi possível iniciar a conexão com o Claude.".to_string())?;

    let snapshot = usage_with_key(&client, &session_key).await?;
    credential_entry()?
        .set_password(&session_key)
        .map_err(|_| "O Claude conectou, mas não consegui salvar a sessão no Gerenciador de Credenciais do Windows.".to_string())?;
    Ok(snapshot)
}

#[tauri::command]
pub fn clear_claude_web_session() -> Result<(), String> {
    let entry = credential_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Não foi possível remover a sessão do Claude do Gerenciador de Credenciais do Windows.".to_string()),
    }
}

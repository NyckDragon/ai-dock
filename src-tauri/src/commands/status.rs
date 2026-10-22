//! Official service status for each provider, from their public Statuspage feeds.
//!
//! Only public status pages are read; no account or credential is involved.
//! Antigravity has no matching public feed, so it gets no status.

use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    provider_id: String,
    /// "none", "maintenance", "minor", "major" or "critical".
    level: String,
    /// Incident or degraded component names, most relevant first.
    summary: Option<String>,
    url: String,
}

struct Feed {
    provider_id: &'static str,
    base: &'static str,
    /// Components that matter for this provider; empty means the whole page.
    components: &'static [&'static str],
}

const FEEDS: [Feed; 3] = [
    Feed {
        provider_id: "claude",
        base: "https://status.claude.com",
        components: &["claude.ai", "claude code", "claude api"],
    },
    Feed {
        provider_id: "codex",
        base: "https://status.openai.com",
        components: &["codex"],
    },
    Feed {
        provider_id: "cursor",
        base: "https://status.cursor.com",
        components: &[],
    },
];

fn rank(level: &str) -> u8 {
    match level {
        "critical" | "major_outage" => 4,
        "major" | "partial_outage" => 3,
        "minor" | "degraded_performance" => 2,
        "maintenance" | "under_maintenance" => 1,
        _ => 0,
    }
}

fn level_name(rank: u8) -> &'static str {
    match rank {
        4 => "critical",
        3 => "major",
        2 => "minor",
        1 => "maintenance",
        _ => "none",
    }
}

fn relevant(name: &str, filters: &[&str]) -> bool {
    let name = name.to_lowercase();
    filters.is_empty() || filters.iter().any(|filter| name.contains(filter))
}

/// Reads a Statuspage v2 `summary.json`: unresolved incidents and non-operational
/// components that match the provider's filters.
fn parse_summary(provider_id: &str, url: &str, document: &Value, filters: &[&str]) -> ProviderStatus {
    let mut worst = 0u8;
    let mut notes: Vec<String> = Vec::new();

    for incident in document.get("incidents").and_then(Value::as_array).into_iter().flatten() {
        let status = incident.get("status").and_then(Value::as_str).unwrap_or_default();
        if matches!(status, "resolved" | "postmortem" | "completed") {
            continue;
        }
        let affected: Vec<&str> = incident
            .get("components")
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(|c| c.get("name").and_then(Value::as_str)).collect())
            .unwrap_or_default();
        if !affected.is_empty() && !affected.iter().any(|name| relevant(name, filters)) {
            continue;
        }
        let impact = incident.get("impact").and_then(Value::as_str).unwrap_or("minor");
        worst = worst.max(rank(impact).max(2));
        if let Some(name) = incident.get("name").and_then(Value::as_str) {
            notes.push(name.trim().to_string());
        }
    }

    for component in document.get("components").and_then(Value::as_array).into_iter().flatten() {
        let name = component.get("name").and_then(Value::as_str).unwrap_or_default();
        let status = component.get("status").and_then(Value::as_str).unwrap_or("operational");
        if status == "operational" || !relevant(name, filters) {
            continue;
        }
        worst = worst.max(rank(status));
        if notes.len() < 3 && !notes.iter().any(|note| note.contains(name)) {
            notes.push(name.to_string());
        }
    }

    notes.truncate(3);
    ProviderStatus {
        provider_id: provider_id.to_string(),
        level: level_name(worst).to_string(),
        summary: (!notes.is_empty()).then(|| notes.join(" · ")),
        url: url.to_string(),
    }
}

async fn read_feed(client: &reqwest::Client, feed: &Feed) -> Option<ProviderStatus> {
    let document = client
        .get(format!("{}/api/v2/summary.json", feed.base))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    Some(parse_summary(feed.provider_id, feed.base, &document, feed.components))
}

#[tauri::command]
pub async fn get_provider_status() -> Vec<ProviderStatus> {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("AI-Dock")
        .build()
    else {
        return vec![];
    };
    let (claude, codex, cursor) = tokio::join!(
        read_feed(&client, &FEEDS[0]),
        read_feed(&client, &FEEDS[1]),
        read_feed(&client, &FEEDS[2]),
    );
    [claude, codex, cursor].into_iter().flatten().collect()
}

/// Opens one of the known status pages in the default browser.
#[tauri::command]
pub fn open_status_page(provider_id: String) -> Result<(), String> {
    let feed = FEEDS
        .iter()
        .find(|feed| feed.provider_id == provider_id)
        .ok_or_else(|| "Página de status desconhecida.".to_string())?;
    open_url(feed.base)
}

fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|_| "Não foi possível abrir o navegador.".to_string())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|_| "Não foi possível abrir o navegador.".to_string())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|_| "Não foi possível abrir o navegador.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn all_operational_is_none() {
        let document = json!({
            "status": { "indicator": "none" },
            "components": [{ "name": "claude.ai", "status": "operational" }],
            "incidents": []
        });
        let status = parse_summary("claude", "https://status.claude.com", &document, &["claude.ai"]);
        assert_eq!(status.level, "none");
        assert_eq!(status.summary, None);
    }

    #[test]
    fn incident_on_a_relevant_component_is_reported() {
        let document = json!({
            "components": [{ "name": "Claude Code", "status": "degraded_performance" }],
            "incidents": [{
                "name": "Elevated errors on Claude Code",
                "status": "investigating",
                "impact": "major",
                "components": [{ "name": "Claude Code" }]
            }]
        });
        let status = parse_summary("claude", "u", &document, &["claude code"]);
        assert_eq!(status.level, "major");
        assert_eq!(status.summary.as_deref(), Some("Elevated errors on Claude Code"));
    }

    #[test]
    fn unrelated_components_and_resolved_incidents_are_ignored() {
        let document = json!({
            "components": [
                { "name": "Images", "status": "major_outage" },
                { "name": "Codex Web", "status": "operational" }
            ],
            "incidents": [
                { "name": "Images down", "status": "identified", "impact": "critical", "components": [{ "name": "Images" }] },
                { "name": "Old Codex issue", "status": "resolved", "impact": "major", "components": [{ "name": "Codex Web" }] }
            ]
        });
        let status = parse_summary("codex", "u", &document, &["codex"]);
        assert_eq!(status.level, "none");
    }

    #[test]
    fn degraded_component_without_incident_counts_as_minor() {
        let document = json!({
            "components": [{ "name": "Codex API", "status": "degraded_performance" }]
        });
        let status = parse_summary("codex", "u", &document, &["codex"]);
        assert_eq!(status.level, "minor");
        assert_eq!(status.summary.as_deref(), Some("Codex API"));
    }

    #[test]
    fn maintenance_is_its_own_level() {
        let document = json!({ "components": [{ "name": "IDE", "status": "under_maintenance" }] });
        assert_eq!(parse_summary("cursor", "u", &document, &[]).level, "maintenance");
    }
}

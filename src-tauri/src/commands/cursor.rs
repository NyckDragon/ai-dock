//! Cursor usage adapter.
//!
//! Reads the signed-in Cursor editor session from its local VS Code-style state DB:
//! %APPDATA%\Cursor\User\globalStorage\state.vscdb
//!
//! The database is opened read-only. Credentials are re-read for each usage refresh,
//! are never persisted by AI Dock, and never appear in logs or UI.

use reqwest::header::{ACCEPT, COOKIE, USER_AGENT};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::{env, path::{Path, PathBuf}};

use super::providers::{disconnected, ProviderUsage, UsageWindow};

const ENDPOINT: &str = "https://cursor.com/api/usage-summary";

pub(crate) fn store_path() -> Option<PathBuf> {
    env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(dirs::config_dir)
        .map(|root| root.join("Cursor").join("User").join("globalStorage").join("state.vscdb"))
}

fn immutable_uri(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let encoded = normalized
        .replace('%', "%25")
        .replace('#', "%23")
        .replace('?', "%3F");
    format!("file:///{}?immutable=1", encoded.trim_start_matches('/'))
}

pub(crate) fn open_store() -> Option<Connection> {
    let path = store_path()?;
    if !path.is_file() {
        return None;
    }

    if let Ok(conn) = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        if conn
            .prepare("SELECT 1 FROM ItemTable LIMIT 1")
            .and_then(|mut stmt| stmt.query([]).map(|_| ()))
            .is_ok()
        {
            return Some(conn);
        }
    }

    Connection::open_with_flags(
        immutable_uri(&path),
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()
}

fn item(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM ItemTable WHERE key = ?1",
        [key],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .filter(|value| !value.trim().is_empty())
}

struct CursorCredentials {
    cookie: String,
    plan: Option<String>,
}

fn credentials() -> Option<CursorCredentials> {
    let conn = open_store()?;
    let token = item(&conn, "cursorAuth/accessToken")?;
    let auth_id = item(&conn, "cursorAuth/stripeMembershipAuthId")?;
    let plan = item(&conn, "cursorAuth/stripeMembershipType");

    Some(CursorCredentials {
        cookie: format!("WorkosCursorSessionToken={auth_id}::{token}"),
        plan,
    })
}

fn number(value: Option<&Value>) -> Option<f64> {
    value.and_then(|value| {
        value
            .as_f64()
            .or_else(|| value.as_i64().map(|number| number as f64))
    })
}

fn percent_remaining(used_percent: f64) -> f64 {
    (100.0 - used_percent).clamp(0.0, 100.0)
}

fn reset_at(summary: &Value) -> Option<String> {
    summary
        .get("billingCycleEnd")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn parse_usage(summary: &Value, fallback_plan: Option<String>) -> ProviderUsage {
    let usage = summary
        .get("individualUsage")
        .cloned()
        .unwrap_or(Value::Null);
    let plan_usage = usage.get("plan").cloned().unwrap_or(Value::Null);
    let reset = reset_at(summary);
    let mut windows = Vec::new();

    // Cursor's dashboard headline. Zero is a real reading and must become 100% remaining.
    if let Some(used_percent) = number(plan_usage.get("totalPercentUsed")) {
        windows.push(UsageWindow {
            id: "included".into(),
            label: "Uso incluído".into(),
            remaining_percent: percent_remaining(used_percent),
            reset_at: reset.clone(),
        });
    }

    if let Some(api_used_percent) = number(plan_usage.get("apiPercentUsed")) {
        if api_used_percent > 0.0 {
            windows.push(UsageWindow {
                id: "api".into(),
                label: "Uso de API".into(),
                remaining_percent: percent_remaining(api_used_percent),
                reset_at: reset.clone(),
            });
        }
    }

    if let Some(on_demand) = usage.get("onDemand") {
        let enabled = on_demand
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let limit = number(on_demand.get("limit")).unwrap_or(0.0);
        let used = number(on_demand.get("used"));

        if enabled && limit > 0.0 {
            if let Some(used) = used {
                let used_percent = (used / limit * 100.0).clamp(0.0, 100.0);
                windows.push(UsageWindow {
                    id: "on-demand".into(),
                    label: "Sob demanda".into(),
                    remaining_percent: percent_remaining(used_percent),
                    reset_at: reset.clone(),
                });
            }
        }
    }

    let membership = summary
        .get("membershipType")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or(fallback_plan);

    let unlimited = summary
        .get("isUnlimited")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    ProviderUsage {
        id: "cursor".into(),
        name: "Cursor".into(),
        connected: true,
        plan: if unlimited {
            membership
                .map(|plan| format!("{plan} · Ilimitado"))
                .or_else(|| Some("Ilimitado".into()))
        } else {
            membership
        },
        windows,
        error: None,
    }
}

pub(crate) async fn usage(client: &reqwest::Client) -> ProviderUsage {
    let Some(path) = store_path() else {
        return disconnected("cursor", "Cursor", "Não foi possível localizar a pasta de dados do Cursor.");
    };
    if !path.is_file() {
        return disconnected("cursor", "Cursor", "Cursor não encontrado neste PC.");
    }

    let Some(creds) = credentials() else {
        return disconnected(
            "cursor",
            "Cursor",
            "Abra o Cursor e faça login para o AI Dock ler o uso da sua sessão local.",
        );
    };

    let response = match client
        .get(ENDPOINT)
        .header(COOKIE, &creds.cookie)
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "AI-Dock/0.4")
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => {
            return disconnected(
                "cursor",
                "Cursor",
                "Falha de rede ao consultar o uso do Cursor.",
            )
        }
    };

    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return disconnected(
            "cursor",
            "Cursor",
            "A sessão local do Cursor foi recusada. Entre novamente no editor.",
        );
    }

    if !response.status().is_success() {
        return disconnected(
            "cursor",
            "Cursor",
            format!("Cursor retornou HTTP {}.", response.status().as_u16()),
        );
    }

    let Ok(summary) = response.json::<Value>().await else {
        return disconnected("cursor", "Cursor", "Resposta de uso do Cursor inválida.");
    };

    parse_usage(&summary, creds.plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_percent_used_is_a_real_reading() {
        let value = serde_json::json!({
            "billingCycleEnd": "2026-10-01T00:00:00Z",
            "membershipType": "pro",
            "individualUsage": {
                "plan": {
                    "totalPercentUsed": 0
                }
            }
        });

        let parsed = parse_usage(&value, None);
        assert!(parsed.connected);
        assert_eq!(parsed.windows.len(), 1);
        assert_eq!(parsed.windows[0].remaining_percent, 100.0);
    }

    #[test]
    fn parses_included_api_and_on_demand_windows() {
        let value = serde_json::json!({
            "billingCycleEnd": "2026-10-01T00:00:00Z",
            "membershipType": "pro",
            "individualUsage": {
                "plan": {
                    "totalPercentUsed": 25,
                    "apiPercentUsed": 10
                },
                "onDemand": {
                    "enabled": true,
                    "used": 20,
                    "limit": 100
                }
            }
        });

        let parsed = parse_usage(&value, None);
        assert_eq!(parsed.windows.len(), 3);
        assert_eq!(parsed.windows[0].remaining_percent, 75.0);
        assert_eq!(parsed.windows[1].remaining_percent, 90.0);
        assert_eq!(parsed.windows[2].remaining_percent, 80.0);
    }
}

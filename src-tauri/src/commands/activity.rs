use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySession {
    id: String,
    title: String,
    detail: String,
    state: String,
    since: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderActivity {
    provider_id: String,
    state: String,
    confidence: String,
    sessions: Vec<ActivitySession>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn mtime_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

fn idle(provider_id: &str, confidence: &str) -> ProviderActivity {
    ProviderActivity {
        provider_id: provider_id.to_string(),
        state: "idle".into(),
        confidence: confidence.into(),
        sessions: vec![],
    }
}

fn open_read_only(path: &Path) -> Option<Connection> {
    if !path.is_file() {
        return None;
    }
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()
}

fn sqlite_time_ms(value: rusqlite::types::Value) -> u64 {
    match value {
        rusqlite::types::Value::Integer(value) => {
            let raw = value.max(0) as u64;
            if raw > 10_000_000_000 { raw } else { raw.saturating_mul(1000) }
        }
        rusqlite::types::Value::Real(value) => {
            if value <= 0.0 {
                0
            } else if value > 10_000_000_000.0 {
                value as u64
            } else {
                (value * 1000.0) as u64
            }
        }
        _ => 0,
    }
}

fn codex_desktop_activity() -> Option<ProviderActivity> {
    let home = dirs::home_dir()?;
    let turns_path = home.join(".codex").join("thread_history_1.sqlite");
    let names_path = home.join(".codex").join("state_5.sqlite");
    let turns = open_read_only(&turns_path)?;
    let names = open_read_only(&names_path);
    let now = now_ms();

    let mut stmt = turns
        .prepare("SELECT thread_id, started_at FROM thread_turns WHERE status = 'inProgress' ORDER BY started_at DESC LIMIT 8")
        .ok()?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, rusqlite::types::Value>(1)?,
            ))
        })
        .ok()?;

    let mut sessions = vec![];
    for row in rows.flatten() {
        let (thread_id, started) = row;
        let started_ms = sqlite_time_ms(started);
        let (last_ms, last_type): (Option<i64>, Option<String>) = turns
            .query_row(
                "SELECT created_at_ms, item_type FROM thread_items WHERE thread_id = ?1 ORDER BY created_at_ms DESC LIMIT 1",
                [&thread_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((None, None));
        let last_seen = last_ms.map(|value| value.max(0) as u64).unwrap_or(started_ms);
        let fresh = now.saturating_sub(last_seen) <= 10 * 60_000
            || now.saturating_sub(started_ms) <= 2 * 60_000;
        if !fresh {
            continue;
        }

        let mut title = String::new();
        if let Some(names) = names.as_ref() {
            if let Ok((saved_title, first_message, nickname)) = names.query_row(
                "SELECT COALESCE(title,''), COALESCE(first_user_message,''), COALESCE(agent_nickname,'') FROM threads WHERE id = ?1",
                [&thread_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
            ) {
                title = if !saved_title.trim().is_empty() {
                    saved_title
                } else if !first_message.trim().is_empty() {
                    first_message.chars().take(56).collect()
                } else if !nickname.trim().is_empty() {
                    "Agent ".to_string() + &nickname
                } else {
                    String::new()
                };
            }
        }
        if title.is_empty() {
            title = "Codex".into();
        }

        let item_type = last_type.unwrap_or_default().to_lowercase();
        let waiting = item_type.contains("approval")
            || item_type.contains("permission")
            || item_type.contains("request_user");
        sessions.push(ActivitySession {
            id: thread_id,
            title,
            detail: if waiting { "Precisa da sua ação".into() } else { "Executando tarefa".into() },
            state: if waiting { "waiting".into() } else { "working".into() },
            since: started_ms.max(1),
        });
    }

    if sessions.is_empty() {
        return Some(idle("codex", "direct"));
    }
    let state = if sessions.iter().any(|session| session.state == "waiting") {
        "waiting"
    } else {
        "working"
    };
    Some(ProviderActivity {
        provider_id: "codex".into(),
        state: state.into(),
        confidence: "direct".into(),
        sessions,
    })
}

fn newest_codex_rollout() -> Option<PathBuf> {
    let root = dirs::home_dir()?.join(".codex").join("sessions");
    if !root.is_dir() {
        return None;
    }
    WalkDir::new(root)
        .max_depth(8)
        .into_iter()
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("jsonl"))
        .filter_map(|entry| {
            let modified = mtime_ms(entry.path())?;
            Some((entry.path().to_path_buf(), modified))
        })
        .max_by_key(|(_, modified)| *modified)
        .map(|(path, _)| path)
}

fn codex_rollout_activity() -> ProviderActivity {
    let Some(path) = newest_codex_rollout() else {
        return idle("codex", "inferred");
    };
    let Some(modified) = mtime_ms(&path) else {
        return idle("codex", "inferred");
    };
    if now_ms().saturating_sub(modified) > 120_000 {
        return idle("codex", "inferred");
    }

    let tail = fs::read_to_string(&path)
        .ok()
        .map(|content| {
            let start = content.len().saturating_sub(96_000);
            content[start..].to_lowercase()
        })
        .unwrap_or_default();
    let waiting = tail.contains("approval")
        || tail.contains("permission")
        || tail.contains("request_user");

    ProviderActivity {
        provider_id: "codex".into(),
        state: if waiting { "waiting".into() } else { "working".into() },
        confidence: "inferred".into(),
        sessions: vec![ActivitySession {
            id: path.to_string_lossy().to_string(),
            title: "Codex".into(),
            detail: if waiting { "Precisa da sua ação".into() } else { "Executando tarefa".into() },
            state: if waiting { "waiting".into() } else { "working".into() },
            since: modified,
        }],
    }
}

fn codex_activity() -> ProviderActivity {
    codex_desktop_activity().unwrap_or_else(codex_rollout_activity)
}

fn antigravity_state_roots() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else { return vec![] };
    let Ok(entries) = fs::read_dir(home.join(".gemini")) else { return vec![] };
    let mut roots: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("antigravity"))
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    roots.sort();
    roots
}

fn antigravity_activity() -> ProviderActivity {
    let mut newest: Option<(String, u64)> = None;
    for root in antigravity_state_roots() {
        let Ok(brains) = fs::read_dir(root.join("brain")) else { continue };
        for brain in brains.flatten() {
            let transcript = brain
                .path()
                .join(".system_generated")
                .join("logs")
                .join("transcript.jsonl");
            let Some(modified) = mtime_ms(&transcript) else { continue };
            if newest.as_ref().map(|(_, current)| modified > *current).unwrap_or(true) {
                newest = Some((brain.file_name().to_string_lossy().to_string(), modified));
            }
        }
    }

    let Some((session_id, modified)) = newest else {
        return idle("antigravity", "inferred");
    };
    if now_ms().saturating_sub(modified) > 45_000 {
        return idle("antigravity", "inferred");
    }

    ProviderActivity {
        provider_id: "antigravity".into(),
        state: "working".into(),
        confidence: "inferred".into(),
        sessions: vec![ActivitySession {
            id: session_id,
            title: "Antigravity".into(),
            detail: "Executando tarefa".into(),
            state: "working".into(),
            since: modified,
        }],
    }
}

#[tauri::command]
pub async fn get_provider_activity() -> Vec<ProviderActivity> {
    tauri::async_runtime::spawn_blocking(|| vec![codex_activity(), antigravity_activity()])
        .await
        .unwrap_or_default()
}

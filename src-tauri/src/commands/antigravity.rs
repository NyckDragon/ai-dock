use portable_pty::{native_pty_system, CommandBuilder, PtySize, PtySystem};
use regex::Regex;
use serde_json::{json, Value};
use std::{
    env,
    io::{Read, Write},
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use super::providers::{disconnected, ProviderUsage, UsageWindow};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const LS_SERVICE: &str = "exa.language_server_pb.LanguageServerService";

struct LanguageServer {
    ports: Vec<u16>,
    extension_port: Option<u16>,
    csrf_token: String,
}

pub(crate) async fn usage() -> ProviderUsage {
    let servers = tauri::async_runtime::spawn_blocking(discover_language_servers)
        .await
        .unwrap_or_default();

    for server in &servers {
        if let Some(usage) = try_language_server(server).await {
            return usage;
        }
    }

    tauri::async_runtime::spawn_blocking(usage_via_agy)
        .await
        .unwrap_or_else(|_| disconnected("antigravity", "Antigravity", "Falha ao iniciar a leitura local do Antigravity."))
}

fn run_hidden(program: &str, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().ok()?;
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn flag_value(tokens: &[&str], flag: &str) -> Option<String> {
    for (index, token) in tokens.iter().enumerate() {
        if let Some(value) = token.strip_prefix(&format!("{flag}=")) {
            return Some(value.trim_matches('"').to_string());
        }
        if *token == flag {
            return tokens.get(index + 1).map(|value| value.trim_matches('"').to_string());
        }
    }
    None
}

fn discover_language_servers() -> Vec<LanguageServer> {
    let script = "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(language_server|language-server|agy)' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress";
    let Some(raw) = run_hidden("powershell.exe", &["-NoProfile", "-NonInteractive", "-Command", script]) else {
        return vec![];
    };
    if raw.trim().is_empty() {
        return vec![];
    }

    let Ok(parsed) = serde_json::from_str::<Value>(raw.trim()) else {
        return vec![];
    };
    let processes = match parsed {
        Value::Array(items) => items,
        object @ Value::Object(_) => vec![object],
        _ => vec![],
    };
    let netstat = run_hidden("netstat.exe", &["-ano", "-p", "TCP"]).unwrap_or_default();
    let mut found = vec![];

    for process in processes {
        let command_line = process.get("CommandLine").and_then(Value::as_str).unwrap_or_default();
        let pid = process.get("ProcessId").and_then(Value::as_u64).unwrap_or_default() as u32;
        if command_line.is_empty() || pid == 0 {
            continue;
        }

        let tokens: Vec<&str> = command_line.split_whitespace().collect();
        let ide_name = flag_value(&tokens, "--ide_name")
            .or_else(|| flag_value(&tokens, "--override_ide_name"))
            .unwrap_or_default()
            .to_lowercase();
        let app_data = flag_value(&tokens, "--app_data_dir")
            .unwrap_or_default()
            .to_lowercase();
        let lower_command = command_line.to_lowercase();
        let is_antigravity = ide_name == "antigravity"
            || ide_name == "antigravity-ide"
            || app_data.contains("antigravity")
            || lower_command.contains("\\antigravity\\")
            || lower_command.contains("/antigravity/");
        if !is_antigravity {
            continue;
        }

        let csrf_token = flag_value(&tokens, "--csrf_token").unwrap_or_default();
        if csrf_token.is_empty() {
            continue;
        }
        let extension_port = flag_value(&tokens, "--extension_server_port")
            .and_then(|value| value.parse::<u16>().ok());

        let mut ports: Vec<u16> = netstat
            .lines()
            .filter(|line| line.contains("LISTENING") && line.trim().ends_with(&pid.to_string()))
            .filter_map(|line| {
                let local = line.split_whitespace().nth(1)?;
                let (address, port) = local.rsplit_once(':')?;
                if address == "127.0.0.1" || address == "0.0.0.0" || address == "[::1]" || address == "[::]" {
                    port.parse::<u16>().ok()
                } else {
                    None
                }
            })
            .collect();
        ports.sort_unstable();
        ports.dedup();

        if ports.is_empty() && extension_port.is_none() {
            continue;
        }
        found.push(LanguageServer {
            ports,
            extension_port,
            csrf_token,
        });
    }

    found
}

fn local_client() -> reqwest::Client {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(Duration::from_secs(4))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

async fn ls_call(scheme: &str, port: u16, csrf: &str, method: &str) -> Option<Value> {
    let url = format!("{scheme}://127.0.0.1:{port}/{LS_SERVICE}/{method}");
    let response = local_client()
        .post(url)
        .header("Content-Type", "application/json")
        .header("Connect-Protocol-Version", "1")
        .header("X-Codeium-Csrf-Token", csrf)
        .json(&json!({
            "metadata": {
                "ideName": "antigravity",
                "extensionName": "antigravity",
                "ideVersion": "unknown",
                "locale": "en"
            }
        }))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().await.ok()
}

async fn try_language_server(server: &LanguageServer) -> Option<ProviderUsage> {
    let mut attempts = vec![];
    for port in &server.ports {
        attempts.push(("https", *port));
        attempts.push(("http", *port));
    }
    if let Some(port) = server.extension_port {
        attempts.push(("http", port));
    }

    for (scheme, port) in attempts {
        if let Some(document) = ls_call(scheme, port, &server.csrf_token, "RetrieveUserQuotaSummary").await {
            let payload = document.get("response").unwrap_or(&document);
            let windows = parse_quota_summary(payload);
            if !windows.is_empty() {
                let plan = ls_call(scheme, port, &server.csrf_token, "GetUserStatus")
                    .await
                    .and_then(|doc| extract_plan(&doc));
                return Some(ProviderUsage {
                    id: "antigravity".into(),
                    name: "Antigravity".into(),
                    connected: true,
                    plan,
                    windows,
                    error: None,
                });
            }
        }
    }

    None
}

fn parse_quota_summary(document: &Value) -> Vec<UsageWindow> {
    let groups = document.get("groups").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut windows = vec![];

    for group in groups {
        let group_name = group.get("displayName").and_then(Value::as_str).unwrap_or_default().to_lowercase();
        let family = if group_name.contains("gemini") {
            "Gemini"
        } else if group_name.contains("claude") || group_name.contains("gpt") {
            "Claude + GPT"
        } else {
            continue;
        };

        for bucket in group.get("buckets").and_then(Value::as_array).cloned().unwrap_or_default() {
            let bucket_id = bucket.get("bucketId").and_then(Value::as_str).unwrap_or_default().to_lowercase();
            let bucket_name = bucket.get("displayName").and_then(Value::as_str).unwrap_or_default().to_lowercase();
            let cadence_text = format!("{bucket_id} {bucket_name}");
            let (cadence_id, cadence_label) = if cadence_text.contains("week") {
                ("weekly", "semanal")
            } else if cadence_text.contains("5h")
                || cadence_text.contains("5-hour")
                || cadence_text.contains("five hour")
                || cadence_text.contains("session")
            {
                ("session", "5h")
            } else {
                continue;
            };

            let remaining_fraction = bucket
                .get("remainingFraction")
                .and_then(Value::as_f64)
                .or_else(|| bucket.pointer("/remaining/remainingFraction").and_then(Value::as_f64));
            let Some(remaining_fraction) = remaining_fraction else { continue };
            let remaining_percent = (remaining_fraction * 100.0).clamp(0.0, 100.0);
            let prefix = if family == "Gemini" { "gemini" } else { "claude-gpt" };
            let id = format!("{prefix}-{cadence_id}");
            let reset_at = bucket
                .get("resetTime")
                .and_then(Value::as_str)
                .or_else(|| bucket.pointer("/remaining/resetTime").and_then(Value::as_str))
                .map(str::to_string);

            let window = UsageWindow {
                id: id.clone(),
                label: format!("{family} · {cadence_label}"),
                remaining_percent,
                reset_at,
            };
            if let Some(existing) = windows.iter_mut().find(|item: &&mut UsageWindow| item.id == id) {
                *existing = window;
            } else {
                windows.push(window);
            }
        }
    }

    windows.sort_by_key(|item| match item.id.as_str() {
        "gemini-session" => 0,
        "gemini-weekly" => 1,
        "claude-gpt-session" => 2,
        "claude-gpt-weekly" => 3,
        _ => 4,
    });
    windows
}

fn extract_plan(document: &Value) -> Option<String> {
    document
        .pointer("/userStatus/userTier/name")
        .or_else(|| document.pointer("/response/userStatus/userTier/name"))
        .or_else(|| document.pointer("/userStatus/planStatus/planInfo/planName"))
        .or_else(|| document.pointer("/response/userStatus/planStatus/planInfo/planName"))
        .and_then(Value::as_str)
        .map(|value| value.trim_start_matches("Google AI ").to_string())
}

fn usage_via_agy() -> ProviderUsage {
    let Some(executable) = locate_agy() else {
        return disconnected(
            "antigravity",
            "Antigravity",
            "O Antigravity aberto não expôs a quota local e o fallback agy não foi encontrado. Mantenha o Antigravity aberto e clique em Atualizar.",
        );
    };

    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows: 50,
        cols: 140,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(pair) => pair,
        Err(_) => return disconnected("antigravity", "Antigravity", "Não foi possível iniciar o terminal isolado do Antigravity."),
    };

    let working_dir = env::temp_dir().join("ai-dock-antigravity");
    let _ = std::fs::create_dir_all(&working_dir);

    let mut command = CommandBuilder::new(executable);
    command.cwd(working_dir);
    command.env("NO_COLOR", "1");
    command.env("TERM", "xterm-256color");

    let mut child = match pair.slave.spawn_command(command) {
        Ok(child) => child,
        Err(_) => return disconnected("antigravity", "Antigravity", "O agy foi encontrado, mas não conseguiu iniciar."),
    };
    drop(pair.slave);

    let mut reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(_) => {
            let _ = child.kill();
            return disconnected("antigravity", "Antigravity", "Não foi possível ler a saída do agy.");
        }
    };
    let mut writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(_) => {
            let _ = child.kill();
            return disconnected("antigravity", "Antigravity", "Não foi possível enviar o comando de quota ao agy.");
        }
    };

    let captured = Arc::new(Mutex::new(Vec::<u8>::with_capacity(32_768)));
    let reader_buffer = Arc::clone(&captured);
    let read_thread = thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    let mut buffer = reader_buffer.lock().unwrap_or_else(|error| error.into_inner());
                    if buffer.len() >= 262_144 {
                        break;
                    }
                    let remaining = 262_144usize.saturating_sub(buffer.len());
                    buffer.extend_from_slice(&chunk[..size.min(remaining)]);
                }
            }
        }
    });

    thread::sleep(Duration::from_secs(3));
    let _ = writer.write_all(b"/usage\r");
    let _ = writer.flush();

    let deadline = Instant::now() + Duration::from_secs(15);
    let mut settled = false;
    while Instant::now() < deadline {
        thread::sleep(Duration::from_millis(250));
        let text = snapshot_text(&captured);
        if has_quota_panel(&text) {
            thread::sleep(Duration::from_millis(1250));
            settled = true;
            break;
        }
        if looks_signed_out(&text) {
            break;
        }
    }

    let _ = child.kill();
    drop(writer);
    let _ = read_thread.join();
    let output = snapshot_text(&captured);

    if looks_signed_out(&output) {
        return disconnected("antigravity", "Antigravity", "O agy está instalado, mas não está logado.");
    }

    let windows = parse_terminal_usage(&output);
    if windows.is_empty() {
        return disconnected(
            "antigravity",
            "Antigravity",
            if settled {
                "O painel de quota abriu, mas os percentuais não puderam ser interpretados."
            } else {
                "Antigravity não retornou as quotas a tempo."
            },
        );
    }

    ProviderUsage {
        id: "antigravity".into(),
        name: "Antigravity".into(),
        connected: true,
        plan: None,
        windows,
        error: None,
    }
}

fn snapshot_text(captured: &Arc<Mutex<Vec<u8>>>) -> String {
    let buffer = captured.lock().unwrap_or_else(|error| error.into_inner());
    String::from_utf8_lossy(&buffer).into_owned()
}

fn locate_agy() -> Option<PathBuf> {
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        let local = PathBuf::from(local_app_data);
        for candidate in [
            local.join("agy").join("bin").join("agy.exe"),
            local.join("Programs").join("Antigravity").join("agy.exe"),
            local.join("Programs").join("Antigravity").join("bin").join("agy.exe"),
        ] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    let mut command = Command::new("where.exe");
    command.arg("agy.exe");
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().ok()?;
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

fn strip_terminal_sequences(raw: &str) -> String {
    let osc = Regex::new(r"\x1B\][^\x07]*(?:\x07|\x1B\\)").unwrap();
    let csi = Regex::new(r"\x1B\[[0-?]*[ -/]*[@-~]").unwrap();
    let clean = osc.replace_all(raw, "");
    let clean = csi.replace_all(&clean, "");
    clean.replace('\r', "\n")
}

fn has_quota_panel(raw: &str) -> bool {
    let lower = strip_terminal_sequences(raw).to_lowercase();
    lower.contains('%') && (lower.contains("quota") || lower.contains("remaining") || lower.contains("weekly"))
}

fn looks_signed_out(raw: &str) -> bool {
    let lower = strip_terminal_sequences(raw).to_lowercase();
    lower.contains("sign in")
        || lower.contains("log in")
        || lower.contains("login required")
        || lower.contains("choose an account")
        || lower.contains("not logged")
}

fn parse_terminal_usage(raw: &str) -> Vec<UsageWindow> {
    let clean = strip_terminal_sequences(raw);
    let lines: Vec<String> = clean
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();
    let percent_re = Regex::new(r"(?i)(\d{1,3}(?:\.\d+)?)\s*%\s*(used|remaining|left|available)?").unwrap();
    let decoration_re = Regex::new(r"[│┃┌┐└┘├┤┬┴┼─━═█▓▒░■●○◉]+|[=\[\]<>]+").unwrap();
    let space_re = Regex::new(r"\s+").unwrap();
    let iso_re = Regex::new(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z").unwrap();

    let mut group: Option<&str> = None;
    let mut windows: Vec<UsageWindow> = vec![];

    for (index, line) in lines.iter().enumerate() {
        let lower = line.to_lowercase();
        if lower.contains("gemini") && lower.contains("model") {
            group = Some("Gemini");
            continue;
        }
        if lower.contains("claude") && lower.contains("gpt") {
            group = Some("Claude + GPT");
            continue;
        }

        let Some(active_group) = group else { continue };
        let Some(capture) = percent_re.captures(line) else { continue };
        let Some(value) = capture.get(1).and_then(|match_| match_.as_str().parse::<f64>().ok()) else { continue };
        let qualifier = capture.get(2).map(|match_| match_.as_str().to_lowercase()).unwrap_or_default();
        let remaining = if qualifier == "used" { 100.0 - value } else { value };

        let percent_start = capture.get(0).map(|match_| match_.start()).unwrap_or(line.len());
        let mut label = line[..percent_start].to_string();
        label = decoration_re.replace_all(&label, " ").into_owned();
        label = space_re.replace_all(&label, " ").trim_matches([' ', ':', '-']).to_string();
        if label.len() < 2 {
            if let Some(previous) = lines.get(index.saturating_sub(1)) {
                label = decoration_re.replace_all(previous, " ").into_owned();
                label = space_re.replace_all(&label, " ").trim().to_string();
            }
        }
        let label_lower = label.to_lowercase();
        let cadence = if label_lower.contains("week") {
            Some(("weekly", "semanal"))
        } else if label_lower.contains("5h")
            || label_lower.contains("5 h")
            || label_lower.contains("5-hour")
            || label_lower.contains("five hour")
            || label_lower.contains("session")
        {
            Some(("session", "5h"))
        } else {
            None
        };
        let Some((cadence_id, cadence_label)) = cadence else { continue };

        let id_prefix = if active_group == "Gemini" { "gemini" } else { "claude-gpt" };
        let id = format!("{id_prefix}-{cadence_id}");
        let reset_at = lines
            .iter()
            .skip(index)
            .take(4)
            .find_map(|candidate| iso_re.find(candidate).map(|match_| match_.as_str().to_string()));
        let item = UsageWindow {
            id: id.clone(),
            label: format!("{active_group} · {cadence_label}"),
            remaining_percent: remaining.clamp(0.0, 100.0),
            reset_at,
        };

        if let Some(existing) = windows.iter_mut().find(|item| item.id == id) {
            *existing = item;
        } else {
            windows.push(item);
        }
    }

    windows.sort_by_key(|item| match item.id.as_str() {
        "gemini-session" => 0,
        "gemini-weekly" => 1,
        "claude-gpt-session" => 2,
        "claude-gpt-weekly" => 3,
        _ => 4,
    });
    windows
}

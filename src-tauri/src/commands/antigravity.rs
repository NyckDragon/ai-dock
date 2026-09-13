use portable_pty::{native_pty_system, CommandBuilder, PtySize, PtySystem};
use regex::Regex;
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

pub(crate) async fn usage() -> ProviderUsage {
    tauri::async_runtime::spawn_blocking(usage_blocking)
        .await
        .unwrap_or_else(|_| disconnected("antigravity", "Antigravity", "Falha ao iniciar a leitura local do Antigravity."))
}

fn usage_blocking() -> ProviderUsage {
    let Some(executable) = locate_agy() else {
        return disconnected(
            "antigravity",
            "Antigravity",
            "Antigravity CLI (agy) não encontrado. Instale o agy oficial e faça login uma vez para mostrar as quotas aqui.",
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
                    let mut buffer = reader_buffer.lock().unwrap_or_else(|e| e.into_inner());
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
        return disconnected(
            "antigravity",
            "Antigravity",
            "O agy está instalado, mas não está logado. Abra o Antigravity CLI uma vez e entre com sua conta Google.",
        );
    }

    let windows = parse_usage(&output);
    if windows.is_empty() {
        return disconnected(
            "antigravity",
            "Antigravity",
            if settled {
                "O painel de quota do Antigravity abriu, mas não consegui interpretar os percentuais. Atualize o agy e tente novamente."
            } else {
                "Antigravity não retornou as quotas a tempo. Abra o agy, confirme que /usage funciona e atualize novamente."
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
    let buffer = captured.lock().unwrap_or_else(|e| e.into_inner());
    String::from_utf8_lossy(&buffer).into_owned()
}

fn locate_agy() -> Option<PathBuf> {
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        let candidate = PathBuf::from(local_app_data).join("agy").join("bin").join("agy.exe");
        if candidate.is_file() {
            return Some(candidate);
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

fn parse_usage(raw: &str) -> Vec<UsageWindow> {
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
        let Some(value) = capture.get(1).and_then(|m| m.as_str().parse::<f64>().ok()) else { continue };
        let qualifier = capture.get(2).map(|m| m.as_str().to_lowercase()).unwrap_or_default();
        let remaining = if qualifier == "used" { 100.0 - value } else { value };

        let percent_start = capture.get(0).map(|m| m.start()).unwrap_or(line.len());
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
            .find_map(|candidate| iso_re.find(candidate).map(|m| m.as_str().to_string()));
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

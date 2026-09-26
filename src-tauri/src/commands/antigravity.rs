use regex::Regex;
use serde_json::{json, Value};
use std::{env, path::PathBuf, process::Command, time::Duration};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use super::providers::{disconnected, ProviderUsage, UsageWindow};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const LS_SERVICE: &str = "exa.language_server_pb.LanguageServerService";

#[derive(Default)]
struct Discovery {
    installed: bool,
    app_running: bool,
    servers: Vec<LanguageServer>,
}

struct LanguageServer {
    ports: Vec<u16>,
    extension_port: Option<u16>,
    csrf_token: String,
    extension_csrf_token: String,
}

pub(crate) async fn usage() -> ProviderUsage {
    let discovery = tauri::async_runtime::spawn_blocking(discover)
        .await
        .unwrap_or_default();

    for server in &discovery.servers {
        if let Some(snapshot) = try_language_server(server).await {
            return snapshot;
        }
    }

    if discovery.app_running {
        return disconnected(
            "antigravity",
            "Antigravity",
            "Antigravity foi detectado e está aberto, mas esta sessão não expôs uma quota local legível. Clique em Atualizar depois que a tela principal terminar de carregar.",
        );
    }

    if discovery.installed {
        return disconnected(
            "antigravity",
            "Antigravity",
            "Antigravity foi encontrado neste PC. Abra o Antigravity, aguarde alguns segundos e clique em Atualizar.",
        );
    }

    disconnected(
        "antigravity",
        "Antigravity",
        "Antigravity não foi encontrado em %LOCALAPPDATA%\\Programs\\antigravity\\Antigravity.exe.",
    )
}

fn install_root() -> Option<PathBuf> {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("Programs").join("antigravity"))
}

fn antigravity_exe() -> Option<PathBuf> {
    let root = install_root()?;
    for name in ["Antigravity.exe", "antigravity.exe"] {
        let candidate = root.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn run_hidden(program: &str, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().ok()?;
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn command_flag(command_line: &str, flag: &str) -> Option<String> {
    let escaped = regex::escape(flag);
    let pattern = format!(r#"(?i)(?:^|\s)--{escaped}(?:=|\s+)(?:\"([^\"]+)\"|([^\s]+))"#);
    let regex = Regex::new(&pattern).ok()?;
    let captures = regex.captures(command_line)?;
    captures
        .get(1)
        .or_else(|| captures.get(2))
        .map(|value| value.as_str().trim_matches('"').to_string())
}

fn discover() -> Discovery {
    let installed = antigravity_exe().is_some();
    let script = r#"
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\antigravity'
$all = @(Get-CimInstance Win32_Process)
$roots = @($all | Where-Object {
  $_.Name -ieq 'Antigravity.exe' -and (
    -not $_.ExecutablePath -or $_.ExecutablePath.StartsWith($installRoot, [System.StringComparison]::OrdinalIgnoreCase)
  )
})
$ids = New-Object 'System.Collections.Generic.HashSet[int]'
$frontier = @($roots | ForEach-Object { [int]$_.ProcessId })
foreach ($id in $frontier) { [void]$ids.Add($id) }
while ($frontier.Count -gt 0) {
  $next = @()
  foreach ($proc in $all) {
    if ($ids.Contains([int]$proc.ParentProcessId) -and -not $ids.Contains([int]$proc.ProcessId)) {
      [void]$ids.Add([int]$proc.ProcessId)
      $next += [int]$proc.ProcessId
    }
  }
  $frontier = $next
}
$all | Where-Object {
  $ids.Contains([int]$_.ProcessId) -or
  $_.Name -match '^(language_server|language-server|agy)' -or
  ($_.CommandLine -and $_.CommandLine -match '(?i)antigravity')
} | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress
"#;

    let Some(raw) = run_hidden(
        "powershell.exe",
        &["-NoProfile", "-NonInteractive", "-Command", script],
    ) else {
        return Discovery { installed, ..Default::default() };
    };

    if raw.trim().is_empty() {
        return Discovery { installed, ..Default::default() };
    }

    let Ok(parsed) = serde_json::from_str::<Value>(raw.trim()) else {
        return Discovery { installed, ..Default::default() };
    };
    let processes = match parsed {
        Value::Array(items) => items,
        object @ Value::Object(_) => vec![object],
        _ => vec![],
    };

    let app_running = processes.iter().any(|process| {
        process
            .get("Name")
            .and_then(Value::as_str)
            .is_some_and(|name| name.eq_ignore_ascii_case("Antigravity.exe"))
    });

    let netstat = run_hidden("netstat.exe", &["-ano", "-p", "TCP"]).unwrap_or_default();
    let install_marker = install_root()
        .map(|path| path.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mut servers = vec![];

    for process in processes {
        let command_line = process
            .get("CommandLine")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let executable = process
            .get("ExecutablePath")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let name = process.get("Name").and_then(Value::as_str).unwrap_or_default();
        let pid = process
            .get("ProcessId")
            .and_then(Value::as_u64)
            .unwrap_or_default() as u32;
        if pid == 0 || command_line.is_empty() {
            continue;
        }

        let lower_command = command_line.to_lowercase();
        let lower_executable = executable.to_lowercase();
        let lower_name = name.to_lowercase();
        let app_data = command_flag(command_line, "app_data_dir")
            .unwrap_or_default()
            .to_lowercase();
        let ide_name = command_flag(command_line, "ide_name")
            .or_else(|| command_flag(command_line, "override_ide_name"))
            .unwrap_or_default()
            .to_lowercase();

        let looks_like_server = lower_name.starts_with("language_server")
            || lower_name.starts_with("language-server")
            || lower_name == "agy.exe"
            || lower_command.contains("language_server")
            || lower_command.contains("language-server");
        let belongs_to_antigravity = app_data.contains("antigravity")
            || ide_name.contains("antigravity")
            || lower_command.contains("antigravity")
            || (!install_marker.is_empty() && lower_executable.starts_with(&install_marker));

        if !looks_like_server || !belongs_to_antigravity {
            continue;
        }

        let csrf_token = command_flag(command_line, "csrf_token")
            .or_else(|| command_flag(command_line, "csrf-token"))
            .unwrap_or_default();
        let extension_csrf_token = command_flag(command_line, "extension_server_csrf_token")
            .or_else(|| command_flag(command_line, "extension-server-csrf-token"))
            .unwrap_or_else(|| csrf_token.clone());
        let extension_port = command_flag(command_line, "extension_server_port")
            .or_else(|| command_flag(command_line, "extension-server-port"))
            .and_then(|value| value.parse::<u16>().ok());

        let mut ports: Vec<u16> = netstat
            .lines()
            .filter(|line| line.contains("LISTENING") && line.trim().ends_with(&pid.to_string()))
            .filter_map(|line| {
                let local = line.split_whitespace().nth(1)?;
                let (address, port) = local.rsplit_once(':')?;
                if matches!(address, "127.0.0.1" | "0.0.0.0" | "[::1]" | "[::]") {
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

        servers.push(LanguageServer {
            ports,
            extension_port,
            csrf_token,
            extension_csrf_token,
        });
    }

    Discovery {
        installed,
        app_running,
        servers,
    }
}

fn local_client() -> reqwest::Client {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

async fn ls_call(scheme: &str, port: u16, csrf: &str, method: &str) -> Option<Value> {
    let url = format!("{scheme}://127.0.0.1:{port}/{LS_SERVICE}/{method}");
    let mut request = local_client()
        .post(url)
        .header("Content-Type", "application/json")
        .header("Connect-Protocol-Version", "1")
        .json(&json!({
            "metadata": {
                "ideName": "antigravity",
                "extensionName": "antigravity",
                "ideVersion": "unknown",
                "locale": "en"
            }
        }));
    if !csrf.is_empty() {
        request = request.header("X-Codeium-Csrf-Token", csrf);
    }
    let response = request.send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().await.ok()
}

async fn try_language_server(server: &LanguageServer) -> Option<ProviderUsage> {
    let mut attempts: Vec<(&str, u16, &str)> = vec![];
    for port in &server.ports {
        attempts.push(("https", *port, &server.csrf_token));
        attempts.push(("http", *port, &server.csrf_token));
    }
    if let Some(port) = server.extension_port {
        attempts.push(("http", port, &server.extension_csrf_token));
    }

    for (scheme, port, token) in attempts {
        if let Some(document) = ls_call(scheme, port, token, "RetrieveUserQuotaSummary").await {
            let payload = document.get("response").unwrap_or(&document);
            let windows = parse_quota_summary(payload);
            if !windows.is_empty() {
                let plan = ls_call(scheme, port, token, "GetUserStatus")
                    .await
                    .and_then(|doc| extract_plan(&doc));
                return Some(connected(plan, windows));
            }
        }

        for method in ["GetUserStatus", "GetCommandModelConfigs", "GetCascadeModelConfigData"] {
            if let Some(document) = ls_call(scheme, port, token, method).await {
                let windows = parse_legacy_model_quotas(&document);
                if !windows.is_empty() {
                    let plan = extract_plan(&document).or_else(|| {
                        // Some legacy endpoints only carry quota rows. Ask status separately for plan metadata.
                        None
                    });
                    return Some(connected(plan, windows));
                }
            }
        }
    }

    None
}

fn connected(plan: Option<String>, windows: Vec<UsageWindow>) -> ProviderUsage {
    ProviderUsage {
        id: "antigravity".into(),
        name: "Antigravity".into(),
        connected: true,
        plan,
        windows,
        error: None,
    }
}

fn parse_quota_summary(document: &Value) -> Vec<UsageWindow> {
    let groups = document
        .get("groups")
        .or_else(|| document.pointer("/response/groups"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut windows = vec![];

    for group in groups {
        let group_name = group
            .get("displayName")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_lowercase();
        let family = if group_name.contains("gemini") {
            "Gemini"
        } else if group_name.contains("claude") || group_name.contains("gpt") {
            "Claude + GPT"
        } else {
            continue;
        };

        let buckets = group
            .get("buckets")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for bucket in buckets {
            if bucket.get("disabled").and_then(Value::as_bool) == Some(true) {
                continue;
            }
            let bucket_id = bucket
                .get("bucketId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_lowercase();
            let bucket_name = bucket
                .get("displayName")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_lowercase();
            let cadence = format!("{bucket_id} {bucket_name}");
            let (cadence_id, cadence_label) = if cadence.contains("week") {
                ("weekly", "semanal")
            } else if cadence.contains("5h")
                || cadence.contains("5-hour")
                || cadence.contains("five hour")
                || cadence.contains("session")
            {
                ("session", "5h")
            } else {
                continue;
            };

            let remaining = bucket
                .get("remainingFraction")
                .and_then(Value::as_f64)
                .or_else(|| bucket.pointer("/remaining/remainingFraction").and_then(Value::as_f64));
            let Some(remaining) = remaining else { continue };
            let reset_at = bucket
                .get("resetTime")
                .and_then(Value::as_str)
                .or_else(|| bucket.pointer("/remaining/resetTime").and_then(Value::as_str))
                .map(str::to_string);
            let prefix = if family == "Gemini" { "gemini" } else { "claude-gpt" };
            upsert_window(
                &mut windows,
                UsageWindow {
                    id: format!("{prefix}-{cadence_id}"),
                    label: format!("{family} · {cadence_label}"),
                    remaining_percent: (remaining * 100.0).clamp(0.0, 100.0),
                    reset_at,
                },
            );
        }
    }

    sort_windows(&mut windows);
    windows
}

fn parse_legacy_model_quotas(document: &Value) -> Vec<UsageWindow> {
    let pointers = [
        "/userStatus/cascadeModelConfigData/clientModelConfigs",
        "/response/userStatus/cascadeModelConfigData/clientModelConfigs",
        "/cascadeModelConfigData/clientModelConfigs",
        "/response/cascadeModelConfigData/clientModelConfigs",
        "/clientModelConfigs",
        "/response/clientModelConfigs",
    ];
    let configs = pointers
        .iter()
        .find_map(|pointer| document.pointer(pointer).and_then(Value::as_array))
        .cloned()
        .unwrap_or_default();

    let mut gemini: Option<(f64, Option<String>)> = None;
    let mut claude_gpt: Option<(f64, Option<String>)> = None;

    for config in configs {
        let label = config
            .get("label")
            .or_else(|| config.get("modelLabel"))
            .or_else(|| config.get("modelId"))
            .or_else(|| config.get("name"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let lower = label.to_lowercase();
        if lower.contains("image") || lower.contains("autocomplete") || lower.contains("lite") {
            continue;
        }
        let remaining = config
            .pointer("/quotaInfo/remainingFraction")
            .and_then(Value::as_f64)
            .or_else(|| config.pointer("/quota/remainingFraction").and_then(Value::as_f64))
            .or_else(|| config.get("remainingFraction").and_then(Value::as_f64));
        let Some(remaining) = remaining else { continue };
        let reset_at = config
            .pointer("/quotaInfo/resetTime")
            .and_then(Value::as_str)
            .or_else(|| config.pointer("/quota/resetTime").and_then(Value::as_str))
            .or_else(|| config.get("resetTime").and_then(Value::as_str))
            .map(str::to_string);
        let value = (remaining * 100.0).clamp(0.0, 100.0);

        let slot = if lower.contains("gemini") {
            &mut gemini
        } else if lower.contains("claude") || lower.contains("gpt") {
            &mut claude_gpt
        } else {
            continue;
        };

        if slot.as_ref().is_none_or(|(current, _)| value < *current) {
            *slot = Some((value, reset_at));
        }
    }

    let mut windows = vec![];
    if let Some((remaining_percent, reset_at)) = gemini {
        windows.push(UsageWindow {
            id: "gemini-session".into(),
            label: "Gemini · 5h".into(),
            remaining_percent,
            reset_at,
        });
    }
    if let Some((remaining_percent, reset_at)) = claude_gpt {
        windows.push(UsageWindow {
            id: "claude-gpt-session".into(),
            label: "Claude + GPT · 5h".into(),
            remaining_percent,
            reset_at,
        });
    }
    sort_windows(&mut windows);
    windows
}

fn upsert_window(windows: &mut Vec<UsageWindow>, item: UsageWindow) {
    if let Some(existing) = windows.iter_mut().find(|window| window.id == item.id) {
        if item.remaining_percent < existing.remaining_percent {
            *existing = item;
        }
    } else {
        windows.push(item);
    }
}

fn sort_windows(windows: &mut [UsageWindow]) {
    windows.sort_by_key(|item| match item.id.as_str() {
        "gemini-session" => 0,
        "gemini-weekly" => 1,
        "claude-gpt-session" => 2,
        "claude-gpt-weekly" => 3,
        _ => 4,
    });
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

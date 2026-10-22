use regex::Regex;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env,
    path::PathBuf,
    process::Command,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use super::providers::{disconnected, ProviderUsage, UsageWindow};
use std::sync::RwLock;

const CREATE_NO_WINDOW: u32 = 0x08000000;
const LS_SERVICE: &str = "exa.language_server_pb.LanguageServerService";

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct AntigravityInstanceInfo {
    pub slot_id: String,
    pub email: Option<String>,
    pub state_root: PathBuf,
}

static DISCOVERED_INSTANCES: RwLock<Vec<AntigravityInstanceInfo>> = RwLock::new(Vec::new());

pub fn detect_profile_slot(root: Option<&PathBuf>) -> (String, String) {
    let Some(r) = root else {
        return ("antigravity".into(), "Principal".into());
    };
    let s = r.to_string_lossy();

    // Look for Conta{N} or Account{N} with optional space or hyphen
    if let Ok(re) = Regex::new(r#"(?i)(?:conta|account)[-_ ]?(\d+)"#) {
        if let Some(cap) = re.captures(&s) {
            if let Some(num_str) = cap.get(1) {
                if let Ok(num) = num_str.as_str().parse::<u32>() {
                    return (format!("antigravity-{}", num), format!("Conta {}", num));
                }
            }
        }
    }

    if let Some(home) = dirs::home_dir() {
        if r.starts_with(&home) {
            return ("antigravity".into(), "Principal".into());
        }
    }

    ("antigravity".into(), "Principal".into())
}


pub fn format_antigravity_name(slot_id: &str, has_multiple: bool) -> String {
    if !has_multiple {
        return "Antigravity".to_string();
    }
    match slot_id {
        "antigravity" => "Antigravity · Conta 1 (Principal)".to_string(),
        other => {
            if let Some(num) = other.strip_prefix("antigravity-") {
                format!("Antigravity · Conta {num}")
            } else {
                format!("Antigravity · {other}")
            }
        }
    }
}

fn slot_numeric_order(id: &str) -> u32 {
    if id == "antigravity" {
        return 1;
    }
    if let Some(num_str) = id.strip_prefix("antigravity-") {
        if let Ok(n) = num_str.parse::<u32>() {
            return n;
        }
    }
    999
}

/// The email Antigravity itself reported for this account earlier in this run.
/// AI Dock never reads the account's credential files to find it.
fn known_email(slot_id: &str) -> Option<String> {
    DISCOVERED_INSTANCES
        .read()
        .ok()?
        .iter()
        .find(|item| item.slot_id == slot_id)
        .and_then(|item| item.email.clone())
}

pub fn get_antigravity_instances() -> Vec<AntigravityInstanceInfo> {
    let mut all_instances = Vec::new();
    let mut seen_slots = std::collections::HashSet::new();

    // 1. Primary instance candidate
    if let Some(home) = dirs::home_dir() {
        let root = home.join(".gemini").join("antigravity");
        if root.is_dir() {
            let email = known_email("antigravity");
            seen_slots.insert("antigravity".to_string());
            all_instances.push(AntigravityInstanceInfo {
                slot_id: "antigravity".into(),
                email,
                state_root: root,
            });
        }
    }

    // 2. Secondary profile candidates 2..=16
    for i in 2..=16 {
        let mut candidates = Vec::new();
        #[cfg(target_os = "windows")]
        {
            candidates.push(PathBuf::from(format!(r"D:\Antigravity-Conta{i}\.gemini\antigravity")));
            candidates.push(PathBuf::from(format!(r"C:\Antigravity-Conta{i}\.gemini\antigravity")));
            candidates.push(PathBuf::from(format!(r"D:\Antigravity-Account{i}\.gemini\antigravity")));
            candidates.push(PathBuf::from(format!(r"C:\Antigravity-Account{i}\.gemini\antigravity")));
            candidates.push(PathBuf::from(format!(r"D:\Antigravity-Conta{i}")));
            candidates.push(PathBuf::from(format!(r"C:\Antigravity-Conta{i}")));
        }
        if let Some(ref home) = dirs::home_dir() {
            candidates.push(home.join(format!("Antigravity-Conta{i}")).join(".gemini").join("antigravity"));
            candidates.push(home.join(format!("Antigravity-Account{i}")).join(".gemini").join("antigravity"));
            candidates.push(home.join(format!(".antigravity-conta{i}")).join(".gemini").join("antigravity"));
            candidates.push(home.join(format!(".antigravity-account{i}")).join(".gemini").join("antigravity"));
            candidates.push(home.join(format!("Antigravity-Conta{i}")));
            candidates.push(home.join(format!("Antigravity-Account{i}")));
        }
        for cand in candidates {
            if cand.is_dir() {
                let actual_root = if cand.join(".gemini").join("antigravity").is_dir() {
                    cand.join(".gemini").join("antigravity")
                } else {
                    cand
                };
                let slot_id = format!("antigravity-{i}");
                if seen_slots.insert(slot_id.clone()) {
                    let email = known_email(&slot_id);
                    all_instances.push(AntigravityInstanceInfo {
                        slot_id,
                        email,
                        state_root: actual_root,
                    });
                }
                break;
            }
        }
    }

    // 3. Merge running instances from DISCOVERED_INSTANCES (e.g. ad-hoc paths)
    if let Ok(cached) = DISCOVERED_INSTANCES.read() {
        for item in cached.iter() {
            if seen_slots.insert(item.slot_id.clone()) {
                all_instances.push(item.clone());
            }
        }
    }

    all_instances.sort_by_key(|inst| slot_numeric_order(&inst.slot_id));
    all_instances
}

#[derive(Default)]
struct Discovery {
    installed: bool,
    app_running: bool,
    servers: Vec<LanguageServer>,
}

type Endpoint = (String, u16, String);

/// The language server that last answered for each account, so activity can ask it without a new discovery.
static ENDPOINTS: Mutex<Option<HashMap<String, Endpoint>>> = Mutex::new(None);
/// Model id to label, with the time it was read. The list changes only when Antigravity updates.
static MODEL_LABELS: Mutex<Option<(Instant, HashMap<String, String>)>> = Mutex::new(None);
const LABELS_MAX_AGE: Duration = Duration::from_secs(10 * 60);

struct LanguageServer {
    ports: Vec<u16>,
    extension_port: Option<u16>,
    csrf_token: String,
    extension_csrf_token: String,
    state_root: Option<PathBuf>,
}

pub(crate) async fn usage() -> Vec<ProviderUsage> {
    let discovery = tauri::async_runtime::spawn_blocking(discover)
        .await
        .unwrap_or_default();

    let mut snapshots: Vec<Snapshot> = Vec::new();
    for server in &discovery.servers {
        if let Some(snapshot) = try_language_server(server).await {
            let is_duplicate = snapshots
                .iter()
                .any(|other| other.root.is_some() && other.root == snapshot.root);
            if !is_duplicate {
                snapshots.push(snapshot);
            }
        }
    }

    let known_instances = get_antigravity_instances();
    let has_multiple_profiles = known_instances.len() > 1 || snapshots.len() > 1;

    let mut active_by_slot: HashMap<String, (ProviderUsage, Option<String>, PathBuf)> = HashMap::new();
    let mut endpoints = HashMap::new();

    for Snapshot { mut usage, email, root, endpoint } in snapshots {
        // Priority 1: Match against known instances by email
        let matched_slot = email.as_ref().and_then(|em| {
            let em_lower = em.to_lowercase();
            known_instances.iter().find(|ki| {
                ki.email.as_deref().map(|e| e.to_lowercase()) == Some(em_lower.clone())
            }).map(|ki| ki.slot_id.clone())
        });

        let slot_id = matched_slot.unwrap_or_else(|| {
            let (detected_id, _) = detect_profile_slot(root.as_ref());
            detected_id
        });

        let effective_email = email.or_else(|| {
            known_instances
                .iter()
                .find(|ki| ki.slot_id == slot_id)
                .and_then(|ki| ki.email.clone())
        });

        usage.id = slot_id.clone();
        usage.email = effective_email.clone();
        usage.name = format_antigravity_name(&slot_id, has_multiple_profiles);
        endpoints.insert(slot_id.clone(), endpoint);

        if let Some(r) = root {
            active_by_slot.insert(slot_id, (usage, effective_email, r));
        }
    }

    remember_endpoints(endpoints);

    if active_by_slot.is_empty() && known_instances.is_empty() {
        if discovery.app_running {
            return vec![disconnected(
                "antigravity",
                "Antigravity",
                "Antigravity foi detectado e está aberto, mas esta sessão não expôs uma quota local legível. Clique em Atualizar depois que a tela principal terminar de carregar.",
            )];
        }

        if discovery.installed {
            return vec![disconnected(
                "antigravity",
                "Antigravity",
                "Antigravity foi encontrado neste PC. Abra o Antigravity, aguarde alguns segundos e clique em Atualizar.",
            )];
        }

        return vec![disconnected(
            "antigravity",
            "Antigravity",
            "Antigravity não foi encontrado em %LOCALAPPDATA%\\Programs\\antigravity\\Antigravity.exe.",
        )];
    }

    let mut usages = Vec::new();
    let mut updated_instances = Vec::new();
    let mut processed_slots = std::collections::HashSet::new();

    // 1. Build usages from known instances on disk
    for info in &known_instances {
        processed_slots.insert(info.slot_id.clone());
        if let Some((active_usage, live_email, live_root)) = active_by_slot.remove(&info.slot_id) {
            updated_instances.push(AntigravityInstanceInfo {
                slot_id: info.slot_id.clone(),
                email: live_email.or_else(|| info.email.clone()),
                state_root: live_root,
            });
            usages.push(active_usage);
        } else {
            // Instance configured on disk but not currently running
            let email = info.email.clone();
            let name = format_antigravity_name(&info.slot_id, has_multiple_profiles);
            updated_instances.push(AntigravityInstanceInfo {
                slot_id: info.slot_id.clone(),
                email: email.clone(),
                state_root: info.state_root.clone(),
            });
            usages.push(ProviderUsage {
                id: info.slot_id.clone(),
                name,
                connected: false,
                plan: None,
                email,
                windows: vec![],
                error: Some("Antigravity fechado".into()),
            });
        }
    }

    // 2. Include any active instances not part of static candidate paths
    for (slot_id, (mut active_usage, live_email, live_root)) in active_by_slot {
        if !processed_slots.contains(&slot_id) {
            active_usage.name = format_antigravity_name(&slot_id, has_multiple_profiles);
            updated_instances.push(AntigravityInstanceInfo {
                slot_id,
                email: live_email,
                state_root: live_root,
            });
            usages.push(active_usage);
        }
    }

    usages.sort_by_key(|u| slot_numeric_order(&u.id));

    if let Ok(mut lock) = DISCOVERED_INSTANCES.write() {
        *lock = updated_instances;
    }

    usages
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

    for process in &processes {
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

        let ppid = process
            .get("ParentProcessId")
            .and_then(Value::as_u64)
            .unwrap_or_default() as u32;

        let mut current_pid = ppid;
        let mut user_data_dir = None;
        for _ in 0..10 {
            if current_pid == 0 {
                break;
            }
            if let Some(p) = processes.iter().find(|pr| pr.get("ProcessId").and_then(Value::as_u64) == Some(current_pid as u64)) {
                if let Some(cmd) = p.get("CommandLine").and_then(Value::as_str) {
                    if let Some(udd) = command_flag(cmd, "user-data-dir") {
                        user_data_dir = Some(udd);
                        break;
                    }
                }
                current_pid = p.get("ParentProcessId").and_then(Value::as_u64).unwrap_or(0) as u32;
            } else {
                break;
            }
        }

        let state_root = user_data_dir
            .and_then(|udd| {
                let path = PathBuf::from(&udd);
                if let Some(parent_dir) = path.parent() {
                    let cand = parent_dir.join(".gemini").join("antigravity");
                    if cand.is_dir() {
                        return Some(cand);
                    }
                    if parent_dir.is_dir() {
                        return Some(parent_dir.to_path_buf());
                    }
                }
                let cand = path.join(".gemini").join("antigravity");
                if cand.is_dir() {
                    return Some(cand);
                }
                Some(path)
            })
            .or_else(|| {
                dirs::home_dir().map(|h| h.join(".gemini").join("antigravity"))
            });

        servers.push(LanguageServer {
            ports,
            extension_port,
            csrf_token,
            extension_csrf_token,
            state_root,
        });
    }

    servers.sort_by_key(|s| {
        let is_default = s.state_root.as_ref().is_some_and(|r| {
            dirs::home_dir().is_some_and(|h| r.starts_with(&h))
        });
        if is_default { 0 } else { 1 }
    });

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

fn metadata_body() -> Value {
    json!({
        "metadata": {
            "ideName": "antigravity",
            "extensionName": "antigravity",
            "ideVersion": "unknown",
            "locale": "en"
        }
    })
}

/// Request bodies for a method, preferred first. The quota summary is cached by
/// the language server and only the group in use goes stale, so it is asked to
/// refresh (as CodexBar does); older servers that reject the field get the plain body.
fn request_bodies(method: &str) -> Vec<Value> {
    if method == "RetrieveUserQuotaSummary" {
        let mut with_metadata = metadata_body();
        with_metadata["forceRefresh"] = json!(true);
        vec![with_metadata, json!({ "forceRefresh": true }), metadata_body()]
    } else {
        vec![metadata_body()]
    }
}

async fn ls_call(scheme: &str, port: u16, csrf: &str, method: &str) -> Option<Value> {
    let url = format!("{scheme}://127.0.0.1:{port}/{LS_SERVICE}/{method}");
    for body in request_bodies(method) {
        let mut request = local_client()
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Connect-Protocol-Version", "1")
            .json(&body);
        if !csrf.is_empty() {
            request = request.header("X-Codeium-Csrf-Token", csrf);
        }
        // A connection error means the port is wrong: no other body will help.
        let response = request.send().await.ok()?;
        if response.status().is_success() {
            return response.json::<Value>().await.ok();
        }
    }
    None
}

/// `remainingFraction` comes plain, nested under `remaining`, or as a protobuf
/// oneof `{ "case": "remainingFraction", "value": 0.6 }`.
fn remaining_fraction(bucket: &Value) -> Option<f64> {
    if let Some(value) = bucket.get("remainingFraction").and_then(Value::as_f64) {
        return Some(value);
    }
    let remaining = bucket.get("remaining")?;
    if let Some(value) = remaining.get("remainingFraction").and_then(Value::as_f64) {
        return Some(value);
    }
    let case = remaining.get("case").and_then(Value::as_str).unwrap_or_default();
    if case.eq_ignore_ascii_case("remainingFraction") {
        return remaining.get("value").and_then(Value::as_f64);
    }
    None
}

struct Snapshot {
    usage: ProviderUsage,
    email: Option<String>,
    root: Option<PathBuf>,
    endpoint: Endpoint,
}

async fn try_language_server(server: &LanguageServer) -> Option<Snapshot> {
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
                let user_status = ls_call(scheme, port, token, "GetUserStatus").await;
                let plan = user_status.as_ref().and_then(|doc| extract_plan(doc));
                let email = user_status.as_ref().and_then(|doc| extract_email(doc));
                return Some(Snapshot {
                    usage: connected(plan, email.clone(), windows),
                    email,
                    root: server.state_root.clone(),
                    endpoint: (scheme.to_string(), port, token.to_string()),
                });
            }
        }

        for method in ["GetUserStatus", "GetCommandModelConfigs", "GetCascadeModelConfigData"] {
            if let Some(document) = ls_call(scheme, port, token, method).await {
                let windows = parse_legacy_model_quotas(&document);
                if !windows.is_empty() {
                    let plan = extract_plan(&document);
                    let email = extract_email(&document);
                    return Some(Snapshot {
                        usage: connected(plan, email.clone(), windows),
                        email,
                        root: server.state_root.clone(),
                        endpoint: (scheme.to_string(), port, token.to_string()),
                    });
                }
            }
        }
    }

    None
}

fn remember_endpoints(endpoints: HashMap<String, Endpoint>) {
    if let Ok(mut guard) = ENDPOINTS.lock() {
        *guard = Some(endpoints);
    }
}

/// Quota pools ("gemini", "claude-gpt", "argon") of the other conversations this
/// account's language server reports as running and recently changed. `active` is the
/// conversation the caller already named from its own files. None when the server
/// cannot be asked or names no other model.
pub(crate) async fn running_pools(slot_id: &str, active: Option<&str>) -> Option<Vec<&'static str>> {
    let (scheme, port, csrf) = ENDPOINTS.lock().ok()?.as_ref()?.get(slot_id)?.clone();
    let Some(trajectories) = ls_call(&scheme, port, &csrf, "GetAllCascadeTrajectories").await else {
        // A restarted Antigravity listens on a new port; the next quota refresh finds it.
        if let Ok(mut guard) = ENDPOINTS.lock() {
            if let Some(endpoints) = guard.as_mut() {
                endpoints.remove(slot_id);
            }
        }
        return None;
    };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs() as i64;
    let running = running_models(&trajectories, active, now);
    debug_log(slot_id, active, &trajectories);
    if running.is_empty() {
        return None;
    }

    // The selected model is only needed for a conversation without a finished step.
    let cached = if running.iter().all(Option::is_some) {
        cached_labels(&running)
    } else {
        None
    };
    let (labels, selected) = match cached {
        Some(labels) => (labels, None),
        None => {
            let status = ls_call(&scheme, port, &csrf, "GetUserStatus").await?;
            let labels = model_labels(&status);
            if let Ok(mut guard) = MODEL_LABELS.lock() {
                *guard = Some((Instant::now(), labels.clone()));
            }
            (labels, selected_model(&status))
        }
    };

    let mut pools = vec![];
    for model in running {
        // A conversation's first turn has no finished step yet: it runs on the model picked in the UI.
        let Some(model) = model.or_else(|| selected.clone()) else { continue };
        if let Some(pool) = pool_for_model(&model, &labels) {
            if !pools.contains(&pool) {
                pools.push(pool);
            }
        }
    }
    (!pools.is_empty()).then_some(pools)
}

/// Development builds write what the language server reported, without credentials,
/// so a wrong pool can be traced. Release builds write nothing.
fn debug_log(slot_id: &str, active: Option<&str>, trajectories: &Value) {
    if !cfg!(debug_assertions) {
        return;
    }
    let Some(folder) = dirs::data_local_dir().map(|dir| dir.join("AI Dock")) else { return };
    let mut lines = vec![format!("slot={slot_id} active={active:?}")];
    if let Some(summaries) = trajectories.get("trajectorySummaries").and_then(Value::as_object) {
        for (id, summary) in summaries {
            let model = |key: &str| {
                summary
                    .pointer(&format!("/{key}/step/metadata/requestedModel/model"))
                    .or_else(|| summary.pointer(&format!("/{key}/step/metadata/generatorModel")))
                    .and_then(Value::as_str)
                    .unwrap_or("-")
                    .to_string()
            };
            lines.push(format!(
                "{id} status={} modified={} notify={} task={}",
                summary.get("status").and_then(Value::as_str).unwrap_or("-"),
                summary.get("lastModifiedTime").and_then(Value::as_str).unwrap_or("-"),
                model("latestNotifyUserStep"),
                model("latestTaskBoundaryStep"),
            ));
        }
    }
    if let Ok(guard) = MODEL_LABELS.lock() {
        if let Some((_, labels)) = guard.as_ref() {
            let mut known: Vec<_> = labels.iter().map(|(id, label)| format!("{id}={label}")).collect();
            known.sort();
            lines.push(format!("labels: {}", known.join(", ")));
        }
    }
    let _ = std::fs::create_dir_all(&folder);
    let _ = std::fs::write(folder.join(format!("antigravity-{slot_id}.log")), lines.join("\n") + "\n");
}

fn cached_labels(models: &[Option<String>]) -> Option<HashMap<String, String>> {
    let guard = MODEL_LABELS.lock().ok()?;
    let (read_at, labels) = guard.as_ref()?;
    let known = models.iter().flatten().all(|model| labels.contains_key(model));
    (read_at.elapsed() < LABELS_MAX_AGE && known).then(|| labels.clone())
}

/// A conversation still marked running but untouched for this long is stuck (for
/// example, after its quota ran out) and is not working now.
const RUNNING_MAX_IDLE_SECS: i64 = 120;

/// Model of each running conversation other than `active`, from its latest finished
/// step. None for a conversation that has no such step yet.
fn running_models(document: &Value, active: Option<&str>, now: i64) -> Vec<Option<String>> {
    let Some(summaries) = document.get("trajectorySummaries").and_then(Value::as_object) else {
        return vec![];
    };
    summaries
        .iter()
        .filter(|(id, _)| Some(id.as_str()) != active)
        .map(|(_, summary)| summary)
        .filter(|summary| summary.get("status").and_then(Value::as_str) == Some("CASCADE_RUN_STATUS_RUNNING"))
        .filter(|summary| {
            summary
                .get("lastModifiedTime")
                .and_then(Value::as_str)
                .and_then(super::costs::parse_epoch)
                .map_or(true, |modified| now - modified <= RUNNING_MAX_IDLE_SECS)
        })
        .map(|summary| {
            ["latestNotifyUserStep", "latestTaskBoundaryStep"].iter().find_map(|key| {
                let metadata = summary.get(*key)?.pointer("/step/metadata")?;
                metadata
                    .pointer("/requestedModel/model")
                    .or_else(|| metadata.get("generatorModel"))
                    .and_then(Value::as_str)
                    .filter(|model| !model.is_empty())
                    .map(str::to_string)
            })
        })
        .collect()
}

fn model_configs(document: &Value) -> Option<&Value> {
    ["/userStatus/cascadeModelConfigData", "/response/userStatus/cascadeModelConfigData", "/cascadeModelConfigData"]
        .iter()
        .find_map(|pointer| document.pointer(pointer))
}

/// Model ids are placeholders such as `MODEL_PLACEHOLDER_M26` that Antigravity renumbers,
/// so the server's own list turns them into labels.
fn model_labels(document: &Value) -> HashMap<String, String> {
    model_configs(document)
        .and_then(|data| data.get("clientModelConfigs"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|config| {
            let model = config.pointer("/modelOrAlias/model").and_then(Value::as_str)?;
            let label = config.get("label").and_then(Value::as_str)?;
            Some((model.to_string(), label.to_string()))
        })
        .collect()
}

fn selected_model(document: &Value) -> Option<String> {
    model_configs(document)?
        .pointer("/defaultOverrideModelConfig/modelOrAlias/model")
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// Pool of a model id seen in a conversation file, named through the labels the
/// language server reported last. None while those labels are unknown.
pub(crate) fn pool_for_known_model(model: &str) -> Option<&'static str> {
    let guard = MODEL_LABELS.lock().ok()?;
    let (_, labels) = guard.as_ref()?;
    pool_for_model(model, labels)
}

fn pool_for_model(model: &str, labels: &HashMap<String, String>) -> Option<&'static str> {
    let name = labels.get(model).map(String::as_str).unwrap_or(model).to_lowercase();
    if name.contains("argon") {
        Some("argon")
    } else if name.contains("gemini") {
        Some("gemini")
    } else if name.contains("claude") || name.contains("gpt") {
        Some("claude-gpt")
    } else {
        None
    }
}

fn connected(plan: Option<String>, email: Option<String>, windows: Vec<UsageWindow>) -> ProviderUsage {
    ProviderUsage {
        id: "antigravity".into(),
        name: "Antigravity".into(),
        connected: true,
        plan,
        email,
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
        let family = if group_name.contains("argon") {
            "Argon"
        } else if group_name.contains("gemini") {
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

            let Some(remaining) = remaining_fraction(&bucket) else { continue };
            let reset_at = bucket
                .get("resetTime")
                .and_then(Value::as_str)
                .or_else(|| bucket.pointer("/remaining/resetTime").and_then(Value::as_str))
                .map(str::to_string);
            let prefix = if family == "Argon" {
                "argon"
            } else if family == "Gemini" {
                "gemini"
            } else {
                "claude-gpt"
            };
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
    let mut argon: Option<(f64, Option<String>)> = None;

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

        let slot = if lower.contains("argon") {
            &mut argon
        } else if lower.contains("gemini") {
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
    if let Some((remaining_percent, reset_at)) = argon {
        windows.push(UsageWindow {
            id: "argon-session".into(),
            label: "Argon · 5h".into(),
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
        "argon-session" => 4,
        "argon-weekly" => 5,
        _ => 6,
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

fn extract_email(document: &Value) -> Option<String> {
    document
        .pointer("/userStatus/email")
        .or_else(|| document.pointer("/response/userStatus/email"))
        .or_else(|| document.pointer("/userStatus/name"))
        .or_else(|| document.pointer("/response/userStatus/name"))
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn trajectory(status: &str, model: Option<&str>) -> Value {
        let mut summary = json!({ "status": status, "stepCount": 4 });
        if let Some(model) = model {
            summary["latestTaskBoundaryStep"] =
                json!({ "step": { "metadata": { "requestedModel": { "model": model } } } });
        }
        summary
    }

    #[test]
    fn only_running_conversations_name_a_model() {
        let document = json!({
            "trajectorySummaries": {
                "a": trajectory("CASCADE_RUN_STATUS_RUNNING", Some("MODEL_PLACEHOLDER_M26")),
                "b": trajectory("CASCADE_RUN_STATUS_IDLE", Some("MODEL_PLACEHOLDER_M16")),
                "c": trajectory("CASCADE_RUN_STATUS_RUNNING", None)
            }
        });
        let mut models = running_models(&document, None, 0);
        models.sort();
        assert_eq!(models, vec![None, Some("MODEL_PLACEHOLDER_M26".to_string())]);
        assert!(running_models(&json!({}), None, 0).is_empty());
    }

    #[test]
    fn stuck_and_active_conversations_are_left_out() {
        let mut stuck = trajectory("CASCADE_RUN_STATUS_RUNNING", Some("MODEL_PLACEHOLDER_M417"));
        stuck["lastModifiedTime"] = json!("2026-10-22T10:00:00Z");
        let mut fresh = trajectory("CASCADE_RUN_STATUS_RUNNING", Some("MODEL_PLACEHOLDER_M26"));
        fresh["lastModifiedTime"] = json!("2026-10-22T11:59:30.250Z");
        let active = trajectory("CASCADE_RUN_STATUS_RUNNING", Some("MODEL_PLACEHOLDER_M16"));
        let document = json!({ "trajectorySummaries": { "stuck": stuck, "fresh": fresh, "active": active } });
        let noon = super::super::costs::parse_epoch("2026-10-22T12:00:00Z").unwrap();
        assert_eq!(
            running_models(&document, Some("active"), noon),
            vec![Some("MODEL_PLACEHOLDER_M26".to_string())]
        );
    }

    #[test]
    fn the_notify_step_and_generator_model_also_name_the_model() {
        let document = json!({
            "trajectorySummaries": {
                "a": {
                    "status": "CASCADE_RUN_STATUS_RUNNING",
                    "latestNotifyUserStep": { "step": { "metadata": { "generatorModel": "MODEL_PLACEHOLDER_M71" } } },
                    "latestTaskBoundaryStep": { "step": { "metadata": { "requestedModel": { "model": "MODEL_PLACEHOLDER_M16" } } } }
                }
            }
        });
        assert_eq!(running_models(&document, None, 0), vec![Some("MODEL_PLACEHOLDER_M71".to_string())]);
    }

    #[test]
    fn placeholder_ids_map_to_pools_through_the_server_labels() {
        let status = json!({
            "userStatus": {
                "cascadeModelConfigData": {
                    "clientModelConfigs": [
                        { "label": "Gemini 3.1 Pro (High)", "modelOrAlias": { "model": "MODEL_PLACEHOLDER_M16" } },
                        { "label": "Claude Sonnet 4.6 (Thinking)", "modelOrAlias": { "model": "MODEL_PLACEHOLDER_M35" } },
                        { "label": "GPT-OSS 120B (Medium)", "modelOrAlias": { "model": "MODEL_PLACEHOLDER_M40" } }
                    ],
                    "defaultOverrideModelConfig": { "modelOrAlias": { "model": "MODEL_PLACEHOLDER_M35" } }
                }
            }
        });
        let labels = model_labels(&status);
        assert_eq!(pool_for_model("MODEL_PLACEHOLDER_M16", &labels), Some("gemini"));
        assert_eq!(pool_for_model("MODEL_PLACEHOLDER_M35", &labels), Some("claude-gpt"));
        assert_eq!(pool_for_model("MODEL_PLACEHOLDER_M40", &labels), Some("claude-gpt"));
        assert_eq!(pool_for_model("MODEL_PLACEHOLDER_M99", &labels), None);
        assert_eq!(pool_for_model("gemini-3.6-flash", &labels), Some("gemini"));
        assert_eq!(pool_for_model("argon-high", &labels), Some("argon"));
        assert_eq!(selected_model(&status).as_deref(), Some("MODEL_PLACEHOLDER_M35"));
    }

    fn by_id<'a>(windows: &'a [UsageWindow], id: &str) -> &'a UsageWindow {
        windows
            .iter()
            .find(|window| window.id == id)
            .unwrap_or_else(|| panic!("missing usage window {id}"))
    }

    fn assert_percent(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn parses_grouped_session_and_weekly_windows() {
        let document = json!({
            "groups": [
                {
                    "displayName": "Gemini",
                    "buckets": [
                        {
                            "bucketId": "session",
                            "displayName": "5-hour",
                            "remainingFraction": 0.75,
                            "resetTime": "2026-09-23T12:00:00Z"
                        },
                        {
                            "bucketId": "weekly",
                            "displayName": "week",
                            "remaining": {
                                "remainingFraction": 0.40,
                                "resetTime": "2026-09-29T12:00:00Z"
                            }
                        },
                        {
                            "bucketId": "disabled-weekly",
                            "displayName": "week",
                            "remainingFraction": 0.05,
                            "disabled": true
                        }
                    ]
                },
                {
                    "displayName": "Claude + GPT",
                    "buckets": [
                        {
                            "bucketId": "session",
                            "displayName": "session",
                            "remainingFraction": 0.55
                        },
                        {
                            "bucketId": "weekly",
                            "displayName": "weekly",
                            "remainingFraction": 0.20
                        }
                    ]
                },
                {
                    "displayName": "Gemini 4 Argon",
                    "buckets": [
                        {
                            "bucketId": "gemini-argon-wtu-weekly",
                            "displayName": "Gemini 4 Argon Weekly Limit",
                            "remainingFraction": 0.85,
                            "resetTime": "2026-10-24T04:19:12Z"
                        }
                    ]
                }
            ]
        });

        let windows = parse_quota_summary(&document);

        assert_eq!(
            windows.iter().map(|window| window.id.as_str()).collect::<Vec<_>>(),
            vec![
                "gemini-session",
                "gemini-weekly",
                "claude-gpt-session",
                "claude-gpt-weekly",
                "argon-weekly"
            ]
        );
        assert_percent(by_id(&windows, "gemini-session").remaining_percent, 75.0);
        assert_percent(by_id(&windows, "gemini-weekly").remaining_percent, 40.0);
        assert_eq!(
            by_id(&windows, "gemini-weekly").reset_at.as_deref(),
            Some("2026-09-29T12:00:00Z")
        );
        assert_percent(by_id(&windows, "claude-gpt-session").remaining_percent, 55.0);
        assert_percent(by_id(&windows, "claude-gpt-weekly").remaining_percent, 20.0);
        assert_percent(by_id(&windows, "argon-weekly").remaining_percent, 85.0);
        assert_eq!(
            by_id(&windows, "argon-weekly").reset_at.as_deref(),
            Some("2026-10-24T04:19:12Z")
        );
    }

    #[test]
    fn grouped_duplicate_window_keeps_the_most_conservative_remaining_value() {
        let document = json!({
            "groups": [{
                "displayName": "Gemini",
                "buckets": [
                    {
                        "bucketId": "session-a",
                        "displayName": "session",
                        "remainingFraction": 0.80
                    },
                    {
                        "bucketId": "session-b",
                        "displayName": "5-hour",
                        "remainingFraction": 0.35,
                        "resetTime": "2026-09-23T13:00:00Z"
                    }
                ]
            }]
        });

        let windows = parse_quota_summary(&document);

        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].id, "gemini-session");
        assert_percent(windows[0].remaining_percent, 35.0);
        assert_eq!(
            windows[0].reset_at.as_deref(),
            Some("2026-09-23T13:00:00Z")
        );
    }

    #[test]
    fn legacy_model_quotas_ignore_non_chat_models_and_keep_lowest_family_value() {
        let document = json!({
            "clientModelConfigs": [
                {
                    "label": "Gemini 2.5 Pro",
                    "quotaInfo": {"remainingFraction": 0.90}
                },
                {
                    "label": "Gemini 2.5 Flash",
                    "quotaInfo": {
                        "remainingFraction": 0.40,
                        "resetTime": "2026-09-23T14:00:00Z"
                    }
                },
                {
                    "label": "Gemini Image",
                    "quotaInfo": {"remainingFraction": 0.05}
                },
                {
                    "label": "Claude Sonnet",
                    "quotaInfo": {"remainingFraction": 0.60}
                },
                {
                    "label": "GPT",
                    "quotaInfo": {"remainingFraction": 0.30}
                }
            ]
        });

        let windows = parse_legacy_model_quotas(&document);

        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].id, "gemini-session");
        assert_percent(windows[0].remaining_percent, 40.0);
        assert_eq!(windows[1].id, "claude-gpt-session");
        assert_percent(windows[1].remaining_percent, 30.0);
    }

    #[test]
    fn quota_summary_request_asks_for_a_fresh_reading_first() {
        let bodies = request_bodies("RetrieveUserQuotaSummary");
        assert_eq!(bodies[0]["forceRefresh"], json!(true));
        assert_eq!(bodies[0]["metadata"]["ideName"], json!("antigravity"));
        assert_eq!(bodies[1], json!({ "forceRefresh": true }));
        assert!(bodies[2].get("forceRefresh").is_none());

        let status = request_bodies("GetUserStatus");
        assert_eq!(status.len(), 1);
        assert!(status[0].get("forceRefresh").is_none());
    }

    #[test]
    fn reads_remaining_fraction_in_every_shape() {
        assert_eq!(remaining_fraction(&json!({ "remainingFraction": 0.63 })), Some(0.63));
        assert_eq!(remaining_fraction(&json!({ "remaining": { "remainingFraction": 0.34 } })), Some(0.34));
        assert_eq!(
            remaining_fraction(&json!({ "remaining": { "case": "remainingFraction", "value": 0.5 } })),
            Some(0.5)
        );
        assert_eq!(remaining_fraction(&json!({ "remaining": { "case": "other", "value": 0.5 } })), None);
        assert_eq!(remaining_fraction(&json!({ "resetTime": "2026-09-27T00:00:00Z" })), None);
    }

    #[test]
    fn parses_group_and_bucket_names_documented_by_codexbar() {
        let document = json!({
            "groups": [
                {
                    "displayName": "Gemini Models",
                    "buckets": [
                        { "bucketId": "gemini-weekly", "displayName": "Weekly Limit", "remaining": { "remainingFraction": 0.53 } },
                        { "bucketId": "gemini-5h", "displayName": "Five Hour Limit", "remaining": { "remainingFraction": 0.0 } }
                    ]
                },
                {
                    "displayName": "Claude and GPT models",
                    "buckets": [
                        { "bucketId": "3p-weekly", "displayName": "Weekly Limit", "remaining": { "remainingFraction": 0.34 } },
                        { "bucketId": "3p-5h", "displayName": "Five Hour Limit", "remaining": { "remainingFraction": 0.63 } }
                    ]
                }
            ]
        });

        let windows = parse_quota_summary(&document);
        assert_percent(by_id(&windows, "gemini-weekly").remaining_percent, 53.0);
        assert_percent(by_id(&windows, "gemini-session").remaining_percent, 0.0);
        assert_percent(by_id(&windows, "claude-gpt-weekly").remaining_percent, 34.0);
        assert_percent(by_id(&windows, "claude-gpt-session").remaining_percent, 63.0);
    }

    #[test]
    fn detect_profile_slot_maps_roots_deterministically() {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from(r"C:\Users\Example"));
        let p_home = home.join(".gemini").join("antigravity");
        assert_eq!(detect_profile_slot(Some(&p_home)), ("antigravity".into(), "Principal".into()));

        let c2 = PathBuf::from(r"D:\Antigravity-Conta2\.gemini\antigravity");
        assert_eq!(detect_profile_slot(Some(&c2)), ("antigravity-2".into(), "Conta 2".into()));

        let c3 = PathBuf::from(r"D:\Antigravity-Conta3\.gemini\antigravity");
        assert_eq!(detect_profile_slot(Some(&c3)), ("antigravity-3".into(), "Conta 3".into()));

        let c4 = PathBuf::from(r"D:\Antigravity-Conta4\.gemini\antigravity");
        assert_eq!(detect_profile_slot(Some(&c4)), ("antigravity-4".into(), "Conta 4".into()));

        let acc4 = PathBuf::from(r"C:\Antigravity-Account4");
        assert_eq!(detect_profile_slot(Some(&acc4)), ("antigravity-4".into(), "Conta 4".into()));
    }

    #[test]
    fn format_antigravity_name_produces_consistent_labels() {
        assert_eq!(format_antigravity_name("antigravity", false), "Antigravity");
        assert_eq!(format_antigravity_name("antigravity", true), "Antigravity · Conta 1 (Principal)");
        assert_eq!(format_antigravity_name("antigravity-2", true), "Antigravity · Conta 2");
        assert_eq!(format_antigravity_name("antigravity-3", true), "Antigravity · Conta 3");
        assert_eq!(format_antigravity_name("antigravity-4", true), "Antigravity · Conta 4");
    }

    #[test]
    fn slot_numeric_order_sorts_correctly() {
        let mut slots = vec!["antigravity-4", "antigravity", "antigravity-3", "antigravity-2"];
        slots.sort_by_key(|s| slot_numeric_order(s));
        assert_eq!(slots, vec!["antigravity", "antigravity-2", "antigravity-3", "antigravity-4"]);
    }
}

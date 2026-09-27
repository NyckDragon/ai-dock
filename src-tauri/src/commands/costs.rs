//! Local token and cost estimates, in the spirit of ccusage.
//!
//! Reads only the session logs Claude Code and Codex already write on this PC:
//! - Claude Code: `~/.claude/projects/**/*.jsonl` (and `CLAUDE_CONFIG_DIR`)
//! - Codex: `~/.codex/sessions/**/rollout-*.jsonl` (and `CODEX_HOME`)
//!
//! Costs use LiteLLM's public price table, downloaded at most once a day and
//! kept in AppData. They are API-equivalent estimates: subscriptions are not
//! billed per token. Nothing here leaves the PC except the price-table download.

use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const PRICES_URL: &str = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const PRICES_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_DAYS: u32 = 31;
const DAY_SECS: i64 = 86_400;

#[derive(Clone, Debug, Default, PartialEq)]
struct Tokens {
    input: u64,
    output: u64,
    cache_write: u64,
    cache_read: u64,
}

/// One usage record from a log line.
#[derive(Clone, Debug)]
struct Record {
    epoch: i64,
    provider: &'static str,
    model: String,
    project: String,
    tokens: Tokens,
    /// Claude message id + request id; the same reply can show up in two files after a resume.
    dedupe: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CostEntry {
    /// Local calendar day, YYYY-MM-DD.
    date: String,
    provider: String,
    model: String,
    project: String,
    input_tokens: u64,
    output_tokens: u64,
    cache_write_tokens: u64,
    cache_read_tokens: u64,
    /// `None` when the model is not in the price table.
    cost_usd: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostReport {
    entries: Vec<CostEntry>,
    /// "online", "cached" or "none".
    prices: &'static str,
    files: usize,
}

// Dates ----------------------------------------------------------------------

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + if month <= 2 { 1 } else { 0 }, month, day)
}

/// Seconds since the epoch for an RFC 3339 timestamp ("2026-09-26T14:03:11.123Z" or "+03:00").
fn parse_epoch(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let num = |range: std::ops::Range<usize>| text.get(range)?.parse::<i64>().ok();
    let days = days_from_civil(num(0..4)?, num(5..7)?, num(8..10)?);
    let mut epoch = days * DAY_SECS + num(11..13)? * 3600 + num(14..16)? * 60 + num(17..19)?;
    let rest = &text[19..];
    let zone = rest.trim_start_matches(|c: char| c == '.' || c.is_ascii_digit());
    if let Some(sign) = zone.chars().next().filter(|c| *c == '+' || *c == '-') {
        let hours = zone.get(1..3)?.parse::<i64>().ok()?;
        let minutes = zone.get(4..6).and_then(|m| m.parse::<i64>().ok()).unwrap_or(0);
        let offset = hours * 3600 + minutes * 60;
        epoch += if sign == '+' { -offset } else { offset };
    }
    Some(epoch)
}

/// Local calendar day for an epoch, given the offset JavaScript reports
/// (`getTimezoneOffset`: minutes to add to local time to get UTC).
fn local_date(epoch: i64, tz_offset_minutes: i32) -> String {
    let local = epoch - i64::from(tz_offset_minutes) * 60;
    let (year, month, day) = civil_from_days(local.div_euclid(DAY_SECS));
    format!("{year:04}-{month:02}-{day:02}")
}

fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// Log parsing ----------------------------------------------------------------

fn u64_at(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn project_name(cwd: Option<&str>) -> String {
    cwd.map(|path| path.trim_end_matches(['/', '\\']))
        .and_then(|path| path.rsplit(['/', '\\']).next())
        .filter(|name| !name.is_empty())
        .unwrap_or("(sem projeto)")
        .to_string()
}

/// One Claude Code JSONL line: assistant messages carry `message.usage`.
fn parse_claude_line(line: &str) -> Option<Record> {
    if !line.contains("\"usage\"") {
        return None;
    }
    let value: Value = serde_json::from_str(line).ok()?;
    let message = value.get("message")?;
    let usage = message.get("usage")?;
    let tokens = Tokens {
        input: u64_at(usage, "input_tokens"),
        output: u64_at(usage, "output_tokens"),
        cache_write: u64_at(usage, "cache_creation_input_tokens"),
        cache_read: u64_at(usage, "cache_read_input_tokens"),
    };
    if tokens == Tokens::default() {
        return None;
    }
    let model = message.get("model").and_then(Value::as_str).unwrap_or("desconhecido");
    if model == "<synthetic>" {
        return None;
    }
    let dedupe = match (
        message.get("id").and_then(Value::as_str),
        value.get("requestId").and_then(Value::as_str),
    ) {
        (Some(id), Some(request)) => Some(format!("{id}:{request}")),
        (Some(id), None) => Some(id.to_string()),
        _ => None,
    };
    Some(Record {
        epoch: parse_epoch(value.get("timestamp")?.as_str()?)?,
        provider: "claude",
        model: model.to_string(),
        project: project_name(value.get("cwd").and_then(Value::as_str)),
        tokens,
        dedupe,
    })
}

/// Codex rollout files: `turn_context` sets the model and folder, and each
/// `token_count` event carries the usage of the last response.
fn parse_codex_file(path: &Path) -> Vec<Record> {
    let Ok(file) = File::open(path) else { return vec![] };
    let mut records = Vec::new();
    let mut model = String::from("desconhecido");
    let mut project = String::from("(sem projeto)");
    let mut last_total: Option<Value> = None;

    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if !(line.contains("token_count") || line.contains("turn_context") || line.contains("session_meta")) {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
        let payload = value.get("payload").unwrap_or(&Value::Null);
        match value.get("type").and_then(Value::as_str) {
            Some("turn_context") | Some("session_meta") => {
                if let Some(name) = payload.get("model").and_then(Value::as_str) {
                    model = name.to_string();
                }
                if let Some(cwd) = payload.get("cwd").and_then(Value::as_str) {
                    project = project_name(Some(cwd));
                }
            }
            Some("event_msg") if payload.get("type").and_then(Value::as_str) == Some("token_count") => {
                let Some(info) = payload.get("info").filter(|info| !info.is_null()) else { continue };
                // Rate-limit updates repeat the same totals; only a new total is a new response.
                let total = info.get("total_token_usage").cloned();
                if total.is_some() && total == last_total {
                    continue;
                }
                last_total = total;
                let Some(last) = info.get("last_token_usage") else { continue };
                let input = u64_at(last, "input_tokens");
                let cached = u64_at(last, "cached_input_tokens").min(input);
                let tokens = Tokens {
                    input: input - cached,
                    output: u64_at(last, "output_tokens"),
                    cache_write: 0,
                    cache_read: cached,
                };
                if tokens == Tokens::default() {
                    continue;
                }
                let Some(epoch) = value.get("timestamp").and_then(Value::as_str).and_then(parse_epoch) else {
                    continue;
                };
                records.push(Record {
                    epoch,
                    provider: "codex",
                    model: model.clone(),
                    project: project.clone(),
                    tokens,
                    dedupe: None,
                });
            }
            _ => {}
        }
    }
    records
}

fn parse_claude_file(path: &Path) -> Vec<Record> {
    let Ok(file) = File::open(path) else { return vec![] };
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| parse_claude_line(&line))
        .collect()
}

fn claude_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        roots.push(PathBuf::from(dir).join("projects"));
    }
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".claude").join("projects"));
        roots.push(home.join(".config").join("claude").join("projects"));
    }
    roots
}

fn codex_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(dir) = std::env::var_os("CODEX_HOME") {
        roots.push(PathBuf::from(dir).join("sessions"));
    }
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".codex").join("sessions"));
    }
    roots
}

type FileCache = HashMap<PathBuf, (SystemTime, u64, Vec<Record>)>;

fn file_cache() -> &'static Mutex<FileCache> {
    static CACHE: OnceLock<Mutex<FileCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Records from every recent log file; unchanged files come from memory.
fn scan(since_epoch: i64) -> (Vec<Record>, usize) {
    let since = UNIX_EPOCH + Duration::from_secs(since_epoch.max(0) as u64);
    let mut seen = HashSet::new();
    let mut records = Vec::new();
    let Ok(mut cache) = file_cache().lock() else { return (records, 0) };

    let sources: [(Vec<PathBuf>, fn(&Path) -> Vec<Record>, &str); 2] = [
        (claude_roots(), parse_claude_file, "jsonl"),
        (codex_roots(), parse_codex_file, "jsonl"),
    ];
    for (roots, parse, extension) in sources {
        for root in roots.iter().filter(|root| root.is_dir()) {
            for entry in WalkDir::new(root).follow_links(false).into_iter().filter_map(Result::ok) {
                let path = entry.path();
                if !entry.file_type().is_file() || path.extension().and_then(|e| e.to_str()) != Some(extension) {
                    continue;
                }
                let Ok(meta) = entry.metadata() else { continue };
                let Ok(modified) = meta.modified() else { continue };
                if modified < since || !seen.insert(path.to_path_buf()) {
                    continue;
                }
                let fresh = cache
                    .get(path)
                    .is_some_and(|(time, size, _)| *time == modified && *size == meta.len());
                if !fresh {
                    cache.insert(path.to_path_buf(), (modified, meta.len(), parse(path)));
                }
                if let Some((_, _, cached)) = cache.get(path) {
                    records.extend(cached.iter().filter(|record| record.epoch >= since_epoch).cloned());
                }
            }
        }
    }
    cache.retain(|path, _| seen.contains(path));
    (records, seen.len())
}

// Prices ---------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq)]
struct Price {
    input: f64,
    output: f64,
    cache_write: f64,
    cache_read: f64,
}

fn parse_prices(document: &Value) -> HashMap<String, Price> {
    let Some(map) = document.as_object() else { return HashMap::new() };
    map.iter()
        .filter_map(|(name, entry)| {
            let input = entry.get("input_cost_per_token")?.as_f64()?;
            let output = entry.get("output_cost_per_token")?.as_f64()?;
            let cache_write = entry
                .get("cache_creation_input_token_cost")
                .and_then(Value::as_f64)
                .unwrap_or(input);
            let cache_read = entry
                .get("cache_read_input_token_cost")
                .and_then(Value::as_f64)
                .unwrap_or(input);
            Some((name.to_ascii_lowercase(), Price { input, output, cache_write, cache_read }))
        })
        .collect()
}

fn prices_file() -> Option<PathBuf> {
    dirs::data_local_dir().map(|dir| dir.join("AI Dock").join("model-prices.json"))
}

fn price_memory() -> &'static Mutex<Option<(SystemTime, HashMap<String, Price>, &'static str)>> {
    static PRICES: OnceLock<Mutex<Option<(SystemTime, HashMap<String, Price>, &'static str)>>> = OnceLock::new();
    PRICES.get_or_init(|| Mutex::new(None))
}

async fn load_prices() -> (HashMap<String, Price>, &'static str) {
    if let Ok(guard) = price_memory().lock() {
        if let Some((loaded, prices, source)) = guard.as_ref() {
            if loaded.elapsed().unwrap_or(PRICES_MAX_AGE) < PRICES_MAX_AGE {
                return (prices.clone(), source);
            }
        }
    }

    let path = prices_file();
    let cached_age = path
        .as_ref()
        .and_then(|p| fs::metadata(p).ok())
        .and_then(|m| m.modified().ok())
        .and_then(|m| m.elapsed().ok());

    let mut result: Option<(HashMap<String, Price>, &'static str)> = None;
    if cached_age.map_or(true, |age| age >= PRICES_MAX_AGE) {
        let downloaded = async {
            let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build().ok()?;
            let text = client.get(PRICES_URL).send().await.ok()?.error_for_status().ok()?.text().await.ok()?;
            let document: Value = serde_json::from_str(&text).ok()?;
            let prices = parse_prices(&document);
            (!prices.is_empty()).then_some((prices, text))
        }
        .await;
        if let Some((prices, text)) = downloaded {
            if let Some(path) = &path {
                if let Some(parent) = path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::write(path, text);
            }
            result = Some((prices, "online"));
        }
    }
    let (prices, source) = result.unwrap_or_else(|| {
        let from_disk = path
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .map(|document| parse_prices(&document))
            .filter(|prices| !prices.is_empty());
        match from_disk {
            Some(prices) => (prices, "cached"),
            None => (HashMap::new(), "none"),
        }
    });

    if let Ok(mut guard) = price_memory().lock() {
        *guard = Some((SystemTime::now(), prices.clone(), source));
    }
    (prices, source)
}

/// Price for a model name as logged, trying the common spellings LiteLLM uses.
fn price_for(prices: &HashMap<String, Price>, model: &str) -> Option<Price> {
    let base = model
        .to_ascii_lowercase()
        .trim_end_matches("[1m]")
        .trim_start_matches("anthropic/")
        .trim_start_matches("openai/")
        .to_string();
    let undated = regex::Regex::new(r"-\d{8}$").ok()?.replace(&base, "").to_string();
    [base.clone(), undated.clone(), format!("anthropic/{undated}"), format!("openai/{base}")]
        .iter()
        .find_map(|name| prices.get(name).copied())
}

fn cost(price: Price, tokens: &Tokens) -> f64 {
    tokens.input as f64 * price.input
        + tokens.output as f64 * price.output
        + tokens.cache_write as f64 * price.cache_write
        + tokens.cache_read as f64 * price.cache_read
}

fn aggregate(records: Vec<Record>, prices: &HashMap<String, Price>, tz_offset_minutes: i32) -> Vec<CostEntry> {
    let mut seen = HashSet::new();
    let mut groups: HashMap<(String, &'static str, String, String), (Tokens, Option<f64>)> = HashMap::new();
    for record in records {
        if let Some(key) = &record.dedupe {
            if !seen.insert(key.clone()) {
                continue;
            }
        }
        let key = (
            local_date(record.epoch, tz_offset_minutes),
            record.provider,
            record.model.clone(),
            record.project.clone(),
        );
        let entry = groups.entry(key).or_insert((Tokens::default(), Some(0.0)));
        entry.0.input += record.tokens.input;
        entry.0.output += record.tokens.output;
        entry.0.cache_write += record.tokens.cache_write;
        entry.0.cache_read += record.tokens.cache_read;
        entry.1 = match (entry.1, price_for(prices, &record.model)) {
            (Some(total), Some(price)) => Some(total + cost(price, &record.tokens)),
            _ => None,
        };
    }
    let mut entries: Vec<CostEntry> = groups
        .into_iter()
        .map(|((date, provider, model, project), (tokens, cost_usd))| CostEntry {
            date,
            provider: provider.to_string(),
            model,
            project,
            input_tokens: tokens.input,
            output_tokens: tokens.output,
            cache_write_tokens: tokens.cache_write,
            cache_read_tokens: tokens.cache_read,
            cost_usd,
        })
        .collect();
    entries.sort_by(|a, b| b.date.cmp(&a.date).then_with(|| a.provider.cmp(&b.provider)));
    entries
}

/// Token and cost entries per day, provider, model and project for the last `days` days.
#[tauri::command]
pub async fn get_local_costs(tz_offset_minutes: i32, days: u32) -> CostReport {
    let days = days.clamp(1, MAX_DAYS);
    // Start of the oldest local day asked for, as a UTC epoch.
    let local_now = now_epoch() - i64::from(tz_offset_minutes) * 60;
    let since = (local_now.div_euclid(DAY_SECS) - i64::from(days - 1)) * DAY_SECS + i64::from(tz_offset_minutes) * 60;

    let (prices, source) = load_prices().await;
    let scanned = tauri::async_runtime::spawn_blocking(move || scan(since)).await;
    let (records, files) = scanned.unwrap_or_default();
    CostReport {
        entries: aggregate(records, &prices, tz_offset_minutes),
        prices: source,
        files,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;

    #[test]
    fn epoch_parsing_handles_utc_offsets_and_fractions() {
        assert_eq!(parse_epoch("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_epoch("2021-01-01T00:00:00.123Z"), Some(1_609_459_200));
        assert_eq!(parse_epoch("2021-01-01T03:00:00+03:00"), Some(1_609_459_200));
        assert_eq!(parse_epoch("2020-12-31T21:00:00-03:00"), Some(1_609_459_200));
        assert_eq!(parse_epoch("bad"), None);
    }

    #[test]
    fn local_date_follows_the_javascript_offset() {
        // 2021-01-01 01:00 UTC is still Dec 31 in São Paulo (UTC-3, offset +180).
        assert_eq!(local_date(1_609_462_800, 180), "2020-12-31");
        assert_eq!(local_date(1_609_462_800, 0), "2021-01-01");
        assert_eq!(civil_from_days(days_from_civil(2024, 2, 29)), (2024, 2, 29));
    }

    #[test]
    fn parses_claude_assistant_usage_and_skips_other_lines() {
        let line = json!({
            "type": "assistant",
            "timestamp": "2026-09-26T12:00:00Z",
            "cwd": "C:\\\\Users\\\\me\\\\ai-dock",
            "requestId": "req_1",
            "message": {
                "id": "msg_1",
                "model": "claude-sonnet-4-5-20250929",
                "usage": { "input_tokens": 10, "output_tokens": 20, "cache_creation_input_tokens": 30, "cache_read_input_tokens": 40 }
            }
        })
        .to_string();
        let record = parse_claude_line(&line).expect("usage line should parse");
        assert_eq!(record.project, "ai-dock");
        assert_eq!(record.tokens, Tokens { input: 10, output: 20, cache_write: 30, cache_read: 40 });
        assert_eq!(record.dedupe.as_deref(), Some("msg_1:req_1"));
        assert!(parse_claude_line(r#"{"type":"user","message":{"content":"hi"}}"#).is_none());
    }

    #[test]
    fn parses_codex_rollouts_and_skips_repeated_totals() {
        let dir = std::env::temp_dir().join(format!("ai-dock-codex-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rollout-test.jsonl");
        let mut file = File::create(&path).unwrap();
        let usage = |total: u64| json!({
            "timestamp": "2026-09-26T12:00:00Z",
            "type": "event_msg",
            "payload": { "type": "token_count", "info": {
                "total_token_usage": { "total_tokens": total },
                "last_token_usage": { "input_tokens": 1000, "cached_input_tokens": 400, "output_tokens": 50 }
            } }
        });
        for line in [
            json!({ "type": "turn_context", "payload": { "model": "gpt-5-codex", "cwd": "/home/me/site" } }),
            usage(1050),
            usage(1050),
            usage(2100),
        ] {
            writeln!(file, "{line}").unwrap();
        }
        let records = parse_codex_file(&path);
        fs::remove_dir_all(&dir).ok();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].model, "gpt-5-codex");
        assert_eq!(records[0].project, "site");
        assert_eq!(records[0].tokens, Tokens { input: 600, output: 50, cache_write: 0, cache_read: 400 });
    }

    #[test]
    fn prices_match_dated_and_prefixed_model_names() {
        let prices = parse_prices(&json!({
            "claude-sonnet-4-5": { "input_cost_per_token": 3e-6, "output_cost_per_token": 1.5e-5,
                "cache_creation_input_token_cost": 3.75e-6, "cache_read_input_token_cost": 3e-7 },
            "gpt-5-codex": { "input_cost_per_token": 1.25e-6, "output_cost_per_token": 1e-5,
                "cache_read_input_token_cost": 1.25e-7 },
            "no-price": { "mode": "chat" }
        }));
        assert!(price_for(&prices, "claude-sonnet-4-5-20250929").is_some());
        assert!(price_for(&prices, "anthropic/claude-sonnet-4-5").is_some());
        assert!(price_for(&prices, "gpt-5-codex").is_some());
        assert!(price_for(&prices, "no-price").is_none());
        let codex = price_for(&prices, "gpt-5-codex").unwrap();
        assert_eq!(codex.cache_write, codex.input);
    }

    #[test]
    fn aggregates_by_day_and_dedupes_claude_replies() {
        let prices = parse_prices(&json!({
            "m": { "input_cost_per_token": 1e-6, "output_cost_per_token": 2e-6 }
        }));
        let record = |epoch: i64, dedupe: Option<&str>, model: &str| Record {
            epoch,
            provider: "claude",
            model: model.into(),
            project: "p".into(),
            tokens: Tokens { input: 1_000_000, output: 1_000_000, cache_write: 0, cache_read: 0 },
            dedupe: dedupe.map(str::to_string),
        };
        let entries = aggregate(
            vec![
                record(1_609_459_200, Some("a"), "m"),
                record(1_609_459_300, Some("a"), "m"),
                record(1_609_459_400, Some("b"), "m"),
                record(1_609_459_500, Some("c"), "unknown-model"),
            ],
            &prices,
            0,
        );
        let priced = entries.iter().find(|e| e.model == "m").unwrap();
        assert_eq!(priced.input_tokens, 2_000_000);
        assert!((priced.cost_usd.unwrap() - 6.0).abs() < 1e-9);
        let unpriced = entries.iter().find(|e| e.model == "unknown-model").unwrap();
        assert_eq!(unpriced.cost_usd, None);
    }
}

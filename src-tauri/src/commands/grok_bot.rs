//! Grok Bot desktop usage.
//!
//! Grok Bot (the xAI desktop app, not the Grok CLI) keeps its own weekly meter.
//! While it runs, it caches that meter in its user data folder:
//! `<config dir>/Grok Bot/sand-client-persistence/<base32 key>.blob`, where the
//! key ends in `.weekly-usage.cache`. The file is plain JSON with the percent
//! used (0 to 100) and the next reset. It holds no token, and nothing else in
//! that folder is opened. The account id inside the key is never read out.

use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use super::providers::{unix_to_iso, ProviderUsage, UsageWindow};

const CACHE_SUFFIX: &str = ".weekly-usage.cache";
const OPEN_THE_APP: &str = "Abra o Grok Bot para ler o limite.";
const OLD_READING: &str = "A semana virou. Abra o Grok Bot para atualizar.";
const NO_QUOTA: &str = "Conectado, sem leitura de cota.";

/// One cached reading of the weekly meter.
#[derive(Debug, Clone, PartialEq)]
struct Reading {
    percent_used: f64,
    next_reset_ms: Option<u64>,
    read_at_ms: u64,
    metered: bool,
    plan: Option<String>,
    /// SuperGrok unified plan: Grok Bot draws from the one Grok pool, so it gets no slot of its own.
    unified: bool,
}

/// None when Grok Bot is not installed, or when its account is on the unified plan
/// (then the Grok slot already shows that same pool).
pub(crate) fn usage() -> Option<ProviderUsage> {
    let folder = persistence_dir()?;
    let reading = latest_reading(&folder);
    if reading.as_ref().is_some_and(|reading| reading.unified) {
        return None;
    }
    Some(to_usage(reading, now_ms()))
}

fn persistence_dir() -> Option<PathBuf> {
    // Electron keeps userData in the OS config folder: Roaming on Windows,
    // Application Support on macOS, ~/.config on Linux.
    let path = dirs::config_dir()?.join("Grok Bot").join("sand-client-persistence");
    path.is_dir().then_some(path)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Newest reading across the accounts signed in to Grok Bot.
fn latest_reading(folder: &Path) -> Option<Reading> {
    let entries = fs::read_dir(folder).ok()?;
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let stem = name.to_str()?.strip_suffix(".blob")?;
            if !base32_decode(stem)?.ends_with(CACHE_SUFFIX.as_bytes()) {
                return None;
            }
            let raw = fs::read_to_string(entry.path()).ok()?;
            parse_cache(&serde_json::from_str::<Value>(&raw).ok()?)
        })
        .max_by_key(|reading| reading.read_at_ms)
}

/// Lowercase RFC 4648 base32 without padding, as Grok Bot names its files.
fn base32_decode(text: &str) -> Option<Vec<u8>> {
    let mut bytes = Vec::with_capacity(text.len() * 5 / 8);
    let mut buffer: u32 = 0;
    let mut bits = 0;
    for char in text.bytes() {
        let value = match char {
            b'a'..=b'z' => char - b'a',
            b'2'..=b'7' => char - b'2' + 26,
            _ => return None,
        };
        buffer = (buffer << 5) | value as u32;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            bytes.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Some(bytes)
}

fn number(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|number| number.is_finite())
}

fn parse_cache(json: &Value) -> Option<Reading> {
    let value = json.get("value")?;
    if value.get("kind").and_then(Value::as_str) != Some("present") {
        return None;
    }
    let reading = value.get("reading")?;
    let usage = reading.get("usage")?;
    let percent_used = number(usage.get("percentUsed"))?.max(0.0);
    let read_at_ms = number(reading.get("readAtMs"))? as u64;
    let next_reset_ms = number(usage.get("nextResetMs")).filter(|ms| *ms > 0.0).map(|ms| ms as u64);
    // A team seat draws from a pooled allowance, and a zero limit has no meter.
    let team_seat = usage.get("isTeamSeat").and_then(Value::as_bool) == Some(true);
    let metered = usage.get("hasNonZeroIncludedLimit").and_then(Value::as_bool) == Some(true) && !team_seat;
    let plan = usage
        .get("grokPlanLabel")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|label| !label.is_empty() && label.len() <= 40)
        .map(str::to_string);
    let unified = usage.get("unifiedPlanName").is_some_and(Value::is_string);
    Some(Reading {
        percent_used,
        next_reset_ms,
        read_at_ms,
        metered,
        plan,
        unified,
    })
}

fn to_usage(reading: Option<Reading>, now: u64) -> ProviderUsage {
    let mut usage = ProviderUsage {
        id: "grok-bot".into(),
        name: "Grok Bot".into(),
        connected: true,
        plan: None,
        email: None,
        windows: vec![],
        error: None,
    };
    let Some(reading) = reading else {
        usage.connected = false;
        usage.error = Some(OPEN_THE_APP.into());
        return usage;
    };
    usage.plan = reading.plan.clone();
    if !reading.metered {
        usage.error = Some(NO_QUOTA.into());
        return usage;
    }
    // A reading from before the last reset says nothing about this week.
    if reading.next_reset_ms.is_some_and(|reset| reset <= now) {
        usage.error = Some(OLD_READING.into());
        return usage;
    }
    usage.windows.push(UsageWindow {
        id: "weekly".into(),
        label: "Semanal".into(),
        remaining_percent: (100.0 - reading.percent_used).clamp(0.0, 100.0),
        reset_at: reading.next_reset_ms.map(|ms| unix_to_iso((ms / 1000) as i64)),
        amount: None,
    });
    usage
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base32_encode(bytes: &[u8]) -> String {
        const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz234567";
        let mut out = String::new();
        let mut buffer: u32 = 0;
        let mut bits = 0;
        for byte in bytes {
            buffer = (buffer << 8) | *byte as u32;
            bits += 8;
            while bits >= 5 {
                bits -= 5;
                out.push(ALPHABET[((buffer >> bits) & 31) as usize] as char);
            }
            buffer &= (1 << bits) - 1;
        }
        if bits > 0 {
            out.push(ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
        }
        out
    }

    fn cache(percent: f64, reset: u64, read_at: u64) -> Value {
        json!({
            "schemaVersion": 2,
            "value": {
                "kind": "present",
                "selectedTeamId": null,
                "reading": {
                    "usage": {
                        "percentUsed": percent,
                        "nextResetMs": reset,
                        "isSandTrial": false,
                        "hasNonZeroIncludedLimit": true,
                        "isTeamSeat": false,
                        "onDemand": null,
                        "grokPlanLabel": "SuperGrok"
                    },
                    "readAtMs": read_at
                },
                "expiresAtMs": read_at + 86_400_000
            }
        })
    }

    #[test]
    fn file_names_are_lowercase_base32() {
        let key = "sand.client.slice.account.EXAMPLE.weekly-usage.cache";
        let decoded = base32_decode(&base32_encode(key.as_bytes())).unwrap();
        assert_eq!(decoded, key.as_bytes());
        assert!(base32_decode("not base32!").is_none());
    }

    #[test]
    fn percent_used_is_on_a_0_to_100_scale() {
        let reading = parse_cache(&cache(25.5, 2_000_000_000_000, 1_000)).unwrap();
        let usage = to_usage(Some(reading), 1_500);
        assert!(usage.connected);
        assert_eq!(usage.plan.as_deref(), Some("SuperGrok"));
        assert_eq!(usage.windows.len(), 1);
        assert_eq!(usage.windows[0].id, "weekly");
        assert_eq!(usage.windows[0].remaining_percent, 74.5);
        assert_eq!(usage.windows[0].reset_at.as_deref(), Some("2033-05-18T03:33:20Z"));

        let tiny = to_usage(parse_cache(&cache(0.105255, 2_000_000_000_000, 1_000)), 1_500);
        assert!((tiny.windows[0].remaining_percent - 99.894745).abs() < 1e-9);
    }

    #[test]
    fn a_reading_from_before_the_reset_is_not_shown_as_this_week() {
        let usage = to_usage(parse_cache(&cache(80.0, 5_000, 1_000)), 6_000);
        assert!(usage.connected);
        assert!(usage.windows.is_empty());
        assert_eq!(usage.error.as_deref(), Some(OLD_READING));
    }

    #[test]
    fn no_reading_asks_to_open_the_app() {
        let usage = to_usage(None, 0);
        assert!(!usage.connected);
        assert_eq!(usage.error.as_deref(), Some(OPEN_THE_APP));
    }

    #[test]
    fn a_team_seat_or_zero_limit_has_no_meter() {
        let mut team = cache(10.0, 2_000_000_000_000, 1_000);
        team["value"]["reading"]["usage"]["isTeamSeat"] = json!(true);
        assert!(to_usage(parse_cache(&team), 1_500).windows.is_empty());

        let mut zero = cache(10.0, 2_000_000_000_000, 1_000);
        zero["value"]["reading"]["usage"]["hasNonZeroIncludedLimit"] = json!(false);
        let usage = to_usage(parse_cache(&zero), 1_500);
        assert!(usage.windows.is_empty());
        assert_eq!(usage.error.as_deref(), Some(NO_QUOTA));
    }

    #[test]
    fn a_unified_plan_is_flagged_so_grok_keeps_one_slot() {
        assert!(!parse_cache(&cache(10.0, 2_000_000_000_000, 1_000)).unwrap().unified);
        let mut unified = cache(10.0, 2_000_000_000_000, 1_000);
        unified["value"]["reading"]["usage"]["unifiedPlanName"] = json!("SuperGrok Heavy");
        assert!(parse_cache(&unified).unwrap().unified);
    }

    #[test]
    fn an_absent_cache_is_not_a_reading() {
        assert!(parse_cache(&json!({ "schemaVersion": 2, "value": { "kind": "absent" } })).is_none());
    }

    #[test]
    fn the_newest_account_reading_wins() {
        let folder = std::env::temp_dir().join(format!("ai-dock-grok-bot-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        let name = |account: &str, suffix: &str| {
            format!("{}.blob", base32_encode(format!("sand.client.slice.account.{account}{suffix}").as_bytes()))
        };
        fs::write(folder.join(name("A", CACHE_SUFFIX)), cache(10.0, 2_000_000_000_000, 1_000).to_string()).unwrap();
        fs::write(folder.join(name("B", CACHE_SUFFIX)), cache(40.0, 2_000_000_000_000, 9_000).to_string()).unwrap();
        fs::write(folder.join(name("C", ".ui-layout")), cache(99.0, 2_000_000_000_000, 99_000).to_string()).unwrap();
        let reading = latest_reading(&folder).unwrap();
        let _ = fs::remove_dir_all(&folder);
        assert_eq!(reading.percent_used, 40.0);
        assert_eq!(reading.read_at_ms, 9_000);
    }
}

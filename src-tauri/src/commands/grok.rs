//! Grok CLI usage.
//!
//! The OAuth session lives in GROK_HOME or ~/.grok/auth.json, a map of scope to
//! credential. The token is the `key` of a scope that contains `auth.x.ai` and
//! whose `expires_at` is still in the future. `xai::api_key` is a different wallet
//! and is never sent. The key stays in memory for one request and is not logged.

use reqwest::header::{ACCEPT, AUTHORIZATION};
use serde_json::Value;
use std::{
    env, fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use super::providers::{disconnected, unix_to_iso, ProviderUsage, UsageWindow};

const BILLING_URL: &str = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const NOT_CONNECTED: &str = "Grok CLI não conectado. Rode grok login.";
const EXPIRED: &str = "A sessão do Grok expirou. Rode grok login.";
const NO_QUOTA: &str = "Conectado, sem leitura de cota.";

pub(crate) struct GrokAccounts {
    pub(crate) main: ProviderUsage,
    pub(crate) bot: Option<ProviderUsage>,
}

pub(crate) async fn usage(client: &reqwest::Client) -> GrokAccounts {
    let Some(token) = read_token() else {
        return only_main(disconnected("grok", "Grok", NOT_CONNECTED));
    };

    let response = match client
        .get(BILLING_URL)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header("X-XAI-Token-Auth", "xai-grok-cli")
        .header(ACCEPT, "application/json")
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => {
            return only_main(disconnected("grok", "Grok", "Falha de rede ao consultar o uso do Grok."));
        }
    };

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return only_main(disconnected("grok", "Grok", EXPIRED));
    }
    if !response.status().is_success() {
        return only_main(disconnected(
            "grok",
            "Grok",
            format!("Grok retornou HTTP {}.", response.status().as_u16()),
        ));
    }

    match response.json::<Value>().await {
        Ok(body) => parse_accounts(&body),
        Err(_) => only_main(unmetered()),
    }
}

fn only_main(main: ProviderUsage) -> GrokAccounts {
    GrokAccounts { main, bot: None }
}

/// The HTTP client never started. A saved session still shows the slot.
pub(crate) fn without_http_client() -> ProviderUsage {
    if read_token().is_some() {
        unmetered()
    } else {
        disconnected("grok", "Grok", NOT_CONNECTED)
    }
}

fn unmetered() -> ProviderUsage {
    ProviderUsage {
        id: "grok".into(),
        name: "Grok".into(),
        connected: true,
        plan: None,
        email: None,
        windows: vec![],
        error: Some(NO_QUOTA.into()),
    }
}

fn with_window(window: UsageWindow) -> ProviderUsage {
    ProviderUsage {
        id: "grok".into(),
        name: "Grok".into(),
        connected: true,
        plan: None,
        email: None,
        windows: vec![window],
        error: None,
    }
}

fn auth_path() -> Option<PathBuf> {
    if let Some(raw) = env::var_os("GROK_HOME") {
        if !raw.is_empty() {
            let path = PathBuf::from(raw);
            let file = if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
                path
            } else {
                path.join("auth.json")
            };
            if file.is_file() {
                return Some(file);
            }
        }
    }
    let file = dirs::home_dir()?.join(".grok").join("auth.json");
    file.is_file().then_some(file)
}

fn read_token() -> Option<String> {
    let raw = fs::read_to_string(auth_path()?).ok()?;
    let json = serde_json::from_str::<Value>(&raw).ok()?;
    select_token(&json, now_unix())
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// Latest unexpired OAuth session. The API-key wallet is a different limit.
fn select_token(json: &Value, now: u64) -> Option<String> {
    let mut chosen: Option<(u64, &str)> = None;
    for (scope, value) in json.as_object()? {
        if scope.contains("xai::api_key") || !scope.contains("auth.x.ai") {
            continue;
        }
        let Some(key) = value.get("key").and_then(Value::as_str).filter(|key| !key.trim().is_empty()) else {
            continue;
        };
        let Some(expires) = value.get("expires_at").and_then(Value::as_str).and_then(parse_unix) else {
            continue;
        };
        if expires <= now {
            continue;
        }
        if chosen.as_ref().is_none_or(|(best, _)| expires > *best) {
            chosen = Some((expires, key));
        }
    }
    chosen.map(|(_, key)| key.to_string())
}

fn parse_unix(text: &str) -> Option<u64> {
    let text = text.trim();
    let text = text
        .strip_suffix('Z')
        .or_else(|| text.strip_suffix("+00:00"))?;
    let (date, time) = text.split_once('T')?;
    let mut date_parts = date.split('-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: u32 = date_parts.next()?.parse().ok()?;
    let day: u32 = date_parts.next()?.parse().ok()?;
    if date_parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let time = time.split_once('.').map(|(clock, _)| clock).unwrap_or(time);
    let mut clock = time.split(':');
    let hour: u32 = clock.next()?.parse().ok()?;
    let minute: u32 = clock.next()?.parse().ok()?;
    let second: u32 = clock.next()?.parse().ok()?;
    if clock.next().is_some() || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let days = days_from_civil(year, month, day)?;
    Some(days * 86_400 + hour as u64 * 3_600 + minute as u64 * 60 + second as u64)
}

fn days_from_civil(mut year: i64, month: u32, day: u32) -> Option<u64> {
    year -= if month <= 2 { 1 } else { 0 };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = (year - era * 400) as u64;
    let month_prime = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year as u64;
    let days = era * 146_097 + day_of_era as i64 - 719_468;
    u64::try_from(days).ok()
}

fn billing_root(body: &Value) -> &Value {
    body.get("config")
        .filter(|config| {
            config.get("currentPeriod").is_some()
                || config.get("creditUsagePercent").is_some()
                || config.get("monthlyLimit").is_some()
        })
        .unwrap_or(body)
}

fn number(value: Option<&Value>) -> Option<f64> {
    value.and_then(|value| value.as_f64().or_else(|| value.as_i64().map(|number| number as f64)))
}

fn remaining(used_percent: f64) -> f64 {
    (100.0 - used_percent).clamp(0.0, 100.0)
}

fn reset_text(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(text) = value.as_str() {
        return Some(trim_fraction(text));
    }
    let raw = number(Some(value))?;
    let seconds = if raw > 10_000_000_000.0 { (raw / 1000.0) as i64 } else { raw as i64 };
    Some(unix_to_iso(seconds))
}

fn trim_fraction(text: &str) -> String {
    let Some((head, rest)) = text.split_once('.') else {
        return text.to_string();
    };
    let digits: String = rest.chars().take_while(|char| char.is_ascii_digit()).take(3).collect();
    let tail = rest.trim_start_matches(|char: char| char.is_ascii_digit());
    if digits.is_empty() {
        return text.to_string();
    }
    format!("{head}.{digits}{tail}")
}

pub(crate) fn parse_billing(body: &Value) -> ProviderUsage {
    parse_accounts(body).main
}

/// Main weekly pool, plus Grok Bot only when the payload has its own percent and a different reset.
pub(crate) fn parse_accounts(body: &Value) -> GrokAccounts {
    let root = billing_root(body);
    let main = if let Some(window) = weekly_window(root) {
        with_window(window)
    } else if let Some(window) = legacy_window(root) {
        with_window(window)
    } else {
        unmetered()
    };
    let weekly_reset = main
        .windows
        .iter()
        .find(|window| window.id == "weekly")
        .and_then(|window| window.reset_at.clone());
    let bot = bot_window(root, weekly_reset.as_deref()).map(bot_provider);
    GrokAccounts { main, bot }
}

fn bot_provider(window: UsageWindow) -> ProviderUsage {
    ProviderUsage {
        id: "grok-bot".into(),
        name: "Grok Bot".into(),
        connected: true,
        plan: None,
        email: None,
        windows: vec![window],
        error: None,
    }
}

fn is_bot_label(text: &str) -> bool {
    let compact: String = text
        .chars()
        .filter(|char| char.is_ascii_alphanumeric())
        .flat_map(|char| char.to_lowercase())
        .collect();
    compact == "bot" || compact == "grokbot"
}

fn bot_window(node: &Value, weekly_reset: Option<&str>) -> Option<UsageWindow> {
    match node {
        Value::Array(items) => items.iter().find_map(|item| bot_window(item, weekly_reset)),
        Value::Object(map) => {
            if names_bot(map) {
                if let Some(window) = window_from_bot(map, weekly_reset) {
                    return Some(window);
                }
            }
            for (key, value) in map {
                if is_bot_label(key) {
                    if let Some(window) = value.as_object().and_then(|inner| window_from_bot(inner, weekly_reset)) {
                        return Some(window);
                    }
                }
                if let Some(window) = bot_window(value, weekly_reset) {
                    return Some(window);
                }
            }
            None
        }
        _ => None,
    }
}

fn names_bot(map: &serde_json::Map<String, Value>) -> bool {
    ["product", "name", "id", "label"].iter().any(|key| {
        map.get(*key).and_then(Value::as_str).is_some_and(is_bot_label)
    })
}

/// Used percent plus a reset that is not the SuperGrok weekly clock.
fn window_from_bot(map: &serde_json::Map<String, Value>, weekly_reset: Option<&str>) -> Option<UsageWindow> {
    let used = number(map.get("usagePercent")).or_else(|| number(map.get("creditUsagePercent")))?;
    let reset = own_reset(map)?;
    if weekly_reset.is_some_and(|weekly| same_instant(weekly, &reset)) {
        return None;
    }
    Some(UsageWindow {
        id: "weekly".into(),
        label: "Semanal".into(),
        remaining_percent: remaining(used),
        reset_at: Some(reset),
        amount: None,
    })
}

fn own_reset(map: &serde_json::Map<String, Value>) -> Option<String> {
    let nested = map
        .get("currentPeriod")
        .or_else(|| map.get("period"))
        .and_then(|period| reset_text(period.get("end")));
    nested.or_else(|| {
        ["periodEnd", "resetAt", "reset_at", "billingPeriodEnd"]
            .iter()
            .find_map(|key| reset_text(map.get(*key)))
    })
}

fn same_instant(left: &str, right: &str) -> bool {
    match (parse_unix(left), parse_unix(right)) {
        (Some(left), Some(right)) => left == right,
        _ => left == right,
    }
}

fn weekly_window(root: &Value) -> Option<UsageWindow> {
    let period = root.get("currentPeriod")?;
    if period.get("type").and_then(Value::as_str) != Some("USAGE_PERIOD_TYPE_WEEKLY") {
        return None;
    }
    let used = number(root.get("creditUsagePercent"))
        .or_else(|| number(period.get("creditUsagePercent")))?;
    Some(UsageWindow {
        id: "weekly".into(),
        label: "Semanal".into(),
        remaining_percent: remaining(used),
        reset_at: reset_text(period.get("end")),
        amount: None,
    })
}

fn legacy_window(root: &Value) -> Option<UsageWindow> {
    let used = number(root.get("used").and_then(|used| used.get("val")))?;
    let limit = number(root.get("monthlyLimit").and_then(|limit| limit.get("val")))?;
    if limit <= 0.0 {
        return None;
    }
    let used_percent = (used / limit * 100.0).clamp(0.0, 100.0);
    Some(UsageWindow {
        id: "monthly".into(),
        label: "Mensal".into(),
        remaining_percent: remaining(used_percent),
        reset_at: None,
        amount: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn civil_midnight_matches_a_known_unix_instant() {
        assert_eq!(parse_unix("2021-01-01T00:00:00Z"), Some(1_609_459_200));
        assert_eq!(parse_unix("2026-10-25T07:15:28.318728500Z"), parse_unix("2026-10-25T07:15:28Z"));
    }

    #[test]
    fn oauth_session_wins_over_the_api_wallet_and_an_expired_key() {
        let now = parse_unix("2026-01-01T00:00:00Z").unwrap();
        let json = json!({
            "xai::api_key": { "key": "wallet", "expires_at": "2099-01-01T00:00:00Z" },
            "https://auth.x.ai::old": { "key": "stale", "expires_at": "2020-01-01T00:00:00Z" },
            "https://auth.x.ai::early": { "key": "early", "expires_at": "2026-06-01T00:00:00Z" },
            "https://auth.x.ai::late": { "key": "late", "expires_at": "2026-12-01T00:00:00Z" }
        });
        assert_eq!(select_token(&json, now).as_deref(), Some("late"));
        assert_eq!(select_token(&json!({ "xai::api_key": { "key": "wallet" } }), now), None);
    }

    #[test]
    fn weekly_zero_used_is_a_full_window_and_the_reset_keeps_milliseconds() {
        let parsed = parse_billing(&json!({
            "config": {
                "currentPeriod": {
                    "type": "USAGE_PERIOD_TYPE_WEEKLY",
                    "end": "2026-11-01T00:00:00.123456789Z"
                },
                "creditUsagePercent": 0
            }
        }));
        assert!(parsed.connected);
        assert!(parsed.error.is_none());
        assert_eq!(parsed.windows.len(), 1);
        assert_eq!(parsed.windows[0].id, "weekly");
        assert_eq!(parsed.windows[0].label, "Semanal");
        assert_eq!(parsed.windows[0].remaining_percent, 100.0);
        assert_eq!(parsed.windows[0].reset_at.as_deref(), Some("2026-11-01T00:00:00.123Z"));
    }

    #[test]
    fn a_weekly_percent_at_the_root_becomes_remaining_quota() {
        let parsed = parse_billing(&json!({
            "currentPeriod": { "type": "USAGE_PERIOD_TYPE_WEEKLY", "end": 1_763_942_400 },
            "creditUsagePercent": 25
        }));
        assert_eq!(parsed.windows[0].remaining_percent, 75.0);
        assert_eq!(parsed.windows[0].reset_at.as_deref(), Some("2025-11-24T00:00:00Z"));
    }

    #[test]
    fn a_weekly_period_without_a_percent_does_not_invent_one() {
        let parsed = parse_billing(&json!({
            "currentPeriod": { "type": "USAGE_PERIOD_TYPE_WEEKLY" }
        }));
        assert!(parsed.connected);
        assert!(parsed.windows.is_empty());
        assert_eq!(parsed.error.as_deref(), Some(NO_QUOTA));
    }

    #[test]
    fn the_old_monthly_shape_uses_used_and_limit() {
        let full = parse_billing(&json!({ "used": { "val": 0 }, "monthlyLimit": { "val": 80 } }));
        assert_eq!(full.windows[0].id, "monthly");
        assert_eq!(full.windows[0].remaining_percent, 100.0);
        let partial = parse_billing(&json!({ "used": { "val": 20 }, "monthlyLimit": { "val": 80 } }));
        assert_eq!(partial.windows[0].remaining_percent, 75.0);
        let missing = parse_billing(&json!({ "used": { "val": 20 }, "monthlyLimit": { "val": 0 } }));
        assert!(missing.windows.is_empty());
    }

    #[test]
    fn product_slices_of_the_weekly_pool_do_not_become_a_bot() {
        let parsed = parse_accounts(&json!({
            "config": {
                "currentPeriod": {
                    "type": "USAGE_PERIOD_TYPE_WEEKLY",
                    "end": "2026-10-27T00:27:10.500625+00:00"
                },
                "creditUsagePercent": 29,
                "isUnifiedBillingUser": true,
                "billingPeriodEnd": "2026-10-27T00:27:10.500625+00:00",
                "productUsage": [
                    { "product": "GrokBuild", "usagePercent": 15 },
                    { "product": "GrokChat", "usagePercent": 6 },
                    { "product": "GrokTasks", "usagePercent": 5 },
                    { "product": "GrokAppBuilder", "usagePercent": 2 },
                    { "product": "GrokImagine", "usagePercent": 1 }
                ]
            }
        }));
        assert!(parsed.bot.is_none());
        assert_eq!(parsed.main.id, "grok");
        assert_eq!(parsed.main.windows[0].remaining_percent, 71.0);
    }

    #[test]
    fn a_bot_meter_with_its_own_reset_is_a_second_weekly_slot() {
        let parsed = parse_accounts(&json!({
            "config": {
                "currentPeriod": { "type": "USAGE_PERIOD_TYPE_WEEKLY", "end": "2026-10-27T00:00:00Z" },
                "creditUsagePercent": 74,
                "productUsage": [
                    { "product": "GrokBot", "usagePercent": 0, "periodEnd": "2026-11-02T00:00:00Z" }
                ]
            }
        }));
        assert_eq!(parsed.main.windows[0].remaining_percent, 26.0);
        let bot = parsed.bot.expect("bot");
        assert_eq!(bot.id, "grok-bot");
        assert_eq!(bot.name, "Grok Bot");
        assert_eq!(bot.windows.len(), 1);
        assert_eq!(bot.windows[0].id, "weekly");
        assert_eq!(bot.windows[0].label, "Semanal");
        assert_eq!(bot.windows[0].remaining_percent, 100.0);
        assert_eq!(bot.windows[0].reset_at.as_deref(), Some("2026-11-02T00:00:00Z"));
    }

    #[test]
    fn a_bot_on_the_same_clock_stays_in_the_one_pool() {
        let parsed = parse_accounts(&json!({
            "currentPeriod": { "type": "USAGE_PERIOD_TYPE_WEEKLY", "end": "2026-10-27T00:00:00Z" },
            "creditUsagePercent": 29,
            "productUsage": [
                { "product": "GrokBot", "usagePercent": 0, "periodEnd": "2026-10-27T00:00:00.000Z" }
            ]
        }));
        assert!(parsed.bot.is_none());
        assert_eq!(parsed.main.windows[0].remaining_percent, 71.0);
    }
}

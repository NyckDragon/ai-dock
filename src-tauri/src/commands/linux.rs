//! Linux helpers shared by the dock, focus and setup commands.

use std::path::PathBuf;
use std::process::Command;

/// The tray does not inherit a login PATH, so the usual install folders are
/// checked as files before `which` is asked.
pub(crate) fn tool(name: &str) -> Option<PathBuf> {
    let system = PathBuf::from("/usr/bin").join(name);
    if system.is_file() {
        return Some(system);
    }
    if let Some(home) = dirs::home_dir() {
        let local = home.join(".local").join("bin").join(name);
        if local.is_file() {
            return Some(local);
        }
    }
    let output = Command::new("which").arg(name).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    path.is_file().then_some(path)
}

/// Window control through hyprctl. Other compositors have no equivalent here.
pub(crate) mod hyprland {
    use std::process::Command;
    use std::sync::atomic::{AtomicBool, Ordering};

    use serde_json::Value;

    fn hyprctl() -> Option<std::path::PathBuf> {
        super::tool("hyprctl")
    }

    fn query(request: &str) -> Option<Value> {
        let output = Command::new(hyprctl()?).args([request, "-j"]).output().ok()?;
        if !output.status.success() {
            return None;
        }
        serde_json::from_slice(&output.stdout).ok()
    }

    pub(crate) fn active_window() -> Option<Value> {
        query("activewindow")
    }

    pub(crate) fn own_window() -> Option<Value> {
        let pid = u64::from(std::process::id());
        query("clients")?
            .as_array()?
            .iter()
            .find(|client| client.get("pid").and_then(Value::as_u64) == Some(pid))
            .cloned()
    }

    pub(crate) fn is_ours(window: &Value) -> bool {
        let pid = window.get("pid").and_then(Value::as_u64).unwrap_or(0);
        let class = window.get("class").and_then(Value::as_str).unwrap_or("");
        (pid != 0 && pid == u64::from(std::process::id())) || class == "app.aidock.desktop" || class == "AI Dock"
    }

    /// Only a hex address goes into a dispatch, so no reply can smuggle in a command.
    pub(crate) fn address(window: &Value) -> Option<&str> {
        let address = window.get("address").and_then(Value::as_str)?;
        let digits = address.strip_prefix("0x")?;
        (!digits.is_empty() && digits != "0" && digits.chars().all(|ch| ch.is_ascii_hexdigit())).then_some(address)
    }

    pub(crate) fn flag(window: &Value, name: &str) -> bool {
        window.get(name).and_then(Value::as_bool).unwrap_or(false)
    }

    /// `activewindow` reports 1 for a maximized window and 2 for fullscreen.
    pub(crate) fn hides_dock(window: &Value) -> bool {
        !is_ours(window) && window.get("fullscreen").and_then(Value::as_i64) == Some(2)
    }

    #[derive(Clone, Copy)]
    pub(crate) enum Dispatch {
        Float,
        Pin,
        Top,
        Focus,
        Paste,
    }

    impl Dispatch {
        fn legacy(self, window: &str) -> String {
            match self {
                Self::Float => format!("setfloating {window}"),
                Self::Pin => format!("pin {window}"),
                Self::Top => format!("alterzorder top,{window}"),
                Self::Focus => format!("focuswindow {window}"),
                Self::Paste => format!("sendshortcut CTRL, V, {window}"),
            }
        }

        fn lua(self, window: &str) -> String {
            match self {
                Self::Float => format!("hl.dsp.window.float({{ window = \"{window}\", action = \"enable\" }})"),
                Self::Pin => format!("hl.dsp.window.pin({{ window = \"{window}\", action = \"enable\" }})"),
                Self::Top => format!("hl.dsp.window.alter_zorder({{ window = \"{window}\", mode = \"top\" }})"),
                Self::Focus => format!("hl.dsp.focus({{ window = \"{window}\" }})"),
                Self::Paste => format!("hl.dsp.send_shortcut({{ window = \"{window}\", mods = \"CTRL\", key = \"V\" }})"),
            }
        }
    }

    static LUA: AtomicBool = AtomicBool::new(false);

    /// A Lua config takes `hl.dsp` calls after `dispatch`, and newer Hyprland
    /// releases take only that. hyprctl exits 0 when a dispatch is refused, so
    /// the reply decides, and the syntax that worked is tried first next time.
    /// The legacy `pin` toggles: callers check `pinned` before asking for it.
    pub(crate) fn dispatch(action: Dispatch, address: &str) -> bool {
        let Some(hyprctl) = hyprctl() else {
            return false;
        };
        let window = format!("address:{address}");
        let first = LUA.load(Ordering::Relaxed);
        for lua in [first, !first] {
            let request = if lua { action.lua(&window) } else { action.legacy(&window) };
            let Ok(output) = Command::new(&hyprctl).args(["dispatch", &request]).output() else {
                return false;
            };
            if String::from_utf8_lossy(&output.stdout).trim() == "ok" {
                LUA.store(lua, Ordering::Relaxed);
                return true;
            }
        }
        false
    }

    #[cfg(test)]
    mod tests {
        use super::{address, hides_dock, Dispatch};
        use serde_json::json;

        #[test]
        fn only_fullscreen_hides_the_dock() {
            assert!(hides_dock(&json!({ "fullscreen": 2, "pid": 1, "class": "firefox" })));
            assert!(!hides_dock(&json!({ "fullscreen": 1, "pid": 1, "class": "firefox" })));
            assert!(!hides_dock(&json!({ "fullscreen": 0, "pid": 1, "class": "firefox" })));
        }

        #[test]
        fn our_window_does_not_hide_the_dock() {
            assert!(!hides_dock(&json!({ "fullscreen": 2, "pid": std::process::id(), "class": "" })));
            assert!(!hides_dock(&json!({ "fullscreen": 2, "pid": 1, "class": "app.aidock.desktop" })));
        }

        #[test]
        fn addresses_must_be_hex() {
            assert_eq!(address(&json!({ "address": "0x55d0c0ffee" })), Some("0x55d0c0ffee"));
            assert_eq!(address(&json!({ "address": "0x0" })), None);
            assert_eq!(address(&json!({ "address": "0x1\" })" })), None);
            assert_eq!(address(&json!({ "address": "" })), None);
        }

        #[test]
        fn both_syntaxes_name_the_same_window() {
            let window = "address:0xabc";
            assert_eq!(Dispatch::Pin.legacy(window), "pin address:0xabc");
            assert_eq!(
                Dispatch::Pin.lua(window),
                "hl.dsp.window.pin({ window = \"address:0xabc\", action = \"enable\" })"
            );
            assert_eq!(Dispatch::Paste.legacy(window), "sendshortcut CTRL, V, address:0xabc");
            assert_eq!(
                Dispatch::Paste.lua(window),
                "hl.dsp.send_shortcut({ window = \"address:0xabc\", mods = \"CTRL\", key = \"V\" })"
            );
            assert_eq!(Dispatch::Top.legacy(window), "alterzorder top,address:0xabc");
        }
    }
}

//! Remembers which app had focus before the dock took it, so a copied prompt
//! can go straight back there (and optionally be pasted).

use tauri::AppHandle;

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::atomic::{AtomicIsize, Ordering};
    use tauri::{AppHandle, Manager};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_V,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

    static PREVIOUS: AtomicIsize = AtomicIsize::new(0);

    fn own_window(app: &AppHandle) -> isize {
        app.get_webview_window("main")
            .and_then(|window| window.hwnd().ok())
            .map(|hwnd| hwnd.0 as isize)
            .unwrap_or(0)
    }

    pub fn remember(app: &AppHandle) {
        // SAFETY: GetForegroundWindow takes no arguments and only returns a handle.
        let hwnd = unsafe { GetForegroundWindow() } as isize;
        if hwnd != 0 && hwnd != own_window(app) {
            PREVIOUS.store(hwnd, Ordering::Relaxed);
        }
    }

    fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    pub async fn give_back(paste: bool) -> bool {
        let hwnd = PREVIOUS.load(Ordering::Relaxed);
        if hwnd == 0 {
            return false;
        }
        // SAFETY: the handle came from GetForegroundWindow; a stale handle only makes the call fail.
        let focused = unsafe { SetForegroundWindow(hwnd as _) } != 0;
        if focused && paste {
            tokio::time::sleep(std::time::Duration::from_millis(90)).await;
            let inputs = [key(VK_CONTROL, false), key(VK_V, false), key(VK_V, true), key(VK_CONTROL, true)];
            // SAFETY: the slice outlives the call and cbsize is the size of one INPUT.
            unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
        }
        focused
    }
}

#[cfg(target_os = "linux")]
mod imp_linux {
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::Mutex;

    use serde_json::Value;
    use tauri::AppHandle;

    static PREVIOUS: Mutex<String> = Mutex::new(String::new());

    /// The tray does not inherit a login PATH, so these tools are files first.
    fn tool(name: &str) -> Option<PathBuf> {
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

    fn active_window() -> Option<Value> {
        let hyprctl = tool("hyprctl")?;
        let output = Command::new(hyprctl).args(["activewindow", "-j"]).output().ok()?;
        if !output.status.success() {
            return None;
        }
        serde_json::from_slice(&output.stdout).ok()
    }

    fn is_ours(window: &Value) -> bool {
        let pid = window.get("pid").and_then(Value::as_u64).unwrap_or(0) as u32;
        let class = window.get("class").and_then(Value::as_str).unwrap_or("");
        (pid != 0 && pid == std::process::id()) || class == "app.aidock.desktop" || class == "AI Dock"
    }

    pub fn remember(_app: &AppHandle) {
        let Some(window) = active_window() else { return };
        if is_ours(&window) {
            return;
        }
        let Some(address) = window.get("address").and_then(Value::as_str) else { return };
        if address.is_empty() || address == "0x0" {
            return;
        }
        if let Ok(mut previous) = PREVIOUS.lock() {
            *previous = address.to_string();
        }
    }

    fn send_ctrl_v(paste_with: &PathBuf) -> bool {
        let name = paste_with.file_name().and_then(|value| value.to_str()).unwrap_or("");
        let result = if name == "ydotool" {
            // Linux input codes: left Ctrl is 29, V is 47. Down then up, like the Windows chord.
            Command::new(paste_with).args(["key", "29:1", "47:1", "47:0", "29:0"]).status()
        } else {
            Command::new(paste_with).args(["-M", "ctrl", "-k", "v", "-m", "ctrl"]).status()
        };
        result.map(|status| status.success()).unwrap_or(false)
    }

    pub async fn give_back(paste: bool) -> bool {
        let address = PREVIOUS.lock().ok().map(|value| value.clone()).unwrap_or_default();
        if address.is_empty() {
            return false;
        }
        let Some(hyprctl) = tool("hyprctl") else { return false };
        let focused = Command::new(&hyprctl)
            .args(["dispatch", "focuswindow", &format!("address:{address}")])
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if !focused {
            return false;
        }
        if paste {
            tokio::time::sleep(std::time::Duration::from_millis(90)).await;
            // Hyprland can deliver the shortcut itself. wtype and ydotool remain
            // for a session where that dispatcher is missing.
            if !send_hypr_ctrl_v(&hyprctl, &address) {
                if let Some(paste_with) = tool("wtype").or_else(|| tool("ydotool")) {
                    let _ = send_ctrl_v(&paste_with);
                }
            }
        }
        true
    }

    fn send_hypr_ctrl_v(hyprctl: &PathBuf, address: &str) -> bool {
        Command::new(hyprctl)
            .args(["dispatch", "sendshortcut", &hypr_ctrl_v_argument(address)])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn hypr_ctrl_v_argument(address: &str) -> String {
        format!("CTRL, V, address:{address}")
    }

    #[cfg(test)]
    mod tests {
        use super::hypr_ctrl_v_argument;

        #[test]
        fn ctrl_v_goes_to_the_remembered_address() {
            assert_eq!(hypr_ctrl_v_argument("0xabc"), "CTRL, V, address:0xabc");
        }
    }
}

/// Called when the pointer reaches the dock and before the shortcut focuses it.
#[tauri::command]
pub fn remember_foreground(app: AppHandle) {
    #[cfg(target_os = "windows")]
    imp::remember(&app);
    #[cfg(target_os = "linux")]
    imp_linux::remember(&app);
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let _ = app;
}

/// Focuses the app that was in front before the dock, and pastes into it when asked.
#[tauri::command]
pub async fn return_focus(paste: bool) -> bool {
    #[cfg(target_os = "windows")]
    {
        imp::give_back(paste).await
    }
    #[cfg(target_os = "linux")]
    {
        imp_linux::give_back(paste).await
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = paste;
        false
    }
}

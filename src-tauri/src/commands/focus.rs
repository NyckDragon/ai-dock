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

/// Called when the pointer reaches the dock and before the shortcut focuses it.
#[tauri::command]
pub fn remember_foreground(app: AppHandle) {
    #[cfg(target_os = "windows")]
    imp::remember(&app);
    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

/// Focuses the app that was in front before the dock, and pastes into it when asked.
#[tauri::command]
pub async fn return_focus(paste: bool) -> bool {
    #[cfg(target_os = "windows")]
    {
        imp::give_back(paste).await
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = paste;
        false
    }
}

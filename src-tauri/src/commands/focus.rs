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

#[cfg(target_os = "macos")]
mod imp_macos {
    use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};

    use core_foundation::base::{CFType, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::{CFString, CFStringRef};
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};
    use tauri::AppHandle;

    static PREVIOUS: AtomicI32 = AtomicI32::new(0);
    /// The system dialog comes back every time the prompt API is called, so a denial
    /// has to be remembered for the rest of this process.
    static ACCESSIBILITY_PROMPTED: AtomicBool = AtomicBool::new(false);

    // Events.h. The command flag has to ride on the V events; a bare V after
    // command-down is not a paste in every target.
    const VK_COMMAND: u16 = 0x37;
    const VK_ANSI_V: u16 = 0x09;
    const FLAG_COMMAND: u64 = 0x0010_0000;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const std::ffi::c_void);
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreateKeyboardEvent(source: *mut std::ffi::c_void, virtual_key: u16, key_down: bool) -> *mut std::ffi::c_void;
        fn CGEventSetFlags(event: *mut std::ffi::c_void, flags: u64);
        fn CGEventPostToPid(pid: i32, event: *mut std::ffi::c_void);
    }

    pub fn remember(_app: &AppHandle) {
        let Some(front) = NSWorkspace::sharedWorkspace().frontmostApplication() else {
            return;
        };
        let pid = front.processIdentifier();
        // Our own process is the dock about to take focus, not a paste target.
        if pid > 0 && pid as u32 != std::process::id() {
            PREVIOUS.store(pid, Ordering::Relaxed);
        }
    }

    fn accessibility_trusted() -> bool {
        // SAFETY: the call takes no arguments and does not show a dialog.
        unsafe { AXIsProcessTrusted() != 0 }
    }

    fn prompt_accessibility() {
        // SAFETY: the symbol is the documented prompt key, a process-lifetime CFString.
        let key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
        let value = CFBoolean::true_value().as_CFType();
        let options = CFDictionary::<CFString, CFType>::from_CFType_pairs(&[(key, value)]);
        // SAFETY: the dictionary lives for the call. This is the one prompt.
        unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) };
    }

    fn post_key(pid: i32, key: u16, down: bool, flags: u64) {
        // SAFETY: a null source is the default. The event is released here;
        // a dead pid makes the post fail and nothing else.
        let event = unsafe { CGEventCreateKeyboardEvent(std::ptr::null_mut(), key, down) };
        if event.is_null() {
            return;
        }
        unsafe {
            CGEventSetFlags(event, flags);
            CGEventPostToPid(pid, event);
            CFRelease(event);
        }
    }

    fn post_cmd_v(pid: i32) {
        post_key(pid, VK_COMMAND, true, FLAG_COMMAND);
        post_key(pid, VK_ANSI_V, true, FLAG_COMMAND);
        post_key(pid, VK_ANSI_V, false, FLAG_COMMAND);
        post_key(pid, VK_COMMAND, false, 0);
    }

    pub async fn give_back(paste: bool) -> bool {
        let pid = PREVIOUS.load(Ordering::Relaxed);
        if pid == 0 {
            return false;
        }
        let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) else {
            return false;
        };
        // macOS 14 ignores this flag. Earlier releases drop the request when the
        // caller is not already frontmost; the dock is, but the flag keeps the
        // hand-off working on those releases. Activation itself asks for nothing.
        #[allow(deprecated)]
        let activated = app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);
        if !activated {
            return false;
        }
        if paste {
            let mut trusted = accessibility_trusted();
            if !trusted && !ACCESSIBILITY_PROMPTED.swap(true, Ordering::Relaxed) {
                prompt_accessibility();
                trusted = accessibility_trusted();
            }
            if trusted {
                // The app we just activated needs a moment before it takes the keystroke.
                tokio::time::sleep(std::time::Duration::from_millis(90)).await;
                post_cmd_v(pid);
            }
        }
        true
    }
}

/// Called when the pointer reaches the dock and before the shortcut focuses it.
#[tauri::command]
pub fn remember_foreground(app: AppHandle) {
    #[cfg(target_os = "windows")]
    imp::remember(&app);
    #[cfg(target_os = "macos")]
    imp_macos::remember(&app);
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let _ = app;
}

/// Focuses the app that was in front before the dock, and pastes into it when asked.
#[tauri::command]
pub async fn return_focus(paste: bool) -> bool {
    #[cfg(target_os = "windows")]
    {
        imp::give_back(paste).await
    }
    #[cfg(target_os = "macos")]
    {
        imp_macos::give_back(paste).await
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = paste;
        false
    }
}

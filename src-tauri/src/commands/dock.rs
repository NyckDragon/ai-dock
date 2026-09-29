use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    index: usize,
    name: String,
    width: u32,
    height: u32,
    scale_factor: f64,
}

fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Janela principal não encontrada".to_string())
}

fn boot_log(message: &str) {
    if !cfg!(debug_assertions) {
        return;
    }
    if let Some(dir) = dirs::data_local_dir() {
        let folder = dir.join("AI Dock");
        let _ = std::fs::create_dir_all(&folder);
        let _ = std::fs::write(folder.join("boot.log"), format!("{message}\n"));
    }
}

/// Places the dock window on the chosen edge.
///
/// `height` is the window height the UI needs right now. `anchor_height` is the
/// height of the visible pill: the window top is derived from it, so opening the
/// peek grows the window downward and the pill never moves on screen.
#[allow(clippy::too_many_arguments)]
pub fn place_dock(
    window: &tauri::WebviewWindow,
    side: &str,
    mode: &str,
    monitor_index: Option<usize>,
    height: Option<f64>,
    anchor_height: Option<f64>,
    vertical_offset: Option<f64>,
) -> Result<(), String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let selected_monitor = monitor_index
        .and_then(|index| monitors.get(index).cloned())
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "Monitor não encontrado".to_string())?;

    let scale = window
        .scale_factor()
        .unwrap_or_else(|_| selected_monitor.scale_factor())
        .max(1.0);
    let monitor_pos = selected_monitor.position();
    let monitor_size = selected_monitor.size();
    let work_h = monitor_size.height as f64 / scale;
    let max_h = (work_h - 28.0).max(160.0);

    let expanded = mode == "expanded";
    let logical_width = match mode {
        "expanded" => 360.0,
        "peek" => 338.0,
        "hidden" => 12.0,
        _ => 58.0,
    };
    let logical_height = if expanded {
        560.0_f64.min(max_h)
    } else {
        height.unwrap_or(320.0).clamp(120.0, max_h)
    };
    let anchor = if expanded {
        logical_height
    } else {
        anchor_height.unwrap_or(logical_height).clamp(80.0, logical_height)
    };

    window
        .set_size(LogicalSize::new(logical_width, logical_height))
        .map_err(|e| e.to_string())?;

    let size = window.outer_size().map_err(|e| e.to_string())?;
    let margin = (10.0 * scale).round() as i32;
    // The auto-hide strip touches the screen edge so the mouse can hit it by throwing it there.
    let edge_gap = if mode == "hidden" { 0 } else { margin };
    let x = if side == "left" {
        monitor_pos.x + edge_gap
    } else {
        monitor_pos.x + monitor_size.width as i32 - size.width as i32 - edge_gap
    };

    let offset = vertical_offset.unwrap_or(0.0).clamp(-45.0, 45.0) / 100.0;
    let center = monitor_size.height as f64 / 2.0 + offset * monitor_size.height as f64;
    let anchor_px = anchor * scale;
    let top_limit = margin;
    let bottom_limit = monitor_size.height as i32 - margin - size.height as i32;
    let relative_y = ((center - anchor_px / 2.0).round() as i32)
        .min(bottom_limit)
        .max(top_limit);
    let y = monitor_pos.y + relative_y;

    boot_log(&format!(
        "place_dock side={side} mode={mode} scale={scale} pos={x},{y} logical={logical_width}x{logical_height} anchor={anchor} outer={}x{}",
        size.width, size.height
    ));

    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    Ok(())
}

#[tauri::command]
pub fn get_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let window = main_window(&app)?;
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .iter()
        .enumerate()
        .map(|(index, monitor)| {
            let size = monitor.size();
            MonitorInfo {
                index,
                name: monitor
                    .name()
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| format!("Tela {}", index + 1)),
                width: size.width,
                height: size.height,
                scale_factor: monitor.scale_factor(),
            }
        })
        .collect())
}

/// True while a full-screen app, game or presentation owns the screen.
#[cfg(target_os = "windows")]
fn fullscreen_app_active() -> bool {
    use windows_sys::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };

    let mut state = 0;
    // SAFETY: the API only writes one i32 into the pointer we pass.
    let result = unsafe { SHQueryUserNotificationState(&mut state) };
    result >= 0 && matches!(state, QUNS_BUSY | QUNS_RUNNING_D3D_FULL_SCREEN | QUNS_PRESENTATION_MODE)
}

#[cfg(target_os = "macos")]
fn fullscreen_app_active() -> bool {
    macos_fullscreen::covers_any_monitor()
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn fullscreen_app_active() -> bool {
    false
}

/// Puts the dock back at the top of the always-on-top band.
///
/// `set_always_on_top(true)` is a no-op once the flag is already set, so another
/// topmost app that came forward would stay over the dock. Re-inserting the
/// window at `HWND_TOPMOST` fixes that without moving it or taking focus.
#[cfg(target_os = "windows")]
fn reassert_topmost(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
    };
    let Ok(hwnd) = window.hwnd() else { return };
    // SAFETY: the handle belongs to our own live window; the flags keep size, position and focus.
    unsafe {
        SetWindowPos(
            hwnd.0 as _,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS,
        );
    }
}

/// `set_always_on_top(true)` does not reorder once the level is already floating,
/// so another floating app that came forward stays above the dock. Tauri's
/// always-on-top level is `NSFloatingWindowLevel`; putting that back and ordering
/// front leaves the window inactive and does not move or resize it.
#[cfg(target_os = "macos")]
fn reassert_topmost(window: &tauri::WebviewWindow) {
    use objc2::rc::Retained;
    use objc2_app_kit::{NSFloatingWindowLevel, NSWindow};

    let Ok(ptr) = window.ns_window() else { return };
    // SAFETY: `ns_window()` is our live window, autoreleased for this call.
    // Retaining it keeps the object alive while we reorder. `setLevel` and
    // `orderFrontRegardless` do not make the window key.
    let ns_window = unsafe { Retained::retain(ptr.cast::<NSWindow>()) };
    let Some(ns_window) = ns_window else { return };
    ns_window.setLevel(NSFloatingWindowLevel);
    ns_window.orderFrontRegardless();
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn reassert_topmost(_window: &tauri::WebviewWindow) {}

/// Keeps the dock on top. Returns true when it was hidden for a full-screen app.
#[tauri::command]
pub fn raise_dock(app: AppHandle, hide_on_fullscreen: Option<bool>) -> Result<bool, String> {
    let window = main_window(&app)?;
    if hide_on_fullscreen.unwrap_or(false) && fullscreen_app_active() {
        let _ = window.hide();
        return Ok(true);
    }
    let _ = window.unminimize();
    let _ = window.show();
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    reassert_topmost(&window);
    Ok(false)
}

#[tauri::command]
pub fn focus_dock(app: AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_tray_tooltip(app: AppHandle, text: String) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("main") else {
        return Ok(());
    };
    // Windows truncates tray tooltips at 127 characters.
    let text: String = text.chars().take(120).collect();
    tray.set_tooltip(Some(text)).map_err(|e| e.to_string())
}

/// Tray menu labels in the UI language, plus the notification pause state.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    open: String,
    refresh: String,
    pause: String,
    resume: String,
    settings: String,
    quit: String,
    paused: bool,
}

#[tauri::command]
pub fn set_tray_menu(app: AppHandle, labels: TrayLabels) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let Some(tray) = app.tray_by_id("main") else {
        return Ok(());
    };
    let item = |id: &str, text: &str| MenuItem::with_id(&app, id, text, true, None::<&str>);
    let build = || -> tauri::Result<Menu<tauri::Wry>> {
        let open = item("open", &labels.open)?;
        let refresh = item("refresh", &labels.refresh)?;
        let pause = if labels.paused {
            item("resume", &labels.resume)?
        } else {
            item("pause", &labels.pause)?
        };
        let settings = item("settings", &labels.settings)?;
        let separator = PredefinedMenuItem::separator(&app)?;
        let quit = item("quit", &labels.quit)?;
        Menu::with_items(&app, &[&open, &refresh, &pause, &settings, &separator, &quit])
    };
    let menu = build().map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_dock_state(
    app: AppHandle,
    side: String,
    mode: String,
    monitor_index: Option<usize>,
    height: Option<f64>,
    anchor_height: Option<f64>,
    vertical_offset: Option<f64>,
) -> Result<(), String> {
    place_dock(
        &main_window(&app)?,
        &side,
        &mode,
        monitor_index,
        height,
        anchor_height,
        vertical_offset,
    )
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// A rectangle in the same point space as a display and a window.
#[cfg(any(target_os = "macos", test))]
#[derive(Clone, Copy, Debug)]
struct ScreenRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// True when `window` reaches every edge of `monitor`.
///
/// Eight points of slack absorbs rounding. A zoomed window stays short of the
/// menu bar by more than that, so it does not count; real fullscreen and a
/// borderless game cover the whole display, menu bar included.
#[cfg(any(target_os = "macos", test))]
fn rect_covers_monitor(window: ScreenRect, monitor: ScreenRect) -> bool {
    const TOLERANCE: f64 = 8.0;
    window.x <= monitor.x + TOLERANCE
        && window.y <= monitor.y + TOLERANCE
        && window.x + window.width >= monitor.x + monitor.width - TOLERANCE
        && window.y + window.height >= monitor.y + monitor.height - TOLERANCE
}

/// On-screen windows from other apps. System panels and the Dock are skipped by
/// name because a layer-0 check alone still sees some of them.
#[cfg(target_os = "macos")]
mod macos_fullscreen {
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_graphics::display::{CGDisplay, CGPoint, CGRect, CGSize};
    use core_graphics::window::{
        copy_window_info, kCGNullWindowID, kCGWindowBounds, kCGWindowLayer, kCGWindowListOptionOnScreenOnly,
        kCGWindowOwnerName, kCGWindowOwnerPID,
    };

    use super::{rect_covers_monitor, ScreenRect};

    const IGNORED_OWNERS: [&str; 4] = ["Window Server", "Dock", "Control Center", "Notification Center"];

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGRectMakeWithDictionaryRepresentation(dict: CFDictionaryRef, rect: *mut CGRect) -> bool;
    }

    struct Keys {
        layer: CFString,
        bounds: CFString,
        owner_pid: CFString,
        owner_name: CFString,
    }

    fn keys() -> Keys {
        // SAFETY: the symbols are process-lifetime CFStrings from CoreGraphics.
        unsafe {
            Keys {
                layer: CFString::wrap_under_get_rule(kCGWindowLayer),
                bounds: CFString::wrap_under_get_rule(kCGWindowBounds),
                owner_pid: CFString::wrap_under_get_rule(kCGWindowOwnerPID),
                owner_name: CFString::wrap_under_get_rule(kCGWindowOwnerName),
            }
        }
    }

    /// 0.10.1's `find` returns `ItemRef<*const c_void>` for an untyped dictionary,
    /// not a pointer. The item holds the borrowed value; retaining it lets a
    /// downcast reject the wrong type.
    fn lookup(dict: &CFDictionary, key: &CFString) -> Option<CFType> {
        let value = dict.find(key.as_concrete_TypeRef() as *const std::ffi::c_void)?;
        let ptr: *const std::ffi::c_void = *value;
        if ptr.is_null() {
            None
        } else {
            // SAFETY: the pointer came from a window-info dictionary and is non-null.
            Some(unsafe { CFType::wrap_under_get_rule(ptr as CFTypeRef) })
        }
    }

    fn cf_i64(dict: &CFDictionary, key: &CFString) -> Option<i64> {
        lookup(dict, key)?.downcast::<CFNumber>()?.to_i64()
    }

    fn owner_name(dict: &CFDictionary, key: &CFString) -> Option<String> {
        Some(lookup(dict, key)?.downcast::<CFString>()?.to_string())
    }

    fn window_rect(dict: &CFDictionary, key: &CFString) -> Option<ScreenRect> {
        let bounds = lookup(dict, key)?.downcast::<CFDictionary>()?;
        let mut rect = CGRect {
            origin: CGPoint { x: 0.0, y: 0.0 },
            size: CGSize { width: 0.0, height: 0.0 },
        };
        // SAFETY: a successful downcast means this is a CFDictionary. The out pointer is ours.
        let ok = unsafe { CGRectMakeWithDictionaryRepresentation(bounds.as_concrete_TypeRef(), &mut rect) };
        if !ok {
            return None;
        }
        Some(ScreenRect {
            x: rect.origin.x,
            y: rect.origin.y,
            width: rect.size.width,
            height: rect.size.height,
        })
    }

    fn monitor_rects() -> Vec<ScreenRect> {
        // CGDisplay bounds and kCGWindowBounds share one space: global points,
        // origin at the top-left of the primary display. Comparing in pixels
        // would make a fullscreen window look short of a Retina display.
        let Ok(ids) = CGDisplay::active_displays() else {
            return Vec::new();
        };
        ids.into_iter()
            .map(|id| {
                let bounds = CGDisplay::new(id).bounds();
                ScreenRect {
                    x: bounds.origin.x,
                    y: bounds.origin.y,
                    width: bounds.size.width,
                    height: bounds.size.height,
                }
            })
            .collect()
    }

    pub fn covers_any_monitor() -> bool {
        let monitors = monitor_rects();
        if monitors.is_empty() {
            return false;
        }
        let Some(windows) = copy_window_info(kCGWindowListOptionOnScreenOnly, kCGNullWindowID) else {
            return false;
        };
        let keys = keys();
        let own_pid = std::process::id() as i64;
        for ptr in windows.get_all_values() {
            if ptr.is_null() {
                continue;
            }
            // SAFETY: CGWindowListCopyWindowInfo returns an array of CFDictionaries.
            let dict = unsafe { CFDictionary::wrap_under_get_rule(ptr as CFDictionaryRef) };
            if cf_i64(&dict, &keys.layer) != Some(0) {
                continue;
            }
            if cf_i64(&dict, &keys.owner_pid) == Some(own_pid) {
                continue;
            }
            if owner_name(&dict, &keys.owner_name).is_some_and(|name| IGNORED_OWNERS.contains(&name.as_str())) {
                continue;
            }
            let Some(window) = window_rect(&dict, &keys.bounds) else {
                continue;
            };
            if monitors.iter().any(|monitor| rect_covers_monitor(window, *monitor)) {
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::{rect_covers_monitor, ScreenRect};

    fn rect(x: f64, y: f64, width: f64, height: f64) -> ScreenRect {
        ScreenRect { x, y, width, height }
    }

    #[test]
    fn exact_fullscreen_covers_the_monitor() {
        let monitor = rect(0.0, 0.0, 1920.0, 1080.0);
        assert!(rect_covers_monitor(monitor, monitor));
    }

    #[test]
    fn eight_points_of_slack_still_covers() {
        let monitor = rect(0.0, 0.0, 1920.0, 1080.0);
        assert!(rect_covers_monitor(rect(0.0, 8.0, 1920.0, 1072.0), monitor));
        assert!(rect_covers_monitor(rect(0.0, 0.0, 1912.0, 1080.0), monitor));
    }

    #[test]
    fn nine_points_short_does_not_cover() {
        let monitor = rect(0.0, 0.0, 1920.0, 1080.0);
        assert!(!rect_covers_monitor(rect(0.0, 9.0, 1920.0, 1071.0), monitor));
        assert!(!rect_covers_monitor(rect(0.0, 0.0, 1911.0, 1080.0), monitor));
    }

    #[test]
    fn zoomed_window_stops_short_of_the_menu_bar() {
        let monitor = rect(0.0, 0.0, 1512.0, 982.0);
        let zoomed = rect(0.0, 25.0, 1512.0, 957.0);
        assert!(!rect_covers_monitor(zoomed, monitor));
    }

    #[test]
    fn window_on_another_monitor_does_not_cover() {
        let primary = rect(0.0, 0.0, 1920.0, 1080.0);
        let other = rect(1920.0, 0.0, 1920.0, 1080.0);
        assert!(!rect_covers_monitor(other, primary));
        assert!(rect_covers_monitor(other, other));
    }

    #[test]
    fn larger_window_that_contains_the_monitor_covers_it() {
        let monitor = rect(0.0, 0.0, 1920.0, 1080.0);
        let window = rect(-10.0, -10.0, 1940.0, 1100.0);
        assert!(rect_covers_monitor(window, monitor));
    }
}

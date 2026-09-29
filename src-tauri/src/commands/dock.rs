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

#[cfg(target_os = "linux")]
fn fullscreen_app_active() -> bool {
    // Without Hyprland there is no fullscreen signal. A failed query must not hide the dock.
    super::linux::hyprland::active_window().is_some_and(|window| super::linux::hyprland::hides_dock(&window))
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
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

/// `set_always_on_top` is only a hint on Wayland, so Hyprland floats, pins and
/// raises the live window by its address. Float and pin are sent only when missing.
#[cfg(target_os = "linux")]
fn reassert_topmost(window: &tauri::WebviewWindow) {
    use super::linux::hyprland::{self, Dispatch};

    let _ = window.set_always_on_top(true);
    let Some(client) = hyprland::own_window() else {
        return;
    };
    let Some(address) = hyprland::address(&client) else {
        return;
    };
    if !hyprland::flag(&client, "floating") {
        hyprland::dispatch(Dispatch::Float, address);
    }
    if !hyprland::flag(&client, "pinned") {
        hyprland::dispatch(Dispatch::Pin, address);
    }
    hyprland::dispatch(Dispatch::Top, address);
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
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

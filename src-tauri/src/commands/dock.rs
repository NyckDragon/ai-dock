use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

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

/// 64px cat perched above the pill. The pill stays 58px, flush with the screen
/// edge. Compact width grows by the leftover 6px toward the center; height grows
/// upward. A list wider than the window adds more width toward the center, and
/// the marks above the cat add height. Peek is already wider than the cat.
/// Hidden and expanded add nothing. The image size lives in `src/styles/dock.css`.
const MASCOT_SIZE: f64 = 64.0;
const PILL_WIDTH: f64 = 58.0;
const PEEK_WIDTH: f64 = 338.0;

/// `(width toward center, height above the pill)`.
fn mascot_span(mode: &str, mascot: bool, overlay_height: f64, overlay_width: f64) -> (f64, f64) {
    if !mascot || mode == "expanded" || mode == "hidden" {
        return (0.0, 0.0);
    }
    let overlay_height = overlay_height.max(0.0);
    let overlay_width = overlay_width.max(0.0);
    let cat_extra = MASCOT_SIZE - PILL_WIDTH;
    let width = if mode == "peek" {
        (overlay_width - PEEK_WIDTH).max(0.0)
    } else {
        cat_extra.max(overlay_width - PILL_WIDTH)
    };
    (width, MASCOT_SIZE + overlay_height)
}

/// Window top, in the same pixels as `center`. `rise_px` sits above the anchor,
/// so the pill stays put and the cat grows upward.
fn anchored_top(center: f64, anchor_px: f64, rise_px: f64) -> f64 {
    center - anchor_px / 2.0 - rise_px
}

/// Physical pixels of a logical length at `scale`. The window's real size, not a reading.
fn physical_px(logical: f64, scale: f64) -> i32 {
    (logical * scale).round() as i32
}

/// Where the window goes, in physical pixels.
///
/// Width and height are the logical size about to be applied, times `scale`.
/// The right dock keeps its right edge still, so a wider peek, cat or signal
/// grows left. The left dock keeps its left edge still and grows right.
/// The top follows the pill anchor, so extra height grows up for the cat and
/// down for the peek without moving the pill.
#[allow(clippy::too_many_arguments)]
fn dock_rect(
    side: &str,
    mode: &str,
    origin_x: i32,
    origin_y: i32,
    monitor_width: u32,
    monitor_height: u32,
    scale: f64,
    logical_width: f64,
    logical_height: f64,
    anchor: f64,
    rise: f64,
    vertical_offset: f64,
) -> DockPixels {
    let width = physical_px(logical_width, scale);
    let height = physical_px(logical_height, scale);
    let margin = physical_px(10.0, scale);
    let edge_gap = if mode == "hidden" { 0 } else { margin };
    let x = if side == "left" {
        origin_x + edge_gap
    } else {
        origin_x + monitor_width as i32 - width - edge_gap
    };
    let offset = vertical_offset.clamp(-45.0, 45.0) / 100.0;
    let center = monitor_height as f64 / 2.0 + offset * monitor_height as f64;
    let top_limit = margin;
    let bottom_limit = monitor_height as i32 - margin - height;
    let relative_y = (anchored_top(center, anchor * scale, rise * scale).round() as i32)
        .min(bottom_limit)
        .max(top_limit);
    DockPixels {
        x,
        y: origin_y + relative_y,
        width,
        height,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct DockPixels {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Placement {
    side: String,
    mode: String,
    pixels: DockPixels,
}

fn same_placement(previous: &Placement, side: &str, mode: &str, pixels: DockPixels) -> bool {
    previous.side == side && previous.mode == mode && previous.pixels == pixels
}

/// Last rect sent to the OS. A repeat with the same side, mode, size and
/// position must not touch the window: a needless move drops the cursor and
/// the hover starts again.
static LAST_PLACEMENT: Mutex<Option<Placement>> = Mutex::new(None);

/// Width stays 58 in the collapsed dock unless the cat needs the extra 6px.
fn dock_span(
    mode: &str,
    height: Option<f64>,
    anchor_height: Option<f64>,
    mascot: bool,
    overlay_height: f64,
    overlay_width: f64,
    max_h: f64,
) -> (f64, f64, f64) {
    let (width_extra, rise) = mascot_span(mode, mascot, overlay_height, overlay_width);
    let logical_width = match mode {
        "expanded" => 380.0,
        "peek" => PEEK_WIDTH + width_extra,
        "hidden" => 12.0,
        _ => PILL_WIDTH + width_extra,
    };
    let logical_height = if mode == "expanded" {
        560.0_f64.min(max_h)
    } else {
        (height.unwrap_or(320.0) + rise).clamp(120.0, max_h)
    };
    let anchor = if mode == "expanded" {
        logical_height
    } else {
        anchor_height.unwrap_or(logical_height).clamp(80.0, logical_height)
    };
    (logical_width, logical_height, anchor)
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
    mascot: bool,
    overlay_height: f64,
    overlay_width: f64,
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

    let (logical_width, logical_height, anchor) =
        dock_span(mode, height, anchor_height, mascot, overlay_height, overlay_width, max_h);
    let (_, requested_rise) = mascot_span(mode, mascot, overlay_height, overlay_width);
    let base_height = height.unwrap_or(320.0);
    let rise = if requested_rise == 0.0 {
        0.0
    } else {
        requested_rise.min((logical_height - base_height).max(0.0))
    };

    let pixels = dock_rect(
        side,
        mode,
        monitor_pos.x,
        monitor_pos.y,
        monitor_size.width,
        monitor_size.height,
        scale,
        logical_width,
        logical_height,
        anchor,
        rise,
        vertical_offset.unwrap_or(0.0),
    );
    let remembered = LAST_PLACEMENT.lock().unwrap_or_else(|poison| poison.into_inner());
    if remembered
        .as_ref()
        .is_some_and(|previous| same_placement(previous, side, mode, pixels))
    {
        return Ok(());
    }
    drop(remembered);

    boot_log(&format!(
        "place_dock side={side} mode={mode} scale={scale} pos={},{} size={}x{} logical={logical_width}x{logical_height} anchor={anchor}",
        pixels.x, pixels.y, pixels.width, pixels.height
    ));

    // One geometry update. Reading outer_size after set_size still returns the
    // previous width on Windows, and the right edge then jumps under the cursor.
    apply_rect(window, pixels)?;
    let mut remembered = LAST_PLACEMENT.lock().unwrap_or_else(|poison| poison.into_inner());
    *remembered = Some(Placement {
        side: side.to_string(),
        mode: mode.to_string(),
        pixels,
    });
    drop(remembered);

    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    Ok(())
}

/// Windows applies x, y, width and height together. Other systems set that same
/// size and position without reading the window between the two calls.
#[cfg(target_os = "windows")]
fn apply_rect(window: &tauri::WebviewWindow, pixels: DockPixels) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    };

    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    // SAFETY: the handle belongs to our live window. NOZORDER leaves the band
    // alone; NOACTIVATE keeps the dock from stealing focus.
    let ok = unsafe {
        SetWindowPos(
            hwnd.0 as _,
            std::ptr::null_mut(),
            pixels.x,
            pixels.y,
            pixels.width,
            pixels.height,
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        )
    };
    if ok == 0 {
        Err("SetWindowPos failed".to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_rect(window: &tauri::WebviewWindow, pixels: DockPixels) -> Result<(), String> {
    use tauri::{PhysicalPosition, PhysicalSize};

    window
        .set_size(PhysicalSize::new(pixels.width as u32, pixels.height as u32))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(pixels.x, pixels.y))
        .map_err(|e| e.to_string())
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

#[cfg(target_os = "macos")]
fn fullscreen_app_active() -> bool {
    macos_fullscreen::covers_any_monitor()
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
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

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
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
    mascot: Option<bool>,
    overlay_height: Option<f64>,
    overlay_width: Option<f64>,
) -> Result<(), String> {
    place_dock(
        &main_window(&app)?,
        &side,
        &mode,
        monitor_index,
        height,
        anchor_height,
        vertical_offset,
        mascot.unwrap_or(false),
        overlay_height.unwrap_or(0.0),
        overlay_width.unwrap_or(0.0),
    )
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// One interactive spot in the webview, in physical client pixels.
#[derive(Clone, Copy)]
struct HitRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

struct HitState {
    /// When set, empty window space passes the click through.
    enabled: bool,
    rects: Vec<HitRect>,
}

static HITS: Mutex<HitState> = Mutex::new(HitState {
    enabled: false,
    rects: Vec::new(),
});

/// True when this client point should fall through to the window behind.
///
/// Hidden and expanded docks keep the whole window. A visible dock keeps the
/// pill, the mascot and the open peek; the spare width beside the pill does not.
fn client_passes_through(enabled: bool, rects: &[HitRect], x: i32, y: i32) -> bool {
    enabled && !rects.is_empty() && !rects.iter().any(|rect| hit_contains(*rect, x, y))
}

fn hit_contains(rect: HitRect, x: i32, y: i32) -> bool {
    x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
}

#[derive(Deserialize)]
pub struct DockHitBox {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Remembers which client pixels belong to the pill, the mascot and the open peek.
#[tauri::command]
pub fn set_dock_hits(app: AppHandle, interactive: bool, boxes: Vec<DockHitBox>) -> Result<(), String> {
    let window = main_window(&app)?;
    let scale = window.scale_factor().unwrap_or(1.0).max(1.0);
    let rects = boxes
        .into_iter()
        .filter_map(|hit| {
            let width = (hit.width * scale).round() as i32;
            let height = (hit.height * scale).round() as i32;
            if width <= 0 || height <= 0 {
                return None;
            }
            Some(HitRect {
                x: (hit.x * scale).round() as i32,
                y: (hit.y * scale).round() as i32,
                width,
                height,
            })
        })
        .collect();
    let mut hits = HITS.lock().unwrap_or_else(|poison| poison.into_inner());
    hits.enabled = interactive;
    hits.rects = rects;
    Ok(())
}

#[cfg(target_os = "windows")]
static PREV_WNDPROC: AtomicIsize = AtomicIsize::new(0);
#[cfg(target_os = "windows")]
static HIT_INSTALLED: AtomicBool = AtomicBool::new(false);

/// Subclasses the dock so empty peek width does not eat clicks meant for the app behind it.
#[cfg(target_os = "windows")]
pub fn install_hit_test(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowLongPtrW, GWLP_WNDPROC};

    if HIT_INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }
    let Ok(hwnd) = window.hwnd() else {
        HIT_INSTALLED.store(false, Ordering::SeqCst);
        return;
    };
    // SAFETY: the handle belongs to our live window. The previous proc is restored
    // on every message, and the hook only answers WM_NCHITTEST.
    let previous = unsafe { SetWindowLongPtrW(hwnd.0 as _, GWLP_WNDPROC as _, dock_hit_proc as *const () as _) };
    PREV_WNDPROC.store(previous, Ordering::SeqCst);
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn dock_hit_proc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows_sys::Win32::Foundation::WPARAM,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::LRESULT {
    use windows_sys::Win32::Foundation::{LRESULT, POINT};
    use windows_sys::Win32::Graphics::Gdi::ScreenToClient;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, DefWindowProcW, HTTRANSPARENT, WNDPROC, WM_NCHITTEST,
    };

    if msg == WM_NCHITTEST {
        let x = lparam as i16 as i32;
        let y = (lparam >> 16) as i16 as i32;
        let mut point = POINT { x, y };
        if ScreenToClient(hwnd, &mut point) != 0 {
            let hits = HITS.lock().unwrap_or_else(|poison| poison.into_inner());
            let pass = client_passes_through(hits.enabled, &hits.rects, point.x, point.y);
            drop(hits);
            if pass {
                return HTTRANSPARENT as LRESULT;
            }
        }
    }

    let previous = PREV_WNDPROC.load(Ordering::SeqCst);
    if previous == 0 {
        return DefWindowProcW(hwnd, msg, wparam, lparam);
    }
    let proc: WNDPROC = std::mem::transmute(previous);
    CallWindowProcW(proc, hwnd, msg, wparam, lparam)
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
    use super::{anchored_top, dock_span, rect_covers_monitor, ScreenRect};

    #[test]
    fn mascot_grows_up_and_toward_the_center() {
        let (width, height, anchor) = dock_span("compact", Some(300.0), Some(300.0), false, 0.0, 0.0, 1000.0);
        assert_eq!((width, height, anchor), (58.0, 300.0, 300.0));

        // 64px cat: 6px wider than the 58px pill, and 64px taller above it.
        let (width, height, anchor) = dock_span("compact", Some(300.0), Some(300.0), true, 0.0, 0.0, 1000.0);
        assert_eq!((width, height, anchor), (64.0, 364.0, 300.0));
        assert_eq!(anchored_top(500.0, 300.0, 0.0), 350.0);
        assert_eq!(anchored_top(500.0, 300.0, 64.0), 286.0);

        // Marks and a wide list grow up and toward the center. The anchor stays the pill.
        let (width, height, anchor) = dock_span("compact", Some(300.0), Some(300.0), true, 22.0, 180.0, 1000.0);
        assert_eq!((width, height, anchor), (180.0, 386.0, 300.0));

        let (width, height, _) = dock_span("hidden", Some(300.0), Some(300.0), true, 40.0, 200.0, 1000.0);
        assert_eq!((width, height), (12.0, 300.0));

        let (width, height, _) = dock_span("expanded", Some(260.0), Some(260.0), true, 40.0, 200.0, 1000.0);
        assert_eq!((width, height), (380.0, 560.0));

        // Peek is already wider than the cat. Height still grows upward.
        let (width, height, anchor) = dock_span("peek", Some(560.0), Some(260.0), true, 0.0, 0.0, 2000.0);
        assert_eq!((width, height, anchor), (338.0, 624.0, 260.0));
        let (width, height, anchor) = dock_span("peek", Some(560.0), Some(260.0), true, 18.0, 400.0, 2000.0);
        assert_eq!((width, height, anchor), (400.0, 642.0, 260.0));
    }

    fn placed(
        side: &str,
        mode: &str,
        logical_width: f64,
        logical_height: f64,
        anchor: f64,
        rise: f64,
    ) -> super::DockPixels {
        super::dock_rect(
            side,
            mode,
            0,
            0,
            1920,
            1080,
            1.25,
            logical_width,
            logical_height,
            anchor,
            rise,
            0.0,
        )
    }

    #[test]
    fn growth_uses_the_new_size_and_keeps_the_pill_on_the_edge() {
        let scale = 1.25;
        let gap = super::physical_px(10.0, scale);
        let compact = placed("right", "compact", 64.0, 364.0, 300.0, 64.0);
        let peek = placed("right", "peek", 338.0, 624.0, 300.0, 64.0);
        let signal = placed("right", "compact", 180.0, 386.0, 300.0, 86.0);

        assert_eq!(compact.width, super::physical_px(64.0, scale));
        assert_eq!(compact.height, super::physical_px(364.0, scale));
        assert_eq!(peek.width, super::physical_px(338.0, scale));
        assert_eq!(peek.height, super::physical_px(624.0, scale));

        // Right edge stays. Wider states open to the left.
        assert_eq!(compact.x + compact.width, 1920 - gap);
        assert_eq!(peek.x + peek.width, compact.x + compact.width);
        assert_eq!(signal.x + signal.width, compact.x + compact.width);
        assert!(peek.x < compact.x);
        assert!(signal.x < compact.x);

        // Same anchor and rise: the peek is taller downward, the top does not move.
        assert_eq!(compact.y, peek.y);
        let pill_line = |y: i32, rise: f64| y as f64 + rise * scale;
        assert!((pill_line(compact.y, 64.0) - pill_line(signal.y, 86.0)).abs() < 1.0);

        let left_compact = placed("left", "compact", 64.0, 364.0, 300.0, 64.0);
        let left_peek = placed("left", "peek", 338.0, 624.0, 300.0, 64.0);
        assert_eq!(left_compact.x, gap);
        assert_eq!(left_peek.x, left_compact.x);
        assert!(left_peek.width > left_compact.width);

        let second_monitor = super::dock_rect(
            "right", "compact", 1920, 80, 1920, 1080, scale, 64.0, 364.0, 300.0, 64.0, 0.0,
        );
        assert_eq!(second_monitor.x + second_monitor.width, 1920 + 1920 - gap);
    }

    #[test]
    fn hidden_strip_touches_the_screen_edge() {
        let right = placed("right", "hidden", 12.0, 300.0, 300.0, 0.0);
        let left = placed("left", "hidden", 12.0, 300.0, 300.0, 0.0);
        assert_eq!(right.x + right.width, 1920);
        assert_eq!(left.x, 0);
    }

    #[test]
    fn an_unchanged_placement_is_not_sent_again() {
        let pixels = placed("right", "compact", 64.0, 364.0, 300.0, 64.0);
        let previous = super::Placement {
            side: "right".into(),
            mode: "compact".into(),
            pixels,
        };
        assert!(super::same_placement(&previous, "right", "compact", pixels));
        assert!(!super::same_placement(&previous, "left", "compact", pixels));
        assert!(!super::same_placement(&previous, "right", "peek", pixels));
        let mut moved = pixels;
        moved.width += 1;
        assert!(!super::same_placement(&previous, "right", "compact", moved));
    }

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

    fn spot(x: i32, y: i32, width: i32, height: i32) -> super::HitRect {
        super::HitRect { x, y, width, height }
    }

    #[test]
    fn empty_peek_width_passes_the_click_through() {
        let pill = spot(280, 40, 58, 220);
        let mascot = spot(270, 0, 76, 40);
        let peek = spot(10, 30, 260, 180);
        let spots = [pill, mascot, peek];
        assert!(super::client_passes_through(true, &spots, 400, 80));
        assert!(!super::client_passes_through(true, &spots, 300, 100));
        assert!(!super::client_passes_through(true, &spots, 280, 20));
        assert!(!super::client_passes_through(true, &spots, 20, 40));
        assert!(!super::client_passes_through(false, &spots, 200, 80));
        assert!(!super::client_passes_through(true, &[], 200, 80));
    }
}

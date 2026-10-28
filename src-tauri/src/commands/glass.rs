//! Real blur behind the glass surfaces.
//!
//! The webview cannot see what lies behind its own window, so CSS cannot blur
//! the desktop. Windows can: an acrylic accent blurs whatever sits under a
//! window. That accent fills the whole window rectangle and ignores a window
//! region, so on the dock itself it would blur the full 338px width, the cat
//! included. Instead each glass surface (the pill, the signal list, the open
//! card, the open panel) gets its own small empty native window right under
//! the dock, exactly its size, with Windows 11 rounded corners. The dock paints
//! the tint, the border and the numbers on top. A backdrop never takes the
//! mouse or the focus, and it always sits inside a part of the dock that is
//! interactive anyway.
//!
//! Only Windows has it for now. macOS and Linux keep the CSS glass without blur.

use serde::Deserialize;
use std::sync::Mutex;
use tauri::AppHandle;

/// One glass surface in CSS pixels of the dock's client area.
#[derive(Clone, Debug, Deserialize)]
pub struct GlassBox {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
}

/// How Windows 11 rounds a backdrop's corners.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Corner {
    /// 8px.
    Round,
    /// 4px.
    Small,
    Square,
}

/// A backdrop rectangle in physical client pixels of the dock.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Pane {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
    corner: Corner,
}

struct GlassState {
    enabled: bool,
    panes: Vec<Pane>,
}

static GLASS: Mutex<GlassState> = Mutex::new(GlassState {
    enabled: false,
    panes: Vec::new(),
});

/// Windows rounds a popup by 8px at most. A surface with a larger CSS radius
/// gets a backdrop pulled in from every edge, just enough that the 8px corner
/// stays inside the CSS curve; never less than 1px, so it hides under the border.
fn inset_for(radius: f64, system_radius: f64) -> f64 {
    let gap = (radius - system_radius).max(0.0) * (1.0 - std::f64::consts::FRAC_1_SQRT_2);
    gap.ceil().max(1.0)
}

fn to_pane(glass: &GlassBox, scale: f64) -> Option<Pane> {
    let radius = glass.radius.max(0.0);
    let (corner, system_radius) = if radius >= 8.0 {
        (Corner::Round, 8.0)
    } else if radius >= 4.0 {
        (Corner::Small, 4.0)
    } else {
        (Corner::Square, 0.0)
    };
    let inset = inset_for(radius, system_radius);
    let left = ((glass.x + inset) * scale).round() as i32;
    let top = ((glass.y + inset) * scale).round() as i32;
    let right = ((glass.x + glass.width - inset) * scale).round() as i32;
    let bottom = ((glass.y + glass.height - inset) * scale).round() as i32;
    if right - left < 2 || bottom - top < 2 {
        return None;
    }
    Some(Pane {
        left,
        top,
        width: right - left,
        height: bottom - top,
        corner,
    })
}

/// Turns the blur on or off and sets the surfaces it fills.
#[tauri::command]
pub fn set_dock_glass(app: AppHandle, enabled: bool, boxes: Vec<GlassBox>) -> Result<(), String> {
    use tauri::Manager;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Janela principal não encontrada".to_string())?;
    let scale = window.scale_factor().unwrap_or(1.0).max(1.0);
    let panes = boxes.iter().filter_map(|glass| to_pane(glass, scale)).collect();
    {
        let mut glass = GLASS.lock().unwrap_or_else(|poison| poison.into_inner());
        glass.enabled = enabled;
        glass.panes = panes;
    }
    sync(&app);
    Ok(())
}

/// Moves, resizes, restacks or hides the backdrops to match the dock right now.
/// Safe to call from any thread; the work runs on the main thread.
pub fn sync(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || windows_backdrop::sync_on_main(&handle));
    }
    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

#[cfg(target_os = "windows")]
mod windows_backdrop {
    use super::{Corner, Pane, GLASS};
    use std::ffi::c_void;
    use std::sync::Mutex;
    use tauri::{AppHandle, Manager};
    use windows_sys::core::BOOL;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress, LoadLibraryA};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, GetWindowRect, IsWindowVisible, RegisterClassW, SetWindowPos, ShowWindow,
        HTTRANSPARENT, MA_NOACTIVATE, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_SHOWWINDOW, SW_HIDE, WM_ERASEBKGND,
        WM_MOUSEACTIVATE, WM_NCHITTEST, WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
    };

    /// One backdrop per surface, reused across updates. Main thread only.
    static BACKDROPS: Mutex<Vec<isize>> = Mutex::new(Vec::new());

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe extern "system" fn backdrop_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match msg {
            WM_NCHITTEST => HTTRANSPARENT as LRESULT,
            WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
            // Nothing is painted: the acrylic shows through the whole window.
            WM_ERASEBKGND => 1,
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    #[repr(C)]
    struct AccentPolicy {
        accent_state: u32,
        accent_flags: u32,
        gradient_color: u32,
        animation_id: u32,
    }

    #[repr(C)]
    struct CompositionData {
        attribute: u32,
        data: *mut c_void,
        size: usize,
    }

    const WCA_ACCENT_POLICY: u32 = 19;
    const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;
    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;

    /// Acrylic through the undocumented but long-stable SetWindowCompositionAttribute,
    /// the same call window-vibrancy makes. The tint is almost clear: the dock's CSS
    /// fill on top sets the color and the strength.
    unsafe fn apply_acrylic(hwnd: HWND) {
        type SetWca = unsafe extern "system" fn(HWND, *mut CompositionData) -> BOOL;
        let module = LoadLibraryA(c"user32.dll".as_ptr().cast());
        if module.is_null() {
            return;
        }
        let Some(proc) = GetProcAddress(module, c"SetWindowCompositionAttribute".as_ptr().cast()) else {
            return;
        };
        let set_wca: SetWca = std::mem::transmute(proc);
        let mut policy = AccentPolicy {
            accent_state: ACCENT_ENABLE_ACRYLICBLURBEHIND,
            accent_flags: 0,
            // ABGR. Acrylic ignores a fully clear tint, so alpha is 1.
            gradient_color: 0x0100_0000,
            animation_id: 0,
        };
        let mut data = CompositionData {
            attribute: WCA_ACCENT_POLICY,
            data: (&mut policy as *mut AccentPolicy).cast(),
            size: std::mem::size_of::<AccentPolicy>(),
        };
        set_wca(hwnd, &mut data);
    }

    /// Windows 11 rounds the window, acrylic included. Older systems ignore it.
    unsafe fn set_corner(hwnd: HWND, corner: Corner) {
        // DWMWCP_ROUND, DWMWCP_ROUNDSMALL, DWMWCP_DONOTROUND.
        let preference: u32 = match corner {
            Corner::Round => 2,
            Corner::Small => 3,
            Corner::Square => 1,
        };
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            (&preference as *const u32).cast(),
            std::mem::size_of::<u32>() as u32,
        );
    }

    unsafe fn create_backdrop() -> Option<HWND> {
        let class = wide("AIDockGlassBackdrop");
        let title = wide("AI Dock glass");
        let instance = GetModuleHandleW(std::ptr::null());
        let class_info = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(backdrop_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: std::ptr::null_mut(),
            hCursor: std::ptr::null_mut(),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class.as_ptr(),
        };
        // A second registration fails harmlessly; the class already exists.
        RegisterClassW(&class_info);
        let hwnd = CreateWindowExW(
            WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST,
            class.as_ptr(),
            title.as_ptr(),
            WS_POPUP,
            0,
            0,
            1,
            1,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        );
        if hwnd.is_null() {
            return None;
        }
        apply_acrylic(hwnd);
        Some(hwnd)
    }

    pub(super) fn sync_on_main(app: &AppHandle) {
        let panes: Vec<Pane> = {
            let glass = GLASS.lock().unwrap_or_else(|poison| poison.into_inner());
            if glass.enabled {
                glass.panes.clone()
            } else {
                Vec::new()
            }
        };
        let dock = app
            .get_webview_window("main")
            .and_then(|window| window.hwnd().ok())
            .map(|hwnd| hwnd.0 as HWND);
        let mut backdrops = BACKDROPS.lock().unwrap_or_else(|poison| poison.into_inner());
        // SAFETY: every handle belongs to a live window of this process, and this
        // runs on the main thread that owns them all.
        unsafe {
            let mut rect = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            let dock_ok = dock.is_some_and(|dock| IsWindowVisible(dock) != 0 && GetWindowRect(dock, &mut rect) != 0);
            let shown = if dock_ok { panes.len() } else { 0 };
            while backdrops.len() < shown {
                let Some(hwnd) = create_backdrop() else { break };
                backdrops.push(hwnd as isize);
            }
            for (index, raw) in backdrops.iter().enumerate() {
                let hwnd = *raw as HWND;
                let (Some(pane), Some(dock)) = (panes.get(index).filter(|_| index < shown), dock) else {
                    ShowWindow(hwnd, SW_HIDE);
                    continue;
                };
                set_corner(hwnd, pane.corner);
                // Directly under the dock in the topmost band.
                SetWindowPos(
                    hwnd,
                    dock,
                    rect.left + pane.left,
                    rect.top + pane.top,
                    pane.width,
                    pane.height,
                    SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn glass(x: f64, y: f64, width: f64, height: f64, radius: f64) -> GlassBox {
        GlassBox {
            x,
            y,
            width,
            height,
            radius,
        }
    }

    #[test]
    fn the_8px_system_corner_stays_inside_a_larger_css_curve() {
        // Pill: 18px CSS radius, so the backdrop comes in 3px on every edge.
        let pill = to_pane(&glass(280.0, 74.0, 58.0, 300.0, 18.0), 1.0).unwrap();
        assert_eq!(
            pill,
            Pane {
                left: 283,
                top: 77,
                width: 52,
                height: 294,
                corner: Corner::Round
            }
        );
        // Open panel: 20px radius, 4px in.
        assert_eq!(to_pane(&glass(0.0, 0.0, 380.0, 560.0, 20.0), 1.0).unwrap().left, 4);
        // Signal list: 8px radius matches the system corner, 1px under the border.
        assert_eq!(to_pane(&glass(10.0, 10.0, 100.0, 26.0, 8.0), 1.0).unwrap().left, 11);
    }

    #[test]
    fn panes_scale_with_the_display() {
        let pane = to_pane(&glass(280.0, 74.0, 58.0, 300.0, 18.0), 1.5).unwrap();
        assert_eq!((pane.left, pane.top, pane.width, pane.height), (425, 116, 78, 441));
    }

    #[test]
    fn small_radii_pick_smaller_corners_and_tiny_boxes_are_dropped() {
        assert_eq!(to_pane(&glass(0.0, 0.0, 40.0, 40.0, 5.0), 1.0).unwrap().corner, Corner::Small);
        assert_eq!(to_pane(&glass(0.0, 0.0, 40.0, 40.0, -3.0), 1.0).unwrap().corner, Corner::Square);
        assert!(to_pane(&glass(0.0, 0.0, 3.0, 40.0, 0.0), 1.0).is_none());
    }
}

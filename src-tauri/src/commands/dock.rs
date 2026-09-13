use serde::Serialize;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager};

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

pub fn place_dock(
    window: &tauri::WebviewWindow,
    side: &str,
    expanded: bool,
    monitor_index: Option<usize>,
    compact_height: Option<f64>,
) -> Result<(), String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let selected_monitor = monitor_index
        .and_then(|index| monitors.get(index).cloned())
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "Monitor não encontrado".to_string())?;

    let scale = selected_monitor.scale_factor().max(1.0);
    let monitor_pos = selected_monitor.position();
    let monitor_size = selected_monitor.size();
    let work_w = monitor_size.width as f64 / scale;
    let work_h = monitor_size.height as f64 / scale;
    let origin_x = monitor_pos.x as f64 / scale;
    let origin_y = monitor_pos.y as f64 / scale;

    let logical_width = if expanded { 360.0 } else { 58.0 };
    let logical_height = if expanded {
        560.0_f64.min(work_h - 28.0).max(380.0)
    } else {
        compact_height
            .unwrap_or(236.0)
            .clamp(210.0, (work_h - 28.0).max(210.0))
    };

    let x = if side == "left" {
        origin_x + 10.0
    } else {
        origin_x + work_w - logical_width - 10.0
    };
    let y = origin_y + ((work_h - logical_height) / 2.0).max(10.0);

    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
    window
        .set_size(LogicalSize::new(logical_width, logical_height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(LogicalPosition::new(x, y))
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

#[tauri::command]
pub fn raise_dock(app: AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    let _ = window.unminimize();
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_dock_state(
    app: AppHandle,
    side: String,
    expanded: bool,
    monitor_index: Option<usize>,
    compact_height: Option<f64>,
) -> Result<(), String> {
    place_dock(&main_window(&app)?, &side, expanded, monitor_index, compact_height)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

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
    if let Some(dir) = dirs::data_local_dir() {
        let folder = dir.join("AI Dock");
        let _ = std::fs::create_dir_all(&folder);
        let _ = std::fs::write(folder.join("boot.log"), format!("{message}\n"));
    }
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
    let work_h = monitor_size.height as f64 / scale;

    let logical_width = if expanded { 360.0 } else { 58.0 };
    let logical_height = if expanded {
        560.0_f64.min(work_h - 28.0).max(380.0)
    } else {
        compact_height
            .unwrap_or(300.0)
            .clamp(280.0, (work_h - 28.0).max(280.0))
    };

    let width = (logical_width * scale).round() as u32;
    let height = (logical_height * scale).round() as u32;
    let margin = (10.0 * scale).round() as i32;
    let x = if side == "left" {
        monitor_pos.x + margin
    } else {
        monitor_pos.x + monitor_size.width as i32 - width as i32 - margin
    };
    let y = monitor_pos.y + ((monitor_size.height as i32 - height as i32) / 2).max(margin);

    boot_log(&format!(
        "place_dock side={side} expanded={expanded} scale={scale} pos={x},{y} size={width}x{height}"
    ));

    let _ = window.set_always_on_top(true);
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
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
    let _ = window.show();
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
    place_dock(
        &main_window(&app)?,
        &side,
        expanded,
        monitor_index,
        compact_height,
    )
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

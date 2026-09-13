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

#[tauri::command]
pub fn get_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Janela principal não encontrada".to_string())?;

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
pub fn set_dock_state(
    app: AppHandle,
    side: String,
    expanded: bool,
    monitor_index: Option<usize>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Janela principal não encontrada".to_string())?;

    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let selected_monitor = monitor_index
        .and_then(|index| monitors.get(index).cloned())
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "Monitor não encontrado".to_string())?;

    let scale = selected_monitor.scale_factor();
    let monitor_pos = selected_monitor.position();
    let monitor_size = selected_monitor.size();

    let logical_width = if expanded { 372.0 } else { 58.0 };
    let logical_height = if expanded { 650.0 } else { 318.0 };
    let width = (logical_width * scale) as u32;
    let height = (logical_height * scale) as u32;
    let margin = (10.0 * scale) as i32;

    let x = if side == "left" {
        monitor_pos.x + margin
    } else {
        monitor_pos.x + monitor_size.width as i32 - width as i32 - margin
    };
    let y = monitor_pos.y + ((monitor_size.height as i32 - height as i32) / 2).max(margin);

    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.set_skip_taskbar(true).map_err(|e| e.to_string())?;
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

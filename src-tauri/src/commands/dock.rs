use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

#[tauri::command]
pub fn set_dock_state(app: AppHandle, side: String, expanded: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Janela principal não encontrada".to_string())?;

    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "Monitor não encontrado".to_string())?;

    let scale = monitor.scale_factor();
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();

    let logical_width = if expanded { 372.0 } else { 58.0 };
    let logical_height = if expanded { 650.0 } else { 210.0 };
    let width = (logical_width * scale) as u32;
    let height = (logical_height * scale) as u32;
    let margin = (10.0 * scale) as i32;

    let x = if side == "left" {
        monitor_pos.x + margin
    } else {
        monitor_pos.x + monitor_size.width as i32 - width as i32 - margin
    };
    let y = monitor_pos.y + ((monitor_size.height as i32 - height as i32) / 2).max(margin);

    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;

    Ok(())
}

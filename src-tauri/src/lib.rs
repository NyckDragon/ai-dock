use tauri::Manager;

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::dock::get_monitors,
            commands::dock::set_dock_state,
            commands::obsidian::scan_obsidian_prompts,
            commands::providers::get_provider_usage,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
                let _ = window.set_decorations(false);
                let _ = window.set_resizable(false);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AI Dock");
}

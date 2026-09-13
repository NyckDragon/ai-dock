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
            commands::providers::provider_setup_status,
            commands::providers::open_provider_setup,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
                let _ = window.set_decorations(false);
                let _ = window.set_resizable(false);
                let _ = window.set_skip_taskbar(true);

                let keep_topmost = window.clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::Focused(false)) {
                        let _ = keep_topmost.set_always_on_top(true);
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AI Dock");
}

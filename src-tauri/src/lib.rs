use tauri::Manager;

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::dock::get_monitors,
            commands::dock::set_dock_state,
            commands::dock::raise_dock,
            commands::dock::quit_app,
            commands::obsidian::scan_obsidian_prompts,
            commands::providers::get_provider_usage,
            commands::providers::provider_setup_status,
            commands::providers::install_provider_cli,
            commands::cli::uninstall_provider_cli,
            commands::providers::open_provider_setup,
            commands::claude_web::claude_web_status,
            commands::claude_web::set_claude_web_session,
            commands::claude_web::clear_claude_web_session,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
                let _ = window.set_decorations(false);
                let _ = window.set_resizable(false);
                let _ = window.set_skip_taskbar(true);

                let keep_topmost = window.clone();
                window.on_window_event(move |event| {
                    if matches!(
                        event,
                        tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
                    ) {
                        let _ = keep_topmost.set_always_on_top(true);
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AI Dock");
}

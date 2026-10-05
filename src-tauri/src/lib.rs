use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

mod commands;
mod kora;

fn reveal(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
    }
}

/// Tells the UI what the tray asked for: "open", "refresh" or "settings".
fn tray_action(app: &AppHandle, action: &str) {
    reveal(app);
    let _ = app.emit("tray-action", action.to_string());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray_action(app, "open");
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            commands::dock::get_monitors,
            commands::dock::set_dock_state,
            commands::dock::raise_dock,
            commands::dock::focus_dock,
            commands::dock::set_tray_tooltip,
            commands::dock::set_tray_menu,
            commands::dock::quit_app,
            commands::focus::remember_foreground,
            commands::focus::return_focus,
            commands::obsidian::scan_obsidian_prompts,
            commands::providers::get_provider_usage,
            commands::activity::get_provider_activity,
            commands::providers::provider_setup_status,
            commands::providers::install_provider_cli,
            commands::cli::uninstall_provider_cli,
            commands::providers::open_provider_setup,
            commands::claude_web::claude_web_status,
            commands::claude_web::set_claude_web_session,
            commands::claude_web::clear_claude_web_session,
            commands::claude_web::claude_login,
            commands::claude_web::set_web_user_agent,
            commands::status::get_provider_status,
            commands::costs::get_local_costs,
            commands::status::open_status_page,
            kora::kora_status,
            kora::kora_list_tasks,
            kora::kora_list_jobs,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
                let _ = window.set_resizable(false);
                let _ = window.set_skip_taskbar(true);
                let _ = window.center();
                let _ = window.show();
                let _ = window.set_always_on_top(true);

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

            let open = MenuItem::with_id(app, "open", "Abrir painel", true, None::<&str>)?;
            let refresh = MenuItem::with_id(app, "refresh", "Atualizar uso", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Configurações", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Encerrar AI Dock", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &refresh, &settings, &separator, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("AI Dock")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    // Pausing notifications happens in the background, without opening the dock.
                    action @ ("pause" | "resume") => {
                        let _ = app.emit("tray-action", action.to_string());
                    }
                    action => tray_action(app, action),
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        tray_action(tray.app_handle(), "open");
                    }
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            let _ = tray.build(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AI Dock");
}

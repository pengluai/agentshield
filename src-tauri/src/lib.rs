mod commands;
mod rule_updater;
mod types;

use commands::*;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

fn startup_log_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".agentshield").join("startup.log"))
}

fn append_startup_log(line: &str) {
    let Some(path) = startup_log_path() else {
        return;
    };

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

fn restore_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn prefers_chinese_locale() -> bool {
    std::env::var("LANG")
        .map(|value| value.to_ascii_lowercase())
        .map(|value| value.starts_with("zh") || value.contains("zh_"))
        .unwrap_or(false)
}

#[tauri::command]
fn force_quit_app<R: Runtime>(app: AppHandle<R>) {
    app.exit(0);
}

#[cfg(desktop)]
fn setup_system_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let (show_label, quit_label) = if prefers_chinese_locale() {
        ("显示 AgentShield", "退出")
    } else {
        ("Show AgentShield", "Quit")
    };
    let show_item = MenuItem::with_id(app, "tray_show", show_label, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "tray_quit", quit_label, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show_item, &separator, &quit_item])?;

    let mut tray_builder = TrayIconBuilder::with_id("agentshield-tray")
        .menu(&menu)
        .tooltip("AgentShield 智盾")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show" => restore_main_window(app),
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                restore_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }

    let _ = tray_builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    append_startup_log("[startup] run() entered");
    let protection_service = protection::ProtectionService::new();
    let runtime_guard_service = runtime_guard::RuntimeGuardService::new();
    let app_builder = tauri::Builder::default()
        .manage(protection_service.clone())
        .manage(runtime_guard_service.clone())
        // Keep launch path stable first; autostart is configured by user after first-run.
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            scan::scan_full,
            scan::scan_quick,
            scan::scan_cancel,
            scan::get_last_scan_report,
            scan::fix_issue,
            scan::fix_all,
            scan::detect_ai_tools,
            scan::scan_exposed_keys,
            scan::scan_installed_mcps,
            scan::reveal_path_in_finder,
            install::detect_system,
            install::get_openclaw_status,
            install::get_openclaw_skills,
            install::get_openclaw_mcps,
            install::install_openclaw_cmd,
            install::uninstall_openclaw_cmd,
            install::update_openclaw_cmd,
            install::check_openclaw_latest_version,
            vault::vault_list_keys,
            vault::vault_add_key,
            vault::vault_delete_key,
            vault::vault_get_key,
            vault::vault_reveal_key_value,
            vault::vault_scan_exposed_keys,
            vault::vault_import_exposed_key,
            store::get_store_catalog,
            store::search_store,
            store::list_installed_items,
            store::resolve_install_target_paths,
            store::install_store_item,
            store::uninstall_item,
            store::preview_global_cleanup,
            store::execute_global_cleanup,
            store::get_global_cleanup_report,
            store::check_installed_updates,
            store::update_installed_item,
            store::batch_update_items,
            store::refresh_catalog,
            store::generate_manual_fix_guide,
            notification::get_notifications,
            notification::mark_notification_read,
            notification::create_notification,
            notification::delete_notification,
            notification::clear_notifications,
            notification::get_unread_count,
            notification::get_rule_update_status,
            notification::check_rule_update,
            notification::download_and_apply_rules,
            runtime_settings::open_macos_permission_settings,
            protection::get_protection_status,
            protection::configure_protection,
            protection::list_protection_incidents,
            protection::clear_protection_incidents,
            runtime_guard::get_runtime_guard_status,
            runtime_guard::list_runtime_guard_components,
            runtime_guard::sync_runtime_guard_components,
            runtime_guard::update_component_trust_state,
            runtime_guard::update_component_network_policy,
            runtime_guard::list_runtime_guard_events,
            runtime_guard::list_runtime_guard_approval_requests,
            runtime_guard::request_runtime_guard_action_approval,
            runtime_guard::resolve_runtime_guard_approval_request,
            runtime_guard::clear_runtime_guard_events,
            runtime_guard::list_runtime_guard_sessions,
            runtime_guard::get_runtime_guard_policy,
            runtime_guard::update_runtime_guard_policy,
            runtime_guard::run_runtime_guard_poll_now,
            runtime_guard::launch_runtime_guard_component,
            runtime_guard::terminate_runtime_guard_session,
            force_quit_app,
            license::activate_license,
            license::check_license_status,
            license::deactivate_license,
            license::start_trial,
            ai_orchestrator::test_ai_connection,
            ai_orchestrator::ai_diagnose_error,
            ai_orchestrator::execute_install_step,
            semantic_guard::get_semantic_guard_status,
            semantic_guard::configure_semantic_guard,
            semantic_guard::clear_semantic_guard_key,
        ])
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    append_startup_log("[window] mac close requested -> force exit");
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(move |app| {
            append_startup_log("[startup] setup begin");
            append_startup_log("[startup] setup: checking main window");
            if app.get_webview_window("main").is_none() {
                eprintln!("[AgentShield] main window not found during setup");
                append_startup_log("[startup] main window missing in setup");
            }
            append_startup_log("[startup] setup: main window check done");

            #[cfg(desktop)]
            {
                append_startup_log("[startup] setup: tray init begin");
                if let Err(error) = setup_system_tray(app.handle()) {
                    eprintln!("[AgentShield] tray setup failed: {error}");
                    append_startup_log(&format!("[startup] tray setup failed: {error}"));
                }
                append_startup_log("[startup] setup: tray init done");
            }
            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
                }
            }
            append_startup_log("[startup] setup: protection init begin");
            if let Err(error) = protection::initialize(app.handle(), protection_service.clone()) {
                eprintln!("[AgentShield] protection initialization failed: {error}");
                append_startup_log(&format!(
                    "[startup] protection initialization failed: {error}"
                ));
            }
            append_startup_log("[startup] setup: protection init done");
            append_startup_log("[startup] setup: runtime guard init begin");
            if let Err(error) =
                runtime_guard::initialize(app.handle().clone(), runtime_guard_service.clone())
            {
                eprintln!("[AgentShield] runtime guard initialization failed: {error}");
                append_startup_log(&format!(
                    "[startup] runtime guard initialization failed: {error}"
                ));
            }
            append_startup_log("[startup] setup: runtime guard init done");
            append_startup_log("[startup] setup finished");
            Ok(())
        });

    match app_builder.run(tauri::generate_context!()) {
        Ok(_) => append_startup_log("[startup] app exited cleanly"),
        Err(error) => {
            append_startup_log(&format!("[startup] tauri run failed: {error}"));
            panic!("error while running tauri application: {error}");
        }
    }
}

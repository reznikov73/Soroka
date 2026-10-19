#![allow(linker_messages)]

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod ai;
pub mod commands;
pub mod ics;
pub mod mail;
pub mod settings;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::MailState::default())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::{apply_acrylic, apply_mica};
                if let Some(window) = app.get_webview_window("main") {
                    // Win11 — Mica; Win10 — фолбэк на акрил
                    if apply_mica(&window, Some(true)).is_err() {
                        let _ = apply_acrylic(&window, Some((28, 30, 36, 180)));
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::app_info,
            commands::load_cache,
            commands::sync_inbox,
            commands::get_messages,
            commands::get_folders,
            commands::get_settings,
            commands::save_settings,
            commands::reset_settings,
            commands::translate_message,
            commands::send_mail,
            commands::sync_folder,
            commands::load_folder,
            commands::get_unread_counts,
            commands::refresh_unread,
            commands::get_message_body,
            commands::save_attachment,
            commands::set_seen,
            commands::analyze_message,
            commands::get_analyses,
            commands::set_flagged,
            commands::move_to_spam,
            commands::export_event_ics,
            commands::get_calendar_events,
            commands::add_calendar_event,
            commands::delete_calendar_event,
            commands::draft_reply,
            commands::improve_text,
            commands::mail_provider_presets,
            commands::mail_account_status,
            commands::get_accounts,
            commands::mail_account_details,
            commands::set_window_theme,
            commands::save_mail_account
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

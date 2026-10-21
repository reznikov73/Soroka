#![allow(linker_messages)]

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod ai;
pub mod commands;
pub mod ics;
pub mod mail;
pub mod settings;


/// Геометрия главного окна — TASK-023 (пункт 6).
///
/// Хранится отдельно от настроек: `%APPDATA%\Soroka\window.json`.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
struct WinGeom {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    maximized: bool,
}

fn geom_path() -> Option<std::path::PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(
        std::path::PathBuf::from(appdata)
            .join("Soroka")
            .join("window.json"),
    )
}

fn load_geom() -> Option<WinGeom> {
    let p = geom_path()?;
    let raw = std::fs::read_to_string(p).ok()?;
    serde_json::from_str::<WinGeom>(&raw).ok()
}

/// Сохраняет позицию и размер окна (в логических пикселях).
fn save_geom(window: &tauri::WebviewWindow) {
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let scale = window.scale_factor().unwrap_or(1.0);
    let Ok(pos) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    let g = WinGeom {
        x: pos.x as f64 / scale,
        y: pos.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
        maximized,
    };
    if let Some(p) = geom_path() {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string(&g) {
            let _ = std::fs::write(p, json);
        }
    }
}

/// Файловые логи: `%APPDATA%\Soroka\logs\soroka.log.<дата>`.
/// Раньше логов не было вовсе — в release консоли нет, и ошибки терялись.
fn init_logs() {
    let dir = std::env::var("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("Soroka")
        .join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let file = tracing_appender::rolling::daily(&dir, "soroka.log");
    let _ = tracing_subscriber::fmt()
        .with_writer(file)
        .with_ansi(false)
        .with_target(false)
        .with_max_level(tracing::Level::INFO)
        .try_init();
    std::panic::set_hook(Box::new(|info| {
        tracing::error!("ПАНИКА: {info}");
    }));
    tracing::info!("POS Mail {}: старт", env!("CARGO_PKG_VERSION"));
}

/// Иконка в трее: открыть, проверить почту, выход (TASK-037).
#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{Emitter, Manager};

    let open = MenuItemBuilder::with_id("open", "Открыть POS Mail").build(app)?;
    let check = MenuItemBuilder::with_id("check", "Проверить почту").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Выход").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&open, &check, &quit])
        .build()?;
    let mut builder = TrayIconBuilder::with_id("posmail")
        .tooltip("POS Mail")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "check" => {
                let _ = app.emit("tray-check-mail", ());
            }
            "quit" => {
                let _ = app.emit("tray-quit", ());
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logs();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::MailState::default())
        .setup(|app| {
            use tauri::{WebviewUrl, WebviewWindowBuilder};

            // Окно создаём сами: позиция и размер восстанавливаются из window.json (TASK-023).
            // TASK-037: прозрачность убрана — стекло заметно тормозило окно.
            let transparent = false;
            let geom = load_geom();
            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("POS Mail")
                .min_inner_size(960.0, 600.0)
                .decorations(false)
                .shadow(true)
                .transparent(transparent)
                .theme(Some(tauri::Theme::Dark));
            builder = match geom {
                Some(g) => builder
                    .inner_size(g.width.max(960.0), g.height.max(600.0))
                    .position(if g.maximized { 40.0 } else { g.x }, if g.maximized { 40.0 } else { g.y }),
                None => builder.inner_size(1280.0, 800.0),
            };
            let window = builder.build()?;

            if let Some(g) = geom {
                if g.maximized {
                    let _ = window.maximize();
                } else {
                    // Если окно оказалось за пределами всех мониторов — центрируем.
                    let inside = window
                        .available_monitors()
                        .map(|ms| {
                            let cx = g.x as i32 + (g.width as i32) / 2;
                            let cy = g.y as i32 + (g.height as i32) / 2;
                            ms.iter().any(|m| {
                                let p = m.position();
                                let s = m.size();
                                cx >= p.x
                                    && cx < p.x + s.width as i32
                                    && cy >= p.y
                                    && cy < p.y + s.height as i32
                            })
                        })
                        .unwrap_or(true);
                    if !inside {
                        let _ = window.center();
                    }
                }
            }

            let w = window.clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                    save_geom(&w);
                }
            });

            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::{apply_acrylic, apply_mica};
                if transparent {
                    // Win11 — Mica; Win10 — фолбэк на акрил
                    if apply_mica(&window, Some(true)).is_err() {
                        let _ = apply_acrylic(&window, Some((28, 30, 36, 180)));
                    }
                }
            }
            let _ = &window;
            if let Err(err) = setup_tray(app) {
                tracing::warn!("трей не создан: {err}");
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
            commands::refresh_folders,
            commands::message_recipients,
            commands::empty_trash_account,
            commands::move_messages,
            commands::get_settings,
            commands::apply_appearance,
            commands::save_draft,
            commands::get_drafts,
            commands::delete_draft,
            commands::save_settings,
            commands::reset_settings,
            commands::translate_message,
            commands::get_folder_stats,
        commands::search_messages,
            commands::delete_message,
            commands::restore_from_spam,
            commands::empty_trash,
            commands::send_mail,
            commands::sync_folder,
            commands::load_folder,
            commands::get_unread_counts,
            commands::refresh_unread,
            commands::get_message_body,
            commands::save_attachment,
        commands::save_all_attachments,
        commands::attachment_preview,
        commands::open_path,
        commands::reveal_path,
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
            commands::save_mail_account,
            commands::get_contacts,
            commands::save_contact,
            commands::delete_contact,
            commands::delete_messages,
            commands::mark_messages_seen,
            commands::mark_messages_flagged,
            commands::suggest_addresses,
            commands::import_contacts_text,
            commands::export_contacts_file,
            commands::contact_draft_by_email,
            commands::suggest_contacts,
            commands::contact_stats,
            commands::improve_signature
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

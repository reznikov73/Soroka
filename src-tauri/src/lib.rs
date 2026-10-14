#![allow(linker_messages)]

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod ai;
pub mod commands;
pub mod mail;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![commands::ping, commands::app_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

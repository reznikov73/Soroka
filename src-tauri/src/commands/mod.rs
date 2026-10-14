use tauri::AppHandle;

/// Проверка живости бэкенда: возвращает ok и текущее время (unix, сек).
#[tauri::command]
pub async fn ping() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "ok": true,
        "time": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs(),
    }))
}

/// Информация о приложении: имя, версия (из tauri.conf.json) и git-хеш (из build.rs).
#[tauri::command]
pub fn app_info(app: AppHandle) -> serde_json::Value {
    let p = app.package_info();
    serde_json::json!({
        "name": p.name,
        "version": p.version.to_string(),
        "git_hash": env!("SOROKA_GIT_HASH"),
    })
}
use crate::mail::body;
use crate::mail::imap::{self, FolderInfo, MessageHeader};
use crate::mail::smtp;
use crate::mail::store::Store;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Состояние почты: последние загруженные заголовки, папки и счётчик.
#[derive(Default)]
pub struct MailState {
    pub messages: Mutex<Vec<MessageHeader>>,
    pub folders: Mutex<Vec<FolderInfo>>,
    pub total: Mutex<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncPayload {
    pub total: u32,
    pub fetched: u32,
    /// true — сеть недоступна, показан кэш.
    pub offline: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CacheInfo {
    pub total: u32,
    pub fetched: u32,
}

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

/// Мгновенный старт из кэша: заполняет состояние, если кэш есть.
#[tauri::command]
pub fn load_cache(app: AppHandle) -> Result<Option<CacheInfo>, String> {
    let store = Store::open_default().map_err(|e| e.to_string())?;
    let cached = store.load().map_err(|e| e.to_string())?;
    match cached {
        None => Ok(None),
        Some(c) => {
            let fetched = c.messages.len() as u32;
            let total = c.total;
            {
                let st = app.state::<MailState>();
                *st.messages.lock().map_err(|_| "state: мьютекс повреждён")? = c.messages;
                *st.folders.lock().map_err(|_| "state: мьютекс повреждён")? = c.folders;
                *st.total.lock().map_err(|_| "state: мьютекс повреждён")? = total;
            }
            Ok(Some(CacheInfo { total, fetched }))
        }
    }
}

/// Синхронизация INBOX: почта -> кэш -> состояние + событие sync-finished.
/// При ошибке сети/авторизации показывается кэш (offline = true).
#[tauri::command]
pub async fn sync_inbox(app: AppHandle) -> Result<SyncPayload, String> {
    let result = tauri::async_runtime::spawn_blocking(|| {
        let cfg = imap::load_account().map_err(|e| e.to_string())?;
        let (total, headers) =
            imap::fetch_headers(&cfg, "INBOX", imap::FETCH_LIMIT).map_err(|e| e.to_string())?;
        let folders = imap::list_folders(&cfg).map_err(|e| e.to_string())?;
        Ok::<_, String>((total, headers, folders))
    })
    .await
    .map_err(|e| format!("сбой потока: {e}"))?;

    match result {
        Ok((total, headers, folders)) => {
            let fetched = headers.len() as u32;
            let mut store = Store::open_default().map_err(|e| e.to_string())?;
            store
                .save_sync(total, &headers, &folders)
                .map_err(|e| e.to_string())?;
            {
                let st = app.state::<MailState>();
                *st.messages.lock().map_err(|_| "state: мьютекс повреждён")? = headers;
                *st.folders.lock().map_err(|_| "state: мьютекс повреждён")? = folders;
                *st.total.lock().map_err(|_| "state: мьютекс повреждён")? = total;
            }
            let payload = SyncPayload {
                total,
                fetched,
                offline: false,
                error: None,
            };
            let _ = app.emit("sync-finished", payload.clone());
            Ok(payload)
        }
        Err(err) => {
            let cached = Store::open_default()
                .ok()
                .and_then(|s| s.load().ok().flatten());
            if let Some(c) = cached {
                let fetched = c.messages.len() as u32;
                let total = c.total;
                {
                    let st = app.state::<MailState>();
                    *st.messages.lock().map_err(|_| "state: мьютекс повреждён")? = c.messages;
                    *st.folders.lock().map_err(|_| "state: мьютекс повреждён")? = c.folders;
                    *st.total.lock().map_err(|_| "state: мьютекс повреждён")? = total;
                }
                let payload = SyncPayload {
                    total,
                    fetched,
                    offline: true,
                    error: Some(err),
                };
                let _ = app.emit("sync-finished", payload.clone());
                Ok(payload)
            } else {
                Err(err)
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BodyPayload {
    pub uid: u32,
    pub text: Option<String>,
    pub html: Option<String>,
    pub from_cache: bool,
    pub truncated: bool,
}

/// Тело письма: из кэша или с сервера (TASK-005).
#[tauri::command]
pub async fn get_message_body(folder: String, uid: u32) -> Result<BodyPayload, String> {
    let f = folder.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let store = Store::open_default().map_err(|e| e.to_string())?;
        if let Some(c) = store.load_body(&f, uid).map_err(|e| e.to_string())? {
            return Ok::<BodyPayload, String>(BodyPayload {
                uid,
                text: c.text,
                html: c.html,
                from_cache: true,
                truncated: c.truncated,
            });
        }
        let cfg = imap::load_account().map_err(|e| e.to_string())?;
        let parsed = body::fetch_body(&cfg, &f, uid).map_err(|e| e.to_string())?;
        store
            .save_body(
                &f,
                uid,
                parsed.text.as_deref(),
                parsed.html.as_deref(),
                parsed.truncated,
            )
            .map_err(|e| e.to_string())?;
        Ok(BodyPayload {
            uid,
            text: parsed.text,
            html: parsed.html,
            from_cache: false,
            truncated: parsed.truncated,
        })
    })
    .await
    .map_err(|e| format!("сбой потока: {e}"))?
}

/// Загрузка писем выбранной папки (TASK-004.1).
#[tauri::command]
pub async fn sync_folder(app: AppHandle, folder: String) -> Result<SyncPayload, String> {
    let name = folder.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let cfg = imap::load_account().map_err(|e| e.to_string())?;
        let encoded = imap::encode_mutf7(&name);
        let (total, headers) =
            imap::fetch_headers(&cfg, &encoded, imap::FETCH_LIMIT).map_err(|e| e.to_string())?;
        Ok::<_, String>((total, headers))
    })
    .await
    .map_err(|e| format!("сбой потока: {e}"))?;

    let (total, headers) = result?;
    let fetched = headers.len() as u32;
    {
        let st = app.state::<MailState>();
        *st.messages.lock().map_err(|_| "state: мьютекс повреждён")? = headers;
        *st.total.lock().map_err(|_| "state: мьютекс повреждён")? = total;
    }
    let payload = SyncPayload {
        total,
        fetched,
        offline: false,
        error: None,
    };
    let _ = app.emit("sync-finished", payload.clone());
    Ok(payload)
}

/// Отправка письма через SMTP (TASK-004).
#[tauri::command]
pub async fn send_mail(to: String, subject: String, body: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = imap::load_account().map_err(|e| e.to_string())?;
        if to.trim().is_empty() {
            return Err("не указан получатель".to_string());
        }
        smtp::send_message(&cfg, &to, &subject, &body).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("сбой потока: {e}"))?
}

/// Последние загруженные заголовки писем.
#[tauri::command]
pub fn get_messages(state: tauri::State<'_, MailState>) -> Result<Vec<MessageHeader>, String> {
    let msgs = state
        .messages
        .lock()
        .map_err(|_| "state: мьютекс повреждён")?;
    Ok(msgs.clone())
}

/// Список папок ящика (из последней синхронизации).
#[tauri::command]
pub fn get_folders(state: tauri::State<'_, MailState>) -> Result<Vec<FolderInfo>, String> {
    let folders = state
        .folders
        .lock()
        .map_err(|_| "state: мьютекс повреждён")?;
    Ok(folders.clone())
}

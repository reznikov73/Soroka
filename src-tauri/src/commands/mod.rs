use crate::ai;
use crate::mail::accounts;
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
    /// Ящик, к которому относится кэш писем (TASK-016).
    pub account: Option<String>,
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
            let account = c.account.clone();
            {
                let st = app.state::<MailState>();
                *st.messages.lock().map_err(|_| "state: мьютекс повреждён")? = c.messages;
                *st.folders.lock().map_err(|_| "state: мьютекс повреждён")? = c.folders;
                *st.total.lock().map_err(|_| "state: мьютекс повреждён")? = total;
            }
            Ok(Some(CacheInfo {
                total,
                fetched,
                account,
            }))
        }
    }
}

/// Синхронизация INBOX выбранного ящика: почта -> кэш -> состояние + событие.
/// При ошибке сети/авторизации показывается кэш (offline = true).
#[tauri::command]
pub async fn sync_inbox(app: AppHandle, account_id: Option<String>) -> Result<SyncPayload, String> {
    let account = match account_id.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(id) => accounts::account_by_id(id)
            .ok_or_else(|| format!("ящик {id} не найден в настройках"))?,
        None => accounts::first_account().ok_or_else(|| "ящик не настроен".to_string())?,
    };
    let acc_id = account.id.clone();
    let inbox_key = accounts::folder_key(&acc_id, "INBOX");
    let cfg = account.config();
    let result = tauri::async_runtime::spawn_blocking(move || {
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
            let msgs_for_ai = headers.clone();
            let keyed: Vec<FolderInfo> = folders
                .iter()
                .map(|f| FolderInfo {
                    name: accounts::folder_key(&acc_id, &f.name),
                })
                .collect();
            let mut store = Store::open_default().map_err(|e| e.to_string())?;
            store
                .save_sync(&acc_id, total, &headers, &keyed)
                .map_err(|e| e.to_string())?;
            {
                let st = app.state::<MailState>();
                *st.messages.lock().map_err(|_| "state: мьютекс повреждён")? = headers;
                let mut all = st.folders.lock().map_err(|_| "state: мьютекс повреждён")?;
                let prefix = format!("{acc_id}::");
                all.retain(|f| !f.name.starts_with(&prefix));
                all.extend(keyed);
                all.sort_by(|a, b| {
                    let inbox = |n: &str| n.ends_with("::INBOX");
                    inbox(&b.name)
                        .cmp(&inbox(&a.name))
                        .then_with(|| a.name.cmp(&b.name))
                });
                *st.total.lock().map_err(|_| "state: мьютекс повреждён")? = total;
            }
            let payload = SyncPayload {
                total,
                fetched,
                offline: false,
                error: None,
            };
            let _ = app.emit("sync-finished", payload.clone());
            spawn_analysis_worker(app.clone(), inbox_key, msgs_for_ai);
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
    pub attachments: Vec<body::AttachmentMeta>,
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
                attachments: c.attachments,
            });
        }
        let (acc, name) = accounts::resolve_cfg(&f).map_err(|e| e.to_string())?;
        let parsed = body::fetch_body(&acc.config(), &name, uid).map_err(|e| e.to_string())?;
        store
            .save_body(
                &f,
                uid,
                parsed.text.as_deref(),
                parsed.html.as_deref(),
                parsed.truncated,
                &parsed.attachments,
            )
            .map_err(|e| e.to_string())?;
        Ok(BodyPayload {
            uid,
            text: parsed.text,
            html: parsed.html,
            from_cache: false,
            truncated: parsed.truncated,
            attachments: parsed.attachments,
        })
    })
    .await
    .map_err(|e| format!("сбой потока: {e}"))?
}

/// Текст письма для ИИ: из кэша тел или с сервера (TASK-009/010).
fn load_or_fetch_body_text(store: &Store, folder: &str, uid: u32) -> Result<String, String> {
    match store.load_body(folder, uid).map_err(|e| e.to_string())? {
        Some(c) => Ok(c
            .text
            .or_else(|| c.html.as_deref().map(body::html_to_text))
            .unwrap_or_default()),
        None => {
            let (acc, name) = accounts::resolve_cfg(folder).map_err(|e| e.to_string())?;
            let parsed = body::fetch_body(&acc.config(), &name, uid).map_err(|e| e.to_string())?;
            let _ = store.save_body(
                folder,
                uid,
                parsed.text.as_deref(),
                parsed.html.as_deref(),
                parsed.truncated,
                &parsed.attachments,
            );
            Ok(parsed
                .text
                .or_else(|| parsed.html.as_deref().map(body::html_to_text))
                .unwrap_or_default())
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalysisEntry {
    pub uid: u32,
    pub analysis: ai::gigachat::AiAnalysis,
}

/// ИИ-разбор письма: кэш -> GigaChat (TASK-010).
#[tauri::command]
pub async fn analyze_message(
    folder: String,
    uid: u32,
    subject: String,
) -> Result<ai::gigachat::AiAnalysis, String> {
    let f = folder.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let store = Store::open_default().map_err(|e| e.to_string())?;
        if let Some(a) = store.load_analysis(&f, uid).map_err(|e| e.to_string())? {
            return Ok(a);
        }
        let body_text = load_or_fetch_body_text(&store, &f, uid)?;
        if body_text.trim().is_empty() {
            return Err("в письме нет текста для разбора".to_string());
        }
        let analysis = ai::gigachat::analyze(&subject, &body_text).map_err(|e| e.to_string())?;
        store
            .save_analysis(&f, uid, Some(subject.as_str()), &analysis)
            .map_err(|e| e.to_string())?;
        Ok(analysis)
    })
    .await
    .map_err(|e| format!("сбой потока: {e}"))?
}

/// Все ИИ-разборы папки (для списка) — TASK-010.
#[tauri::command]
pub fn get_analyses(folder: String) -> Result<Vec<AnalysisEntry>, String> {
    let store = Store::open_default().map_err(|e| e.to_string())?;
    let items = store
        .load_all_analyses(&folder)
        .map_err(|e| e.to_string())?;
    Ok(items
        .into_iter()
        .map(|(uid, analysis)| AnalysisEntry { uid, analysis })
        .collect())
}

/// Событие календаря, сохранённое человеком — TASK-013 (часть E).
#[derive(Debug, Clone, Serialize)]
pub struct SavedEventDto {
    pub id: i64,
    pub title: String,
    pub start: String,
    pub end: String,
    pub time: Option<String>,
    pub description: String,
    pub folder: Option<String>,
    pub uid: Option<u32>,
}

/// Все сохранённые события календаря — TASK-013 (часть E).
#[tauri::command]
pub fn get_calendar_events() -> Result<Vec<SavedEventDto>, String> {
    let store = Store::open_default().map_err(|e| e.to_string())?;
    let rows = store.load_calendar_events().map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| SavedEventDto {
            id: r.id,
            title: r.title,
            start: r.start_date.clone(),
            end: r.end_date.unwrap_or(r.start_date),
            time: r.start_time,
            description: r.description,
            folder: r.source_folder,
            uid: r.source_uid,
        })
        .collect())
}

/// Добавляет событие в календарь (человек подтвердил форму) — TASK-013 (часть E).
#[tauri::command]
pub fn add_calendar_event(
    title: String,
    start: String,
    end: Option<String>,
    time: Option<String>,
    description: Option<String>,
    folder: Option<String>,
    uid: Option<u32>,
) -> Result<i64, String> {
    let start = start.trim().to_string();
    if start.len() != 10 {
        return Err("не указана дата события".to_string());
    }
    let title = title.trim().to_string();
    let title = if title.is_empty() {
        "Событие".to_string()
    } else {
        title
    };
    let end_date = end
        .map(|e| e.trim().to_string())
        .filter(|e| e.len() == 10 && e.as_str() > start.as_str());
    let start_time = time
        .map(|t| t.trim().to_string())
        .filter(|t| t.len() == 5);
    let description = description.unwrap_or_default().trim().to_string();
    let store = Store::open_default().map_err(|e| e.to_string())?;
    store
        .add_calendar_event(&crate::mail::store::CalendarEvent {
            id: 0,
            title,
            start_date: start,
            end_date,
            start_time,
            description,
            source_folder: folder.filter(|f| !f.trim().is_empty()),
            source_uid: uid.filter(|u| *u > 0),
        })
        .map_err(|e| e.to_string())
}

/// Удаляет событие из календаря — TASK-013 (часть E).
#[tauri::command]
pub fn delete_calendar_event(id: i64) -> Result<(), String> {
    let store = Store::open_default().map_err(|e| e.to_string())?;
    store.delete_calendar_event(id).map_err(|e| e.to_string())
}

/// Провайдеры для быстрой настройки ящика — TASK-015.
#[tauri::command]
pub fn mail_provider_presets() -> Vec<imap::ProviderPreset> {
    imap::provider_presets()
}

/// Адрес первого ящика (None — ни один не настроен) — TASK-015/016.
#[tauri::command]
pub fn mail_account_status() -> Option<String> {
    accounts::first_account().map(|a| a.email)
}

/// Все ящики без паролей — TASK-016.
#[tauri::command]
pub fn get_accounts() -> Vec<accounts::AccountView> {
    accounts::load_accounts().iter().map(|a| a.view()).collect()
}

/// Настройки одного ящика без пароля — TASK-016.
#[tauri::command]
pub fn mail_account_details(account_id: Option<String>) -> Option<accounts::AccountView> {
    let acc = match account_id.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(id) => accounts::account_by_id(id),
        None => accounts::first_account(),
    };
    acc.map(|a| a.view())
}

/// Ответ на сохранение ящика — TASK-016.
#[derive(Debug, Clone, Serialize)]
pub struct SavedAccount {
    pub id: String,
    pub message: String,
}

/// Проверяет вход и сохраняет ящик: новый или существующий — TASK-015/016.
/// Пустой пароль у существующего ящика — «не менять».
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn save_mail_account(
    account_id: Option<String>,
    email: String,
    password: Option<String>,
    imap_host: String,
    imap_port: u16,
    smtp_host: String,
    smtp_port: u16,
    check: bool,
) -> Result<SavedAccount, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let email = email.trim().to_string();
        if !email.contains('@') {
            return Err("укажите адрес почты — например: name@mail.ru".to_string());
        }
        let imap_host = imap_host.trim().to_string();
        let smtp_host = smtp_host.trim().to_string();
        if imap_host.is_empty() || smtp_host.is_empty() {
            return Err("укажите IMAP- и SMTP-серверы".to_string());
        }
        let current = account_id.as_deref().filter(|s| !s.trim().is_empty());
        let mut pass = password.unwrap_or_default().trim().to_string();
        if pass.is_empty() {
            // Пустой пароль — берём прежний, если это тот же ящик.
            let prev = match current {
                Some(id) => accounts::account_by_id(id),
                None => accounts::first_account(),
            };
            match prev {
                Some(p) if p.email.eq_ignore_ascii_case(&email) => pass = p.password,
                _ => return Err("укажите пароль".to_string()),
            }
        }
        let check_msg = if check {
            imap::test_login(&imap_host, imap_port, &email, &pass).map_err(|e| e.to_string())?
        } else {
            String::new()
        };
        let (acc, created) = accounts::upsert_account(
            current,
            &email,
            Some(&pass),
            &imap_host,
            imap_port,
            &smtp_host,
            smtp_port,
        )
        .map_err(|e| e.to_string())?;
        let mut message = if created {
            "ящик добавлен"
        } else {
            "сохранено"
        }
        .to_string();
        if !check_msg.is_empty() {
            message = format!("{check_msg}; {message}");
        }
        message = format!("{message}: {}", acc.email);
        Ok(SavedAccount {
            id: acc.id,
            message,
        })
    })
    .await
    .map_err(|e| format!("сбой потока: {e}"))?
}

/// Улучшение набранного текста письма через GigaChat — TASK-015.1.
#[tauri::command]
pub async fn improve_text(text: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if text.trim().chars().count() < 5 {
            return Err("сначала наберите текст письма".to_string());
        }
        ai::gigachat::improve(&text).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("сбой потока: {e}"))?
}

/// Черновик ответа в стиле владельца ящика — TASK-014.
/// ИИ только предлагает текст: человек правит и сам нажимает «Отправить».
#[tauri::command]
pub async fn draft_reply(
    folder: String,
    uid: u32,
    subject: String,
    from: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = Store::open_default().map_err(|e| e.to_string())?;
        let body_text = load_or_fetch_body_text(&store, &folder, uid)?;
        if body_text.trim().is_empty() {
            return Err("в письме нет текста — черновик не из чего писать".to_string());
        }
        // Примеры стиля: последние письма из «Отправленные» того же ящика.
        let mut samples: Vec<(String, String)> = Vec::new();
        let sent_key = match accounts::resolve_cfg(&folder) {
            Ok((acc, _)) => Some((acc.config(), accounts::folder_key(&acc.id, "Отправленные"))),
            Err(_) => None,
        };
        if let Some((cfg, sent_key)) = sent_key {
            let encoded = imap::encode_mutf7("Отправленные");
            if let Ok((_, headers)) = imap::fetch_headers(&cfg, &encoded, 6) {
                for h in headers.iter().rev() {
                    if samples.len() >= 4 {
                        break;
                    }
                    let subj = h.subject.trim().to_lowercase();
                    if subj == "тест" || subj == "test" || subj == "re: тест" || subj == "re: test" {
                        continue;
                    }
                    if let Ok(t) = load_or_fetch_body_text(&store, &sent_key, h.uid)
                        && t.trim().len() >= 20
                    {
                        samples.push((h.subject.clone(), t));
                    }
                }
            }
        }
        eprintln!("draft_reply: образцов стиля — {}", samples.len());
        let samples_text = ai::gigachat::build_samples(&samples);
        ai::gigachat::draft(&samples_text, &from, &subject, &body_text).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("сбой потока: {e}"))?
}

/// Пометка «важное» (IMAP \Flagged + кэш) — TASK-010.
#[tauri::command]
pub async fn set_flagged(
    app: AppHandle,
    folder: String,
    uid: u32,
    flagged: bool,
) -> Result<(), String> {
    let f = folder.clone();
    let is_inbox = accounts::split_key(&folder).1 == "INBOX";
    let res = tauri::async_runtime::spawn_blocking(move || {
        let (acc, name) = accounts::resolve_cfg(&f).map_err(|e| e.to_string())?;
        imap::set_flagged(&acc.config(), &name, uid, flagged).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("сбой потока: {e}"))?;
    res?;
    {
        let st = app.state::<MailState>();
        if let Ok(mut msgs) = st.messages.lock() {
            for m in msgs.iter_mut() {
                if m.uid == uid {
                    m.flagged = flagged;
                }
            }
        }
    }
    if is_inbox
        && let Ok(store) = Store::open_default()
    {
        let _ = store.mark_flagged(uid, flagged);
    }
    Ok(())
}

/// Перенос письма в «Спам» + домен в чёрный список (TASK-010).
#[tauri::command]
pub async fn move_to_spam(folder: String, uid: u32, domain: String) -> Result<(), String> {
    let f = folder.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (acc, name) = accounts::resolve_cfg(&f).map_err(|e| e.to_string())?;
        imap::move_to_spam(&acc.config(), &name, uid).map_err(|e| e.to_string())?;
        let d = domain.trim().to_lowercase();
        if !d.is_empty()
            && let Ok(store) = Store::open_default()
        {
            let _ = store.add_blacklist_domain(&d);
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("сбой потока: {e}"))?
}

#[derive(Debug, Clone, Serialize)]
pub struct AiProgressPayload {
    pub done: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiAnalyzedPayload {
    pub folder: String,
    pub uid: u32,
    pub analysis: ai::gigachat::AiAnalysis,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiDonePayload {
    pub analyzed: u32,
    pub important: u32,
    pub error: Option<String>,
}

static ANALYSIS_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Фоновый ИИ-разбор писем после синхронизации (TASK-010).
fn spawn_analysis_worker(app: AppHandle, folder_key: String, messages: Vec<MessageHeader>) {
    use std::sync::atomic::Ordering;
    if ai::gigachat::load_api_key().is_err() {
        return;
    }
    if ANALYSIS_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let res = analysis_worker_inner(&app, &folder_key, &messages);
        if let Err(e) = res {
            let _ = app.emit(
                "ai-done",
                AiDonePayload {
                    analyzed: 0,
                    important: 0,
                    error: Some(e),
                },
            );
        }
        ANALYSIS_RUNNING.store(false, Ordering::SeqCst);
    });
}

fn analysis_worker_inner(
    app: &AppHandle,
    folder_key: &str,
    messages: &[MessageHeader],
) -> Result<(), String> {
    let store = Store::open_default().map_err(|e| e.to_string())?;
    let mut pending: Vec<(u32, String)> = Vec::new();
    for m in messages {
        let analyzed = matches!(store.load_analysis(folder_key, m.uid), Ok(Some(_)));
        if !analyzed {
            pending.push((m.uid, m.subject.clone()));
        }
    }
    pending.truncate(30);
    let total = pending.len() as u32;
    if total == 0 {
        let _ = app.emit(
            "ai-done",
            AiDonePayload {
                analyzed: 0,
                important: 0,
                error: None,
            },
        );
        return Ok(());
    }
    let mut done = 0u32;
    let mut important = 0u32;
    for (uid, subject) in pending {
        let Ok(text) = load_or_fetch_body_text(&store, folder_key, uid) else {
            continue;
        };
        if text.trim().is_empty() {
            continue;
        }
        let mut analysis = None;
        for attempt in 0..2 {
            match ai::gigachat::analyze(&subject, &text) {
                Ok(a) => {
                    analysis = Some(a);
                    break;
                }
                Err(_) if attempt == 0 => {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                }
                Err(_) => {}
            }
        }
        let Some(a) = analysis else { continue };
        if a.importance == "высокая" {
            important += 1;
        }
        let _ = store.save_analysis(folder_key, uid, Some(subject.as_str()), &a);
        done += 1;
        let _ = app.emit(
            "ai-analyzed",
            AiAnalyzedPayload {
                folder: folder_key.to_string(),
                uid,
                analysis: a,
            },
        );
        let _ = app.emit("ai-progress", AiProgressPayload { done, total });
        std::thread::sleep(std::time::Duration::from_millis(400));
    }
    let _ = app.emit(
        "ai-done",
        AiDonePayload {
            analyzed: done,
            important,
            error: None,
        },
    );
    Ok(())
}

/// Пометка «прочитано/непрочитано» (IMAP \Seen + кэш) — TASK-008.
#[tauri::command]
pub async fn set_seen(app: AppHandle, folder: String, uid: u32, seen: bool) -> Result<(), String> {
    let f = folder.clone();
    let is_inbox = accounts::split_key(&folder).1 == "INBOX";
    let res = tauri::async_runtime::spawn_blocking(move || {
        let (acc, name) = accounts::resolve_cfg(&f).map_err(|e| e.to_string())?;
        imap::set_seen(&acc.config(), &name, uid, seen).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("сбой потока: {e}"))?;
    res?;

    {
        let st = app.state::<MailState>();
        if let Ok(mut msgs) = st.messages.lock() {
            for m in msgs.iter_mut() {
                if m.uid == uid {
                    m.seen = seen;
                }
            }
        }
    }
    if is_inbox
        && let Ok(store) = Store::open_default()
    {
        let _ = store.mark_seen(uid, seen);
    }
    Ok(())
}

/// Сохранение вложения письма в папку «Загрузки» (TASK-006).
#[tauri::command]
pub async fn save_attachment(folder: String, uid: u32, index: u32) -> Result<String, String> {
    let f = folder.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (acc, name) = accounts::resolve_cfg(&f).map_err(|e| e.to_string())?;
        let raw = body::fetch_raw(&acc.config(), &name, uid).map_err(|e| e.to_string())?;
        body::save_attachment_to_downloads(&raw, index).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("сбой потока: {e}"))?
}

/// Загрузка писем выбранной папки (TASK-004.1).
#[tauri::command]
pub async fn sync_folder(app: AppHandle, folder: String) -> Result<SyncPayload, String> {
    let key = folder.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let (acc, name) = accounts::resolve_cfg(&key).map_err(|e| e.to_string())?;
        let encoded = imap::encode_mutf7(&name);
        let (total, headers) = imap::fetch_headers(&acc.config(), &encoded, imap::FETCH_LIMIT)
            .map_err(|e| e.to_string())?;
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

/// Отправка письма через SMTP (TASK-004; вложения — TASK-006).
#[tauri::command]
pub async fn send_mail(
    account_id: Option<String>,
    to: String,
    subject: String,
    body: String,
    files: Option<Vec<smtp::AttachmentInput>>,
) -> Result<(), String> {
    let files = files.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let account = match account_id.as_deref().filter(|s| !s.trim().is_empty()) {
            Some(id) => accounts::account_by_id(id)
                .ok_or_else(|| format!("ящик {id} не найден в настройках"))?,
            None => accounts::first_account().ok_or_else(|| "ящик не настроен".to_string())?,
        };
        if to.trim().is_empty() {
            return Err("не указан получатель".to_string());
        }
        let atts = smtp::decode_attachments(&files).map_err(|e| e.to_string())?;
        smtp::send_message(&account.config(), &to, &subject, &body, &atts)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("сбой потока: {e}"))?
}

/// Экспорт события письма в календарь (.ics) — TASK-013.
#[tauri::command]
pub fn export_event_ics(
    title: String,
    start: String,
    end: String,
    description: String,
) -> Result<String, String> {
    let ev = crate::ics::IcsEvent {
        title: &title,
        start: &start,
        end: &end,
        description: &description,
    };
    let content = crate::ics::build_ics(&ev)?;
    let path = crate::ics::save_to_downloads(&content, &crate::ics::file_base_name(&start))
        .map_err(|e| e.to_string())?;
    Ok(path)
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

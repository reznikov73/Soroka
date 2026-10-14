//! IMAP: подключение к ящику и загрузка заголовков писем (TASK-002).

use super::MailError;
use serde::Serialize;
use std::path::PathBuf;

const DEFAULT_HOST: &str = "imap.mail.ru";
const DEFAULT_PORT: u16 = 993;
/// Сколько последних писем загружаем за раз.
pub const FETCH_LIMIT: u32 = 30;

#[derive(Debug, Clone)]
pub struct AccountConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageHeader {
    pub uid: u32,
    pub seq: u32,
    pub from: String,
    pub subject: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderInfo {
    pub name: String,
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_string()
}

/// Учётка: env (SOROKA_IMAP_USER / SOROKA_IMAP_PASS) или %APPDATA%\Soroka\account.json.
pub fn load_account() -> Result<AccountConfig, MailError> {
    if let (Ok(user), Ok(password)) = (
        std::env::var("SOROKA_IMAP_USER"),
        std::env::var("SOROKA_IMAP_PASS"),
    ) {
        let host = std::env::var("SOROKA_IMAP_HOST").unwrap_or_else(|_| DEFAULT_HOST.to_string());
        let port = std::env::var("SOROKA_IMAP_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(DEFAULT_PORT);
        return Ok(AccountConfig {
            host,
            port,
            user,
            password,
        });
    }

    let appdata = std::env::var("APPDATA")
        .map_err(|_| MailError::Config("переменная APPDATA недоступна".into()))?;
    let path = PathBuf::from(appdata).join("Soroka").join("account.json");
    let raw = std::fs::read_to_string(&path).map_err(|_| MailError::NoCredentials)?;
    let raw = raw.trim_start_matches('\u{feff}');
    let v: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| MailError::Config(format!("{}: плохой JSON ({e})", path.display())))?;
    let user = v
        .get("email")
        .and_then(|x| x.as_str())
        .ok_or_else(|| MailError::Config("account.json: нет поля \"email\"".into()))?
        .to_string();
    let password = v
        .get("password")
        .and_then(|x| x.as_str())
        .ok_or_else(|| MailError::Config("account.json: нет поля \"password\"".into()))?
        .to_string();
    let host = v
        .get("imap_host")
        .and_then(|x| x.as_str())
        .unwrap_or(DEFAULT_HOST)
        .to_string();
    let port = v
        .get("imap_port")
        .and_then(|x| x.as_u64())
        .unwrap_or(DEFAULT_PORT as u64) as u16;
    Ok(AccountConfig {
        host,
        port,
        user,
        password,
    })
}

fn with_session<T>(
    cfg: &AccountConfig,
    f: impl FnOnce(&mut imap::Session<imap::Connection>) -> Result<T, MailError>,
) -> Result<T, MailError> {
    let client = imap::ClientBuilder::new(&cfg.host, cfg.port)
        .connect()
        .map_err(|e| MailError::Network(e.to_string()))?;
    let mut session = client
        .login(&cfg.user, &cfg.password)
        .map_err(|e| MailError::Auth(e.0.to_string()))?;
    let result = f(&mut session);
    let _ = session.logout();
    result
}

/// Список папок ящика.
pub fn list_folders(cfg: &AccountConfig) -> Result<Vec<FolderInfo>, MailError> {
    with_session(cfg, |session| {
        let names = session
            .list(None, Some("*"))
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        let folders = names
            .iter()
            .map(|n| FolderInfo {
                name: n.name().to_string(),
            })
            .collect();
        Ok(folders)
    })
}

/// Заголовки последних писем из папки. Возвращает (всего писем, заголовки).
pub fn fetch_headers(
    cfg: &AccountConfig,
    mailbox: &str,
    limit: u32,
) -> Result<(u32, Vec<MessageHeader>), MailError> {
    with_session(cfg, |session| {
        let mbox = session
            .select(mailbox)
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        let total = mbox.exists;
        if total == 0 {
            return Ok((0, Vec::new()));
        }
        let start = if total > limit { total - limit + 1 } else { 1 };
        let range = format!("{start}:{total}");
        let msgs = session
            .fetch(range, "(UID ENVELOPE)")
            .map_err(|e| MailError::Protocol(e.to_string()))?;

        let mut out = Vec::new();
        for m in msgs.iter() {
            let env = m.envelope();
            let subject = env
                .and_then(|e| e.subject.as_deref())
                .map(text)
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "(без темы)".to_string());
            let date = env
                .and_then(|e| e.date.as_deref())
                .map(text)
                .unwrap_or_default();
            let from = env
                .and_then(|e| e.from.as_ref())
                .and_then(|list| list.first())
                .map(|a| {
                    let mailbox = a.mailbox.as_deref().map(text).unwrap_or_default();
                    let host = a.host.as_deref().map(text).unwrap_or_default();
                    let addr = if host.is_empty() {
                        mailbox
                    } else {
                        format!("{mailbox}@{host}")
                    };
                    match a.name.as_deref().map(text) {
                        Some(name) if !name.is_empty() => format!("{name} <{addr}>"),
                        _ => addr,
                    }
                })
                .unwrap_or_else(|| "(неизвестный отправитель)".to_string());
            out.push(MessageHeader {
                uid: m.uid.unwrap_or(0),
                seq: m.message,
                from,
                subject,
                date,
            });
        }
        // свежие — вверх
        out.reverse();
        Ok((total, out))
    })
}

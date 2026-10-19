//! IMAP: подключение к ящику и загрузка заголовков писем (TASK-002).

use super::MailError;
use base64::Engine as _;
use serde::Serialize;
use std::path::PathBuf;

const DEFAULT_HOST: &str = "imap.mail.ru";
const DEFAULT_PORT: u16 = 993;
/// Порт SMTP по умолчанию: неявный TLS (SSL).
const DEFAULT_SMTP_PORT: u16 = 465;
/// Сколько последних писем загружаем за раз.
pub const FETCH_LIMIT: u32 = 200;

#[derive(Debug, Clone)]
pub struct AccountConfig {
    /// IMAP-хост — приём писем (TASK-002).
    pub host: String,
    pub port: u16,
    /// SMTP-хост — отправка писем (TASK-004).
    pub smtp_host: String,
    pub smtp_port: u16,
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
    pub seen: bool,
    pub flagged: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderInfo {
    pub name: String,
    /// Разделитель вложенных папок сервера («.» у Majordomo, «/» у Mail.ru).
    #[serde(default)]
    pub delimiter: Option<String>,
    /// Папка помечена сервером как \Drafts — TASK-022.
    #[serde(default)]
    pub is_drafts: bool,
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_string()
}

/// Декодирование encoded-word (RFC 2047): "=?charset?B|Q?data?=" -> текст.
pub fn decode_rfc2047(input: &str) -> String {
    if !input.contains("=?") {
        return input.to_string();
    }
    let mut out = String::new();
    let mut rest = input;
    let mut last_was_word = false;
    loop {
        if let Some(pos) = rest.find("=?") {
            let (before, candidate) = rest.split_at(pos);
            match decode_word(candidate) {
                Some((decoded, consumed)) => {
                    let skip_spaces = before.trim().is_empty() && last_was_word;
                    if !skip_spaces {
                        out.push_str(before);
                    }
                    out.push_str(&decoded);
                    last_was_word = true;
                    rest = &candidate[consumed..];
                }
                None => {
                    out.push_str(before);
                    out.push_str("=?");
                    last_was_word = false;
                    rest = &candidate[2..];
                }
            }
        } else {
            out.push_str(rest);
            break;
        }
    }
    out
}

/// Пытается разобрать слово вида "=?charset?B|Q?data?=" в начале строки.
fn decode_word(input: &str) -> Option<(String, usize)> {
    if !input.starts_with("=?") {
        return None;
    }
    let q1 = input[2..].find('?')? + 2;
    let rest = &input[q1 + 1..];
    let q2_rel = rest.find('?')?;
    let enc = &rest[..q2_rel];
    if enc.len() != 1 {
        return None;
    }
    let rest2 = &rest[q2_rel + 1..];
    let q3_rel = rest2.find("?=")?;
    let data = &rest2[..q3_rel];
    let consumed = q1 + 1 + q2_rel + 1 + q3_rel + 2;

    let payload: Vec<u8> = match enc.as_bytes()[0].to_ascii_uppercase() {
        b'B' => {
            let mut s: String = data.chars().filter(|c| !c.is_whitespace()).collect();
            while !s.len().is_multiple_of(4) {
                s.push('=');
            }
            base64::engine::general_purpose::STANDARD
                .decode(s.as_bytes())
                .ok()?
        }
        b'Q' => {
            let mut v = Vec::new();
            let bs = data.as_bytes();
            let mut i = 0;
            while i < bs.len() {
                match bs[i] {
                    b'_' => {
                        v.push(b' ');
                        i += 1;
                    }
                    b'=' if i + 2 < bs.len() => {
                        let byte = u8::from_str_radix(&data[i + 1..i + 3], 16).ok()?;
                        v.push(byte);
                        i += 3;
                    }
                    other => {
                        v.push(other);
                        i += 1;
                    }
                }
            }
            v
        }
        _ => return None,
    };

    let charset = input[2..q1].to_ascii_lowercase();
    Some((decode_charset(&payload, &charset), consumed))
}

fn decode_charset(bytes: &[u8], charset: &str) -> String {
    let enc = match charset {
        "utf-8" | "utf8" | "us-ascii" | "ascii" => encoding_rs::UTF_8,
        "windows-1251" | "cp1251" | "win-1251" => encoding_rs::WINDOWS_1251,
        "koi8-r" | "koi8r" => encoding_rs::KOI8_R,
        "iso-8859-1" | "latin1" => encoding_rs::WINDOWS_1252,
        _ => encoding_rs::UTF_8,
    };
    let (text, _, _) = enc.decode(bytes);
    text.into_owned()
}
/// Имя папки из modified UTF-7 (RFC 3501, §5.1.3) -> обычная строка.
fn decode_mutf7(input: &str) -> String {
    let engine = base64::engine::general_purpose::STANDARD;
    let mut out = String::new();
    let mut it = input.chars().peekable();
    while let Some(c) = it.next() {
        if c != '&' {
            out.push(c);
            continue;
        }
        match it.peek() {
            Some('-') => {
                it.next();
                out.push('&');
            }
            Some(_) => {
                let mut seg = String::new();
                let mut closed = false;
                while let Some(&nc) = it.peek() {
                    if nc == '-' {
                        it.next();
                        closed = true;
                        break;
                    }
                    seg.push(nc);
                    it.next();
                }
                if !closed {
                    out.push('&');
                    out.push_str(&seg);
                    break;
                }
                let mut b64: String = seg
                    .chars()
                    .map(|ch| if ch == ',' { '/' } else { ch })
                    .collect();
                while !b64.len().is_multiple_of(4) {
                    b64.push('=');
                }
                if let Ok(bytes) = engine.decode(b64.as_bytes()) {
                    let units: Vec<u16> = bytes
                        .as_chunks::<2>()
                        .0
                        .iter()
                        .map(|c| u16::from_be_bytes(*c))
                        .collect();
                    out.push_str(&String::from_utf16_lossy(&units));
                }
            }
            None => out.push('&'),
        }
    }
    out
}

/// Кодирование имени папки в modified UTF-7 (обратное к decode_mutf7).
pub fn encode_mutf7(input: &str) -> String {
    fn flush(buf: &mut Vec<u16>, out: &mut String) {
        if buf.is_empty() {
            return;
        }
        let bytes: Vec<u8> = buf.iter().flat_map(|u| u.to_be_bytes()).collect();
        let b64 = base64::engine::general_purpose::STANDARD
            .encode(&bytes)
            .trim_end_matches('=')
            .replace('/', ",");
        out.push('&');
        out.push_str(&b64);
        out.push('-');
        buf.clear();
    }

    let mut out = String::new();
    let mut buf: Vec<u16> = Vec::new();
    for ch in input.chars() {
        let cp = ch as u32;
        if (0x20..=0x7e).contains(&cp) {
            flush(&mut buf, &mut out);
            if ch == '&' {
                out.push_str("&-");
            } else {
                out.push(ch);
            }
        } else {
            buf.push(ch as u16);
        }
    }
    flush(&mut buf, &mut out);
    out
}

/// SMTP-хост по IMAP-хосту: "imap.X" -> "smtp.X"; иначе — без изменений.
fn derive_smtp_host(host: &str) -> String {
    match host.strip_prefix("imap.") {
        Some(rest) => format!("smtp.{rest}"),
        None => host.to_string(),
    }
}

/// Учётка: env (SOROKA_IMAP_USER / SOROKA_IMAP_PASS) или %APPDATA%\Soroka\account.json.
pub fn load_account() -> Result<AccountConfig, MailError> {
    let env_smtp_host = std::env::var("SOROKA_SMTP_HOST").ok();
    let env_smtp_port = std::env::var("SOROKA_SMTP_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok());

    if let (Ok(user), Ok(password)) = (
        std::env::var("SOROKA_IMAP_USER"),
        std::env::var("SOROKA_IMAP_PASS"),
    ) {
        let host = std::env::var("SOROKA_IMAP_HOST").unwrap_or_else(|_| DEFAULT_HOST.to_string());
        let port = std::env::var("SOROKA_IMAP_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(DEFAULT_PORT);
        let smtp_host = env_smtp_host.unwrap_or_else(|| derive_smtp_host(&host));
        let smtp_port = env_smtp_port.unwrap_or(DEFAULT_SMTP_PORT);
        return Ok(AccountConfig {
            host,
            port,
            smtp_host,
            smtp_port,
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
    let smtp_host = env_smtp_host.unwrap_or_else(|| {
        v.get("smtp_host")
            .and_then(|x| x.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| derive_smtp_host(&host))
    });
    let smtp_port = env_smtp_port.unwrap_or_else(|| {
        v.get("smtp_port")
            .and_then(|x| x.as_u64())
            .unwrap_or(DEFAULT_SMTP_PORT as u64) as u16
    });
    Ok(AccountConfig {
        host,
        port,
        smtp_host,
        smtp_port,
        user,
        password,
    })
}

/// Признаки разрыва соединения сервером (BYE/IO) — повод для одного повтора.
fn is_disconnect_error(e: &MailError) -> bool {
    const SIGNS: [&str; 5] = [
        "Bye Response",
        "Connection Lost",
        "unexpected end of file",
        "connection reset",
        "forcibly closed",
    ];
    match e {
        MailError::Protocol(msg) => SIGNS.iter().any(|s| msg.contains(s)),
        _ => false,
    }
}

/// Выполняет операцию в сессии; при разрыве соединения сервером — один повтор (TASK-010.1).
pub(crate) fn with_session<T>(
    cfg: &AccountConfig,
    f: impl Fn(&mut imap::Session<imap::Connection>) -> Result<T, MailError>,
) -> Result<T, MailError> {
    match with_session_once(cfg, &f) {
        Err(ref e) if is_disconnect_error(e) => {
            std::thread::sleep(std::time::Duration::from_millis(700));
            with_session_once(cfg, &f)
        }
        r => r,
    }
}

fn with_session_once<T>(
    cfg: &AccountConfig,
    f: &impl Fn(&mut imap::Session<imap::Connection>) -> Result<T, MailError>,
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

/// Профиль известного почтового провайдера — TASK-015.
#[derive(Debug, Clone, Serialize)]
pub struct ProviderPreset {
    pub id: String,
    pub title: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub hint: String,
}

/// Быстрая настройка известных провайдеров — TASK-015.
pub fn provider_presets() -> Vec<ProviderPreset> {
    let mut out = vec![
        ProviderPreset {
            id: "mailru".into(),
            title: "Mail.ru".into(),
            imap_host: "imap.mail.ru".into(),
            imap_port: 993,
            smtp_host: "smtp.mail.ru".into(),
            smtp_port: 465,
            hint: "Подойдёт обычный пароль; если включена двухэтапная проверка — «пароль для внешнего приложения» в настройках Mail.ru.".into(),
        },
        ProviderPreset {
            id: "yandex".into(),
            title: "Яндекс".into(),
            imap_host: "imap.yandex.ru".into(),
            imap_port: 993,
            smtp_host: "smtp.yandex.ru".into(),
            smtp_port: 465,
            hint: "Включите IMAP в настройках Яндекс.Почты; при двухэтапной проверке нужен «пароль приложения».".into(),
        },
        ProviderPreset {
            id: "gmail".into(),
            title: "Gmail".into(),
            imap_host: "imap.gmail.com".into(),
            imap_port: 993,
            smtp_host: "smtp.gmail.com".into(),
            smtp_port: 465,
            hint: "Нужен «пароль приложения» Google: Аккаунт → Безопасность → Двухэтапная проверка → Пароли приложений.".into(),
        },
        ProviderPreset {
            id: "outlook".into(),
            title: "Outlook / Hotmail".into(),
            imap_host: "outlook.office365.com".into(),
            imap_port: 993,
            smtp_host: "smtp.office365.com".into(),
            smtp_port: 587,
            hint: "SMTP через STARTTLS (587). При двухэтапной проверке — «пароль приложения».".into(),
        },
        ProviderPreset {
            id: "rambler".into(),
            title: "Rambler".into(),
            imap_host: "imap.rambler.ru".into(),
            imap_port: 993,
            smtp_host: "smtp.rambler.ru".into(),
            smtp_port: 465,
            hint: "Включите IMAP в настройках Rambler.".into(),
        },
    ];
    out.push(ProviderPreset {
        id: "other".into(),
        title: "Другое (вручную)".into(),
        imap_host: String::new(),
        imap_port: 993,
        smtp_host: String::new(),
        smtp_port: 465,
        hint: "Укажите IMAP- и SMTP-серверы вашего провайдера (обычно порты 993 и 465; для STARTTLS — 587).".into(),
    });
    out
}

/// Проверка входа: подключение по IMAP + логин + список папок — TASK-015.
pub fn test_login(host: &str, port: u16, user: &str, password: &str) -> Result<String, MailError> {
    if host.trim().is_empty() {
        return Err(MailError::Config("не указан IMAP-сервер".into()));
    }
    let client = imap::ClientBuilder::new(host.trim(), port)
        .connect()
        .map_err(|e| MailError::Network(format!("подключение к {host}:{port}: {e}")))?;
    let mut session = client
        .login(user, password)
        .map_err(|e| MailError::Auth(format!("вход: {}", e.0)))?;
    let names = session
        .list(None, Some("*"))
        .map_err(|e| MailError::Protocol(e.to_string()))?;
    let n = names.len();
    let _ = session.logout();
    Ok(format!("вход выполнен, папок: {n}"))
}

/// Запись account.json (вынесено для тестов) — TASK-015.
fn save_account_to(path: &std::path::Path, cfg: &AccountConfig) -> Result<(), MailError> {
    let data = serde_json::json!({
        "email": cfg.user,
        "password": cfg.password,
        "imap_host": cfg.host,
        "imap_port": cfg.port,
        "smtp_host": cfg.smtp_host,
        "smtp_port": cfg.smtp_port,
    });
    let text = serde_json::to_string_pretty(&data)
        .map_err(|e| MailError::Config(format!("account.json: {e}")))?;
    std::fs::write(path, text)
        .map_err(|e| MailError::Config(format!("записать {}: {e}", path.display())))
}

/// Сохраняет настройки ящика в %APPDATA%\Soroka\account.json — TASK-015.
pub fn save_account(cfg: &AccountConfig) -> Result<String, MailError> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| MailError::Config("переменная APPDATA недоступна".into()))?;
    let dir = std::path::PathBuf::from(&appdata).join("Soroka");
    std::fs::create_dir_all(&dir)
        .map_err(|e| MailError::Config(format!("создать папку настроек: {e}")))?;
    let path = dir.join("account.json");
    save_account_to(&path, cfg)?;
    Ok(path.display().to_string())
}

/// Список папок ящика (имена в обычной кодировке; INBOX — первым).
pub fn list_folders(cfg: &AccountConfig) -> Result<Vec<FolderInfo>, MailError> {
    with_session(cfg, |session| {
        let names = session
            .list(None, Some("*"))
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        let mut folders: Vec<FolderInfo> = names
            .iter()
            .map(|n| FolderInfo {
                name: decode_mutf7(n.name()),
                delimiter: n.delimiter().map(|d| d.to_string()),
                is_drafts: n
                    .attributes()
                    .iter()
                    .any(|a| matches!(a, imap_proto::NameAttribute::Drafts)),
            })
            .collect();
        folders.sort_by(|a, b| {
            let key = |s: &str| u8::from(s != "INBOX");
            key(&a.name)
                .cmp(&key(&b.name))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(folders)
    })
}

/// Точные счётчики всех папок за одно соединение: (имя, всего, непрочитанных).
/// STATUS не требует открывать папку — TASK-019.
pub fn folder_statuses(
    cfg: &AccountConfig,
    mailboxes: &[String],
) -> Result<Vec<(String, u32, u32)>, MailError> {
    with_session(cfg, |session| {
        let mut out = Vec::with_capacity(mailboxes.len());
        for name in mailboxes {
            let encoded = encode_mutf7(name);
            match session.status(&encoded, "(MESSAGES UNSEEN)") {
                Ok(m) => out.push((name.clone(), m.exists, m.unseen.unwrap_or(0))),
                Err(_) => out.push((name.clone(), 0, 0)),
            }
        }
        Ok(out)
    })
}

/// Заголовок письма из ответа IMAP (ENVELOPE + FLAGS).
fn header_from(m: &imap::types::Fetch) -> MessageHeader {
    let env = m.envelope();
    let subject = env
        .and_then(|e| e.subject.as_deref())
        .map(text)
        .map(|s| decode_rfc2047(&s))
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
                Some(name) if !name.is_empty() => {
                    format!("{} <{}>", decode_rfc2047(&name), addr)
                }
                _ => addr,
            }
        })
        .unwrap_or_else(|| "(неизвестный отправитель)".to_string());
    let seen = m
        .flags()
        .iter()
        .any(|f| matches!(f, imap::types::Flag::Seen));
    let flagged = m
        .flags()
        .iter()
        .any(|f| matches!(f, imap::types::Flag::Flagged));
    MessageHeader {
        uid: m.uid.unwrap_or(0),
        seq: m.message,
        from,
        subject,
        date,
        seen,
        flagged,
    }
}

/// Заголовки писем папки: последние `limit` плюс все непрочитанные вне этого окна.
/// Возвращает (всего писем, заголовки).
///
/// TASK-019.1: без догрузки непрочитанных счётчик показывал цифру, которой
/// не было в списке (старые непрочитанные лежали глубже окна загрузки).
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
            .fetch(range, "(UID ENVELOPE FLAGS)")
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        let mut out: Vec<MessageHeader> = msgs.iter().map(header_from).collect();
        let have: std::collections::HashSet<u32> = out.iter().map(|m| m.uid).collect();
        drop(msgs);

        if total > limit {
            let mut missing: Vec<u32> = session
                .uid_search("UNSEEN")
                .map(|set| set.into_iter().filter(|u| !have.contains(u)).collect())
                .unwrap_or_default();
            missing.sort_unstable();
            missing.truncate(100);
            if !missing.is_empty() {
                let set = missing
                    .iter()
                    .map(|u| u.to_string())
                    .collect::<Vec<_>>()
                    .join(",");
                if let Ok(extra) = session.uid_fetch(set, "(UID ENVELOPE FLAGS)") {
                    for m in extra.iter() {
                        let h = header_from(m);
                        if !out.iter().any(|x| x.uid == h.uid) {
                            out.push(h);
                        }
                    }
                }
            }
        }

        // свежие — вверх
        out.sort_by_key(|m| std::cmp::Reverse(m.seq));
        Ok((total, out))
    })
}

/// Помечает письмо прочитанным/непрочитанным (IMAP \Seen) — TASK-008.
pub fn set_seen(cfg: &AccountConfig, folder: &str, uid: u32, seen: bool) -> Result<(), MailError> {
    let encoded = encode_mutf7(folder);
    with_session(cfg, |session| {
        session
            .select(&encoded)
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        let op = if seen { "+FLAGS" } else { "-FLAGS" };
        session
            .uid_store(uid.to_string(), format!("{op} (\\Seen)"))
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        Ok(())
    })
}

/// Помечает письмо «важным»/снимает флаг (IMAP \Flagged) — TASK-010.
pub fn set_flagged(
    cfg: &AccountConfig,
    folder: &str,
    uid: u32,
    flagged: bool,
) -> Result<(), MailError> {
    let encoded = encode_mutf7(folder);
    with_session(cfg, |session| {
        session
            .select(&encoded)
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        let op = if flagged { "+FLAGS" } else { "-FLAGS" };
        session
            .uid_store(uid.to_string(), format!("{op} (\\Flagged)"))
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        Ok(())
    })
}

/// Ищет папку корзины по типичным именам — TASK-021.
pub fn find_trash(folders: &[String]) -> Option<String> {
    const EXACT: [&str; 6] = [
        "Корзина",
        "Trash",
        "Удалённые",
        "Удаленные",
        "Deleted Items",
        "[Gmail]/Trash",
    ];
    for name in EXACT {
        if let Some(f) = folders.iter().find(|f| f.eq_ignore_ascii_case(name)) {
            return Some(f.clone());
        }
    }
    folders.iter().find_map(|f| {
        let l = f.to_lowercase();
        if l.contains("корзин") || l.contains("trash") || l.contains("удал") {
            Some(f.clone())
        } else {
            None
        }
    })
}

/// Перенос письма в произвольную папку (IMAP MOVE) — TASK-021.
pub fn move_to_folder(
    cfg: &AccountConfig,
    folder: &str,
    uid: u32,
    target: &str,
) -> Result<(), MailError> {
    let encoded = encode_mutf7(folder);
    let dst = encode_mutf7(target);
    with_session(cfg, |session| {
        session
            .select(&encoded)
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        session
            .uid_mv(uid.to_string(), &dst)
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        Ok(())
    })
}

/// Удаляет письмо: переносит в корзину ящика (TASK-021).
pub fn move_to_trash(cfg: &AccountConfig, folder: &str, uid: u32) -> Result<String, MailError> {
    let names: Vec<String> = list_folders(cfg)?.into_iter().map(|f| f.name).collect();
    let trash = find_trash(&names)
        .ok_or_else(|| MailError::Config("папка «Корзина» не найдена на сервере".into()))?;
    move_to_folder(cfg, folder, uid, &trash)?;
    Ok(trash)
}

/// Возвращает письмо из спама во «Входящие» — TASK-021.
pub fn move_to_inbox(cfg: &AccountConfig, folder: &str, uid: u32) -> Result<(), MailError> {
    move_to_folder(cfg, folder, uid, "INBOX")
}

/// Полностью очищает папку (корзину): \Deleted + EXPUNGE — TASK-021.
pub fn empty_folder(cfg: &AccountConfig, folder: &str) -> Result<u32, MailError> {
    let encoded = encode_mutf7(folder);
    with_session(cfg, |session| {
        let mbox = session
            .select(&encoded)
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        let total = mbox.exists;
        if total == 0 {
            return Ok(0);
        }
        session
            .store("1:*", "+FLAGS (\\Deleted)")
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        session
            .expunge()
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        Ok(total)
    })
}

/// Папка черновиков: по флагу \Drafts, иначе по имени (TASK-022).
pub fn find_drafts(folders: &[FolderInfo]) -> Option<String> {
    if let Some(f) = folders.iter().find(|f| f.is_drafts) {
        return Some(f.name.clone());
    }
    folders
        .iter()
        .find(|f| {
            let l = f.name.to_lowercase();
            ["drafts", "черновики", "draft", "черновик"]
                .iter()
                .any(|n| l == *n || l.ends_with(&format!("/{n}")) || l.ends_with(&format!(".{n}")))
        })
        .map(|f| f.name.clone())
}

/// Кладёт письмо в папку черновиков через IMAP APPEND и возвращает UID (TASK-022).
pub fn append_draft(
    cfg: &AccountConfig,
    folder: &str,
    raw: &[u8],
    id: &str,
) -> Result<Option<u32>, MailError> {
    let encoded = encode_mutf7(folder);
    with_session(cfg, |session| {
        let appended = session
            .append(&encoded, raw)
            .flag(imap::types::Flag::Draft)
            .finish()
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        if let Some(uids) = appended.uids
            && let Some(imap_proto::UidSetMember::Uid(uid)) = uids.first()
        {
            return Ok(Some(*uid));
        }
        // Сервер без UIDPLUS: находим письмо по собственному заголовку.
        let found = session
            .uid_search(format!("HEADER X-Soroka-Draft {id}"))
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        Ok(found.into_iter().max())
    })
}

/// Удаляет письмо безвозвратно: \Deleted + EXPUNGE (TASK-022).
pub fn delete_permanently(cfg: &AccountConfig, folder: &str, uid: u32) -> Result<(), MailError> {
    let encoded = encode_mutf7(folder);
    with_session(cfg, |session| {
        session
            .select(&encoded)
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        session
            .uid_store(uid.to_string(), "+FLAGS (\\Deleted)")
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        session
            .expunge()
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        Ok(())
    })
}

/// Переносит письмо в папку «Спам» (TASK-010).
pub fn move_to_spam(cfg: &AccountConfig, folder: &str, uid: u32) -> Result<(), MailError> {
    let encoded = encode_mutf7(folder);
    let spam = encode_mutf7("Спам");
    with_session(cfg, |session| {
        session
            .select(&encoded)
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        session
            .uid_mv(uid.to_string(), &spam)
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        Ok(())
    })
}

#[cfg(test)]
mod preset_tests {
    use super::{AccountConfig, FolderInfo, find_drafts, provider_presets, save_account_to};

    #[test]
    fn finds_drafts_folder() {
        let folders = vec![
            FolderInfo {
                name: "INBOX".to_string(),
                delimiter: Some(".".to_string()),
                is_drafts: false,
            },
            FolderInfo {
                name: "INBOX.Drafts".to_string(),
                delimiter: Some(".".to_string()),
                is_drafts: true,
            },
        ];
        assert_eq!(find_drafts(&folders), Some("INBOX.Drafts".to_string()));

        let by_name = vec![FolderInfo {
            name: "Черновики".to_string(),
            delimiter: None,
            is_drafts: false,
        }];
        assert_eq!(find_drafts(&by_name), Some("Черновики".to_string()));
        assert_eq!(find_drafts(&[]), None);
    }

    #[test]
    fn finds_trash_folder() {
        let list = vec![
            "INBOX".to_string(),
            "Отправленные".to_string(),
            "Корзина".to_string(),
        ];
        assert_eq!(super::find_trash(&list).as_deref(), Some("Корзина"));
        let gmail = vec!["INBOX".to_string(), "[Gmail]/Trash".to_string()];
        assert_eq!(super::find_trash(&gmail).as_deref(), Some("[Gmail]/Trash"));
        assert_eq!(super::find_trash(&["INBOX".to_string()]), None);
    }

    #[test]
    fn presets_have_hosts() {
        let list = provider_presets();
        assert!(list.len() >= 6);
        let mailru = list.iter().find(|p| p.id == "mailru").unwrap();
        assert_eq!(mailru.imap_host, "imap.mail.ru");
        assert_eq!(mailru.imap_port, 993);
        let other = list.iter().find(|p| p.id == "other").unwrap();
        assert!(other.imap_host.is_empty());
    }

    #[test]
    fn saves_account_json() {
        let dir = std::env::temp_dir().join("soroka-acc-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("account.json");
        let cfg = AccountConfig {
            host: "imap.example.org".into(),
            port: 993,
            smtp_host: "smtp.example.org".into(),
            smtp_port: 465,
            user: "u@example.org".into(),
            password: "secret".into(),
        };
        save_account_to(&path, &cfg).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("\"email\": \"u@example.org\""));
        assert!(raw.contains("\"imap_port\": 993"));
        assert!(raw.contains("\"smtp_host\": \"smtp.example.org\""));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_rfc2047, derive_smtp_host};

    #[test]
    fn smtp_host_derivation() {
        assert_eq!(derive_smtp_host("imap.mail.ru"), "smtp.mail.ru");
        assert_eq!(derive_smtp_host("smtp.mail.ru"), "smtp.mail.ru");
        assert_eq!(derive_smtp_host("localhost"), "localhost");
    }

    #[test]
    fn mutf7_roundtrip() {
        for name in [
            "INBOX",
            "INBOX/ToMyself",
            "Отправленные",
            "1с Рассылки",
            "чеки",
            "Пароли и разные",
            "A&B",
        ] {
            assert_eq!(
                super::decode_mutf7(&super::encode_mutf7(name)),
                name,
                "имя: {name}"
            );
        }
        assert_eq!(
            super::encode_mutf7("Отправленные"),
            "&BB4EQgQ,BEAEMAQyBDsENQQ9BD0ESwQ1-"
        );
        assert_eq!(super::encode_mutf7("&"), "&-");
    }

    #[test]
    fn plain_text_passthrough() {
        assert_eq!(decode_rfc2047("Привет, мир"), "Привет, мир");
    }

    #[test]
    fn base64_utf8() {
        assert_eq!(decode_rfc2047("=?utf-8?B?0J/RgNC40LLQtdGC?="), "Привет");
    }

    #[test]
    fn q_utf8() {
        assert_eq!(
            decode_rfc2047("=?utf-8?Q?=D0=9F=D1=80=D0=B8=D0=B2=D0=B5=D1=82?="),
            "Привет"
        );
    }

    #[test]
    fn windows_1251_base64() {
        assert_eq!(decode_rfc2047("=?windows-1251?B?z/Do4uXy?="), "Привет");
    }

    #[test]
    fn adjacent_words_merge_without_space() {
        assert_eq!(
            decode_rfc2047("=?utf-8?B?0J/RgNC40LLQtdGC?= =?utf-8?B?0JzQuNGA?="),
            "ПриветМир"
        );
    }

    #[test]
    fn mixed_plain_and_encoded() {
        assert_eq!(
            decode_rfc2047("Re: =?utf-8?B?0J/RgNC40LLQtdGC?=!"),
            "Re: Привет!"
        );
    }

    #[test]
    fn disconnect_errors_are_recognized() {
        use crate::mail::MailError;
        let bye = MailError::Protocol("Bye Response: no explanation given".to_string());
        let lost = MailError::Protocol("Connection Lost".to_string());
        let no = MailError::Protocol("No Response: mailbox not found".to_string());
        let net = MailError::Network("os error 10061".to_string());
        assert!(super::is_disconnect_error(&bye));
        assert!(super::is_disconnect_error(&lost));
        assert!(!super::is_disconnect_error(&no));
        assert!(!super::is_disconnect_error(&net));
    }
}

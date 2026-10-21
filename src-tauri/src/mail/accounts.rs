//! Несколько почтовых ящиков (TASK-016).
//!
//! Настройки лежат в %APPDATA%\Soroka\accounts.json — списком. Пароли не
//! попадают ни в репозиторий, ни в интерфейс. Старый account.json (TASK-015)
//! читается один раз и превращается в первый ящик списка.
//!
//! Папки в кэше и в командах адресуются ключом "id::ИМЯ" — так письмо всегда
//! знает свой ящик (см. folder_key / split_key / resolve_cfg).

use super::imap::AccountConfig;
use super::MailError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const DEFAULT_IMAP_HOST: &str = "imap.mail.ru";
const DEFAULT_IMAP_PORT: u16 = 993;
const DEFAULT_SMTP_PORT: u16 = 465;

/// Один ящик целиком, включая пароль (только для файла настроек).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub email: String,
    pub password: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
    /// Автопроверка почты, секунды; 0 — не проверять (TASK-037).
    #[serde(default)]
    pub check_interval_sec: u32,
    /// Чистить корзину при выходе из программы (TASK-037).
    #[serde(default)]
    pub empty_trash_on_exit: bool,
}

/// Ящик для интерфейса — без пароля.
#[derive(Debug, Clone, Serialize)]
pub struct AccountView {
    pub id: String,
    pub email: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub check_interval_sec: u32,
    pub empty_trash_on_exit: bool,
}

impl Account {
    pub fn view(&self) -> AccountView {
        AccountView {
            id: self.id.clone(),
            email: self.email.clone(),
            imap_host: self.imap_host.clone(),
            imap_port: self.imap_port,
            smtp_host: self.smtp_host.clone(),
            smtp_port: self.smtp_port,
            check_interval_sec: self.check_interval_sec,
            empty_trash_on_exit: self.empty_trash_on_exit,
        }
    }

    pub fn config(&self) -> AccountConfig {
        AccountConfig {
            host: self.imap_host.clone(),
            port: self.imap_port,
            smtp_host: self.smtp_host.clone(),
            smtp_port: self.smtp_port,
            user: self.email.clone(),
            password: self.password.clone(),
        }
    }
}

/// SMTP-хост по IMAP-хосту: "imap.X" -> "smtp.X"; иначе — без изменений.
fn derive_smtp_host(host: &str) -> String {
    match host.strip_prefix("imap.") {
        Some(rest) => format!("smtp.{rest}"),
        None => host.to_string(),
    }
}

/// Путь к файлу со списком ящиков.
pub fn accounts_path() -> Result<PathBuf, MailError> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| MailError::Config("переменная APPDATA недоступна".into()))?;
    Ok(PathBuf::from(appdata)
        .join("Soroka")
        .join("accounts.json"))
}

fn str_field(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn num_field(v: &serde_json::Value, key: &str, default: u16) -> u16 {
    v.get(key)
        .and_then(|x| x.as_u64())
        .filter(|n| *n > 0 && *n <= u16::MAX as u64)
        .map(|n| n as u16)
        .unwrap_or(default)
}

/// Разбирает один объект настроек. Понимает и старый формат account.json
/// (без id), и новый элемент массива accounts.json.
fn parse_account(v: &serde_json::Value, fallback_id: &str) -> Option<Account> {
    let email = str_field(v, "email")?;
    let imap_host = str_field(v, "imap_host").unwrap_or_else(|| DEFAULT_IMAP_HOST.to_string());
    let smtp_host = str_field(v, "smtp_host").unwrap_or_else(|| derive_smtp_host(&imap_host));
    Some(Account {
        id: str_field(v, "id").unwrap_or_else(|| fallback_id.to_string()),
        email,
        password: v
            .get("password")
            .and_then(|x| x.as_str())
            .unwrap_or_default()
            .to_string(),
        imap_port: num_field(v, "imap_port", DEFAULT_IMAP_PORT),
        smtp_host,
        smtp_port: num_field(v, "smtp_port", DEFAULT_SMTP_PORT),
        imap_host,
        check_interval_sec: v
            .get("check_interval_sec")
            .and_then(|x| x.as_u64())
            .unwrap_or(0)
            .min(86_400) as u32,
        empty_trash_on_exit: v
            .get("empty_trash_on_exit")
            .and_then(|x| x.as_bool())
            .unwrap_or(false),
    })
}

/// Читает список ящиков из файла (старый одиночный объект тоже понимает).
pub fn load_accounts_from(path: &Path) -> Vec<Account> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let raw = raw.trim_start_matches('\u{feff}');
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let items: Vec<serde_json::Value> = if let Some(arr) = v.as_array() {
        arr.clone()
    } else if let Some(arr) = v.get("accounts").and_then(|x| x.as_array()) {
        arr.clone()
    } else if v.get("email").is_some() {
        vec![v]
    } else {
        Vec::new()
    };
    let mut out = Vec::new();
    for (i, item) in items.iter().enumerate() {
        if let Some(a) = parse_account(item, &(i + 1).to_string()) {
            out.push(a);
        }
    }
    out
}

/// Записывает список ящиков в файл.
pub fn save_accounts_to(path: &Path, list: &[Account]) -> Result<(), MailError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| MailError::Config(format!("создать папку настроек: {e}")))?;
    }
    let data = serde_json::json!({ "accounts": list });
    let text = serde_json::to_string_pretty(&data)
        .map_err(|e| MailError::Config(format!("accounts.json: {e}")))?;
    std::fs::write(path, text)
        .map_err(|e| MailError::Config(format!("записать {}: {e}", path.display())))
}

/// Ящики приложения: env (одна учётка) -> accounts.json -> миграция account.json.
pub fn load_accounts() -> Vec<Account> {
    let env_smtp_host = std::env::var("SOROKA_SMTP_HOST").ok();
    let env_smtp_port = std::env::var("SOROKA_SMTP_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok());
    if let (Ok(user), Ok(password)) = (
        std::env::var("SOROKA_IMAP_USER"),
        std::env::var("SOROKA_IMAP_PASS"),
    ) {
        let imap_host =
            std::env::var("SOROKA_IMAP_HOST").unwrap_or_else(|_| DEFAULT_IMAP_HOST.to_string());
        let imap_port = std::env::var("SOROKA_IMAP_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(DEFAULT_IMAP_PORT);
        return vec![Account {
            id: "1".to_string(),
            email: user,
            password,
            smtp_host: env_smtp_host.unwrap_or_else(|| derive_smtp_host(&imap_host)),
            smtp_port: env_smtp_port.unwrap_or(DEFAULT_SMTP_PORT),
            imap_host,
            imap_port,
            check_interval_sec: 0,
            empty_trash_on_exit: false,
        }];
    }

    let Ok(path) = accounts_path() else {
        return Vec::new();
    };
    let mut list = load_accounts_from(&path);
    if list.is_empty()
        && let Some(dir) = path.parent()
    {
        let legacy = load_accounts_from(&dir.join("account.json"));
        if !legacy.is_empty() {
            let _ = save_accounts_to(&path, &legacy);
            list = legacy;
        }
    }
    list
}

/// Сохраняет список ящиков, возвращает путь к файлу.
pub fn save_accounts(list: &[Account]) -> Result<String, MailError> {
    let path = accounts_path()?;
    save_accounts_to(&path, list)?;
    Ok(path.display().to_string())
}

pub fn account_by_id(id: &str) -> Option<Account> {
    load_accounts().into_iter().find(|a| a.id == id)
}

pub fn first_account() -> Option<Account> {
    load_accounts().into_iter().next()
}

/// Добавляет новый ящик или обновляет существующий.
/// Возвращает (ящик, создан_ли_новый). Пустой пароль у существующего = не менять.
#[allow(clippy::too_many_arguments)]
pub fn upsert_account(
    id: Option<&str>,
    email: &str,
    password: Option<&str>,
    imap_host: &str,
    imap_port: u16,
    smtp_host: &str,
    smtp_port: u16,
    check_interval_sec: u32,
    empty_trash_on_exit: bool,
) -> Result<(Account, bool), MailError> {
    let mut list = load_accounts();
    let new_password = password
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(str::to_string);
    match id.map(str::trim).filter(|s| !s.is_empty()) {
        Some(id) => {
            let idx = list
                .iter()
                .position(|a| a.id == id)
                .ok_or_else(|| MailError::Config("ящик не найден — обновите список".into()))?;
            let mut acc = list[idx].clone();
            acc.email = email.to_string();
            acc.imap_host = imap_host.to_string();
            acc.imap_port = imap_port;
            acc.smtp_host = smtp_host.to_string();
            acc.smtp_port = smtp_port;
            acc.check_interval_sec = check_interval_sec;
            acc.empty_trash_on_exit = empty_trash_on_exit;
            if let Some(p) = new_password {
                acc.password = p;
            }
            list[idx] = acc.clone();
            save_accounts(&list)?;
            Ok((acc, false))
        }
        None => {
            let password =
                new_password.ok_or_else(|| MailError::Config("укажите пароль".into()))?;
            let next: u32 = list
                .iter()
                .filter_map(|a| a.id.parse::<u32>().ok())
                .max()
                .unwrap_or(0)
                + 1;
            let acc = Account {
                id: next.to_string(),
                email: email.to_string(),
                password,
                imap_host: imap_host.to_string(),
                imap_port,
                smtp_host: smtp_host.to_string(),
                smtp_port,
                check_interval_sec,
                empty_trash_on_exit,
            };
            list.push(acc.clone());
            save_accounts(&list)?;
            Ok((acc, true))
        }
    }
}

/// Ключ папки: "id::ИМЯ" — к какому ящику относится папка и её письма.
pub fn folder_key(account_id: &str, folder: &str) -> String {
    format!("{account_id}::{folder}")
}

/// Разбирает ключ папки. Записи без "::" — папка без ящика (старый кэш).
pub fn split_key(key: &str) -> (Option<String>, String) {
    match key.split_once("::") {
        Some((id, name)) if !id.trim().is_empty() => (Some(id.to_string()), name.to_string()),
        _ => (None, key.to_string()),
    }
}

/// Настройки подключения по ключу папки (или по имени папки первого ящика).
pub fn resolve_cfg(key: &str) -> Result<(Account, String), MailError> {
    let (id, folder) = split_key(key);
    let account = match id {
        Some(id) => account_by_id(&id)
            .ok_or_else(|| MailError::Config(format!("ящик {id} не найден в настройках")))?,
        None => first_account().ok_or(MailError::NoCredentials)?,
    };
    Ok((account, folder))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, email: &str) -> Account {
        Account {
            id: id.to_string(),
            email: email.to_string(),
            password: "секрет".to_string(),
            imap_host: "imap.mail.ru".to_string(),
            imap_port: 993,
            smtp_host: "smtp.mail.ru".to_string(),
            smtp_port: 465,
            check_interval_sec: 0,
            empty_trash_on_exit: false,
        }
    }

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("soroka-test-{}-{name}.json", std::process::id()))
    }

    #[test]
    fn saves_and_loads_list() {
        let path = temp_path("accounts");
        let _ = std::fs::remove_file(&path);
        let list = vec![sample("1", "a@mail.ru"), sample("2", "b@yandex.ru")];
        save_accounts_to(&path, &list).expect("сохранить");
        let back = load_accounts_from(&path);
        assert_eq!(back.len(), 2);
        assert_eq!(back[1].email, "b@yandex.ru");
        assert_eq!(back[1].id, "2");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn migrates_single_legacy_account() {
        let path = temp_path("legacy");
        let _ = std::fs::remove_file(&path);
        let legacy = serde_json::json!({
            "email": "one@mail.ru",
            "password": "пароль",
            "imap_host": "imap.yandex.ru",
            "imap_port": 993
        });
        std::fs::write(&path, serde_json::to_string(&legacy).unwrap()).unwrap();
        let back = load_accounts_from(&path);
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].id, "1");
        assert_eq!(back[0].imap_host, "imap.yandex.ru");
        assert_eq!(back[0].smtp_host, "smtp.yandex.ru");
        assert_eq!(back[0].smtp_port, 465);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn folder_key_roundtrip() {
        let key = folder_key("2", "INBOX/ToMySelf");
        assert_eq!(key, "2::INBOX/ToMySelf");
        let (id, name) = split_key(&key);
        assert_eq!(id.as_deref(), Some("2"));
        assert_eq!(name, "INBOX/ToMySelf");
        // старый формат без ящика
        let (id, name) = split_key("INBOX");
        assert!(id.is_none());
        assert_eq!(name, "INBOX");
    }
}

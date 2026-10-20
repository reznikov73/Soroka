//! Локальный кэш (SQLite): письма, папки, метаданные (TASK-003).
//! БД: %APPDATA%\Soroka\soroka.db — вне репозитория.

use super::MailError;
use super::body::AttachmentMeta;
use super::contacts::{AddressSuggestion, Contact, extract_email, extract_name, is_noise_folder};
use super::imap::{FolderInfo, MessageHeader};
use crate::ai::gigachat::AiAnalysis;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Черновик письма (TASK-022): локальная копия и UID на сервере.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftRecord {
    pub account: String,
    pub id: String,
    pub folder: String,
    pub uid: Option<u32>,
    pub to_addr: String,
    pub subject: String,
    pub body: String,
    pub attachments: Option<String>,
    pub updated_at: i64,
}

/// Данные, прочитанные из кэша.
pub struct CachedMail {
    pub total: u32,
    pub messages: Vec<MessageHeader>,
    pub folders: Vec<FolderInfo>,
    pub last_sync: Option<i64>,
    /// Ящик, к которому относится кэш писем (TASK-016).
    pub account: Option<String>,
}

/// Тело письма из кэша.
pub struct CachedBody {
    pub text: Option<String>,
    pub html: Option<String>,
    pub truncated: bool,
    pub attachments: Vec<AttachmentMeta>,
    pub fetched_at: i64,
}

/// Письмо, найденное поиском по всем папкам ящика — TASK-033.
#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub folder: String,
    pub uid: u32,
    pub subject: String,
    pub from: String,
    pub date: String,
    pub seen: bool,
    pub flagged: bool,
    pub has_attachments: bool,
}

pub struct Store {
    conn: Connection,
}

fn db_path() -> Result<PathBuf, MailError> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| MailError::Config("переменная APPDATA недоступна".into()))?;
    Ok(PathBuf::from(appdata).join("Soroka").join("soroka.db"))
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl Store {
    /// Открывает (при необходимости создаёт) БД в %APPDATA%\Soroka\soroka.db.
    pub fn open_default() -> Result<Self, MailError> {
        let path = db_path()?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| {
                MailError::Store(format!("не создать папку {}: {e}", dir.display()))
            })?;
        }
        let conn = Connection::open(&path)
            .map_err(|e| MailError::Store(format!("не открыть БД {}: {e}", path.display())))?;
        let mut store = Store { conn };
        store.init()?;
        Ok(store)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, MailError> {
        let conn = Connection::open_in_memory().map_err(|e| MailError::Store(e.to_string()))?;
        let mut store = Store { conn };
        store.init()?;
        Ok(store)
    }

    fn init(&mut self) -> Result<(), MailError> {
        self.conn
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS messages (
                    folder TEXT NOT NULL,
                    uid INTEGER NOT NULL,
                    seq INTEGER NOT NULL,
                    from_addr TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    date TEXT NOT NULL,
                    seen INTEGER NOT NULL DEFAULT 0,
                    flagged INTEGER NOT NULL DEFAULT 0,
                    has_attachments INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (folder, uid)
                );
                CREATE TABLE IF NOT EXISTS folder_stats (
                    folder TEXT PRIMARY KEY,
                    total INTEGER NOT NULL DEFAULT 0,
                    unseen INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS folders (name TEXT PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS bodies (
                    folder TEXT NOT NULL,
                    uid INTEGER NOT NULL,
                    text TEXT,
                    html TEXT,
                    truncated INTEGER NOT NULL DEFAULT 0,
                    fetched_at INTEGER NOT NULL,
                    PRIMARY KEY (folder, uid)
                );
                CREATE TABLE IF NOT EXISTS ai_analysis (
                    folder TEXT NOT NULL,
                    uid INTEGER NOT NULL,
                    json TEXT NOT NULL,
                    analyzed_at INTEGER NOT NULL,
                    subject TEXT,
                    PRIMARY KEY (folder, uid)
                );

                CREATE TABLE IF NOT EXISTS calendar_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    start_date TEXT NOT NULL,
                    end_date TEXT,
                    start_time TEXT,
                    description TEXT NOT NULL DEFAULT '',
                    source_folder TEXT,
                    source_uid INTEGER,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS blacklist (
                    domain TEXT PRIMARY KEY,
                    added_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS translations (
                    folder TEXT NOT NULL,
                    uid INTEGER NOT NULL,
                    lang TEXT NOT NULL,
                    text TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    PRIMARY KEY (folder, uid, lang)
                );
                CREATE TABLE IF NOT EXISTS contacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL DEFAULT '',
                    email TEXT NOT NULL,
                    organization TEXT NOT NULL DEFAULT '',
                    position TEXT NOT NULL DEFAULT '',
                    phone TEXT NOT NULL DEFAULT '',
                    notes TEXT NOT NULL DEFAULT '',
                    groups TEXT NOT NULL DEFAULT '',
                    updated_at INTEGER NOT NULL DEFAULT 0
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email
                    ON contacts(email COLLATE NOCASE);

                CREATE TABLE IF NOT EXISTS drafts (
                    account TEXT NOT NULL,
                    id TEXT NOT NULL,
                    folder TEXT NOT NULL DEFAULT '',
                    uid INTEGER,
                    to_addr TEXT NOT NULL DEFAULT '',
                    subject TEXT NOT NULL DEFAULT '',
                    body TEXT NOT NULL DEFAULT '',
                    attachments TEXT,
                    updated_at INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (account, id)
                );",
            )
            .map_err(|e| MailError::Store(e.to_string()))?;

        // Миграция TASK-019: кэш писем по папкам — ключ (folder, uid).
        // Старый кэш относился к одной папке и всё равно перезаписывался
        // синхронизацией, поэтому его проще пересоздать.
        let has_folder: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'folder'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .map_err(|e| MailError::Store(e.to_string()))?;
        if !has_folder {
            self.conn
                .execute_batch(
                    "ALTER TABLE messages RENAME TO messages_legacy;
                     CREATE TABLE messages (
                        folder TEXT NOT NULL,
                        uid INTEGER NOT NULL,
                        seq INTEGER NOT NULL,
                        from_addr TEXT NOT NULL,
                        subject TEXT NOT NULL,
                        date TEXT NOT NULL,
                        seen INTEGER NOT NULL DEFAULT 0,
                        flagged INTEGER NOT NULL DEFAULT 0,
                        has_attachments INTEGER NOT NULL DEFAULT 0,
                        PRIMARY KEY (folder, uid)
                     );
                     DROP TABLE messages_legacy;",
                )
                .map_err(|e| MailError::Store(e.to_string()))?;
        }

        // Миграция TASK-006: колонка attachments (вложения) для существующих БД.
        let has_attachments: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('bodies') WHERE name = 'attachments'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .map_err(|e| MailError::Store(e.to_string()))?;
        if !has_attachments {
            self.conn
                .execute_batch("ALTER TABLE bodies ADD COLUMN attachments TEXT")
                .map_err(|e| MailError::Store(e.to_string()))?;
        }

        // Миграция TASK-008: колонка seen (прочитано) у messages.
        let has_seen: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'seen'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .map_err(|e| MailError::Store(e.to_string()))?;
        if !has_seen {
            self.conn
                .execute_batch("ALTER TABLE messages ADD COLUMN seen INTEGER NOT NULL DEFAULT 0")
                .map_err(|e| MailError::Store(e.to_string()))?;
        }

        // Миграция TASK-010: колонка flagged (важное) у messages.
        let has_flagged: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'flagged'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .map_err(|e| MailError::Store(e.to_string()))?;
        if !has_flagged {
            self.conn
                .execute_batch("ALTER TABLE messages ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0")
                .map_err(|e| MailError::Store(e.to_string()))?;
        }

        // Миграция TASK-023: признак вложений у messages.
        let has_attach_flag: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'has_attachments'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .map_err(|e| MailError::Store(e.to_string()))?;
        if !has_attach_flag {
            self.conn
                .execute_batch(
                    "ALTER TABLE messages ADD COLUMN has_attachments INTEGER NOT NULL DEFAULT 0",
                )
                .map_err(|e| MailError::Store(e.to_string()))?;
        }

        // Миграция TASK-013: колонка subject (тема) у ai_analysis — для календаря.
        let has_ai_subject: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('ai_analysis') WHERE name = 'subject'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .map_err(|e| MailError::Store(e.to_string()))?;
        if !has_ai_subject {
            self.conn
                .execute_batch("ALTER TABLE ai_analysis ADD COLUMN subject TEXT")
                .map_err(|e| MailError::Store(e.to_string()))?;
        }

        // Миграция TASK-021: колонка delimiter (разделитель вложенных папок).
        let has_delimiter: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('folders') WHERE name = 'delimiter'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .map_err(|e| MailError::Store(e.to_string()))?;
        if !has_delimiter {
            self.conn
                .execute_batch("ALTER TABLE folders ADD COLUMN delimiter TEXT")
                .map_err(|e| MailError::Store(e.to_string()))?;
        }

        // Миграция TASK-022: признак папки черновиков (\Drafts).
        let has_is_drafts: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('folders') WHERE name = 'is_drafts'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .map_err(|e| MailError::Store(e.to_string()))?;
        if !has_is_drafts {
            self.conn
                .execute_batch("ALTER TABLE folders ADD COLUMN is_drafts INTEGER NOT NULL DEFAULT 0")
                .map_err(|e| MailError::Store(e.to_string()))?;
        }
        Ok(())
    }

    /// Полная замена кэша INBOX ящика + списка папок (TASK-016, TASK-019).
    pub fn save_sync(
        &mut self,
        account_id: &str,
        total: u32,
        messages: &[MessageHeader],
        folders: &[FolderInfo],
    ) -> Result<(), MailError> {
        let inbox = format!("{account_id}::INBOX");
        // Защита от затирания кэша пустым ответом сервера (TASK-026):
        // «Bye Response» или сбой сети не должны стирать уже загруженные письма.
        if messages.is_empty() && total == 0 {
            let cached: i64 = self
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM messages WHERE folder = ?1",
                    params![inbox],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if cached > 0 {
                return Err(MailError::Protocol(
                    "сервер вернул пустой список — кэш оставлен как есть".to_string(),
                ));
            }
        }
        let unseen = messages.iter().filter(|m| !m.seen).count() as u32;
        self.save_folder_sync(&inbox, total, unseen, messages)?;
        self.save_folders(account_id, folders)?;
        self.set_meta(account_id, &inbox, total)?;
        Ok(())
    }

    /// Полная замена кэша одной папки (TASK-019).
    pub fn save_folder_sync(
        &mut self,
        folder_key: &str,
        total: u32,
        unseen: u32,
        messages: &[MessageHeader],
    ) -> Result<(), MailError> {
        let tx = self
            .conn
            .transaction()
            .map_err(|e| MailError::Store(e.to_string()))?;
        tx.execute("DELETE FROM messages WHERE folder = ?1", params![folder_key])
            .map_err(|e| MailError::Store(e.to_string()))?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT OR REPLACE INTO messages
                        (folder, uid, seq, from_addr, subject, date, seen, flagged, has_attachments)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                )
                .map_err(|e| MailError::Store(e.to_string()))?;
            for m in messages {
                stmt.execute(params![
                    folder_key,
                    m.uid as i64,
                    m.seq as i64,
                    m.from,
                    m.subject,
                    m.date,
                    m.seen,
                    m.flagged,
                    m.has_attachments
                ])
                .map_err(|e| MailError::Store(e.to_string()))?;
            }
        }
        tx.execute(
            "INSERT OR REPLACE INTO folder_stats (folder, total, unseen, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![folder_key, total, unseen, now_unix()],
        )
        .map_err(|e| MailError::Store(e.to_string()))?;
        tx.commit().map_err(|e| MailError::Store(e.to_string()))
    }

    /// Все счётчики папок: (ключ, всего, непрочитанных) — TASK-021.
    pub fn folder_stats_all(&self, like: &str) -> Result<Vec<(String, u32, u32)>, MailError> {
        let mut stmt = self
            .conn
            .prepare("SELECT folder, total, unseen FROM folder_stats WHERE folder LIKE ?1")
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map(params![like], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)? as u32,
                    r.get::<_, i64>(2)? as u32,
                ))
            })
            .map_err(|e| MailError::Store(e.to_string()))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| MailError::Store(e.to_string()))?);
        }
        Ok(out)
    }

    /// Убрать письмо из кэша после удаления (TASK-021).
    pub fn remove_message(&self, folder_key: &str, uid: u32) -> Result<(), MailError> {
        self.conn
            .execute(
                "DELETE FROM messages WHERE folder = ?1 AND uid = ?2",
                params![folder_key, uid as i64],
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        self.conn
            .execute(
                "DELETE FROM bodies WHERE folder = ?1 AND uid = ?2",
                params![folder_key, uid as i64],
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        self.conn
            .execute(
                "UPDATE folder_stats SET total = MAX(0, total - 1) WHERE folder = ?1",
                params![folder_key],
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        Ok(())
    }

    /// Очистить кэш папки (после очистки корзины) — TASK-021.
    pub fn clear_folder_messages(&self, folder_key: &str) -> Result<(), MailError> {
        self.conn
            .execute("DELETE FROM messages WHERE folder = ?1", params![folder_key])
            .map_err(|e| MailError::Store(e.to_string()))?;
        self.conn
            .execute("DELETE FROM bodies WHERE folder = ?1", params![folder_key])
            .map_err(|e| MailError::Store(e.to_string()))?;
        self.conn
            .execute(
                "UPDATE folder_stats SET total = 0, unseen = 0 WHERE folder = ?1",
                params![folder_key],
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        Ok(())
    }

    /// Список папок ящика (TASK-019).
    pub fn save_folders(
        &mut self,
        account_id: &str,
        folders: &[FolderInfo],
    ) -> Result<(), MailError> {
        let tx = self
            .conn
            .transaction()
            .map_err(|e| MailError::Store(e.to_string()))?;
        tx.execute(
            "DELETE FROM folders WHERE name LIKE ?1",
            params![format!("{account_id}::%")],
        )
        .map_err(|e| MailError::Store(e.to_string()))?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT OR REPLACE INTO folders (name, delimiter, is_drafts) VALUES (?1, ?2, ?3)",
                )
                .map_err(|e| MailError::Store(e.to_string()))?;
            for f in folders {
                stmt.execute(params![f.name, f.delimiter, f.is_drafts])
                    .map_err(|e| MailError::Store(e.to_string()))?;
            }
        }
        tx.commit().map_err(|e| MailError::Store(e.to_string()))?;
        // TASK-035: папку удалили на сервере — убираем её кэш, чтобы она не висела в дереве.
        let keep: Vec<String> = folders.iter().map(|f| f.name.clone()).collect();
        let gone = self.prune_folders(account_id, &keep)?;
        if !gone.is_empty() {
            tracing::info!("папки, удалённые на сервере: {}", gone.join(", "));
        }
        Ok(())
    }

    /// Удаляет из кэша папки ящика, которых больше нет на сервере (TASK-035).
    /// Возвращает ключи удалённых папок.
    pub fn prune_folders(
        &mut self,
        account_id: &str,
        keep: &[String],
    ) -> Result<Vec<String>, MailError> {
        let prefix = format!("{account_id}::");
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT folder FROM messages WHERE folder LIKE ?1")
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map(params![format!("{prefix}%")], |r| r.get::<_, String>(0))
            .map_err(|e| MailError::Store(e.to_string()))?;
        let mut gone: Vec<String> = Vec::new();
        for row in rows {
            let key = row.map_err(|e| MailError::Store(e.to_string()))?;
            if !keep.iter().any(|k| k == &key) {
                gone.push(key);
            }
        }
        for key in &gone {
            self.conn
                .execute("DELETE FROM messages WHERE folder = ?1", params![key])
                .map_err(|e| MailError::Store(e.to_string()))?;
            self.conn
                .execute("DELETE FROM bodies WHERE folder = ?1", params![key])
                .map_err(|e| MailError::Store(e.to_string()))?;
            self.conn
                .execute("DELETE FROM folder_stats WHERE folder = ?1", params![key])
                .map_err(|e| MailError::Store(e.to_string()))?;
        }
        Ok(gone)
    }

    /// Метаданные последней синхронизации (TASK-019).
    pub fn set_meta(
        &mut self,
        account_id: &str,
        folder_key: &str,
        total: u32,
    ) -> Result<(), MailError> {
        let pairs = [
            ("total", total.to_string()),
            ("last_sync", now_unix().to_string()),
            ("account", account_id.to_string()),
            ("folder", folder_key.to_string()),
        ];
        for (k, v) in pairs {
            self.conn
                .execute(
                    "INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)",
                    params![k, v],
                )
                .map_err(|e| MailError::Store(e.to_string()))?;
        }
        Ok(())
    }

    /// Письма папки из кэша — новые сверху (TASK-019).
    pub fn load_folder(&self, folder_key: &str) -> Result<Vec<MessageHeader>, MailError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT uid, seq, from_addr, subject, date, seen, flagged, has_attachments
                 FROM messages WHERE folder = ?1 ORDER BY seq DESC",
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map(params![folder_key], |row| {
                Ok(MessageHeader {
                    uid: row.get::<_, i64>(0)? as u32,
                    seq: row.get::<_, i64>(1)? as u32,
                    from: row.get::<_, String>(2)?,
                    subject: row.get::<_, String>(3)?,
                    date: row.get::<_, String>(4)?,
                    seen: row.get::<_, bool>(5)?,
                    flagged: row.get::<_, bool>(6)?,
                    has_attachments: row.get::<_, bool>(7)?,
                })
            })
            .map_err(|e| MailError::Store(e.to_string()))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| MailError::Store(e.to_string()))?);
        }
        Ok(out)
    }

    /// Всего писем в папке по кэшу (TASK-019).
    pub fn folder_total(&self, folder_key: &str) -> u32 {
        self.conn
            .query_row(
                "SELECT total FROM folder_stats WHERE folder = ?1",
                params![folder_key],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n as u32)
            .unwrap_or(0)
    }

    /// Обновляет счётчики папки (TASK-019).
    pub fn set_folder_stat(
        &self,
        folder_key: &str,
        total: u32,
        unseen: u32,
    ) -> Result<(), MailError> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO folder_stats (folder, total, unseen, updated_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![folder_key, total, unseen, now_unix()],
            )
            .map_err(|e| MailError::Store(e.to_string()))
            .map(|_| ())
    }

    /// Непрочитанные по папкам (TASK-019).
    pub fn unread_counts(&self, like: &str) -> Result<Vec<(String, u32)>, MailError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT folder, unseen FROM folder_stats
                 WHERE unseen > 0 AND folder LIKE ?1",
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map(params![like], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u32))
            })
            .map_err(|e| MailError::Store(e.to_string()))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| MailError::Store(e.to_string()))?);
        }
        Ok(out)
    }

    /// Папки из кэша по префиксу ящика (TASK-019).
    pub fn load_folders(&self, like: &str) -> Result<Vec<FolderInfo>, MailError> {
        let mut stmt = self
            .conn
            .prepare("SELECT name, delimiter, is_drafts FROM folders WHERE name LIKE ?1")
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map(params![like], |r| {
                Ok(FolderInfo {
                    name: r.get::<_, String>(0)?,
                    delimiter: r.get::<_, Option<String>>(1)?,
                    is_drafts: r.get::<_, i64>(2)? != 0,
                })
            })
            .map_err(|e| MailError::Store(e.to_string()))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| MailError::Store(e.to_string()))?);
        }
        Ok(out)
    }

    /// Читает кэш последней синхронизированной папки. `None` — если синхронизации не было.
    pub fn load(&self) -> Result<Option<CachedMail>, MailError> {
        let last_sync: Option<i64> = self
            .conn
            .query_row("SELECT value FROM meta WHERE key='last_sync'", [], |r| {
                r.get::<_, String>(0)
            })
            .ok()
            .and_then(|s| s.parse().ok());
        if last_sync.is_none() {
            return Ok(None);
        }
        let total: u32 = self
            .conn
            .query_row("SELECT value FROM meta WHERE key='total'", [], |r| {
                r.get::<_, String>(0)
            })
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let folder_key: Option<String> = self
            .conn
            .query_row("SELECT value FROM meta WHERE key='folder'", [], |r| {
                r.get::<_, String>(0)
            })
            .ok();
        let messages = match folder_key {
            Some(key) => self.load_folder(&key)?,
            None => Vec::new(),
        };

        let mut folders = Vec::new();
        {
            let mut stmt = self
                .conn
                .prepare("SELECT name, delimiter, is_drafts FROM folders ORDER BY (name <> 'INBOX'), name COLLATE NOCASE")
                .map_err(|e| MailError::Store(e.to_string()))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(FolderInfo {
                        name: row.get::<_, String>(0)?,
                        delimiter: row.get::<_, Option<String>>(1)?,
                        is_drafts: row.get::<_, i64>(2)? != 0,
                    })
                })
                .map_err(|e| MailError::Store(e.to_string()))?;
            for r in rows {
                folders.push(r.map_err(|e| MailError::Store(e.to_string()))?);
            }
        }

        let account: Option<String> = self
            .conn
            .query_row("SELECT value FROM meta WHERE key='account'", [], |r| {
                r.get::<_, String>(0)
            })
            .ok();
        Ok(Some(CachedMail {
            total,
            messages,
            folders,
            last_sync,
            account,
        }))
    }

    /// Сохраняет тело письма (обновляет при повторной записи).
    pub fn save_body(
        &self,
        folder: &str,
        uid: u32,
        text: Option<&str>,
        html: Option<&str>,
        truncated: bool,
        attachments: &[AttachmentMeta],
    ) -> Result<(), MailError> {
        let att_json =
            serde_json::to_string(attachments).map_err(|e| MailError::Store(e.to_string()))?;
        self.conn
            .execute(
                "INSERT OR REPLACE INTO bodies
                 (folder, uid, text, html, truncated, attachments, fetched_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    folder,
                    uid as i64,
                    text,
                    html,
                    truncated,
                    att_json,
                    now_unix()
                ],
            )
            .map_err(|e| MailError::Store(e.to_string()))
            .map(|_| ())
    }

    /// Обновляет флаг «важное» у письма в кэше папки (TASK-010, TASK-019).
    pub fn mark_flagged(
        &self,
        folder_key: &str,
        uid: u32,
        flagged: bool,
    ) -> Result<(), MailError> {
        self.conn
            .execute(
                "UPDATE messages SET flagged = ?1 WHERE folder = ?2 AND uid = ?3",
                params![flagged, folder_key, uid as i64],
            )
            .map_err(|e| MailError::Store(e.to_string()))
            .map(|_| ())
    }

    /// Сохраняет ИИ-разбор письма (TASK-010; тема — TASK-013).
    pub fn save_analysis(
        &self,
        folder: &str,
        uid: u32,
        subject: Option<&str>,
        a: &AiAnalysis,
    ) -> Result<(), MailError> {
        let json = serde_json::to_string(a).map_err(|e| MailError::Store(e.to_string()))?;
        self.conn
            .execute(
                "INSERT OR REPLACE INTO ai_analysis (folder, uid, json, analyzed_at, subject)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![folder, uid as i64, json, now_unix(), subject],
            )
            .map_err(|e| MailError::Store(e.to_string()))
            .map(|_| ())
    }

    /// Черновик письма: локальная копия + UID на сервере (TASK-022).
    pub fn save_draft(&mut self, d: &DraftRecord) -> Result<(), MailError> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO drafts
                 (account, id, folder, uid, to_addr, subject, body, attachments, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    d.account,
                    d.id,
                    d.folder,
                    d.uid,
                    d.to_addr,
                    d.subject,
                    d.body,
                    d.attachments,
                    d.updated_at
                ],
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        Ok(())
    }

    /// Все черновики ящика, свежие сверху (TASK-022).
    pub fn load_drafts(&self, account: &str) -> Result<Vec<DraftRecord>, MailError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT account, id, folder, uid, to_addr, subject, body, attachments, updated_at
                 FROM drafts WHERE account = ?1 ORDER BY updated_at DESC",
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map(params![account], |r| {
                Ok(DraftRecord {
                    account: r.get(0)?,
                    id: r.get(1)?,
                    folder: r.get(2)?,
                    uid: r.get(3)?,
                    to_addr: r.get(4)?,
                    subject: r.get(5)?,
                    body: r.get(6)?,
                    attachments: r.get(7)?,
                    updated_at: r.get(8)?,
                })
            })
            .map_err(|e| MailError::Store(e.to_string()))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| MailError::Store(e.to_string()))?);
        }
        Ok(out)
    }

    /// Черновик по UID письма на сервере (для двойного клика в списке).
    pub fn draft_by_uid(&self, account: &str, uid: u32) -> Result<Option<DraftRecord>, MailError> {
        Ok(self
            .load_drafts(account)?
            .into_iter()
            .find(|d| d.uid == Some(uid)))
    }

    /// Удалить черновик из кэша (TASK-022).
    pub fn drop_draft(&mut self, account: &str, id: &str) -> Result<(), MailError> {
        self.conn
            .execute(
                "DELETE FROM drafts WHERE account = ?1 AND id = ?2",
                params![account, id],
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        Ok(())
    }

    /// Кэш перевода письма (TASK-020): модель повторно не вызывается.
    pub fn load_translation(
        &self,
        folder: &str,
        uid: u32,
        lang: &str,
    ) -> Result<Option<String>, MailError> {
        let mut stmt = self
            .conn
            .prepare("SELECT text FROM translations WHERE folder = ?1 AND uid = ?2 AND lang = ?3")
            .map_err(|e| MailError::Store(e.to_string()))?;
        let mut rows = stmt
            .query(rusqlite::params![folder, uid, lang])
            .map_err(|e| MailError::Store(e.to_string()))?;
        if let Some(row) = rows.next().map_err(|e| MailError::Store(e.to_string()))? {
            return Ok(Some(
                row.get::<_, String>(0)
                    .map_err(|e| MailError::Store(e.to_string()))?,
            ));
        }
        Ok(None)
    }

    /// Сохранить перевод письма (TASK-020).
    pub fn save_translation(
        &self,
        folder: &str,
        uid: u32,
        lang: &str,
        text: &str,
    ) -> Result<(), MailError> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO translations (folder, uid, lang, text, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![folder, uid, lang, text, now_unix()],
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        Ok(())
    }

    /// Читает ИИ-разбор письма.
    pub fn load_analysis(&self, folder: &str, uid: u32) -> Result<Option<AiAnalysis>, MailError> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT json FROM ai_analysis WHERE folder = ?1 AND uid = ?2",
                params![folder, uid as i64],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| MailError::Store(e.to_string()))?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
    }

    /// Все разборы папки (для списка).
    pub fn load_all_analyses(&self, folder: &str) -> Result<Vec<(u32, AiAnalysis)>, MailError> {
        let mut stmt = self
            .conn
            .prepare("SELECT uid, json FROM ai_analysis WHERE folder = ?1")
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map(params![folder], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| MailError::Store(e.to_string()))?;
        let mut out = Vec::new();
        for r in rows {
            let (uid, json) = r.map_err(|e| MailError::Store(e.to_string()))?;
            if let Ok(a) = serde_json::from_str::<AiAnalysis>(&json) {
                out.push((uid as u32, a));
            }
        }
        Ok(out)
    }

    /// Все разборы всех папок: (папка, uid, json, тема) — TASK-013 (календарь).
    pub fn load_analyses_all_folders(&self) -> Result<Vec<AnalysisRow>, MailError> {
        let mut stmt = self
            .conn
            .prepare("SELECT folder, uid, json, subject FROM ai_analysis ORDER BY uid DESC")
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(|e| MailError::Store(e.to_string()))?;
        let mut out = Vec::new();
        for r in rows {
            let (folder, uid, json, subject) = r.map_err(|e| MailError::Store(e.to_string()))?;
            out.push((folder, uid as u32, json, subject));
        }
        Ok(out)
    }

    /// Тема и отправитель письма из INBOX-кэша — TASK-013 (календарь).
    pub fn message_meta(&self, uid: u32) -> Result<Option<(String, String)>, MailError> {
        let row = self
            .conn
            .query_row(
                "SELECT subject, from_addr FROM messages WHERE uid = ?1",
                params![uid as i64],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|e| MailError::Store(e.to_string()))?;
        Ok(row)
    }

    /// Событие календаря: добавить (человек подтвердил) — TASK-013 (часть E).
    pub fn add_calendar_event(&self, ev: &CalendarEvent) -> Result<i64, MailError> {
        self.conn
            .execute(
                "INSERT INTO calendar_events
                   (title, start_date, end_date, start_time, description, source_folder, source_uid, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    ev.title.as_str(),
                    ev.start_date.as_str(),
                    ev.end_date.as_deref(),
                    ev.start_time.as_deref(),
                    ev.description.as_str(),
                    ev.source_folder.as_deref(),
                    ev.source_uid.map(|u| u as i64),
                    now_unix()
                ],
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Событие календаря: все сохранённые — TASK-013 (часть E).
    pub fn load_calendar_events(&self) -> Result<Vec<CalendarEvent>, MailError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, title, start_date, end_date, start_time, description, source_folder, source_uid
                 FROM calendar_events
                 ORDER BY start_date, start_time IS NULL, start_time, id",
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(CalendarEvent {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    start_date: r.get(2)?,
                    end_date: r.get(3)?,
                    start_time: r.get(4)?,
                    description: r.get(5)?,
                    source_folder: r.get(6)?,
                    source_uid: r.get::<_, Option<i64>>(7)?.map(|u| u as u32),
                })
            })
            .map_err(|e| MailError::Store(e.to_string()))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| MailError::Store(e.to_string()))?);
        }
        Ok(out)
    }

    /// Событие календаря: удалить — TASK-013 (часть E).
    pub fn delete_calendar_event(&self, id: i64) -> Result<(), MailError> {
        self.conn
            .execute("DELETE FROM calendar_events WHERE id = ?1", params![id])
            .map_err(|e| MailError::Store(e.to_string()))
            .map(|_| ())
    }

    /// Добавляет домен в локальный чёрный список (TASK-010).
    pub fn add_blacklist_domain(&self, domain: &str) -> Result<(), MailError> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO blacklist (domain, added_at) VALUES (?1, ?2)",
                params![domain, now_unix()],
            )
            .map_err(|e| MailError::Store(e.to_string()))
            .map(|_| ())
    }

    /// Обновляет флаг «прочитано» у письма в кэше папки (TASK-008, TASK-019).
    pub fn mark_seen(&self, folder_key: &str, uid: u32, seen: bool) -> Result<(), MailError> {
        let prev: Option<bool> = self
            .conn
            .query_row(
                "SELECT seen FROM messages WHERE folder = ?1 AND uid = ?2",
                params![folder_key, uid as i64],
                |r| r.get(0),
            )
            .ok();
        self.conn
            .execute(
                "UPDATE messages SET seen = ?1 WHERE folder = ?2 AND uid = ?3",
                params![seen, folder_key, uid as i64],
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        if let Some(prev) = prev
            && prev != seen
        {
            let delta: i64 = if seen { -1 } else { 1 };
            let _ = self.conn.execute(
                "UPDATE folder_stats SET unseen = MAX(0, unseen + ?1) WHERE folder = ?2",
                params![delta, folder_key],
            );
        }
        Ok(())
    }

    /// Читает тело письма из кэша.
    pub fn load_body(&self, folder: &str, uid: u32) -> Result<Option<CachedBody>, MailError> {
        self.conn
            .query_row(
                "SELECT text, html, truncated, attachments, fetched_at FROM bodies
                 WHERE folder = ?1 AND uid = ?2",
                params![folder, uid as i64],
                |row| {
                    let attachments = row
                        .get::<_, Option<String>>(3)?
                        .and_then(|s| serde_json::from_str(&s).ok())
                        .unwrap_or_default();
                    Ok(CachedBody {
                        text: row.get::<_, Option<String>>(0)?,
                        html: row.get::<_, Option<String>>(1)?,
                        truncated: row.get::<_, bool>(2)?,
                        attachments,
                        fetched_at: row.get::<_, i64>(4)?,
                    })
                },
            )
            .optional()
            .map_err(|e| MailError::Store(e.to_string()))
    }
}

/// Строка всех разборов: папка, uid, json, тема — TASK-013.
pub type AnalysisRow = (String, u32, String, Option<String>);

impl Store {
    // ===== TASK-024: адресная книга =====

    /// Все контакты, по алфавиту.
    pub fn load_contacts(&self) -> Result<Vec<Contact>, MailError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, name, email, organization, position, phone, notes, groups
                 FROM contacts
                 ORDER BY name COLLATE NOCASE, email COLLATE NOCASE",
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Contact {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    email: r.get(2)?,
                    organization: r.get(3)?,
                    position: r.get(4)?,
                    phone: r.get(5)?,
                    notes: r.get(6)?,
                    groups: r.get(7)?,
                })
            })
            .map_err(|e| MailError::Store(e.to_string()))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| MailError::Store(e.to_string()))?);
        }
        Ok(out)
    }

    /// Сохраняет контакт: по `id`, иначе по e-mail (без создания дублей).
    pub fn save_contact(&self, c: &Contact) -> Result<i64, MailError> {
        let email = extract_email(&c.email);
        if !email.contains('@') {
            return Err(MailError::Store("не похоже на e-mail".to_string()));
        }
        let now = now_unix();
        if c.id > 0 {
            self.conn
                .execute(
                    "UPDATE contacts SET name=?1, email=?2, organization=?3, position=?4,
                     phone=?5, notes=?6, groups=?7, updated_at=?8 WHERE id=?9",
                    params![
                        c.name.trim(),
                        email,
                        c.organization.trim(),
                        c.position.trim(),
                        c.phone.trim(),
                        c.notes.trim(),
                        c.groups.trim(),
                        now,
                        c.id
                    ],
                )
                .map_err(|e| MailError::Store(e.to_string()))?;
            return Ok(c.id);
        }
        let existing: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM contacts WHERE email = ?1 COLLATE NOCASE",
                params![email],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| MailError::Store(e.to_string()))?;
        if let Some(id) = existing {
            self.conn
                .execute(
                    "UPDATE contacts SET name=?1, email=?2, organization=?3, position=?4,
                     phone=?5, notes=?6, groups=?7, updated_at=?8 WHERE id=?9",
                    params![
                        c.name.trim(),
                        email,
                        c.organization.trim(),
                        c.position.trim(),
                        c.phone.trim(),
                        c.notes.trim(),
                        c.groups.trim(),
                        now,
                        id
                    ],
                )
                .map_err(|e| MailError::Store(e.to_string()))?;
            return Ok(id);
        }
        self.conn
            .execute(
                "INSERT INTO contacts (name, email, organization, position, phone, notes, groups, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    c.name.trim(),
                    email,
                    c.organization.trim(),
                    c.position.trim(),
                    c.phone.trim(),
                    c.notes.trim(),
                    c.groups.trim(),
                    now
                ],
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn delete_contact(&self, id: i64) -> Result<(), MailError> {
        self.conn
            .execute("DELETE FROM contacts WHERE id = ?1", params![id])
            .map_err(|e| MailError::Store(e.to_string()))?;
        Ok(())
    }

    /// Подсказки для поля «Кому»: сначала книга, затем переписка.
    /// Письма из спама, корзины и категории «Реклама» не учитываются.
    pub fn suggest_addresses(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<AddressSuggestion>, MailError> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let like = format!("%{q}%");
        let limit = limit.clamp(1, 20);
        let mut out: Vec<AddressSuggestion> = Vec::new();
        let mut seen: Vec<String> = Vec::new();

        let mut stmt = self
            .conn
            .prepare(
                "SELECT name, email FROM contacts
                 WHERE LOWER(email) LIKE ?1 OR LOWER(name) LIKE ?1 OR LOWER(organization) LIKE ?1
                 ORDER BY name COLLATE NOCASE LIMIT 30",
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map(params![like], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| MailError::Store(e.to_string()))?;
        for row in rows {
            let (name, email) = row.map_err(|e| MailError::Store(e.to_string()))?;
            let email = extract_email(&email);
            if email.is_empty() || seen.contains(&email) {
                continue;
            }
            seen.push(email.clone());
            out.push(AddressSuggestion {
                email,
                name,
                source: "contact".to_string(),
                count: 0,
            });
        }

        let clean = r#"LOWER(m.folder) NOT LIKE '%spam%'
                     AND LOWER(m.folder) NOT LIKE '%junk%'
                     AND LOWER(m.folder) NOT LIKE '%trash%'
                     AND LOWER(m.folder) NOT LIKE '%спам%'
                     AND LOWER(m.folder) NOT LIKE '%корзин%'
                     AND LOWER(m.folder) NOT LIKE '%удалён%'
                     AND LOWER(m.folder) NOT LIKE '%удален%'
                     AND NOT EXISTS (
                         SELECT 1 FROM ai_analysis a
                         WHERE a.folder = m.folder AND a.uid = m.uid
                           AND LOWER(a.json) LIKE '%"category":"реклама"%'
                     )"#;
        let sql = format!(
            "SELECT m.from_addr, COUNT(*) AS n FROM messages m
             WHERE LOWER(m.from_addr) LIKE ?1 AND {clean}
             GROUP BY LOWER(m.from_addr)
             ORDER BY n DESC LIMIT 200"
        );
        let mut stmt = self
            .conn
            .prepare(&sql)
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map(params![like], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(|e| MailError::Store(e.to_string()))?;
        for row in rows {
            let (raw, n) = row.map_err(|e| MailError::Store(e.to_string()))?;
            let email = extract_email(&raw);
            if email.is_empty() || seen.contains(&email) {
                continue;
            }
            seen.push(email.clone());
            out.push(AddressSuggestion {
                email,
                name: extract_name(&raw),
                source: "mail".to_string(),
                count: n.max(0) as u32,
            });
            if out.len() >= limit {
                break;
            }
        }

        out.truncate(limit);
        Ok(out)
    }

    /// Люди, с которыми была переписка, но которых нет в адресной книге (TASK-028).
    pub fn correspondence_contacts(
        &self,
        limit: usize,
    ) -> Result<Vec<AddressSuggestion>, MailError> {
        let limit = limit.clamp(1, 200);
        let mut known: Vec<String> = Vec::new();
        let mut stmt = self
            .conn
            .prepare("SELECT email FROM contacts")
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| MailError::Store(e.to_string()))?;
        for row in rows {
            let raw = row.map_err(|e| MailError::Store(e.to_string()))?;
            let email = extract_email(&raw);
            if !email.is_empty() {
                known.push(email);
            }
        }

        let clean = r#"LOWER(m.folder) NOT LIKE '%spam%'
                     AND LOWER(m.folder) NOT LIKE '%junk%'
                     AND LOWER(m.folder) NOT LIKE '%trash%'
                     AND LOWER(m.folder) NOT LIKE '%спам%'
                     AND LOWER(m.folder) NOT LIKE '%корзин%'
                     AND LOWER(m.folder) NOT LIKE '%удалён%'
                     AND LOWER(m.folder) NOT LIKE '%удален%'
                     AND NOT EXISTS (
                         SELECT 1 FROM ai_analysis a
                         WHERE a.folder = m.folder AND a.uid = m.uid
                           AND LOWER(a.json) LIKE '%"category":"реклама"%'
                     )"#;
        let sql = format!(
            "SELECT m.from_addr, COUNT(*) AS n, MAX(m.rowid) AS fresh FROM messages m
             WHERE m.from_addr <> '' AND {clean}
             GROUP BY LOWER(m.from_addr)
             ORDER BY n DESC, fresh DESC LIMIT 500"
        );
        let mut stmt = self
            .conn
            .prepare(&sql)
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(|e| MailError::Store(e.to_string()))?;
        let mut out: Vec<AddressSuggestion> = Vec::new();
        let mut seen: Vec<String> = Vec::new();
        for row in rows {
            let (raw, n) = row.map_err(|e| MailError::Store(e.to_string()))?;
            let email = extract_email(&raw);
            if email.is_empty() || seen.contains(&email) || known.contains(&email) {
                continue;
            }
            seen.push(email.clone());
            out.push(AddressSuggestion {
                email,
                name: extract_name(&raw),
                source: "mail".to_string(),
                count: n.max(0) as u32,
            });
            if out.len() >= limit {
                break;
            }
        }
        Ok(out)
    }

    /// Сколько писем связано с адресом и дата последнего (TASK-028).
    pub fn mail_stats(&self, email: &str) -> Result<(u32, String), MailError> {
        let email = extract_email(email);
        if email.is_empty() {
            return Ok((0, String::new()));
        }
        let like = format!("%{email}%");
        let count: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE LOWER(from_addr) LIKE ?1",
                params![like],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let last: String = self
            .conn
            .query_row(
                "SELECT date FROM messages WHERE LOWER(from_addr) LIKE ?1
                 ORDER BY rowid DESC LIMIT 1",
                params![like],
                |r| r.get(0),
            )
            .unwrap_or_default();
        Ok((count.max(0) as u32, last))
    }

    /// Поиск по теме и отправителю во всех папках ящика (по кэшу) — TASK-033.
    pub fn search_messages(
        &self,
        prefix: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<SearchHit>, MailError> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        // SQLite LOWER() понимает только латиницу, поэтому сравниваем в Rust:
        // иначе «Тест» не находится по запросу «тест».
        let mut stmt = self
            .conn
            .prepare(
                "SELECT folder, uid, subject, from_addr, date, seen, flagged, has_attachments
                 FROM messages
                 WHERE folder LIKE ?1
                 ORDER BY rowid DESC",
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map(params![format!("{prefix}%")], |r| {
                Ok(SearchHit {
                    folder: r.get(0)?,
                    uid: r.get::<_, i64>(1)? as u32,
                    subject: r.get(2)?,
                    from: r.get(3)?,
                    date: r.get(4)?,
                    seen: r.get::<_, i64>(5)? != 0,
                    flagged: r.get::<_, i64>(6)? != 0,
                    has_attachments: r.get::<_, i64>(7)? != 0,
                })
            })
            .map_err(|e| MailError::Store(e.to_string()))?;
        let needle = q.to_lowercase();
        let mut out = Vec::new();
        for row in rows {
            let hit = row.map_err(|e| MailError::Store(e.to_string()))?;
            if hit.subject.to_lowercase().contains(&needle)
                || hit.from.to_lowercase().contains(&needle)
            {
                out.push(hit);
                if out.len() >= limit {
                    break;
                }
            }
        }
        Ok(out)
    }

    /// Последнее письмо от адреса — для кнопки «Заполнить по письму».
    pub fn last_mail_from(&self, email: &str) -> Result<Option<(String, u32)>, MailError> {
        let email = extract_email(email);
        if email.is_empty() {
            return Ok(None);
        }
        let like = format!("%{email}%");
        let mut stmt = self
            .conn
            .prepare(
                "SELECT folder, uid FROM messages
                 WHERE LOWER(from_addr) LIKE ?1
                 ORDER BY rowid DESC LIMIT 20",
            )
            .map_err(|e| MailError::Store(e.to_string()))?;
        let rows = stmt
            .query_map(params![like], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(|e| MailError::Store(e.to_string()))?;
        for row in rows {
            let (folder, uid) = row.map_err(|e| MailError::Store(e.to_string()))?;
            if !is_noise_folder(&folder) {
                return Ok(Some((folder, uid.max(0) as u32)));
            }
        }
        Ok(None)
    }

    pub fn import_contacts(&self, list: &[Contact]) -> Result<usize, MailError> {
        let mut n = 0usize;
        for c in list {
            if c.email.contains('@') && self.save_contact(c).is_ok() {
                n += 1;
            }
        }
        Ok(n)
    }

}

/// Событие личного календаря, добавленное человеком — TASK-013 (часть E).
#[derive(Debug, Clone)]
pub struct CalendarEvent {
    pub id: i64,
    pub title: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub start_time: Option<String>,
    pub description: String,
    pub source_folder: Option<String>,
    pub source_uid: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::{CalendarEvent, Store};
    use crate::ai::gigachat::AiAnalysis;
    use crate::mail::imap::{FolderInfo, MessageHeader};

    fn msg(uid: u32, seq: u32) -> MessageHeader {
        MessageHeader {
            uid,
            seq,
            from: format!("from{uid}"),
            subject: format!("тема {uid}"),
            date: "Wed, 14 Oct 2026 20:00:00 +0300".to_string(),
            seen: false,
            flagged: false,
            has_attachments: false,
        }
    }

    #[test]
    fn empty_sync_keeps_cache() {
        let mut s = Store::open_in_memory().unwrap();
        s.save_sync("acc", 1, &[msg(1, 1)], &[]).unwrap();
        let err = s.save_sync("acc", 0, &[], &[]).unwrap_err();
        assert!(err.to_string().contains("пустой список"));
        let left = s.load_folder("acc::INBOX").unwrap();
        assert_eq!(left.len(), 1);
    }

    #[test]
    fn correspondence_skips_known_contacts() {
        let mut s = Store::open_in_memory().unwrap();
        let mut first = msg(1, 1);
        first.from = "Анна Смирнова <anna@example.ru>".to_string();
        let mut second = msg(2, 2);
        second.from = "Пётр <petr@example.ru>".to_string();
        s.save_sync("acc", 2, &[first, second], &[]).unwrap();

        let all = s.correspondence_contacts(10).unwrap();
        assert_eq!(all.len(), 2);
        let mut names: Vec<String> = all.iter().map(|x| x.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["Анна Смирнова".to_string(), "Пётр".to_string()]);

        s.save_contact(&crate::mail::contacts::Contact {
            id: 0,
            name: "Анна".to_string(),
            email: "anna@example.ru".to_string(),
            organization: String::new(),
            position: String::new(),
            phone: String::new(),
            notes: String::new(),
            groups: String::new(),
        })
        .unwrap();

        let left = s.correspondence_contacts(10).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].email, "petr@example.ru");
        assert_eq!(left[0].name, "Пётр");

        let (n, date) = s.mail_stats("anna@example.ru").unwrap();
        assert_eq!(n, 1);
        assert!(date.contains("2026"));
    }

    #[test]
    fn analysis_and_blacklist_roundtrip() {
        let s = Store::open_in_memory().unwrap();
        assert!(s.load_analysis("INBOX", 7).unwrap().is_none());
        let a = AiAnalysis {
            summary: "Кратко".to_string(),
            category: "реклама".to_string(),
            importance: "низкая".to_string(),
            dates: vec![],
            tasks: vec!["подтвердить".to_string()],
            actions: vec![],
        };
        s.save_analysis("INBOX", 7, Some("тема 7"), &a).unwrap();
        let loaded = s.load_analysis("INBOX", 7).unwrap().unwrap();
        assert_eq!(loaded.summary, "Кратко");
        assert_eq!(loaded.category, "реклама");
        assert_eq!(loaded.tasks.len(), 1);
        let all = s.load_all_analyses("INBOX").unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].0, 7);
        s.add_blacklist_domain("spam.example").unwrap();
        s.add_blacklist_domain("spam.example").unwrap();
        let cnt: i64 = s
            .conn
            .query_row("SELECT COUNT(*) FROM blacklist", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cnt, 1);
        let all = s.load_analyses_all_folders().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].0, "INBOX");
        assert_eq!(all[0].1, 7);
        assert_eq!(all[0].3.as_deref(), Some("тема 7"));
    }

    #[test]
    fn calendar_events_roundtrip() {
        let s = Store::open_in_memory().unwrap();
        let id = s
            .add_calendar_event(&CalendarEvent {
                id: 0,
                title: "Встреча".to_string(),
                start_date: "2026-11-05".to_string(),
                end_date: None,
                start_time: Some("14:30".to_string()),
                description: "Из письма".to_string(),
                source_folder: Some("INBOX".to_string()),
                source_uid: Some(7),
            })
            .unwrap();
        let all = s.load_calendar_events().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "Встреча");
        assert_eq!(all[0].start_date, "2026-11-05");
        assert_eq!(all[0].start_time.as_deref(), Some("14:30"));
        assert_eq!(all[0].source_uid, Some(7));
        s.delete_calendar_event(id).unwrap();
        assert!(s.load_calendar_events().unwrap().is_empty());
    }

    #[test]
    fn folders_cache_is_independent() {
        let mut s = Store::open_in_memory().unwrap();
        let inbox = "1::INBOX";
        let sent = "1::Sent";
        let mut m1 = msg(1, 1);
        m1.seen = true;
        s.save_folder_sync(inbox, 2, 1, &[m1, msg(2, 2)]).unwrap();
        s.save_folder_sync(sent, 5, 0, &[msg(3, 1)]).unwrap();

        // письма папок не затирают друг друга
        assert_eq!(s.load_folder(inbox).unwrap().len(), 2);
        assert_eq!(s.load_folder(sent).unwrap().len(), 1);
        assert_eq!(s.folder_total(inbox), 2);
        assert_eq!(s.folder_total(sent), 5);

        // прочитанное в INBOX уменьшает счётчик только этой папки
        let before = s.unread_counts("%").unwrap();
        assert_eq!(before.len(), 1);
        assert_eq!(before[0].0, inbox);
        assert_eq!(before[0].1, 1);
        s.mark_seen(inbox, 2, true).unwrap();
        assert!(s.unread_counts("%").unwrap().is_empty());
        s.mark_seen(inbox, 2, false).unwrap();
        let after = s.unread_counts("%").unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].1, 1);

        // список папок ящика
        s.save_folders(
            "1",
            &[
                FolderInfo {
                    name: inbox.to_string(),
                    delimiter: None,
                    is_drafts: false,
                },
                FolderInfo {
                    name: sent.to_string(),
                    delimiter: None,
                    is_drafts: false,
                },
            ],
        )
        .unwrap();
        assert_eq!(s.load_folders("1::%").unwrap().len(), 2);
        assert_eq!(s.load_folders("2::%").unwrap().len(), 0);
    }

    #[test]
    fn mark_seen_updates_cache() {
        let mut s = Store::open_in_memory().unwrap();
        let mut m1 = msg(1, 1);
        m1.seen = true;
        s.save_sync("1", 2, &[m1, msg(2, 2)], &[]).unwrap();
        let c = s.load().unwrap().unwrap();
        // свежие — первыми (ORDER BY seq DESC)
        assert_eq!(c.messages[0].uid, 2);
        assert!(!c.messages[0].seen);
        assert!(c.messages[1].seen);
        s.mark_seen("1::INBOX", 2, true).unwrap();
        assert!(s.load().unwrap().unwrap().messages[0].seen);
        s.mark_seen("1::INBOX", 2, false).unwrap();
        assert!(!s.load().unwrap().unwrap().messages[0].seen);
        assert_eq!(s.message_meta(2).unwrap().unwrap().0, "тема 2");
        assert!(s.message_meta(99).unwrap().is_none());
    }

    #[test]
    fn empty_cache_returns_none() {
        let s = Store::open_in_memory().unwrap();
        assert!(s.load().unwrap().is_none());
    }

    #[test]
    fn roundtrip_save_load() {
        let mut s = Store::open_in_memory().unwrap();
        let msgs = vec![msg(1, 1), msg(2, 2)];
        let folders = vec![
            FolderInfo {
                name: "INBOX".to_string(),
                delimiter: None,
                is_drafts: false,
            },
            FolderInfo {
                name: "Отправленные".to_string(),
                delimiter: None,
                is_drafts: false,
            },
        ];
        s.save_sync("1", 111, &msgs, &folders).unwrap();
        let c = s.load().unwrap().unwrap();
        assert_eq!(c.total, 111);
        assert_eq!(c.messages.len(), 2);
        assert_eq!(c.folders.len(), 2);
        assert!(c.last_sync.is_some());
        // свежие — первыми (ORDER BY seq DESC)
        assert_eq!(c.messages[0].uid, 2);
    }

    #[test]
    fn resync_replaces_without_duplicates() {
        let mut s = Store::open_in_memory().unwrap();
        s.save_sync("1", 10, &[msg(1, 1), msg(2, 2)], &[]).unwrap();
        s.save_sync("1", 5, &[msg(3, 3)], &[]).unwrap();
        let c = s.load().unwrap().unwrap();
        assert_eq!(c.total, 5);
        assert_eq!(c.messages.len(), 1);
        assert_eq!(c.messages[0].uid, 3);
    }

    #[test]
    fn body_roundtrip() {
        let s = Store::open_in_memory().unwrap();
        assert!(s.load_body("INBOX", 5).unwrap().is_none());
        s.save_body(
            "INBOX",
            5,
            Some("привет"),
            Some("<b>привет</b>"),
            false,
            &[],
        )
        .unwrap();
        let b = s.load_body("INBOX", 5).unwrap().unwrap();
        assert_eq!(b.text.as_deref(), Some("привет"));
        assert_eq!(b.html.as_deref(), Some("<b>привет</b>"));
        assert!(!b.truncated);
        assert!(b.attachments.is_empty());
        // папка учитывается: в другой папке того же uid нет
        assert!(s.load_body("INBOX/ToMyself", 5).unwrap().is_none());
        // перезапись (с вложением)
        let att = vec![super::AttachmentMeta {
            name: "док.pdf".to_string(),
            mime: "application/pdf".to_string(),
            size: 5,
            index: 0,
        }];
        s.save_body("INBOX", 5, Some("новое"), None, true, &att)
            .unwrap();
        let b2 = s.load_body("INBOX", 5).unwrap().unwrap();
        assert_eq!(b2.text.as_deref(), Some("новое"));
        assert!(b2.html.is_none());
        assert!(b2.truncated);
        assert_eq!(b2.attachments.len(), 1);
        assert_eq!(b2.attachments[0].name, "док.pdf");
    }
}

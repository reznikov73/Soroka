//! Локальный кэш (SQLite): письма, папки, метаданные (TASK-003).
//! БД: %APPDATA%\Soroka\soroka.db — вне репозитория.

use super::MailError;
use super::body::AttachmentMeta;
use super::imap::{FolderInfo, MessageHeader};
use crate::ai::gigachat::AiAnalysis;
use rusqlite::{Connection, OptionalExtension, params};
use std::path::PathBuf;

/// Данные, прочитанные из кэша.
pub struct CachedMail {
    pub total: u32,
    pub messages: Vec<MessageHeader>,
    pub folders: Vec<FolderInfo>,
    pub last_sync: Option<i64>,
}

/// Тело письма из кэша.
pub struct CachedBody {
    pub text: Option<String>,
    pub html: Option<String>,
    pub truncated: bool,
    pub attachments: Vec<AttachmentMeta>,
    pub fetched_at: i64,
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
                    uid INTEGER PRIMARY KEY,
                    seq INTEGER NOT NULL,
                    from_addr TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    date TEXT NOT NULL,
                    seen INTEGER NOT NULL DEFAULT 0,
                    flagged INTEGER NOT NULL DEFAULT 0
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
                    PRIMARY KEY (folder, uid)
                );
                CREATE TABLE IF NOT EXISTS blacklist (
                    domain TEXT PRIMARY KEY,
                    added_at INTEGER NOT NULL
                );",
            )
            .map_err(|e| MailError::Store(e.to_string()))?;

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
        Ok(())
    }

    /// Полная замена кэша INBOX (в транзакции).
    pub fn save_sync(
        &mut self,
        total: u32,
        messages: &[MessageHeader],
        folders: &[FolderInfo],
    ) -> Result<(), MailError> {
        let tx = self
            .conn
            .transaction()
            .map_err(|e| MailError::Store(e.to_string()))?;

        tx.execute("DELETE FROM messages", [])
            .map_err(|e| MailError::Store(e.to_string()))?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT OR REPLACE INTO messages (uid, seq, from_addr, subject, date, seen, flagged)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )
                .map_err(|e| MailError::Store(e.to_string()))?;
            for m in messages {
                stmt.execute(params![
                    m.uid as i64,
                    m.seq as i64,
                    m.from,
                    m.subject,
                    m.date,
                    m.seen,
                    m.flagged
                ])
                .map_err(|e| MailError::Store(e.to_string()))?;
            }
        }

        tx.execute("DELETE FROM folders", [])
            .map_err(|e| MailError::Store(e.to_string()))?;
        {
            let mut stmt = tx
                .prepare("INSERT OR REPLACE INTO folders (name) VALUES (?1)")
                .map_err(|e| MailError::Store(e.to_string()))?;
            for f in folders {
                stmt.execute(params![f.name])
                    .map_err(|e| MailError::Store(e.to_string()))?;
            }
        }

        tx.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('total', ?1)",
            params![total.to_string()],
        )
        .map_err(|e| MailError::Store(e.to_string()))?;
        tx.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync', ?1)",
            params![now_unix().to_string()],
        )
        .map_err(|e| MailError::Store(e.to_string()))?;

        tx.commit().map_err(|e| MailError::Store(e.to_string()))
    }

    /// Читает кэш. `None` — если синхронизации ещё не было.
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

        let mut messages = Vec::new();
        {
            let mut stmt = self
                .conn
                .prepare(
                    "SELECT uid, seq, from_addr, subject, date, seen, flagged FROM messages ORDER BY seq DESC",
                )
                .map_err(|e| MailError::Store(e.to_string()))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(MessageHeader {
                        uid: row.get::<_, i64>(0)? as u32,
                        seq: row.get::<_, i64>(1)? as u32,
                        from: row.get::<_, String>(2)?,
                        subject: row.get::<_, String>(3)?,
                        date: row.get::<_, String>(4)?,
                        seen: row.get::<_, bool>(5)?,
                        flagged: row.get::<_, bool>(6)?,
                    })
                })
                .map_err(|e| MailError::Store(e.to_string()))?;
            for r in rows {
                messages.push(r.map_err(|e| MailError::Store(e.to_string()))?);
            }
        }

        let mut folders = Vec::new();
        {
            let mut stmt = self
                .conn
                .prepare("SELECT name FROM folders ORDER BY (name <> 'INBOX'), name COLLATE NOCASE")
                .map_err(|e| MailError::Store(e.to_string()))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(FolderInfo {
                        name: row.get::<_, String>(0)?,
                    })
                })
                .map_err(|e| MailError::Store(e.to_string()))?;
            for r in rows {
                folders.push(r.map_err(|e| MailError::Store(e.to_string()))?);
            }
        }

        Ok(Some(CachedMail {
            total,
            messages,
            folders,
            last_sync,
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

    /// Обновляет флаг «важное» у письма в кэше (TASK-010).
    pub fn mark_flagged(&self, uid: u32, flagged: bool) -> Result<(), MailError> {
        self.conn
            .execute(
                "UPDATE messages SET flagged = ?1 WHERE uid = ?2",
                params![flagged, uid as i64],
            )
            .map_err(|e| MailError::Store(e.to_string()))
            .map(|_| ())
    }

    /// Сохраняет ИИ-разбор письма (TASK-010).
    pub fn save_analysis(&self, folder: &str, uid: u32, a: &AiAnalysis) -> Result<(), MailError> {
        let json = serde_json::to_string(a).map_err(|e| MailError::Store(e.to_string()))?;
        self.conn
            .execute(
                "INSERT OR REPLACE INTO ai_analysis (folder, uid, json, analyzed_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![folder, uid as i64, json, now_unix()],
            )
            .map_err(|e| MailError::Store(e.to_string()))
            .map(|_| ())
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

    /// Обновляет флаг «прочитано» у письма в кэше (TASK-008).
    pub fn mark_seen(&self, uid: u32, seen: bool) -> Result<(), MailError> {
        self.conn
            .execute(
                "UPDATE messages SET seen = ?1 WHERE uid = ?2",
                params![seen, uid as i64],
            )
            .map_err(|e| MailError::Store(e.to_string()))
            .map(|_| ())
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

#[cfg(test)]
mod tests {
    use super::Store;
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
        }
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
        s.save_analysis("INBOX", 7, &a).unwrap();
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
    }

    #[test]
    fn mark_seen_updates_cache() {
        let mut s = Store::open_in_memory().unwrap();
        let mut m1 = msg(1, 1);
        m1.seen = true;
        s.save_sync(2, &[m1, msg(2, 2)], &[]).unwrap();
        let c = s.load().unwrap().unwrap();
        // свежие — первыми (ORDER BY seq DESC)
        assert_eq!(c.messages[0].uid, 2);
        assert!(!c.messages[0].seen);
        assert!(c.messages[1].seen);
        s.mark_seen(2, true).unwrap();
        assert!(s.load().unwrap().unwrap().messages[0].seen);
        s.mark_seen(2, false).unwrap();
        assert!(!s.load().unwrap().unwrap().messages[0].seen);
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
            },
            FolderInfo {
                name: "Отправленные".to_string(),
            },
        ];
        s.save_sync(111, &msgs, &folders).unwrap();
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
        s.save_sync(10, &[msg(1, 1), msg(2, 2)], &[]).unwrap();
        s.save_sync(5, &[msg(3, 3)], &[]).unwrap();
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

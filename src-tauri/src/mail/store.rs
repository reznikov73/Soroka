//! Локальный кэш (SQLite): письма, папки, метаданные (TASK-003).
//! БД: %APPDATA%\Soroka\soroka.db — вне репозитория.

use super::MailError;
use super::imap::{FolderInfo, MessageHeader};
use rusqlite::{Connection, params};
use std::path::PathBuf;

/// Данные, прочитанные из кэша.
pub struct CachedMail {
    pub total: u32,
    pub messages: Vec<MessageHeader>,
    pub folders: Vec<FolderInfo>,
    pub last_sync: Option<i64>,
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
                    date TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS folders (name TEXT PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
            )
            .map_err(|e| MailError::Store(e.to_string()))
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
                    "INSERT OR REPLACE INTO messages (uid, seq, from_addr, subject, date)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .map_err(|e| MailError::Store(e.to_string()))?;
            for m in messages {
                stmt.execute(params![
                    m.uid as i64,
                    m.seq as i64,
                    m.from,
                    m.subject,
                    m.date
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
                    "SELECT uid, seq, from_addr, subject, date FROM messages ORDER BY seq DESC",
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
                .prepare("SELECT name FROM folders ORDER BY name")
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
}

#[cfg(test)]
mod tests {
    use super::Store;
    use crate::mail::imap::{FolderInfo, MessageHeader};

    fn msg(uid: u32, seq: u32) -> MessageHeader {
        MessageHeader {
            uid,
            seq,
            from: format!("from{uid}"),
            subject: format!("тема {uid}"),
            date: "Wed, 14 Oct 2026 20:00:00 +0300".to_string(),
        }
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
}

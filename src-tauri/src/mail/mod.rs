//! Почтовый модуль: IMAP/SMTP, разбор писем, локальное хранилище.
//! Реализация — TASK-002+.

pub mod imap;
pub mod parser;
pub mod smtp;
pub mod store;

/// Ошибки почтового модуля.
#[derive(Debug, thiserror::Error)]
pub enum MailError {
    #[error("функция ещё не реализована (заглушка)")]
    NotImplemented,
}

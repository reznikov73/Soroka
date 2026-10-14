//! Почтовый модуль: IMAP/SMTP, разбор писем, локальное хранилище.
//! IMAP — TASK-002; SMTP/парсер/хранилище — TASK-003+.

pub mod imap;
pub mod parser;
pub mod smtp;
pub mod store;

/// Ошибки почтового модуля.
#[derive(Debug, thiserror::Error)]
pub enum MailError {
    #[error("функция ещё не реализована (заглушка)")]
    NotImplemented,
    #[error(
        "не найдены учётные данные: задайте SOROKA_IMAP_USER/SOROKA_IMAP_PASS или создайте %APPDATA%\\Soroka\\account.json"
    )]
    NoCredentials,
    #[error("ошибка конфигурации: {0}")]
    Config(String),
    #[error("сетевая ошибка: {0}")]
    Network(String),
    #[error("ошибка авторизации: {0}")]
    Auth(String),
    #[error("ошибка протокола IMAP: {0}")]
    Protocol(String),
}

//! ИИ-модуль: суммаризация писем через GigaChat (TASK-009).
//! Дальше: черновики ответов (TASK-010), классификация.

pub mod gigachat;
pub mod provider;

/// Ошибки ИИ-модуля.
#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error(
        "не настроен ключ GigaChat: задайте SOROKA_GIGACHAT_KEY или %APPDATA%\\Soroka\\gigachat.json"
    )]
    NoKey,
    #[error("ошибка конфигурации: {0}")]
    Config(String),
    #[error("сетевая ошибка: {0}")]
    Network(String),
    #[error("ошибка авторизации GigaChat: {0}")]
    Auth(String),
    #[error("ошибка ответа GigaChat: {0}")]
    Api(String),
}

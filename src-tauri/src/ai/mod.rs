//! ИИ-модуль: суммаризация, черновики ответов, классификация.
//! Реализация — TASK-006.

pub mod provider;

/// Ошибки ИИ-модуля.
#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("функция ещё не реализована (заглушка)")]
    NotImplemented,
}

/// Краткое содержание письма (заглушка).
pub fn summarize() -> Result<(), AiError> {
    Err(AiError::NotImplemented)
}

/// Черновик ответа (заглушка).
pub fn draft_reply() -> Result<(), AiError> {
    Err(AiError::NotImplemented)
}

/// Классификация письма (заглушка).
pub fn classify() -> Result<(), AiError> {
    Err(AiError::NotImplemented)
}
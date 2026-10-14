use super::AiError;

/// Провайдер ИИ (локально — Ollama и т.п.); заглушка до TASK-006.
pub fn complete() -> Result<(), AiError> {
    Err(AiError::NotImplemented)
}

//! GigaChat: краткое резюме письма (TASK-009).
//! Механизм: OAuth (ngw.devices.sberbank.ru) -> chat/completions
//! (gigachat.devices.sberbank.ru); корневой сертификат Минцифры вкомпилирован.

use super::AiError;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const OAUTH_URL: &str = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const CHAT_URL: &str = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions";
const CA_PEM: &[u8] = include_bytes!("../../certs/russian_trusted_root_ca.pem");
/// Обрезка письма перед отправкой в модель (защита запроса).
pub const INPUT_LIMIT: usize = 4000;

static TOKEN: Mutex<Option<(String, i64)>> = Mutex::new(None);

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Разбор JSON конфига {"api_key": "..."} (вынесено для тестов).
pub fn parse_api_key(raw: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let k = v.get("api_key")?.as_str()?.trim().to_string();
    if k.is_empty() { None } else { Some(k) }
}

/// Ключ: env SOROKA_GIGACHAT_KEY или %APPDATA%\Soroka\gigachat.json.
pub fn load_api_key() -> Result<String, AiError> {
    if let Ok(k) = std::env::var("SOROKA_GIGACHAT_KEY") {
        let k = k.trim().to_string();
        if !k.is_empty() {
            return Ok(k);
        }
    }
    let appdata = std::env::var("APPDATA").map_err(|_| AiError::NoKey)?;
    let path = std::path::PathBuf::from(appdata)
        .join("Soroka")
        .join("gigachat.json");
    let raw = std::fs::read_to_string(&path).map_err(|_| AiError::NoKey)?;
    let raw = raw.trim_start_matches('\u{feff}');
    parse_api_key(raw).ok_or(AiError::NoKey)
}

fn client() -> Result<reqwest::blocking::Client, AiError> {
    let cert = reqwest::Certificate::from_pem(CA_PEM)
        .map_err(|e| AiError::Config(format!("сертификат: {e}")))?;
    reqwest::blocking::Client::builder()
        .add_root_certificate(cert)
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| AiError::Network(e.to_string()))
}

/// Токен валиден, если до истечения больше минуты (вынесено для тестов).
pub fn token_is_fresh(expires_at_ms: i64, now: i64) -> bool {
    expires_at_ms - now > 60_000
}

fn fetch_token(key: &str) -> Result<(String, i64), AiError> {
    let c = client()?;
    let resp = c
        .post(OAUTH_URL)
        .header("Authorization", format!("Basic {key}"))
        .header("RqUID", uuid::Uuid::new_v4().to_string())
        .header("Accept", "application/json")
        .form(&[("scope", "GIGACHAT_API_PERS")])
        .send()
        .map_err(|e| AiError::Network(e.to_string()))?;
    let status = resp.status();
    let text = resp.text().map_err(|e| AiError::Network(e.to_string()))?;
    if !status.is_success() {
        return Err(AiError::Auth(format!("{status}: {}", trim_error(&text))));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| AiError::Api(e.to_string()))?;
    let token = v
        .get("access_token")
        .and_then(|t| t.as_str())
        .ok_or_else(|| AiError::Api("нет access_token".into()))?
        .to_string();
    let expires = v.get("expires_at").and_then(|t| t.as_i64()).unwrap_or(0);
    Ok((token, expires))
}

fn get_token(key: &str) -> Result<String, AiError> {
    {
        let guard = TOKEN
            .lock()
            .map_err(|_| AiError::Api("мьютекс токена".into()))?;
        if let Some((t, exp)) = guard.as_ref()
            && token_is_fresh(*exp, now_ms())
        {
            return Ok(t.clone());
        }
    }
    let (token, expires) = fetch_token(key)?;
    {
        let mut guard = TOKEN
            .lock()
            .map_err(|_| AiError::Api("мьютекс токена".into()))?;
        *guard = Some((token.clone(), expires));
    }
    Ok(token)
}

/// Разбор ответа chat/completions (вынесено для тестов).
pub fn parse_chat_response(body: &str) -> Result<String, AiError> {
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|e| AiError::Api(e.to_string()))?;
    let content = v
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| AiError::Api("неожиданный ответ модели".into()))?;
    Ok(content.trim().to_string())
}

/// Обрезка текста до лимита по границе UTF-8.
pub fn truncate_input(text: &str) -> String {
    if text.len() <= INPUT_LIMIT {
        return text.to_string();
    }
    let mut end = INPUT_LIMIT;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

/// Промпт суммаризации.
fn build_prompt(subject: &str, body: &str) -> String {
    format!(
        "Ты — почтовый помощник. Сделай краткое резюме письма на русском языке (2–3 предложения по сути). \
Если в письме есть важные даты, суммы или просьбы — перечисли их отдельной строкой. Без воды.\n\n\
Тема: {subject}\n\nТекст письма:\n{body}"
    )
}

/// Просит у GigaChat краткое резюме письма.
pub fn summarize(subject: &str, body: &str) -> Result<String, AiError> {
    let key = load_api_key()?;
    let token = get_token(&key)?;
    let c = client()?;
    let payload = serde_json::json!({
        "model": "GigaChat",
        "messages": [{"role": "user", "content": build_prompt(subject, &truncate_input(body))}],
        "temperature": 0.2,
        "max_tokens": 700,
    });
    let resp = c
        .post(CHAT_URL)
        .header("Authorization", format!("Bearer {token}"))
        .json(&payload)
        .send()
        .map_err(|e| AiError::Network(e.to_string()))?;
    let status = resp.status();
    let text = resp.text().map_err(|e| AiError::Network(e.to_string()))?;
    if !status.is_success() {
        return Err(AiError::Api(format!("{status}: {}", trim_error(&text))));
    }
    let raw = parse_chat_response(&text)?;
    Ok(clean_markdown(&raw))
}' 'gigachat: применить чистку'

Repl 'src-tauri\src\ai\gigachat.rs' @'
    #[test]
    fn truncates_input_by_utf8_boundary() {

/// Чистит markdown-разметку из ответа модели (## заголовки, * пункты) — TASK-009.
pub fn clean_markdown(text: &str) -> String {
    let mut lines_out = Vec::new();
    for line in text.lines() {
        let mut l = line.trim_start();
        if l.starts_with('#') {
            l = l.trim_start_matches('#').trim_start();
        }
        if let Some(rest) = l.strip_prefix("* ").or_else(|| l.strip_prefix("- ")) {
            lines_out.push(format!("• {rest}"));
        } else {
            lines_out.push(l.to_string());
        }
    }
    lines_out.join("\n")
}

fn trim_error(s: &str) -> String {
    s.chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_api_key_json() {
        assert_eq!(
            parse_api_key(r#"{"api_key": "abc"}"#).as_deref(),
            Some("abc")
        );
        assert!(parse_api_key("{}").is_none());
        assert!(parse_api_key("не json").is_none());
        assert!(parse_api_key(r#"{"api_key": "  "}"#).is_none());
    }

    #[test]
    fn token_freshness() {
        assert!(token_is_fresh(1_000_000, 800_000));
        assert!(!token_is_fresh(1_000_000, 999_999));
        assert!(!token_is_fresh(0, 0));
    }

    #[test]
    fn parses_chat_response() {
        let ok = r#"{"choices": [{"message": {"role": "assistant", "content": " Резюме "}}]}"#;
        assert_eq!(parse_chat_response(ok).unwrap(), "Резюме");
        assert!(parse_chat_response("{}").is_err());
        assert!(parse_chat_response("не json").is_err());
    }

    #[test]
    fn truncates_input_by_utf8_boundary() {
        let long = "а".repeat(INPUT_LIMIT); // 2 байта на символ
        let cut = truncate_input(&long);
        assert!(cut.len() <= INPUT_LIMIT);
        assert!(std::str::from_utf8(cut.as_bytes()).is_ok());
        let short = "привет";
        assert_eq!(truncate_input(short), short);
    }
}

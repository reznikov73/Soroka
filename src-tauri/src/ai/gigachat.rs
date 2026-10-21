//! GigaChat: краткое резюме письма (TASK-009).
//! Механизм: OAuth (ngw.devices.sberbank.ru) -> chat/completions
//! (gigachat.devices.sberbank.ru); корневой сертификат Минцифры вкомпилирован.

use super::AiError;
use serde::{Deserialize, Serialize};
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

/// Путь к файлу с ключом (TASK-041).
pub fn key_path() -> Option<std::path::PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(
        std::path::PathBuf::from(appdata)
            .join("Soroka")
            .join("gigachat.json"),
    )
}

fn env_key() -> Option<String> {
    std::env::var("SOROKA_GIGACHAT_KEY")
        .ok()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
}

/// Ключ: env SOROKA_GIGACHAT_KEY или %APPDATA%\Soroka\gigachat.json.
pub fn load_api_key() -> Result<String, AiError> {
    if let Some(k) = env_key() {
        return Ok(k);
    }
    let path = key_path().ok_or(AiError::NoKey)?;
    let raw = std::fs::read_to_string(&path).map_err(|_| AiError::NoKey)?;
    let raw = raw.trim_start_matches('\u{feff}');
    parse_api_key(raw).ok_or(AiError::NoKey)
}

/// Состояние ключа для интерфейса — сам ключ наружу не отдаём (TASK-041).
#[derive(Debug, Clone, Serialize)]
pub struct KeyStatus {
    /// "env" | "file" | "none"
    pub source: String,
    pub has_file: bool,
    pub env_set: bool,
}

pub fn key_status() -> KeyStatus {
    let env_set = env_key().is_some();
    let has_file = key_path().map(|p| p.exists()).unwrap_or(false);
    let source = if env_set {
        "env"
    } else if has_file {
        "file"
    } else {
        "none"
    };
    KeyStatus {
        source: source.to_string(),
        has_file,
        env_set,
    }
}

/// Сохраняет ключ в %APPDATA%\Soroka\gigachat.json (TASK-041).
pub fn save_api_key(key: &str) -> Result<(), AiError> {
    let key = key.trim();
    if key.len() < 20 {
        return Err(AiError::Config("ключ выглядит слишком коротким".into()));
    }
    let path = key_path().ok_or(AiError::NoKey)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AiError::Config(e.to_string()))?;
    }
    let json = serde_json::json!({ "api_key": key });
    let body = serde_json::to_vec_pretty(&json).map_err(|e| AiError::Config(e.to_string()))?;
    std::fs::write(&path, body).map_err(|e| AiError::Config(e.to_string()))?;
    reset_token();
    Ok(())
}

/// Удаляет сохранённый ключ (TASK-041).
pub fn clear_api_key() -> Result<(), AiError> {
    if let Some(path) = key_path()
        && path.exists()
    {
        std::fs::remove_file(path).map_err(|e| AiError::Config(e.to_string()))?;
    }
    reset_token();
    Ok(())
}

/// Сбрасывает кэш токена — после смены ключа (TASK-041).
pub fn reset_token() {
    if let Ok(mut guard) = TOKEN.lock() {
        *guard = None;
    }
}

/// Проверяет ключ получением токена (без расхода токенов модели).
pub fn check_api_key(key: &str) -> Result<(), AiError> {
    fetch_token(key.trim()).map(|_| ())
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

/// Структурированный разбор письма (TASK-010).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AiAnalysis {
    pub summary: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub importance: String,
    #[serde(default)]
    pub dates: Vec<String>,
    #[serde(default)]
    pub tasks: Vec<String>,
    #[serde(default)]
    pub actions: Vec<String>,
}

/// Устойчивый разбор ответа модели в AiAnalysis (JSON в фенсах, мусор → fallback).
pub fn parse_analysis(text: &str) -> AiAnalysis {
    let mut candidate = text.trim();
    if let Some(start) = candidate.find('{')
        && let Some(end) = candidate.rfind('}')
        && end > start
    {
        candidate = &candidate[start..=end];
    }
    if let Ok(mut a) = serde_json::from_str::<AiAnalysis>(candidate) {
        a.summary = clean_markdown(a.summary.trim());
        a.category = a.category.trim().to_lowercase();
        a.importance = a.importance.trim().to_lowercase();
        return a;
    }
    AiAnalysis {
        summary: clean_markdown(text.trim()),
        ..AiAnalysis::default()
    }
}

/// Один запрос к GigaChat: готовый промпт — текст ответа.
pub fn complete(prompt: &str, temperature: f64, max_tokens: u32) -> Result<String, AiError> {
    let key = load_api_key()?;
    let token = get_token(&key)?;
    let c = client()?;
    let payload = serde_json::json!({
        "model": "GigaChat",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
        "max_tokens": max_tokens,
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
    parse_chat_response(&text)
}

/// Разбор письма по готовому промпту (TASK-020: промпт приходит из настроек).
pub fn analyze_with(prompt: &str) -> Result<AiAnalysis, AiError> {
    let raw = complete(prompt, 0.1, 800)?;
    Ok(parse_analysis(&raw))
}

/// Склейка примеров писем владельца для промпта — TASK-014.
pub fn build_samples(items: &[(String, String)]) -> String {
    let mut out = String::new();
    for (subject, body) in items {
        let short: String = body.trim().chars().take(600).collect();
        if short.is_empty() {
            continue;
        }
        out.push_str(&format!("--- {}\n{}\n\n", subject.trim(), short));
    }
    out.trim_end().to_string()
}

/// Строка-заглушка вместо подписи (модель иногда подставляет) — TASK-014.
fn is_placeholder_line(t: &str) -> bool {
    let l = t.trim().to_lowercase();
    if l.is_empty() {
        return false;
    }
    l.contains("ваше имя")
        || l.contains("ваш имя")
        || l.contains("имя фамилия")
        || l.contains("[имя]")
        || l.contains("(имя)")
        || l.contains("название компании")
        || l.contains("адрес компании")
        || l.contains("телефон, почта")
        || l.contains("ваш почтовый помощник")
        || l == "имя"
        || l == "подпись"
}

/// Чистка черновика: убрать разделители, заглушки и лишние пустые строки — TASK-014.
pub fn clean_draft(text: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        if !t.is_empty() && t.chars().all(|c| matches!(c, '-' | '—' | '_' | '=')) {
            continue;
        }
        if is_placeholder_line(t) {
            continue;
        }
        lines.push(line.to_string());
    }
    // «С уважением,» без подписи в конце — убрать.
    if let Some(last) = lines.iter().rposition(|l| !l.trim().is_empty()) {
        let tl = lines[last]
            .trim()
            .trim_end_matches(',')
            .to_lowercase();
        if tl == "с уважением" || tl == "с наилучшими пожеланиями" || tl == "всего доброго" {
            lines.remove(last);
        }
    }
    let mut out: Vec<String> = Vec::new();
    let mut blanks = 0usize;
    for l in lines {
        if l.trim().is_empty() {
            blanks += 1;
            if blanks > 1 {
                continue;
            }
            out.push(String::new());
        } else {
            blanks = 0;
            out.push(l);
        }
    }
    out.join("\n").trim().to_string()
}

/// Черновик ответа по готовому промпту (TASK-020).
pub fn draft_with(prompt: &str) -> Result<String, AiError> {
    let raw = complete(prompt, 0.4, 700)?;
    Ok(clean_draft(&clean_markdown(&raw)))
}

/// Улучшение текста по готовому промпту (TASK-020).
pub fn improve_with(prompt: &str) -> Result<String, AiError> {
    let raw = complete(prompt, 0.3, 800)?;
    Ok(clean_markdown(&raw))
}

/// Вариант подписи, предложенный ИИ — TASK-030.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignatureVariant {
    pub title: String,
    pub text: String,
}

/// Разбирает ответ модели: ждём JSON-массив вариантов, иначе отдаём текст одним вариантом.
pub fn parse_signature_variants(raw: &str) -> Vec<SignatureVariant> {
    let trimmed = raw.trim();
    let body = trimmed
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    if let (Some(start), Some(end)) = (body.find('['), body.rfind(']'))
        && end > start
        && let Ok(list) = serde_json::from_str::<Vec<SignatureVariant>>(&body[start..=end])
    {
        let items: Vec<SignatureVariant> = list
            .into_iter()
            .filter(|v| !v.text.trim().is_empty())
            .collect();
        if !items.is_empty() {
            return items;
        }
    }
    let text = clean_markdown(raw).trim().to_string();
    if text.is_empty() {
        Vec::new()
    } else {
        vec![SignatureVariant {
            title: "Вариант".to_string(),
            text,
        }]
    }
}

/// Три варианта улучшенной подписи — TASK-030.
pub fn signature_variants_with(prompt: &str) -> Result<Vec<SignatureVariant>, AiError> {
    let raw = complete(prompt, 0.4, 900)?;
    Ok(parse_signature_variants(&raw))
}

/// Перевод письма по готовому промпту — TASK-020.
pub fn translate_with(prompt: &str) -> Result<String, AiError> {
    let raw = complete(prompt, 0.1, 1600)?;
    Ok(clean_markdown(&raw))
}

fn trim_error(s: &str) -> String {
    s.chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ручная проверка: реальный запрос в GigaChat за вариантами подписи.
    /// Запуск: cargo test -- --ignored probe_signature_variants --nocapture
    #[test]
    #[ignore]
    fn probe_signature_variants() {
        let prompt = "Ты редактируешь подпись в деловом письме на русском языке.\n\
             Верни строго JSON-массив из трёх объектов вида {\"title\": \"...\", \"text\": \"...\"} — без markdown и пояснений.\n\
             1) «Короче и аккуратнее»;\n\
             2) «Официальнее»;\n\
             3) «С макросами» — замени имя на %FromName и адрес на %FromAddr.\n\
             Переносы строк внутри text экранируй как \\n.\n\
             Подпись:\nС уважением, Андрей Резников, тел 89219972559";
        let list = signature_variants_with(prompt).expect("gigachat");
        println!("вариантов: {}", list.len());
        for v in &list {
            println!("--- {} ---\n{}", v.title, v.text);
        }
        assert!(!list.is_empty());
    }

    #[test]
    fn parses_signature_variants() {
        let raw = "```json\n[{\"title\": \"Короче\", \"text\": \"С уважением,\\nАлександр\"}, {\"title\": \"Официальнее\", \"text\": \"С уважением, Резников А.\"}]\n```";
        let list = parse_signature_variants(raw);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].title, "Короче");
        assert!(list[0].text.contains("Александр"));
        assert_eq!(list[1].title, "Официальнее");

        let plain = parse_signature_variants("С уважением, Александр");
        assert_eq!(plain.len(), 1);
        assert_eq!(plain[0].title, "Вариант");

        assert!(parse_signature_variants("   ").is_empty());
    }

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
    fn parses_analysis_json() {
        let raw = r#"```json
{"summary": " Кратко ", "category": "Реклама", "importance": "Низкая", "dates": [], "tasks": ["подтвердить"], "actions": []}
```"#;
        let a = parse_analysis(raw);
        assert_eq!(a.summary, "Кратко");
        assert_eq!(a.category, "реклама");
        assert_eq!(a.importance, "низкая");
        assert_eq!(a.tasks.len(), 1);
    }

    #[test]
    fn parse_analysis_fallback() {
        let a = parse_analysis("просто текст без json");
        assert_eq!(a.summary, "просто текст без json");
        assert!(a.category.is_empty());
    }

    #[test]
    fn cleans_markdown() {
        assert_eq!(
            clean_markdown("## Заголовок\n- пункт\n* пункт2\nтекст"),
            "Заголовок\n• пункт\n• пункт2\nтекст"
        );
    }

    #[test]
    fn cleans_draft_lines() {
        let raw = "a\n--\nb\n---\n\n\n\nc\n";
        assert_eq!(clean_draft(raw), "a\nb\n\nc");
        let with_placeholder = "Здравствуйте!\n\nТекст.\n\nС уважением,\nВаше Имя";
        assert_eq!(clean_draft(with_placeholder), "Здравствуйте!\n\nТекст.");
    }

    #[test]
    fn builds_style_samples() {
        let s = build_samples(&[
            ("тема 1".to_string(), "  привет\nпока  ".to_string()),
            ("пусто".to_string(), "   ".to_string()),
            ("тема 2".to_string(), "текст".to_string()),
        ]);
        assert!(s.contains("--- тема 1\nпривет\nпока"));
        assert!(s.contains("--- тема 2\nтекст"));
        assert!(!s.contains("пусто"));
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

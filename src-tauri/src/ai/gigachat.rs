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

/// Промпт структурированного разбора.
fn build_analysis_prompt(subject: &str, body: &str) -> String {
    format!(
        "Ты — почтовый помощник. Разбери письмо и верни ТОЛЬКО JSON без markdown и пояснений, строго по схеме:\n\
{{\"summary\": \"суть письма в 1–2 предложениях\", \
\"category\": \"одно из: реклама, клиент, госорган, финансы, уведомление, личное, мошенничество\", \
\"importance\": \"высокая | обычная | низкая\", \
\"dates\": [\"важные даты и события, если есть\"], \
\"tasks\": [\"что от вас могут ждать, если есть\"], \
\"actions\": [\"краткие предложения действий, если уместны\"]}}\n\
Оценка важности: высокая — требует внимания человека (клиенты, госорганы, счета, личное); \
низкая — массовые рассылки и реклама; обычная — остальное.\n\nТема: {subject}\n\nТекст письма:\n{body}"
    )
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

/// Разбор письма: сводка + категория + важность (+ даты/задачи/действия) — один запрос.
pub fn analyze(subject: &str, body: &str) -> Result<AiAnalysis, AiError> {
    let key = load_api_key()?;
    let token = get_token(&key)?;
    let c = client()?;
    let payload = serde_json::json!({
        "model": "GigaChat",
        "messages": [{"role": "user", "content": build_analysis_prompt(subject, &truncate_input(body))}],
        "temperature": 0.1,
        "max_tokens": 800,
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

/// Промпт черновика ответа в стиле владельца ящика — TASK-014.
fn build_draft_prompt(samples: &str, from: &str, subject: &str, body: &str) -> String {
    let style = if samples.trim().is_empty() {
        "(примеров нет — пиши нейтрально-деловым тоном)"
    } else {
        samples
    };
    format!(
        "Напиши ответное письмо ОТ ИМЕНИ владельца ящика (ты — не помощник, не сервис).\n\
         Стиль владельца — по примерам ниже (обращение, тон, длина фраз).\n\
         Правила:\n\
         - по-русски, коротко (2–5 предложений), вежливо;\n\
         - начни с приветствия; обращение по имени — только если оно есть во входящем письме, иначе просто «Здравствуйте!»;\n\
         - ответь по сути входящего письма; не выдумывай фактов;\n\
         - НЕ добавляй подпись, прощание, имена, адреса и телефоны — только сам текст ответа; никаких заглушек вроде «ваше имя здесь»;\n\
         - не переноси из примеров разделители строк (--, ---, ===) и служебные строки;\n\
         - без markdown; верни ТОЛЬКО текст письма, без пояснений и кавычек вокруг.\n\n\
         Примеры писем владельца:\n{style}\n\n\
         Входящее письмо — от: {from}; тема: {subject}\n{body}"
    )
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

/// Черновик ответа в стиле владельца ящика — TASK-014.
pub fn draft(samples: &str, from: &str, subject: &str, body: &str) -> Result<String, AiError> {
    let key = load_api_key()?;
    let token = get_token(&key)?;
    let c = client()?;
    let payload = serde_json::json!({
        "model": "GigaChat",
        "messages": [{"role": "user", "content": build_draft_prompt(samples, from, subject, &truncate_input(body))}],
        "temperature": 0.4,
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
    Ok(clean_draft(&clean_markdown(&raw)))
}

/// Промпт улучшения текста письма — TASK-015.1.
fn build_improve_prompt(text: &str) -> String {
    format!(
        "Ты — внимательный редактор. Перепиши текст письма лучше: исправь орфографию, пунктуацию, ясность и вежливый деловой тон.\n\
         Сохрани смысл, факты, имена, числа и язык оригинала. Ничего не добавляй от себя.\n\
         Верни ТОЛЬКО улучшенный текст письма — без markdown, пояснений и кавычек.\n\nТекст письма:\n{text}"
    )
}

/// Улучшение текста письма — TASK-015.1.
pub fn improve(text: &str) -> Result<String, AiError> {
    let key = load_api_key()?;
    let token = get_token(&key)?;
    let c = client()?;
    let payload = serde_json::json!({
        "model": "GigaChat",
        "messages": [{"role": "user", "content": build_improve_prompt(&truncate_input(text))}],
        "temperature": 0.3,
        "max_tokens": 800,
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

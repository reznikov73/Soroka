//! Тело письма: загрузка raw-текста, разбор MIME и безопасный HTML (TASK-005).

use super::MailError;
use super::imap::{AccountConfig, encode_mutf7};

/// Лимит на размер текстовой/HTML-части (защита памяти и БД).
pub const PART_LIMIT: usize = 512 * 1024;

/// Разобранное тело письма.
#[derive(Debug, Clone, Default)]
pub struct ParsedBody {
    pub text: Option<String>,
    pub html: Option<String>,
    pub truncated: bool,
}

/// Загружает и разбирает тело письма (сеть -> text/html).
pub fn fetch_body(cfg: &AccountConfig, folder: &str, uid: u32) -> Result<ParsedBody, MailError> {
    let raw = fetch_raw(cfg, folder, uid)?;
    Ok(parse_body(&raw))
}

fn fetch_raw(cfg: &AccountConfig, folder: &str, uid: u32) -> Result<Vec<u8>, MailError> {
    let encoded = encode_mutf7(folder);
    let client = imap::ClientBuilder::new(&cfg.host, cfg.port)
        .connect()
        .map_err(|e| MailError::Network(e.to_string()))?;
    let mut session = client
        .login(&cfg.user, &cfg.password)
        .map_err(|e| MailError::Auth(e.0.to_string()))?;
    let result = (|| {
        session
            .select(&encoded)
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        let fetches = session
            .uid_fetch(uid.to_string(), "(BODY.PEEK[])")
            .map_err(|e| MailError::Protocol(e.to_string()))?;
        let fetch = fetches
            .iter()
            .next()
            .ok_or_else(|| MailError::Protocol("письмо не найдено по UID".to_string()))?;
        fetch
            .body()
            .map(|b| b.to_vec())
            .ok_or_else(|| MailError::Protocol("сервер не вернул тело письма".to_string()))
    })();
    let _ = session.logout();
    result
}

/// Разбирает raw-письмо: достаёт text/plain и text/html (декодированные).
pub fn parse_body(raw: &[u8]) -> ParsedBody {
    let Some(parsed) = mail_parser::MessageParser::default().parse(raw) else {
        return ParsedBody::default();
    };
    let mut truncated = false;
    let mut text = parsed.body_text(0).map(|c| c.to_string());
    let mut html = parsed.body_html(0).map(|c| c.to_string());
    if let Some(t) = text.as_mut()
        && truncate_to(t, PART_LIMIT)
    {
        truncated = true;
    }
    if let Some(h) = html.as_mut()
        && truncate_to(h, PART_LIMIT)
    {
        truncated = true;
    }
    let html = html.map(|h| sanitize_html(&h));
    ParsedBody {
        text,
        html,
        truncated,
    }
}

/// Обрезает строку до лимита (по границе UTF-8); true — обрезано.
fn truncate_to(s: &mut String, limit: usize) -> bool {
    if s.len() <= limit {
        return false;
    }
    let mut end = limit;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s.truncate(end);
    s.push_str("\n\n… (часть письма скрыта)");
    true
}

/// Санитизация HTML письма: вычищает опасное, блокирует внешние картинки.
pub fn sanitize_html(html: &str) -> String {
    ammonia::Builder::default()
        .strip_comments(true)
        .link_rel(Some("noopener noreferrer"))
        .attribute_filter(|element, attribute, value| {
            if element == "img" && attribute == "src" {
                return None; // внешние картинки заблокированы
            }
            Some(value.into())
        })
        .clean(html)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{parse_body, sanitize_html};

    const MAIL_MULTIPART: &str = concat!(
        "From: a@b.ru\r\n",
        "To: c@d.ru\r\n",
        "Subject: test\r\n",
        "MIME-Version: 1.0\r\n",
        "Content-Type: multipart/alternative; boundary=\"BOUND\"\r\n",
        "\r\n",
        "--BOUND\r\n",
        "Content-Type: text/plain; charset=utf-8\r\n",
        "\r\n",
        "Привет, мир!\r\n",
        "--BOUND\r\n",
        "Content-Type: text/html; charset=utf-8\r\n",
        "\r\n",
        "<html><body><b>Привет, мир!</b></body></html>\r\n",
        "--BOUND--\r\n"
    );

    const MAIL_CP1251: &str = concat!(
        "From: a@b.ru\r\n",
        "Subject: test\r\n",
        "MIME-Version: 1.0\r\n",
        "Content-Type: text/plain; charset=windows-1251\r\n",
        "Content-Transfer-Encoding: base64\r\n",
        "\r\n",
        "z/Do4uXy\r\n"
    );

    #[test]
    fn parses_multipart_text_and_html() {
        let b = parse_body(MAIL_MULTIPART.as_bytes());
        assert_eq!(b.text.as_deref(), Some("Привет, мир!"));
        assert!(b.html.as_deref().unwrap().contains("<b>Привет, мир!</b>"));
    }

    #[test]
    fn parses_windows_1251_base64_body() {
        let b = parse_body(MAIL_CP1251.as_bytes());
        assert_eq!(b.text.as_deref(), Some("Привет"));
    }

    #[test]
    fn sanitize_strips_scripts_and_img_src() {
        let out = sanitize_html(
            "<b>ok</b><script>alert(1)</script><img src=\"http://tracker.example/x.gif\" alt=\"pic\"><a href=\"http://e.ru\" onclick=\"x()\">l</a>",
        );
        assert!(out.contains("<b>ok</b>"));
        assert!(!out.contains("script"));
        assert!(!out.contains("tracker.example"));
        assert!(!out.contains("onclick"));
        assert!(out.contains("pic"));
    }
}

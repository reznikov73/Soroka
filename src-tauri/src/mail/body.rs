//! Тело письма: загрузка raw-текста, разбор MIME и безопасный HTML (TASK-005).

use super::MailError;
use super::imap::{AccountConfig, decode_rfc2047, encode_mutf7};
use mail_parser::MimeHeaders;
use serde::{Deserialize, Serialize};

/// Лимит на размер текстовой/HTML-части (защита памяти и БД).
pub const PART_LIMIT: usize = 512 * 1024;

/// Метаданные вложения (TASK-006).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentMeta {
    pub name: String,
    pub mime: String,
    pub size: u32,
    pub index: u32,
}

/// Разобранное тело письма.
#[derive(Debug, Clone, Default)]
pub struct ParsedBody {
    pub text: Option<String>,
    pub html: Option<String>,
    pub truncated: bool,
    pub attachments: Vec<AttachmentMeta>,
}

/// Загружает и разбирает тело письма (сеть -> text/html).
pub fn fetch_body(cfg: &AccountConfig, folder: &str, uid: u32) -> Result<ParsedBody, MailError> {
    let raw = fetch_raw(cfg, folder, uid)?;
    Ok(parse_body(&raw))
}

pub fn fetch_raw(cfg: &AccountConfig, folder: &str, uid: u32) -> Result<Vec<u8>, MailError> {
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
    let attachments = attachments_of(&parsed);
    ParsedBody {
        text,
        html,
        truncated,
        attachments,
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

/// Санитизация HTML письма: вычищает опасное (скрипты, on*-атрибуты).
/// Внешние картинки НЕ вырезаются при хранении — они блокируются на рендере
/// (CSP в iframe), а кнопка «Показать картинки» разрешает их для этого просмотра.
pub fn sanitize_html(html: &str) -> String {
    ammonia::Builder::default()
        .strip_comments(true)
        .link_rel(Some("noopener noreferrer"))
        .clean(html)
        .to_string()
}

/// Метаданные вложений письма (без cid-inline частей без имени).
fn attachments_of(parsed: &mail_parser::Message) -> Vec<AttachmentMeta> {
    parsed
        .attachments()
        .enumerate()
        .filter_map(|(i, part)| {
            let name = part
                .attachment_name()
                .map(decode_rfc2047)
                .unwrap_or_default();
            let is_attachment = part
                .content_disposition()
                .map(|d| d.c_type == "attachment")
                .unwrap_or(false);
            if name.is_empty() && !is_attachment {
                return None;
            }
            let size = part_size(part);
            if size == 0 {
                return None;
            }
            let name = if name.is_empty() {
                format!("файл-{}", i + 1)
            } else {
                name
            };
            let mime = match part.content_type() {
                Some(ct) => match ct.subtype() {
                    Some(st) => format!("{}/{}", ct.c_type, st),
                    None => ct.c_type.to_string(),
                },
                None => "application/octet-stream".to_string(),
            };
            Some(AttachmentMeta {
                name,
                mime,
                size: size as u32,
                index: i as u32,
            })
        })
        .collect()
}

/// Размер содержимого части (в байтах, после декодирования).
fn part_size(part: &mail_parser::MessagePart) -> usize {
    match &part.body {
        mail_parser::PartType::Binary(b) | mail_parser::PartType::InlineBinary(b) => b.len(),
        mail_parser::PartType::Text(t) | mail_parser::PartType::Html(t) => t.len(),
        _ => 0,
    }
}

/// Сохраняет вложение в папку «Загрузки». Возвращает полный путь.
pub fn save_attachment_to_downloads(raw: &[u8], index: u32) -> Result<String, MailError> {
    let parsed = mail_parser::MessageParser::default()
        .parse(raw)
        .ok_or_else(|| MailError::Protocol("не разобрать письмо".into()))?;
    let part = parsed
        .attachments()
        .nth(index as usize)
        .ok_or_else(|| MailError::Protocol("вложение не найдено".into()))?;
    let data: Vec<u8> = match &part.body {
        mail_parser::PartType::Binary(b) | mail_parser::PartType::InlineBinary(b) => b.to_vec(),
        mail_parser::PartType::Text(t) | mail_parser::PartType::Html(t) => t.as_bytes().to_vec(),
        _ => return Err(MailError::Protocol("неизвестный формат вложения".into())),
    };
    let name = part
        .attachment_name()
        .map(decode_rfc2047)
        .map(|s| sanitize_file_name(&s))
        .unwrap_or_else(|| format!("файл-{}", index + 1));
    let dir = downloads_dir()?;
    let path = unique_path(&dir, &name);
    std::fs::write(&path, &data)
        .map_err(|e| MailError::Store(format!("не сохранить файл {}: {e}", path.display())))?;
    Ok(path.display().to_string())
}

fn downloads_dir() -> Result<std::path::PathBuf, MailError> {
    let profile = std::env::var("USERPROFILE")
        .map_err(|_| MailError::Config("переменная USERPROFILE недоступна".into()))?;
    let dir = std::path::PathBuf::from(profile).join("Downloads");
    std::fs::create_dir_all(&dir)
        .map_err(|e| MailError::Store(format!("не создать папку {}: {e}", dir.display())))?;
    Ok(dir)
}

/// Имя файла без пути и запрещённых символов.
fn sanitize_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("файл");
    let cleaned: String = base
        .chars()
        .filter(|c| !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        "файл".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Уникальный путь: при совпадении добавит " (1)", " (2)"… перед расширением.
fn unique_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let path = dir.join(name);
    if !path.exists() {
        return path;
    }
    let base = std::path::Path::new(name);
    let stem = base
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string());
    let ext = base.extension().map(|s| s.to_string_lossy().to_string());
    for i in 1..1000 {
        let candidate = match &ext {
            Some(e) => dir.join(format!("{stem} ({i}).{e}")),
            None => dir.join(format!("{stem} ({i})")),
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    path
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
    fn sanitize_strips_scripts_but_keeps_img_src() {
        let out = sanitize_html(
            "<b>ok</b><script>alert(1)</script><img src=\"http://tracker.example/x.gif\" alt=\"pic\"><a href=\"http://e.ru\" onclick=\"x()\">l</a>",
        );
        assert!(out.contains("<b>ok</b>"));
        assert!(!out.contains("script"));
        assert!(out.contains("tracker.example"));
        assert!(!out.contains("onclick"));
        assert!(out.contains("pic"));
    }

    const MAIL_WITH_ATTACH: &str = concat!(
        "From: a@b.ru\r\n",
        "Subject: with file\r\n",
        "MIME-Version: 1.0\r\n",
        "Content-Type: multipart/mixed; boundary=\"MIX\"\r\n",
        "\r\n",
        "--MIX\r\n",
        "Content-Type: text/plain; charset=utf-8\r\n",
        "\r\n",
        "Тело\r\n",
        "--MIX\r\n",
        "Content-Type: application/pdf; name=\"=?utf-8?B?0LTQvtC6LnBkZg==?=\"\r\n",
        "Content-Transfer-Encoding: base64\r\n",
        "Content-Disposition: attachment; filename=\"=?utf-8?B?0LTQvtC6LnBkZg==?=\"\r\n",
        "\r\n",
        "SGVsbG8=\r\n",
        "--MIX--\r\n"
    );

    #[test]
    fn parses_attachments() {
        let b = parse_body(MAIL_WITH_ATTACH.as_bytes());
        assert_eq!(b.attachments.len(), 1);
        let a = &b.attachments[0];
        assert_eq!(a.name, "док.pdf");
        assert_eq!(a.mime, "application/pdf");
        assert_eq!(a.size, 5);
    }

    #[test]
    fn sanitize_file_name_strips_dangerous_chars() {
        assert_eq!(
            super::sanitize_file_name("C:\\evil\\path\\док.pdf"),
            "док.pdf"
        );
        assert_eq!(super::sanitize_file_name("a:b*c?.txt"), "abc.txt");
        assert_eq!(super::sanitize_file_name(".."), "файл");
    }
}

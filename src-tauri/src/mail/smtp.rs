//! SMTP: отправка писем через сервер провайдера (TASK-004).

use super::MailError;
use super::imap::AccountConfig;
use lettre::Transport;
use lettre::message::{Attachment, Mailbox, Message, MultiPart, SinglePart, header::ContentType};
use lettre::transport::smtp::SmtpTransport;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use serde::Deserialize;
use std::time::Duration;

const SEND_TIMEOUT: Duration = Duration::from_secs(25);

/// Вложение из запроса на отправку (base64 от интерфейса).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInput {
    pub name: String,
    pub mime: String,
    pub data_b64: String,
}

/// Декодированное вложение для письма.
#[derive(Debug, Clone)]
pub struct OutgoingAttachment {
    pub name: String,
    pub mime: String,
    pub data: Vec<u8>,
}

/// Декодирует и проверяет вложения (≤ 15 МБ файл, ≤ 20 МБ суммарно).
pub fn decode_attachments(files: &[AttachmentInput]) -> Result<Vec<OutgoingAttachment>, MailError> {
    use base64::Engine as _;
    const MAX_FILE: usize = 15 * 1024 * 1024;
    const MAX_TOTAL: usize = 20 * 1024 * 1024;
    let mut out = Vec::new();
    let mut total = 0usize;
    for f in files {
        let data = base64::engine::general_purpose::STANDARD
            .decode(f.data_b64.as_bytes())
            .map_err(|e| {
                MailError::Config(format!("вложение «{}»: плохой base64 ({e})", f.name))
            })?;
        if data.len() > MAX_FILE {
            return Err(MailError::Config(format!(
                "вложение «{}» больше 15 МБ",
                f.name
            )));
        }
        total += data.len();
        if total > MAX_TOTAL {
            return Err(MailError::Config(
                "суммарный размер вложений больше 20 МБ".into(),
            ));
        }
        let name = f
            .name
            .rsplit(['/', '\\'])
            .next()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("файл")
            .to_string();
        let mime = if f.mime.trim().is_empty() {
            "application/octet-stream".to_string()
        } else {
            f.mime.trim().to_string()
        };
        out.push(OutgoingAttachment { name, mime, data });
    }
    Ok(out)
}

/// Разбирает список получателей: `a@b.ru`, `Имя <a@b.ru>`, через запятую или точку с запятой.
/// Хвостовые разделители (автодополнение добавляет «, ») просто игнорируются.
pub fn parse_recipients(to: &str) -> Result<Vec<Mailbox>, MailError> {
    let mut out: Vec<Mailbox> = Vec::new();
    for part in to.split([',', ';']) {
        let raw = part.trim();
        if raw.is_empty() {
            continue;
        }
        let clear = raw.trim_matches('"').trim();
        let mb: Mailbox = clear
            .parse()
            .map_err(|e| MailError::Config(format!("плохой адрес получателя «{clear}»: {e}")))?;
        if !out.iter().any(|m| m.email == mb.email) {
            out.push(mb);
        }
    }
    if out.is_empty() {
        return Err(MailError::Config("не указан получатель".into()));
    }
    Ok(out)
}

/// Собирает письмо (без сети) — вынесено отдельно для тестов.
pub fn build_message(
    cfg: &AccountConfig,
    to: &str,
    subject: &str,
    body: &str,
    attachments: &[OutgoingAttachment],
) -> Result<Message, MailError> {
    let from: lettre::Address = cfg
        .user
        .parse()
        .map_err(|e| MailError::Config(format!("плохой адрес отправителя: {e}")))?;
    let recipients = parse_recipients(to)?;
    let subject = if subject.trim().is_empty() {
        "(без темы)".to_string()
    } else {
        subject.trim().to_string()
    };
    let mut builder = Message::builder().from(from.into()).subject(subject);
    for rcpt in recipients {
        builder = builder.to(rcpt);
    }

    if attachments.is_empty() {
        return builder
            .header(ContentType::TEXT_PLAIN)
            .body(body.to_string())
            .map_err(|e| MailError::Protocol(format!("не собрать письмо: {e}")));
    }

    let mut mixed = MultiPart::mixed().singlepart(SinglePart::plain(body.to_string()));
    for a in attachments {
        let ct = ContentType::parse(&a.mime).unwrap_or(ContentType::TEXT_PLAIN);
        mixed = mixed.singlepart(Attachment::new(a.name.clone()).body(a.data.clone(), ct));
    }
    builder
        .multipart(mixed)
        .map_err(|e| MailError::Protocol(format!("не собрать письмо: {e}")))
}

/// Отправляет письмо через SMTP учётной записи.
/// TLS: порт 465 — неявный TLS; иначе — STARTTLS.
pub fn send_message(
    cfg: &AccountConfig,
    to: &str,
    subject: &str,
    body: &str,
    attachments: &[OutgoingAttachment],
) -> Result<(), MailError> {
    let email = build_message(cfg, to, subject, body, attachments)?;

    let tls_params = TlsParameters::new(cfg.smtp_host.clone())
        .map_err(|e| MailError::Network(format!("TLS: {e}")))?;
    let tls = if cfg.smtp_port == 465 {
        Tls::Wrapper(tls_params)
    } else {
        Tls::Required(tls_params)
    };

    let mailer = SmtpTransport::builder_dangerous(&cfg.smtp_host)
        .port(cfg.smtp_port)
        .tls(tls)
        .credentials(Credentials::new(cfg.user.clone(), cfg.password.clone()))
        .timeout(Some(SEND_TIMEOUT))
        .build();

    let _response = mailer.send(&email).map_err(|e| {
        let s = e.to_string();
        if s.contains("authentication") || s.contains("535") {
            MailError::Auth(s)
        } else {
            MailError::Network(format!("SMTP: {s}"))
        }
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{AccountConfig, build_message};

    fn cfg() -> AccountConfig {
        AccountConfig {
            host: "imap.mail.ru".to_string(),
            port: 993,
            smtp_host: "smtp.mail.ru".to_string(),
            smtp_port: 465,
            user: "reznikov_a@mail.ru".to_string(),
            password: "secret".to_string(),
        }
    }

    #[test]
    fn builds_message_with_cyrillic_subject() {
        let m = build_message(
            &cfg(),
            "reznikov_a@mail.ru",
            "Привет, мир!",
            "Тело письма",
            &[],
        )
        .expect("письмо должно собраться");
        let raw = String::from_utf8_lossy(&m.formatted()).to_string();
        assert!(
            raw.contains("Subject: =?"),
            "тема должна кодироваться: {raw}"
        );
        assert!(raw.contains("From: reznikov_a@mail.ru"));
        assert!(raw.contains("To: reznikov_a@mail.ru"));
    }

    #[test]
    fn rejects_bad_recipient() {
        assert!(build_message(&cfg(), "не-адрес", "x", "y", &[]).is_err());
    }

    #[test]
    fn empty_subject_becomes_placeholder() {
        let m = build_message(&cfg(), "a@b.ru", "   ", "y", &[]).expect("письмо должно собраться");
        let raw = String::from_utf8_lossy(&m.formatted()).to_string();
        assert!(raw.contains("Subject:"));
    }

    #[test]
    fn builds_message_with_attachment() {
        let atts = vec![super::OutgoingAttachment {
            name: "док.pdf".to_string(),
            mime: "application/pdf".to_string(),
            data: b"Hello".to_vec(),
        }];
        let m = build_message(&cfg(), "a@b.ru", "Тема", "Тело", &atts).expect("письмо");
        let raw = String::from_utf8_lossy(&m.formatted()).to_string();
        assert!(raw.contains("multipart/mixed"));
        assert!(raw.contains("application/pdf"));
    }

    #[test]
    fn decodes_attachment_input() {
        let files = vec![super::AttachmentInput {
            name: "C:\\tmp\\док.pdf".to_string(),
            mime: "application/pdf".to_string(),
            data_b64: "SGVsbG8=".to_string(),
        }];
        let atts = super::decode_attachments(&files).expect("декод");
        assert_eq!(atts.len(), 1);
        assert_eq!(atts[0].name, "док.pdf");
        assert_eq!(atts[0].data, b"Hello");
    }

    #[test]
    fn rejects_bad_base64() {
        let files = vec![super::AttachmentInput {
            name: "x.bin".to_string(),
            mime: String::new(),
            data_b64: "!!!".to_string(),
        }];
        assert!(super::decode_attachments(&files).is_err());
    }

    #[test]
    fn parses_recipient_list() {
        let one = super::parse_recipients("reznikov_a@mail.ru, ").expect("один адрес");
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].email.to_string(), "reznikov_a@mail.ru");

        let two = super::parse_recipients("a@b.ru; Имя <c@d.ru>").expect("два адреса");
        assert_eq!(two.len(), 2);
        assert_eq!(two[0].email.to_string(), "a@b.ru");
        assert_eq!(two[1].email.to_string(), "c@d.ru");
        assert_eq!(two[1].name.as_deref(), Some("Имя"));

        assert!(super::parse_recipients(" , ; ").is_err());
        assert!(super::parse_recipients("не-адрес").is_err());
    }

    /// Живой тест: реально отправляет письмо через SMTP (только вручную).
    /// Запуск: cargo test --lib -- --ignored
    #[test]
    #[ignore = "живой тест: реально отправляет письмо через SMTP"]
    fn live_send() {
        let cfg = crate::mail::imap::load_account().expect("учётка должна загрузиться");
        let to = cfg.user.clone();
        super::send_message(
            &cfg,
            &to,
            "Сорока: живой тест SMTP (TASK-004)",
            "Проверка отправки. Кириллица: привет, мир!",
            &[],
        )
        .expect("письмо должно отправиться");
    }
}

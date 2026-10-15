//! SMTP: отправка писем через сервер провайдера (TASK-004).

use super::MailError;
use super::imap::AccountConfig;
use lettre::Transport;
use lettre::message::{Message, header::ContentType};
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::SmtpTransport;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use std::time::Duration;

const SEND_TIMEOUT: Duration = Duration::from_secs(25);

/// Собирает письмо (без сети) — вынесено отдельно для тестов.
pub fn build_message(
    cfg: &AccountConfig,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<Message, MailError> {
    let from: lettre::Address = cfg
        .user
        .parse()
        .map_err(|e| MailError::Config(format!("плохой адрес отправителя: {e}")))?;
    let to: lettre::Address = to
        .trim()
        .parse()
        .map_err(|e| MailError::Config(format!("плохой адрес получателя: {e}")))?;
    let subject = if subject.trim().is_empty() {
        "(без темы)".to_string()
    } else {
        subject.trim().to_string()
    };
    Message::builder()
        .from(from.into())
        .to(to.into())
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body.to_string())
        .map_err(|e| MailError::Protocol(format!("не собрать письмо: {e}")))
}

/// Отправляет письмо через SMTP учётной записи.
/// TLS: порт 465 — неявный TLS; иначе — STARTTLS.
pub fn send_message(
    cfg: &AccountConfig,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<(), MailError> {
    let email = build_message(cfg, to, subject, body)?;

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
        let m = build_message(&cfg(), "reznikov_a@mail.ru", "Привет, мир!", "Тело письма")
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
        assert!(build_message(&cfg(), "не-адрес", "x", "y").is_err());
    }

    #[test]
    fn empty_subject_becomes_placeholder() {
        let m = build_message(&cfg(), "a@b.ru", "   ", "y").expect("письмо должно собраться");
        let raw = String::from_utf8_lossy(&m.formatted()).to_string();
        assert!(raw.contains("Subject:"));
    }
}

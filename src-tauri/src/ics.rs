//! Экспорт событий из писем в календарь (.ics) — TASK-013.
//!
//! «Сорока» ничего не отправляет сама: она сохраняет файл-приглашение
//! в «Загрузки», который пользователь открывает двойным щелчком.

use crate::mail::body;
use crate::mail::MailError;

/// Событие для экспорта: `start`/`end` — "YYYY-MM-DD" (весь день)
/// или "YYYY-MM-DDTHH:MM" (местное время).
pub struct IcsEvent<'a> {
    pub title: &'a str,
    pub start: &'a str,
    pub end: &'a str,
    pub description: &'a str,
}

/// "YYYY-MM-DD" / "YYYY-MM-DDTHH:MM" → ICS-метка времени.
fn ics_stamp(dt: &str) -> Result<String, String> {
    if !dt.is_ascii() {
        return Err(format!("неверный формат даты: {dt}"));
    }
    let b = dt.as_bytes();
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit());
    if dt.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && digits(&dt[0..4])
        && digits(&dt[5..7])
        && digits(&dt[8..10])
    {
        return Ok(format!("{}{}{}", &dt[0..4], &dt[5..7], &dt[8..10]));
    }
    if dt.len() == 16
        && b[4] == b'-'
        && b[7] == b'-'
        && b[10] == b'T'
        && b[13] == b':'
        && digits(&dt[0..4])
        && digits(&dt[5..7])
        && digits(&dt[8..10])
        && digits(&dt[11..13])
        && digits(&dt[14..16])
    {
        return Ok(format!(
            "{}{}{}T{}{}00",
            &dt[0..4],
            &dt[5..7],
            &dt[8..10],
            &dt[11..13],
            &dt[14..16]
        ));
    }
    Err(format!("неверный формат даты: {dt}"))
}

/// Экранирование текста по RFC 5545.
fn escape_text(s: &str) -> String {
    s.replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
}

/// Собрать .ics (RFC 5545; строки через CRLF).
pub fn build_ics(ev: &IcsEvent) -> Result<String, String> {
    let start = ics_stamp(ev.start)?;
    let end = ics_stamp(ev.end)?;
    let all_day = ev.start.len() == 10;
    let (ds, de) = if all_day {
        (
            format!("DTSTART;VALUE=DATE:{start}"),
            format!("DTEND;VALUE=DATE:{end}"),
        )
    } else {
        (format!("DTSTART:{start}"), format!("DTEND:{end}"))
    };
    let uid = uuid::Uuid::new_v4();
    let stamp = utc_stamp_now();
    let lines = [
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//Soroka//Mail-to-Calendar//RU".to_string(),
        "CALSCALE:GREGORIAN".to_string(),
        "METHOD:PUBLISH".to_string(),
        "BEGIN:VEVENT".to_string(),
        format!("UID:{uid}@soroka.local"),
        format!("DTSTAMP:{stamp}"),
        ds,
        de,
        format!("SUMMARY:{}", escape_text(ev.title)),
        format!("DESCRIPTION:{}", escape_text(ev.description)),
        "END:VEVENT".to_string(),
        "END:VCALENDAR".to_string(),
    ];
    Ok(lines.join("\r\n") + "\r\n")
}

/// Текущее UTC-время в ICS-формате (без внешних крейтов).
pub fn utc_stamp_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}{m:02}{d:02}T{:02}{:02}{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Дни от 1970-01-01 → (год, месяц, день); алгоритм Говарда Хиннанта.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Базовое имя файла: «Сорока событие ДД.ММ.ГГГГ.ics».
pub fn file_base_name(start: &str) -> String {
    if start.len() >= 10 && start.is_ascii() {
        format!(
            "Сорока событие {}.{}.{}.ics",
            &start[8..10],
            &start[5..7],
            &start[0..4]
        )
    } else {
        "Сорока событие.ics".to_string()
    }
}

/// Сохранить .ics в «Загрузки» (имя уникализируется). Возвращает полный путь.
pub fn save_to_downloads(content: &str, base_name: &str) -> Result<String, MailError> {
    let dir = body::downloads_dir()?;
    let name = body::sanitize_file_name(base_name);
    let path = body::unique_path(&dir, &name);
    std::fs::write(&path, content)
        .map_err(|e| MailError::Store(format!("не сохранить файл {}: {e}", path.display())))?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_day_event_uses_value_date() {
        let ev = IcsEvent {
            title: "Субботник",
            start: "2026-10-17",
            end: "2026-10-18",
            description: "из письма",
        };
        let out = build_ics(&ev).expect("ics собирается");
        assert!(out.starts_with("BEGIN:VCALENDAR\r\n"));
        assert!(out.ends_with("END:VCALENDAR\r\n"));
        assert!(out.contains("DTSTART;VALUE=DATE:20261017\r\n"));
        assert!(out.contains("DTEND;VALUE=DATE:20261018\r\n"));
        assert!(out.contains("SUMMARY:Субботник\r\n"));
    }

    #[test]
    fn timed_event_has_time() {
        let ev = IcsEvent {
            title: "Звонок",
            start: "2026-10-17T12:30",
            end: "2026-10-17T13:30",
            description: "",
        };
        let out = build_ics(&ev).expect("ics собирается");
        assert!(out.contains("DTSTART:20261017T123000\r\n"));
        assert!(out.contains("DTEND:20261017T133000\r\n"));
    }

    #[test]
    fn text_is_escaped() {
        let ev = IcsEvent {
            title: "Оплатить, срочно; скидка",
            start: "2026-11-15",
            end: "2026-11-16",
            description: "первая строка\nвторая",
        };
        let out = build_ics(&ev).expect("ics собирается");
        assert!(out.contains("SUMMARY:Оплатить\\, срочно\\; скидка\r\n"));
        assert!(out.contains("DESCRIPTION:первая строка\\nвторая\r\n"));
    }

    #[test]
    fn bad_dates_are_rejected() {
        assert!(ics_stamp("2026-13").is_err());
        assert!(ics_stamp("17 октября").is_err());
        assert!(ics_stamp("2026-10-17T12").is_err());
        assert!(ics_stamp("").is_err());
    }

    #[test]
    fn civil_days_known_points() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(10_957), (2000, 1, 1));
    }

    #[test]
    fn file_name_from_date() {
        assert_eq!(file_base_name("2026-10-17"), "Сорока событие 17.10.2026.ics");
        assert_eq!(
            file_base_name("2026-10-17T09:00"),
            "Сорока событие 17.10.2026.ics"
        );
    }
}

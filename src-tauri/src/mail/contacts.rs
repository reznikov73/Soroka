//! Адресная книга «Сороки» (TASK-024): контакты, импорт/экспорт CSV и vCard,
//! разбор ответа ИИ при заполнении карточки по письму.

use serde::{Deserialize, Serialize};

/// Контакт адресной книги.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Contact {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub organization: String,
    #[serde(default)]
    pub position: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub groups: String,
}

/// Подсказка для поля «Кому»: из книги или из переписки.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddressSuggestion {
    pub email: String,
    pub name: String,
    /// "contact" — адресная книга, "mail" — переписка.
    pub source: String,
    pub count: u32,
}

/// Черновик карточки, который предлагает ИИ по тексту письма.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ContactDraft {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub organization: String,
    #[serde(default)]
    pub position: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub notes: String,
}

/// Папки, из которых не берём адреса для подсказок.
pub fn is_noise_folder(folder: &str) -> bool {
    let f = folder.to_lowercase();
    ["spam", "junk", "trash", "спам", "корзин", "удалён", "удален"]
        .iter()
        .any(|w| f.contains(w))
}

/// Достаёт адрес из строки вида `Имя <a@b.ru>` или `a@b.ru`.
pub fn extract_email(raw: &str) -> String {
    if let (Some(open), Some(close)) = (raw.find('<'), raw.rfind('>'))
        && close > open
    {
        return raw[open + 1..close].trim().to_lowercase();
    }
    let t = raw.trim().trim_matches(|c| c == '"' || c == '\'' || c == ',' || c == ';');
    if t.contains('@') && !t.contains(' ') {
        return t.to_lowercase();
    }
    t.split_whitespace()
        .find(|w| w.contains('@'))
        .map(|w| w.trim_matches(|c| c == '<' || c == '>' || c == ',').to_lowercase())
        .unwrap_or_default()
}

/// Имя из строки `Имя <a@b.ru>`; для голого адреса — пусто.
pub fn extract_name(raw: &str) -> String {
    match raw.find('<') {
        Some(pos) => raw[..pos]
            .trim()
            .trim_matches('"')
            .trim()
            .to_string(),
        None => String::new(),
    }
}

fn parse_csv_rows(text: &str, delim: char) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                if in_quotes && chars.peek() == Some(&'"') {
                    cur.push('"');
                    chars.next();
                } else {
                    in_quotes = !in_quotes;
                }
            }
            _ if c == delim && !in_quotes => row.push(std::mem::take(&mut cur)),
            '\r' => {}
            '\n' if !in_quotes => {
                row.push(std::mem::take(&mut cur));
                rows.push(std::mem::take(&mut row));
            }
            _ => cur.push(c),
        }
    }
    if !cur.is_empty() || !row.is_empty() {
        row.push(cur);
        rows.push(row);
    }
    rows.retain(|r| !r.iter().all(|c| c.trim().is_empty()));
    rows.into_iter()
        .map(|r| r.into_iter().map(|s| s.trim().to_string()).collect())
        .collect()
}

fn field_index(header: &[String], names: &[&str]) -> Option<usize> {
    header
        .iter()
        .position(|h| names.iter().any(|n| h.to_lowercase().trim() == *n))
}

/// Разбирает CSV. Разделитель — `;` или `,` (по первой строке), заголовки необязательны.
pub fn parse_csv(text: &str) -> Vec<Contact> {
    let first_line = text.lines().next().unwrap_or("");
    let delim = if first_line.matches(';').count() >= first_line.matches(',').count() {
        ';'
    } else {
        ','
    };
    let rows = parse_csv_rows(text, delim);
    if rows.is_empty() {
        return Vec::new();
    }
    let header: Vec<String> = rows[0].iter().map(|s| s.to_lowercase()).collect();
    let has_header = field_index(&header, &["email", "e-mail", "почта", "адрес", "имя", "name"]).is_some();
    let idx_name = field_index(&header, &["name", "имя", "фио"]);
    let idx_email = field_index(&header, &["email", "e-mail", "почта", "адрес"]);
    let idx_org = field_index(&header, &["organization", "организация", "компания"]);
    let idx_pos = field_index(&header, &["position", "должность"]);
    let idx_phone = field_index(&header, &["phone", "телефон", "тел"]);
    let idx_notes = field_index(&header, &["notes", "заметки", "примечание"]);
    let idx_groups = field_index(&header, &["groups", "группы", "категории"]);

    let mut out = Vec::new();
    for row in rows.iter().skip(if has_header { 1 } else { 0 }) {
        let get = |i: Option<usize>| -> String {
            i.and_then(|n| row.get(n)).cloned().unwrap_or_default()
        };
        let (name, email, organization) = if has_header {
            (get(idx_name), get(idx_email), get(idx_org))
        } else {
            (get(Some(0)), get(Some(1)), get(Some(2)))
        };
        let email = extract_email(&email);
        if !email.contains('@') {
            continue;
        }
        out.push(Contact {
            id: 0,
            name: if name.is_empty() { extract_name(&get(idx_email)) } else { name },
            email,
            organization,
            position: get(idx_pos),
            phone: get(idx_phone),
            notes: get(idx_notes),
            groups: get(idx_groups),
        });
    }
    out
}

fn csv_cell(value: &str) -> String {
    if value.contains(';') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Экспорт в CSV для Excel (разделитель `;`, BOM для кириллицы).
pub fn to_csv(items: &[Contact]) -> String {
    let mut out = String::from("\u{feff}Имя;E-mail;Организация;Должность;Телефон;Заметки;Группы\n");
    for c in items {
        out.push_str(&[
            csv_cell(&c.name),
            csv_cell(&c.email),
            csv_cell(&c.organization),
            csv_cell(&c.position),
            csv_cell(&c.phone),
            csv_cell(&c.notes),
            csv_cell(&c.groups),
        ]
        .join(";"));
        out.push('\n');
    }
    out
}

fn vcf_unescape(value: &str) -> String {
    value
        .replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}

/// Разбирает vCard 3.0/4.0 (несколько карточек в одном файле).
pub fn parse_vcf(text: &str) -> Vec<Contact> {
    // Склеиваем перенесённые строки (продолжение начинается с пробела или табуляции).
    let mut lines: Vec<String> = Vec::new();
    for raw in text.lines() {
        let line = raw.trim_end_matches('\r');
        if (line.starts_with(' ') || line.starts_with('\t')) && !lines.is_empty() {
            if let Some(last) = lines.last_mut() {
                last.push_str(line.trim_start());
            }
        } else {
            lines.push(line.to_string());
        }
    }

    let mut out = Vec::new();
    let mut cur = Contact::default();
    let mut inside = false;
    for line in lines {
        let upper = line.to_uppercase();
        if upper.starts_with("BEGIN:VCARD") {
            inside = true;
            cur = Contact::default();
            continue;
        }
        if upper.starts_with("END:VCARD") {
            if inside && cur.email.contains('@') {
                out.push(cur.clone());
            }
            inside = false;
            continue;
        }
        if !inside {
            continue;
        }
        let Some(colon) = line.find(':') else { continue };
        let head = &line[..colon];
        let value = vcf_unescape(line[colon + 1..].trim());
        let name = head.split(';').next().unwrap_or("").to_uppercase();
        match name.as_str() {
            "FN" => cur.name = value,
            "ORG" => cur.organization = value.replace(';', " ").trim().to_string(),
            "TITLE" => cur.position = value,
            "TEL" => {
                if cur.phone.is_empty() {
                    cur.phone = value;
                }
            }
            "NOTE" => cur.notes = value,
            "CATEGORIES" => cur.groups = value.replace(';', ", "),
            "EMAIL" => {
                let e = extract_email(&value);
                if cur.email.is_empty() && e.contains('@') {
                    cur.email = e;
                }
            }
            _ => {}
        }
    }
    out
}

fn vcf_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace(';', "\\;")
        .replace(',', "\\,")
}

/// Экспорт в vCard 3.0.
pub fn to_vcf(items: &[Contact]) -> String {
    let mut out = String::new();
    for c in items {
        out.push_str("BEGIN:VCARD\r\nVERSION:3.0\r\n");
        out.push_str(&format!("FN:{}\r\n", vcf_escape(&c.name)));
        let parts: Vec<&str> = c.name.split_whitespace().collect();
        let last = parts.first().copied().unwrap_or("");
        out.push_str(&format!("N:{};;;;\r\n", vcf_escape(last)));
        out.push_str(&format!("EMAIL;TYPE=INTERNET:{}\r\n", c.email));
        if !c.organization.is_empty() {
            out.push_str(&format!("ORG:{}\r\n", vcf_escape(&c.organization)));
        }
        if !c.position.is_empty() {
            out.push_str(&format!("TITLE:{}\r\n", vcf_escape(&c.position)));
        }
        if !c.phone.is_empty() {
            out.push_str(&format!("TEL:{}\r\n", vcf_escape(&c.phone)));
        }
        if !c.notes.is_empty() {
            out.push_str(&format!("NOTE:{}\r\n", vcf_escape(&c.notes)));
        }
        if !c.groups.is_empty() {
            out.push_str(&format!("CATEGORIES:{}\r\n", vcf_escape(&c.groups)));
        }
        out.push_str("END:VCARD\r\n");
    }
    out
}

/// Разбирает ответ ИИ: ищет JSON-объект и читает поля карточки.
pub fn parse_contact_json(text: &str) -> Option<ContactDraft> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    let slice = &text[start..=end];
    let draft: ContactDraft = serde_json::from_str(slice).ok()?;
    let draft = ContactDraft {
        name: draft.name.trim().to_string(),
        email: draft.email.trim().to_lowercase(),
        organization: draft.organization.trim().to_string(),
        position: draft.position.trim().to_string(),
        phone: draft.phone.trim().to_string(),
        notes: draft.notes.trim().to_string(),
    };
    if draft.name.is_empty()
        && draft.organization.is_empty()
        && draft.position.is_empty()
        && draft.phone.is_empty()
        && draft.notes.is_empty()
    {
        return None;
    }
    Some(draft)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_email_and_name() {
        assert_eq!(extract_email("Иван Петров <Ivan@Mail.Ru>"), "ivan@mail.ru");
        assert_eq!(extract_email("plain@mail.ru"), "plain@mail.ru");
        assert_eq!(extract_name("Иван Петров <Ivan@Mail.Ru>"), "Иван Петров");
        assert_eq!(extract_name("plain@mail.ru"), "");
        assert!(is_noise_folder("INBOX/Spam"));
        assert!(is_noise_folder("Корзина"));
        assert!(!is_noise_folder("INBOX"));
    }

    #[test]
    fn csv_with_header_and_quotes() {
        let text = "Имя;E-mail;Организация;Должность;Телефон;Заметки;Группы\n\
                    \"Петров, Иван\";ivan@mail.ru;\"ООО \"\"Ромашка\"\"\";Директор;+7 900;важный;Клиенты\n\
                    Мария;maria@mail.ru;;;;;\n";
        let list = parse_csv(text);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "Петров, Иван");
        assert_eq!(list[0].organization, "ООО \"Ромашка\"");
        assert_eq!(list[1].email, "maria@mail.ru");
    }

    #[test]
    fn csv_without_header_uses_order() {
        let list = parse_csv("Иван;ivan@mail.ru;Фирма\n");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Иван");
        assert_eq!(list[0].organization, "Фирма");
    }

    #[test]
    fn csv_roundtrip() {
        let items = vec![Contact {
            name: "Иван".to_string(),
            email: "ivan@mail.ru".to_string(),
            organization: "Фирма; большая".to_string(),
            position: "Директор".to_string(),
            phone: "+7".to_string(),
            notes: "строка 1\nстрока 2".to_string(),
            groups: "Клиенты".to_string(),
            id: 0,
        }];
        let parsed = parse_csv(&to_csv(&items));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].organization, "Фирма; большая");
        assert_eq!(parsed[0].notes, "строка 1\nстрока 2");
    }

    #[test]
    fn vcf_parses_two_cards() {
        let text = "BEGIN:VCARD\nVERSION:3.0\nFN:Иван Петров\nEMAIL;TYPE=INTERNET:ivan@mail.ru\n\
                    ORG:Ромашка\nTITLE:Директор\nNOTE:Позвонить\\nзавтра\nCATEGORIES:Клиенты\nEND:VCARD\n\
                    BEGIN:VCARD\nVERSION:3.0\nFN:Мария\nEMAIL:maria@mail.ru\nEND:VCARD\n";
        let list = parse_vcf(text);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "Иван Петров");
        assert_eq!(list[0].organization, "Ромашка");
        assert_eq!(list[0].notes, "Позвонить\nзавтра");
        assert_eq!(list[0].groups, "Клиенты");
        assert_eq!(list[1].email, "maria@mail.ru");
    }

    #[test]
    fn vcf_roundtrip() {
        let items = vec![Contact {
            name: "Иван".to_string(),
            email: "ivan@mail.ru".to_string(),
            organization: "Фирма".to_string(),
            position: "Директор".to_string(),
            phone: "+7 900".to_string(),
            notes: "важно".to_string(),
            groups: "Клиенты".to_string(),
            id: 0,
        }];
        let parsed = parse_vcf(&to_vcf(&items));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].email, "ivan@mail.ru");
        assert_eq!(parsed[0].position, "Директор");
    }

    #[test]
    fn parses_ai_json() {
        let draft = parse_contact_json(
            "```json\n{\"name\":\"Иван\",\"organization\":\"Фирма\",\"position\":\"Директор\",\"phone\":\"+7\",\"notes\":\"\",\"email\":\"\"}\n```",
        )
        .unwrap();
        assert_eq!(draft.name, "Иван");
        assert_eq!(draft.phone, "+7");
        assert!(parse_contact_json("не понял").is_none());
    }
}
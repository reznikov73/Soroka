//! Общие настройки «Сороки» — TASK-020.
//!
//! Категории ИИ, системные промпты и подписи живут в одном файле
//! `%APPDATA%\Soroka\settings.json` и общие для всех ящиков. Настройки
//! отдельного ящика (серверы, логин) остаются в `accounts.json`.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Правила, по которым письмо попадает в категорию без ИИ.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct CategoryRule {
    #[serde(default)]
    pub from_contains: Vec<String>,
    #[serde(default)]
    pub subject_contains: Vec<String>,
}

impl CategoryRule {
    fn is_empty(&self) -> bool {
        self.from_contains.iter().all(|s| s.trim().is_empty())
            && self.subject_contains.iter().all(|s| s.trim().is_empty())
    }

    /// Совпадает ли письмо с правилом (без учёта регистра).
    pub fn matches(&self, from: &str, subject: &str) -> bool {
        let f = from.to_lowercase();
        let s = subject.to_lowercase();
        self.from_contains
            .iter()
            .map(|r| r.trim().to_lowercase())
            .any(|r| !r.is_empty() && f.contains(&r))
            || self
                .subject_contains
                .iter()
                .map(|r| r.trim().to_lowercase())
                .any(|r| !r.is_empty() && s.contains(&r))
    }
}

/// Категория разбора. Порядок в списке = приоритет правил.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub name: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub hint: String,
    #[serde(default)]
    pub rules: CategoryRule,
    /// Встроенные категории нельзя удалить, но можно переименовать правило.
    #[serde(default)]
    pub builtin: bool,
}

fn default_color() -> String {
    "#9aa3b2".to_string()
}

/// Системные промпты. Плейсхолдеры подставляются при вызове.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Prompts {
    pub analysis: String,
    pub reply: String,
    pub improve: String,
    pub translate: String,
}

/// Подпись (как в The Bat!): имя для списка и текст.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signature {
    pub name: String,
    pub text: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub categories: Vec<Category>,
    pub prompts: Prompts,
    #[serde(default)]
    pub signatures: Vec<Signature>,
    #[serde(default)]
    pub appearance: Appearance,
}

fn default_transparent() -> bool {
    true
}

/// Оформление окна.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Appearance {
    /// Прозрачное окно с Mica/Acrylic. `false` — обычное непрозрачное окно.
    #[serde(default = "default_transparent")]
    pub transparent: bool,
}

impl Default for Appearance {
    fn default() -> Self {
        Self { transparent: true }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self::defaults()
    }
}

/// Подстановка вида `{key}` — без зависимостей и без сюрпризов с фигурными скобками в тексте.
pub fn apply(template: &str, pairs: &[(&str, &str)]) -> String {
    let mut out = template.to_string();
    for (key, value) in pairs {
        out = out.replace(&format!("{{{key}}}"), value);
    }
    out
}

impl Settings {
    pub fn defaults() -> Self {
        let categories = vec![
            Category {
                name: "Обучение".to_string(),
                color: "#7de3a8".to_string(),
                hint: "курсы, вебинары, учебные центры".to_string(),
                rules: CategoryRule {
                    from_contains: Vec::new(),
                    subject_contains: vec![
                        "курс".to_string(),
                        "вебинар".to_string(),
                        "обучени".to_string(),
                        "семинар".to_string(),
                    ],
                },
                builtin: true,
            },
            Category {
                name: "Партнёр 1С".to_string(),
                color: "#60cdff".to_string(),
                hint: "письма от 1С и партнёров: лицензии, акции, информационные письма".to_string(),
                rules: CategoryRule {
                    from_contains: vec![
                        "1c.ru".to_string(),
                        "1cnw.ru".to_string(),
                        "1С Информационные письма".to_string(),
                    ],
                    subject_contains: Vec::new(),
                },
                builtin: true,
            },
            Category {
                name: "Клиент".to_string(),
                color: "#8fb8ff".to_string(),
                hint: "письма клиентов и заказчиков".to_string(),
                rules: CategoryRule::default(),
                builtin: true,
            },
            Category {
                name: "Госорган".to_string(),
                color: "#8fb8ff".to_string(),
                hint: "госуслуги, ведомства, налоговая".to_string(),
                rules: CategoryRule::default(),
                builtin: true,
            },
            Category {
                name: "Финансы".to_string(),
                color: "#7de3a8".to_string(),
                hint: "счета, оплаты, банк".to_string(),
                rules: CategoryRule::default(),
                builtin: true,
            },
            Category {
                name: "Уведомление".to_string(),
                color: "#9aa3b2".to_string(),
                hint: "сервисные уведомления и подтверждения".to_string(),
                rules: CategoryRule::default(),
                builtin: true,
            },
            Category {
                name: "Реклама".to_string(),
                color: "#b9c2cf".to_string(),
                hint: "рассылки, акции, промо".to_string(),
                rules: CategoryRule::default(),
                builtin: true,
            },
            Category {
                name: "Личное".to_string(),
                color: "#9aa3b2".to_string(),
                hint: "личная переписка".to_string(),
                rules: CategoryRule::default(),
                builtin: true,
            },
            Category {
                name: "Осторожно".to_string(),
                color: "#ff8a80".to_string(),
                hint: "фишинг, мошенники, подозрительные ссылки".to_string(),
                rules: CategoryRule::default(),
                builtin: true,
            },
        ];

        let prompts = Prompts {
            analysis: "Ты — почтовый помощник. Разбери письмо и верни ТОЛЬКО JSON без markdown и пояснений, строго по схеме:\n\
{{\"summary\": \"суть письма в 1–2 предложениях\", \"category\": \"одно из: {categories}\", \"importance\": \"высокая | обычная | низкая\", \"dates\": [\"важные даты и события, если есть\"], \"tasks\": [\"что от вас могут ждать, если есть\"], \"actions\": [\"краткие предложения действий, если уместны\"]}}\n\
Оценка важности: высокая — требует внимания человека (клиенты, госорганы, счета, личное); низкая — массовые рассылки и реклама; обычная — остальное.\n\
Подсказки по категориям:\n{categories_hint}\n\nТема: {subject}\n\nТекст письма:\n{body}"
                .to_string(),
            reply: "Напиши ответное письмо ОТ ИМЕНИ владельца ящика (ты — не помощник, не сервис).\n\
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
                .to_string(),
            improve: "Ты — внимательный редактор. Перепиши текст письма лучше: исправь орфографию, пунктуацию, ясность и вежливый деловой тон.\n\
Сохрани смысл, факты, имена, числа и язык оригинала. Ничего не добавляй от себя.\n\
Верни ТОЛЬКО улучшенный текст письма — без markdown, пояснений и кавычек.\n\nТекст письма:\n{text}"
                .to_string(),
            translate: "Переведи письмо на русский язык.\n\
Сохрани структуру, абзацы, списки, ссылки, имена и числа. Не пересказывай и не добавляй пояснений — только перевод.\n\
Если текст уже на русском, верни его без изменений.\n\
Верни ТОЛЬКО перевод, без markdown-обёрток и кавычек.\n\nТекст письма:\n{text}"
                .to_string(),
        };

        Self {
            categories,
            prompts,
            signatures: Vec::new(),
            appearance: Appearance::default(),
        }
    }

    /// Имена категорий через запятую — для строки «одно из: …».
    pub fn category_names(&self) -> String {
        self.categories
            .iter()
            .map(|c| c.name.trim())
            .filter(|n| !n.is_empty())
            .collect::<Vec<_>>()
            .join(", ")
    }

    /// Подсказки по категориям — по строке на категорию.
    pub fn categories_hint(&self) -> String {
        let lines: Vec<String> = self
            .categories
            .iter()
            .filter(|c| !c.hint.trim().is_empty())
            .map(|c| format!("- {}: {}", c.name.trim(), c.hint.trim()))
            .collect();
        if lines.is_empty() {
            "(без дополнительных подсказок)".to_string()
        } else {
            lines.join("\n")
        }
    }

    /// Первая категория, чьё правило совпало с письмом.
    pub fn match_category(&self, from: &str, subject: &str) -> Option<String> {
        self.categories
            .iter()
            .find(|c| !c.rules.is_empty() && c.rules.matches(from, subject))
            .map(|c| c.name.clone())
    }

    pub fn find_category(&self, name: &str) -> Option<&Category> {
        let n = name.trim().to_lowercase();
        self.categories
            .iter()
            .find(|c| c.name.trim().to_lowercase() == n)
    }

    pub fn analysis_prompt(&self, subject: &str, body: &str) -> String {
        apply(
            &self.prompts.analysis,
            &[
                ("categories", &self.category_names()),
                ("categories_hint", &self.categories_hint()),
                ("subject", subject),
                ("body", body),
            ],
        )
    }

    pub fn reply_prompt(&self, style: &str, from: &str, subject: &str, body: &str) -> String {
        let style = if style.trim().is_empty() {
            "(примеров нет — пиши нейтрально-деловым тоном)"
        } else {
            style
        };
        apply(
            &self.prompts.reply,
            &[
                ("style", style),
                ("from", from),
                ("subject", subject),
                ("body", body),
            ],
        )
    }

    pub fn improve_prompt(&self, text: &str) -> String {
        apply(&self.prompts.improve, &[("text", text)])
    }

    pub fn translate_prompt(&self, text: &str) -> String {
        apply(&self.prompts.translate, &[("text", text)])
    }
}

fn path() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "переменная APPDATA недоступна".to_string())?;
    Ok(PathBuf::from(appdata).join("Soroka").join("settings.json"))
}

/// Чтение настроек. Битый или отсутствующий файл — стандартный набор.
pub fn load() -> Settings {
    let Ok(p) = path() else {
        return Settings::defaults();
    };
    let Ok(raw) = fs::read_to_string(&p) else {
        return Settings::defaults();
    };
    match serde_json::from_str::<Settings>(&raw) {
        Ok(mut s) => {
            if s.categories.is_empty() {
                s.categories = Settings::defaults().categories;
            }
            if s.prompts.analysis.trim().is_empty() {
                s.prompts.analysis = Settings::defaults().prompts.analysis;
            }
            if s.prompts.reply.trim().is_empty() {
                s.prompts.reply = Settings::defaults().prompts.reply;
            }
            if s.prompts.improve.trim().is_empty() {
                s.prompts.improve = Settings::defaults().prompts.improve;
            }
            if s.prompts.translate.trim().is_empty() {
                s.prompts.translate = Settings::defaults().prompts.translate;
            }
            s
        }
        Err(_) => Settings::defaults(),
    }
}

pub fn save(s: &Settings) -> Result<(), String> {
    let p = path()?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("не удалось создать папку настроек: {e}"))?;
    }
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    fs::write(&p, json).map_err(|e| format!("не удалось сохранить настройки: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_have_1c_and_study() {
        let s = Settings::defaults();
        assert!(s.find_category("Партнёр 1С").is_some());
        assert!(s.find_category("Обучение").is_some());
        assert!(s.category_names().contains("Клиент"));
    }

    #[test]
    fn old_settings_default_to_transparent() {
        let raw = r#"{"categories":[],"prompts":{"analysis":"a","reply":"r","improve":"i","translate":"t"}}"#;
        let s: Settings = serde_json::from_str(raw).unwrap();
        assert!(s.appearance.transparent);
    }

    #[test]
    fn rule_matches_sender_or_subject() {
        let s = Settings::defaults();
        assert_eq!(
            s.match_category("1С Информационные письма <info@1c.ru>", "Вебинар"),
            Some("Обучение".to_string())
        );
        assert_eq!(
            s.match_category("zakaz@1cnw.ru", "Лицензии"),
            Some("Партнёр 1С".to_string())
        );
        assert_eq!(s.match_category("boss@example.com", "Привет"), None);
    }

    #[test]
    fn placeholders_are_substituted() {
        let s = Settings::defaults();
        let p = s.analysis_prompt("Тема", "Тело");
        assert!(p.contains("Партнёр 1С"));
        assert!(p.contains("Тема"));
        assert!(!p.contains("{categories}"));
    }

    #[test]
    fn json_roundtrip_keeps_categories() {
        let s = Settings::defaults();
        let raw = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.categories.len(), s.categories.len());
        assert_eq!(back.categories[0].name, s.categories[0].name);
    }
}

# TASK-040 — POSmail.exe и опции поведения

Версия: **0.37.0**. Дата: 2026-10-21.

## 1. Имя exe
- В `src-tauri/Cargo.toml` добавлен явный бинарник: `[[bin]] name = "POSmail" path = "src/main.rs"`.
- В `tauri.conf.json` — `"mainBinaryName": "POSmail"`, чтобы упаковщик и NSIS брали именно его.
- Результат сборки: `src-tauri/target/release/POSmail.exe` (7.46 МБ); установщик по-прежнему `POS Mail_0.37.0_x64-setup.exe` (2.84 МБ).

## 2. «Запускать при загрузке Windows»
- Настройки → Оформление → чекбокс. Хранится в `settings.json` (`ui.autostart`).
- Команды `set_autostart` / `get_autostart`: пишут и читают `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, значение `POSMail` = путь к текущему exe в кавычках.
- При старте, если опция включена, путь перезаписывается — после обновления программы автозапуск не сломается.
- Проверка вживую: включил галочку → `reg query` показал `POSMail REG_SZ "E:\Work\VSC\PostAi\soroka\src-tauri\target\release\POSmail.exe"`; выключил → запись удалена (`reg query` вернул код 1). Скриншот `p0370-4-autostart.png`.

## 3. «Сворачивать в трей кнопкой «—»»
- Чекбокс в том же разделе, хранится в `ui.minimize_to_tray` (по умолчанию включён).
- Кнопка «—» при включённой опции прячет окно в трей (`hide`), при выключенной — обычное сворачивание на панель задач (`minimize`).
- Проверка: в 0.36.1 прятание в трей проверено (`visible=False`, процесс жив); логика выбора режима — по настройке.

## Проверка сборки
- `npm run build` — ok; `cargo clippy --all-targets -- -D warnings` — чисто.
- `cargo tauri build` — ok; `POSmail.exe` 7.46 МБ, установщик 2.84 МБ.
- Скриншоты: `p0370-1-main.png` (окно POSmail), `p0370-3-appearance.png` (оба переключателя), `p0370-4-autostart.png` (включённый автозапуск).

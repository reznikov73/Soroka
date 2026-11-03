# TASK-001 — Bootstrap проекта «Сорока» (Rust + Tauri 2, Windows 10+)

**Исполнитель:** AutoClaw (AutoCoder). Перед началом прочитать навык `soroka-bootstrap`.
**Рабочая область:** `E:\Work\VSC\PostAi` · **Проект создаётся в:** `E:\Work\VSC\PostAi\soroka`.
**Платформа:** ТОЛЬКО Windows 10+ (x64). IDE: VS Code. Всё, что не относится к Windows — не делать.
**Окружение:** уже подготовлено (см. раздел 1.1 SKILL): Rust `E:\dev\Rust`, MSVC `E:\dev\VSBuildTools`; перед cargo-командами — `. .\scripts\devshell.ps1`.
**Правило:** строго по этапам; каждый этап заканчивается `git add` + `commit` + `push`. Все файлы — UTF-8 без BOM; `.ps1`-скрипты — UTF-8 с BOM (требование PowerShell 5.1).

## Бренд

- productName в конфигах: **Soroka** (ASCII — имена файлов, установщик, exe).
- Человекочитаемое имя в UI/README: «Сорока» — допустимо и приветствуется.
- Identifier: **com.soroka.app**.
- Фирменная фраза для будущих уведомлений о новых письмах: «Сорока на хвосте принесла» (использовать начиная с TASK-002).

## Цель

С нуля создать работающий каркас почтового клиента «Сорока» (аналог The Bat! с ИИ-модулем) на Rust + Tauri 2 для Windows 10+: проверить окружение, создать проект, настроить VS Code (задачи + отладка), заложить структуру модулей, настроить версионирование и сборку релиза (exe + NSIS-установщик), зафиксировать релиз v0.1.0 в git, задокументировать.

## Нефункциональные требования (сквозные)

- RAM в рантайме < 150 МБ; установщик < 20 МБ; CPU в покое ≈ 0%. Фактические замеры (хотя бы RAM в простое через 60 с после запуска) записать в README.
- Вся логика и сеть — только в Rust-бэкенде. Фронтенд — только UI.
- Фронтенд: Vite + TypeScript (vanilla), без тяжёлых фреймворков на старте.
- Секретов в коде и git — нет (только переменные окружения).
- Кодировка файлов — UTF-8 (без BOM).

## Версионирование (сквозное правило)

Единственный источник версии — `src-tauri/tauri.conf.json` → `"version"`. Дальше версия обязана автоматически расходиться по местам (раздел 6 SKILL): `tauri.conf.json` → `Cargo.toml` + `package.json` (скрипт `sync-version.ps1`) → установщик (имя файла и FileVersion) → рантайм UI (`package_info`) → git-тег `vX.Y.Z`. Изменять версию руками в `Cargo.toml` / `package.json` ЗАПРЕЩЕНО.

## Definition of Done (проверяется по пунктам)

- [ ] Таблица «компонент — версия» окружения (rustc, cargo, node, npm, MSVC 14.44.35207, Windows SDK 10.0.26100.0, git, ОС) записана в README
- [ ] Ctrl+Shift+B (задача `tauri:dev`) — окно с 3-панельным каркасом (дерево папок | список писем | просмотр — заглушки)
- [ ] F5 — отладчик останавливается на точке останова внутри команды `ping` (пошагово пройти, убедиться, что работает)
- [ ] Статус-бар UI показывает: «Soroka v0.1.0+g<hash> · backend OK» (команды `app_info` + `ping`, шаблон раздела 6 SKILL)
- [ ] `cargo tauri build` собирает: исполняемый файл приложения (`target\release\soroka.exe`) и NSIS-установщик `Soroka_0.1.0_x64-setup.exe`; размеры записаны в README (< 20 МБ)
- [ ] Версия синхронна во всех 6 местах (см. раздел «Версионирование»)
- [ ] `cargo fmt --check` и `cargo clippy -- -D warnings` — чисто
- [ ] git: коммиты по одному на этап, всё запушено; тег `v0.1.0` создан и запушен; CHANGELOG.md содержит запись `[0.1.0]`
- [ ] README.md: цель, стек и версии, запуск/отладка/сборка, структура, артефакты релиза и их размеры, дорожная карта
- [ ] Итоговый отчёт по пунктам DoD (✅/❌ + версии, размеры, проблемы) — файлом `tasks/TASK-001-report.md`

## Стратегия

Этап 0 (окружение) → 1 (скаффолд + git remote) → 2 (структура + версия + сборщик) → 3 (VS Code: задачи и отладка) → 4 (health-check + версия в UI) → 5 (релиз: exe + установщик + тег) → 6 (документация, отчёт).

**Принципы:**

- Маленькие шаги, маленькие коммиты, каждый — с push.
- Ничего сверх DoD — фичи почты это TASK-002+.
- Ошибка сборки → читать вывод компилятора целиком, чинить причину.
- Стоп-условия: не активируется окружение MSVC (`link.exe`) / нет git remote / не качается NSIS → приложить точный текст ошибки и остановиться (для MSVC сначала раздел 1.1 SKILL).

## Этап 0 — Окружение (Windows 10+)

Окружение на этой машине уже подготовлено (раздел 1.1 SKILL): Rust — `E:\dev\Rust`, MSVC Build Tools — `E:\dev\VSBuildTools` (VC 14.44.35207), Windows SDK 10.0.26100.0. Переустанавливать ничего НЕ нужно.

- Активировать и проверить окружение: `. E:\Work\GIGA\github\Rat\scripts\devshell.ps1` (на этапе 1 такая же копия появится в проекте): `rustc -V`, `cargo -V`, пробная сборка в пустом каталоге проходит.
- Единственная установка этапа: `cargo install tauri-cli --locked` (выполнять в активированном окружении).
- Зафиксировать таблицу «компонент — версия» для README: rustc, cargo, node, npm, MSVC 14.44.35207, Windows SDK 10.0.26100.0, git, ОС.

## Этап 1 — Скаффолд + git

Проект размещать в коротком пути: `E:\Work\VSC\PostAi\soroka`.

```powershell
cd E:\Work\VSC\PostAi
npm create tauri-app@latest soroka -- --template vanilla-ts --identifier com.soroka.app --manager npm --yes
cd soroka
npm install
git init -b main
```

Добавить скрипты окружения (разделы 1.1 и 7 SKILL): `scripts\devshell.ps1`, `scripts\vsc-task.ps1`, `scripts\code.ps1`.

Создать remote: если установлен `gh` — `gh repo create soroka --private --source . --push`; иначе — попросить у пользователя URL пустого приватного репозитория и выполнить `git remote add origin <URL>`. (На текущей машине `gh` нет — URL согласуется заранее.)

```powershell
. .\scripts\devshell.ps1
cargo tauri dev
# убедиться, что окно открывается (первая сборка 3–10 минут — НЕ прерывать)
```

Закрыть, commit+push: `chore: scaffold tauri 2 + vite-ts project`

## Этап 2 — Структура, версия, сборщик

- Привести проект к канонической структуре раздела 3 SKILL: модули-заглушки `mail/{imap,smtp,parser,store}`, `ai/{mod,provider}` возвращают `Err(MailError::NotImplemented)`.
- `Cargo.toml` — по разделу 4 SKILL (release-профиль обязателен; почтовые крейты НЕ подключать — их добавит TASK-002).
- Добавить в корень `rust-toolchain.toml` (channel stable, components rustfmt/clippy — раздел 4 SKILL).
- `tauri.conf.json` — по разделу 5 SKILL: `version: "0.1.0"`, productName Soroka, identifier com.soroka.app, bundle targets `["nsis"]`, installMode currentUser, языки English+Russian.
- Создать `scripts/sync-version.ps1` (раздел 6 SKILL; UTF-8 с BOM) и `src-tauri/build.rs` с вшиванием git-hash через `SOROKA_GIT_HASH` (раздел 6 SKILL). Скрипты окружения (`devshell.ps1`, `vsc-task.ps1`, `code.ps1`) уже добавлены на этапе 1.
- Запустить `sync-version.ps1`, убедиться: `tauri.conf.json` = `Cargo.toml` = `package.json` = 0.1.0.

Commit+push: `feat: module skeleton + versioning + nsis bundle config`

## Этап 3 — VS Code: задачи и отладка

- Создать по шаблонам раздела 7 SKILL: `.vscode/extensions.json`, `settings.json` (включая терминальный профиль devshell и `rust-analyzer.cargo.extraEnv`), `tasks.json` (ui:dev, ui:build, sync:version, tauri:dev, tauri:build, rust:check — cargo-задачи через `scripts\vsc-task.ps1`), `launch.json` (Debug Soroka — lldb + Attach).
- Проверить: Ctrl+Shift+B запускает dev; задачи видны в Terminal > Run Task.

Commit+push: `chore: vscode tasks, launch, settings`

## Этап 4 — Health-check и версия в UI

- Команды `ping` и `app_info` (раздел 6 SKILL), регистрация в `lib.rs`.
- UI: 3-панельный каркас (грид 240px | 360px | 1fr), кнопка «Проверить бэкенд» → `invoke ping` → результат в статус-бар; статус-бар постоянно показывает версию из `app_info`: «Soroka v0.1.0+g1a2b3c».
- Заглушка списка писем: «Сорока ещё в полёте — писем нет».
- Проверка отладки: поставить breakpoint в `ping`, нажать F5 — отладчик обязан остановиться. Не останавливается → грабля №9 SKILL.

Commit+push: `feat: ping/app_info commands + status bar + 3-pane layout`

## Этап 5 — Релиз: exe + установщик + тег

```powershell
. .\scripts\devshell.ps1
cargo fmt --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
# Сборка — через задачу VS Code "tauri:build" (она сначала запускает sync-version.ps1);
# если вручную: сначала sync-version.ps1, затем cargo tauri build
cargo tauri build
Get-ChildItem .\src-tauri\target\release\bundle\nsis\, .\src-tauri\target\release\*.exe |
  Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}
```

- Записать размеры exe (`soroka.exe` — имя по пакету Cargo, см. раздел 5 SKILL) и установщика `Soroka_0.1.0_x64-setup.exe` в README.
- Запустить `.\src-tauri\target\release\soroka.exe` напрямую — окно открывается, версия в статус-баре совпадает, ping отвечает. Тихую установку (`setup.exe /S`) — только с явного разрешения пользователя.
- CHANGELOG.md: запись `[0.1.0]`. Тег и пуш:

```powershell
git tag -a v0.1.0 -m "Soroka 0.1.0 — bootstrap"
git push origin main v0.1.0
```

Commit+push: `chore(release): v0.1.0 — nsis installer + exe`

## Этап 6 — Документация и отчёт

- README: цель, стек и версии окружения, быстрый старт (dev), отладка (F5), сборка релиза (задача tauri:build + пути артефактов), структура проекта, версионирование (одна точка — где меняется версия), замеры, дорожная карта (IMAP > кэш > SMTP > просмотр > ИИ).
- `.gitignore`: node_modules, target, dist, .env; `.gitattributes`: `* text=auto eol=lf`, для `*.ps1` / `*.cmd` / `*.bat` — `eol=crlf`.
- Финальный commit+push: `docs: readme + roadmap`.
- Итоговый отчёт по пунктам DoD — в `tasks/TASK-001-report.md`.

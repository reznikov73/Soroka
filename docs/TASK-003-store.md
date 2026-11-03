# TASK-003 — Локальный кэш и офлайн-режим («Сорока»)

**Исполнитель:** AutoClaw (AutoCoder). Перед началом прочитать навык `soroka-bootstrap` (разделы 1.1, 3, 6).
**Рабочая область:** `E:\Work\VSC\PostAi` · **Проект:** `E:\Work\VSC\PostAi\soroka`.
**Платформа:** ТОЛЬКО Windows 10+. IDE: VS Code.
**Окружение:** подготовлено (SKILL §1.1); перед cargo-командами активировать `. .\scripts\devshell.ps1`.
**Правило:** строго по этапам; каждый этап — `git add` + `commit` + `push`. Все файлы — UTF-8; `.ps1` — с BOM.

## Цель

Сохранять загруженные письма и папки в локальную БД SQLite (`%APPDATA%\Soroka\soroka.db`), показывать их мгновенно при запуске и оставаться полезной при отсутствии сети («офлайн»).

## Нефункциональные требования

- `rusqlite` с фичей `bundled` — SQLite внутри exe, без внешних DLL.
- БД — вне репозитория; схема идемпотентно создаётся при первом обращении; запись — в транзакции.
- Сеть не блокируется (`spawn_blocking`). Поведение: сеть доступна → кэш обновляется; сеть упала → показываются сохранённые письма + пометка «офлайн».
- Существующее не ломаем (ping/app_info, синхронизация TASK-002, версионирование, задачи VS Code).

## Definition of Done

- [ ] БД `soroka.db` (таблицы `messages`, `folders`, `meta`) создаётся при первом запуске.
- [ ] После синхронизации числа в БД совпадают с живыми (INBOX всего 111; загружено 30).
- [ ] При запуске список показывается из кэша мгновенно (до сети), затем автосинхронизация обновляет.
- [ ] **Офлайн:** при недоступной сети показываются сохранённые письма; статус «почта: офлайн, писем N»; тост-предупреждение; приложение не падает.
- [ ] Повторная синхронизация заменяет INBOX-кэш без дублей.
- [ ] `cargo fmt --check`, `cargo clippy -- -D warnings`, `npm run build` — чисто; unit-тесты store (in-memory roundtrip).
- [ ] Версия → `0.3.0`; CHANGELOG `[0.3.0]`; README; отчёт `tasks\TASK-003-report.md`.
- [ ] Живой прогон: кэш (проверка БД) + офлайн (скриншоты); коммиты; финальный — `feat: локальный кэш SQLite + офлайн-режим (TASK-003)`.

## Этапы

1. **Модуль `mail/store.rs`** (`rusqlite` bundled): `Store`, схема (messages/folders/meta), `save_sync()` (транзакция, полная замена INBOX), `load()`; unit-тесты на in-memory.
2. **Команды:** `load_cache` (мгновенный старт из кэша), `sync_inbox` — сохранение в БД; при ошибке сети — фолбэк на кэш (payload `offline: true` + текст ошибки); событие `sync-finished` с `offline`.
3. **UI:** при старте — показ из кэша; офлайн-статус «почта: офлайн, писем N» и тост-предупреждение.
4. **Проверки и релиз:** fmt/clippy/test/tsc; живой прогон №1 (БД заполнена — проверить sqlite3) и №2 (офлайн через `SOROKA_IMAP_HOST=127.0.0.1`/`SOROKA_IMAP_PORT=9`); версия 0.3.0; CHANGELOG; README; отчёт; тег `v0.3.0`.

## Проверка (команды)

```powershell
cargo test --manifest-path src-tauri\Cargo.toml --lib
cargo clippy --manifest-path src-tauri\Cargo.toml -- -D warnings
npm run build
```

Плюс sqlite3-проверка БД (Python):

```python
import sqlite3, os
db = os.path.join(os.environ['APPDATA'], 'Soroka', 'soroka.db')
c = sqlite3.connect(db)
print('messages:', c.execute('select count(*) from messages').fetchone()[0])
print('folders:',  c.execute('select count(*) from folders').fetchone()[0])
print('meta:', dict(c.execute('select key, value from meta').fetchall()))
```

## Стоп-условия

- `rusqlite bundled` не собирается (нет C-компилятора в devshell) → точный текст ошибки, остановиться.
- БД не создаётся/не читается (права, путь) → точный текст ошибки, остановиться.

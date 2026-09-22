# Дашборд портфеля строительных проектов

Витрина портфеля ЖК-проектов: план/факт по срокам и бюджетам, KPI, Гантт, таблица работ с фильтрами. Проект разработан и развивается через Claude Code (вайб-кодинг).

## Структура

- `backend/` — Express API (`server.js`): импорт XLSX, KPI, графики, таблица, ручное добавление записей; в prod отдаёт `frontend/dist`.
- `frontend/` — SPA на React (Vite) + Ant Design + Recharts; тёмная тема, дашборд, загрузка файлов, форма добавления, таблица.
- `data/` — исходные XLSX-файлы по проектам (структура колонок задана в `EXPECTED_HEADERS`).
- `db/` — SQLite (`db/projects.sqlite`), gitignored: воспроизводится из `data/` командой `npm run seed`.
- `scripts/seed_db.py` — CLI-импорт XLSX → SQLite (openpyxl), проект берётся из имени файла.
- `scripts/build_offline.js` — автономный HTML-демонстратор с mock-API → `demo/dashboard_offline.html`.
- `screenshots/` — скриншоты для README.

## Схема БД

projects / files (raw_content BLOB, hash) / records (UNIQUE file_id+row_num) / imports_log + view `records_with_project`. Импорт идемпотентный: upsert по (project, filename, hash) и (file_id, row_num).

## Команды

```bash
npm run setup      # установка зависимостей backend+frontend (требуется Node >= 20)
npm run seed       # пересоздать БД из data/*.xlsx (требуется Python + openpyxl)
npm run dev:backend / dev:frontend / dev   # dev: API на 3001, Vite на 5173 (прокси на API)
npm run build      # сборка frontend/dist
npm start          # prod: Express на 3001 отдаёт /api/* и frontend/dist
npm run export:offline   # автономное демо demo/dashboard_offline.html
```

## Инварианты и правила работы

1. Формат XLSX строгий: 11 колонок в порядке `EXPECTED_HEADERS` (`backend/server.js`). Проект определяется именем файла.
2. Путь к БД один — `db/projects.sqlite` (задан в `backend/server.js` и `scripts/`). Не перемещать БД без правки всех трёх мест.
3. `db/` не коммитить — runtime-артефакт, есть в `.gitignore`. `demo/dashboard_offline.html` коммитится сознательно (демо без установки для руководителя и коллег); перед коммитом пересобрать: `npm run export:offline`.
4. Даты в БД хранятся в ISO (YYYY-MM-DD); Excel-serial конвертируется при импорте (`isoDate`).
5. Не менять структуру API (`/api/upload`, `/api/uploads`, `/api/projects`, `/api/kpi`, `/api/records`, `/api/charts/*`, `/health`) без синхронного обновления `frontend/src/api.js` и mock-API в `scripts/build_offline.js`.
6. Перед коммитом проверять: `npm run build` проходит, backend стартует с чистой БД после `npm run seed`.

## Типовые задачи

- Новый график/показатель: SQL-агрегация в `server.js` → роут → отрисовка в `frontend/src/App.jsx` (Recharts) → при необходимости добавить в mock-API.
- Новый фильтр таблицы: параметр в `getRecords()` → UI-фильтр в `RecordsTable` → mock-API `filterRecords`.
- Изменение структуры XLSX: обновить `EXPECTED_HEADERS` в `backend/server.js` И в `scripts/seed_db.py` (дублируются осознанно — Node и Python импортёры независимы).

## Известные особенности

- better-sqlite3 — нативный модуль: после смены мажорной версии Node выполнять `npm install` в `backend/` заново (пребилды под Node 24 есть начиная с v13).
- В prod-сборке бандл > 1 МБ (antd + recharts); при необходимости код-сплиттинг через `manualChunks`.
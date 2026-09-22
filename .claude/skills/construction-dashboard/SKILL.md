---
name: construction-dashboard
description: Работа с репозиторием construction-projects-dashboard — запуск, разработка, проверка и публикация дашборда портфеля строительных проектов (React + Express + SQLite). Использовать, когда нужно запустить сервис, добавить функционал, обновить README, проверить ошибки или подготовить проект к публикации.
---

# Дашборд портфеля строительных проектов

Скилл-инструкция для Claude Code: как работать с этим репозиторием, чтобы развернуть проект у себя и безопасно вносить изменения.

## Быстрый старт

1. Требования: Node.js >= 20, Python 3 с пакетом `openpyxl`.
2. `npm run setup` — установка зависимостей backend и frontend.
3. `npm run seed` — создание БД `db/projects.sqlite` из XLSX-файлов в `data/` (БД в git не хранится).
4. `npm run build` — сборка фронтенда в `frontend/dist`.
5. `npm start` — прод-запуск: Express на http://localhost:3001 отдаёт API и собранный фронтенд.
6. Для разработки: `npm run dev` — API на 3001 + Vite на 5173 с прокси.

## Структура репозитория

- `backend/server.js` — весь API: импорт XLSX (`/api/upload`), KPI (`/api/kpi`), таблица (`/api/records`), графики (`/api/charts/*`), ручное добавление (POST `/api/records`). В prod отдаёт `frontend/dist`.
- `frontend/src/App.jsx` — вся UI-логика: KPI-карточки, графики Recharts, Гантт-lite, таблица с фильтрами, загрузка, форма.
- `frontend/src/api.js` — клиент API; держать в синхроне с эндпоинтами сервера.
- `data/*.xlsx` — исходные данные; 11 колонок строго в порядке `EXPECTED_HEADERS` из `backend/server.js`; имя файла = имя проекта.
- `scripts/seed_db.py` — Python-импортёр XLSX → SQLite (дублирует Node-логику импорта независимо).
- `scripts/build_offline.js` — автономный HTML-демонстратор с mock-API → `demo/dashboard_offline.html`.
- `db/`, `frontend/dist/`, `demo/dashboard_offline.html` — gitignored runtime-артефакты.

## Внесение изменений

- Новый график или показатель: SQL-агрегация в `server.js` → новый роут → отрисовка в `App.jsx` → дубль в mock-API `build_offline.js`.
- Новый фильтр таблицы: параметр в `getRecords()` → UI в `RecordsTable` → `filterRecords` в mock-API.
- Изменение формата XLSX: обновить `EXPECTED_HEADERS` в обоих импортёрах (`server.js` и `seed_db.py`) и образец в `data/`.
- Схема БД задана в `SCHEMA` (`server.js`) и в `seed_db.py` — менять синхронно. Импорт идемпотентный (upsert по file_id+row_num), не ломать это свойство.
- Даты в БД — ISO YYYY-MM-DD; Excel-serial конвертируется в `isoDate()`.

## Проверка ошибок

1. Backend не стартует с ошибкой `Could not locate the bindings file` (better-sqlite3) — сменилась мажорная версия Node: `npm install` в `backend/` заново.
2. Ошибка импорта «Неверная структура файла» — колонки XLSX не совпадают с `EXPECTED_HEADERS`; сверить с образцом в `data/`.
3. Пустые графики после импорта — проверить `/health`, `/api/kpi` и содержимое `records` через `sqlite3 db/projects.sqlite`.
4. Курсор фильтров не работает в оффлайн-демо — mock-API в `build_offline.js` отстал от сервера; синхронизировать.

## Готовность к публикации

1. `npm run build` проходит без ошибок.
2. Сценарий проверки: `npm run seed` с чистой `db/` → `npm start` → `/health`, `/api/kpi`, загрузка XLSX через UI, ручное добавление записи.
3. Скриншоты дашборда, графика бюджетов, Гантта и таблицы — в `screenshots/`, вставлены в README.
4. README содержит: описание по структуре (проблема/пользователь/функция/результат/MVP/технологии), инструкцию запуска, скриншоты.
5. Всё закоммичено и опубликовано на GitHub (`gh repo create ... --push`); проверка страницы в режиме инкогнито.
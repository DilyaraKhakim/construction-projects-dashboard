import argparse
import hashlib
import sqlite3
import time
from datetime import datetime
from pathlib import Path

import openpyxl

EXPECTED_HEADERS = [
    "Этап",
    "Работа",
    "Ответственный",
    "Статус",
    "Плановое начало",
    "Плановый конец",
    "Фактическое начало",
    "Фактический конец",
    "Завершение",
    "Бюджет план",
    "Бюджет факт",
]

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    hash TEXT,
    raw_content BLOB,
    UNIQUE(project_id, filename, hash)
);

CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    row_num INTEGER NOT NULL,
    stage TEXT,
    task TEXT,
    owner TEXT,
    status TEXT,
    planned_start TEXT,
    planned_end TEXT,
    actual_start TEXT,
    actual_end TEXT,
    completion REAL,
    budget_plan INTEGER,
    budget_fact INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(file_id, row_num)
);

CREATE INDEX IF NOT EXISTS idx_records_project ON records(project_id);
CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
CREATE INDEX IF NOT EXISTS idx_records_stage ON records(stage);

CREATE TABLE IF NOT EXISTS imports_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    message TEXT,
    duration_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE VIEW IF NOT EXISTS records_with_project AS
SELECT
    r.id,
    p.name AS project,
    f.filename,
    r.row_num,
    r.stage,
    r.task,
    r.owner,
    r.status,
    r.planned_start,
    r.planned_end,
    r.actual_start,
    r.actual_end,
    r.completion,
    r.budget_plan,
    r.budget_fact,
    r.created_at
FROM records r
JOIN projects p ON p.id = r.project_id
JOIN files f ON f.id = r.file_id;
"""


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def iso_date(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    return str(value)


def to_float(value) -> float | None:
    return float(value) if value is not None else None


def to_int(value) -> int | None:
    return int(value) if value is not None else None


def upsert_project(conn: sqlite3.Connection, name: str) -> int:
    conn.execute(
        "INSERT INTO projects (name) VALUES (?) ON CONFLICT(name) DO NOTHING",
        (name,),
    )
    row = conn.execute("SELECT id FROM projects WHERE name = ?", (name,)).fetchone()
    return row[0]


def upsert_file(
    conn: sqlite3.Connection,
    project_id: int,
    path: Path,
    data: bytes,
    digest: str,
    store_raw: bool,
) -> int:
    conn.execute(
        """
        INSERT INTO files (project_id, filename, hash, raw_content)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id, filename, hash) DO UPDATE
        SET imported_at = CURRENT_TIMESTAMP
        """,
        (project_id, path.name, digest, data if store_raw else None),
    )
    row = conn.execute(
        "SELECT id FROM files WHERE project_id = ? AND filename = ? AND hash = ?",
        (project_id, path.name, digest),
    ).fetchone()
    return row[0]


def insert_records(
    conn: sqlite3.Connection,
    project_id: int,
    file_id: int,
    rows: list[tuple],
) -> int:
    insert_sql = """
    INSERT INTO records (
        project_id, file_id, row_num, stage, task, owner, status,
        planned_start, planned_end, actual_start, actual_end,
        completion, budget_plan, budget_fact
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_id, row_num) DO UPDATE SET
        stage = excluded.stage,
        task = excluded.task,
        owner = excluded.owner,
        status = excluded.status,
        planned_start = excluded.planned_start,
        planned_end = excluded.planned_end,
        actual_start = excluded.actual_start,
        actual_end = excluded.actual_end,
        completion = excluded.completion,
        budget_plan = excluded.budget_plan,
        budget_fact = excluded.budget_fact
    """
    for idx, row in enumerate(rows, start=1):
        values = (
            project_id,
            file_id,
            idx,
            row[0],
            row[1],
            row[2],
            row[3],
            iso_date(row[4]),
            iso_date(row[5]),
            iso_date(row[6]),
            iso_date(row[7]),
            to_float(row[8]),
            to_int(row[9]),
            to_int(row[10]),
        )
        conn.execute(insert_sql, values)
    return len(rows)


def import_file(conn: sqlite3.Connection, path: Path, store_raw: bool) -> tuple[int, int]:
    start = time.perf_counter()
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()

    wb = openpyxl.load_workbook(path)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise ValueError("Empty workbook")

    header = list(rows[0])
    if [h for h in header] != EXPECTED_HEADERS:
        raise ValueError(f"Unexpected header in {path.name}: {header}")

    data_rows = rows[1:]
    project_id = upsert_project(conn, path.stem)
    file_id = upsert_file(conn, project_id, path, data, digest, store_raw)
    row_count = insert_records(conn, project_id, file_id, data_rows)

    duration = int((time.perf_counter() - start) * 1000)
    conn.execute(
        "INSERT INTO imports_log (file_id, status, message, duration_ms) VALUES (?, ?, ?, ?)",
        (file_id, "ok", None, duration),
    )
    return row_count, duration


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Импорт задач из .xlsx в SQLite. Проект берется из имени файла."
    )
    parser.add_argument(
        "--db",
        default="db/projects.sqlite",
        help="Путь к файлу SQLite (создастся, если его нет).",
    )
    parser.add_argument(
        "--source",
        default="data",
        help="Каталог с .xlsx файлами (по умолчанию data).",
    )
    parser.add_argument(
        "--skip-raw",
        action="store_true",
        help="Не сохранять исходный файл в таблицу files.raw_content.",
    )
    args = parser.parse_args()

    source_dir = Path(args.source)
    files = sorted(source_dir.glob("*.xlsx"))
    if not files:
        print(f"Нет .xlsx файлов в каталоге {source_dir}")
        return

    conn = sqlite3.connect(args.db)
    try:
        ensure_schema(conn)
        total_rows = 0
        for path in files:
            try:
                with conn:
                    rows, duration = import_file(conn, path, store_raw=not args.skip_raw)
                total_rows += rows
                print(f"Импорт {path.name}: {rows} строк за {duration} мс")
            except Exception as exc:
                print(f"Не удалось импортировать {path.name}: {exc}")
        print(f"Готово. Импортировано {total_rows} строк в {args.db}.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()

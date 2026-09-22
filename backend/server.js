const express = require("express");
const cors = require("cors");
const multer = require("multer");
const xlsx = require("xlsx");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const PORT = process.env.PORT || 3001;
const DB_PATH = path.resolve(__dirname, "..", "db", "projects.sqlite");
const FRONTEND_DIST = path.resolve(__dirname, "..", "frontend", "dist");

const EXPECTED_HEADERS = [
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
];

const SCHEMA = `
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
`;

function openDb() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

const db = openDb();

const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(cors());
app.use(express.json());

if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
}

function isoDate(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    // Excel date serial
    const date = xlsx.SSF.parse_date_code(value);
    if (!date) return null;
    const jsDate = new Date(Date.UTC(date.y, date.m - 1, date.d));
    return jsDate.toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function toFloat(v) {
  return v === null || v === undefined || v === "" ? null : Number(v);
}

function toInt(v) {
  return v === null || v === undefined || v === "" ? null : parseInt(v, 10);
}

function upsertProject(name) {
  db.prepare("INSERT INTO projects (name) VALUES (?) ON CONFLICT(name) DO NOTHING").run(name);
  const row = db.prepare("SELECT id FROM projects WHERE name = ?").get(name);
  return row.id;
}

function ensureFile(projectId, filename, hash, rawBuffer) {
  db.prepare(
    `INSERT INTO files (project_id, filename, hash, raw_content)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, filename, hash) DO UPDATE SET imported_at = CURRENT_TIMESTAMP`
  ).run(projectId, filename, hash, rawBuffer);
  const row = db
    .prepare("SELECT id FROM files WHERE project_id = ? AND filename = ? AND hash = ?")
    .get(projectId, filename, hash);
  return row.id;
}

function ensureManualFile(projectId) {
  const hash = "manual";
  const filename = "manual";
  return ensureFile(projectId, filename, hash, null);
}

function insertRecords(projectId, fileId, dataRows) {
  const stmt = db.prepare(
    `INSERT INTO records (
        project_id, file_id, row_num, stage, task, owner, status,
        planned_start, planned_end, actual_start, actual_end,
        completion, budget_plan, budget_fact
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_id, row_num) DO UPDATE SET
        stage=excluded.stage,
        task=excluded.task,
        owner=excluded.owner,
        status=excluded.status,
        planned_start=excluded.planned_start,
        planned_end=excluded.planned_end,
        actual_start=excluded.actual_start,
        actual_end=excluded.actual_end,
        completion=excluded.completion,
        budget_plan=excluded.budget_plan,
        budget_fact=excluded.budget_fact`
  );
  let count = 0;
  const tx = db.transaction((rows) => {
    rows.forEach((row, idx) => {
      stmt.run(
        projectId,
        fileId,
        idx + 1,
        row[0],
        row[1],
        row[2],
        row[3],
        isoDate(row[4]),
        isoDate(row[5]),
        isoDate(row[6]),
        isoDate(row[7]),
        toFloat(row[8]),
        toInt(row[9]),
        toInt(row[10])
      );
      count += 1;
    });
  });
  tx(dataRows);
  return count;
}

function importWorkbook(buffer, filename) {
  const start = Date.now();
  const wb = xlsx.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true });
  if (!rows || !rows.length) throw new Error("Пустой файл");

  const header = rows[0];
  const missing = EXPECTED_HEADERS.filter((h) => !header.includes(h));
  const extra = header.filter((h) => !EXPECTED_HEADERS.includes(h));
  const misordered = header.find((h, i) => h !== EXPECTED_HEADERS[i]);
  if (missing.length || extra.length || misordered) {
    const parts = [];
    if (missing.length) parts.push(`нет колонок: ${missing.join(", ")}`);
    if (extra.length) parts.push(`лишние колонки: ${extra.join(", ")}`);
    if (misordered) parts.push("колонки перепутаны, порядок должен быть как в образце");
    throw new Error(
      `Неверная структура файла: ${parts.join("; ")}. Ожидаемый порядок: ${EXPECTED_HEADERS.join(
        " | "
      )}. Переименуйте/упорядочьте столбцы.`
    );
  }

  const dataRows = rows.slice(1);
  const projectName = path.parse(filename).name;

  const projectId = upsertProject(projectName);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const fileId = ensureFile(projectId, filename, hash, buffer);
  const imported = insertRecords(projectId, fileId, dataRows);
  const duration = Date.now() - start;
  db.prepare(
    "INSERT INTO imports_log (file_id, status, message, duration_ms) VALUES (?, ?, ?, ?)"
  ).run(fileId, "ok", null, duration);
  return { project: projectName, rows: imported, duration };
}

function computeKpi() {
  const projects = db.prepare("SELECT COUNT(*) AS cnt FROM projects").get().cnt;
  const tasks = db.prepare("SELECT COUNT(*) AS cnt FROM records").get().cnt;
  const completionRows = db.prepare("SELECT completion FROM records WHERE completion IS NOT NULL").all();
  const completions = completionRows.map((r) => Number(r.completion)).filter((v) => !Number.isNaN(v));
  const avg = completions.length
    ? completions.reduce((a, b) => a + b, 0) / completions.length
    : 0;
  const sorted = [...completions].sort((a, b) => a - b);
  const mid = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const budgetPlan = db.prepare("SELECT SUM(budget_plan) AS s FROM records").get().s || 0;
  const budgetFact = db.prepare("SELECT SUM(budget_fact) AS s FROM records").get().s || 0;
  return {
    projects,
    tasks,
    completion_avg: Number((avg * 100).toFixed(1)),
    completion_median: Number(((mid || 0) * 100).toFixed(1)),
    budget_plan: budgetPlan,
    budget_fact: budgetFact,
  };
}

function getRecords(filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.project) {
    clauses.push("p.name = ?");
    params.push(filters.project);
  }
  if (filters.status) {
    clauses.push("r.status = ?");
    params.push(filters.status);
  }
  if (filters.stage) {
    clauses.push("r.stage = ?");
    params.push(filters.stage);
  }
  if (filters.date_from) {
    clauses.push("r.planned_start >= ?");
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    clauses.push("r.planned_end <= ?");
    params.push(filters.date_to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Number(filters.limit) || 200;
  const offset = Number(filters.offset) || 0;
  const rows = db
    .prepare(
      `SELECT r.*, p.name as project, f.filename
       FROM records r
       JOIN projects p ON p.id = r.project_id
       JOIN files f ON f.id = r.file_id
       ${where}
       ORDER BY r.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
  return rows;
}

function completionByProject() {
  const rows = db
    .prepare(
      `SELECT p.name as project, AVG(r.completion) as completion
       FROM records r
       JOIN projects p ON p.id = r.project_id
       WHERE r.completion IS NOT NULL
       GROUP BY p.id
       ORDER BY p.name`
    )
    .all();
  return rows.map((r) => ({
    project: r.project,
    completion: Number(((r.completion || 0) * 100).toFixed(1)),
  }));
}

function budgetsByProject() {
  const rows = db
    .prepare(
      `SELECT p.name as project,
              SUM(r.budget_plan) as budget_plan,
              SUM(r.budget_fact) as budget_fact
       FROM records r
       JOIN projects p ON p.id = r.project_id
       GROUP BY p.id
       ORDER BY p.name`
    )
    .all();
  return rows.map((r) => ({
    project: r.project,
    budget_plan: Number(r.budget_plan || 0),
    budget_fact: Number(r.budget_fact || 0),
  }));
}

function planFactTimeline() {
  const rows = db.prepare("SELECT planned_end, actual_end, budget_plan, budget_fact FROM records").all();
  const buckets = new Map();

  function add(dateStr, key, value) {
    if (!dateStr || !value) return;
    const month = dateStr.slice(0, 7); // YYYY-MM
    if (!buckets.has(month)) buckets.set(month, { month, plan: 0, fact: 0 });
    buckets.get(month)[key] += value;
  }

  rows.forEach((r) => {
    add(r.planned_end, "plan", toInt(r.budget_plan));
    add(r.actual_end, "fact", toInt(r.budget_fact));
  });

  return Array.from(buckets.values()).sort((a, b) => (a.month > b.month ? 1 : -1));
}

app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Файл не найден" });
    }
    const { originalname, buffer } = req.file;
    const result = importWorkbook(buffer, originalname);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: err.message });
  }
});

app.get("/api/projects", (req, res) => {
  const rows = db.prepare("SELECT id, name FROM projects ORDER BY name").all();
  res.json(rows);
});

app.get("/api/kpi", (req, res) => {
  res.json(computeKpi());
});

app.get("/api/records", (req, res) => {
  const rows = getRecords(req.query);
  res.json(rows);
});

app.get("/api/uploads", (req, res) => {
  const rows = db
    .prepare(
      `SELECT f.filename AS name,
              f.imported_at AS time,
              p.name AS project,
              (SELECT COUNT(*) FROM records r WHERE r.file_id = f.id) AS rows
         FROM files f
         JOIN projects p ON p.id = f.project_id
        ORDER BY f.imported_at DESC, f.id DESC
        LIMIT 30`
    )
    .all();
  res.json(rows);
});

app.post("/api/records", (req, res) => {
  try {
    const {
      projectName,
      projectId,
      stage,
      task,
      owner,
      status,
      planned_start,
      planned_end,
      actual_start,
      actual_end,
      completion,
      budget_plan,
      budget_fact,
    } = req.body;
    const resolvedProjectId = projectId || upsertProject(projectName);
    const fileId = ensureManualFile(resolvedProjectId);
    const rowNum = 1 + (db.prepare("SELECT COUNT(*) as c FROM records WHERE file_id = ?").get(fileId).c || 0);
    db.prepare(
      `INSERT INTO records (
        project_id, file_id, row_num, stage, task, owner, status,
        planned_start, planned_end, actual_start, actual_end,
        completion, budget_plan, budget_fact
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      resolvedProjectId,
      fileId,
      rowNum,
      stage,
      task,
      owner,
      status,
      isoDate(planned_start),
      isoDate(planned_end),
      isoDate(actual_start),
      isoDate(actual_end),
      toFloat(completion),
      toInt(budget_plan),
      toInt(budget_fact)
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: err.message });
  }
});

app.get("/api/charts/completion-by-project", (req, res) => {
  res.json(completionByProject());
});

app.get("/api/charts/budgets", (req, res) => {
  res.json(budgetsByProject());
});

app.get("/api/charts/plan-fact", (req, res) => {
  res.json(planFactTimeline());
});

app.get("/health", (req, res) => res.json({ ok: true }));

// Frontend fallback
if (fs.existsSync(FRONTEND_DIST)) {
  app.get("*", (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

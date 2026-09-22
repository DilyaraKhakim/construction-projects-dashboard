// Генерация автономного HTML дашборда с встроенными данными и mock-API.
// Требования: собранный фронт (frontend/dist), наличие db/projects.sqlite.
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST_ASSETS = path.join(ROOT, "frontend", "dist", "assets");
const DB_PATH = path.join(ROOT, "db", "projects.sqlite");
const OUTPUT = path.join(ROOT, "demo", "dashboard_offline.html");

function readAsset(prefix, ext) {
  const candidates = fs
    .readdirSync(DIST_ASSETS)
    .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
    .map((f) => {
      const stat = fs.statSync(path.join(DIST_ASSETS, f));
      return { f, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (!candidates.length) throw new Error(`Не найден файл ${prefix}*.${ext} в dist/assets`);
  const file = candidates[0].f;
  return fs.readFileSync(path.join(DIST_ASSETS, file), "utf-8");
}

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} при загрузке ${url}`));
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function loadData() {
  const py = `import sqlite3, json; ` +
    `conn = sqlite3.connect(r'''${DB_PATH}'''); ` +
    `conn.row_factory = sqlite3.Row; ` +
    `sql = '''SELECT r.id, p.name as project, r.stage, r.task, r.owner, r.status, r.planned_start, r.planned_end, r.actual_start, r.actual_end, r.completion, r.budget_plan, r.budget_fact FROM records r JOIN projects p ON p.id = r.project_id ORDER BY r.id'''; ` +
    `rows = conn.execute(sql).fetchall(); ` +
    `print(json.dumps([dict(row) for row in rows], ensure_ascii=False))`;
  const out = execSync(`python -X utf8 -c "${py}"`, {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  return JSON.parse(out);
}

async function build() {
  const css = readAsset("index-", ".css");
  const js = readAsset("index-", ".js");
  const xlsx = await download("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
  const records = loadData();
  const maxId = records.reduce((m, r) => Math.max(m, r.id || 0), 0);

  // История загрузок для mock-API: по одному файлу на проект (как при сидировании).
  const rowsByProject = records.reduce((acc, r) => {
    acc[r.project] = (acc[r.project] || 0) + 1;
    return acc;
  }, {});
  const uploads = Object.keys(rowsByProject).map((project) => ({
    name: `${project}.xlsx`,
    time: new Date().toISOString().slice(0, 19).replace("T", " "),
    rows: rowsByProject[project],
    project,
  }));

  const mock = `
  (() => {
    const initialRecords = ${JSON.stringify(records)};
    let records = [...initialRecords];
    let nextId = ${maxId + 1};
    let uploads = ${JSON.stringify(uploads)};
    const headers = { "Content-Type": "application/json" };

    function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

    function completionToPercent(v) {
      if (v == null || Number.isNaN(Number(v))) return null;
      return Number((Number(v) * 100).toFixed(1));
    }

    function computeKpi() {
      const projects = new Set(records.map(r => r.project));
      const tasks = records.length;
      const comps = records.map(r => Number(r.completion)).filter(v => !Number.isNaN(v));
      const avg = comps.length ? comps.reduce((a,b)=>a+b,0) / comps.length : 0;
      const sorted = [...comps].sort((a,b)=>a-b);
      const med = sorted.length ? sorted[Math.floor(sorted.length/2)] : 0;
      const budget_plan = records.reduce((s,r)=>s + (Number(r.budget_plan)||0), 0);
      const budget_fact = records.reduce((s,r)=>s + (Number(r.budget_fact)||0), 0);
      return {
        projects: projects.size,
        tasks,
        completion_avg: completionToPercent(avg) || 0,
        completion_median: completionToPercent(med) || 0,
        budget_plan,
        budget_fact
      };
    }

    function listProjects() {
      const names = Array.from(new Set(records.map(r => r.project))).sort();
      return names.map((name, idx) => ({ id: idx + 1, name }));
    }

    function filterRecords(params) {
      return records.filter(r => {
        if (params.project && r.project !== params.project) return false;
        if (params.status && r.status !== params.status) return false;
        if (params.stage && r.stage !== params.stage) return false;
        return true;
      });
    }

    function completionByProject() {
      const map = new Map();
      records.forEach(r => {
        if (r.completion == null) return;
        const list = map.get(r.project) || [];
        list.push(Number(r.completion));
        map.set(r.project, list);
      });
      return Array.from(map.entries()).map(([project, vals]) => {
        const avg = vals.reduce((a,b)=>a+b,0) / vals.length;
        return { project, completion: completionToPercent(avg) || 0 };
      }).sort((a,b)=>a.project.localeCompare(b.project));
    }

    function budgets() {
      const map = new Map();
      records.forEach(r => {
        const entry = map.get(r.project) || { project: r.project, budget_plan: 0, budget_fact: 0 };
        entry.budget_plan += Number(r.budget_plan) || 0;
        entry.budget_fact += Number(r.budget_fact) || 0;
        map.set(r.project, entry);
      });
      return Array.from(map.values()).sort((a,b)=>a.project.localeCompare(b.project));
    }

    function monthKey(dateStr) {
      return dateStr ? String(dateStr).slice(0,7) : null;
    }

    function planFact() {
      const buckets = new Map();
      records.forEach(r => {
        const mPlan = monthKey(r.planned_end);
        const mFact = monthKey(r.actual_end);
        if (mPlan) {
          const b = buckets.get(mPlan) || { month: mPlan, plan: 0, fact: 0 };
          b.plan += Number(r.budget_plan) || 0;
          buckets.set(mPlan, b);
        }
        if (mFact) {
          const b = buckets.get(mFact) || { month: mFact, plan: 0, fact: 0 };
          b.fact += Number(r.budget_fact) || 0;
          buckets.set(mFact, b);
        }
      });
      return Array.from(buckets.values()).sort((a,b)=>a.month.localeCompare(b.month));
    }

    function isoFromExcel(value) {
      if (value == null || value === "") return null;
      if (typeof value === "string") {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d.toISOString().slice(0,10);
      }
      if (value instanceof Date) return value.toISOString().slice(0,10);
      if (typeof value === "number" && window.XLSX && window.XLSX.SSF) {
        const p = window.XLSX.SSF.parse_date_code(value);
        if (!p) return null;
        const d = new Date(Date.UTC(p.y, p.m - 1, p.d));
        return d.toISOString().slice(0,10);
      }
      return null;
    }

    async function parseUpload(formData, filename) {
      const file = formData.get("file");
      if (!file) throw new Error("Файл не найден");
      const buffer = await file.arrayBuffer();
      const wb = window.XLSX.read(buffer, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
      if (!rows || !rows.length) throw new Error("Пустой файл");
      const header = rows[0];
      const expected = ${JSON.stringify([
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
      ])};
      const headerDiff = header.length !== expected.length || header.some((h,i)=>h !== expected[i]);
      if (headerDiff) throw new Error("Неверный заголовок файла");

      const project = filename.replace(/\\.[^.]+$/, "");
      const dataRows = rows.slice(1);
      dataRows.forEach((row) => {
        const rec = {
          id: nextId++,
          project,
          stage: row[0],
          task: row[1],
          owner: row[2],
          status: row[3],
          planned_start: isoFromExcel(row[4]),
          planned_end: isoFromExcel(row[5]),
          actual_start: isoFromExcel(row[6]),
          actual_end: isoFromExcel(row[7]),
          completion: row[8] == null ? null : Number(row[8]),
          budget_plan: row[9] == null ? null : Number(row[9]),
          budget_fact: row[10] == null ? null : Number(row[10]),
        };
        records.push(rec);
      });
      return { ok: true, project, rows: dataRows.length, duration: 0 };
    }

    async function addManual(bodyText) {
      const payload = JSON.parse(bodyText || "{}");
      const project = payload.projectName;
      if (!project) throw new Error("Укажите проект");
      const rec = {
        id: nextId++,
        project,
        stage: payload.stage || "",
        task: payload.task || "",
        owner: payload.owner || "",
        status: payload.status || "",
        planned_start: payload.planned_start || null,
        planned_end: payload.planned_end || null,
        actual_start: payload.actual_start || null,
        actual_end: payload.actual_end || null,
        completion: payload.completion == null ? null : Number(payload.completion),
        budget_plan: payload.budget_plan == null ? null : Number(payload.budget_plan),
        budget_fact: payload.budget_fact == null ? null : Number(payload.budget_fact),
      };
      records.push(rec);
      return { ok: true };
    }

    const originalFetch = window.fetch;
    function normPath(u) {
      let p = u.pathname || "";
      if (!p.startsWith("/")) p = "/" + p;
      // file:///C:/.../api/kpi -> keep trailing /api/...
      const idx = p.indexOf("/api/");
      return idx >= 0 ? p.slice(idx) : p;
    }
    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? new URL(input, location.href) : new URL(input.url, location.href);
      const method = (init.method || (input.method ? input.method : "GET")).toUpperCase();
      const path = normPath(url);
      try {
        if (path === "/api/kpi" && method === "GET") {
          return new Response(JSON.stringify(computeKpi()), { status: 200, headers });
        }
        if (path === "/api/projects" && method === "GET") {
          return new Response(JSON.stringify(listProjects()), { status: 200, headers });
        }
        if (path === "/api/uploads" && method === "GET") {
          return new Response(JSON.stringify(uploads), { status: 200, headers });
        }
        if (path === "/api/records" && method === "GET") {
          const filters = Object.fromEntries(url.searchParams.entries());
          return new Response(JSON.stringify(filterRecords(filters)), { status: 200, headers });
        }
        if (path === "/api/charts/completion-by-project" && method === "GET") {
          return new Response(JSON.stringify(completionByProject()), { status: 200, headers });
        }
        if (path === "/api/charts/budgets" && method === "GET") {
          return new Response(JSON.stringify(budgets()), { status: 200, headers });
        }
        if (path === "/api/charts/plan-fact" && method === "GET") {
          return new Response(JSON.stringify(planFact()), { status: 200, headers });
        }
        if (path === "/api/upload" && method === "POST") {
          const formData = init.body instanceof FormData ? init.body : await input.formData?.();
          const fileName = formData.get("file")?.name || "uploaded.xlsx";
          const result = await parseUpload(formData, fileName);
          uploads = [
            { name: fileName, time: new Date().toISOString().slice(0, 19).replace("T", " "), rows: result.rows ?? 0 },
            ...uploads,
          ];
          return new Response(JSON.stringify(result), { status: 200, headers });
        }
        if (path === "/api/records" && method === "POST") {
          const bodyText = init.body ? (typeof init.body === "string" ? init.body : await init.body.text?.()) : await input.text?.();
          const result = await addManual(bodyText);
          return new Response(JSON.stringify(result), { status: 200, headers });
        }
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || "Ошибка" }), { status: 400, headers });
      }
      if (path.startsWith("/api/")) {
        return new Response(JSON.stringify({ error: "offline mock: unknown path" }), { status: 404, headers });
      }
      return originalFetch(input, init);
    };
  })();
  `;

  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Дашборд (автономный)</title>
  <style>${css}</style>
</head>
<body>
  <div id="root">Загрузка...</div>
  <script>${xlsx}</script>
  <script>${mock}</script>
  <script>${js}</script>
</body>
</html>`;

  fs.writeFileSync(OUTPUT, html, "utf-8");
  console.log(`Готово: ${OUTPUT}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});

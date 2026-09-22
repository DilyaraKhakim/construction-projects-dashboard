import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  ConfigProvider,
  theme,
  Upload,
  message,
  Button,
  Form,
  Input,
  Select,
  DatePicker,
  InputNumber,
  Table,
  Tag,
  Spin,
  Tooltip as AntTooltip,
} from "antd";
import { CloudUploadOutlined, PlusOutlined, ReloadOutlined, InboxOutlined, FilterOutlined } from "@ant-design/icons";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import dayjs from "dayjs";
import { api } from "./api";

const STATUS_COLORS = {
  "Не начато": "magenta",
  "В работе": "gold",
  Завершено: "cyan",
};

const dateToIso = (value) => (value ? dayjs(value).format("YYYY-MM-DD") : null);

const fmtMln = (num) =>
  num != null ? `${(num / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн` : "—";

function KpiCards({ kpi, totalTasks, doneTasks }) {
  const progressPct = Math.round(kpi.completion_avg || 0);
  const done = doneTasks;
  const total = totalTasks;
  const fact = kpi.budget_fact || 0;
  const plan = kpi.budget_plan || 0;
  const factPct = plan > 0 ? Math.round((fact / plan) * 100) : 0;

  const items = [
    {
      title: "ПРОГРЕСС ПОРТФЕЛЯ",
      value: `${progressPct}%`,
      sub: "ср. % завершения по всем работам",
      bar: progressPct,
      accent: "#3ac8ff",
    },
    {
      title: "ВЫПОЛНЕНО РАБОТ",
      value: total > 0 ? done : "—",
      sub: `из ${total} работ`,
      bar: total > 0 ? (done / total) * 100 : 0,
      accent: "#3ac8ff",
    },
    {
      title: "БЮДЖЕТ ФАКТ",
      value: `${Math.round(fact / 1_000_000)} млн ₽`,
      sub: plan > 0 ? `${factPct}% от плана` : "",
      accent: "#5ce1e6",
    },
    {
      title: "БЮДЖЕТ ПЛАН",
      value: `${Math.round(plan / 1_000_000)} млн ₽`,
      sub: "плановый бюджет",
      accent: "#8f7cff",
    },
  ];
  return (
    <div className="kpi-grid wide">
      {items.map((k) => (
        <div key={k.title} className="kpi-card alt">
          <div className="kpi-header">
            <span className="kpi-title">{k.title}</span>
          </div>
          <div className="kpi-value" style={{ color: k.accent }}>
            <span>{k.value ?? "—"}</span>
          </div>
          <div className="kpi-subtitle">{k.sub}</div>
          {k.bar != null && (
            <div className="kpi-progress">
              <div className="kpi-progress-fill" style={{ width: `${Math.min(100, k.bar)}%`, background: k.accent }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Gantt({ records }) {
  const { rows, minDate, maxDate } = records || {};
  if (!rows || !rows.length || !minDate || !maxDate) return <div style={{ color: "#9fb0d8" }}>Нет данных для Гантта</div>;

  const totalDays = (maxDate - minDate) / 86400000 || 1;
  const getPos = (date) => (date ? ((date - minDate) / 86400000 / totalDays) * 100 : null);
  const months = [];
  const cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (cur <= maxDate) {
    months.push(new Date(cur));
    cur.setMonth(cur.getMonth() + 1);
  }

  return (
    <div className="gantt-container">
      <div className="gantt-timeline">
        {months.map((m, i) => (
          <span key={i} className="gantt-date">
            {m.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" })}
          </span>
        ))}
      </div>
      <div className="gantt-rows limited">
        {rows.map((r) => {
          const planLeft = getPos(r.planStart) ?? 0;
          const planRight = getPos(r.planEnd) ?? planLeft;
          const factLeft = getPos(r.factStart) ?? planLeft;
          const factRight = getPos(r.factEnd) ?? factLeft;
          const planWidth = Math.max(2, planRight - planLeft);
          const factWidth = Math.max(2, factRight - factLeft);
          const tip = (
            <div>
              <div><strong>{r.stage}</strong></div>
              <div>План: {r.planStart ? r.planStart.toLocaleDateString("ru-RU") : "—"} → {r.planEnd ? r.planEnd.toLocaleDateString("ru-RU") : "—"}</div>
              <div>Факт: {r.factStart ? r.factStart.toLocaleDateString("ru-RU") : "—"} → {r.factEnd ? r.factEnd.toLocaleDateString("ru-RU") : "—"}</div>
              <div>Бюджет: план {fmtMln(r.budgetPlan)} / факт {fmtMln(r.budgetFact)}</div>
              <div>Прогресс: {Math.round(r.progress)}%</div>
            </div>
          );
          return (
            <div key={r.stage} className="gantt-row">
              <span className="gantt-label" title={r.stage}>
                {r.stage}
              </span>
              <AntTooltip title={tip} color="#111927">
                <div className="gantt-bar-container">
                  {months.map((m, i) => {
                    const pos = getPos(new Date(m));
                    return pos !== null ? <div key={i} className="gantt-month-line" style={{ left: `${pos}%` }} /> : null;
                  })}
                  <div className="gantt-bar-plan" style={{ left: `${planLeft}%`, width: `${planWidth}%` }} />
                  <div className="gantt-bar-fact" style={{ left: `${factLeft}%`, width: `${factWidth}%` }} />
                  <span className="gantt-progress-text">{Math.round(r.progress)}%</span>
                </div>
              </AntTooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BudgetList({ items }) {
  return (
    <div className="glass section-card">
      <div className="section-title">Бюджеты (план/факт)</div>
      <div className="budget-list">
        {items.map((item) => {
          const pct = item.budget_plan ? Math.min((item.budget_fact / item.budget_plan) * 100, 300) : 0;
          return (
            <div className="budget-row" key={item.project}>
              <div className="budget-header">
                <span className="budget-name">{item.project}</span>
                <span className="budget-values">
                  <span>{fmtMln(item.budget_fact)}</span> / {fmtMln(item.budget_plan)}
                  <span className="budget-percent" style={{ background: "rgba(143,124,255,0.15)", color: "#8f7cff" }}>
                    {Math.round(pct)}%
                  </span>
                </span>
              </div>
              <div className="budget-bar-container">
                <div
                  className="budget-bar-fact"
                  style={{ width: `${Math.min(pct, 100)}%`, background: "#5ce1e6" }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StageList({ stages }) {
  return (
    <div className="glass section-card">
      <div className="section-title">Этапы (среднее %)</div>
      <div className="stages-list">
        {stages.map((s) => (
          <div className="stage-row" key={s.stage}>
            <span className="stage-name" title={s.stage}>
              {s.stage}
            </span>
            <div className="stage-bar-container">
              <div className="stage-bar" style={{ width: `${s.progress}%`, background: "#3ac8ff" }} />
            </div>
            <span className="stage-value">{Math.round(s.progress)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DynamicsChart({ data }) {
  return (
    <div className="glass section-card">
      <div className="section-title legend">
        <span className="legend-title">Динамика план/факт</span>
        <div className="legend-items">
          <span className="legend-item">
            <span className="legend-dot" style={{ background: "#9fb0d8" }} />
            План
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ background: "#5ce1e6" }} />
            Факт
          </span>
        </div>
      </div>
      <div className="dynamics-chart-wrapper">
        <ResponsiveContainer width="100%" height={180}>
          <LineChart
            data={data.map((d) => ({
              ...d,
              monthLabel: d.month ? `${d.month.slice(5, 7)}.${d.month.slice(2, 4)}` : d.month,
            }))}
            margin={{ top: 4, right: 6, left: -16, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#222a3d" />
            <XAxis dataKey="monthLabel" stroke="#9fb0d8" tick={{ fontSize: 10, dy: 8 }} tickMargin={0} />
            <YAxis
              stroke="#9fb0d8"
              tick={{ fontSize: 10, dx: -2 }}
              tickFormatter={(v) => {
                if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}М`;
                if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}т`;
                return v;
              }}
            />
            <Tooltip
              formatter={(value) => (value != null ? value.toLocaleString("ru-RU") : "—")}
              labelFormatter={(label) => `Месяц ${label}`}
              contentStyle={{ background: "#0f1624", border: "1px solid #1f2a3d", borderRadius: 8 }}
            />
            <Line type="monotone" dataKey="plan" stroke="#9fb0d8" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="fact" stroke="#5ce1e6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CriticalList({ items }) {
  return (
    <div className="glass section-card">
      <div className="section-title">Критические работы (задержки)</div>
      <div className="list-header">
        <span>Проект</span>
        <span>Работа</span>
        <span>Ответственный</span>
        <span>Отклонение</span>
        <span>Срок оконч.</span>
      </div>
      <div className="critical-list no-scroll">
        {items.length === 0 ? (
          <div style={{ color: "#9fb0d8" }}>Нет критических работ</div>
        ) : (
          items.map((d, idx) => (
            <div className="critical-row" key={idx}>
              <span className="critical-project">{d.project}</span>
              <span className="critical-work" title={d.task}>
                {d.task}
              </span>
              <span className="critical-responsible">{d.owner}</span>
              <span className="critical-delay">+{d.delay} дн.</span>
              <span className="critical-dates">{d.plan_end || "—"}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ResponsibleList({ items }) {
  return (
    <div className="glass section-card">
      <div className="section-title">По ответственным</div>
      <div className="list-header list-header-resp">
        <span className="lh-col">Фамилия И.О.</span>
        <span className="lh-col">Бюджет</span>
        <span className="status-header lh-col">Статусы работ (Заверш./В раб./Не нач.)</span>
        <span className="lh-col percent-col">% заверш.</span>
      </div>
      <div className="responsible-list scrollable">
        {items.map((d) => (
          <div className="responsible-row" key={d.name}>
            <div className="responsible-name">{d.name || "—"}</div>
            <div className="responsible-budget">
              Факт: {fmtMln(d.budgetFact)} / План: {fmtMln(d.budgetPlan)}{" "}
              <span className="budget-percent" style={{ background: "rgba(143,124,255,0.15)", color: "#8f7cff" }}>
                {d.budgetPct}%
              </span>
            </div>
            <div className="responsible-status-dots">
              <div className="status-circle completed">{d.completed}</div>
              <div className="status-circle in-progress">{d.inProgress}</div>
              <div className="status-circle not-started">{d.notStarted}</div>
            </div>
            <div className="responsible-completion">{d.compPct}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecordsTable({ records, loading, filters, onFiltersChange, projects, onRefresh, scrollRef }) {
  const keepScroll = (fn) => {
    if (scrollRef) scrollRef.current = window.scrollY;
    fn();
  };
  const [pageSize, setPageSize] = useState(10);
  const columns = [
    { title: "Проект", dataIndex: "project", key: "project" },
    { title: "Этап", dataIndex: "stage", key: "stage" },
    { title: "Работа", dataIndex: "task", key: "task" },
    { title: "Ответственный", dataIndex: "owner", key: "owner" },
    {
      title: "Статус",
      dataIndex: "status",
      key: "status",
      render: (val) => <Tag color={STATUS_COLORS[val] || "blue"}>{val}</Tag>,
    },
    { title: "План. начало", dataIndex: "planned_start", key: "planned_start" },
    { title: "План. конец", dataIndex: "planned_end", key: "planned_end" },
    { title: "Факт. начало", dataIndex: "actual_start", key: "actual_start" },
    { title: "Факт. конец", dataIndex: "actual_end", key: "actual_end" },
    {
      title: "Завершение",
      dataIndex: "completion",
      key: "completion",
      render: (v) => (v != null ? `${Math.round(v * 100)}%` : "—"),
    },
    {
      title: "Бюджет план",
      dataIndex: "budget_plan",
      key: "budget_plan",
      render: (v) => (v != null ? v.toLocaleString("ru-RU") : "—"),
    },
    {
      title: "Бюджет факт",
      dataIndex: "budget_fact",
      key: "budget_fact",
      render: (v) => (v != null ? v.toLocaleString("ru-RU") : "—"),
    },
  ];

  const stageOptions = Array.from(new Set(records.map((r) => r.stage).filter(Boolean))).map((v) => ({
    label: v,
    value: v,
  }));

  return (
    <div className="glass table-card">
      <div className="section-title">Таблица задач</div>
      <div className="table-filters">
        <div className="filter-group">
          <span className="filter-label">Проект</span>
          <Select
            allowClear
            placeholder="Проект"
            style={{ minWidth: 160 }}
            options={[{ label: "Все", value: "Все" }, ...projects.map((p) => ({ label: p.name, value: p.name }))]}
            value={filters.project || "Все"}
            onChange={(v) => keepScroll(() => onFiltersChange({ ...filters, project: v === "Все" ? undefined : v }))}
          />
        </div>
        <div className="filter-group">
          <span className="filter-label">Статус</span>
          <Select
            allowClear
            placeholder="Статус"
            style={{ minWidth: 160 }}
            options={[{ label: "Все", value: "Все" }, ...["Не начато", "В работе", "Завершено"].map((s) => ({ label: s, value: s }))]}
            value={filters.status || "Все"}
            onChange={(v) => keepScroll(() => onFiltersChange({ ...filters, status: v === "Все" ? undefined : v }))}
          />
        </div>
        <div className="filter-group">
          <span className="filter-label">Этап</span>
          <Select
            allowClear
            placeholder="Этап"
            style={{ minWidth: 200 }}
            options={[{ label: "Все", value: "Все" }, ...stageOptions]}
            value={filters.stage || "Все"}
            onChange={(v) => keepScroll(() => onFiltersChange({ ...filters, stage: v === "Все" ? undefined : v }))}
          />
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => keepScroll(onRefresh)}>
          Обновить
        </Button>
        <Button onClick={() => keepScroll(() => onFiltersChange({}))}>Сбросить фильтры</Button>
      </div>
      <Table
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={records}
        rowKey="id"
        pagination={{
          pageSize,
          pageSizeOptions: ["10", "20", "50", "100", `${records.length}`],
          showSizeChanger: true,
          onChange: (_, size) => setPageSize(size),
          onShowSizeChange: (_, size) => setPageSize(size),
          showTotal: (total) => `Всего: ${total}`,
        }}
        scroll={{ x: true }}
      />
    </div>
  );
}

function App() {
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [manualLoading, setManualLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState({});
  const [projects, setProjects] = useState([]);
  const [records, setRecords] = useState([]);
  const [uploadHistory, setUploadHistory] = useState([]);
  const [filters, setFilters] = useState({});
  const [form] = Form.useForm();
  const today = new Date();

  const lastScroll = useRef(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [kpiResp, proj, recs, uploads] = await Promise.all([
        api.getKpi(),
        api.getProjects(),
        api.getRecords({}),
        api.getUploads().catch(() => []),
      ]);
      setKpi(kpiResp);
      setProjects(proj);
      setRecords(recs);
      setUploadHistory(
        uploads.map((u) => ({
          name: u.name,
          time: new Date(String(u.time).replace(" ", "T")).toLocaleString("ru-RU"),
          rows: u.rows,
        }))
      );
    } catch (err) {
      console.error(err);
      message.error(err.message || "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    if (lastScroll.current !== null && !loading) {
      window.scrollTo({ top: lastScroll.current, left: 0, behavior: "auto" });
      lastScroll.current = null;
    }
  }, [loading]);

  const handleUpload = async ({ file, onSuccess, onError }) => {
    setUploading(true);
    try {
      await api.uploadFile(file);
      onSuccess?.("ok");
      message.success("Файл загружен и импортирован");
      const afterRecords = await api.getRecords({});
      setRecords(afterRecords);
      const projectsFresh = await api.getProjects();
      setProjects(projectsFresh);
      const uploads = await api.getUploads().catch(() => []);
      setUploadHistory(
        uploads.map((u) => ({
          name: u.name,
          time: new Date(String(u.time).replace(" ", "T")).toLocaleString("ru-RU"),
          rows: u.rows,
        }))
      );
      setKpi(await api.getKpi());
    } catch (err) {
      const msg =
        err?.message ||
        "Ошибка загрузки. Проверьте структуру файла (ожидаются колонки: Этап, Работа, Ответственный, Статус, Плановое начало, Плановый конец, Фактическое начало, Фактический конец, Завершение, Бюджет план, Бюджет факт).";
      message.error(msg, 8);
      onError?.(err);
    } finally {
      setUploading(false);
    }
  };

  const handleManualSubmit = async (values) => {
    setManualLoading(true);
    try {
      const payload = {
        projectName: values.projectName || values.projectSelect,
        stage: values.stage,
        task: values.task,
        owner: values.owner,
        status: values.status,
        planned_start: dateToIso(values.planned_start),
        planned_end: dateToIso(values.planned_end),
        actual_start: dateToIso(values.actual_start),
        actual_end: dateToIso(values.actual_end),
        completion: values.completion != null ? values.completion / 100 : null,
        budget_plan: values.budget_plan,
        budget_fact: values.budget_fact,
      };
      if (!payload.projectName) {
        message.error("Выберите или введите проект");
        setManualLoading(false);
        return;
      }
      await api.createRecord(payload);
      message.success("Запись добавлена");
      form.resetFields();
      await fetchAll();
      const recs = await api.getRecords({});
      setRecords(recs);
      setKpi(await api.getKpi());
      setProjects(await api.getProjects());
    } catch (err) {
      message.error(err.message || "Ошибка добавления", 6);
    } finally {
      setManualLoading(false);
    }
  };

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (filters.project && r.project !== filters.project) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.stage && r.stage !== filters.stage) return false;
      return true;
    });
  }, [records, filters]);

  const stageData = useMemo(() => {
    const map = new Map();
    filteredRecords.forEach((r) => {
      if (!r.stage) return;
      const list = map.get(r.stage) || [];
      list.push(r);
      map.set(r.stage, list);
    });
    return Array.from(map.entries()).map(([stage, rows]) => ({
      stage,
      progress:
        rows.length > 0
          ? Math.min(
              100,
              Math.max(0, (rows.reduce((s, r) => s + (Number(r.completion) || 0), 0) / rows.length) * 100)
            )
          : 0,
    }));
  }, [filteredRecords]);

  const dynamicsData = useMemo(() => {
    const map = new Map();
    filteredRecords.forEach((r) => {
      const m = r.planned_start ? String(r.planned_start).slice(0, 7) : null;
      if (!m) return;
      const val = map.get(m) || { month: m, plan: 0, fact: 0 };
      val.plan += Number(r.budget_plan) || 0;
      val.fact += Number(r.budget_fact) || 0;
      map.set(m, val);
    });
    return Array.from(map.values()).sort((a, b) => (a.month > b.month ? 1 : -1));
  }, [filteredRecords]);

  const criticalItems = useMemo(() => {
    const items = filteredRecords
      .map((r) => {
        let delay = 0;
        if (r.status === "Завершено" && r.planned_end && r.actual_end) {
          delay = Math.round((new Date(r.actual_end) - new Date(r.planned_end)) / 86400000);
        } else if (r.status === "В работе" && r.planned_end) {
          const pe = new Date(r.planned_end);
          if (today > pe) delay = Math.round((today - pe) / 86400000);
        }
        return {
          project: r.project,
          task: r.task,
          owner: r.owner,
          delay,
          plan_end: r.planned_end,
        };
      })
      .filter((r) => r.delay > 0)
      .sort((a, b) => b.delay - a.delay)
      .slice(0, 6);
    return items;
  }, [filteredRecords, today]);

  const responsibleItems = useMemo(() => {
    const map = new Map();
    filteredRecords.forEach((r) => {
      const key = r.owner || "—";
      const entry =
        map.get(key) || { name: key, completed: 0, inProgress: 0, notStarted: 0, budgetPlan: 0, budgetFact: 0 };
      if (r.status === "Завершено") entry.completed += 1;
      else if (r.status === "В работе") entry.inProgress += 1;
      else entry.notStarted += 1;
      entry.budgetPlan += Number(r.budget_plan) || 0;
      entry.budgetFact += Number(r.budget_fact) || 0;
      map.set(key, entry);
    });
    return Array.from(map.values())
      .map((d) => ({
        ...d,
        compPct:
          d.completed + d.inProgress + d.notStarted > 0
            ? Math.round((d.completed / (d.completed + d.inProgress + d.notStarted)) * 100)
            : 0,
        budgetPct: d.budgetPlan > 0 ? Math.round((d.budgetFact / d.budgetPlan) * 100) : 0,
      }))
      .sort((a, b) => b.compPct - a.compPct);
  }, [filteredRecords]);

  const ganttData = useMemo(() => {
    const list = filters.project ? filteredRecords.filter((r) => r.project === filters.project) : filteredRecords;
    const stageMap = new Map();
    list.forEach((r) => {
      const key = filters.project ? r.stage : `${r.project}: ${r.stage}`;
      const s = stageMap.get(key) || [];
      s.push(r);
      stageMap.set(key, s);
    });
    const rows = Array.from(stageMap.entries()).map(([stage, rows]) => {
      const planStarts = rows.map((r) => r.planned_start).filter(Boolean);
      const planEnds = rows.map((r) => r.planned_end).filter(Boolean);
      const factStarts = rows.map((r) => r.actual_start).filter(Boolean);
      const factEnds = rows.map((r) => r.actual_end).filter(Boolean);
      const planStart = planStarts.length ? new Date(Math.min(...planStarts.map((d) => new Date(d)))) : null;
      const planEnd = planEnds.length ? new Date(Math.max(...planEnds.map((d) => new Date(d)))) : null;
      const factStart = factStarts.length ? new Date(Math.min(...factStarts.map((d) => new Date(d)))) : null;
      const factEnd = factEnds.length ? new Date(Math.max(...factEnds.map((d) => new Date(d)))) : null;
      const progress = (rows.reduce((s, r) => s + (r.completion || 0), 0) / (rows.length || 1)) * 100;
      const budgetPlan = rows.reduce((s, r) => s + (r.budget_plan || 0), 0);
      const budgetFact = rows.reduce((s, r) => s + (r.budget_fact || 0), 0);
      return { stage, planStart, planEnd, factStart, factEnd, progress, budgetPlan, budgetFact };
    });
    const dates = rows.flatMap((r) => [r.planStart, r.planEnd, r.factStart, r.factEnd]).filter(Boolean);
    const minDate = dates.length ? new Date(Math.min(...dates)) : null;
    const maxDate = dates.length ? new Date(Math.max(...dates)) : null;
    return { rows, minDate, maxDate };
  }, [filteredRecords, filters.project]);

  const kpiView = useMemo(() => {
    const rec = filteredRecords;
    const projectsSet = new Set(rec.map((r) => r.project));
    const completions = rec.map((r) => Number(r.completion)).filter((v) => !Number.isNaN(v));
    const avg = completions.length ? completions.reduce((a, b) => a + b, 0) / completions.length : 0;
    const sorted = [...completions].sort((a, b) => a - b);
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const budgetPlan = rec.reduce((s, r) => s + (Number(r.budget_plan) || 0), 0);
    const budgetFact = rec.reduce((s, r) => s + (Number(r.budget_fact) || 0), 0);
    return {
      projects: projectsSet.size,
      tasks: rec.length,
      completion_avg: Number((avg * 100).toFixed(1)),
      completion_median: Number((med * 100).toFixed(1)),
      budget_plan: budgetPlan,
      budget_fact: budgetFact,
    };
  }, [filteredRecords]);

  const budgetDataView = useMemo(() => {
    const map = new Map();
    filteredRecords.forEach((r) => {
      const entry = map.get(r.project) || { project: r.project, budget_plan: 0, budget_fact: 0 };
      entry.budget_plan += Number(r.budget_plan) || 0;
      entry.budget_fact += Number(r.budget_fact) || 0;
      map.set(r.project, entry);
    });
    return Array.from(map.values());
  }, [filteredRecords]);

  const projectPill = (label, value) => (
    <div
      key={label}
      className={`pill ${(!value && !filters.project) || filters.project === value ? "active" : ""}`}
      onClick={() => setFilters({ ...filters, project: value || undefined })}
    >
      {label}
    </div>
  );

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#5ce1e6",
          colorBgBase: "transparent",
          colorTextBase: "#e9edf5",
          colorBorder: "rgba(255,255,255,0.2)",
          borderRadius: 12,
          fontFamily:
            '"Space Grotesk", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
      }}
    >
      <div className="app-shell">
        <h1 className="page-title">Портфель строительных проектов</h1>
        <div className="section">
          <div className="section-title">Загрузка XLSX</div>
          <div className="upload-grid">
            <div className="glass upload-bar vertical">
              <Upload.Dragger
                name="file"
                multiple={false}
                customRequest={handleUpload}
                showUploadList={false}
                disabled={uploading}
                className="mini-dragger"
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">Перетащите XLSX или нажмите, чтобы выбрать</p>
              </Upload.Dragger>
              <div className="upload-hint">Наименование проекта определяется по имени файла</div>
            </div>
            <div className="glass upload-history">
              <div className="section-title">История загрузок</div>
              <div className="history-table">
                <div className="history-header">
                  <span>Файл</span>
                  <span>Время</span>
                  <span>Строк</span>
                </div>
                {uploadHistory.length === 0 ? (
                  <div className="history-empty">Пока нет загрузок</div>
                ) : (
                  uploadHistory.map((h, i) => (
                    <div className="history-row" key={i}>
                      <span title={h.name}>{h.name}</span>
                      <span>{h.time}</span>
                      <span>{h.rows}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-title">Ручной ввод</div>
          <Button size="small" onClick={() => setShowForm((v) => !v)} style={{ marginBottom: 8 }}>
            {showForm ? "Свернуть форму" : "Развернуть форму"}
          </Button>
          {showForm && (
          <div className="glass form-card">
            <Form form={form} layout="vertical" onFinish={handleManualSubmit}>
              <div className="form-grid">
                <Form.Item label="Проект (существующий)" name="projectSelect">
                  <Select
                    allowClear
                    options={projects.map((p) => ({ label: p.name, value: p.name }))}
                    placeholder="Выберите проект"
                  />
                </Form.Item>
                <Form.Item label="Или новый проект" name="projectName">
                  <Input placeholder="Название проекта" />
                </Form.Item>
                <Form.Item label="Этап" name="stage" rules={[{ required: true }]}>
                  <Input placeholder="Этап" />
                </Form.Item>
                <Form.Item label="Работа" name="task" rules={[{ required: true }]}>
                  <Input placeholder="Работа" />
                </Form.Item>
                <Form.Item label="Ответственный" name="owner">
                  <Input placeholder="ФИО" />
                </Form.Item>
                <Form.Item label="Статус" name="status" rules={[{ required: true }]}>
                  <Select
                    options={[
                      { label: "Не начато", value: "Не начато" },
                      { label: "В работе", value: "В работе" },
                      { label: "Завершено", value: "Завершено" },
                    ]}
                  />
                </Form.Item>
                <Form.Item label="Плановое начало" name="planned_start">
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="Плановый конец" name="planned_end">
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="Фактическое начало" name="actual_start">
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="Фактический конец" name="actual_end">
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="Бюджет план" name="budget_plan">
                  <InputNumber min={0} style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="Бюджет факт" name="budget_fact">
                  <InputNumber min={0} style={{ width: "100%" }} />
                </Form.Item>
              <Form.Item label="Завершение (%)" name="completion">
                <InputNumber min={0} max={100} step={1} style={{ width: "100%" }} />
              </Form.Item>
            </div>
            <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={manualLoading}>
              Добавить
            </Button>
          </Form>
          </div>
          )}
        </div>

        <div className="section">
          <Spin spinning={loading} tip="Обновление данных...">
            <div className="filters-bar">
              <span className="filter-label">Проект</span>
              <div className="project-pills">
                {projectPill("Все", null)}
                {projects.map((p) => projectPill(p.name, p.name))}
                </div>
                <span className="filter-label" style={{ marginLeft: 12 }}>
                  Статус
                </span>
                <Select
                  className="filter-select"
                  value={filters.status || "Все"}
                  onChange={(v) => setFilters({ ...filters, status: v === "Все" ? undefined : v })}
                  options={["Все", "Не начато", "В работе", "Завершено"].map((s) => ({ label: s, value: s }))}
                  size="middle"
                />
                <span className="filter-label" style={{ marginLeft: 12 }}>
                  Этап
                </span>
                <Select
                  className="filter-select"
                  value={filters.stage || "Все"}
                  onChange={(v) => setFilters({ ...filters, stage: v === "Все" ? undefined : v })}
                  options={[{ label: "Все", value: "Все" }, ...stageData.map((s) => ({ label: s.stage, value: s.stage }))]}
                  size="middle"
                />
                <Button onClick={() => setFilters({})}>Сброс фильтров</Button>
              </div>
              <div className="kpi-block">
                <KpiCards
                  kpi={kpiView}
                  totalTasks={filteredRecords.length}
                  doneTasks={filteredRecords.filter((r) => r.status === "Завершено").length}
                />
              </div>
              <div className="row-2">
                <BudgetList items={budgetDataView} />
                <StageList stages={stageData} />
                <DynamicsChart data={dynamicsData} />
              </div>
              <div className="gantt-section">
                <div className="gantt-header">
                  <div className="section-title">Диаграмма Гантта по этапам (план/факт)</div>
                </div>
                <Gantt records={ganttData} />
              </div>
              <div className="row-4">
                <CriticalList items={criticalItems} />
                <ResponsibleList items={responsibleItems} />
              </div>
              <RecordsTable
                records={filteredRecords}
                loading={loading}
                filters={filters}
                projects={projects}
                onFiltersChange={setFilters}
                onRefresh={fetchAll}
                scrollRef={lastScroll}
              />
          </Spin>
        </div>
      </div>
    </ConfigProvider>
  );
}

export default App;

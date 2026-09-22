const API_BASE = "";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    let msg = "";
    try {
      const data = await res.json();
      msg = data?.error || JSON.stringify(data);
    } catch (e) {
      msg = await res.text();
    }
    throw new Error(msg || res.statusText);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
}

export const api = {
  uploadFile: async (file) => {
    const form = new FormData();
    form.append("file", file);
    return request("/api/upload", { method: "POST", body: form });
  },
  getKpi: () => request("/api/kpi"),
  getProjects: () => request("/api/projects"),
  getUploads: () => request("/api/uploads"),
  getRecords: (params = {}) => {
    const url = new URL("/api/records", window.location.origin);
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
    return request(url.pathname + url.search);
  },
  createRecord: (payload) =>
    request("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  completionByProject: () => request("/api/charts/completion-by-project"),
  budgets: () => request("/api/charts/budgets"),
  planFact: () => request("/api/charts/plan-fact"),
};

import API from "../api/api.js";

const BASE = "/api/admin/cia";

function query(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === "" || value == null) continue;
    params.set(key, value instanceof Date ? value.toISOString() : String(value));
  }
  const suffix = params.toString();
  return suffix ? `?${suffix}` : "";
}

export async function getOverview(filters) {
  return (await API.get(`${BASE}/overview${query(filters)}`)).data;
}

export async function getUsage(filters, dimension = "surface") {
  return (await API.get(`${BASE}/usage${query({ ...filters, dimension })}`)).data;
}

export async function getHealth(filters) {
  return (await API.get(`${BASE}/health${query(filters)}`)).data;
}

export async function getFilters(filters) {
  return (await API.get(`${BASE}/filters${query(filters)}`)).data;
}

export async function getRequestTrace(requestId) {
  return (await API.get(`${BASE}/requests/${encodeURIComponent(requestId)}`)).data;
}

export async function getAccess(filters) {
  return (await API.get(`${BASE}/access${query(filters)}`)).data;
}

export async function updateAccess(userId, enabled) {
  return (await API.put(`${BASE}/access/${encodeURIComponent(userId)}`, {
    enabled: Boolean(enabled),
  })).data;
}

export async function updateAccessBulk(userIds, enabled) {
  return (await API.put(`${BASE}/access`, {
    userIds,
    enabled: Boolean(enabled),
  })).data;
}

export async function getSettings() {
  return (await API.get(`${BASE}/settings`)).data;
}

// ── KPI Library ─────────────────────────────────────────────────────────────
export async function listKpis(filters) {
  return (await API.get(`${BASE}/kpis${query(filters)}`)).data;
}

export async function getKpiDetail(id) {
  return (await API.get(`${BASE}/kpis/${encodeURIComponent(id)}`)).data;
}

export async function createKpi(payload) {
  return (await API.post(`${BASE}/kpis`, payload)).data;
}

// payload wajib memuat reason non-kosong (divalidasi server juga).
export async function updateKpi(id, payload) {
  return (await API.put(`${BASE}/kpis/${encodeURIComponent(id)}`, payload)).data;
}

export async function confirmKpi(id, reason) {
  return (await API.post(`${BASE}/kpis/${encodeURIComponent(id)}/confirm`, { reason })).data;
}

export async function getKpiRevisions(id) {
  return (await API.get(`${BASE}/kpis/${encodeURIComponent(id)}/revisions`)).data;
}

export async function restoreKpiRevision(id, revisionId, reason) {
  return (await API.post(
    `${BASE}/kpis/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore`,
    { reason },
  )).data;
}

export async function startKpiSync(dashboardIds) {
  return (await API.post(`${BASE}/kpis/sync`, { dashboardIds: dashboardIds || null })).data;
}

export async function getKpiSyncStatus(runId) {
  return (await API.get(`${BASE}/kpis/sync/${encodeURIComponent(runId)}`)).data;
}

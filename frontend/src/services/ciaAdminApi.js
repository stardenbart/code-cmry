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

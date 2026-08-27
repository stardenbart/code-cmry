// Service analytics Admin CIA: memvalidasi/menormalkan filter dari query string
// lalu membentuk hasil agregasi model menjadi kontrak API yang stabil.
//
// SEMUA whitelist (surface/status/method/dimensi) adalah konstanta di sini.
// Query string tidak pernah menentukan nama kolom atau GROUP BY — itu mencegah
// injeksi lewat parameter seperti `dimension`. Rentang tanggal punya default 30
// hari dan diklem maksimum 366 hari.
import * as telemetry from "../models/ciaTelemetryModel.js";

export const SURFACES = ["dashboard", "multi_chat", "whatsapp", "schedule", "navigator"];
export const STATUSES = ["success", "partial", "fallback", "error"];
export const METHODS = ["live_dax", "mixed", "snapshot", "none"];
export const VALID_DIMENSIONS = [
  "user", "department", "surface", "dashboard", "status", "retrieval_method",
  "semantic_model", "provider", "ai_model",
];

const DAY_MS = 86400000;
const MAX_RANGE_DAYS = 366;

export class AnalyticsValidationError extends Error {
  constructor(message, code = "INVALID_FILTER") {
    super(message);
    this.name = "AnalyticsValidationError";
    this.code = code;
    this.statusCode = 400;
  }
}

// ── Helper normalisasi ────────────────────────────────────────────────────
const WIB_MS = 7 * 3600 * 1000;

function addDays(date, n) {
  return new Date(date.getTime() + n * DAY_MS);
}
function startOfWibDay(date) {
  const wib = new Date(date.getTime() + WIB_MS);
  wib.setUTCHours(0, 0, 0, 0);
  return new Date(wib.getTime() - WIB_MS);
}
function endOfWibDay(date) {
  const wib = new Date(date.getTime() + WIB_MS);
  wib.setUTCHours(23, 59, 59, 999);
  return new Date(wib.getTime() - WIB_MS);
}
function parseIsoBoundary(value, fallback, endOfDay = false) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const text = value.trim();
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const startWib = Date.UTC(Number(year), Number(month) - 1, Number(day)) - WIB_MS;
    return new Date(startWib + (endOfDay ? DAY_MS - 1 : 0));
  }
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? fallback : d;
}
function positiveIntOrNull(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function textOrNull(value, maxLen) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.slice(0, maxLen);
}
function oneOfOrNull(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

export function normalizeAnalyticsFilters(query = {}, now = new Date()) {
  let from = parseIsoBoundary(query.from, startOfWibDay(addDays(now, -29)));
  let to = parseIsoBoundary(query.to, endOfWibDay(now), true);

  // from harus <= to; tukar bila terbalik.
  if (from > to) { const tmp = from; from = to; to = tmp; }

  // Klem rentang ke MAX_RANGE_DAYS agar agregasi tidak memindai tanpa batas.
  if ((to - from) > MAX_RANGE_DAYS * DAY_MS) {
    from = new Date(to.getTime() - MAX_RANGE_DAYS * DAY_MS);
  }

  return {
    from,
    to,
    userId: positiveIntOrNull(query.userId),
    department: textOrNull(query.department, 100),
    dashboardId: textOrNull(query.dashboardId, 100),
    surface: oneOfOrNull(query.surface, SURFACES),
    status: oneOfOrNull(query.status, STATUSES),
    retrievalMethod: oneOfOrNull(query.retrievalMethod, METHODS),
    semanticModel: textOrNull(query.semanticModel, 200),
    provider: textOrNull(query.provider, 40),
    aiModel: textOrNull(query.aiModel, 100),
  };
}

// ── Shapers ───────────────────────────────────────────────────────────────
function rate(numerator, total) {
  const t = Number(total) || 0;
  return t === 0 ? 0 : Number(numerator) / t;
}
function num(v) { return v == null ? null : Number(v); }

export async function getOverview(filters) {
  const [req, ev, p95, median] = await Promise.all([
    telemetry.aggregateRequests(filters),
    telemetry.aggregateEvents(filters),
    telemetry.p95Latency(filters),
    telemetry.medianLatency(filters),
  ]);
  const requests = Number(req.requests) || 0;
  return {
    totals: {
      requests,
      activeUsers: Number(req.active_users) || 0,
      inputTokens: Number(req.input_tokens) || 0,
      outputTokens: Number(req.output_tokens) || 0,
      totalTokens: Number(req.total_tokens) || 0,
    },
    rates: {
      success: rate(req.success_count, requests),
      liveDax: rate(req.live_dax_count, requests),
      fallback: rate(req.fallback_count, requests),
      error: rate(req.error_count, requests),
    },
    latency: {
      averageMs: req.avg_latency == null ? null : Math.round(Number(req.avg_latency)),
      medianMs: median == null ? null : Math.round(median),
      p95Ms: p95 == null ? null : Math.round(p95),
    },
    retrieval: {
      averageRounds: req.avg_rounds == null ? 0 : Number(req.avg_rounds),
      daxFailures: Number(ev.dax_failures) || 0,
      plannerNoMatch: Number(ev.planner_no_match) || 0,
    },
  };
}

export async function getUsageSeries(filters) {
  const rows = await telemetry.requestSeries(filters);
  return rows.map((r) => ({
    day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
    requests: Number(r.requests) || 0,
    inputTokens: Number(r.input_tokens) || 0,
    outputTokens: Number(r.output_tokens) || 0,
    totalTokens: Number(r.total_tokens) || 0,
  }));
}

export async function getUsageBreakdown(filters, dimension) {
  if (!VALID_DIMENSIONS.includes(dimension)) {
    // Ditolak SEBELUM menyentuh database.
    throw new AnalyticsValidationError(`Dimensi '${dimension}' tidak valid`, "INVALID_DIMENSION");
  }
  const rows = await telemetry.breakdownBy(filters, dimension);
  return rows.map((r) => ({
    key: r.key,
    label: r.label != null ? String(r.label) : (r.key != null ? String(r.key) : "—"),
    requests: Number(r.requests) || 0,
    inputTokens: Number(r.input_tokens) || 0,
    outputTokens: Number(r.output_tokens) || 0,
    totalTokens: Number(r.total_tokens) || 0,
    averageLatencyMs: r.avg_latency == null ? null : Math.round(Number(r.avg_latency)),
  }));
}

export async function getRetrievalHealth(filters) {
  const h = await telemetry.retrievalHealthRows(filters);
  return {
    errorsByCode: h.errorsByCode.map((r) => ({ code: r.code, count: Number(r.count) || 0 })),
    stageErrors: h.stageErrors.map((r) => ({ stage: r.stage, count: Number(r.count) || 0 })),
    methodSplit: h.methodSplit.map((r) => ({ method: r.method, count: Number(r.count) || 0 })),
    latencyByModel: h.latencyByModel.map((r) => ({
      model: r.model,
      averageLatencyMs: r.avg_latency == null ? null : Math.round(Number(r.avg_latency)),
      count: Number(r.count) || 0,
    })),
    rounds: {
      average: h.rounds?.avg_rounds == null ? 0 : Number(h.rounds.avg_rounds),
      max: h.rounds?.max_rounds == null ? 0 : Number(h.rounds.max_rounds),
    },
  };
}

export async function getFilterOptions(filters) {
  const o = await telemetry.filterOptionRows(filters);
  return {
    users: o.users.map((r) => ({ id: num(r.id), name: r.name || `User ${r.id}` })),
    departments: o.departments.map((r) => r.department),
    surfaces: o.surfaces.map((r) => r.surface),
    dashboards: o.dashboards.map((r) => ({ id: num(r.id), name: r.name || `Dashboard ${r.id}` })),
    semanticModels: o.semanticModels.map((r) => r.value),
    providers: o.providers.map((r) => r.value),
    aiModels: o.aiModels.map((r) => r.value),
  };
}

export async function getRequestTrace(requestUuid) {
  const trace = await telemetry.findRequestTrace(requestUuid);
  if (!trace) return null;
  // Trace admin: tidak ada secret di skema, tetapi tetap dibentuk eksplisit
  // supaya kolom yang ditambahkan kelak tidak otomatis ikut terkirim.
  const r = trace.request;
  return {
    request: {
      requestId: r.request_uuid,
      userId: r.user_id,
      actorName: r.actor_name,
      department: r.department,
      surface: r.surface,
      status: r.status,
      retrievalMethod: r.retrieval_method,
      inputTokens: Number(r.input_tokens) || 0,
      outputTokens: Number(r.output_tokens) || 0,
      totalTokens: Number(r.total_tokens) || 0,
      latencyMs: num(r.latency_ms),
      retrievalRounds: Number(r.retrieval_rounds) || 0,
      questionPreview: r.question_preview,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    },
    events: trace.events.map((e) => ({
      sequenceNo: Number(e.sequence_no),
      stage: e.stage,
      dashboardId: num(e.dashboard_id),
      dashboardName: e.dashboard_name,
      semanticModel: e.semantic_model,
      provider: e.provider,
      aiModel: e.ai_model,
      inputTokens: Number(e.input_tokens) || 0,
      outputTokens: Number(e.output_tokens) || 0,
      totalTokens: Number(e.total_tokens) || 0,
      latencyMs: num(e.latency_ms),
      rowsReturned: num(e.rows_returned),
      status: e.status,
      errorCode: e.error_code,
      errorMessage: e.error_message,
      metadata: e.metadata_json,
      createdAt: e.created_at,
    })),
  };
}

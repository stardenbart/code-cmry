import crypto from "crypto";

export const CIA_SURFACES = Object.freeze(["dashboard", "multi_chat", "whatsapp", "schedule"]);
export const CIA_RETRIEVAL_METHODS = Object.freeze(["live_dax", "mixed", "snapshot", "none"]);
export const CIA_CONFIDENCE_LEVELS = Object.freeze(["high", "medium", "low"]);
export const CIA_REQUEST_STATUSES = Object.freeze(["success", "partial", "error"]);
export const CIA_STAGES = Object.freeze([
  "scope_resolved", "route_candidates", "ai_plan", "dax_attempt", "dax_repair",
  "evidence_gap", "ai_synthesis", "snapshot_fallback", "response_sent",
]);

function cleanString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanString(item)).filter(Boolean))];
}

function normalizeActor(value) {
  const actor = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    userId: positiveInteger(actor.userId ?? actor.id),
    name: cleanString(actor.name ?? actor.username ?? actor.nama) || null,
    department: cleanString(actor.department ?? actor.departemen ?? actor.divisi) || null,
  };
}

export function normalizeEnvelope(value = {}, options = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const surface = CIA_SURFACES.includes(input.surface) ? input.surface : "dashboard";
  const centralizedAllowed = options.allowCentralized === true
    && ["whatsapp", "schedule"].includes(surface);
  const snapshot = input.snapshotFallback;

  return {
    requestId: cleanString(input.requestId) || crypto.randomUUID(),
    surface,
    actor: normalizeActor(input.actor ?? input.user),
    question: cleanString(input.question),
    conversationId: input.conversationId == null ? null : cleanString(String(input.conversationId)) || null,
    preferredDashboardIds: uniqueStrings(input.preferredDashboardIds),
    accessMode: centralizedAllowed && input.accessMode === "centralized" ? "centralized" : "user_acl",
    snapshotFallback: snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? snapshot
      : null,
  };
}

function normalizeSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const dashboardId = value.dashboardId == null ? "" : cleanString(String(value.dashboardId));
  const dashboardName = cleanString(value.dashboardName);
  if (!dashboardId && !dashboardName) return null;
  return {
    dashboardId: dashboardId || null,
    dashboardName: dashboardName || null,
    period: cleanString(value.period) || null,
    kpis: uniqueStrings(value.kpis),
    rowCount: nonNegativeInteger(value.rowCount),
  };
}

export function normalizeAnswer(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sources = Array.isArray(input.sources)
    ? input.sources.map(normalizeSource).filter(Boolean)
    : [];
  const inputTokens = nonNegativeInteger(input.usage?.inputTokens);
  const outputTokens = nonNegativeInteger(input.usage?.outputTokens);
  const suppliedTotal = nonNegativeInteger(input.usage?.totalTokens);

  return {
    answer: typeof input.answer === "string" ? input.answer.trim() : "",
    requestId: cleanString(input.requestId) || crypto.randomUUID(),
    confidence: CIA_CONFIDENCE_LEVELS.includes(input.confidence) ? input.confidence : "low",
    retrievalMethod: CIA_RETRIEVAL_METHODS.includes(input.retrievalMethod)
      ? input.retrievalMethod
      : "none",
    sources,
    warnings: uniqueStrings(input.warnings),
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: Math.max(suppliedTotal, inputTokens + outputTokens),
    },
    rounds: nonNegativeInteger(input.rounds),
  };
}


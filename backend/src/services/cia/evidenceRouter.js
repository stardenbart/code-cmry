import {
  getDashboardVocabulary,
  searchKpiCandidates,
} from "../ciaKpiLibrary.service.js";

function cleanStrings(value, limit = 20, maxLength = 100) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean))].slice(0, limit);
}

// dimensions_json bentuk campuran (string bare, "Tbl[Kol]", atau object
// {table,column,humanName}) DIPERTAHANKAN apa adanya — daxPlanBuilder.parseDimension
// yang menormalkannya. cleanStrings lama membuang object, jadi jangan dipakai
// untuk dimensions.
function preserveDimensions(value, limit = 50) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => (typeof item === "string" && item.trim())
      || (item && typeof item === "object" && !Array.isArray(item)))
    .slice(0, limit);
}

// Label komparasi untuk mencocokkan dimensi yang diminta planner.
function dimensionLabel(item) {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return String(item.humanName || item.column || item.label || "").trim().toLowerCase();
  }
  return String(item ?? "").trim().toLowerCase();
}

function bindingIdentity(kpi, binding) {
  if (binding.bindingId != null && String(binding.bindingId).trim()) return String(binding.bindingId).trim();
  if (binding.bindingKey != null && String(binding.bindingKey).trim()) return String(binding.bindingKey).trim();
  return [kpi.kpiId ?? kpi.slug, binding.dashboardId, binding.semanticModel,
    binding.tableName, binding.measureName]
    .map((item) => String(item ?? "").trim()).join("|");
}

function routeIdentity(kpi, binding) {
  const dimensions = preserveDimensions(binding.dimensions, 50).map((item) => {
    if (typeof item === "string") return item.trim().toLowerCase();
    return [item.table, item.column, item.humanName].map((value) => String(value ?? "").trim().toLowerCase()).join(".");
  }).sort().join("|");
  return [
    kpi.kpiId ?? kpi.slug,
    binding.reportId || binding.dashboardId,
    binding.semanticModel,
    binding.tableName,
    binding.measureName,
    binding.dateTable,
    binding.dateColumn,
    dimensions,
  ].map((item) => String(item ?? "").trim().toLowerCase()).join("::");
}

function flattenCandidates(kpis) {
  const flattened = new Map();
  for (const kpi of Array.isArray(kpis) ? kpis : []) {
    for (const binding of Array.isArray(kpi.bindings) ? kpi.bindings : []) {
      const bindingId = bindingIdentity(kpi, binding);
      if (!bindingId) continue;
      const candidate = {
        bindingId,
        bindingKey: binding.bindingKey || null,
        kpiId: kpi.kpiId ?? null,
        slug: kpi.slug || null,
        humanName: kpi.humanName || binding.displayCaption || binding.measureName || "KPI",
        // Metadata KPI-level untuk synthesis (label bisnis, unit, format).
        definition: kpi.definition || binding.definition || "",
        unit: kpi.unit ?? binding.unit ?? null,
        numberFormat: kpi.numberFormat ?? binding.numberFormat ?? null,
        score: Number(kpi.score) || 0,
        anchorMatches: cleanStrings(kpi.anchorMatches, 20).map((value) => value.toLowerCase()),
        sourcePriority: Number(binding.sourcePriority ?? kpi.sourcePriority) || 0,
        dashboardId: binding.dashboardId == null ? null : String(binding.dashboardId),
        dashboardName: binding.dashboardName || null,
        reportId: binding.reportId || null,
        semanticModel: binding.semanticModel || null,
        tableName: binding.tableName || null,
        measureName: binding.measureName || null,
        displayCaption: binding.displayCaption || null,
        // Mapping tanggal WAJIB diteruskan; builder memakainya untuk filter
        // periode, dan bila kosong builder mengembalikan typed failure.
        dateTable: binding.dateTable || null,
        dateColumn: binding.dateColumn || null,
        dateLogic: binding.dateLogic || null,
        dimensions: preserveDimensions(binding.dimensions, 50),
        periodDefaults: binding.periodDefaults || null,
        origin: "deterministic",
        purpose: "primary",
      };
      const routeKey = routeIdentity(kpi, binding);
      const current = flattened.get(routeKey);
      if (!current || candidate.sourcePriority > current.sourcePriority
        || (candidate.sourcePriority === current.sourcePriority && candidate.score > current.score)) {
        flattened.set(routeKey, candidate);
      }
    }
  }
  return [...flattened.values()].sort((left, right) => right.sourcePriority - left.sourcePriority
    || right.score - left.score);
}

function safePlannerCandidate(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const bindingId = String(value.bindingId ?? value.id ?? "").trim();
  const base = allowed.get(bindingId);
  if (!base) return null;
  // Cocokkan dimensi yang diminta planner ke dimensi binding via label
  // (mendukung string maupun object), tetapi pertahankan ENTRY ASLI (object/
  // string) supaya builder tetap bisa memparsingnya.
  const dimensionsAllowed = new Map(base.dimensions.map((item) => [dimensionLabel(item), item]));
  const requested = cleanStrings(value.dimensions, 6);
  const dimensions = requested
    .map((item) => dimensionsAllowed.get(item.toLowerCase())).filter(Boolean);
  return {
    ...base,
    dimensions: dimensions.length ? dimensions : base.dimensions,
    purpose: value.purpose === "correlation" ? "correlation" : base.purpose,
  };
}

async function suggestionsFor(scope, loader) {
  try {
    const vocabulary = await loader(scope.allowedDashboardIds);
    return cleanStrings(Object.values(vocabulary || {}).flatMap((item) => [
      ...(Array.isArray(item?.kpis) ? item.kpis : []),
      ...(Array.isArray(item?.dimensions) ? item.dimensions : []),
    ]), 10);
  } catch {
    return [];
  }
}

const DEFAULT_DEPS = { searchKpiCandidates, getDashboardVocabulary, tracker: null };

export async function routeEvidence(input = {}, injected = {}) {
  const deps = { ...DEFAULT_DEPS, ...injected };
  const scope = input.scope || { allowedDashboardIds: [] };
  if (scope.denied === true || (scope.mode === "user_acl" && !scope.allowedDashboardIds?.length)) {
    return {
      status: "access_denied",
      errorCode: "ACCESS_DENIED",
      candidates: [],
      periods: Array.isArray(input.periods) ? input.periods : [],
      suggestions: [],
      warnings: [],
    };
  }
  const deterministicKpis = await deps.searchKpiCandidates({
    question: input.question,
    intentFrame: input.intentFrame,
    allowedDashboardIds: scope.allowedDashboardIds,
    preferredDashboardIds: scope.preferredDashboardIds,
    limit: 20,
  });
  const concepts = cleanStrings(input.intentFrame?.concepts, 20).map((value) => value.toLowerCase());
  const deterministic = flattenCandidates(deterministicKpis).filter((candidate) => !concepts.length
    || candidate.anchorMatches.some((value) => concepts.includes(value)));
  const allowed = new Map(deterministic.map((item) => [item.bindingId, item]));
  const warnings = [];

  let plannerResult = { candidates: [] };
  if (typeof input.aiPlanner === "function") {
    try {
      const result = await input.aiPlanner({
        question: input.question,
        periods: input.periods || [],
        candidateBindings: deterministic,
      });
      if (result && typeof result === "object" && !Array.isArray(result)) plannerResult = result;
    } catch {
      warnings.push("AI_PLANNER_FAILED");
    }
  }

  const rawAiCandidates = Array.isArray(plannerResult.candidates) ? plannerResult.candidates : [];
  if (rawAiCandidates.length === 0) {
    await deps.tracker?.event?.("planner_no_match", { candidateCount: deterministic.length });
  }

  const merged = new Map(deterministic.map((item) => [item.bindingId, item]));
  for (const raw of rawAiCandidates) {
    const candidate = safePlannerCandidate(raw, allowed);
    if (candidate) merged.set(candidate.bindingId, candidate);
  }
  const candidates = [...merged.values()];

  await deps.tracker?.event?.("route_candidates", {
    candidateCount: candidates.length,
    conceptCount: concepts.length,
    metadata: { candidates: candidates.map((item) => item.bindingId), concepts },
  });

  if (!candidates.length) {
    return {
      status: "no_match",
      errorCode: "NO_RELEVANT_KPI",
      candidates: [],
      periods: Array.isArray(input.periods) ? input.periods : [],
      suggestions: await suggestionsFor(scope, deps.getDashboardVocabulary),
      warnings,
    };
  }

  return {
    status: "ready",
    errorCode: null,
    candidates,
    periods: Array.isArray(input.periods) ? input.periods : [],
    correlationHints: cleanStrings(plannerResult.correlationHints, 6),
    warnings,
  };
}

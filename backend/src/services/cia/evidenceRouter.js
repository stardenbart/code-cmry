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

function bindingIdentity(kpi, binding) {
  if (binding.bindingId != null && String(binding.bindingId).trim()) return String(binding.bindingId).trim();
  if (binding.bindingKey != null && String(binding.bindingKey).trim()) return String(binding.bindingKey).trim();
  return [kpi.kpiId ?? kpi.slug, binding.dashboardId, binding.semanticModel,
    binding.tableName, binding.measureName]
    .map((item) => String(item ?? "").trim()).join("|");
}

function flattenCandidates(kpis) {
  const flattened = [];
  for (const kpi of Array.isArray(kpis) ? kpis : []) {
    for (const binding of Array.isArray(kpi.bindings) ? kpi.bindings : []) {
      const bindingId = bindingIdentity(kpi, binding);
      if (!bindingId) continue;
      flattened.push({
        bindingId,
        kpiId: kpi.kpiId ?? null,
        slug: kpi.slug || null,
        humanName: kpi.humanName || binding.displayCaption || binding.measureName || "KPI",
        score: Number(kpi.score) || 0,
        dashboardId: binding.dashboardId == null ? null : String(binding.dashboardId),
        dashboardName: binding.dashboardName || null,
        semanticModel: binding.semanticModel || null,
        tableName: binding.tableName || null,
        measureName: binding.measureName || null,
        dimensions: cleanStrings(binding.dimensions, 50),
        periodDefaults: binding.periodDefaults || null,
        origin: "deterministic",
        purpose: "primary",
      });
    }
  }
  return [...new Map(flattened.map((item) => [item.bindingId, item])).values()];
}

function safePlannerCandidate(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const bindingId = String(value.bindingId ?? value.id ?? "").trim();
  const base = allowed.get(bindingId);
  if (!base) return null;
  const dimensionsAllowed = new Map(base.dimensions.map((item) => [item.toLowerCase(), item]));
  const dimensions = cleanStrings(value.dimensions, 6)
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
    allowedDashboardIds: scope.allowedDashboardIds,
    limit: 20,
  });
  const deterministic = flattenCandidates(deterministicKpis);
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
    metadata: { candidates: candidates.map((item) => item.bindingId) },
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

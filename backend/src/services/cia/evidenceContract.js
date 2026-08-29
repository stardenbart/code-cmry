const LIMITS = Object.freeze({ sources: 6, goals: 6, entities: 12, filters: 12, concepts: 12, periods: 6 });

function text(value, max = 160) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function strings(value, limit = 12) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => text(item)).filter(Boolean))]
    .slice(0, limit);
}

function entity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const type = text(value.type, 40);
  const itemValue = text(value.value);
  return type && itemValue ? { type, value: itemValue } : null;
}

function period(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized = {
    label: text(value.label),
    from: text(value.from, 10),
    to: text(value.to, 10),
    grain: text(value.grain, 40),
    comparisonKey: text(value.comparisonKey, 80),
  };
  return normalized.from && normalized.to ? normalized : null;
}

function source(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized = {
    bindingId: text(value.bindingId ?? value.kpiBindingId, 120),
    dashboardId: text(value.dashboardId == null ? "" : String(value.dashboardId), 120),
    reportId: text(value.reportId == null ? "" : String(value.reportId), 120),
    semanticModel: text(value.semanticModel, 160),
    dashboardName: text(value.dashboardName, 160),
    kpis: strings(value.kpis, 12),
  };
  return normalized.bindingId || normalized.dashboardId || normalized.reportId || normalized.semanticModel
    ? normalized : null;
}

function sourceKey(value) {
  return [value.bindingId, value.dashboardId, value.reportId, value.semanticModel].join("|");
}

function filter(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const dimension = text(value.dimension ?? value.field ?? value.column);
  const filterValue = text(value.value);
  return dimension && filterValue ? { dimension, value: filterValue } : null;
}

function normalizeGoals(value) {
  let filtersLeft = LIMITS.filters;
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const kpiBindingId = text(item.kpiBindingId ?? item.bindingId, 120);
    if (!kpiBindingId) return [];
    const filters = (Array.isArray(item.filters) ? item.filters : [])
      .map(filter).filter(Boolean).slice(0, filtersLeft);
    filtersLeft -= filters.length;
    return [{
      kpiBindingId,
      dimensions: strings(item.dimensions?.map?.((dimension) =>
        typeof dimension === "object" ? dimension.humanName ?? dimension.label ?? dimension.column : dimension), 12),
      periodIndex: Number.isInteger(Number(item.periodIndex)) && Number(item.periodIndex) >= 0
        ? Number(item.periodIndex) : 0,
      purpose: text(item.purpose, 40) || "primary",
      filters,
    }];
  }).slice(0, LIMITS.goals);
}

export function createEvidenceContract({ intentFrame = {}, periods = [], goals = [], evidence = [], sources = [] } = {}) {
  const allSources = [
    ...(Array.isArray(sources) ? sources : []),
    ...(Array.isArray(evidence) ? evidence.map((item) => item?.source) : []),
  ].map(source).filter(Boolean);
  const deduplicatedSources = [...new Map(allSources.map((item) => [sourceKey(item), item])).values()]
    .slice(0, LIMITS.sources);

  return {
    concepts: strings(intentFrame.concepts, LIMITS.concepts),
    entities: (Array.isArray(intentFrame.entities) ? intentFrame.entities : [])
      .map(entity).filter(Boolean).slice(0, LIMITS.entities),
    periods: (Array.isArray(periods) ? periods : []).map(period).filter(Boolean).slice(0, LIMITS.periods),
    sources: deduplicatedSources,
    goals: normalizeGoals(goals),
  };
}

export function normalizeEvidenceContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const contract = createEvidenceContract({
    intentFrame: value,
    periods: value.periods,
    goals: value.goals,
    sources: value.sources,
  });
  return contract.concepts.length || contract.entities.length || contract.periods.length
    || contract.sources.length || contract.goals.length ? contract : null;
}

function questionConcepts(question) {
  const value = text(question, 1_000).toLocaleLowerCase("id-ID");
  const concepts = [];
  if (/\bdowntime\b/.test(value)) concepts.push("downtime");
  if (/\b(?:overtime|lembur)\b/.test(value)) concepts.push("overtime");
  if (/\b(?:produksi|production|output)\b/.test(value)) concepts.push("production");
  if (/\b(?:planning|rencana produksi)\b/.test(value)) concepts.push("planning");
  if (/\b(?:purchase order|fulfillment po|total po)\b/.test(value)) concepts.push("purchase order");
  if (/\b(?:deviasi|deviation)\b/.test(value)) concepts.push("deviation");
  return [...new Set(concepts)];
}

function latestContract(conversation) {
  const turns = Array.isArray(conversation) ? conversation : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role !== "assistant") continue;
    const contract = normalizeEvidenceContract(turn.evidenceContract ?? turn.evidence_contract);
    if (contract) return contract;
  }
  return null;
}

export function resolveFollowUpContext({ question, conversation } = {}) {
  const contract = latestContract(conversation);
  const empty = { sources: [], entities: [], periods: [], goals: [], requiredConcepts: [] };
  if (!contract) return empty;

  const currentConcepts = questionConcepts(question);
  const previousConcepts = new Set(contract.concepts);
  const switched = currentConcepts.length > 0 && !currentConcepts.some((item) => previousConcepts.has(item));
  if (switched) return { ...empty, requiredConcepts: currentConcepts };

  const requiredConcepts = [...new Set([...contract.concepts, ...currentConcepts])];
  if (/\b(?:persen|persentase|percentage|used time)\b/i.test(String(question || ""))) {
    requiredConcepts.push("running hours");
  }
  return {
    sources: contract.sources,
    entities: contract.entities,
    periods: contract.periods,
    goals: contract.goals,
    requiredConcepts: [...new Set(requiredConcepts)].slice(0, LIMITS.concepts),
  };
}

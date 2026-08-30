const clean = (value) => typeof value === "string" ? value.trim() : "";
const normalized = (value) => clean(value).toLowerCase().replace(/[_-]+/g, " ");
const MAX_GOALS = 6;
const METRIC_ROLES = new Set(["primary", "numerator", "denominator", "target", "detail", "correlation"]);

const DIMENSION_TERMS = [
  { match: /tanggal|date|hari/, concept: "tanggal" },
  { match: /departemen|department/, concept: "departemen" },
  { match: /alasan|reason|penyebab/, concept: "alasan" },
  { match: /kategori|category/, concept: "kategori" },
  { match: /produk|product/, concept: "produk" },
  { match: /deskripsi|description|issue|masalah/, concept: "deskripsi" },
  { match: /jenis|type/, concept: "jenis" },
];

function dimensionConcept(value) {
  const text = normalized(value);
  return DIMENSION_TERMS.find((item) => item.match.test(text))?.concept || text;
}

function requestedDimensions(question, candidate) {
  const q = normalized(question);
  return (Array.isArray(candidate?.dimensions) ? candidate.dimensions : []).filter((dimension) => {
    const concept = dimensionConcept(typeof dimension === "object"
      ? dimension.humanName ?? dimension.column : dimension);
    const rule = DIMENSION_TERMS.find((item) => item.concept === concept);
    return rule ? rule.match.test(q) : q.includes(concept);
  }).map((dimension) => clean(typeof dimension === "object"
    ? dimension.humanName ?? dimension.column : dimension)).filter(Boolean);
}

function candidateRelevant(question, candidate) {
  const q = normalized(question);
  const identity = normalized(`${candidate?.slug || ""} ${candidate?.humanName || ""} ${(candidate?.synonyms || []).join(" ")}`);
  if (/\b(lembur|overtime)\b/.test(q) && /lembur|overtime/.test(identity)) return true;
  if (/\bpo\b|purchase order/.test(q) && /\bpo\b|purchase order|ppic/.test(identity)) return true;
  if (/quality|kualitas/.test(q) && /quality|kualitas/.test(identity)) return true;
  if (/deviasi/.test(q) && /deviasi|deviation/.test(identity)) return true;
  const specific = identity.split(/\s+/).filter((term) => term.length >= 4);
  return specific.some((term) => q.includes(term));
}

function evidenceBindingId(item) {
  return clean(item?.goal?.kpiBindingId ?? item?.bindingId);
}

function columns(item) {
  return new Set((Array.isArray(item?.columns) ? item.columns : []).map((column) =>
    normalized(typeof column === "string" ? column : column?.label ?? column?.humanName)));
}

function hasDimension(item, dimension) {
  const wanted = dimensionConcept(dimension);
  return [...columns(item)].some((column) => dimensionConcept(column) === wanted);
}

function compatiblePeriod(left, right) {
  return left?.from === right?.from && left?.to === right?.to;
}

function goalKey(goal) {
  return [
    clean(goal?.kpiBindingId),
    Number.isInteger(Number(goal?.periodIndex)) ? Number(goal.periodIndex) : 0,
    metricRole(goal),
    [...new Set((goal?.dimensions || []).map(dimensionConcept))].sort().join("|"),
  ].join("::");
}

function metricRole(value) {
  const explicit = clean(value?.metricRole).toLowerCase();
  if (METRIC_ROLES.has(explicit)) return explicit;
  if (value?.purpose === "correlation") return "correlation";
  const identity = normalized(`${value?.humanName || ""} ${value?.slug || ""} ${value?.blueprint?.role || ""}`);
  if (/running hours|denominator|capacity|kapasitas/.test(identity)) return "denominator";
  if (/target|planning|rencana/.test(identity)) return "target";
  if (/detail|rincian/.test(identity)) return "detail";
  return "primary";
}

function requiredMetricRoles(question) {
  const q = normalized(question);
  if (/persen|persentase|percentage/.test(q) && /downtime/.test(q)) return ["numerator", "denominator"];
  if (/achievement|achivement|capaian/.test(q)) return ["primary", "target"];
  if (/detail|rincian|breakdown/.test(q)) return ["primary", "detail"];
  return [];
}

async function candidatePool(plan, library, question) {
  const candidates = [...(Array.isArray(plan?.candidates) ? plan.candidates : []),
    ...(Array.isArray(library?.candidates) ? library.candidates : [])];
  if (typeof library?.searchKpiCandidates === "function") {
    const found = await library.searchKpiCandidates({ question, limit: 20 });
    candidates.push(...(Array.isArray(found) ? found : []));
  }
  return [...new Map(candidates.filter((item) => clean(item?.bindingId))
    .map((item) => [clean(item.bindingId), item])).values()];
}

export async function analyzeEvidenceGap({ question = "", plan = {}, evidence = [], round = 1, library = {} } = {}) {
  const candidates = await candidatePool(plan, library, question);
  const candidateById = new Map(candidates.map((item) => [clean(item.bindingId), item]));
  const successful = evidence.filter((item) => item?.status === "success" && Array.isArray(item.rows) && item.rows.length);
  const attempted = new Set(evidence.map((item) => goalKey(item?.goal || item)).filter(Boolean));
  const missing = [];
  const warnings = [];
  const desired = [];

  const primaryGoals = (Array.isArray(plan.goals) ? plan.goals : []).filter((goal) => goal.purpose !== "correlation");
  for (const goal of primaryGoals) {
    const hit = successful.find((item) => evidenceBindingId(item) === clean(goal.kpiBindingId)
      && compatiblePeriod(item.period, plan.periods?.[goal.periodIndex || 0]));
    if (!hit) missing.push(`primary:${clean(goal.kpiBindingId)}`);
    for (const dimension of goal.dimensions || []) {
      if (!hit || !hasDimension(hit, dimension)) missing.push(`dimension:${dimensionConcept(dimension)}`);
    }
  }

  const primaryIds = new Set(primaryGoals.map((goal) => clean(goal.kpiBindingId)));
  const asksCorrelation = /\b(karena|penyebab|menyebabkan|memicu|akibat|korelasi|berkorelasi|hubungan|kait\w*|terkait)\b/i
    .test(question);
  const correlationCandidates = asksCorrelation ? candidates.filter((candidate) =>
    !primaryIds.has(clean(candidate.bindingId)) && candidateRelevant(question, candidate)) : [];

  for (const candidate of correlationCandidates) {
    const dimensions = requestedDimensions(question, candidate);
    const expectedPeriod = plan.periods?.[0];
    const hits = successful.filter((item) => evidenceBindingId(item) === clean(candidate.bindingId));
    const compatible = hits.find((item) => compatiblePeriod(item.period, expectedPeriod));
    if (!compatible) {
      missing.push(`correlation:${clean(candidate.slug) || clean(candidate.bindingId)}`);
      if (hits.length) warnings.push("CORRELATION_PERIOD_MISMATCH");
    }
    for (const dimension of dimensions) {
      if (!compatible || !hasDimension(compatible, dimension)) {
        missing.push(`dimension:${dimensionConcept(dimension)}`);
      }
    }
    if (!compatible || dimensions.some((dimension) => !hasDimension(compatible, dimension))) {
      desired.push({
        kpiBindingId: clean(candidate.bindingId),
        periodIndex: 0,
        dimensions,
        purpose: "correlation",
      });
    }
  }

  const successfulRolePeriods = new Set(successful.map((item) => {
    const evidenceGoal = item?.goal || item;
    const planned = (plan.goals || []).find((goal) => clean(goal.kpiBindingId) === evidenceBindingId(item));
    const explicitIndex = Number(evidenceGoal?.periodIndex);
    const periodIndex = Number.isInteger(explicitIndex) && explicitIndex >= 0
      ? explicitIndex
      : Math.max(0, (plan.periods || []).findIndex((period) => compatiblePeriod(item?.period, period)));
    return `${metricRole({ ...planned, ...evidenceGoal })}:${periodIndex}`;
  }));
  const requestedPeriodIndexes = [...new Set(primaryGoals.map((goal) => Number(goal.periodIndex) || 0))];
  for (const periodIndex of requestedPeriodIndexes.length ? requestedPeriodIndexes : [0]) {
    for (const role of requiredMetricRoles(question)) {
      if (successfulRolePeriods.has(`${role}:${periodIndex}`)) continue;
      missing.push(`metric:${role}:period:${periodIndex}`);
      const candidate = candidates.find((item) => Array.isArray(item?.anchorMatches)
        && item.anchorMatches.length > 0 && metricRole(item) === role);
      if (candidate) {
        desired.push({
          kpiBindingId: clean(candidate.bindingId),
          periodIndex,
          dimensions: requestedDimensions(question, candidate),
          purpose: role === "correlation" ? "correlation" : "primary",
          metricRole: role,
        });
      }
    }
  }

  const uniqueMissing = [...new Set(missing)];
  let additionalGoals = [...new Map(desired.map((goal) => [goalKey(goal), goal])).values()]
    .filter((goal) => !attempted.has(goalKey(goal)));
  const goalCount = new Set([...(plan.goals || []), ...evidence.map((item) => item?.goal || item)]
    .map(goalKey).filter(Boolean)).size;
  additionalGoals = additionalGoals.slice(0, Math.max(0, MAX_GOALS - goalCount));

  if (round >= 4 && uniqueMissing.length) {
    additionalGoals = [];
    warnings.push("MAX_RETRIEVAL_ROUNDS_REACHED");
  } else if (uniqueMissing.length && !additionalGoals.length) {
    warnings.push("EVIDENCE_GAP_UNRESOLVED");
  }

  return {
    complete: uniqueMissing.length === 0,
    missing: uniqueMissing,
    additionalGoals,
    warnings: [...new Set(warnings)],
    candidatesConsidered: candidateById.size,
  };
}


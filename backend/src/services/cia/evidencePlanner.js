import { tanyaModelTerstruktur } from "../modelRouter.js";
import { getSanitizer } from "../aiSanitizer.js";
import { resolveFollowUpContext } from "./evidenceContract.js";
import {
  buildVisualBlueprint, filtersForBindingAssociation, resolveFilterPolicy,
} from "./visualBlueprint.js";

const MAX_GOALS = 6;
const MAX_DIMENSIONS = 6;
const MAX_TEXT = 100;
const METRIC_ROLES = new Set(["primary", "numerator", "denominator", "target", "detail", "correlation"]);

function cleanText(value, limit = MAX_TEXT) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function dimensionName(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return cleanText(value.humanName ?? value.displayCaption ?? value.label ?? value.column ?? value.columnName);
  }
  return cleanText(value);
}

function parseStrictJson(text) {
  const trimmed = cleanText(text, 50_000);
  if (!trimmed) return { error: "PLANNER_EMPTY" };
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1] || trimmed;
  try {
    const value = JSON.parse(unfenced);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "PLANNER_INVALID_JSON" };
    }
    return { value };
  } catch {
    return { error: "PLANNER_INVALID_JSON" };
  }
}

function allowedBindings(candidateBindings) {
  const allowed = new Map();
  for (const binding of Array.isArray(candidateBindings) ? candidateBindings : []) {
    const bindingId = cleanText(String(binding?.bindingId ?? ""));
    if (!bindingId) continue;
    const blueprint = binding.blueprint || buildVisualBlueprint(binding);
    allowed.set(bindingId, {
      ...binding,
      bindingId,
      blueprint,
      dimensions: Array.isArray(blueprint.dimensions)
        ? blueprint.dimensions.map(dimensionName).filter(Boolean)
        : [],
    });
  }
  return allowed;
}

function filtersForBinding(value, binding) {
  const dimensionsByKey = new Map();
  for (const raw of binding.blueprint?.dimensions || []) {
    const label = dimensionName(raw);
    if (!label) continue;
    const aliases = raw && typeof raw === "object" && !Array.isArray(raw)
      ? [label, raw.column, raw.columnName,
        raw.table && raw.column ? `${raw.table}[${raw.column}]` : "",
        raw.table && raw.column ? `${raw.table}.${raw.column}` : ""]
      : [label, raw];
    for (const alias of aliases) {
      const normalized = cleanText(alias).toLowerCase();
      if (normalized) dimensionsByKey.set(normalized, label);
    }
  }
  const admittedDimensions = new Set();
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const dimension = dimensionsByKey.get(cleanText(item.dimension ?? item.field ?? item.column).toLowerCase());
    const filterValue = cleanText(item.value, 160);
    return dimension && filterValue ? [{ dimension, value: filterValue }] : [];
  }).filter((filter) => {
    const dimension = filter.dimension.toLowerCase();
    if (admittedDimensions.has(dimension)) return true;
    if (admittedDimensions.size >= MAX_DIMENSIONS) return false;
    admittedDimensions.add(dimension);
    return true;
  });
}

function normalizeGoals(value, candidates, periodCount, input, followUp) {
  const goals = [];
  const seen = new Set();
  for (const item of Array.isArray(value) ? value : []) {
    if (goals.length >= MAX_GOALS || !item || typeof item !== "object") continue;
    const kpiBindingId = cleanText(String(item.kpiBindingId ?? ""));
    const binding = candidates.get(kpiBindingId);
    const periodIndex = Number(item.periodIndex);
    if (!binding || !Number.isInteger(periodIndex) || periodIndex < 0 || periodIndex >= periodCount) continue;
    const dimensionsByKey = new Map(binding.dimensions.map((name) => [name.toLowerCase(), name]));
    const dimensions = [...new Set((Array.isArray(item.dimensions) ? item.dimensions : [])
      .map((name) => dimensionsByKey.get(cleanText(name).toLowerCase()))
      .filter(Boolean))].slice(0, MAX_DIMENSIONS);
    const purpose = item.purpose === "correlation" ? "correlation" : "primary";
    const requestedRole = cleanText(item.metricRole).toLowerCase();
    const metricRole = purpose === "correlation" ? "correlation"
      : METRIC_ROLES.has(requestedRole) ? requestedRole : "primary";
    const contextFilters = [
      ...(Array.isArray(input.contextFilters) ? input.contextFilters : []),
      ...(followUp.goals || []).filter((goal) => String(goal.kpiBindingId) === kpiBindingId)
        .flatMap((goal) => goal.filters || []),
    ];
    const reportFilters = [
      ...(Array.isArray(input.reportFilters) ? input.reportFilters : []),
      ...(Array.isArray(binding.reportFilters) ? binding.reportFilters : []),
    ];
    const filterPolicy = {
      explicitFilters: filtersForBinding(item.filters, binding),
      contextFilters: filtersForBinding(filtersForBindingAssociation(contextFilters, binding), binding),
      reportFilters: filtersForBinding(filtersForBindingAssociation(reportFilters, binding), binding),
    };
    const policy = resolveFilterPolicy({
      question: input.question,
      blueprint: binding.blueprint,
      ...filterPolicy,
    });
    const goalKey = `${kpiBindingId}|${periodIndex}|${purpose}|${metricRole}|${dimensions.join("|")}|${JSON.stringify(policy.filters)}`;
    if (seen.has(goalKey)) continue;
    seen.add(goalKey);
    goals.push({ kpiBindingId, dimensions, periodIndex, purpose, metricRole, filters: policy.filters, filterPolicy });
  }
  return goals;
}

function normalizeSignals(value) {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const concept = cleanText(item.concept);
    const reason = cleanText(item.reason);
    return concept ? [{ concept, reason }] : [];
  }).slice(0, MAX_GOALS);
}

function safeResult(warning, metadata = {}) {
  return {
    goals: [], followUpSignals: [], warnings: warning ? [warning] : [],
    usage: metadata.usage || null, provider: metadata.provider || null, model: metadata.model || null,
  };
}

function planningPrompt({ question, periods, candidateBindings, conversation }, sanitizer) {
  const packet = {
    question: cleanText(question, 1_000),
    periods: (Array.isArray(periods) ? periods : []).slice(0, 6),
    candidates: (Array.isArray(candidateBindings) ? candidateBindings : []).slice(0, 30).map((item) => ({
      bindingId: cleanText(String(item.bindingId ?? "")),
      kpi: cleanText(item.humanName),
      dashboardId: cleanText(String(item.dashboardId ?? "")),
      blueprint: {
        measures: (Array.isArray(item.blueprint?.measures) ? item.blueprint.measures : []).slice(0, 6),
        dimensions: (Array.isArray(item.blueprint?.dimensions) ? item.blueprint.dimensions : []).slice(0, 20),
        role: cleanText(item.blueprint?.role),
        periodPolicy: item.blueprint?.periodPolicy || null,
        labels: item.blueprint?.labels || null,
      },
    })),
    conversation: (Array.isArray(conversation) ? conversation : []).slice(-6).map((turn) => ({
      role: turn?.role === "assistant" ? "assistant" : "user",
      text: cleanText(turn?.text, 500),
    })),
  };
  return sanitizer.sanitizeText(JSON.stringify(packet));
}

export async function planEvidence(input = {}, injected = {}) {
  const callModel = injected.callModel || tanyaModelTerstruktur;
  const sanitizer = injected.sanitizer || getSanitizer();
  const candidates = allowedBindings(input.candidateBindings);
  const periods = Array.isArray(input.periods) && input.periods.length ? input.periods : [{}];
  const followUp = resolveFollowUpContext({ question: input.question, conversation: input.conversation });
  let response;
  try {
    response = await callModel({
      ...(input.modelOptions || {}),
      systemInstruction: "Kembalikan JSON saja: {goals:[{kpiBindingId,dimensions,filters:[{dimension,value}],periodIndex,purpose,metricRole}],followUpSignals:[{concept,reason}]}. metricRole hanya primary, numerator, denominator, target, detail, atau correlation. Gunakan hanya bindingId dan dimensi dari blueprint kandidat.",
      question: planningPrompt({ ...input, periods, candidateBindings: [...candidates.values()] }, sanitizer),
      maxOutputTokens: 1_000,
    });
  } catch (error) {
    const timeout = error?.code === "ETIMEDOUT" || error?.code === "ECONNABORTED"
      || /timeout/i.test(String(error?.message || ""));
    return safeResult(timeout ? "PLANNER_TIMEOUT" : "PLANNER_FAILED");
  }

  const metadata = {
    usage: response?.usage || null,
    provider: response?.provider || null,
    model: response?.model || null,
  };
  const parsed = parseStrictJson(response?.text);
  if (parsed.error) return safeResult(parsed.error, metadata);

  return {
    goals: normalizeGoals(parsed.value.goals, candidates, periods.length, input, followUp),
    followUpSignals: normalizeSignals(parsed.value.followUpSignals),
    warnings: [],
    ...metadata,
  };
}

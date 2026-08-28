import { tanyaModelTerstruktur } from "../modelRouter.js";

const MAX_GOALS = 6;
const MAX_DIMENSIONS = 6;
const MAX_TEXT = 100;

function cleanText(value, limit = MAX_TEXT) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
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
    allowed.set(bindingId, {
      ...binding,
      bindingId,
      dimensions: Array.isArray(binding.dimensions)
        ? binding.dimensions.map((item) => cleanText(item)).filter(Boolean)
        : [],
    });
  }
  return allowed;
}

function normalizeGoals(value, candidates, periodCount) {
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
    const key = `${kpiBindingId}|${periodIndex}|${purpose}|${dimensions.join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    goals.push({ kpiBindingId, dimensions, periodIndex, purpose });
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

function planningPrompt({ question, periods, candidateBindings, conversation }) {
  return JSON.stringify({
    question: cleanText(question, 1_000),
    periods: (Array.isArray(periods) ? periods : []).slice(0, 6),
    candidates: (Array.isArray(candidateBindings) ? candidateBindings : []).slice(0, 30).map((item) => ({
      bindingId: cleanText(String(item.bindingId ?? "")),
      kpi: cleanText(item.humanName),
      dashboardId: cleanText(String(item.dashboardId ?? "")),
      dimensions: (Array.isArray(item.dimensions) ? item.dimensions : []).slice(0, 20),
    })),
    conversation: (Array.isArray(conversation) ? conversation : []).slice(-6).map((turn) => ({
      role: turn?.role === "assistant" ? "assistant" : "user",
      text: cleanText(turn?.text, 500),
    })),
  });
}

export async function planEvidence(input = {}, injected = {}) {
  const callModel = injected.callModel || tanyaModelTerstruktur;
  const candidates = allowedBindings(input.candidateBindings);
  const periods = Array.isArray(input.periods) && input.periods.length ? input.periods : [{}];
  let response;
  try {
    response = await callModel({
      ...(input.modelOptions || {}),
      systemInstruction: "Kembalikan JSON saja: {goals:[{kpiBindingId,dimensions,periodIndex,purpose}],followUpSignals:[{concept,reason}]}. Gunakan hanya bindingId dan dimensi dari kandidat.",
      question: planningPrompt({ ...input, periods }),
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
    goals: normalizeGoals(parsed.value.goals, candidates, periods.length),
    followUpSignals: normalizeSignals(parsed.value.followUpSignals),
    warnings: [],
    ...metadata,
  };
}


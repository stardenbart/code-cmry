// CIA Evidence Orchestrator — pipeline bukti bersama untuk dashboard CIA,
// Multi-Chat, dan (kelak) WhatsApp/schedule.
//
// Alur: normalize -> satu telemetry tracker (satu requestId) -> resolve scope
// (ACL, server-derived) -> resolve periode dari PERTANYAAN (bukan filter report)
// -> deterministic router -> structured planner (goals) -> validated DAX plans
// -> execute (1 repair/plan) -> gap analysis -> tarik dashboard tambahan
// (maks 4 ronde) -> synthesis bersitasi -> normalizeAnswer -> finish telemetry.
//
// Prinsip yang tidak boleh melar:
//  - kandidat deterministic tidak dibuang walau planner AI kosong;
//  - maksimum 4 ronde retrieval; maksimum 1 repair DAX per plan (dijaga executor);
//  - kegagalan dependency TIDAK PERNAH menghasilkan jawaban kosong — fallback
//    snapshot/keterbatasan yang transparan;
//  - telemetry tidak menyimpan prompt penuh, row mentah, token/credential, QR,
//    Authorization header, atau objek Axios (event hanya membawa count/id/period).
import { normalizeEnvelope, normalizeAnswer } from "./contracts.js";
import { getSanitizer } from "../aiSanitizer.js";
import { startCiaTelemetry, safeError } from "../ciaTelemetry.service.js";
import { resolveEvidenceScope } from "./accessScope.js";
import { resolvePeriods } from "./periodResolver.js";
import { buildIntentFrame } from "./intentFrame.js";
import { createEvidenceContract } from "./evidenceContract.js";
import { routeEvidence } from "./evidenceRouter.js";
import { planEvidence } from "./evidencePlanner.js";
import { buildDaxPlan } from "./daxPlanBuilder.js";
import { filtersForBindingAssociation } from "./visualBlueprint.js";
import { executeEvidencePlan } from "./daxEvidenceExecutor.js";
import { analyzeEvidenceGap } from "./evidenceGapAnalyzer.js";
import { synthesizeEvidence } from "./evidenceSynthesizer.js";
import { skemaModel } from "../powerbiMeta.service.js";
import { getIntentVocabulary } from "../ciaKpiLibrary.service.js";

const INTERNAL_SURFACES = new Set(["whatsapp", "schedule"]);

function maxRounds() {
  const n = Number(process.env.CIA_MAX_RETRIEVAL_ROUNDS);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 4) : 4;
}
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
function usageIn(u) { return num(u?.inputTokens ?? u?.promptTokenCount); }
function usageOut(u) { return num(u?.outputTokens ?? u?.candidatesTokenCount); }

function dimLabel(item) {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return String(item.humanName || item.column || item.label || "").trim();
  }
  return String(item ?? "").trim();
}
function goalShapeKey(goal) {
  const dims = [...new Set((goal?.dimensions || []).map((d) => dimLabel(d).toLowerCase()))].sort().join("|");
  const period = Number.isInteger(Number(goal?.periodIndex)) ? Number(goal.periodIndex) : 0;
  return `${String(goal?.kpiBindingId ?? "").trim()}::${period}::${dims}`;
}

function normalizedText(value) {
  return String(value ?? "").normalize("NFKD").toLocaleLowerCase("id-ID")
    .replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function entityValueMatches(left, right) {
  const tokens = (value) => normalizedText(value)
    .replace(/([\p{L}])(\d)/gu, "$1 $2").replace(/(\d)([\p{L}])/gu, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  const actual = tokens(left);
  const wanted = tokens(right);
  const contains = (values, subset) => subset.length > 0 && values.some((_, index) =>
    subset.every((token, offset) => values[index + offset] === token));
  return contains(actual, wanted) || contains(wanted, actual);
}

function compatiblePeriod(left, right) {
  return Boolean(left?.from && left?.to && right?.from && right?.to
    && left.from === right.from && left.to === right.to);
}

function sourceMatches(source, binding, constraints) {
  const expectedDashboard = binding?.dashboardId == null ? "" : String(binding.dashboardId);
  const actualDashboard = source?.dashboardId == null ? "" : String(source.dashboardId);
  if (expectedDashboard && actualDashboard && expectedDashboard !== actualDashboard) return false;
  const requested = Array.isArray(constraints) ? constraints : [];
  if (!requested.length) return true;
  const labels = [source?.dashboardId, source?.dashboardName, source?.reportId, source?.semanticModel]
    .map(normalizedText).filter(Boolean);
  return requested.some((constraint) => {
    const value = normalizedText(constraint?.value);
    return value && labels.some((label) => label === value || label.includes(value) || value.includes(label));
  });
}

const ENTITY_COLUMNS = {
  machine: /machine|mesin/i,
  cmd: /cmd|gedung/i,
  product: /product|produk/i,
  plant: /plant/i,
};

function entitiesMatch(entities, result, goal) {
  const requested = Array.isArray(entities) ? entities : [];
  if (!requested.length) return true;
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const filters = Array.isArray(goal?.filters) ? goal.filters : [];
  return requested.every((entity) => {
    const wanted = normalizedText(entity?.value);
    if (!wanted) return true;
    const columnPattern = ENTITY_COLUMNS[entity?.type];
    if (!columnPattern) return true;
    const rowValues = rows.flatMap((row) => Object.entries(row || {})
      .filter(([label]) => columnPattern.test(label)).map(([, value]) => normalizedText(value)));
    if (rowValues.length) return rowValues.some((value) => entityValueMatches(value, wanted));
    return filters.some((filter) => entityValueMatches(filter?.value, wanted));
  });
}

function intentMatch({ intentFrame, period, binding, goal, result, source }) {
  const concepts = Array.isArray(intentFrame?.concepts) ? intentFrame.concepts.map(normalizedText) : [];
  const anchors = Array.isArray(binding?.anchorMatches) ? binding.anchorMatches.map(normalizedText) : [];
  return {
    concepts: !concepts.length || !anchors.length || anchors.some((anchor) => concepts.includes(anchor)),
    entities: entitiesMatch(intentFrame?.entities, result, goal),
    period: compatiblePeriod(result?.period, period),
    source: sourceMatches(source, binding, intentFrame?.sourceConstraints),
  };
}
function goalKey(goal) {
  const filters = (Array.isArray(goal?.filters) ? goal.filters : []).map((filter) =>
    `${String(filter?.dimension ?? "").trim().toLowerCase()}=${String(filter?.value ?? "").trim().toLowerCase()}`)
    .filter((value) => value !== "=").sort().join("|");
  return `${goalShapeKey(goal)}::${filters}`;
}

function entityFilters(entities, binding) {
  const dimensions = Array.isArray(binding?.dimensions) ? binding.dimensions : [];
  return (Array.isArray(entities) ? entities : []).flatMap((entity) => {
    const pattern = ENTITY_COLUMNS[entity?.type];
    if (!pattern) return [];
    const dimension = dimensions.find((item) => {
      const label = dimLabel(item);
      const column = String(item?.column ?? item?.kolom ?? "");
      return pattern.test(`${label} ${column}`);
    });
    if (!dimension) return [];
    const rawValue = String(entity?.value ?? "").trim();
    if (!rawValue) return [];
    const value = entity.type === "cmd"
      ? rawValue.replace(/^cmd\s*[-_]?\s*/i, "CMD")
      : rawValue;
    return [{ dimension: dimLabel(dimension), value }];
  });
}

function bestCandidates(candidates, limit = 3) {
  const all = Array.isArray(candidates) ? candidates : [];
  const bestPriority = Math.max(...all.map((candidate) => Number(candidate.sourcePriority) || 0), 0);
  const prioritized = all.filter((candidate) => (Number(candidate.sourcePriority) || 0) === bestPriority);
  const bestScore = Math.max(...prioritized.map((candidate) => Number(candidate.score) || 0), 0);
  return prioritized.filter((candidate) => (Number(candidate.score) || 0) === bestScore).slice(0, limit);
}

function bestRankingCandidatesBySource(candidates) {
  const all = Array.isArray(candidates) ? candidates : [];
  const sourceKey = (candidate) => candidate.dashboardId != null ? `dashboard:${candidate.dashboardId}`
    : candidate.reportId ? `report:${candidate.reportId}`
      : candidate.semanticModel ? `model:${candidate.semanticModel}` : `binding:${candidate.bindingId}`;
  const bestScores = new Map();
  for (const candidate of all) {
    const key = sourceKey(candidate);
    bestScores.set(key, Math.max(bestScores.get(key) ?? 0, Number(candidate.score) || 0));
  }
  return all.filter((candidate) => (Number(candidate.score) || 0) === bestScores.get(sourceKey(candidate)));
}

// Fallback goals ketika planner AI kosong/gagal: pakai kandidat deterministic
// teratas apa adanya, meminta seluruh dimensi binding (dibatasi builder).
function inferredMetricRole(candidate, intentFrame, question) {
  const explicit = String(candidate?.metricRole || candidate?.blueprint?.metricRole || "").toLowerCase();
  if (["primary", "numerator", "denominator", "target"].includes(explicit)) return explicit;
  const operations = new Set(intentFrame?.operations || []);
  const composite = (intentFrame?.concepts || []).length > 1
    && (operations.has("calculation") || operations.has("comparison"))
    || /\b(?:persen|persentase|ratio|achievement|achivement|dibanding|terhadap|versus|vs)\b/i
      .test(String(question || ""));
  if (!composite) return "primary";
  const label = [candidate?.slug, candidate?.humanName, candidate?.measureName,
    candidate?.displayCaption, candidate?.visualTitle,
    candidate?.blueprint?.labels?.displayCaption, candidate?.blueprint?.labels?.visualTitle]
    .map(normalizedText).filter(Boolean).join(" ");
  if (/\b(?:running hours?|used time|operating hours?|available hours?)\b/.test(label)) return "denominator";
  if (/\b(?:target|purchase order|total po|planning|rencana|plan)\b/.test(label)) return "target";
  if (/\b(?:downtime|loss|deviation|deviasi|reject|defect)\b/.test(label)) return "numerator";
  return "primary";
}

function deterministicCandidates(candidates, intentFrame, question) {
  const primary = bestCandidates(candidates);
  const operations = new Set(intentFrame?.operations || []);
  const wantsComposite = (intentFrame?.concepts || []).length > 1
    && (operations.has("calculation") || operations.has("comparison"));
  if (!wantsComposite) return primary;
  const all = Array.isArray(candidates) ? candidates : [];
  const bestPriority = Math.max(...all.map((candidate) => Number(candidate.sourcePriority) || 0), 0);
  const byRole = new Map();
  for (const candidate of all.filter((item) => (Number(item.sourcePriority) || 0) === bestPriority)) {
    const role = inferredMetricRole(candidate, intentFrame, question);
    const current = byRole.get(role);
    if (!current || (Number(candidate.score) || 0) > (Number(current.score) || 0)) byRole.set(role, candidate);
  }
  const combined = new Map(primary.map((candidate) => [String(candidate.bindingId), candidate]));
  for (const candidate of byRole.values()) combined.set(String(candidate.bindingId), candidate);
  return [...combined.values()].slice(0, 3);
}

function deterministicGoals(candidates, periods, intentFrame, question, limit = 6) {
  const goals = [];
  const primary = deterministicCandidates(candidates, intentFrame, question);
  for (const candidate of primary) {
    const count = Math.max(1, Math.min(Array.isArray(periods) ? periods.length : 1, 6));
    for (let periodIndex = 0; periodIndex < count && goals.length < limit; periodIndex += 1) {
      goals.push({
        kpiBindingId: String(candidate.bindingId),
        dimensions: (Array.isArray(candidate.dimensions) ? candidate.dimensions : [])
          .map(dimLabel).filter(Boolean).slice(0, 6),
        periodIndex,
        purpose: "primary",
        metricRole: inferredMetricRole(candidate, intentFrame, question),
      });
    }
  }
  return goals;
}

function sourceFrom(plan) {
  return {
    dashboardId: plan?.dashboardId == null ? null : String(plan.dashboardId),
    dashboardName: plan?.dashboardName || null,
    semanticModel: plan?.semanticModel || null,
    kpis: (plan?.selectedKpis || []).map((k) => k.humanName).filter(Boolean),
  };
}

function statusFor(answer) {
  if (answer.retrievalMethod === "none") return "error";
  if (answer.retrievalMethod === "snapshot" || answer.retrievalMethod === "mixed") return "partial";
  return "success";
}

const DEFAULTS = {
  normalizeEnvelope, normalizeAnswer, startCiaTelemetry, safeError,
  resolveEvidenceScope, buildIntentFrame, getIntentVocabulary, resolvePeriods, routeEvidence, planEvidence,
  buildDaxPlan, executeEvidencePlan, analyzeEvidenceGap, synthesizeEvidence,
  getSchema: (semanticModel) => skemaModel(semanticModel),
  now: () => new Date(),
  timezone: "Asia/Jakarta",
};

export async function answerWithEvidence(rawEnvelope = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const allowCentralized = INTERNAL_SURFACES.has(rawEnvelope?.surface);
  const env = d.normalizeEnvelope(rawEnvelope, { allowCentralized });
  const sanitizer = deps.sanitizer || deps.synthDeps?.sanitizer
    || deps.plannerDeps?.sanitizer || getSanitizer();

  const tracker = deps.tracker || await d.startCiaTelemetry({
    requestId: env.requestId, surface: env.surface, user: env.actor,
    question: env.question, conversationId: env.conversationId,
  }, deps.telemetryStore);

  const warnings = [];
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const addUsage = (u) => {
    usage.inputTokens += usageIn(u);
    usage.outputTokens += usageOut(u);
    usage.totalTokens = usage.inputTokens + usage.outputTokens;
  };
  let rounds = 0;

  const settle = async (partial, status) => {
    const answer = d.normalizeAnswer({ ...partial, requestId: env.requestId, warnings, usage, rounds });
    try {
      await tracker.event("response_sent", {
        status: status === "error" ? "error" : "success",
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
      });
      await tracker.finish({
        status, retrievalMethod: answer.retrievalMethod,
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
        retrievalRounds: answer.rounds,
      });
    } catch { /* telemetry best-effort: tidak boleh mematahkan jawaban */ }
    return answer;
  };

  try {
    // 1. Scope (server-derived; body user tidak bisa mengaktifkan centralized).
    const scope = await d.resolveEvidenceScope({
      surface: env.surface, actor: env.actor, accessMode: env.accessMode,
      trustedInternal: INTERNAL_SURFACES.has(env.surface),
      preferredDashboardIds: env.preferredDashboardIds,
    }, deps.scopeDeps);
    await tracker.event("scope_resolved", {
      metadata: {
        mode: scope.mode, dashboards: scope.allowedDashboardIds,
        deniedPreferred: (scope.deniedPreferredDashboardIds || []).length,
      },
    });
    if (scope.denied) {
      warnings.push("ACCESS_DENIED");
      return await settle({
        answer: "Kamu belum memiliki akses ke dashboard yang relevan untuk pertanyaan ini. Hubungi admin untuk membuka akses.",
        confidence: "low", retrievalMethod: "none", sources: [],
      }, "error");
    }

    // 2. Intent bisnis dibangun sekali dan dipakai bersama oleh seluruh routing.
    let vocabulary = deps.intentFrameDeps?.vocabulary;
    if (!vocabulary && (d.buildIntentFrame === buildIntentFrame || deps.getIntentVocabulary)) {
      try {
        vocabulary = await d.getIntentVocabulary(scope.allowedDashboardIds);
      } catch {
        vocabulary = null;
      }
    }
    const intentFrame = d.buildIntentFrame({
      question: env.question,
      conversation: env.conversation,
      preferredDashboardIds: scope.preferredDashboardIds,
    }, { ...deps.intentFrameDeps, vocabulary, sanitizer });
    const allowedDashboards = new Set((scope.allowedDashboardIds || []).map(String));
    const contextSources = (intentFrame.contextSources || intentFrame.context?.sources || [])
      .filter((source) => source?.dashboardId != null && allowedDashboards.has(String(source.dashboardId)));
    intentFrame.contextSources = contextSources;
    intentFrame.context = { ...(intentFrame.context || {}), sources: contextSources };

    // 3. Periode dari pertanyaan (bukan filter report).
    const inheritedPeriods = Array.isArray(intentFrame.contextPeriods) ? intentFrame.contextPeriods : [];
    const periods = !intentFrame.periodKinds?.length && inheritedPeriods.length
      ? inheritedPeriods
      : d.resolvePeriods(env.question, d.now(), d.timezone);
    for (const p of periods) if (Array.isArray(p.warnings)) warnings.push(...p.warnings);

    // 4. Router deterministic (planner AI opsional; tidak boleh membuang kandidat).
    const route = await d.routeEvidence(
      { question: env.question, modelQuestion: sanitizer.sanitizeText(env.question),
        intentFrame, periods, scope, aiPlanner: deps.routerAiPlanner },
      { ...deps.routerDeps, tracker },
    );
    if (Array.isArray(route.warnings)) warnings.push(...route.warnings);

    const bindingIndex = new Map((route.candidates || []).map((c) => [String(c.bindingId), c]));
    const evidence = [];
    const executedGoals = [];
    const seenGoals = new Set();

    if (route.status !== "ready" || !route.candidates?.length) {
      if (route.status === "access_denied") {
        warnings.push("ACCESS_DENIED");
        return await settle({
          answer: "Kamu belum memiliki akses ke dashboard yang relevan untuk pertanyaan ini.",
          confidence: "low", retrievalMethod: "none", sources: [],
        }, "error");
      }
      warnings.push("NO_RELEVANT_KPI");
    } else {
      // 4. Structured planner -> goals (fallback deterministic bila kosong).
      let plan = { goals: [], warnings: [] };
      const reportFilters = Array.isArray(env.snapshotFallback?.reportFilters)
        ? env.snapshotFallback.reportFilters : [];
      try {
        plan = await d.planEvidence(
          { question: env.question, periods, candidateBindings: route.candidates,
            conversation: env.conversation, reportFilters },
          { ...deps.plannerDeps, sanitizer },
        ) || plan;
      } catch (err) {
        warnings.push("PLANNER_FAILED");
        plan = { goals: [], warnings: [] };
      }
      addUsage(plan.usage);
      if (Array.isArray(plan.warnings)) warnings.push(...plan.warnings);
      if (plan.error) warnings.push(plan.error);
      await tracker.event("ai_plan", {
        provider: plan.provider || null, aiModel: plan.model || null,
        inputTokens: usageIn(plan.usage), outputTokens: usageOut(plan.usage),
        metadata: { goals: (plan.goals || []).length },
      });

      const fallbackGoals = deterministicGoals(route.candidates, periods, intentFrame, env.question);
      let plannedGoals = Array.isArray(plan.goals) ? [...plan.goals] : [];
      const rankingQuestion = /\b(top\s+\d+|tertinggi|terendah|paling\s+(?:tinggi|rendah)|terbesar|terkecil)\b/i
        .test(env.question);
      if (rankingQuestion && route.candidates.length) {
        const rankingIds = new Set(bestRankingCandidatesBySource(route.candidates)
          .map((candidate) => String(candidate.bindingId)));
        plannedGoals = plannedGoals.filter((goal) => rankingIds.has(String(goal.kpiBindingId)));
      }
      plannedGoals.sort((left, right) =>
        (Number(bindingIndex.get(String(right.kpiBindingId))?.sourcePriority) || 0)
        - (Number(bindingIndex.get(String(left.kpiBindingId))?.sourcePriority) || 0));
      let goals = fallbackGoals;
      if (plannedGoals.length) {
        const plannedKeys = new Set(plannedGoals.map(goalShapeKey));
        const bestIds = new Set(fallbackGoals.map((goal) => String(goal.kpiBindingId)));
        const selectedBestIds = new Set(plannedGoals
          .map((goal) => String(goal.kpiBindingId)).filter((id) => bestIds.has(id)));
        const recoveryBinding = selectedBestIds.size
          ? selectedBestIds
          : new Set(fallbackGoals.length ? [String(fallbackGoals[0].kpiBindingId)] : []);
        const recoveryGoals = fallbackGoals.filter((goal) => recoveryBinding.has(String(goal.kpiBindingId))
          && !plannedKeys.has(goalShapeKey(goal)));
        goals = [...plannedGoals, ...recoveryGoals].slice(0, 6);
      }

      // 5-10. Bounded retrieval loop.
      const limit = maxRounds();
      for (rounds = 1; rounds <= limit; rounds += 1) {
        const roundResults = [];
        for (const goal of goals) {
          const gk = goalKey(goal);
          if (seenGoals.has(gk)) continue;
          seenGoals.add(gk);
          const binding = bindingIndex.get(String(goal.kpiBindingId));
          if (!binding) { warnings.push("GOAL_BINDING_UNKNOWN"); continue; }
          const period = periods[goal.periodIndex] || periods[0] || {};
          const explicitFilters = entityFilters(intentFrame.entities, binding);
          let effectiveGoal = goal;

          let daxPlan;
          try {
            const schema = await d.getSchema(binding.semanticModel, binding);
            const contextFilters = (intentFrame.context?.goals || [])
              .filter((item) => String(item?.kpiBindingId) === String(goal.kpiBindingId))
              .flatMap((item) => item?.filters || []);
            daxPlan = d.buildDaxPlan({
              question: env.question, goal, binding, period, schema, explicitFilters,
              contextFilters: filtersForBindingAssociation(contextFilters, binding),
              reportFilters: filtersForBindingAssociation(reportFilters, binding),
            });
            effectiveGoal = {
              ...goal,
              filters: Array.isArray(daxPlan.selectedFilters)
                ? daxPlan.selectedFilters.map((filter) => ({
                    dimension: filter.humanName || filter.column,
                    value: filter.value,
                  }))
                : [...explicitFilters, ...(Array.isArray(goal.filters) ? goal.filters : [])],
            };
            executedGoals.push(effectiveGoal);
          } catch (err) {
            // Typed planning failure (mis. DATE_COLUMN_NOT_ALLOWED / schema
            // unavailable): jangan mengarang, catat & lanjut → fallback transparan.
            warnings.push(`PLAN_${err?.code || "FAILED"}`);
            continue;
          }

          const result = await d.executeEvidencePlan(daxPlan, { ...deps.executorDeps, tracker });
          addUsage(result?.usage);
          const source = result?.source || sourceFrom(daxPlan);
          const match = intentMatch({ intentFrame, period, binding, goal: effectiveGoal, result, source });
          if (Object.values(match).some((matched) => matched === false)) seenGoals.delete(gk);
          roundResults.push({
            ...result,
            goal: effectiveGoal,
            source,
            intentMatch: match,
          });
        }
        evidence.push(...roundResults);

        const gap = await d.analyzeEvidenceGap({
          question: env.question,
          plan: { goals, periods, candidates: route.candidates, operations: intentFrame.operations },
          evidence, round: rounds, library: { candidates: route.candidates },
        });
        if (Array.isArray(gap.warnings)) warnings.push(...gap.warnings);
        await tracker.event("evidence_gap", {
          metadata: { complete: gap.complete, missing: gap.missing, round: rounds },
        });
        if (gap.complete || !gap.additionalGoals?.length) break;
        goals = gap.additionalGoals;
      }
      if (rounds > limit) rounds = limit;
    }

    // 11. Synthesis bersitasi + confidence + fallback snapshot transparan.
    const hasLive = evidence.some((e) => e?.status === "success" && Array.isArray(e.rows) && e.rows.length);
    let synth;
    try {
      synth = await d.synthesizeEvidence(
        { question: env.question, intentFrame, evidence, warnings, snapshotFallback: env.snapshotFallback },
        { ...deps.synthDeps, sanitizer },
      );
    } catch (err) {
      warnings.push("SYNTHESIS_FAILED");
      synth = {
        answer: env.snapshotFallback
          ? "Data live belum tersedia; CIA memakai ringkasan snapshot sebagai gambaran sementara."
          : "Bukti data yang diperlukan belum tersedia, jadi CIA belum dapat memberikan analisis yang dapat dipertanggungjawabkan.",
        confidence: "low", retrievalMethod: env.snapshotFallback ? "snapshot" : "none",
        sources: [], warnings: [], usage: null,
      };
    }
    addUsage(synth.usage);
    if (synth.retrievalMethod === "snapshot" || synth.retrievalMethod === "mixed") {
      await tracker.event("snapshot_fallback", {
        metadata: { reason: hasLive ? "partial_live" : "no_live_evidence" },
      });
    }
    await tracker.event("ai_synthesis", {
      provider: synth.provider || null, aiModel: synth.model || null,
      inputTokens: usageIn(synth.usage), outputTokens: usageOut(synth.usage),
    });
    if (Array.isArray(synth.warnings)) warnings.push(...synth.warnings);

    const answer = d.normalizeAnswer({
      answer: synth.answer, requestId: env.requestId, confidence: synth.confidence,
      retrievalMethod: synth.retrievalMethod, sources: synth.sources,
      warnings, usage, rounds,
      evidenceContract: createEvidenceContract({
        intentFrame, periods, goals: executedGoals, evidence, sources: synth.sources,
      }),
    });
    return await settle(answer, statusFor(answer));
  } catch (err) {
    // Kegagalan tak terduga: JANGAN blank. Fallback snapshot bila ada, kalau
    // tidak keterbatasan yang jujur. Telemetry ditandai fail (best-effort).
    const safe = d.safeError ? d.safeError(err) : { code: "ORCHESTRATOR_ERROR" };
    warnings.push(safe.code || "ORCHESTRATOR_ERROR");
    try { await tracker.fail(err, { retrievalMethod: "none", retrievalRounds: rounds }); } catch { /* */ }
    return d.normalizeAnswer({
      answer: env.snapshotFallback
        ? "Terjadi kendala saat mengambil data live; CIA menampilkan ringkasan snapshot sebagai gambaran sementara."
        : "Maaf, CIA sedang tidak dapat mengambil data untuk pertanyaan ini. Coba lagi beberapa saat.",
      requestId: env.requestId, confidence: "low",
      retrievalMethod: env.snapshotFallback ? "snapshot" : "none",
      sources: [], warnings, usage, rounds,
    });
  }
}

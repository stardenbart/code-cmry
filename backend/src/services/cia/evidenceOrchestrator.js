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
import { startCiaTelemetry, safeError } from "../ciaTelemetry.service.js";
import { resolveEvidenceScope } from "./accessScope.js";
import { resolvePeriods } from "./periodResolver.js";
import { routeEvidence } from "./evidenceRouter.js";
import { planEvidence } from "./evidencePlanner.js";
import { buildDaxPlan } from "./daxPlanBuilder.js";
import { executeEvidencePlan } from "./daxEvidenceExecutor.js";
import { analyzeEvidenceGap } from "./evidenceGapAnalyzer.js";
import { synthesizeEvidence } from "./evidenceSynthesizer.js";
import { skemaModel } from "../powerbiMeta.service.js";

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
function goalKey(goal) {
  const dims = [...new Set((goal?.dimensions || []).map((d) => dimLabel(d).toLowerCase()))].sort().join("|");
  const period = Number.isInteger(Number(goal?.periodIndex)) ? Number(goal.periodIndex) : 0;
  return `${String(goal?.kpiBindingId ?? "").trim()}::${period}::${dims}`;
}

// Fallback goals ketika planner AI kosong/gagal: pakai kandidat deterministic
// teratas apa adanya, meminta seluruh dimensi binding (dibatasi builder).
function deterministicGoals(candidates, limit = 3) {
  return (Array.isArray(candidates) ? candidates : []).slice(0, limit).map((c) => ({
    kpiBindingId: String(c.bindingId),
    dimensions: (Array.isArray(c.dimensions) ? c.dimensions : []).map(dimLabel).filter(Boolean).slice(0, 6),
    periodIndex: 0,
    purpose: "primary",
  }));
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
  resolveEvidenceScope, resolvePeriods, routeEvidence, planEvidence,
  buildDaxPlan, executeEvidencePlan, analyzeEvidenceGap, synthesizeEvidence,
  getSchema: (semanticModel) => skemaModel(semanticModel),
  now: () => new Date(),
  timezone: "Asia/Jakarta",
};

export async function answerWithEvidence(rawEnvelope = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const allowCentralized = INTERNAL_SURFACES.has(rawEnvelope?.surface);
  const env = d.normalizeEnvelope(rawEnvelope, { allowCentralized });

  const tracker = await d.startCiaTelemetry({
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

    // 2. Periode dari pertanyaan (bukan filter report).
    const periods = d.resolvePeriods(env.question, d.now(), d.timezone);
    for (const p of periods) if (Array.isArray(p.warnings)) warnings.push(...p.warnings);

    // 3. Router deterministic (planner AI opsional; tidak boleh membuang kandidat).
    const route = await d.routeEvidence(
      { question: env.question, periods, scope, aiPlanner: deps.routerAiPlanner },
      { ...deps.routerDeps, tracker },
    );
    if (Array.isArray(route.warnings)) warnings.push(...route.warnings);

    const bindingIndex = new Map((route.candidates || []).map((c) => [String(c.bindingId), c]));
    const evidence = [];
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
      try {
        plan = await d.planEvidence(
          { question: env.question, periods, candidateBindings: route.candidates, conversation: env.conversationId },
          deps.plannerDeps,
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

      let goals = (plan.goals && plan.goals.length) ? plan.goals : deterministicGoals(route.candidates);

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

          let daxPlan;
          try {
            const schema = await d.getSchema(binding.semanticModel, binding);
            daxPlan = d.buildDaxPlan({ goal, binding, period, schema });
          } catch (err) {
            // Typed planning failure (mis. DATE_COLUMN_NOT_ALLOWED / schema
            // unavailable): jangan mengarang, catat & lanjut → fallback transparan.
            warnings.push(`PLAN_${err?.code || "FAILED"}`);
            continue;
          }

          const result = await d.executeEvidencePlan(daxPlan, { ...deps.executorDeps, tracker });
          addUsage(result?.usage);
          roundResults.push({ ...result, goal, source: result?.source || sourceFrom(daxPlan) });
        }
        evidence.push(...roundResults);

        const gap = await d.analyzeEvidenceGap({
          question: env.question,
          plan: { goals, periods, candidates: route.candidates },
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
        { question: env.question, evidence, warnings, snapshotFallback: env.snapshotFallback },
        deps.synthDeps,
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

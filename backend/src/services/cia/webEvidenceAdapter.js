import { answerWithEvidence as defaultAnswerWithEvidence } from "./evidenceOrchestrator.js";

function uniqueIds(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function actorFrom(user = {}) {
  return {
    id: user.id,
    name: user.nama ?? user.name ?? user.username ?? null,
    department: user.departemen ?? user.department ?? user.divisi ?? null,
  };
}

function dashboardPayload(answer) {
  return {
    answer: answer.answer,
    period: answer.sources?.find((source) => source.period)?.period ?? null,
    sources: answer.sources || [],
    warnings: answer.warnings || [],
    meta: {
      confidence: answer.confidence,
      retrievalMethod: answer.retrievalMethod,
      rounds: answer.rounds,
      usage: answer.usage,
    },
  };
}

function multiChatPayload(answer) {
  return {
    answer: answer.answer,
    dashboards_used: (answer.sources || []).map((source) => ({
      id: source.dashboardId,
      title: source.dashboardName || `Dashboard ${source.dashboardId}`,
      reason: [source.kpis?.join(", "), source.period].filter(Boolean).join(" · "),
      confidence: answer.confidence === "high" ? 1 : answer.confidence === "medium" ? 0.75 : 0.5,
    })),
    sources: answer.sources || [],
    warnings: answer.warnings || [],
    confidence: answer.confidence,
    retrieval_method: answer.retrievalMethod,
    rounds: answer.rounds,
    tokens: answer.usage,
  };
}

/**
 * Thin compatibility boundary between existing web endpoints and the shared
 * evidence orchestrator. A null result deliberately means "continue legacy".
 */
export async function runWebEvidence(input = {}, injected = {}) {
  if (injected.enabled !== true) return null;
  const body = input.body || {};
  const answerWithEvidence = injected.answerWithEvidence || defaultAnswerWithEvidence;
  try {
    const answer = await answerWithEvidence({
      requestId: input.requestId,
      surface: input.surface || "dashboard",
      actor: actorFrom(input.user),
      question: String(body.question || "").trim(),
      conversationId: body.conversationId ?? null,
      preferredDashboardIds: uniqueIds([body.dashboardId, ...(body.preferredDashboardIds || [])]),
      snapshotFallback: input.snapshotFallback || null,
    }, input.tracker ? { tracker: input.tracker } : {});
    if (!answer?.answer?.trim()) throw new Error("EMPTY_ORCHESTRATOR_ANSWER");
    return input.surface === "multi_chat" ? multiChatPayload(answer) : dashboardPayload(answer);
  } catch (error) {
    injected.onFallback?.({
      code: "ORCHESTRATOR_WEB_FALLBACK",
      message: error?.message || "unknown error",
    });
    return null;
  }
}

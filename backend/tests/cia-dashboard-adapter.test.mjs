import fs from "fs";
import { ok, section, summary } from "./harness.mjs";
import { runWebEvidence } from "../src/services/cia/webEvidenceAdapter.js";

function request(overrides = {}) {
  return {
    surface: "dashboard",
    requestId: "req-web-1",
    user: { id: 7, nama: "Budi", departemen: "Produksi" },
    body: {
      dashboardId: 10,
      preferredDashboardIds: [20, 10],
      conversationId: "conv-1",
      question: "lembur bulan lalu kenapa naik?",
      ...overrides,
    },
    snapshotFallback: { text: "Total lembur 7 jam", period: "snapshot aktif" },
  };
}

section("Flag mati mempertahankan jalur legacy");
{
  let calls = 0;
  const result = await runWebEvidence(request(), {
    enabled: false,
    answerWithEvidence: async () => { calls += 1; },
  });
  ok("adapter melewati orchestrator", result === null);
  ok("orchestrator tidak dipanggil", calls === 0, String(calls));
}

section("Flag aktif membentuk envelope dashboard yang kompatibel");
{
  let envelope;
  const result = await runWebEvidence(request(), {
    enabled: true,
    answerWithEvidence: async (value) => {
      envelope = value;
      return {
        answer: "Lembur naik dan berkorelasi dengan PO.", requestId: value.requestId,
        confidence: "high", retrievalMethod: "live_dax", rounds: 2,
        warnings: [], usage: { inputTokens: 4, outputTokens: 8, totalTokens: 12 },
        sources: [{ dashboardId: "10", dashboardName: "Lembur", period: "2026-07-01 sampai 2026-07-31", kpis: ["Jam lembur"], rowCount: 4 }],
      };
    },
  });
  ok("current dashboard menjadi hint pertama dan unik",
    JSON.stringify(envelope.preferredDashboardIds) === JSON.stringify(["10", "20"]),
    JSON.stringify(envelope.preferredDashboardIds));
  ok("periode tetap berasal dari pertanyaan", envelope.question.includes("bulan lalu"));
  ok("conversation diteruskan", envelope.conversationId === "conv-1");
  ok("snapshot hanya fallback", envelope.snapshotFallback?.text === "Total lembur 7 jam");
  ok("actor berasal dari server", envelope.actor.id === 7 && envelope.actor.department === "Produksi");
  ok("field lama answer tetap ada", result.answer.includes("Lembur naik"));
  ok("field lama period tetap ada", result.period === "2026-07-01 sampai 2026-07-31", result.period);
  ok("metadata evidence ikut", result.meta.retrievalMethod === "live_dax" && result.sources.length === 1);
}

section("Kegagalan orchestrator meminta legacy fallback, bukan blank");
{
  const warnings = [];
  const result = await runWebEvidence(request(), {
    enabled: true,
    answerWithEvidence: async () => { throw new Error("boom"); },
    onFallback: (warning) => warnings.push(warning),
  });
  ok("hasil null agar controller melanjutkan legacy", result === null);
  ok("warning fallback transparan", warnings[0]?.code === "ORCHESTRATOR_WEB_FALLBACK");
}

section("Multi-Chat mendapat kontrak lama plus metadata evidence");
{
  const result = await runWebEvidence({
    ...request({ dashboardId: undefined, preferredDashboardIds: [20, 30] }),
    surface: "multi_chat",
  }, {
    enabled: true,
    answerWithEvidence: async () => ({
      answer: "PO dan lembur berkorelasi.", requestId: "req-web-1",
      confidence: "medium", retrievalMethod: "live_dax", rounds: 2,
      warnings: ["CORRELATION_ONLY"], usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 },
      sources: [
        { dashboardId: "20", dashboardName: "Lembur", period: "2026-07", kpis: ["Jam lembur"], rowCount: 5 },
        { dashboardId: "30", dashboardName: "PPIC", period: "2026-07", kpis: ["PO"], rowCount: 3 },
      ],
    }),
  });
  ok("kontrak dashboards_used tersedia", result.dashboards_used?.length === 2);
  ok("conversation contract tetap disiapkan controller", result.answer === "PO dan lembur berkorelasi.");
  ok("metadata evidence tersedia", result.retrieval_method === "live_dax"
    && result.confidence === "medium" && result.warnings[0] === "CORRELATION_ONLY");
}

section("Controller memasang adapter sebelum syarat snapshot legacy");
{
  const source = fs.readFileSync("src/controllers/aiController.js", "utf8");
  const askStart = source.indexOf("ask: withCiaTelemetry");
  const adapter = source.indexOf("tryDashboardEvidence(", askStart);
  const legacySnapshot = source.indexOf("if (!hasVisualData)", adapter);
  ok("adapter terpasang di endpoint ask", adapter > 0);
  ok("live evidence dicoba sebelum snapshot diwajibkan", legacySnapshot > adapter,
    `${adapter} < ${legacySnapshot}`);
}

process.exit(summary() ? 0 : 1);

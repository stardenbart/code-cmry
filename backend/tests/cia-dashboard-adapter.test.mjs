import fs from "fs";
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { runWebEvidence } from "../src/services/cia/webEvidenceAdapter.js";
import * as aiController from "../src/controllers/aiController.js";

const { buildEvidenceSnapshotFallback } = aiController;

function request(overrides = {}) {
  return {
    surface: "dashboard",
    requestId: "req-web-1",
    user: { id: 7, nama: "Budi", departemen: "Produksi" },
    body: {
      dashboardId: 10,
      preferredDashboardIds: [20, 10],
      conversationId: "conv-1",
      conversation: [
        { role: "user", text: "berapa lembur?" },
        { role: "assistant", text: "120 jam", evidenceContract: {
          concepts: ["overtime"], entities: [], periods: [], sources: [{ dashboardId: "10" }], goals: [],
        } },
      ],
      reportContext: {
        dashboardId: "10", activePage: "Overview", selectedPages: ["Overview"],
        filters: ["Supplier.Name = AJI"],
      },
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
  let synthSanitizer;
  const sanitizer = { sanitizeText: (value) => value };
  const result = await runWebEvidence({ ...request(), sanitizer }, {
    enabled: true,
    answerWithEvidence: async (value, deps) => {
      envelope = value;
      synthSanitizer = deps?.synthDeps?.sanitizer;
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
  ok("turn contract dashboard diteruskan",
    envelope.conversation[1]?.evidenceContract?.sources?.[0]?.dashboardId === "10",
    JSON.stringify(envelope.conversation));
  ok("report aktif diteruskan sebagai context aman",
    envelope.reportContext?.activePage === "Overview"
      && envelope.reportContext?.selectedPages?.[0] === "Overview"
      && envelope.reportContext?.filters === undefined,
    JSON.stringify(envelope.reportContext));
  ok("snapshot hanya fallback", envelope.snapshotFallback?.text === "Total lembur 7 jam");
  ok("sanitizer snapshot yang sama diteruskan ke synthesis tanpa masuk envelope",
    synthSanitizer === sanitizer && envelope.sanitizer === undefined);
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
  let envelope;
  const result = await runWebEvidence({
    ...request({ dashboardId: undefined, preferredDashboardIds: [20, 30] }),
    surface: "multi_chat",
  }, {
    enabled: true,
    answerWithEvidence: async (value) => {
      envelope = value;
      return ({
      answer: "PO dan lembur berkorelasi.", requestId: "req-web-1",
      confidence: "medium", retrievalMethod: "live_dax", rounds: 2,
      warnings: ["CORRELATION_ONLY"], usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 },
      evidenceContract: {
        concepts: ["overtime", "purchase order"], entities: [], periods: [],
        sources: [{ dashboardId: "20" }, { dashboardId: "30" }], goals: [],
      },
      sources: [
        { dashboardId: "20", dashboardName: "Lembur", period: "2026-07", kpis: ["Jam lembur"], rowCount: 5 },
        { dashboardId: "30", dashboardName: "PPIC", period: "2026-07", kpis: ["PO"], rowCount: 3 },
      ],
      });
    },
  });
  ok("kontrak dashboards_used tersedia", result.dashboards_used?.length === 2);
  ok("conversation contract tetap disiapkan controller", result.answer === "PO dan lembur berkorelasi.");
  ok("metadata evidence tersedia", result.retrieval_method === "live_dax"
    && result.confidence === "medium" && result.warnings[0] === "CORRELATION_ONLY");
  ok("evidence contract diteruskan untuk disimpan controller",
    result.evidenceContract?.sources?.[0]?.dashboardId === "20", JSON.stringify(result.evidenceContract));
  ok("Multi-Chat meneruskan contract turn ke orchestrator",
    envelope.conversation[1]?.evidenceContract?.concepts?.[0] === "overtime",
    JSON.stringify(envelope.conversation));
}

section("Controller endpoint menghormati flag sebelum jawaban lokal");
{
  ok("controller routing seam tersedia", typeof aiController.routeDashboardEvidence === "function");
  if (typeof aiController.routeDashboardEvidence === "function") {
    const previous = process.env.CIA_HYBRID_QUERY_ENABLED;
    let calls = 0;
    const input = {
      req: {}, user: { id: 7 }, dashboard: { id: 10 }, snapshot: { visuals: [] },
      localAnswer: { answered: true, confidence: 1, text: "Jawaban snapshot lokal" },
    };
    const deps = { tryDashboardEvidence: async () => {
      calls += 1;
      return { answer: "Jawaban shared orchestrator", meta: { retrievalMethod: "live_dax" } };
    } };
    try {
      process.env.CIA_HYBRID_QUERY_ENABLED = "false";
      const legacy = await aiController.routeDashboardEvidence(input, deps);
      ok("flag false mempertahankan jawaban lokal tanpa orchestrator", legacy === null && calls === 0,
        JSON.stringify({ legacy, calls }));

      process.env.CIA_HYBRID_QUERY_ENABLED = "true";
      const hybrid = await aiController.routeDashboardEvidence(input, deps);
      ok("flag true melewati local confidence dan memakai shared orchestrator",
        hybrid?.meta?.retrievalMethod === "live_dax" && calls === 1,
        JSON.stringify({ hybrid, calls }));
    } finally {
      if (previous == null) delete process.env.CIA_HYBRID_QUERY_ENABLED;
      else process.env.CIA_HYBRID_QUERY_ENABLED = previous;
    }
  }
}

section("Controller memisahkan teks model tersanitasi dari filter DAX internal");
{
  const snapshotResults = [
    {
      dashboard_id: "10",
      dashboard: { id: "10", title: "Supplier Quality" },
      snapshot: {
        period: { label: "Agustus" },
        filters: ["Supplier.Name = AJI"],
        visuals: [{ title: "Supplier", rows: [{ Supplier: "AJI", Score: 90 }] }],
      },
    },
    {
      dashboard_id: "20",
      dashboard: { id: "20", title: "Supplier Delivery" },
      snapshot: {
        filters: ["Supplier.Name = BETA"],
        visuals: [{ title: "Supplier", rows: [{ Supplier: "BETA", Score: 80 }] }],
      },
    },
  ];
  const fallback = buildEvidenceSnapshotFallback(snapshotResults, {
    sanitizeSnapshot(snapshot) {
      return JSON.parse(JSON.stringify(snapshot).replaceAll("AJI", "MITRA_1").replaceAll("BETA", "MITRA_2"));
    },
  });
  ok("nilai sensitif tidak muncul pada text model-facing",
    !fallback.dashboards.some((dashboard) => /AJI|BETA/.test(dashboard.text))
      && fallback.dashboards.some((dashboard) => /MITRA_/.test(dashboard.text)),
    JSON.stringify(fallback.dashboards));
  ok("nilai asli tetap tersedia hanya pada filter eksekusi internal",
    fallback.reportFilters.some((filter) => filter.value === "AJI" && filter.dashboardId === "10")
      && fallback.reportFilters.some((filter) => filter.value === "BETA" && filter.dashboardId === "20"),
    JSON.stringify(fallback.reportFilters));
  ok("Multi-Chat mempertahankan asosiasi filter per dashboard",
    fallback.reportFilters.every((filter) => filter.dashboardId === "10" || filter.dashboardId === "20"),
    JSON.stringify(fallback.reportFilters));
}

section("Multi-Chat membatasi kartu sumber duplikat");
{
  const result = await runWebEvidence({ ...request(), surface: "multi_chat" }, {
    enabled: true,
    answerWithEvidence: async () => ({
      answer: "Data live tersedia.", requestId: "req-duplicate",
      confidence: "medium", retrievalMethod: "live_dax", rounds: 1, warnings: [], usage: null,
      sources: Array.from({ length: 12 }, (_, index) => ({
        dashboardId: String(65 + (index % 2)), dashboardName: "Technical Downtime ORS",
        semanticModel: "ors", period: "2026-06-01 sampai 2026-06-30",
        kpis: ["Top mesin downtime tertinggi"], rowCount: 20,
      })),
    }),
  });
  ok("dashboard cards unik dan tidak memenuhi layar",
    result.dashboards_used.length === 1 && result.sources.length === 1,
    JSON.stringify({ dashboards: result.dashboards_used, sources: result.sources }));
}

section("Controller memasang adapter sebelum syarat snapshot legacy");
{
  const source = fs.readFileSync("src/controllers/aiController.js", "utf8");
  const askStart = source.indexOf("ask: withCiaTelemetry");
  const adapter = source.indexOf("routeDashboardEvidence({", askStart);
  const legacySnapshot = source.indexOf("if (!hasVisualData)", adapter);
  ok("adapter terpasang di endpoint ask", adapter > 0);
  ok("live evidence dicoba sebelum snapshot diwajibkan", legacySnapshot > adapter,
    `${adapter} < ${legacySnapshot}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

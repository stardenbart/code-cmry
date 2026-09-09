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
  let requestSanitizer;
  const sanitizer = { sanitizeText: (value) => value };
  const result = await runWebEvidence({ ...request(), sanitizer }, {
    enabled: true,
    answerWithEvidence: async (value, deps) => {
      envelope = value;
      requestSanitizer = deps?.sanitizer;
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
  ok("sanitizer snapshot yang sama diteruskan sebagai dependency request tanpa masuk envelope",
    requestSanitizer === sanitizer && envelope.sanitizer === undefined);
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

section("Dashboard hybrid melewati key, rate limit, quota, dan accounting");
{
  const events = [];
  const logged = [];
  let quotaReads = 0;
  const result = await aiController.runControlledDashboardEvidence({
    req: { ciaRequestId: "req-controlled", body: {} },
    user: { id: 7 },
    dashboard: { id: 10, title: "Lembur" },
    snapshot: { visuals: [] },
    localAnswer: { answered: false, intent: "ANALYTICAL" },
    question: "kenapa lembur naik?",
    model: "gemini-test",
  }, {
    hybridEnabled: () => true,
    resolveKey: async () => { events.push("key"); return { source: "user", apiKey: "secret" }; },
    rateLimitHit: () => { events.push("rate"); return { allowed: true }; },
    quotaSummary: async () => {
      quotaReads += 1;
      events.push(quotaReads === 1 ? "quota" : "quotaAfter");
      return { used: quotaReads, resetAt: "2026-09-02T00:00:00.000Z" };
    },
    breakerState: () => { events.push("breaker"); return { level: "ok" }; },
    routeDashboardEvidence: async () => {
      events.push("orchestrator");
      return {
        answer: "Lembur naik.",
        sources: [{ rowCount: 4 }],
        meta: {
          model: "gemini-planner+synth",
          usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
        },
      };
    },
    logChat: async (row) => { events.push("log"); logged.push(row); },
  });
  ok("kontrol terjadi sebelum orchestrator dan log sebelum quota akhir",
    JSON.stringify(events) === JSON.stringify([
      "key", "rate", "quota", "breaker", "orchestrator", "log", "quotaAfter",
    ]), JSON.stringify(events));
  ok("usage planner+synth dicatat ke ai_chat_logs",
    logged[0]?.prompt_tokens === 5 && logged[0]?.output_tokens === 7
      && logged[0]?.total_tokens === 12 && logged[0]?.key_source === "user",
    JSON.stringify(logged[0]));
  ok("response hybrid membawa quota sesudah pemakaian",
    result.response?.meta?.quota?.used === 2 && result.response?.meta?.keySource === "user",
    JSON.stringify(result));
}

section("Dashboard hybrid berhenti sebelum orchestrator ketika kontrol menolak");
{
  let calls = 0;
  const base = {
    req: { body: {} }, user: { id: 7 }, dashboard: { id: 10, title: "Lembur" },
    snapshot: null, localAnswer: { answered: false }, question: "analisa", model: null,
  };
  const denied = await aiController.runControlledDashboardEvidence(base, {
    hybridEnabled: () => true,
    resolveKey: async () => ({ source: "server", apiKey: "secret" }),
    rateLimitHit: () => ({ allowed: false, retryAfterSeconds: 9 }),
    routeDashboardEvidence: async () => { calls += 1; },
  });
  ok("rate limit 429 tidak memanggil orchestrator",
    denied.terminal?.status === 429 && denied.terminal?.retryAfterSeconds === 9 && calls === 0,
    JSON.stringify(denied));

  const open = await aiController.runControlledDashboardEvidence(base, {
    hybridEnabled: () => true,
    resolveKey: async () => ({ source: "server", apiKey: "secret" }),
    rateLimitHit: () => ({ allowed: true }),
    quotaSummary: async () => ({ resetAt: "2026-09-02T00:00:00.000Z" }),
    breakerState: () => ({ level: "open", message: "Kuota habis." }),
    routeDashboardEvidence: async () => { calls += 1; },
  });
  ok("circuit breaker 429 tidak memanggil orchestrator",
    open.terminal?.status === 429 && calls === 0, JSON.stringify(open));

  const noKey = await aiController.runControlledDashboardEvidence(base, {
    hybridEnabled: () => true,
    resolveKey: async () => null,
    routeDashboardEvidence: async () => { calls += 1; },
  });
  ok("API key wajib sebelum orchestrator", noKey.terminal?.status === 503 && calls === 0,
    JSON.stringify(noKey));
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

section("Jawaban lokal yang yakin gratis walau key/rate/quota menolak (I-1)");
{
  const base = {
    req: { body: {} }, user: { id: 7 }, dashboard: { id: 10, title: "Lembur" },
    snapshot: { visuals: [{ title: "Lembur", rows: [{ Jam: 120 }] }] },
    localAnswer: { answered: true, confidence: 1, text: "120 jam lembur bulan ini" },
    question: "berapa jam lembur bulan ini?", model: null,
  };

  // Skenario A: rate limit sedang menolak.
  {
    let keyCalls = 0;
    let rateCalls = 0;
    const result = await aiController.runControlledDashboardEvidence(base, {
      hybridEnabled: () => true,
      resolveKey: async () => { keyCalls += 1; return { source: "server", apiKey: "secret" }; },
      rateLimitHit: () => { rateCalls += 1; return { allowed: false, retryAfterSeconds: 9 }; },
      quotaSummary: async () => ({ resetAt: null }),
      breakerState: () => ({ level: "ok" }),
      routeDashboardEvidence: async () => { throw new Error("orchestrator tidak boleh dipanggil"); },
      logChat: async () => { throw new Error("logChat hybrid tidak boleh dipanggil untuk jawaban lokal"); },
    });
    ok("rate limit tidak pernah dipanggil untuk jawaban lokal yang yakin", rateCalls === 0, String(rateCalls));
    ok("resolveKey tidak pernah dipanggil untuk jawaban lokal yang yakin", keyCalls === 0, String(keyCalls));
    ok("tidak ada terminal 429 — caller lanjut ke jawaban lokal gratis",
      !result.terminal, JSON.stringify(result));
    ok("tidak ada kontrol yang dibebankan", result.response === null && result.controls === null,
      JSON.stringify(result));
  }

  // Skenario B: tidak ada API key yang bisa di-resolve sama sekali.
  {
    let keyCalls = 0;
    const result = await aiController.runControlledDashboardEvidence(base, {
      hybridEnabled: () => true,
      resolveKey: async () => { keyCalls += 1; return null; },
      rateLimitHit: () => { throw new Error("rate limit tidak boleh dicek — resolveKey seharusnya tidak jalan"); },
      routeDashboardEvidence: async () => { throw new Error("orchestrator tidak boleh dipanggil"); },
    });
    ok("resolveKey tidak pernah dipanggil untuk jawaban lokal yang yakin", keyCalls === 0, String(keyCalls));
    ok("tidak ada terminal 503 — caller lanjut ke jawaban lokal gratis",
      !result.terminal, JSON.stringify(result));
    ok("tidak ada kontrol yang dibebankan", result.response === null && result.controls === null,
      JSON.stringify(result));
  }

  // Kontrol negatif: jawaban lokal TIDAK yakin tetap melewati key/rate seperti biasa.
  {
    let keyCalls = 0;
    const notConfident = { ...base, localAnswer: { answered: false, intent: "ANALYTICAL" } };
    const result = await aiController.runControlledDashboardEvidence(notConfident, {
      hybridEnabled: () => true,
      resolveKey: async () => { keyCalls += 1; return null; },
    });
    ok("tanpa jawaban lokal yang yakin, resolveKey tetap dipanggil (kontrol tidak dilewati)",
      keyCalls === 1 && result.terminal?.status === 503, JSON.stringify({ keyCalls, result }));
  }
}

section("Controller memasang adapter sebelum syarat snapshot legacy");
{
  const source = fs.readFileSync("src/controllers/aiController.js", "utf8");
  const askStart = source.indexOf("ask: withCiaTelemetry");
  const adapter = source.indexOf("runControlledDashboardEvidence({", askStart);
  const legacySnapshot = source.indexOf("if (!hasVisualData)", adapter);
  const directUncontrolled = source.indexOf("routeDashboardEvidence({", askStart);
  ok("controlled adapter terpasang di endpoint ask", adapter > 0);
  ok("endpoint tidak memanggil orchestrator tanpa kontrol",
    directUncontrolled < 0 || directUncontrolled > source.indexOf("});", adapter),
    String(directUncontrolled));
  ok("controlled live evidence dicoba sebelum snapshot diwajibkan", legacySnapshot > adapter,
    `${adapter} < ${legacySnapshot}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

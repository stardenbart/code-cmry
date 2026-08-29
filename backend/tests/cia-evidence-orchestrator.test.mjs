// Orchestrator bukti CIA — uji end-to-end dengan dependency PALSU (tanpa DB,
// tanpa Power BI, tanpa AI). Menjaga kontrak pipeline, batas ronde/repair,
// agregasi token, konsistensi requestId, dan larangan jawaban kosong.
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { answerWithEvidence } from "../src/services/cia/evidenceOrchestrator.js";

function makeTracker(env) {
  const t = { requestId: env.requestId, events: [], finished: null, failed: null };
  t.event = async (stage, data = {}) => { t.events.push({ stage, requestId: t.requestId, data }); };
  t.finish = async (s) => { t.finished = s; };
  t.fail = async (e, s) => { t.failed = { e, s }; };
  return t;
}
function candidate(bindingId, dashboardId, extra = {}) {
  return {
    bindingId, bindingKey: `key-${bindingId}`, kpiId: 1, slug: `kpi-${bindingId}`,
    humanName: `KPI ${bindingId}`, definition: "def", unit: "jam", numberFormat: null,
    dashboardId, dashboardName: `Dashboard ${dashboardId}`, reportId: `r-${dashboardId}`,
    semanticModel: "Model", tableName: "Fact", measureName: "M", displayCaption: "Cap",
    dateTable: "DimDate", dateColumn: "Date", dateLogic: "harian",
    dimensions: [{ table: "Fact", column: "Departemen", humanName: "Departemen" }],
    score: 10, ...extra,
  };
}
function baseDeps(overrides = {}) {
  // tracker disimpan di `calls` (objek stabil) — bukan getter — karena object
  // spread akan mengevaluasi getter sekali menjadi nilai statik.
  const calls = { route: 0, plan: 0, build: 0, exec: 0, gap: 0, synth: 0, scope: 0, tracker: null };
  const deps = {
    calls,
    async startCiaTelemetry(env) { calls.tracker = makeTracker(env); return calls.tracker; },
    async resolveEvidenceScope() {
      calls.scope += 1;
      return { allowedDashboardIds: ["10", "20", "30"], preferredDashboardIds: [], deniedPreferredDashboardIds: [], mode: "user_acl", denied: false, errorCode: null };
    },
    resolvePeriods() {
      return [{ label: "Aktual", from: "2026-08-01", to: "2026-08-31", grain: "day", comparisonKey: "current" }];
    },
    async routeEvidence(_input, injected) {
      calls.route += 1;
      await injected.tracker?.event?.("route_candidates", { metadata: { candidates: ["b1"] } });
      return { status: "ready", errorCode: null, candidates: [candidate("b1", "10")], periods: [], warnings: [] };
    },
    async planEvidence() {
      calls.plan += 1;
      return { goals: [{ kpiBindingId: "b1", dimensions: ["Departemen"], periodIndex: 0, purpose: "primary" }],
        warnings: [], usage: { inputTokens: 5, outputTokens: 3 }, provider: "gemini", model: "g" };
    },
    buildDaxPlan({ goal, binding, period }) {
      calls.build += 1;
      return { semanticModel: binding.semanticModel, dashboardId: binding.dashboardId,
        dashboardName: binding.dashboardName, dax: "EVALUATE 1",
        selectedKpis: [{ bindingId: binding.bindingId, humanName: binding.humanName }], period, maxRows: 500 };
    },
    async executeEvidencePlan(plan, injected) {
      calls.exec += 1;
      await injected.tracker?.event?.("dax_attempt", { semanticModel: plan.semanticModel, status: "started" });
      return { status: "success", errorCode: null, attempts: 1, rows: [{ Departemen: "Produksi A", "Jam lembur": 128 }],
        columns: [{ key: "M", label: "Jam lembur" }], rowCount: 1, durationMs: 5, period: plan.period,
        source: { dashboardId: plan.dashboardId, dashboardName: plan.dashboardName, semanticModel: plan.semanticModel, kpis: ["Jam lembur"] } };
    },
    async analyzeEvidenceGap() { calls.gap += 1; return { complete: true, missing: [], additionalGoals: [], warnings: [] }; },
    async synthesizeEvidence() {
      calls.synth += 1;
      return { answer: "Jam lembur Produksi A 128.", confidence: "high", retrievalMethod: "live_dax",
        sources: [{ dashboardName: "Dashboard 10", period: "2026-08" }], warnings: [],
        usage: { inputTokens: 7, outputTokens: 11 }, provider: "gemini", model: "g" };
    },
    async getSchema() { return { model: "Model", datasetId: "ds", tabel: [], measure: [] }; },
    now: () => new Date("2026-08-27T00:00:00Z"),
  };
  return { ...deps, ...overrides };
}
const envelope = (over = {}) => ({ surface: "dashboard", question: "breakdown lembur per departemen",
  actor: { userId: 1 }, requestId: "REQ-1", ...over });

try {
  section("Sukses satu ronde");
  {
    const deps = baseDeps();
    const a = await answerWithEvidence(envelope(), deps);
    ok("answer tidak kosong", a.answer.length > 0);
    ok("retrievalMethod live_dax", a.retrievalMethod === "live_dax", a.retrievalMethod);
    ok("confidence high", a.confidence === "high");
    ok("rounds 1", a.rounds === 1, String(a.rounds));
    ok("requestId diteruskan", a.requestId === "REQ-1");
    ok("execute dipanggil sekali", deps.calls.exec === 1, String(deps.calls.exec));
    ok("ada source", a.sources.length >= 1);
  }

  section("Intent dibangun sebelum periode dan diteruskan bersama preferred source");
  {
    const order = [];
    let routed;
    const deps = baseDeps({
      async resolveEvidenceScope() {
        return { allowedDashboardIds: ["44", "65"], preferredDashboardIds: ["44"],
          deniedPreferredDashboardIds: [], mode: "user_acl", denied: false, errorCode: null };
      },
      buildIntentFrame(input) {
        order.push("intent");
        return { question: input.question.toLowerCase(), concepts: ["downtime"], entities: [], operations: [],
          sourceConstraints: [], continuity: "new_topic", preferredDashboardIds: ["44"], periodKinds: ["named_month"] };
      },
      resolvePeriods() {
        order.push("period");
        return [{ label: "Juni", from: "2026-06-01", to: "2026-06-30" }];
      },
      async routeEvidence(input) {
        routed = input;
        return { status: "ready", candidates: [candidate("b1", "44")], periods: input.periods, warnings: [] };
      },
    });
    await answerWithEvidence(envelope({
      question: "masalah Evergreen bulan Juni", preferredDashboardIds: ["44"],
    }), deps);
    ok("intent dibangun sebelum periode", JSON.stringify(order.slice(0, 2)) === JSON.stringify(["intent", "period"]),
      JSON.stringify(order));
    ok("router menerima intent frame dan preferred source hasil scope",
      routed?.intentFrame?.concepts?.includes("downtime")
        && JSON.stringify(routed?.scope?.preferredDashboardIds) === JSON.stringify(["44"]),
      JSON.stringify(routed));
  }

  section("Fallback deterministic menghormati source priority sebelum score");
  {
    let executedDashboard;
    const deps = baseDeps({
      async routeEvidence() {
        return { status: "ready", candidates: [
          candidate("b-maint", "44", { score: 50, sourcePriority: 100 }),
          candidate("b-ors", "65", { score: 90, sourcePriority: 0 }),
        ], periods: [], warnings: [] };
      },
      async planEvidence() { return { goals: [], warnings: [] }; },
      async executeEvidencePlan(plan) {
        executedDashboard = plan.dashboardId;
        return { status: "success", errorCode: null, attempts: 1, rows: [{ value: 1 }], columns: [],
          rowCount: 1, durationMs: 1, period: plan.period,
          source: { dashboardId: plan.dashboardId, dashboardName: plan.dashboardName } };
      },
    });
    await answerWithEvidence(envelope({ question: "masalah evergreen bulan juni" }), deps);
    ok("preferred source dieksekusi meski kandidat ACL lain punya score lebih tinggi",
      executedDashboard === "44", String(executedDashboard));
  }

  section("Korelasi lintas dua dashboard (dua ronde)");
  {
    let round = 0;
    const deps = baseDeps({
      async routeEvidence(_i, injected) {
        await injected.tracker?.event?.("route_candidates", {});
        return { status: "ready", candidates: [candidate("b1", "10"), candidate("b2", "20")], periods: [], warnings: [] };
      },
      async analyzeEvidenceGap() {
        this.calls.gap += 1; round += 1;
        if (round === 1) return { complete: false, missing: ["correlation:ppic"], additionalGoals: [{ kpiBindingId: "b2", dimensions: ["Produk"], periodIndex: 0, purpose: "correlation" }], warnings: [] };
        return { complete: true, missing: [], additionalGoals: [], warnings: [] };
      },
    });
    const a = await answerWithEvidence(envelope({ question: "lembur produksi A karena PO naik" }), deps);
    ok("dua ronde", a.rounds === 2, String(a.rounds));
    ok("execute dipanggil dua kali (dua dashboard)", deps.calls.exec === 2, String(deps.calls.exec));
  }

  section("Follow-up menarik dashboard ketiga");
  {
    let round = 0;
    const deps = baseDeps({
      async routeEvidence() {
        return { status: "ready", candidates: [candidate("b1", "10"), candidate("b2", "20"), candidate("b3", "30")], periods: [], warnings: [] };
      },
      async analyzeEvidenceGap() {
        this.calls.gap += 1; round += 1;
        if (round === 1) return { complete: false, missing: ["x"], additionalGoals: [{ kpiBindingId: "b2", dimensions: [], periodIndex: 0, purpose: "correlation" }], warnings: [] };
        if (round === 2) return { complete: false, missing: ["y"], additionalGoals: [{ kpiBindingId: "b3", dimensions: [], periodIndex: 0, purpose: "correlation" }], warnings: [] };
        return { complete: true, missing: [], additionalGoals: [], warnings: [] };
      },
    });
    const a = await answerWithEvidence(envelope(), deps);
    ok("tiga ronde", a.rounds === 3, String(a.rounds));
    ok("execute tiga dashboard", deps.calls.exec === 3, String(deps.calls.exec));
  }

  section("Planner kosong tetap memakai kandidat deterministic");
  {
    const deps = baseDeps({
      async planEvidence() { this.calls.plan += 1; return { goals: [], warnings: ["PLANNER_EMPTY"], usage: null }; },
    });
    const a = await answerWithEvidence(envelope(), deps);
    ok("build tetap dipanggil (deterministic goal)", deps.calls.build === 1, String(deps.calls.build));
    ok("execute tetap jalan", deps.calls.exec === 1, String(deps.calls.exec));
    ok("answer tidak kosong", a.answer.length > 0);
    ok("warning PLANNER_EMPTY terbawa", a.warnings.includes("PLANNER_EMPTY"));
  }

  section("Goal planner invalid tidak menghalangi fallback deterministic terbaik");
  {
    const deps = baseDeps({
      async routeEvidence() {
        return { status: "ready", candidates: [
          candidate("b1", "10", { score: 60 }),
          candidate("b2", "20", { score: 20 }),
        ], periods: [], warnings: [] };
      },
      async planEvidence() {
        return { goals: [{ kpiBindingId: "b2", dimensions: [], periodIndex: 0, purpose: "primary" }], warnings: [] };
      },
      buildDaxPlan(input) {
        this.calls.build += 1;
        if (input.binding.bindingId === "b2") {
          const error = new Error("invalid planner route"); error.code = "TABLE_NOT_ALLOWED"; throw error;
        }
        return { semanticModel: input.binding.semanticModel, dashboardId: input.binding.dashboardId,
          dashboardName: input.binding.dashboardName, dax: "EVALUATE 1",
          selectedKpis: [{ bindingId: input.binding.bindingId, humanName: input.binding.humanName }],
          period: input.period, maxRows: 500 };
      },
    });
    const a = await answerWithEvidence(envelope(), deps);
    ok("binding deterministic terbaik tetap dieksekusi", deps.calls.exec === 1, String(deps.calls.exec));
    ok("kegagalan planner tetap transparan", a.warnings.includes("PLAN_TABLE_NOT_ALLOWED"), JSON.stringify(a.warnings));
  }

  section("Entitas CMD pada pertanyaan diteruskan sebagai filter DAX");
  {
    let receivedGoal;
    const deps = baseDeps({
      async routeEvidence() {
        return { status: "ready", candidates: [candidate("b1", "10", {
          dimensions: [
            { table: "Fact", column: "Departemen", humanName: "Mesin" },
            { table: "Plant", column: "Gedung", humanName: "CMD / Gedung" },
          ],
        })], periods: [], warnings: [] };
      },
      async planEvidence() {
        return { goals: [{ kpiBindingId: "b1", dimensions: ["Mesin", "CMD / Gedung"], periodIndex: 0, purpose: "primary" }], warnings: [] };
      },
      buildDaxPlan({ goal, binding, period }) {
        receivedGoal = goal;
        return { semanticModel: binding.semanticModel, dashboardId: binding.dashboardId,
          dashboardName: binding.dashboardName, dax: "EVALUATE 1",
          selectedKpis: [{ bindingId: binding.bindingId, humanName: binding.humanName }], period, maxRows: 500 };
      },
    });
    await answerWithEvidence(envelope({
      question: "top 3 mesin downtime tertinggi pada CMD1 bulan Juni",
    }), deps);
    ok("CMD1 menjadi structured filter, bukan instruksi bebas",
      receivedGoal?.filters?.[0]?.dimension === "CMD / Gedung"
        && receivedGoal?.filters?.[0]?.value === "CMD1", JSON.stringify(receivedGoal));
  }

  section("Planner tidak boleh menambah KPI sibling pada pertanyaan ranking");
  {
    const deps = baseDeps({
      async routeEvidence() {
        return { status: "ready", candidates: [
          candidate("b-high", "10", { score: 60, humanName: "Top downtime tertinggi" }),
          candidate("b-low", "10", { score: 20, humanName: "Top downtime terendah" }),
        ], periods: [], warnings: [] };
      },
      async planEvidence() {
        return { goals: [
          { kpiBindingId: "b-high", dimensions: ["Departemen"], periodIndex: 0, purpose: "primary" },
          { kpiBindingId: "b-low", dimensions: ["Departemen"], periodIndex: 0, purpose: "primary" },
        ], warnings: [] };
      },
    });
    await answerWithEvidence(envelope({ question: "top 3 downtime tertinggi bulan Juni" }), deps);
    ok("hanya kandidat ranking dengan skor tertinggi dieksekusi", deps.calls.exec === 1,
      String(deps.calls.exec));
  }

  section("Ranking mempertahankan sumber tambahan valid setelah preferred primary");
  {
    const executedDashboards = [];
    const deps = baseDeps({
      async routeEvidence() {
        return { status: "ready", candidates: [
          candidate("b-preferred", "44", { score: 50, sourcePriority: 100 }),
          candidate("b-additional", "65", { score: 80, sourcePriority: 0 }),
        ], periods: [], warnings: [] };
      },
      async planEvidence() {
        return { goals: [
          { kpiBindingId: "b-additional", dimensions: ["Departemen"], periodIndex: 0, purpose: "correlation" },
          { kpiBindingId: "b-preferred", dimensions: ["Departemen"], periodIndex: 0, purpose: "primary" },
        ], warnings: [] };
      },
      async executeEvidencePlan(plan) {
        executedDashboards.push(plan.dashboardId);
        return { status: "success", errorCode: null, attempts: 1, rows: [{ value: 1 }], columns: [],
          rowCount: 1, durationMs: 1, period: plan.period,
          source: { dashboardId: plan.dashboardId, dashboardName: plan.dashboardName } };
      },
    });
    await answerWithEvidence(envelope({ question: "top 3 downtime tertinggi bulan Juni" }), deps);
    ok("preferred dieksekusi dulu dan sumber planner valid tetap diambil",
      JSON.stringify(executedDashboards) === JSON.stringify(["44", "65"]),
      JSON.stringify(executedDashboards));
  }

  section("Fallback deterministic mengambil semua comparison period");
  {
    const builtPeriods = [];
    const deps = baseDeps({
      resolvePeriods() {
        return [
          { label: "Bulan lalu", from: "2026-07-01", to: "2026-07-31" },
          { label: "Bulan ini", from: "2026-08-01", to: "2026-08-31" },
        ];
      },
      async planEvidence() { return { goals: [], warnings: ["PLANNER_FAILED"] }; },
      buildDaxPlan({ goal, binding, period }) {
        builtPeriods.push({ index: goal.periodIndex, from: period.from });
        return { semanticModel: binding.semanticModel, dashboardId: binding.dashboardId,
          dashboardName: binding.dashboardName, dax: "EVALUATE 1",
          selectedKpis: [{ bindingId: binding.bindingId, humanName: binding.humanName }], period, maxRows: 500 };
      },
    });
    await answerWithEvidence(envelope({ question: "bandingkan lembur bulan lalu dan bulan ini" }), deps);
    ok("kedua periode dieksekusi", JSON.stringify(builtPeriods) === JSON.stringify([
      { index: 0, from: "2026-07-01" }, { index: 1, from: "2026-08-01" },
    ]), JSON.stringify(builtPeriods));
  }

  section("Planner menerima isi conversation, bukan hanya id");
  {
    let received;
    const deps = baseDeps({
      async planEvidence(input) {
        received = input.conversation;
        return { goals: [{ kpiBindingId: "b1", dimensions: [], periodIndex: 0, purpose: "primary" }], warnings: [] };
      },
    });
    await answerWithEvidence(envelope({
      conversationId: "conv-1",
      conversation: [{ role: "user", text: "fokus Produksi A" }, { role: "assistant", text: "siap" }],
    }), deps);
    ok("conversation turns diteruskan", received?.length === 2 && received[0].text.includes("Produksi A"),
      JSON.stringify(received));
  }

  section("DAX gagal -> snapshot fallback transparan");
  {
    const deps = baseDeps({
      async executeEvidencePlan(plan, injected) {
        this.calls.exec += 1;
        await injected.tracker?.event?.("dax_attempt", { status: "started" });
        return { status: "failed", errorCode: "POWERBI_TIMEOUT", attempts: 2, rows: [], columns: [], rowCount: 0, durationMs: 9, period: plan.period, source: {} };
      },
      async synthesizeEvidence(input) {
        this.calls.synth += 1;
        const hasSnap = Boolean(input.snapshotFallback);
        return { answer: hasSnap ? "Ringkasan snapshot." : "kosong", confidence: "low",
          retrievalMethod: hasSnap ? "snapshot" : "none", sources: [], warnings: ["SNAPSHOT_FALLBACK_USED"], usage: null };
      },
    });
    const a = await answerWithEvidence(envelope({ snapshotFallback: { text: "ringkasan", period: { label: "Aktual" }, dashboards: [{ id: 10, name: "Lembur" }] } }), deps);
    ok("answer tidak kosong walau DAX gagal", a.answer.length > 0);
    ok("retrievalMethod snapshot", a.retrievalMethod === "snapshot", a.retrievalMethod);
    ok("event snapshot_fallback ada", deps.calls.tracker.events.some((e) => e.stage === "snapshot_fallback"));
    ok("warning fallback terbawa", a.warnings.includes("SNAPSHOT_FALLBACK_USED"));
  }

  section("Tidak ada KPI relevan");
  {
    const deps = baseDeps({
      async routeEvidence() { return { status: "no_match", errorCode: "NO_RELEVANT_KPI", candidates: [], suggestions: ["lembur"], warnings: [] }; },
      async synthesizeEvidence() { this.calls.synth += 1; return { answer: "Bukti belum tersedia.", confidence: "low", retrievalMethod: "none", sources: [], warnings: [], usage: null }; },
    });
    const a = await answerWithEvidence(envelope(), deps);
    ok("warning NO_RELEVANT_KPI", a.warnings.includes("NO_RELEVANT_KPI"));
    ok("execute tidak dipanggil", deps.calls.exec === 0, String(deps.calls.exec));
    ok("answer tetap ada (bukan blank)", a.answer.length > 0);
    ok("retrievalMethod none", a.retrievalMethod === "none");
  }

  section("Akses ditolak");
  {
    const deps = baseDeps({
      async resolveEvidenceScope() { this.calls.scope += 1; return { allowedDashboardIds: [], preferredDashboardIds: [], deniedPreferredDashboardIds: [], mode: "user_acl", denied: true, errorCode: "ACCESS_DENIED" }; },
    });
    const a = await answerWithEvidence(envelope(), deps);
    ok("warning ACCESS_DENIED", a.warnings.includes("ACCESS_DENIED"));
    ok("router tidak dipanggil", deps.calls.route === 0);
    ok("execute tidak dipanggil", deps.calls.exec === 0);
    ok("answer tidak blank", a.answer.length > 0);
    ok("event scope_resolved ada", deps.calls.tracker.events.some((e) => e.stage === "scope_resolved"));
  }

  section("Maksimum empat ronde");
  {
    const deps = baseDeps({
      async routeEvidence() {
        return { status: "ready", candidates: ["b1", "b2", "b3", "b4", "b5", "b6"].map((id, i) => candidate(id, String(10 + i))), periods: [], warnings: [] };
      },
      async analyzeEvidenceGap({ round }) {
        this.calls.gap += 1;
        return { complete: false, missing: ["x"], additionalGoals: [{ kpiBindingId: `b${round + 1}`, dimensions: [], periodIndex: 0, purpose: "correlation" }], warnings: [] };
      },
    });
    const a = await answerWithEvidence(envelope(), deps);
    ok("berhenti di 4 ronde", a.rounds === 4, String(a.rounds));
    ok("execute maksimum 4 kali", deps.calls.exec === 4, String(deps.calls.exec));
  }

  section("Goal berulang tidak dieksekusi ulang (satu eksekusi per plan)");
  {
    const deps = baseDeps({
      async analyzeEvidenceGap() {
        this.calls.gap += 1;
        return { complete: false, missing: ["x"], additionalGoals: [{ kpiBindingId: "b1", dimensions: ["Departemen"], periodIndex: 0, purpose: "primary" }], warnings: [] };
      },
    });
    const a = await answerWithEvidence(envelope(), deps);
    ok("execute hanya sekali walau goal diulang", deps.calls.exec === 1, String(deps.calls.exec));
    ok("tetap berhenti di 4 ronde", a.rounds === 4, String(a.rounds));
  }

  section("Agregasi token planner + synthesis");
  {
    const deps = baseDeps();
    const a = await answerWithEvidence(envelope(), deps);
    ok("inputTokens = 5+7", a.usage.inputTokens === 12, String(a.usage.inputTokens));
    ok("outputTokens = 3+11", a.usage.outputTokens === 14, String(a.usage.outputTokens));
    ok("totalTokens = 26", a.usage.totalTokens === 26, String(a.usage.totalTokens));
  }

  section("Seluruh event memakai requestId yang sama");
  {
    const deps = baseDeps();
    const a = await answerWithEvidence(envelope({ requestId: "REQ-SAME" }), deps);
    ok("answer requestId sama", a.requestId === "REQ-SAME");
    ok("semua event requestId sama", deps.calls.tracker.events.every((e) => e.requestId === "REQ-SAME"),
      JSON.stringify(deps.calls.tracker.events.map((e) => e.stage)));
    const stages = deps.calls.tracker.events.map((e) => e.stage);
    for (const s of ["scope_resolved", "route_candidates", "ai_plan", "dax_attempt", "evidence_gap", "ai_synthesis", "response_sent"]) {
      ok(`event ${s} tercatat`, stages.includes(s), stages.join(","));
    }
    ok("telemetry finish dipanggil", deps.calls.tracker.finished != null);
  }

  section("Kegagalan dependency tak terduga tidak menghasilkan jawaban kosong");
  {
    const deps = baseDeps({
      async routeEvidence() { throw new Error("boom tak terduga"); },
    });
    const a = await answerWithEvidence(envelope(), deps);
    ok("answer tetap ada (bukan blank)", a.answer.length > 0, a.answer);
    ok("retrievalMethod none tanpa snapshot", a.retrievalMethod === "none", a.retrievalMethod);
    ok("telemetry fail dipanggil", deps.calls.tracker.failed != null);
  }
} finally { /* no shared state */ }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

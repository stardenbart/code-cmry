import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { planEvidence } from "../src/services/cia/evidencePlanner.js";
import { answerWithEvidence } from "../src/services/cia/evidenceOrchestrator.js";
import { analyzeEvidenceGap } from "../src/services/cia/evidenceGapAnalyzer.js";
import { synthesizeEvidence } from "../src/services/cia/evidenceSynthesizer.js";
import { buildVisualBlueprint } from "../src/services/cia/visualBlueprint.js";

const period = { label: "Juni 2026", from: "2026-06-01", to: "2026-06-30" };
const binding = (bindingId, humanName, metricRole) => ({
  bindingId, humanName, metricRole, dashboardId: "44", dashboardName: "Maintenance Downtime",
  semanticModel: "Maintenance Downtime", tableName: "Measures", measureName: bindingId,
  dateTable: "Calendar", dateColumn: "Date", dimensions: ["Mesin"],
  anchorMatches: [humanName.toLowerCase().includes("running") ? "running hours" : "downtime"],
});
const modelGoals = (goals) => async () => ({
  text: JSON.stringify({ goals, followUpSignals: [] }),
});

section("Planner mempertahankan peran metrik komposit");
const downtimePlan = await planEvidence({
  question: "berapa persentase downtime Evergreen terhadap running hours",
  periods: [period],
  candidateBindings: [
    binding("b-downtime", "Durasi downtime", "numerator"),
    binding("b-running", "Running hours", "denominator"),
  ],
}, { callModel: modelGoals([
  { kpiBindingId: "b-downtime", dimensions: ["Mesin"], periodIndex: 0, purpose: "primary", metricRole: "numerator" },
  { kpiBindingId: "b-running", dimensions: ["Mesin"], periodIndex: 0, purpose: "primary", metricRole: "denominator" },
]) });
ok("downtime percentage memiliki denominator",
  downtimePlan.goals.some((goal) => goal.metricRole === "numerator")
    && downtimePlan.goals.some((goal) => goal.metricRole === "denominator"),
  JSON.stringify(downtimePlan.goals));

const productionPlan = await planEvidence({
  question: "berapa achievement produksi terhadap target",
  periods: [period],
  candidateBindings: [
    binding("b-actual", "Actual produksi", "primary"),
    binding("b-target", "Target produksi", "target"),
  ],
}, { callModel: modelGoals([
  { kpiBindingId: "b-actual", dimensions: [], periodIndex: 0, purpose: "primary", metricRole: "primary" },
  { kpiBindingId: "b-target", dimensions: [], periodIndex: 0, purpose: "primary", metricRole: "target" },
]) });
ok("achievement memiliki actual dan target",
  productionPlan.goals.some((goal) => goal.metricRole === "primary")
    && productionPlan.goals.some((goal) => goal.metricRole === "target"),
  JSON.stringify(productionPlan.goals));

section("Orchestrator menandai evidence dashboard dan mesin yang tidak sesuai");
let synthesisInput;
const maintenance = binding("b-downtime", "Durasi downtime", "primary");
const tracker = { event: async () => {}, finish: async () => {}, fail: async () => {} };
const mismatchDeps = {
  startCiaTelemetry: async () => tracker,
  resolveEvidenceScope: async () => ({
    allowedDashboardIds: ["44"], preferredDashboardIds: [], deniedPreferredDashboardIds: [],
    mode: "user_acl", denied: false,
  }),
  buildIntentFrame: () => ({
    concepts: ["downtime"], entities: [{ type: "machine", value: "evergreen" }],
    operations: ["calculation"], sourceConstraints: [{ type: "dashboard", value: "maintenance downtime" }],
    contextSources: [], contextPeriods: [], context: { sources: [], entities: [], periods: [], goals: [] },
  }),
  resolvePeriods: () => [period],
  routeEvidence: async () => ({ status: "ready", candidates: [maintenance], warnings: [] }),
  planEvidence: async () => ({ goals: [{
    kpiBindingId: "b-downtime", dimensions: ["Mesin"], periodIndex: 0,
    purpose: "primary", metricRole: "primary", filters: [{ dimension: "Mesin", value: "Evergreen" }],
  }], warnings: [] }),
  getSchema: async () => ({ model: "Maintenance Downtime", tabel: [], measure: [] }),
  buildDaxPlan: ({ binding: selected, period: selectedPeriod }) => ({
    semanticModel: selected.semanticModel, dashboardId: selected.dashboardId,
    dashboardName: selected.dashboardName, selectedKpis: [{ humanName: selected.humanName }],
    period: selectedPeriod, selectedFilters: [{ humanName: "Mesin", value: "Evergreen" }], dax: "EVALUATE 1",
  }),
  executeEvidencePlan: async () => ({
    status: "success", rows: [{ Mesin: "ORS", "Durasi downtime": 91 }],
    columns: [{ label: "Mesin" }, { label: "Durasi downtime" }], rowCount: 1, period,
    source: { dashboardId: "65", dashboardName: "Dashboard DT ORS", semanticModel: "DT ORS", kpis: ["Durasi downtime"] },
  }),
  analyzeEvidenceGap: async () => ({ complete: true, missing: [], additionalGoals: [], warnings: [] }),
  synthesizeEvidence: async (input) => {
    synthesisInput = input;
    return { answer: "Bukti tidak cocok.", confidence: "low", retrievalMethod: "none", sources: [], warnings: [] };
  },
};
const answer = await answerWithEvidence({
  surface: "dashboard", actor: { userId: 1 }, requestId: "REQ-COMPOSITE",
  question: "berapa downtime Evergreen dari dashboard Maintenance Downtime bulan Juni",
}, mismatchDeps);
ok("evidence ORS untuk Evergreen ditandai tidak relevan",
  synthesisInput?.evidence?.[0]?.intentMatch?.entities === false
    && synthesisInput?.evidence?.[0]?.intentMatch?.source === false,
  JSON.stringify(synthesisInput?.evidence?.[0]?.intentMatch));
ok("pipeline tidak mengganti jawaban dengan row ORS", !answer.answer.includes("ORS"), answer.answer);

section("Entity tanggal dinilai oleh period guard, bukan entity guard");
const dayPeriod = { label: "20 Agustus 2026", from: "2026-08-20", to: "2026-08-20" };
let dateSynthesisInput;
await answerWithEvidence({
  surface: "dashboard", actor: { userId: 1 }, requestId: "REQ-DATE-ENTITY",
  question: "berapa downtime tanggal 20 Agustus",
}, {
  ...mismatchDeps,
  buildIntentFrame: () => ({
    concepts: ["downtime"], entities: [{ type: "date", value: "20 agustus" }],
    operations: ["calculation"], sourceConstraints: [], contextSources: [], contextPeriods: [],
    context: { sources: [], entities: [], periods: [], goals: [] },
  }),
  resolvePeriods: () => [dayPeriod],
  executeEvidencePlan: async () => ({
    status: "success", rows: [{ Tanggal: "2026-08-20", "Durasi downtime": 42 }],
    columns: [{ label: "Tanggal" }, { label: "Durasi downtime" }], rowCount: 1, period: dayPeriod,
    source: { dashboardId: "44", dashboardName: "Maintenance Downtime",
      semanticModel: "Maintenance Downtime", kpis: ["Durasi downtime"] },
  }),
  synthesizeEvidence: async (input) => {
    dateSynthesisInput = input;
    return { answer: "Downtime 42 menit.", confidence: "high", retrievalMethod: "live_dax", sources: [], warnings: [] };
  },
});
ok("tanggal eksplisit tidak salah ditolak sebagai business entity",
  dateSynthesisInput?.evidence?.[0]?.intentMatch?.entities === true
    && dateSynthesisInput?.evidence?.[0]?.intentMatch?.period === true,
  JSON.stringify(dateSynthesisInput?.evidence?.[0]?.intentMatch));

let cmdSynthesisInput;
await answerWithEvidence({
  surface: "dashboard", actor: { userId: 1 }, requestId: "REQ-CMD-ENTITY", question: "downtime CMD1",
}, {
  ...mismatchDeps,
  buildIntentFrame: () => ({
    concepts: ["downtime"], entities: [{ type: "cmd", value: "cmd 1" }],
    operations: [], sourceConstraints: [], contextSources: [], contextPeriods: [],
    context: { sources: [], entities: [], periods: [], goals: [] },
  }),
  executeEvidencePlan: async () => ({
    status: "success", rows: [{ "CMD / Gedung": "CMD1", "Durasi downtime": 42 }],
    columns: [{ label: "CMD / Gedung" }, { label: "Durasi downtime" }], rowCount: 1, period,
    source: { dashboardId: "44", dashboardName: "Maintenance Downtime",
      semanticModel: "Maintenance Downtime", kpis: ["Durasi downtime"] },
  }),
  synthesizeEvidence: async (input) => {
    cmdSynthesisInput = input;
    return { answer: "Downtime 42 menit.", confidence: "high", retrievalMethod: "live_dax", sources: [], warnings: [] };
  },
});
ok("CMD dengan variasi spasi tetap cocok",
  cmdSynthesisInput?.evidence?.[0]?.intentMatch?.entities === true,
  JSON.stringify(cmdSynthesisInput?.evidence?.[0]?.intentMatch));

async function entityMatchFor(entity, row) {
  let captured;
  await answerWithEvidence({
    surface: "dashboard", actor: { userId: 1 }, requestId: `REQ-ENTITY-${entity.value}`,
    question: "uji entity",
  }, {
    ...mismatchDeps,
    buildIntentFrame: () => ({
      concepts: ["downtime"], entities: [entity], operations: [], sourceConstraints: [],
      contextSources: [], contextPeriods: [], context: { sources: [], entities: [], periods: [], goals: [] },
    }),
    executeEvidencePlan: async () => ({
      status: "success", rows: [row], columns: Object.keys(row).map((label) => ({ label })),
      rowCount: 1, period,
      source: { dashboardId: "44", dashboardName: "Maintenance Downtime",
        semanticModel: "Maintenance Downtime", kpis: ["Durasi downtime"] },
    }),
    synthesizeEvidence: async (input) => {
      captured = input.evidence[0]?.intentMatch?.entities;
      return { answer: "Uji.", confidence: "low", retrievalMethod: "none", sources: [], warnings: [] };
    },
  });
  return captured;
}

ok("CMD1 tidak cocok dengan CMD10",
  await entityMatchFor({ type: "cmd", value: "cmd 1" }, { "CMD / Gedung": "CMD10", Nilai: 1 }) === false);
ok("Tetra Pak Line 3 tidak cocok dengan Line 30",
  await entityMatchFor({ type: "machine", value: "tetra pak line 3" },
    { Mesin: "Tetra Pak Line 30", Nilai: 1 }) === false);

section("Semua entitas IntentFrame menjadi filter DAX sebelum eksekusi");
let entityFiltersSeen;
const entityBinding = {
  ...maintenance,
  dimensions: [
    { table: "Dim", column: "Machine", humanName: "Mesin" },
    { table: "Dim", column: "Product", humanName: "Produk" },
    { table: "Dim", column: "Plant", humanName: "Plant" },
    { table: "Dim", column: "Building", humanName: "CMD / Gedung" },
  ],
};
await answerWithEvidence({
  surface: "dashboard", actor: { userId: 1 }, requestId: "REQ-ALL-ENTITIES",
  question: "downtime tetra pak line 3 uht milk 250ml plant pasuruan cmd 1",
}, {
  ...mismatchDeps,
  buildIntentFrame: () => ({
    concepts: ["downtime"],
    entities: [
      { type: "machine", value: "tetra pak line 3" },
      { type: "product", value: "uht milk 250ml" },
      { type: "plant", value: "plant pasuruan" },
      { type: "cmd", value: "cmd 1" },
    ],
    operations: [], sourceConstraints: [], contextSources: [], contextPeriods: [],
    context: { sources: [], entities: [], periods: [], goals: [] },
  }),
  routeEvidence: async () => ({ status: "ready", candidates: [entityBinding], warnings: [] }),
  planEvidence: async () => { throw new Error("planner unavailable"); },
  buildDaxPlan: ({ binding: selected, period: selectedPeriod, explicitFilters }) => {
    entityFiltersSeen = explicitFilters;
    return {
      semanticModel: selected.semanticModel, dashboardId: selected.dashboardId,
      dashboardName: selected.dashboardName, selectedKpis: [{ humanName: selected.humanName }],
      period: selectedPeriod,
      selectedFilters: explicitFilters.map((filter) => ({ humanName: filter.dimension, value: filter.value })),
      dax: "EVALUATE 1",
    };
  },
  executeEvidencePlan: async () => ({
    status: "success",
    rows: [{ Mesin: "Tetra Pak Line 3", Produk: "UHT Milk 250ml", Plant: "Plant Pasuruan",
      "CMD / Gedung": "CMD1", Nilai: 42 }],
    columns: [], rowCount: 1, period,
    source: { dashboardId: "44", dashboardName: "Maintenance Downtime",
      semanticModel: "Maintenance Downtime", kpis: ["Durasi downtime"] },
  }),
});
ok("machine/product/plant/cmd seluruhnya diterjemahkan dari intent, bukan regex CMD khusus",
  [
    ["Mesin", "tetra pak line 3"], ["Produk", "uht milk 250ml"],
    ["Plant", "plant pasuruan"], ["CMD / Gedung", "CMD1"],
  ].every(([dimension, value]) => entityFiltersSeen?.some((filter) =>
    filter.dimension === dimension && filter.value === value)),
  JSON.stringify(entityFiltersSeen));

section("Row entitas tidak relevan dibuang sebelum top/truncation synthesis");
const filteredSynthesis = await synthesizeEvidence({
  question: "top 5 downtime Evergreen",
  intentFrame: { entities: [{ type: "machine", value: "evergreen" }] },
  evidence: [{
    status: "success", intentMatch: { concepts: true, entities: true, period: true, source: true },
    rows: [
      ...Array.from({ length: 20 }, (_, index) => ({ Mesin: `ORS ${index + 1}`, "Durasi downtime": 100 - index })),
      { Mesin: "Evergreen", "Durasi downtime": 42 },
    ],
    columns: [{ key: "Mesin", label: "Mesin" }, { key: "Durasi downtime", label: "Durasi downtime" }],
    rowCount: 21, period,
    source: { dashboardId: "44", dashboardName: "Maintenance Downtime",
      semanticModel: "Maintenance Downtime", kpis: ["Durasi downtime"] },
  }],
}, {
  sanitizer: { sanitizeSnapshot: (value) => value, sanitizeText: (value) => String(value) },
  callModel: async () => { throw new Error("force deterministic synthesis"); },
});
ok("row Evergreen di luar 20 row awal tetap dipakai dan ORS tidak bocor",
  filteredSynthesis.answer.includes("Evergreen") && !filteredSynthesis.answer.includes("ORS"),
  filteredSynthesis.answer);

section("Recovery deterministic tidak melampaui enam goal planner");
let executions = 0;
const candidates = Array.from({ length: 7 }, (_, index) => ({
  ...binding(`b-${index + 1}`, `KPI ${index + 1}`, "primary"),
  score: index === 0 ? 100 : 10,
}));
await answerWithEvidence({
  surface: "dashboard", actor: { userId: 1 }, requestId: "REQ-GOAL-CAP", question: "bandingkan KPI",
}, {
  startCiaTelemetry: async () => tracker,
  resolveEvidenceScope: async () => ({
    allowedDashboardIds: ["44"], preferredDashboardIds: [], deniedPreferredDashboardIds: [],
    mode: "user_acl", denied: false,
  }),
  buildIntentFrame: () => ({
    concepts: [], entities: [], operations: ["comparison"], sourceConstraints: [],
    contextSources: [], contextPeriods: [], context: { sources: [], entities: [], periods: [], goals: [] },
  }),
  resolvePeriods: () => [period],
  routeEvidence: async () => ({ status: "ready", candidates, warnings: [] }),
  planEvidence: async () => ({
    goals: candidates.slice(1).map((candidate) => ({
      kpiBindingId: candidate.bindingId, dimensions: [], periodIndex: 0, purpose: "primary", metricRole: "primary",
    })),
    warnings: [],
  }),
  getSchema: async () => ({ model: "Maintenance Downtime", tabel: [], measure: [] }),
  buildDaxPlan: ({ binding: selected, period: selectedPeriod }) => ({
    semanticModel: selected.semanticModel, dashboardId: selected.dashboardId,
    dashboardName: selected.dashboardName, selectedKpis: [{ humanName: selected.humanName }],
    period: selectedPeriod, dax: "EVALUATE 1",
  }),
  executeEvidencePlan: async (plan) => {
    executions += 1;
    return { status: "success", rows: [{ Nilai: 1 }], columns: [{ label: "Nilai" }],
      rowCount: 1, period: plan.period, source: { dashboardId: plan.dashboardId, dashboardName: plan.dashboardName } };
  },
  analyzeEvidenceGap: async () => ({ complete: true, missing: [], additionalGoals: [], warnings: [] }),
  synthesizeEvidence: async () => ({
    answer: "Enam KPI dibandingkan.", confidence: "high", retrievalMethod: "live_dax", sources: [], warnings: [],
  }),
});
ok("maksimum enam goal dieksekusi", executions === 6, String(executions));

section("Evidence mismatch dapat diambil ulang secara bounded");
let denominatorExecutions = 0;
const numerator = { ...binding("b-dt", "Durasi downtime", "numerator"),
  blueprint: { role: "numerator", dimensions: [{ column: "Mesin", humanName: "Mesin" }] } };
const denominator = { ...binding("b-hours", "Running hours", "denominator"),
  blueprint: { role: "denominator", dimensions: [{ column: "Mesin", humanName: "Mesin" }] } };
await answerWithEvidence({
  surface: "dashboard", actor: { userId: 1 }, requestId: "REQ-RETRY-MISMATCH",
  question: "berapa persentase downtime Evergreen terhadap running hours",
}, {
  ...mismatchDeps,
  buildIntentFrame: () => ({
    concepts: ["downtime", "running hours"], entities: [{ type: "machine", value: "evergreen" }],
    operations: ["calculation"], sourceConstraints: [], contextSources: [], contextPeriods: [],
    context: { sources: [], entities: [], periods: [], goals: [] },
  }),
  routeEvidence: async () => ({ status: "ready", candidates: [numerator, denominator], warnings: [] }),
  planEvidence: async () => ({ goals: [
    { kpiBindingId: "b-dt", dimensions: ["Mesin"], periodIndex: 0, purpose: "primary", metricRole: "numerator" },
    { kpiBindingId: "b-hours", dimensions: ["Mesin"], periodIndex: 0, purpose: "primary", metricRole: "denominator" },
  ], warnings: [] }),
  buildDaxPlan: ({ binding: selected, period: selectedPeriod }) => ({
    semanticModel: selected.semanticModel, dashboardId: selected.dashboardId,
    dashboardName: selected.dashboardName, selectedKpis: [{ bindingId: selected.bindingId, humanName: selected.humanName }],
    period: selectedPeriod, selectedFilters: [{ humanName: "Mesin", value: "Evergreen" }], dax: "EVALUATE 1",
  }),
  executeEvidencePlan: async (plan) => {
    const isDenominator = plan.selectedKpis[0].bindingId === "b-hours";
    if (isDenominator) denominatorExecutions += 1;
    const mismatch = isDenominator && denominatorExecutions === 1;
    return {
      status: "success", rows: [{ Mesin: mismatch ? "ORS" : "Evergreen", Nilai: 42 }],
      columns: [{ label: "Mesin" }, { label: "Nilai" }], rowCount: 1, period: plan.period,
      source: { dashboardId: mismatch ? "65" : "44",
        dashboardName: mismatch ? "Dashboard DT ORS" : "Maintenance Downtime",
        semanticModel: mismatch ? "DT ORS" : "Maintenance Downtime", kpis: [plan.selectedKpis[0].humanName] },
    };
  },
  analyzeEvidenceGap,
  synthesizeEvidence: async () => ({
    answer: "Bukti relevan tersedia.", confidence: "high", retrievalMethod: "live_dax", sources: [], warnings: [],
  }),
});
ok("denominator yang salah diulang lalu diterima", denominatorExecutions === 2, String(denominatorExecutions));

section("Planner gagal tetap memakai relasi komposit dari metadata binding produksi");
function reviewedKpi({ slug, humanName, measureName, score, anchors, dashboardId = "44" }) {
  const rawBinding = {
    bindingId: `binding-${slug}`, dashboardId,
    dashboardName: dashboardId === "70" ? "Production dan PO" : "Maintenance Downtime",
    semanticModel: dashboardId === "70" ? "Production Model" : "Maintenance Downtime",
    tableName: "Facts", measureName, displayCaption: humanName,
    visualTitle: humanName, dateTable: "Calendar", dateColumn: "Date",
    dimensions: [{ table: "Dim", column: "Machine", humanName: "Mesin" }],
    verificationStatus: "confirmed",
  };
  return {
    kpiId: slug, slug, humanName, score, anchorMatches: anchors,
    bindings: [{ ...rawBinding, blueprint: buildVisualBlueprint(rawBinding) }],
  };
}

async function fallbackRoles(question, kpis) {
  const captured = [];
  await answerWithEvidence({
    surface: "dashboard", actor: { userId: 1 }, requestId: `REQ-FALLBACK-${captured.length}`, question,
  }, {
    startCiaTelemetry: async () => tracker,
    resolveEvidenceScope: async () => ({
      allowedDashboardIds: ["44", "70"], preferredDashboardIds: [], deniedPreferredDashboardIds: [],
      mode: "user_acl", denied: false,
    }),
    getIntentVocabulary: async () => ({}),
    resolvePeriods: () => [period],
    routerDeps: { searchKpiCandidates: async () => kpis, getDashboardVocabulary: async () => ({}) },
    planEvidence: async () => { throw new Error("planner unavailable"); },
    getSchema: async () => ({ model: "unused", tabel: [], measure: [] }),
    buildDaxPlan: ({ goal, binding: selected, period: selectedPeriod, explicitFilters }) => {
      captured.push({ bindingId: goal.kpiBindingId, metricRole: goal.metricRole });
      return {
        semanticModel: selected.semanticModel, dashboardId: selected.dashboardId,
        dashboardName: selected.dashboardName, selectedKpis: [{ humanName: selected.humanName }],
        period: selectedPeriod, selectedFilters: explicitFilters, dax: "EVALUATE 1",
      };
    },
    executeEvidencePlan: async (plan) => ({
      status: "success", rows: [{ Nilai: 42 }], columns: [{ label: "Nilai" }], rowCount: 1,
      period: plan.period, source: { dashboardId: plan.dashboardId, dashboardName: plan.dashboardName,
        semanticModel: plan.semanticModel, kpis: plan.selectedKpis.map((item) => item.humanName) },
    }),
    analyzeEvidenceGap: async () => ({ complete: true, missing: [], additionalGoals: [], warnings: [] }),
    synthesizeEvidence: async () => ({
      answer: "Bukti komposit tersedia.", confidence: "high", retrievalMethod: "live_dax", sources: [], warnings: [],
    }),
  });
  return captured;
}

const downtimeFallback = await fallbackRoles(
  "berapa persentase downtime terhadap running hours",
  [
    reviewedKpi({ slug: "downtime", humanName: "Durasi downtime", measureName: "DOWNTIME", score: 100,
      anchors: ["downtime"] }),
    reviewedKpi({ slug: "running_hours", humanName: "Running hours", measureName: "RUNNING_HOURS", score: 80,
      anchors: ["running hours"] }),
  ],
);
ok("fallback produksi mengeksekusi numerator dan denominator tanpa role palsu dari test",
  ["numerator", "denominator"].every((role) => downtimeFallback.some((goal) => goal.metricRole === role)),
  JSON.stringify(downtimeFallback));

const productionFallback = await fallbackRoles(
  "berapa achievement produksi dibandingkan total PO",
  [
    reviewedKpi({ slug: "actual_production", humanName: "Aktual produksi", measureName: "ACTUAL_PRODUCTION",
      score: 100, anchors: ["production"], dashboardId: "70" }),
    reviewedKpi({ slug: "purchase_order", humanName: "Purchase order", measureName: "TOTAL_PO",
      score: 75, anchors: ["purchase order"], dashboardId: "70" }),
  ],
);
ok("fallback produksi mengeksekusi actual dan target tanpa role palsu dari test",
  ["primary", "target"].every((role) => productionFallback.some((goal) => goal.metricRole === role)),
  JSON.stringify(productionFallback));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

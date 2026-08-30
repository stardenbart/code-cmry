import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { planEvidence } from "../src/services/cia/evidencePlanner.js";
import { buildDaxPlan } from "../src/services/cia/daxPlanBuilder.js";
import { tanyaModelTerstruktur } from "../src/services/modelRouter.js";

const bindings = [
  { bindingId: "b-ot", humanName: "Jam lembur", dashboardId: "dash-ot",
    dimensions: ["Tanggal", "Departemen", "Alasan", "Kategori"] },
  { bindingId: "b-po", humanName: "Purchase Order", dashboardId: "dash-po",
    dimensions: ["Produk", "Jenis PO"] },
];
const objectBindings = [{
  bindingId: "b-object", humanName: "Jam lembur", dashboardId: "dash-ot",
  dimensions: [{ table: "Overtime", column: "Department", humanName: "Departemen" }],
}];
const periods = [
  { from: "2026-07-01", to: "2026-07-31" },
  { from: "2026-08-01", to: "2026-08-28" },
];

function callReturning(text, extra = {}) {
  return async () => ({
    text, provider: "gemini", model: "gemini-test",
    usage: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 },
    ...extra,
  });
}

section("Planner valid difilter terhadap binding dan dimensi allowlist");
const valid = await planEvidence({
  question: "apakah lembur tinggi karena PO naik",
  periods,
  candidateBindings: bindings,
  conversation: [{ role: "user", text: "produksi A" }],
}, { callModel: callReturning(JSON.stringify({
  goals: [
    { kpiBindingId: "b-ot", dimensions: ["Departemen", "Alasan", "Rahasia"], periodIndex: 1, purpose: "primary" },
    { kpiBindingId: "b-po", dimensions: ["Produk"], periodIndex: 1, purpose: "correlation" },
    { kpiBindingId: "b-secret", dimensions: ["Rahasia"], periodIndex: 0, purpose: "primary" },
    { kpiBindingId: "b-po", dimensions: ["Produk"], periodIndex: 99, purpose: "correlation" },
  ],
  followUpSignals: [
    { concept: "permintaan produk", reason: "cek hubungan PO" },
    { concept: "x".repeat(140), reason: "y".repeat(140) },
  ],
})) });
ok("unknown binding dibuang", valid.goals.every((goal) => goal.kpiBindingId !== "b-secret"),
  JSON.stringify(valid.goals));
ok("period index invalid dibuang", valid.goals.length === 2, JSON.stringify(valid.goals));
ok("dimensi di luar binding dibuang",
  JSON.stringify(valid.goals[0].dimensions) === JSON.stringify(["Departemen", "Alasan"]),
  JSON.stringify(valid.goals[0]));
ok("purpose correlation dipertahankan",
  valid.goals.find((goal) => goal.kpiBindingId === "b-po")?.purpose === "correlation");
ok("signal dibatasi 100 karakter",
  valid.followUpSignals[1].concept.length === 100 && valid.followUpSignals[1].reason.length === 100,
  JSON.stringify(valid.followUpSignals[1]));
ok("provider/model/usage diteruskan untuk telemetry",
  valid.provider === "gemini" && valid.model === "gemini-test" && valid.usage?.totalTokenCount === 17,
  JSON.stringify(valid));
ok("hasil valid tanpa warning", valid.warnings.length === 0, JSON.stringify(valid.warnings));

section("Dimension object dipertahankan sebagai label manusia");
const objectDimension = await planEvidence({ question: "lembur per departemen", periods, candidateBindings: objectBindings }, {
  callModel: callReturning(JSON.stringify({
    goals: [{ kpiBindingId: "b-object", dimensions: ["Departemen"], periodIndex: 0, purpose: "primary" }],
    followUpSignals: [],
  })),
});
ok("planner menerima dimension object", objectDimension.goals[0]?.dimensions[0] === "Departemen",
  JSON.stringify(objectDimension));

section("Planner memakai blueprint dan filter policy");
const blueprintBinding = {
  bindingId: "b-blueprint", humanName: "Technical downtime", dashboardId: "dash-dt",
  dimensions: ["Rahasia"],
  blueprint: {
    measures: [{ tableName: "Measures", measureName: "TECHNICAL_DT" }],
    dimensions: [
      { table: "Machine", column: "Machine Name", humanName: "Mesin" },
      { table: "Calendar", column: "Month", humanName: "Bulan" },
    ],
    role: "ranking",
    periodPolicy: { dateTable: "Calendar", dateColumn: "Date", dateLogic: "calendar_day" },
    labels: { visualTitle: "Top Mesin", displayCaption: "Technical Downtime" },
  },
};
const blueprintPlanned = await planEvidence({
  question: "jelaskan evergreen bulan juni",
  periods,
  candidateBindings: [blueprintBinding],
  reportFilters: [{ dimension: "Bulan", value: "August" }],
}, { callModel: callReturning(JSON.stringify({
  goals: [{
    kpiBindingId: "b-blueprint", dimensions: ["Mesin", "Rahasia"], periodIndex: 0,
    purpose: "primary", filters: [{ dimension: "Mesin", value: "Evergreen" }],
  }],
  followUpSignals: [],
})) });
ok("dimensi planner hanya berasal dari blueprint",
  JSON.stringify(blueprintPlanned.goals[0]?.dimensions) === JSON.stringify(["Mesin"]),
  JSON.stringify(blueprintPlanned.goals));
ok("planner mempertahankan filter pertanyaan dan membuang report slicer",
  JSON.stringify(blueprintPlanned.goals[0]?.filters) === JSON.stringify([
    { dimension: "Mesin", value: "Evergreen" },
  ]), JSON.stringify(blueprintPlanned.goals[0]));

let normalizedPrompt;
await planEvidence({
  question: "technical downtime per mesin",
  periods,
  candidateBindings: [{
    bindingId: "b-raw", humanName: "Technical downtime", tableName: "Measures",
    measureName: "TECHNICAL_DT", displayCaption: "Technical Downtime",
    dimensions: [{ table: "Machine", column: "Machine Name", humanName: "Mesin" }],
    dateTable: "Calendar", dateColumn: "Date", dateLogic: "calendar_day",
  }],
}, { callModel: async (args) => {
  normalizedPrompt = JSON.parse(args.question);
  return callReturning(JSON.stringify({ goals: [], followUpSignals: [] }))();
} });
ok("prompt model menerima blueprint yang dibangun planner",
  normalizedPrompt?.candidates?.[0]?.blueprint?.measures?.[0]?.measureName === "TECHNICAL_DT"
    && normalizedPrompt?.candidates?.[0]?.blueprint?.dimensions?.[0]?.humanName === "Mesin",
  JSON.stringify(normalizedPrompt?.candidates?.[0]));

const currentViewPlanned = await planEvidence({
  question: "jelaskan data yang sedang tampil",
  periods,
  candidateBindings: [blueprintBinding],
  reportFilters: [{ dimension: "Month", value: "August" }],
}, { callModel: callReturning(JSON.stringify({
  goals: [{ kpiBindingId: "b-blueprint", dimensions: ["Mesin"], periodIndex: 0, purpose: "primary" }],
  followUpSignals: [],
})) });
ok("nama kolom report dinormalisasi ke label blueprint",
  JSON.stringify(currentViewPlanned.goals[0]?.filters) === JSON.stringify([
    { dimension: "Bulan", value: "August" },
  ]), JSON.stringify(currentViewPlanned.goals[0]));

const associatedViewPlanned = await planEvidence({
  question: "jelaskan data yang sedang tampil",
  periods,
  candidateBindings: [blueprintBinding],
  reportFilters: [
    { dashboardId: "dash-other", dimension: "Month", value: "July" },
    { dashboardId: "dash-dt", dimension: "Month", value: "August" },
  ],
}, { callModel: callReturning(JSON.stringify({
  goals: [{ kpiBindingId: "b-blueprint", dimensions: ["Mesin"], periodIndex: 0, purpose: "primary" }],
  followUpSignals: [],
})) });
ok("planner mengisolasi report filter berdasarkan dashboard binding",
  JSON.stringify(associatedViewPlanned.goals[0]?.filters) === JSON.stringify([
    { dimension: "Bulan", value: "August" },
  ]), JSON.stringify(associatedViewPlanned.goals[0]));

const multiViewPlanned = await planEvidence({
  question: "jelaskan data yang sedang tampil",
  periods,
  candidateBindings: [blueprintBinding],
  reportFilters: [
    { dashboardId: "dash-dt", dimension: "Machine Name", value: "Evergreen" },
    { dashboardId: "dash-dt", dimension: "Machine Name", value: "Tetra Pak" },
  ],
}, { callModel: callReturning(JSON.stringify({
  goals: [{ kpiBindingId: "b-blueprint", dimensions: ["Mesin"], periodIndex: 0, purpose: "primary" }],
  followUpSignals: [],
})) });
ok("planner mempertahankan multi-select pada channel report",
  JSON.stringify(multiViewPlanned.goals[0]?.filters) === JSON.stringify([
    { dimension: "Mesin", value: "Evergreen" },
    { dimension: "Mesin", value: "Tetra Pak" },
  ]), JSON.stringify(multiViewPlanned.goals[0]));

const sevenValueViewPlanned = await planEvidence({
  question: "jelaskan data yang sedang tampil",
  periods,
  candidateBindings: [{ ...blueprintBinding, semanticModel: "Cost Model" }],
  reportFilters: [
    { dashboardId: "dash-dt", dimension: "Machine Name", value: "Evergreen" },
    { dashboardId: "dash-dt", dimension: "Machine Name", value: "Tetra Pak" },
    { dashboardId: "dash-dt", dimension: "Machine Name", value: "Sidel" },
    { dashboardId: "dash-dt", dimension: "Machine Name", value: "Krones" },
    { dashboardId: "dash-dt", dimension: "Machine Name", value: "Serac" },
    { dashboardId: "dash-dt", dimension: "Machine Name", value: "Elopak" },
    { dashboardId: "dash-dt", dimension: "Machine Name", value: "SIG" },
  ],
}, { callModel: callReturning(JSON.stringify({
  goals: [{ kpiBindingId: "b-blueprint", dimensions: ["Mesin"], periodIndex: 0, purpose: "primary" }],
  followUpSignals: [],
})) });
const sevenValueDaxPlan = buildDaxPlan({
  question: "jelaskan data yang sedang tampil",
  goal: sevenValueViewPlanned.goals[0],
  binding: { ...blueprintBinding, semanticModel: "Cost Model" },
  period: periods[0],
  schema: {
    berhasil: true,
    model: "Cost Model",
    tabel: [
      { tabel: "Calendar", kolom: ["Date:datetime", "Month:string"] },
      { tabel: "Machine", kolom: ["Machine Name:string"] },
      { tabel: "Measures", kolom: [] },
    ],
    measure: ["TECHNICAL_DT"],
  },
});
ok("planner ke builder mempertahankan lebih dari enam nilai untuk satu dimensi",
  sevenValueViewPlanned.goals[0]?.filterPolicy?.reportFilters?.length === 7
    && /IN\s*\{\s*"evergreen",\s*"tetrapak",\s*"sidel",\s*"krones",\s*"serac",\s*"elopak",\s*"sig"\s*\}/i
      .test(sevenValueDaxPlan.dax),
  JSON.stringify({ goal: sevenValueViewPlanned.goals[0], dax: sevenValueDaxPlan.dax }));

const contextPlanned = await planEvidence({
  question: "bagaimana masalahnya",
  periods,
  candidateBindings: [blueprintBinding],
  conversation: [{ role: "assistant", text: "Evergreen tertinggi", evidenceContract: {
    concepts: ["technical downtime"],
    goals: [{
      kpiBindingId: "b-blueprint", dimensions: ["Mesin"], periodIndex: 0,
      filters: [{ dimension: "Mesin", value: "Evergreen" }],
    }],
  } }],
}, { callModel: callReturning(JSON.stringify({
  goals: [{ kpiBindingId: "b-blueprint", dimensions: ["Mesin"], periodIndex: 0, purpose: "primary" }],
  followUpSignals: [],
})) });
ok("planner memakai filter context dari evidence contract tanpa parse taxonomy baru",
  contextPlanned.goals[0]?.filters?.[0]?.value === "Evergreen",
  JSON.stringify(contextPlanned.goals[0]));

section("Goal dan dimensi dibatasi");
const capped = await planEvidence({ question: "q", periods, candidateBindings: bindings }, {
  callModel: callReturning(JSON.stringify({
    goals: Array.from({ length: 10 }, (_, index) => ({
      kpiBindingId: index % 2 ? "b-po" : "b-ot",
      dimensions: ["Tanggal", "Departemen", "Alasan", "Kategori", "Produk", "Jenis PO", "lebih"],
      periodIndex: index % 2,
      purpose: index % 2 ? "correlation" : "primary",
    })),
    followUpSignals: [],
  })),
});
ok("maksimum enam goals", capped.goals.length <= 6, String(capped.goals.length));
ok("maksimum enam dimensi", capped.goals.every((goal) => goal.dimensions.length <= 6),
  JSON.stringify(capped.goals));

const filterCappedBinding = {
  bindingId: "b-filter-cap",
  blueprint: {
    dimensions: ["A", "B", "C", "D", "E", "F", "G"].map((column) => ({
      table: "Fact", column, humanName: column,
    })),
  },
};
const filterCapped = await planEvidence({
  question: "q",
  periods,
  candidateBindings: [filterCappedBinding],
}, { callModel: callReturning(JSON.stringify({
  goals: [{
    kpiBindingId: "b-filter-cap", dimensions: [], periodIndex: 0, purpose: "primary",
    filters: ["A", "B", "C", "D", "E", "F", "G"].map((dimension) => ({ dimension, value: "x" })),
  }],
  followUpSignals: [],
})) });
ok("maksimum enam dimensi filter tetap dipertahankan",
  filterCapped.goals[0]?.filterPolicy?.explicitFilters?.length === 6,
  JSON.stringify(filterCapped.goals[0]));

section("Malformed, empty, timeout tidak membatalkan deterministic route");
for (const [label, callModel, warning] of [
  ["invalid JSON", callReturning("bukan json"), "PLANNER_INVALID_JSON"],
  ["empty", callReturning("   "), "PLANNER_EMPTY"],
  ["timeout", async () => { const error = new Error("timeout"); error.code = "ETIMEDOUT"; throw error; }, "PLANNER_TIMEOUT"],
]) {
  const result = await planEvidence({ question: "lembur", periods, candidateBindings: bindings }, { callModel });
  ok(`${label}: goals kosong aman`, result.goals.length === 0, JSON.stringify(result));
  ok(`${label}: warning terstruktur`, result.warnings.includes(warning), JSON.stringify(result.warnings));
}

section("Model router structured call mempertahankan metadata provider");
const routed = await tanyaModelTerstruktur({
  question: "return json", systemInstruction: "JSON only",
  deps: {
    providerTerpilih: async () => "gemini",
    askGemini: async () => ({ text: "{}", model: "gemini-fake",
      usage: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } }),
  },
});
ok("structured call meneruskan text", routed.text === "{}", JSON.stringify(routed));
ok("structured call meneruskan provider/model/usage",
  routed.provider === "gemini" && routed.model === "gemini-fake" && routed.usage.totalTokenCount === 3,
  JSON.stringify(routed));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

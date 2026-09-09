import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { routeEvidence } from "../src/services/cia/evidenceRouter.js";
import { buildIntentFrame } from "../src/services/cia/intentFrame.js";
import { analyzeEvidenceGap } from "../src/services/cia/evidenceGapAnalyzer.js";

const overtime = {
  kpiId: 1, slug: "overtime", humanName: "Jam lembur", score: 40,
  bindings: [{ bindingId: "b-ot", dashboardId: "dash-ot", dashboardName: "Lembur",
    semanticModel: "Cost", tableName: "Measure", measureName: "OT_HOURS",
    dimensions: ["Tanggal", "Departemen", "Alasan", "Kategori"],
    blueprint: {
      measures: [{ tableName: "Measure", measureName: "OT_HOURS" }],
      dimensions: ["Tanggal", "Departemen", "Alasan", "Kategori"], role: "breakdown",
      periodPolicy: { dateTable: "Calendar", dateColumn: "Date" },
      labels: { pageName: "Lembur", visualTitle: "Lembur per Departemen" },
    } }],
};
const deviation = {
  kpiId: 2, slug: "deviation_cmd3", humanName: "Deviasi CMD 3", score: 38,
  bindings: [{ bindingId: "b-dev", dashboardId: "dash-dev", dashboardName: "Quality",
    semanticModel: "Quality", tableName: "Measure", measureName: "NC_CMD3",
    dimensions: ["Kategori", "Deskripsi"] }],
};
const po = {
  kpiId: 3, slug: "ppic_po", humanName: "Purchase Order", score: 32,
  bindings: [{ bindingId: "b-po", dashboardId: "dash-po", dashboardName: "PPIC",
    semanticModel: "PPIC", tableName: "Measure", measureName: "PO_QTY",
    dimensions: ["Produk"] }],
};

const downtime = {
  kpiId: 4, slug: "top_machine_downtime", humanName: "Top mesin downtime tertinggi",
  score: 90, anchorMatches: ["downtime"], sourcePriority: 100,
  bindings: [{ bindingId: "b-dt", dashboardId: "52", dashboardName: "ORS",
    semanticModel: "ORS", tableName: "Measure", measureName: "DT_TOP",
    dimensions: ["Departemen"] }],
};

function fakeSearch({ question }) {
  if (/lembur.*PO|PO.*lembur/i.test(question)) return [overtime, po];
  if (/lembur/i.test(question)) return [overtime];
  if (/deviasi/i.test(question)) return [deviation];
  return [];
}

function makeDeps(events) {
  return {
    searchKpiCandidates: fakeSearch,
    async getDashboardVocabulary() {
      return { "dash-ot": { kpis: ["Jam lembur"], dimensions: ["Departemen"] } };
    },
    tracker: { async event(stage, data) { events.push({ stage, data }); } },
  };
}

const scope = {
  allowedDashboardIds: ["dash-ot", "dash-dev", "dash-po"],
  preferredDashboardIds: [], mode: "user_acl",
};
const periods = [{ from: "2026-08-01", to: "2026-08-28", comparisonKey: "current" }];

section("Business anchor mengalahkan token ranking generik");
let searchInput;
const anchorEvents = [];
const anchoredRoute = await routeEvidence({
  question: "top departemen dengan lembur tertinggi",
  intentFrame: { concepts: ["overtime"], sourceConstraints: [] },
  periods,
  scope: { ...scope, preferredDashboardIds: ["52"] },
}, {
  async searchKpiCandidates(input) {
    searchInput = input;
    return [{ ...overtime, anchorMatches: ["overtime"], sourcePriority: 0 }, downtime];
  },
  async getDashboardVocabulary() { return {}; },
  tracker: { async event(stage, data) { anchorEvents.push({ stage, data }); } },
});
ok("downtime dieliminasi", anchoredRoute.candidates.every((candidate) => candidate.slug !== "top_machine_downtime"),
  JSON.stringify(anchoredRoute.candidates));
ok("intent dan preferred dashboard diteruskan ke library",
  searchInput?.intentFrame?.concepts?.includes("overtime")
    && JSON.stringify(searchInput?.preferredDashboardIds) === JSON.stringify(["52"]),
  JSON.stringify(searchInput));
const anchorRouteEvent = anchorEvents.find((event) => event.stage === "route_candidates");
ok("route telemetry menyimpan concept IDs/count tanpa prompt mentah",
  anchorRouteEvent?.data?.conceptCount === 1
    && anchorRouteEvent?.data?.metadata?.concepts?.includes("overtime")
    && !JSON.stringify(anchorRouteEvent).includes("lembur tertinggi"),
  JSON.stringify(anchorRouteEvent));
ok("router mempertahankan blueprint visual untuk planner dan builder",
  anchoredRoute.candidates[0]?.blueprint?.labels?.visualTitle === "Lembur per Departemen",
  JSON.stringify(anchoredRoute.candidates[0]));

section("Derived concept dari contract penuh mencapai routing dan denominator recovery");
const fullContractFrame = buildIntentFrame({
  question: "berapa persentasenya terhadap used time?",
  conversation: [{ role: "assistant", text: "Downtime tersedia.", evidenceContract: {
    concepts: ["downtime", ...Array.from({ length: 11 }, (_, index) => `stale-${index}`)],
    periods: periods.map((item) => ({ ...item, label: "Agustus", grain: "day" })),
    goals: [], sources: [], entities: [],
  } }],
});
const fullContractRoute = await routeEvidence({
  question: "berapa persentasenya terhadap used time?",
  intentFrame: fullContractFrame,
  periods,
  scope: { ...scope, allowedDashboardIds: ["44"] },
}, {
  async searchKpiCandidates() {
    return [
      { kpiId: 40, slug: "downtime", humanName: "Durasi downtime", score: 10,
        anchorMatches: ["downtime"], bindings: [{
          bindingId: "b-dt-full", dashboardId: "44", dashboardName: "Maintenance",
          semanticModel: "Maintenance", tableName: "Measures", measureName: "DT",
          blueprint: { role: "numerator", dimensions: [] }, dimensions: [],
        }] },
      { kpiId: 41, slug: "running_hours", humanName: "Running hours", score: 9,
        anchorMatches: ["running hours"], bindings: [{
          bindingId: "b-hours-full", dashboardId: "44", dashboardName: "Maintenance",
          semanticModel: "Maintenance", tableName: "Measures", measureName: "HOURS",
          blueprint: { role: "denominator", dimensions: [] }, dimensions: [],
        }] },
    ];
  },
  async getDashboardVocabulary() { return {}; },
});
const fullContractGap = await analyzeEvidenceGap({
  question: "berapa persentasenya terhadap used time?",
  plan: {
    periods, operations: fullContractFrame.operations,
    goals: [{ kpiBindingId: "b-dt-full", periodIndex: 0, dimensions: [], purpose: "primary", metricRole: "numerator" }],
    candidates: fullContractRoute.candidates,
  },
  evidence: [{
    status: "success", goal: { kpiBindingId: "b-dt-full", periodIndex: 0, metricRole: "numerator" },
    period: periods[0], columns: [{ label: "Durasi downtime" }], rows: [{ "Durasi downtime": 42 }],
  }],
  round: 1,
});
ok("running hours tidak terpotong sebelum routing",
  fullContractFrame.concepts.length === 12
    && fullContractFrame.concepts.includes("running hours")
    && fullContractRoute.candidates.some((candidate) => candidate.bindingId === "b-hours-full"),
  JSON.stringify({ concepts: fullContractFrame.concepts, candidates: fullContractRoute.candidates }));
ok("running hours menjadi denominator recovery",
  fullContractGap.additionalGoals.some((goal) => goal.kpiBindingId === "b-hours-full"
    && goal.metricRole === "denominator"),
  JSON.stringify(fullContractGap));

section("Report aktif didahulukan di antara kandidat dengan anchor sama");
const activeReport = await routeEvidence({
  question: "masalah evergreen bulan juni",
  intentFrame: { concepts: ["downtime"], entities: [{ type: "machine", value: "evergreen" }] },
  periods,
  scope: { ...scope, allowedDashboardIds: ["44", "65"], preferredDashboardIds: ["44"] },
}, {
  async searchKpiCandidates() {
    return [
      { ...downtime, score: 90, sourcePriority: 0,
        bindings: [{ ...downtime.bindings[0], bindingId: "b-ors", dashboardId: "65" }] },
      { ...downtime, kpiId: 5, slug: "maintenance_downtime", score: 50, sourcePriority: 100,
        bindings: [{ ...downtime.bindings[0], bindingId: "b-maint", dashboardId: "44" }] },
    ];
  },
  async getDashboardVocabulary() { return {}; },
});
ok("report aktif didahulukan", activeReport.candidates[0]?.dashboardId === "44",
  JSON.stringify(activeReport.candidates));

section("Source eksplisit yang tidak tersedia tidak boleh disubstitusi");
const unavailableSource = await routeEvidence({
  question: "downtime dari report tidak tersedia",
  intentFrame: { concepts: ["downtime"],
    sourceConstraints: [{ type: "report", value: "report-tidak-tersedia" }] },
  periods,
  scope: { ...scope, preferredDashboardIds: ["52"] },
}, {
  async searchKpiCandidates() { return [downtime]; },
  async getDashboardVocabulary() { return {}; },
});
ok("router menghasilkan no_match tanpa kandidat pengganti",
  unavailableSource.status === "no_match" && unavailableSource.candidates.length === 0,
  JSON.stringify(unavailableSource));

section("AI planner kosong tidak boleh membuang deterministic match");
for (const [label, question, bindingId] of [
  ["lembur", "jelaskan breakdown lembur harian per departemen karena alasan dan kategori", "b-ot"],
  ["deviasi", "breakdown issue deviasi cmd 3", "b-dev"],
]) {
  const events = [];
  const result = await routeEvidence({
    question, periods, scope, aiPlanner: async () => ({ candidates: [] }),
  }, makeDeps(events));
  ok(`${label}: route tetap ready`, result.status === "ready", JSON.stringify(result));
  ok(`${label}: deterministic binding tetap ada`, result.candidates.some((item) => item.bindingId === bindingId),
    JSON.stringify(result.candidates));
  ok(`${label}: origin tetap deterministic`, result.candidates.find((item) => item.bindingId === bindingId)?.origin === "deterministic");
  ok(`${label}: planner_no_match tercatat`, events.some((item) => item.stage === "planner_no_match"),
    JSON.stringify(events));
}

section("AI hanya boleh memperkaya binding dari allowlist deterministik");
const events = [];
const correlated = await routeEvidence({
  question: "apakah lembur tinggi karena PO naik",
  periods,
  scope,
  aiPlanner: async () => ({
    candidates: [
      { bindingId: "b-po", dimensions: ["Produk"], purpose: "correlation" },
      { bindingId: "b-secret", dimensions: ["Rahasia"], purpose: "primary" },
      { bindingId: "b-po", dimensions: ["Produk"], purpose: "correlation" },
    ],
    correlationHints: ["overtime_vs_po"],
  }),
}, makeDeps(events));
ok("binding deterministic tidak hilang", correlated.candidates.some((item) => item.bindingId === "b-ot"));
ok("binding known diperkaya AI tanpa duplikasi",
  correlated.candidates.filter((item) => item.bindingId === "b-po").length === 1
    && correlated.candidates.find((item) => item.bindingId === "b-po")?.purpose === "correlation",
  JSON.stringify(correlated.candidates));
ok("binding asing dibuang", correlated.candidates.every((item) => item.bindingId !== "b-secret"),
  JSON.stringify(correlated.candidates));
ok("hint korelasi aman dipertahankan",
  JSON.stringify(correlated.correlationHints) === JSON.stringify(["overtime_vs_po"]),
  JSON.stringify(correlated));
const routeEvent = events.find((item) => item.stage === "route_candidates");
ok("telemetry hanya menyimpan count/id, bukan pertanyaan",
  routeEvent?.data?.metadata?.candidates?.includes("b-ot")
    && routeEvent?.data?.metadata?.candidates?.includes("b-po")
    && !JSON.stringify(routeEvent).includes("apakah lembur"),
  JSON.stringify(routeEvent));

section("Tidak ada kandidat menghasilkan no-match terstruktur");
const noMatchEvents = [];
const noMatch = await routeEvidence({
  question: "berapa warna seragam", periods, scope,
  aiPlanner: async () => ({ candidates: [] }),
}, makeDeps(noMatchEvents));
ok("tidak melempar string generik", noMatch.status === "no_match" && noMatch.errorCode === "NO_RELEVANT_KPI",
  JSON.stringify(noMatch));
ok("membawa vocabulary suggestion yang aman", noMatch.suggestions.includes("Jam lembur"),
  JSON.stringify(noMatch.suggestions));
ok("route candidate count nol tercatat",
  noMatchEvents.some((item) => item.stage === "route_candidates" && item.data?.candidateCount === 0),
  JSON.stringify(noMatchEvents));

section("Salinan visual yang semantik-identik hanya menjadi satu route");
const duplicateRoutes = await routeEvidence({
  question: "top mesin downtime tertinggi",
  periods,
  scope,
}, {
  async searchKpiCandidates() {
    return [{
      kpiId: 9, slug: "top_machine_downtime", humanName: "Top mesin downtime tertinggi", score: 60,
      bindings: [
        { bindingId: "visual-1", bindingKey: "page-a", dashboardId: "65", reportId: "report-ors",
          semanticModel: "ors", tableName: "Measures", measureName: "DT_MIN",
          dateTable: "Dim_Date", dateColumn: "Date", dimensions: ["Dim_Machine[Name]"] },
        { bindingId: "visual-2", bindingKey: "page-b", dashboardId: "66", reportId: "report-ors",
          semanticModel: "ors", tableName: "Measures", measureName: "DT_MIN",
          dateTable: "Dim_Date", dateColumn: "Date", dimensions: ["Dim_Machine[Name]"] },
      ],
    }];
  },
  async getDashboardVocabulary() { return {}; },
});
ok("dua copy visual/report collapse menjadi satu candidate",
  duplicateRoutes.candidates.length === 1, JSON.stringify(duplicateRoutes.candidates));

section("Scope denied berhenti sebelum pencarian KPI");
let searchCalls = 0;
const deniedScope = await routeEvidence({
  question: "lembur", periods,
  scope: { allowedDashboardIds: [], denied: true, errorCode: "ACCESS_DENIED", mode: "user_acl" },
}, {
  async searchKpiCandidates() { searchCalls += 1; return [overtime]; },
  async getDashboardVocabulary() { return {}; },
});
ok("access denied dikembalikan terstruktur",
  deniedScope.status === "access_denied" && deniedScope.errorCode === "ACCESS_DENIED",
  JSON.stringify(deniedScope));
ok("library tidak dipanggil ketika ACL kosong", searchCalls === 0, String(searchCalls));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import {
  CIA_HYBRID_REGRESSION_CASES as CIA_REGRESSION_CASES,
  CIA_HYBRID_EXECUTED_PERIODS as EXPECTED_PERIODS,
} from "./fixtures/cia-regression-cases.mjs";
import * as featureFlags from "../src/config/featureFlags.js";
import { answerWithEvidence } from "../src/services/cia/evidenceOrchestrator.js";
import { buildIntentFrame } from "../src/services/cia/intentFrame.js";
import { runWebEvidence } from "../src/services/cia/webEvidenceAdapter.js";
import { jawabPertanyaanUmum } from "../src/services/whatsappListener.service.js";

const DASHBOARDS = Object.freeze({
  maintenance: { id: "44", name: "Maintenance Downtime", model: "Maintenance Model" },
  technical: { id: "65", name: "Technical Downtime ORS", model: "ORS Model" },
  overtime: { id: "52", name: "Overtime", model: "Overtime Model" },
  deviation: { id: "61", name: "NC dan Deviasi", model: "Quality Model" },
  production: { id: "70", name: "Production dan PO", model: "Production Model" },
});

const DIMENSIONS = Object.freeze([
  { table: "Dimensions", column: "Machine_Name", humanName: "Mesin" },
  { table: "Dimensions", column: "Plant_Name", humanName: "Plant" },
  { table: "Dimensions", column: "Product_Name", humanName: "Produk" },
  { table: "Dimensions", column: "Building_Code", humanName: "CMD / Gedung" },
  { table: "Dimensions", column: "Department_Name", humanName: "Departemen" },
  { table: "Dimensions", column: "Issue_Category", humanName: "Kategori masalah" },
]);

const KPI_DEFINITIONS = Object.freeze([
  { slug: "maintenance_downtime", concepts: ["downtime", "routine downtime"], source: "maintenance", label: "Durasi downtime" },
  { slug: "running_hours", concepts: ["running hours"], source: "maintenance", label: "Jam operasional" },
  { slug: "technical_downtime", concepts: ["downtime"], source: "technical", label: "Technical downtime" },
  { slug: "overtime", concepts: ["overtime"], source: "overtime", label: "Jam lembur" },
  { slug: "overtime_cost", concepts: ["overtime cost"], source: "overtime", label: "Estimasi biaya lembur" },
  { slug: "deviation", concepts: ["deviation"], source: "deviation", label: "Deviasi" },
  { slug: "production", concepts: ["production"], source: "production", label: "Aktual produksi" },
  { slug: "production_output", concepts: ["production output"], source: "production", label: "Output produksi" },
  { slug: "purchase_order", concepts: ["purchase order"], source: "production", label: "Purchase order" },
  { slug: "planning", concepts: ["planning"], source: "production", label: "Rencana produksi" },
]);

const ALL_DASHBOARD_IDS = Object.values(DASHBOARDS).map((item) => item.id);
const TECHNICAL_LABEL = /\b(?:nama_mesin|metric_value|machine_name|building_code)\b|\b[A-Za-z][\w ]*\[[^\]]+\]/i;

function selectedDefinitionSlugs(question, intentFrame) {
  const concepts = new Set(intentFrame.concepts || []);
  if (/tech(?:n)?ical downtime/i.test(question)) return new Set(["technical_downtime"]);
  if (/used time/i.test(question)) return new Set(["maintenance_downtime", "running_hours"]);
  const selected = new Set(KPI_DEFINITIONS
    .filter((item) => item.slug !== "technical_downtime"
      && item.concepts.some((concept) => concepts.has(concept)))
    .map((item) => item.slug));
  if (!selected.size) selected.add("maintenance_downtime");
  return selected;
}

function fakeKpiLibrary(observations) {
  return async ({ question, intentFrame, preferredDashboardIds = [] }) => {
    const selected = selectedDefinitionSlugs(question, intentFrame);
    const explicitSource = new Set((intentFrame.sourceConstraints || []).map((item) => item.value));
    const contextIds = new Set((intentFrame.contextSources || []).map((item) => String(item.dashboardId)));
    const preferredIds = new Set(preferredDashboardIds.map(String));
    const kpis = KPI_DEFINITIONS.map((definition) => {
      const source = DASHBOARDS[definition.source];
      const sourceText = `${source.id} ${source.name}`.toLocaleLowerCase("id-ID");
      const explicitlySelected = explicitSource.size > 0
        && [...explicitSource].some((value) => sourceText.includes(value));
      const score = selected.has(definition.slug) ? 100 : 1;
      const sourcePriority = explicitlySelected ? 300 : contextIds.has(source.id) ? 200
        : preferredIds.has(source.id) ? 100 : 0;
      return {
        kpiId: `kpi-${definition.slug}`,
        slug: definition.slug,
        humanName: definition.label,
        score,
        anchorMatches: definition.concepts,
        sourcePriority,
        bindings: [{
          bindingId: `binding-${definition.slug}`,
          dashboardId: source.id,
          dashboardName: source.name,
          semanticModel: source.model,
          tableName: "Facts",
          measureName: definition.slug.toUpperCase(),
          displayCaption: definition.label,
          dateTable: "Calendar",
          dateColumn: "Date",
          dimensions: DIMENSIONS,
          sourcePriority,
          blueprint: {
            measures: [{ tableName: "Facts", measureName: definition.slug.toUpperCase(), displayCaption: definition.label }],
            dimensions: DIMENSIONS,
            role: "detail",
            periodPolicy: { dateTable: "Calendar", dateColumn: "Date", dateLogic: "calendar_day" },
            labels: { visualTitle: definition.label, displayCaption: definition.label },
          },
        }],
      };
    });
    observations.library.push({
      question, concepts: [...conceptsOf(intentFrame)], selected: [...selected],
      preferredDashboardIds: [...preferredDashboardIds],
    });
    return kpis;
  };
}

function conceptsOf(intentFrame) {
  return Array.isArray(intentFrame?.concepts) ? intentFrame.concepts : [];
}

function metricRole(binding, intent) {
  if (binding.slug === "running_hours") return "denominator";
  if (binding.slug === "maintenance_downtime" && intent.concepts.includes("running hours")) return "numerator";
  if (binding.slug === "purchase_order" || binding.slug === "planning") return "target";
  return "primary";
}

const ENTITY_DIMENSIONS = Object.freeze({
  machine: "Mesin",
  plant: "Plant",
  product: "Produk",
  cmd: "CMD / Gedung",
});

function fakePlannerModel(observations) {
  return async ({ question: packetJson }) => {
    const packet = JSON.parse(packetJson);
    const priorUserText = (packet.conversation || []).filter((turn) => turn.role === "user")
      .map((turn) => turn.text).join(" ");
    const planningQuestion = `${priorUserText} ${packet.question}`.trim();
    const intent = buildIntentFrame({ question: planningQuestion });
    const selected = selectedDefinitionSlugs(packet.question, intent);
    const roleIntent = selected.has("running_hours")
      ? { ...intent, concepts: [...new Set([...(intent.concepts || []), "running hours"])] }
      : intent;
    const candidates = (packet.candidates || []).filter((candidate) =>
      selected.has(String(candidate.bindingId).replace(/^binding-/, "")));
    const filters = intent.entities.flatMap((entity) => ENTITY_DIMENSIONS[entity.type]
      ? [{ dimension: ENTITY_DIMENSIONS[entity.type], value: entity.value }] : []);
    const goals = candidates.slice(0, 6).map((candidate) => {
      const slug = String(candidate.bindingId).replace(/^binding-/, "");
      return {
        kpiBindingId: candidate.bindingId,
        dimensions: (candidate.blueprint?.dimensions || []).map((item) => item.humanName),
        filters,
        periodIndex: 0,
        purpose: "primary",
        metricRole: metricRole({ slug }, roleIntent),
      };
    });
    observations.plannerCalls.push({ question: packet.question, goals });
    return { text: JSON.stringify({ goals, followUpSignals: [] }), usage: null };
  };
}

function fakeSchema(semanticModel) {
  return {
    berhasil: true,
    model: semanticModel,
    datasetId: "fake-dataset",
    tabel: [
      { tabel: "Facts", kolom: [] },
      { tabel: "Calendar", kolom: ["Date"] },
      { tabel: "Dimensions", kolom: DIMENSIONS.map((item) => item.column) },
    ],
    measure: KPI_DEFINITIONS.map((item) => item.slug.toUpperCase()),
  };
}

const ENTITY_DISPLAY = new Map(CIA_REGRESSION_CASES.flatMap((item) => item.expectsEntities)
  .concat(["evergreen"])
  .map((value) => [value.toLocaleLowerCase("id-ID").replace(/\s+/g, ""), value]));

function fakeExecuteEvidencePlan(observations) {
  return async (plan) => {
    observations.executions.push({ ...plan, acceptanceId: observations.currentId });
    const dimensionColumns = (plan.selectedDimensions || []).map((dimension) => ({
      key: `${dimension.table}[${dimension.column}]`, label: dimension.humanName,
    }));
    const filterRows = (plan.selectedFilters || []).map((filter) => ({
      [`${filter.table}[${filter.column}]`]: ENTITY_DISPLAY.get(filter.value) || filter.value,
      [plan.labelBindings[0].humanName]: "tersedia",
    }));
    return {
      status: "success",
      rows: filterRows.length ? filterRows : [{ [plan.labelBindings[0].humanName]: "tersedia" }],
      columns: [...dimensionColumns, { key: plan.labelBindings[0].humanName, label: plan.labelBindings[0].humanName }],
      rowCount: Math.max(1, filterRows.length),
      period: plan.period,
      source: {
        dashboardId: plan.dashboardId,
        dashboardName: plan.dashboardName,
        semanticModel: plan.semanticModel,
        kpis: plan.selectedKpis.map((item) => item.humanName),
      },
    };
  };
}

function tracker() {
  return { requestId: "acceptance", event: async () => {}, finish: async () => {}, fail: async () => {} };
}

function expectedDashboardIds(item) {
  if (item.id === "technical-downtime-only") return [DASHBOARDS.technical.id];
  if (!item.expectsConcepts.length) return [DASHBOARDS.maintenance.id];
  if (item.expectsConcepts.some((value) => value === "deviation")) return [DASHBOARDS.deviation.id];
  if (item.expectsConcepts.some((value) => value === "overtime" || value === "overtime cost")) return [DASHBOARDS.overtime.id];
  if (item.expectsConcepts.some((value) => ["production", "production output", "purchase order", "planning"].includes(value))) {
    return [DASHBOARDS.production.id];
  }
  return [DASHBOARDS.maintenance.id];
}

function expectedRoles(item) {
  if (item.expectsConcepts.includes("running hours")) return ["numerator", "denominator"];
  if (item.expectsConcepts.includes("purchase order") || item.expectsConcepts.includes("planning")) {
    return ["primary", "target"];
  }
  return ["primary"];
}

const PREVIOUS_TURN = Object.freeze({
  "production-issue-today-detail": "production-issue-today",
  "technical-downtime-only": "production-issue-today-detail",
  "cmd3-deviation-cause": "cmd3-deviation-detail",
  "evergreen-routine-downtime-day-issue": "evergreen-routine-downtime",
});

section("Safe rollout flag defaults to legacy and requires explicit true");
{
  ok("helper hybrid tersedia", typeof featureFlags.ciaHybridQueryEnabled === "function");
  ok("helper web hybrid tersedia", typeof featureFlags.ciaHybridWebEnabled === "function");
  ok("helper effective KPI-library gate tersedia",
    typeof featureFlags.ciaKpiLibraryReadEnabled === "function");
  if (typeof featureFlags.ciaHybridQueryEnabled === "function"
      && typeof featureFlags.ciaHybridWebEnabled === "function"
      && typeof featureFlags.ciaKpiLibraryReadEnabled === "function") {
    const previousHybrid = process.env.CIA_HYBRID_QUERY_ENABLED;
    const previousLibrary = process.env.CIA_KPI_LIBRARY_ENABLED;
    try {
      delete process.env.CIA_HYBRID_QUERY_ENABLED;
      delete process.env.CIA_KPI_LIBRARY_ENABLED;
      ok("default aman tetap legacy", featureFlags.ciaHybridQueryEnabled() === false);
      ok("web tidak masuk pipeline hybrid tanpa opt-in", featureFlags.ciaHybridWebEnabled() === false);
      ok("KPI library read juga default mati", featureFlags.ciaKpiLibraryReadEnabled() === false);

      let calls = 0;
      const legacy = await runWebEvidence({ body: { question: "downtime" } }, {
        enabled: featureFlags.ciaHybridWebEnabled(),
        answerWithEvidence: async () => { calls += 1; },
      });
      ok("flag false mempertahankan surface legacy", legacy === null && calls === 0, JSON.stringify({ legacy, calls }));

      process.env.CIA_HYBRID_QUERY_ENABLED = "true";
      ok("hybrid flag sendiri mengaktifkan KPI-library read",
        featureFlags.ciaKpiLibraryReadEnabled() === true);
      const hybrid = await runWebEvidence({ body: { question: "downtime" } }, {
        enabled: featureFlags.ciaHybridWebEnabled(),
        answerWithEvidence: async () => ({
          answer: "Ringkasan bisnis tersedia.", requestId: "flag-true", confidence: "medium",
          retrievalMethod: "live_dax", rounds: 1, sources: [], warnings: [], usage: null,
        }),
      });
      ok("flag true memakai shared intent/context/blueprint pipeline", hybrid?.meta?.retrievalMethod === "live_dax");
    } finally {
      if (previousHybrid == null) delete process.env.CIA_HYBRID_QUERY_ENABLED;
      else process.env.CIA_HYBRID_QUERY_ENABLED = previousHybrid;
      if (previousLibrary == null) delete process.env.CIA_KPI_LIBRARY_ENABLED;
      else process.env.CIA_KPI_LIBRARY_ENABLED = previousLibrary;
    }
  }
}

section("Flag false keeps WhatsApp on the legacy DAX then snapshot path");
{
  let evidenceCalls = 0;
  let legacyDaxCalls = 0;
  let snapshotCalls = 0;
  const sent = [];
  await jawabPertanyaanUmum({
    async sendMessage(_jid, payload) { sent.push(payload.text); return { key: { id: "sent" } }; },
  }, "acceptance@g.us", {}, "downtime evergreen", {
    hybridEnabled: false,
    answerWithEvidence: async () => {
      evidenceCalls += 1;
      return { answer: "live", retrievalMethod: "live_dax" };
    },
    jawabDenganDax: async () => {
      legacyDaxCalls += 1;
      return { berhasil: true, teks: "Jawaban legacy DAX tersedia.", rows: [{ value: "tersedia" }] };
    },
    jawabDariSnapshot: async () => {
      snapshotCalls += 1;
      return { berhasil: true, teks: "Ringkasan snapshot tersedia.", periode: "periode uji" };
    },
    startCiaTelemetry: async () => tracker(),
  });
  ok("WhatsApp flag false tidak memanggil orchestrator", evidenceCalls === 0, String(evidenceCalls));
  ok("WhatsApp flag false memakai legacy DAX lebih dulu", legacyDaxCalls === 1
    && snapshotCalls === 0 && sent.some((message) => message.includes("Jawaban legacy DAX tersedia")),
  JSON.stringify({ legacyDaxCalls, snapshotCalls, sent }));

  legacyDaxCalls = 0;
  snapshotCalls = 0;
  sent.length = 0;
  await jawabPertanyaanUmum({
    async sendMessage(_jid, payload) { sent.push(payload.text); return { key: { id: "sent" } }; },
  }, "acceptance@g.us", {}, "downtime evergreen", {
    hybridEnabled: false,
    answerWithEvidence: async () => { evidenceCalls += 1; },
    jawabDenganDax: async () => {
      legacyDaxCalls += 1;
      return { berhasil: false, alasan: "tidak ada hasil" };
    },
    jawabDariSnapshot: async () => {
      snapshotCalls += 1;
      return { berhasil: true, teks: "Ringkasan snapshot tersedia.", periode: "periode uji" };
    },
    startCiaTelemetry: async () => tracker(),
  });
  ok("WhatsApp flag false memakai snapshot setelah legacy DAX kosong", evidenceCalls === 0
    && legacyDaxCalls === 1 && snapshotCalls === 1
    && sent.some((message) => message.includes("Ringkasan snapshot tersedia")),
  JSON.stringify({ evidenceCalls, legacyDaxCalls, snapshotCalls, sent }));
}

section("27-question hybrid acceptance corpus");
ok("corpus acceptance tetap tepat 27 pertanyaan",
  CIA_REGRESSION_CASES.length === 27 && new Set(CIA_REGRESSION_CASES.map((item) => item.id)).size === 27,
  String(CIA_REGRESSION_CASES.length));

function sameNormalizedConceptSet(actual = [], expected = []) {
  const normalize = (values) => [...new Set(values.map((value) => String(value).trim().toLowerCase()))].sort();
  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
}

ok("concept matcher normalizes sets dan menolak konsep tambahan",
  sameNormalizedConceptSet([" OVERTIME ", "downtime", "DOWNTIME"], ["downtime", "overtime"])
    && !sameNormalizedConceptSet(["downtime", "overtime"], ["downtime"]));

const observations = { library: [], plannerCalls: [], executions: [], scopeCalls: [], currentId: null };
async function runInjectedQuery({
  id, question, conversation = [], preferredDashboardIds = [],
  allowedDashboardIds = ALL_DASHBOARD_IDS,
}) {
  observations.currentId = id;
  try {
    return await answerWithEvidence({
      requestId: `acceptance-${id}`,
      surface: "whatsapp",
      accessMode: "centralized",
      question,
      conversation,
      preferredDashboardIds,
    }, {
      tracker: tracker(),
      scopeDeps: {
        loadCentralizedDashboardIds: async () => {
          observations.scopeCalls.push({ id, loader: "centralized", allowedDashboardIds });
          return allowedDashboardIds;
        },
        loadUserDashboardIds: async () => {
          observations.scopeCalls.push({ id, loader: "user" });
          throw new Error("trusted WhatsApp acceptance must not use the user ACL loader");
        },
      },
      routerDeps: {
        searchKpiCandidates: fakeKpiLibrary(observations),
        getDashboardVocabulary: async () => ({}),
      },
      plannerDeps: { callModel: fakePlannerModel(observations) },
      getSchema: async (semanticModel) => fakeSchema(semanticModel),
      executeEvidencePlan: fakeExecuteEvidencePlan(observations),
      synthDeps: {
        callModel: async ({ question: packetJson }) => {
          const packet = JSON.parse(packetJson);
          return {
            text: JSON.stringify({
              answer: "Ringkasan bisnis tersedia dari sumber terpilih.",
              citedSourceIndexes: packet.sources.map((_, index) => index),
            }),
            usage: null,
          };
        },
      },
      now: () => new Date("2026-08-31T05:00:00.000Z"),
    });
  } finally {
    observations.currentId = null;
  }
}

const results = new Map();
for (const item of CIA_REGRESSION_CASES) {
  const previous = results.get(PREVIOUS_TURN[item.id]);
  const conversation = previous ? [
    { role: "user", text: previous.item.question },
    { role: "assistant", text: previous.answer.answer, evidenceContract: previous.answer.evidenceContract },
  ] : [];
  const preferredDashboardIds = item.id.includes("evergreen")
    ? [DASHBOARDS.maintenance.id, "not-allowed"] : [];
  const intent = buildIntentFrame({ question: item.question, conversation, preferredDashboardIds });
  const answer = await runInjectedQuery({
    id: item.id, question: item.question, conversation, preferredDashboardIds,
  });
  results.set(item.id, { item, answer });

  const prefix = item.id;
  ok(`${prefix}: parsed concepts`, sameNormalizedConceptSet(intent.concepts, item.expectsConcepts),
    JSON.stringify(intent.concepts));
  const executedConcepts = answer.evidenceContract?.concepts || [];
  ok(`${prefix}: executed contract concepts`, sameNormalizedConceptSet(executedConcepts, item.expectsConcepts),
    JSON.stringify(executedConcepts));
  ok(`${prefix}: period kind`, !item.expectsPeriodKind || intent.periodKinds.includes(item.expectsPeriodKind),
    JSON.stringify(intent.periodKinds));
  const executedPeriod = EXPECTED_PERIODS[item.id];
  const matchesExecutedPeriod = (period) => executedPeriod
    && period?.comparisonKey === executedPeriod.comparisonKey
    && period.from === executedPeriod.from && period.to === executedPeriod.to;
  ok(`${prefix}: executed period contract`, answer.evidenceContract?.periods?.some((period) =>
    matchesExecutedPeriod(period)), JSON.stringify(answer.evidenceContract?.periods));
  const executedPlans = observations.executions.filter((plan) => plan.acceptanceId === item.id);
  ok(`${prefix}: executed DAX plan period`, executedPlans.length > 0
    && executedPlans.every((plan) => matchesExecutedPeriod(plan.period)),
  JSON.stringify(executedPlans.map((plan) => plan.period)));
  const contractEntities = answer.evidenceContract?.entities || [];
  ok(`${prefix}: entities`, item.expectsEntities.length
    ? item.expectsEntities.every((value) => contractEntities.some((entity) => entity.value === value))
    : contractEntities.length === 0,
  JSON.stringify(contractEntities));
  const filterEntities = intent.entities.filter((entity) => ENTITY_DIMENSIONS[entity.type]
    && item.expectsEntities.includes(entity.value));
  if (filterEntities.length) {
    ok(`${prefix}: executed entity filters`, executedPlans.length > 0 && filterEntities.every((entity) =>
      executedPlans.every((plan) => plan.selectedFilters?.some((filter) =>
        filter.humanName === ENTITY_DIMENSIONS[entity.type]
          && String(filter.value).replace(/\s+/g, "") === entity.value.replace(/\s+/g, "")))),
    JSON.stringify(executedPlans.map((plan) => plan.selectedFilters)));
  }

  const selectedIds = new Set((answer.sources || []).map((source) => String(source.dashboardId)));
  const expectedIds = expectedDashboardIds(item);
  const forbiddenIds = ALL_DASHBOARD_IDS.filter((id) => !expectedIds.includes(id));
  ok(`${prefix}: selected source`, expectedIds.length > 0 && expectedIds.every((id) => selectedIds.has(id)),
    JSON.stringify({ selectedIds: [...selectedIds], warnings: answer.warnings }));
  ok(`${prefix}: forbidden source`, forbiddenIds.length > 0
    && forbiddenIds.every((id) => !selectedIds.has(id)), JSON.stringify([...selectedIds]));
  if (item.expectsSource?.length) {
    const sourceText = (answer.sources || []).map((source) => source.dashboardName).join(" ").toLocaleLowerCase("id-ID");
    ok(`${prefix}: explicit source`, item.expectsSource.every((value) => sourceText.includes(value)), sourceText);
  }

  const roles = (answer.evidenceContract?.goals || []).map((goal) => goal.metricRole);
  const requiredRoles = expectedRoles(item);
  ok(`${prefix}: metric roles`, requiredRoles.length > 0
    && requiredRoles.every((role) => roles.includes(role)), JSON.stringify(roles));
  ok(`${prefix}: live retrieval`, answer.retrievalMethod === "live_dax", answer.retrievalMethod);
  ok(`${prefix}: human labels only`, !TECHNICAL_LABEL.test(answer.answer), answer.answer);
}

ok("paired follow-up turns benar-benar membawa contract sebelumnya",
  Object.keys(PREVIOUS_TURN).every((id) => results.get(id)?.answer?.evidenceContract),
  JSON.stringify(Object.keys(PREVIOUS_TURN)));
ok("fake library dipakai untuk seluruh corpus", observations.library.length === 27, String(observations.library.length));
ok("production planner model boundary dipakai untuk seluruh corpus", observations.plannerCalls?.length === 27,
  String(observations.plannerCalls?.length || 0));
ok("production scope resolver memakai centralized loader untuk seluruh corpus",
  observations.scopeCalls.length === 27 && observations.scopeCalls.every((call) => call.loader === "centralized"),
  JSON.stringify(observations.scopeCalls));
ok("production scope membuang preferred dashboard di luar allowed sebelum routing",
  observations.library.every((call) => !call.preferredDashboardIds.includes("not-allowed")),
  JSON.stringify(observations.library.map((call) => call.preferredDashboardIds)));
ok("production DAX builder menghasilkan query read-only dari blueprint", observations.executions.length > 0
  && observations.executions.every((plan) => plan.datasetId === "fake-dataset"
    && typeof plan.dax === "string" && /^EVALUATE\b/.test(plan.dax)
    && plan.allowedDaxIdentifiers?.some((identifier) => identifier.includes("Calendar[Date]"))));

const restrictedScope = await runInjectedQuery({
  id: "production-scope-filter",
  question: "jelaskan downtime evergreen",
  preferredDashboardIds: [DASHBOARDS.technical.id, DASHBOARDS.maintenance.id],
  allowedDashboardIds: [DASHBOARDS.maintenance.id],
});
const restrictedPlans = observations.executions.filter((plan) => plan.acceptanceId === "production-scope-filter");
ok("production scope membatasi preferred dan eksekusi ke dashboard allowed",
  restrictedScope.sources?.length > 0
    && restrictedScope.sources.every((source) => String(source.dashboardId) === DASHBOARDS.maintenance.id)
    && restrictedPlans.length > 0
    && restrictedPlans.every((plan) => String(plan.dashboardId) === DASHBOARDS.maintenance.id),
JSON.stringify({ sources: restrictedScope.sources, plans: restrictedPlans.map((plan) => plan.dashboardId) }));

section("Deterministic injected smoke rehearsal (Power BI is not exercised)");
const evergreenQuestion = "jelaskan downtime evergreen bulan juni";
const evergreen = await runInjectedQuery({
  id: "smoke-evergreen-june",
  question: evergreenQuestion,
  preferredDashboardIds: [DASHBOARDS.maintenance.id],
});
const evergreenFollowUp = await runInjectedQuery({
  id: "smoke-evergreen-follow-up",
  question: "berapa persentasenya terhadap used time?",
  conversation: [
    { role: "user", text: evergreenQuestion },
    { role: "assistant", text: evergreen.answer, evidenceContract: evergreen.evidenceContract },
  ],
  preferredDashboardIds: [DASHBOARDS.technical.id],
});

const smokeCases = [
  ["Evergreen Juni dashboard 44", evergreen, ["44"], ["evergreen"], "named_month"],
  ["downtime dan running hours", results.get("downtime-tetra-running-hours").answer, ["44"],
    ["tetra pak line 3", "tetra pak line 6"], "current"],
  ["production dibanding PO", results.get("production-output-po-yesterday").answer, ["70"], [], "yesterday"],
  ["overtime cut-off", results.get("overtime-weekend-cutoff").answer, ["52"], [], "named_month"],
  ["deviasi CMD3", results.get("cmd3-deviation-cause").answer, ["61"], ["cmd 3"], "current"],
  ["follow-up Evergreen", evergreenFollowUp, ["44"], ["evergreen"], "named_month"],
];

for (const [label, answer, expectedSources, expectedEntities, expectedPeriod] of smokeCases) {
  const evidence = {
    source: (answer.sources || []).map((source) => ({ id: String(source.dashboardId), name: source.dashboardName })),
    period: (answer.evidenceContract?.periods || []).map((period) => ({
      kind: period.comparisonKey, from: period.from, to: period.to,
    })),
    entities: (answer.evidenceContract?.entities || []).map((entity) => entity.value),
    retrieval: answer.retrievalMethod,
    roles: (answer.evidenceContract?.goals || []).map((goal) => goal.metricRole),
    humanLabelsOnly: !TECHNICAL_LABEL.test(answer.answer),
  };
  ok(`${label}: source/period/entity/retrieval/label evidence`,
    expectedSources.every((id) => evidence.source.some((source) => source.id === id))
      && evidence.period.some((period) => period.kind === expectedPeriod)
      && expectedEntities.every((entity) => evidence.entities.includes(entity))
      && evidence.retrieval === "live_dax" && evidence.humanLabelsOnly,
  JSON.stringify(evidence));
  console.log(`  evidence  ${label}: ${JSON.stringify(evidence)}`);
}

ok("context-dependent follow-up inherits source, June period, entity, and ratio roles",
  evergreenFollowUp.evidenceContract?.sources?.some((source) => String(source.dashboardId) === "44")
    && evergreenFollowUp.evidenceContract?.periods?.some((period) => period.comparisonKey === "named_month"
      && period.from === "2026-06-01" && period.to === "2026-06-30")
    && evergreenFollowUp.evidenceContract?.entities?.some((entity) => entity.value === "evergreen")
    && ["numerator", "denominator"].every((role) =>
      evergreenFollowUp.evidenceContract?.goals?.some((goal) => goal.metricRole === role)),
JSON.stringify(evergreenFollowUp.evidenceContract));
const followUpPlans = observations.executions.filter((plan) => plan.acceptanceId === "smoke-evergreen-follow-up");
ok("context-dependent follow-up executes inherited source, period, and entity filters",
  followUpPlans.length === 2 && followUpPlans.every((plan) => String(plan.dashboardId) === "44"
    && plan.period?.from === "2026-06-01" && plan.period?.to === "2026-06-30"
    && plan.selectedFilters?.some((filter) => filter.humanName === "Mesin" && filter.value === "evergreen")),
JSON.stringify(followUpPlans.map((plan) => ({
  dashboardId: plan.dashboardId, period: plan.period, filters: plan.selectedFilters,
}))));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

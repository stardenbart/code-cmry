import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { analyzeEvidenceGap } from "../src/services/cia/evidenceGapAnalyzer.js";

const overtime = { bindingId: "b-ot", slug: "overtime", humanName: "Jam lembur",
  dimensions: ["Tanggal", "Departemen", "Alasan", "Kategori"] };
const po = { bindingId: "b-po", slug: "ppic_po", humanName: "Purchase Order PO",
  dimensions: ["Produk", "Jenis PO"] };
const quality = { bindingId: "b-quality", slug: "quality_issue", humanName: "Quality issue",
  dimensions: ["Kategori", "Deskripsi"] };
const period = { from: "2026-08-01", to: "2026-08-28", comparisonKey: "current" };

const plan = {
  periods: [period],
  goals: [{ kpiBindingId: "b-ot", periodIndex: 0, dimensions: ["Departemen"], purpose: "primary" }],
  candidates: [overtime, po, quality],
};

function evidence(binding, dimensions, extra = {}) {
  return {
    status: "success",
    goal: { kpiBindingId: binding.bindingId, periodIndex: 0,
      dimensions, purpose: binding.bindingId === "b-ot" ? "primary" : "correlation" },
    period,
    columns: [
      { label: binding.humanName },
      ...dimensions.map((label) => ({ label })),
    ],
    rows: [{ value: 1 }],
    source: { dashboardId: binding.bindingId, semanticModel: binding.slug },
    ...extra,
  };
}

const library = { candidates: [overtime, po, quality] };

section("Round 1 meminta dashboard PPIC untuk korelasi lembur dan PO");
const round1 = await analyzeEvidenceGap({
  question: "apakah lembur produksi A tinggi karena PO naik, produk apa dan kenapa",
  plan,
  evidence: [evidence(overtime, ["Departemen"])],
  round: 1,
  library,
});
ok("belum complete", round1.complete === false, JSON.stringify(round1));
ok("gap korelasi PO dan produk terdeteksi",
  round1.missing.includes("correlation:ppic_po") && round1.missing.includes("dimension:produk"),
  JSON.stringify(round1.missing));
ok("goal PPIC diminta sebagai correlation",
  round1.additionalGoals.length === 1
    && round1.additionalGoals[0].kpiBindingId === "b-po"
    && round1.additionalGoals[0].purpose === "correlation"
    && round1.additionalGoals[0].dimensions.includes("Produk"),
  JSON.stringify(round1.additionalGoals));

section("Pertanyaan ranking non-kausal tidak memperluas ke KPI sibling");
const ranking = await analyzeEvidenceGap({
  question: "top 3 mesin dengan downtime tertinggi pada CMD1 bulan Juni kemarin",
  plan: {
    periods: [period],
    goals: [{ kpiBindingId: "b-top", periodIndex: 0, dimensions: ["Mesin"], purpose: "primary" }],
    candidates: [
      { bindingId: "b-top", slug: "top_downtime", humanName: "Top mesin downtime tertinggi", dimensions: ["Mesin"] },
      { bindingId: "b-low", slug: "lowest_downtime", humanName: "Top mesin downtime terendah", dimensions: ["Mesin"] },
      { bindingId: "b-building", slug: "downtime_building", humanName: "Downtime per gedung", dimensions: ["Gedung"] },
    ],
  },
  evidence: [evidence({ bindingId: "b-top", slug: "top_downtime", humanName: "Top mesin downtime tertinggi" }, ["Mesin"])],
  round: 1,
  library: { candidates: [] },
});
ok("ranking selesai dari primary evidence saja",
  ranking.complete === true && ranking.additionalGoals.length === 0,
  JSON.stringify(ranking));

section("Round 2 complete setelah evidence PPIC dengan periode compatible");
const round2 = await analyzeEvidenceGap({
  question: "apakah lembur produksi A tinggi karena PO naik, produk apa dan kenapa",
  plan,
  evidence: [evidence(overtime, ["Departemen"]), evidence(po, ["Produk"])],
  round: 2,
  library,
});
ok("evidence dua dashboard complete", round2.complete === true, JSON.stringify(round2));
ok("tidak meminta goal lagi", round2.additionalGoals.length === 0, JSON.stringify(round2));

section("Follow-up baru dapat meminta dashboard ketiga");
const followUp = await analyzeEvidenceGap({
  question: "bagaimana kaitannya dengan quality issue dan kategori masalah",
  plan,
  evidence: [evidence(overtime, ["Departemen"]), evidence(po, ["Produk"])],
  round: 1,
  library,
});
ok("quality binding ditambahkan",
  followUp.additionalGoals.some((goal) => goal.kpiBindingId === "b-quality"
    && goal.dimensions.includes("Kategori")),
  JSON.stringify(followUp));

section("Goal berulang didedupe dan round 4 berhenti");
const attemptedPo = evidence(po, ["Produk"], { status: "failed", rows: [], columns: [] });
const repeated = await analyzeEvidenceGap({
  question: "apakah lembur karena PO naik, produk apa",
  plan,
  evidence: [evidence(overtime, ["Departemen"]), attemptedPo],
  round: 3,
  library,
});
ok("binding/period/dimensi yang sudah dicoba tidak diulang",
  repeated.additionalGoals.every((goal) => goal.kpiBindingId !== "b-po"),
  JSON.stringify(repeated));
ok("gap unresolved diberi warning jujur",
  repeated.warnings.includes("EVIDENCE_GAP_UNRESOLVED"), JSON.stringify(repeated));

const capped = await analyzeEvidenceGap({
  question: "apakah lembur karena PO naik, produk apa",
  plan,
  evidence: [evidence(overtime, ["Departemen"])],
  round: 4,
  library,
});
ok("round 4 tidak menambah goal", capped.additionalGoals.length === 0, JSON.stringify(capped));
ok("round cap diberi warning", capped.warnings.includes("MAX_RETRIEVAL_ROUNDS_REACHED"),
  JSON.stringify(capped));

section("Periode berbeda tidak cukup untuk claim korelasi");
const incompatiblePo = evidence(po, ["Produk"], {
  period: { from: "2025-08-01", to: "2025-08-28", comparisonKey: "previous_year" },
});
const incompatible = await analyzeEvidenceGap({
  question: "apakah lembur karena PO naik, produk apa",
  plan,
  evidence: [evidence(overtime, ["Departemen"]), incompatiblePo],
  round: 2,
  library,
});
ok("periode tidak compatible belum complete", incompatible.complete === false,
  JSON.stringify(incompatible));
ok("warning periode tidak compatible",
  incompatible.warnings.includes("CORRELATION_PERIOD_MISMATCH"), JSON.stringify(incompatible));

section("Role komposit hanya diperluas dari kandidat anchored");
const composite = await analyzeEvidenceGap({
  question: "berapa persentase downtime terhadap running hours",
  plan: {
    periods: [period],
    operations: ["calculation"],
    goals: [{ kpiBindingId: "b-dt", periodIndex: 0, dimensions: [], purpose: "primary", metricRole: "numerator" }],
    candidates: [
      { bindingId: "b-dt", humanName: "Durasi downtime", blueprint: { role: "numerator" }, anchorMatches: ["downtime"] },
      { bindingId: "b-hours", humanName: "Running hours", blueprint: { role: "denominator" }, anchorMatches: ["running hours"] },
      { bindingId: "b-random", humanName: "Running hours", blueprint: { role: "denominator" }, anchorMatches: [] },
    ],
  },
  evidence: [evidence({ bindingId: "b-dt", slug: "downtime", humanName: "Durasi downtime" }, [])],
  round: 1,
});
ok("denominator anchored ditambahkan",
  composite.additionalGoals.some((goal) => goal.kpiBindingId === "b-hours" && goal.metricRole === "denominator"),
  JSON.stringify(composite));
ok("kandidat tanpa anchor tidak pernah dipakai",
  composite.additionalGoals.every((goal) => goal.kpiBindingId !== "b-random"), JSON.stringify(composite));

const achievement = await analyzeEvidenceGap({
  question: "berapa achievement produksi terhadap target",
  plan: {
    periods: [period],
    operations: ["calculation"],
    goals: [{ kpiBindingId: "b-actual", periodIndex: 0, dimensions: [], purpose: "primary", metricRole: "primary" }],
    candidates: [
      { bindingId: "b-actual", humanName: "Actual produksi", blueprint: { role: "total" }, anchorMatches: ["production"] },
      { bindingId: "b-target", humanName: "Target produksi", blueprint: { role: "target" }, anchorMatches: ["production"] },
    ],
  },
  evidence: [evidence({ bindingId: "b-actual", slug: "production", humanName: "Actual produksi" }, [])],
  round: 1,
});
ok("target anchored ditambahkan untuk achievement",
  achievement.additionalGoals.some((goal) => goal.kpiBindingId === "b-target" && goal.metricRole === "target"),
  JSON.stringify(achievement));

const detail = await analyzeEvidenceGap({
  question: "tampilkan detail downtime per masalah",
  plan: {
    periods: [period],
    operations: ["breakdown"],
    goals: [{ kpiBindingId: "b-dt", periodIndex: 0, dimensions: [], purpose: "primary", metricRole: "primary" }],
    candidates: [
      { bindingId: "b-dt", humanName: "Durasi downtime", blueprint: { role: "total" }, anchorMatches: ["downtime"] },
      { bindingId: "b-detail", humanName: "Detail masalah downtime", blueprint: { role: "detail" },
        dimensions: ["Masalah"], anchorMatches: ["downtime"] },
    ],
  },
  evidence: [evidence({ bindingId: "b-dt", slug: "downtime", humanName: "Durasi downtime" }, [])],
  round: 1,
});
ok("detail anchored ditambahkan saat diminta",
  detail.additionalGoals.some((goal) => goal.kpiBindingId === "b-detail" && goal.metricRole === "detail"),
  JSON.stringify(detail));

const directRatio = await analyzeEvidenceGap({
  question: "berapa persentase downtime",
  plan: {
    periods: [period],
    operations: ["calculation"],
    goals: [{ kpiBindingId: "b-ratio", periodIndex: 0, dimensions: [], purpose: "primary", metricRole: "primary" }],
    candidates: [{ bindingId: "b-ratio", humanName: "Persentase downtime", blueprint: { role: "ratio" },
      anchorMatches: ["downtime"] }],
  },
  evidence: [evidence({ bindingId: "b-ratio", slug: "downtime_ratio", humanName: "Persentase downtime" }, [])],
  round: 1,
});
ok("ratio langsung tidak dipaksa menjadi numerator dan denominator",
  directRatio.complete === true && directRatio.additionalGoals.length === 0,
  JSON.stringify(directRatio));

const nameOnlyTarget = await analyzeEvidenceGap({
  question: "berapa achievement produksi",
  plan: {
    periods: [period], operations: ["calculation"],
    goals: [{ kpiBindingId: "b-actual", periodIndex: 0, dimensions: [], purpose: "primary", metricRole: "primary" }],
    candidates: [
      { bindingId: "b-actual", humanName: "Actual produksi", blueprint: { role: "total" }, anchorMatches: ["production"] },
      { bindingId: "b-name-only", humanName: "Target produksi", blueprint: { role: "total" }, anchorMatches: ["production"] },
    ],
  },
  evidence: [evidence({ bindingId: "b-actual", humanName: "Actual produksi" }, [])],
  round: 1,
});
ok("nama KPI tidak dijadikan taxonomy role",
  nameOnlyTarget.complete === true && nameOnlyTarget.additionalGoals.length === 0,
  JSON.stringify(nameOnlyTarget));

const previousPeriod = { from: "2026-07-01", to: "2026-07-31", comparisonKey: "previous" };
const multiPeriod = await analyzeEvidenceGap({
  question: "bandingkan persentase downtime terhadap running hours",
  plan: {
    periods: [period, previousPeriod],
    operations: ["comparison", "calculation"],
    goals: [0, 1].map((periodIndex) => ({
      kpiBindingId: "b-dt", periodIndex, dimensions: [], purpose: "primary", metricRole: "numerator",
    })),
    candidates: [
      { bindingId: "b-dt", humanName: "Durasi downtime", metricRole: "numerator", anchorMatches: ["downtime"] },
      { bindingId: "b-hours", humanName: "Running hours", metricRole: "denominator", anchorMatches: ["running hours"] },
    ],
  },
  evidence: [
    { ...evidence({ bindingId: "b-dt", humanName: "Durasi downtime" }, []),
      goal: { kpiBindingId: "b-dt", periodIndex: 0, metricRole: "numerator" } },
    { ...evidence({ bindingId: "b-dt", humanName: "Durasi downtime" }, []), period: previousPeriod,
      goal: { kpiBindingId: "b-dt", periodIndex: 1, metricRole: "numerator" } },
    { ...evidence({ bindingId: "b-hours", humanName: "Running hours" }, []),
      goal: { kpiBindingId: "b-hours", periodIndex: 0, metricRole: "denominator" } },
  ],
  round: 2,
});
ok("setiap periode mendapat denominator sendiri",
  multiPeriod.additionalGoals.some((goal) => goal.kpiBindingId === "b-hours"
    && goal.metricRole === "denominator" && goal.periodIndex === 1),
  JSON.stringify(multiPeriod));

const mismatchedDenominator = await analyzeEvidenceGap({
  question: "berapa persentase downtime terhadap running hours",
  plan: {
    periods: [period],
    operations: ["calculation"],
    goals: [{ kpiBindingId: "b-dt", periodIndex: 0, dimensions: [], purpose: "primary", metricRole: "numerator" }],
    candidates: [
      { bindingId: "b-dt", blueprint: { role: "numerator" }, anchorMatches: ["downtime"] },
      { bindingId: "b-hours", blueprint: { role: "denominator" }, anchorMatches: ["running hours"] },
    ],
  },
  evidence: [
    { ...evidence({ bindingId: "b-dt", humanName: "Durasi downtime" }, []),
      goal: { kpiBindingId: "b-dt", periodIndex: 0, metricRole: "numerator" },
      intentMatch: { concepts: true, entities: true, period: true, source: true } },
    { ...evidence({ bindingId: "b-hours", humanName: "Running hours" }, []),
      goal: { kpiBindingId: "b-hours", periodIndex: 0, metricRole: "denominator" },
      intentMatch: { concepts: true, entities: false, period: true, source: false } },
  ],
  round: 1,
});
ok("denominator mismatch tetap menjadi gap yang dapat dicoba ulang",
  mismatchedDenominator.complete === false
    && mismatchedDenominator.additionalGoals.some((goal) => goal.kpiBindingId === "b-hours"
      && goal.metricRole === "denominator"),
  JSON.stringify(mismatchedDenominator));

const wrongPeriodDenominator = await analyzeEvidenceGap({
  question: "berapa persentase downtime terhadap running hours",
  plan: {
    periods: [period], operations: ["calculation"],
    goals: [{ kpiBindingId: "b-dt", periodIndex: 0, dimensions: [], purpose: "primary", metricRole: "numerator" }],
    candidates: [
      { bindingId: "b-dt", blueprint: { role: "numerator" }, anchorMatches: ["downtime"] },
      { bindingId: "b-hours", blueprint: { role: "denominator" }, anchorMatches: ["running hours"] },
    ],
  },
  evidence: [
    { ...evidence({ bindingId: "b-dt", humanName: "Durasi downtime" }, []),
      goal: { kpiBindingId: "b-dt", periodIndex: 0, metricRole: "numerator" } },
    { ...evidence({ bindingId: "b-hours", humanName: "Running hours" }, []),
      period: previousPeriod,
      goal: { kpiBindingId: "b-hours", periodIndex: 0, metricRole: "denominator" } },
  ],
  round: 1,
});
ok("denominator periode lain tidak memenuhi role dan dapat dicoba ulang",
  wrongPeriodDenominator.complete === false
    && wrongPeriodDenominator.additionalGoals.some((goal) => goal.kpiBindingId === "b-hours"),
  JSON.stringify(wrongPeriodDenominator));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}


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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}


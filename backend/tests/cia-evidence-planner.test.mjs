import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { planEvidence } from "../src/services/cia/evidencePlanner.js";
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

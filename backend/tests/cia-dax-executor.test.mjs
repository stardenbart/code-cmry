import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import { executeEvidencePlan } from "../src/services/cia/daxEvidenceExecutor.js";
import { perbaikiDaxTerbatas } from "../src/services/daxAgent.service.js";
import { powerBiErrorCode } from "../src/services/powerbiMeta.service.js";

const plan = {
  semanticModel: "Cost Model",
  datasetId: "dataset-cost",
  dashboardId: "dash-ot",
  dashboardName: "Dashboard Lembur",
  period: { label: "Agustus", from: "2026-08-01", to: "2026-08-28" },
  dax: "EVALUATE ROW(\"Jam lembur\", 'Measures'[OT_HOURS])",
  selectedKpis: [{ bindingId: "b-ot", humanName: "Jam lembur" }],
  selectedDimensions: [{ table: "Overtime", column: "Department", humanName: "Departemen" }],
  labelBindings: [{ bindingId: "b-ot", tableName: "Measures", measureName: "OT_HOURS",
    humanName: "Jam lembur", dashboardName: "Dashboard Lembur" }],
  allowedDaxIdentifiers: ["Measures[OT_HOURS]", "Overtime[Department]"],
  maxRows: 500,
};

function success(rows = [{ "Measures[OT_HOURS]": 12, "Overtime[Department]": "Produksi" }]) {
  return { berhasil: true, baris: rows, kolom: rows.length ? Object.keys(rows[0]) : [] };
}

section("Success pertama langsung diberi label manusia");
let calls = 0;
const first = await executeEvidencePlan(plan, {
  async executeDax(datasetId, dax, options) {
    calls += 1;
    ok("executor menerima dataset dan row limit plan",
      datasetId === "dataset-cost" && dax === plan.dax && options.maksBaris === 500,
      `${datasetId}/${dax}/${JSON.stringify(options)}`);
    return success();
  },
});
ok("success hanya satu attempt", first.status === "success" && first.attempts === 1 && calls === 1,
  JSON.stringify(first));
ok("measure teknis tidak menjadi key row",
  first.rows[0]["Jam lembur"] === 12 && !("Measures[OT_HOURS]" in first.rows[0]),
  JSON.stringify(first.rows));
ok("dimension ikut humanized", first.rows[0].Departemen === "Produksi", JSON.stringify(first.rows));
ok("source dan period terbawa",
  first.source.dashboardId === "dash-ot" && first.period.from === "2026-08-01", JSON.stringify(first));

section("DAX invalid diperbaiki tepat satu kali");
calls = 0;
let repairCalls = 0;
const repaired = await executeEvidencePlan(plan, {
  async executeDax(_dataset, dax) {
    calls += 1;
    return calls === 1
      ? { berhasil: false, errorCode: "DAX_INVALID", alasan: "Column salah" }
      : success([{ "Measures[OT_HOURS]": 8 }]);
  },
  async repairDax(input) {
    repairCalls += 1;
    ok("repair menerima error aman dan DAX pertama",
      input.errorMessage === "Column salah" && input.dax === plan.dax,
      JSON.stringify(input));
    return "EVALUATE ROW(\"Jam lembur\", 'Measures'[OT_HOURS])";
  },
});
ok("repair success memakai dua attempt", repaired.status === "success" && repaired.attempts === 2
  && calls === 2 && repairCalls === 1, JSON.stringify(repaired));

section("Invalid kedua berhenti dan tidak repair berulang");
calls = 0;
repairCalls = 0;
const twiceInvalid = await executeEvidencePlan(plan, {
  async executeDax() { calls += 1; return { berhasil: false, errorCode: "DAX_INVALID", alasan: "masih salah" }; },
  async repairDax() { repairCalls += 1; return plan.dax; },
});
ok("maksimum dua execute dan satu repair", calls === 2 && repairCalls === 1,
  `${calls}/${repairCalls}`);
ok("hasil gagal typed DAX_INVALID",
  twiceInvalid.status === "failed" && twiceInvalid.errorCode === "DAX_INVALID"
    && twiceInvalid.attempts === 2, JSON.stringify(twiceInvalid));

section("Repair dengan identifier baru ditolak sebelum ExecuteQueries kedua");
calls = 0;
const unsafeRepair = await executeEvidencePlan(plan, {
  async executeDax() { calls += 1; return { berhasil: false, errorCode: "DAX_INVALID", alasan: "salah" }; },
  async repairDax() { return "EVALUATE ROW(\"x\", 'Secret'[Payroll])"; },
});
ok("repair unsafe tidak dieksekusi", calls === 1, String(calls));
ok("repair unsafe typed DAX_INVALID", unsafeRepair.errorCode === "DAX_INVALID",
  JSON.stringify(unsafeRepair));

section("Outcome error Power BI terpetakan dan tidak direpair");
for (const [label, raw, expected] of [
  ["401", { response: { status: 401 } }, "POWERBI_AUTH"],
  ["403", { response: { status: 403 } }, "POWERBI_FORBIDDEN"],
  ["timeout", { code: "ETIMEDOUT", message: "timeout" }, "POWERBI_TIMEOUT"],
  ["throttle", { response: { status: 429 } }, "POWERBI_THROTTLED"],
  ["unknown", { response: { status: 500 } }, "POWERBI_UNKNOWN"],
]) {
  let count = 0;
  const result = await executeEvidencePlan(plan, {
    async executeDax() { count += 1; throw Object.assign(new Error(label), raw); },
    async repairDax() { throw new Error("tidak boleh dipanggil"); },
  });
  ok(`${label}: error code`, result.status === "failed" && result.errorCode === expected,
    JSON.stringify(result));
  ok(`${label}: satu attempt`, count === 1, String(count));
}

section("Query sukses tanpa baris dibedakan dari gagal");
const empty = await executeEvidencePlan(plan, { async executeDax() { return success([]); } });
ok("empty typed", empty.status === "empty" && empty.errorCode === null && empty.rowCount === 0,
  JSON.stringify(empty));

section("Adapter Power BI dan repair tidak membuang kontrak typed");
ok("mapper membedakan auth dan forbidden",
  powerBiErrorCode({ response: { status: 401 } }) === "POWERBI_AUTH"
    && powerBiErrorCode({ response: { status: 403 } }) === "POWERBI_FORBIDDEN");
ok("mapper membedakan timeout dan throttle",
  powerBiErrorCode({ code: "ECONNABORTED", message: "timeout" }) === "POWERBI_TIMEOUT"
    && powerBiErrorCode({ response: { status: 429 } }) === "POWERBI_THROTTLED");
let repairPrompt = null;
const repairedDax = await perbaikiDaxTerbatas({
  dax: plan.dax, errorMessage: "Column salah", plan,
}, {
  async callModel(input) {
    repairPrompt = input;
    return { text: "```dax\nEVALUATE ROW(\"Jam lembur\", 'Measures'[OT_HOURS])\n```" };
  },
});
ok("repair adapter mengembalikan DAX tanpa fence",
  repairedDax === "EVALUATE ROW(\"Jam lembur\", 'Measures'[OT_HOURS])", repairedDax);
ok("repair prompt membawa error aman dan DAX lama",
  repairPrompt?.question?.includes("Column salah") && repairPrompt.question.includes(plan.dax),
  JSON.stringify(repairPrompt));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

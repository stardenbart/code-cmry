// Translasi hasil DAX -> label bisnis manusiawi.
//
// Nama measure teknis TIDAK boleh muncul di jawaban user. Lookup harus mengenali
// keempat bentuk identifier DAX/ExecuteQueries: 'Table'[Measure], Table[Measure],
// [Measure], dan Measure. Bila label tak ditemukan, identifier di-humanize dan
// bracket/table prefix dibuang — bukan diekspos mentah.
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import {
  buildLabelMap, labelDaxRows, describeKpi, humanizeIdentifier, humanizeTechnicalText,
} from "../src/services/ciaHumanLabels.service.js";
import { buildVisualBlueprint } from "../src/services/cia/visualBlueprint.js";
import { synthesizeEvidence } from "../src/services/cia/evidenceSynthesizer.js";

section("buildLabelMap mengenali semua varian kunci");
const bindings = [{
  tableName: "MeasureTable", measureName: "OT_HOURS",
  humanName: "Jam lembur", definition: "Total jam lembur", unit: "jam", numberFormat: "#,##0",
}];
const map = buildLabelMap(bindings);
ok("'MeasureTable'[OT_HOURS] -> Jam lembur", map.get("'MeasureTable'[OT_HOURS]") === "Jam lembur");
ok("MeasureTable[OT_HOURS] -> Jam lembur", map.get("MeasureTable[OT_HOURS]") === "Jam lembur");
ok("[OT_HOURS] -> Jam lembur", map.get("[OT_HOURS]") === "Jam lembur");
ok("OT_HOURS -> Jam lembur", map.get("OT_HOURS") === "Jam lembur");

section("labelDaxRows mengubah nama kolom, mempertahankan nilai dimensi");
const res = labelDaxRows({
  rows: [
    { "'MeasureTable'[OT_HOURS]": 128.5, "Departemen": "Produksi A" },
    { "'MeasureTable'[OT_HOURS]": 90, "Departemen": "Produksi B" },
  ],
  bindings,
});
ok("kolom measure jadi label manusia", res.columns.some((c) => c.label === "Jam lembur"),
  JSON.stringify(res.columns));
ok("tidak ada label yang membocorkan bracket/measure teknis",
  res.columns.every((c) => !/\[|OT_HOURS/.test(c.label)), JSON.stringify(res.columns));
ok("nilai measure dipetakan ke label", res.rows[0]["Jam lembur"] === 128.5, JSON.stringify(res.rows[0]));
ok("nilai dimensi dipertahankan", res.rows[0]["Departemen"] === "Produksi A", JSON.stringify(res.rows[0]));

section("Prioritas label mengikuti KPI, caption visual, lalu dimension humanName");
const prioritized = labelDaxRows({
  rows: [{ "Measures[RAW_KPI]": 10, "Measures[RAW_CAPTION]": 20, "Dim[nama_mesin]": "A" }],
  bindings: [
    { tableName: "Measures", measureName: "RAW_KPI", humanName: "KPI utama", displayCaption: "Caption lama" },
    { tableName: "Measures", measureName: "RAW_CAPTION", displayCaption: "Caption visual" },
  ],
  dimensions: [{ table: "Dim", column: "nama_mesin", humanName: "Mesin produksi" }],
});
ok("KPI human name mengalahkan caption", prioritized.rows[0]["KPI utama"] === 10,
  JSON.stringify(prioritized.rows[0]));
ok("caption visual dipakai bila KPI human name kosong", prioritized.rows[0]["Caption visual"] === 20,
  JSON.stringify(prioritized.rows[0]));
ok("configured dimension humanName dipakai sebelum cleaned field",
  prioritized.rows[0]["Mesin produksi"] === "A", JSON.stringify(prioritized.rows[0]));

section("Kolisi label -> suffix yang jelas");
const collide = labelDaxRows({
  rows: [{ "TblA[OT_HOURS]": 10, "TblB[OT_JAM]": 20 }],
  bindings: [
    { tableName: "TblA", measureName: "OT_HOURS", humanName: "Jam lembur", dashboardName: "Dashboard Overtime" },
    { tableName: "TblB", measureName: "OT_JAM", humanName: "Jam lembur", dashboardName: "Dashboard Lembur Plant" },
  ],
});
const labels = collide.columns.map((c) => c.label);
ok("dua label unik (tidak tabrakan)", new Set(labels).size === 2, JSON.stringify(labels));
ok("suffix menyebut dashboard pembeda",
  labels.some((l) => l.includes("Overtime")) && labels.some((l) => l.includes("Lembur Plant")),
  JSON.stringify(labels));

section("Identifier tak dikenal di-humanize (tanpa bracket/table)");
const unknown = labelDaxRows({
  rows: [{ "Fact[Actual_Production_Qty]": 5, "ActualProductionQty2": 7 }],
  bindings: [],
});
ok("Actual_Production_Qty -> 'Actual production qty'",
  unknown.columns.some((c) => c.label === "Actual production qty"), JSON.stringify(unknown.columns));
ok("tidak ada bracket/underscore tersisa di label",
  unknown.columns.every((c) => !/[[\]_]/.test(c.label)), JSON.stringify(unknown.columns));

section("humanizeIdentifier langsung");
ok("strip table prefix + bracket", humanizeIdentifier("'MeasureTable'[OT_HOURS]") === "Ot hours",
  humanizeIdentifier("'MeasureTable'[OT_HOURS]"));
ok("camelCase dipisah", humanizeIdentifier("ActualProductionQty") === "Actual production qty",
  humanizeIdentifier("ActualProductionQty"));
ok("qualified identifier dengan quoted table berspasi dibuang seluruh prefix-nya",
  humanizeTechnicalText("Nilai 'Measure Table'[OT_HOURS] adalah 7") === "Nilai Ot hours adalah 7",
  humanizeTechnicalText("Nilai 'Measure Table'[OT_HOURS] adalah 7"));

const spacedConfigured = labelDaxRows({
  rows: [{ "'Measure Table'[OT_HOURS]": 7 }],
  bindings: [{ tableName: "Measure Table", measureName: "OT_HOURS", humanName: "Jam lembur" }],
});
ok("configured human label tetap mengalahkan fallback untuk table berspasi",
  spacedConfigured.rows[0]?.["Jam lembur"] === 7,
  JSON.stringify(spacedConfigured));

section("Blueprint legacy memisahkan label manusia dari identifier DAX");
const legacyBlueprint = buildVisualBlueprint({
  tableName: "Measures",
  measureName: "OT_HOURS",
  dimensions: ["Machine[Machine_Name]"],
});
ok("label legacy di-humanize tanpa membuang identifier teknis",
  legacyBlueprint.dimensions[0]?.humanName === "Machine name"
    && legacyBlueprint.dimensions[0]?.table === "Machine"
    && legacyBlueprint.dimensions[0]?.column === "Machine_Name",
  JSON.stringify(legacyBlueprint.dimensions[0]));

section("describeKpi");
const d = describeKpi(bindings[0]);
ok("name = human name", d.name === "Jam lembur", d.name);
ok("definition/unit/format terbawa", d.definition === "Total jam lembur" && d.unit === "jam" && d.numberFormat === "#,##0",
  JSON.stringify(d));

section("Synthesis dan fallback tidak pernah mengekspos technical keys");
const rawEvidence = {
  status: "success",
  rows: [{
    "'Dim_DBCatatan'[nama_mesin]": "Mesin A",
    "'Measures'[(M) DT Tech in Hour]": 12,
  }],
  columns: [
    { key: "'Dim_DBCatatan'[nama_mesin]", label: "Mesin" },
    { key: "'Measures'[(M) DT Tech in Hour]", label: "Durasi downtime" },
  ],
  rowCount: 1,
  period: { label: "Agustus 2026", from: "2026-08-01", to: "2026-08-30" },
  source: { dashboardId: "65", dashboardName: "Technical Downtime", semanticModel: "ORS", kpis: ["Durasi downtime"] },
};
let modelPacket;
const synthesized = await synthesizeEvidence({
  question: "mesin mana yang downtime tertinggi?", evidence: [rawEvidence],
}, { callModel: async (input) => {
  modelPacket = JSON.parse(input.question);
  return {
    text: JSON.stringify({
      answer: "'Dim_DBCatatan'[nama_mesin] Mesin A memiliki 'Measures'[(M) DT Tech in Hour] 12.",
      citedSourceIndexes: [0],
    }),
  };
} });
const packetText = JSON.stringify(modelPacket);
ok("model-facing packet hanya memakai label manusia",
  packetText.includes("Mesin") && packetText.includes("Durasi downtime")
    && !packetText.includes("nama_mesin") && !packetText.includes("Dim_DBCatatan")
    && !packetText.includes("DT Tech in Hour"), packetText);
ok("jawaban model dibersihkan sebelum sampai ke user",
  synthesized.answer.includes("Mesin") && synthesized.answer.includes("Durasi downtime")
    && !synthesized.answer.includes("nama_mesin") && !synthesized.answer.includes("Dim_DBCatatan")
    && !synthesized.answer.includes("DT Tech in Hour"), synthesized.answer);

const fallbackLabels = await synthesizeEvidence({
  question: "mesin mana yang downtime tertinggi?", evidence: [rawEvidence],
}, { callModel: async () => { throw new Error("provider unavailable"); } });
ok("fallback juga hanya memakai label manusia",
  fallbackLabels.answer.includes("Mesin:") && fallbackLabels.answer.includes("Durasi downtime:")
    && !fallbackLabels.answer.includes("nama_mesin") && !fallbackLabels.answer.includes("Dim_DBCatatan")
    && !fallbackLabels.answer.includes("DT Tech in Hour"), fallbackLabels.answer);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

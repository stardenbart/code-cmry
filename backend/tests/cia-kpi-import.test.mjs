// Import deterministik KATALOG_KPI -> KPI Library.
//
// Yang dijaga:
//  - human name BUKAN nama measure teknis (mis. "Jam lembur", bukan OT_HOURS);
//  - measure teknis tersimpan sebagai sinonim + binding measure/model;
//  - kandidat regresi (lembur, deviasi CMD 3, PO) terpetakan;
//  - import kedua kali TIDAK menduplikasi KPI maupun binding (idempoten);
//  - definition tidak dikarang bila katalog tidak punya.
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import db from "../src/config/db.js";
import { buildImportPlan, applyImport } from "../scripts/import-cia-kpi-catalog.mjs";

const sql = db.promise();

const fixtures = [
  { domain: "cost", kpi: "Jam lembur", modelName: "Dashboard Lembur Plant",
    measures: ["OT_HOURS", "(all) OT hours"], unit: "jam", dateLogic: "harian", notes: "" },
  { domain: "quality", kpi: "Kategori NC tertinggi CMD 3", modelName: "Dashboard NC dan Deviasi",
    measures: ["NC_CMD3_TOP"], unit: "", dateLogic: "harian", notes: "penjelasan issue deviasi" },
  { domain: "planning", kpi: "Akurasi PO dan Forecast", modelName: "Dashboard PPIC",
    measures: ["PO_ACC"], unit: "%", dateLogic: "bulanan" },
  // Katalog nyata kadang menaruh PROSA di field unit ("satuannya belum
  // dipastikan..."), lebih panjang dari kolom VARCHAR(40). Import tidak boleh
  // gagal karenanya.
  { domain: "maintenance", kpi: "Top mesin downtime tertinggi (uji unit panjang RDR)",
    modelName: "Maintenance Downtime", measures: ["DT_TECH_HR"],
    unit: "menit atau jam, satuannya belum dipastikan pemilik", dateLogic: "harian" },
];
const slugs = ["cost-jam-lembur", "quality-kategori-nc-tertinggi-cmd-3", "planning-akurasi-po-dan-forecast",
  "maintenance-top-mesin-downtime-tertinggi-uji-unit-panjang-rdr"];

async function cleanup() {
  for (const s of slugs) await sql.query("DELETE FROM cia_kpis WHERE slug = ?", [s]);
}

try {
  await cleanup();

  section("buildImportPlan: mapping deterministik");
  const plan = buildImportPlan(fixtures);
  ok("empat KPI terpetakan", plan.length === 4, String(plan.length));

  const lembur = plan.find((p) => p.slug === "cost-jam-lembur");
  ok("human name lembur = 'Jam lembur'", lembur.humanName === "Jam lembur", lembur.humanName);
  ok("human name BUKAN measure teknis", !/OT_HOURS/.test(lembur.humanName));
  ok("measure teknis jadi sinonim", lembur.synonyms.includes("OT_HOURS"), JSON.stringify(lembur.synonyms));
  ok("binding terikat ke semantic model", lembur.bindings[0].semanticModel === "Dashboard Lembur Plant");
  ok("satu binding per measure", lembur.bindings.length === 2, String(lembur.bindings.length));
  ok("status awal draft", lembur.status === "draft", lembur.status);

  const po = plan.find((p) => p.slug === "planning-akurasi-po-dan-forecast");
  ok("PO/PPIC terpetakan ke Dashboard PPIC", po.bindings[0].semanticModel === "Dashboard PPIC");

  const nc = plan.find((p) => p.slug === "quality-kategori-nc-tertinggi-cmd-3");
  ok("deviasi CMD 3 terpetakan", nc.humanName === "Kategori NC tertinggi CMD 3");

  // definition tidak dikarang: fixture lembur notes kosong -> definition kosong.
  ok("definition kosong tetap kosong (tidak dikarang)", lembur.definition === "", lembur.definition);

  section("applyImport idempoten (dua kali tanpa duplikat)");
  const r1 = await applyImport(plan, null);
  ok("run pertama membuat 4 KPI", r1.kpisCreated === 4, JSON.stringify(r1));
  ok("run pertama membuat 5 binding", r1.bindingsCreated === 5, JSON.stringify(r1));

  const r2 = await applyImport(plan, null);
  ok("run kedua tidak membuat KPI baru", r2.kpisCreated === 0, JSON.stringify(r2));
  ok("run kedua tidak membuat binding baru", r2.bindingsCreated === 0, JSON.stringify(r2));

  const ph = slugs.map(() => "?").join(", ");
  const [kpiCount] = await sql.query(`SELECT COUNT(*) AS n FROM cia_kpis WHERE slug IN (${ph})`, slugs);
  ok("tetap 4 KPI di database", Number(kpiCount[0].n) === 4, String(kpiCount[0].n));

  const [bindCount] = await sql.query(
    `SELECT COUNT(*) AS n FROM cia_kpi_bindings b
       JOIN cia_kpis k ON k.id = b.kpi_id WHERE k.slug IN (${ph})`, slugs);
  ok("tetap 5 binding di database", Number(bindCount[0].n) === 5, String(bindCount[0].n));

  section("unit prosa panjang di-clamp <= 40, import tidak gagal");
  const [longUnit] = await sql.query(
    "SELECT unit FROM cia_kpis WHERE slug = ?",
    ["maintenance-top-mesin-downtime-tertinggi-uji-unit-panjang-rdr"]);
  ok("KPI unit panjang tetap terimport", longUnit.length === 1, String(longUnit.length));
  ok("unit di-clamp <= 40 karakter", (longUnit[0].unit || "").length <= 40, String((longUnit[0].unit||"").length));
} finally {
  await cleanup();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

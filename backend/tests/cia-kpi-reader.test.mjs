// Read-through KPI Library + lookup deterministik untuk router.
//
// Regresi produksi yang dijaga:
//  - "breakdown lembur harian per departemen karena alasan dan kategori" ->
//    KPI lembur menang atas maintenance walau ada kata generik "breakdown";
//  - "issue deviasi cmd 3" -> KPI deviasi CMD 3 menang atas downtime generik;
//  - pertanyaan PO -> menemukan KPI/dashboard PPIC.
//  - binding missing/rejected TIDAK dipilih;
//  - ACL: user web tidak menerima binding dashboard yang tidak dimilikinya;
//  - flag mati / library kosong -> fallback KATALOG_KPI dengan shape sama.
process.env.CIA_KPI_LIBRARY_ENABLED = "true";

import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import db from "../src/config/db.js";
import { createKpi, upsertBinding } from "../src/models/ciaKpiModel.js";
import {
  searchKpiCandidates, getBindingsForKpis, readKpiLibraryStatus,
} from "../src/services/ciaKpiLibrary.service.js";

const sql = db.promise();
const cleanup = [];
const TAG = "RDRTEST";

const [users] = await sql.query("SELECT id FROM users ORDER BY id LIMIT 1");
const ACTOR = users[0]?.id ?? null;
const [dashRows] = await sql.query("SELECT id FROM dashboards ORDER BY id LIMIT 5");
const D = dashRows.map((r) => r.id);

async function seed(humanName, domain, synonyms, dashboardId, measureName, extra = {}) {
  const kpi = await createKpi({ humanName, domain, synonyms, unit: extra.unit || "",
    answerableQuestions: extra.answerableQuestions || [] }, ACTOR);
  cleanup.push(kpi.id);
  await upsertBinding({
    kpiId: kpi.id, dashboardId, semanticModel: extra.model || `Model ${humanName}`,
    measureName, source: "visual_sync",
    dimensions: extra.dimensions || [],
  });
  return kpi;
}

function rank(cands, kpiId) { return cands.findIndex((c) => c.kpiId === kpiId); }

try {
  ok("cukup dashboard fixture (>=4)", D.length >= 4, `hanya ${D.length}`);

  const lembur = await seed(`Jam lembur ${TAG}`, "cost", ["lembur", "OT_HOURS"], D[0], "OT_HOURS",
    { dimensions: ["Departemen", "Alasan", "Kategori"], answerableQuestions: ["berapa jam lembur per departemen"] });
  const maint = await seed(`Total downtime ${TAG}`, "maintenance", ["downtime"], D[1], "DT_TOTAL",
    { dimensions: ["Mesin"] });
  const deviasi = await seed(`Kategori NC tertinggi CMD 3 ${TAG}`, "quality", ["deviasi", "NC"], D[2], "NC_CMD3",
    { dimensions: ["Kategori", "Deskripsi"] });
  const ppic = await seed(`Akurasi PO dan Forecast ${TAG}`, "planning", ["PO", "forecast"], D[3], "PO_ACC");

  const ALL = D.slice(0, 4);

  section("Regresi 1: lembur menang atas maintenance");
  const q1 = await searchKpiCandidates({
    question: "breakdown lembur harian per departemen karena alasan dan kategori apa",
    allowedDashboardIds: ALL, limit: 10,
  });
  ok("lembur muncul sebagai kandidat", rank(q1, lembur.id) >= 0);
  ok("lembur peringkat teratas", q1[0]?.kpiId === lembur.id, `top=${q1[0]?.humanName}`);
  ok("lembur di atas maintenance",
    rank(q1, lembur.id) >= 0 && (rank(q1, maint.id) === -1 || rank(q1, lembur.id) < rank(q1, maint.id)));

  section("Regresi 2: deviasi CMD 3 menang atas downtime generik");
  const q2 = await searchKpiCandidates({
    question: "breakdown perihal deviasi cmd 3, berikan penjelasan mengenai issue deviasi yang terjadi",
    allowedDashboardIds: ALL, limit: 10,
  });
  ok("deviasi CMD 3 kandidat teratas", q2[0]?.kpiId === deviasi.id, `top=${q2[0]?.humanName}`);
  ok("deviasi di atas maintenance/downtime",
    rank(q2, maint.id) === -1 || rank(q2, deviasi.id) < rank(q2, maint.id));

  section("Regresi 3: PO menemukan PPIC");
  const q3 = await searchKpiCandidates({
    question: "apakah PO naik dan produk apa yang naik",
    allowedDashboardIds: ALL, limit: 10,
  });
  ok("PPIC muncul untuk pertanyaan PO", rank(q3, ppic.id) >= 0, JSON.stringify(q3.map((c) => c.humanName)));

  section("ACL: dashboard tak dimiliki tidak muncul");
  const denied = await searchKpiCandidates({
    question: `lembur ${TAG}`, allowedDashboardIds: [D[1]], limit: 10, // hanya dashboard maintenance
  });
  ok("lembur (binding dashboard D0) TIDAK muncul saat D0 di luar ACL",
    rank(denied, lembur.id) === -1, JSON.stringify(denied.map((c) => c.humanName)));
  const bindingsDenied = await getBindingsForKpis([lembur.id], [D[1]]);
  ok("getBindingsForKpis tidak membocorkan binding di luar ACL", bindingsDenied.length === 0,
    JSON.stringify(bindingsDenied));

  section("Binding missing tidak dipilih");
  await sql.query("UPDATE cia_kpi_bindings SET verification_status='missing' WHERE kpi_id=?", [ppic.id]);
  const q3b = await searchKpiCandidates({
    question: "apakah PO naik", allowedDashboardIds: ALL, limit: 10,
  });
  ok("KPI dengan binding missing tidak jadi kandidat", rank(q3b, ppic.id) === -1);

  section("Status library");
  const status = await readKpiLibraryStatus();
  ok("status melaporkan enabled true", status.enabled === true, JSON.stringify(status));
  ok("status pakai library (kpiCount>0)", status.usingLibrary === true && status.kpiCount > 0,
    JSON.stringify(status));

  section("Fallback KATALOG_KPI saat flag mati");
  process.env.CIA_KPI_LIBRARY_ENABLED = "false";
  const fb = await searchKpiCandidates({ question: "lembur", limit: 20 });
  ok("fallback mengembalikan kandidat", Array.isArray(fb) && fb.length > 0, String(fb.length));
  ok("fallback menemukan KPI lembur dari katalog",
    fb.some((c) => /lembur/i.test(c.humanName)), JSON.stringify(fb.slice(0, 3).map((c) => c.humanName)));
  const st2 = await readKpiLibraryStatus();
  ok("status fallback source=catalog", st2.source === "catalog", JSON.stringify(st2));
  process.env.CIA_KPI_LIBRARY_ENABLED = "true";
} finally {
  for (const id of cleanup) await sql.query("DELETE FROM cia_kpis WHERE id=?", [id]);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

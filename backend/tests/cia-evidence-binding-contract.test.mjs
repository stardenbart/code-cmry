// Gap integrasi Phase 2 -> Phase 3: metadata teknis binding harus mengalir utuh
// dari KPI Library reader -> evidence router -> DAX plan builder.
//
// Yang dijaga:
//  - reader (searchKpiCandidates & getBindingsForKpis) membawa bindingId (id DB),
//    bindingKey, dateTable/dateColumn/dateLogic, semanticModel/tableName/
//    measureName, displayCaption, dimensions, dashboardId/Name, dan
//    humanName/definition/unit/numberFormat untuk synthesis;
//  - router flatten MEMPERTAHANKAN seluruh metadata itu (bukan hanya measure &
//    dimensions), memakai id DB sebagai bindingId stabil (bukan synthetic);
//  - dimensions_json bentuk OBJECT {table,column,humanName} tetap terbawa;
//  - builder mengembalikan typed failure (DATE_COLUMN_NOT_ALLOWED) bila binding
//    tak punya mapping tanggal — bukan mengarang kolom.
process.env.CIA_KPI_LIBRARY_ENABLED = "true";

import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import db from "../src/config/db.js";
import { createKpi, upsertBinding } from "../src/models/ciaKpiModel.js";
import { searchKpiCandidates, getBindingsForKpis } from "../src/services/ciaKpiLibrary.service.js";
import { routeEvidence } from "../src/services/cia/evidenceRouter.js";
import { buildDaxPlan, DaxPlanError } from "../src/services/cia/daxPlanBuilder.js";

const sql = db.promise();
const cleanup = [];
const [users] = await sql.query("SELECT id FROM users ORDER BY id LIMIT 1");
const ACTOR = users[0]?.id ?? null;
const [dash] = await sql.query("SELECT id FROM dashboards ORDER BY id LIMIT 1");
const DASH = dash[0]?.id;
const TOKEN = "gapcontractzz";

try {
  ok("ada dashboard fixture", Boolean(DASH), "tidak ada dashboard");

  const kpi = await createKpi({
    humanName: "Gap Contract KPI", domain: "test", synonyms: [TOKEN],
    definition: "definisi gap contract", unit: "jam", numberFormat: "#,##0",
  }, ACTOR);
  cleanup.push(kpi.id);

  const dims = [{ table: "FactOT", column: "Departemen", humanName: "Departemen" }];
  const { key: bkey } = await upsertBinding({
    kpiId: kpi.id, dashboardId: DASH, semanticModel: "Model Gap", tableName: "FactOT",
    measureName: "OT_HOURS_GAP", displayCaption: "Jam Lembur", dimensions: dims,
    dateTable: "DimDate", dateColumn: "Date", dateLogic: "harian", source: "visual_sync",
  });

  section("Reader searchKpiCandidates membawa metadata teknis lengkap");
  const cands = await searchKpiCandidates({ question: TOKEN, allowedDashboardIds: [DASH], limit: 10 });
  const mine = cands.find((c) => c.kpiId === kpi.id);
  ok("candidate ditemukan", Boolean(mine));
  ok("candidate membawa definition", mine?.definition === "definisi gap contract", mine?.definition);
  ok("candidate membawa unit & numberFormat", mine?.unit === "jam" && mine?.numberFormat === "#,##0");
  const b = (mine?.bindings || [])[0];
  ok("binding punya bindingId numerik (id DB)", Number.isInteger(b?.bindingId) && b.bindingId > 0, String(b?.bindingId));
  ok("binding punya bindingKey", b?.bindingKey === bkey, b?.bindingKey);
  ok("binding punya dateTable/dateColumn/dateLogic",
    b?.dateTable === "DimDate" && b?.dateColumn === "Date" && b?.dateLogic === "harian",
    JSON.stringify({ t: b?.dateTable, c: b?.dateColumn, l: b?.dateLogic }));
  ok("binding punya semanticModel/tableName/measureName",
    b?.semanticModel === "Model Gap" && b?.tableName === "FactOT" && b?.measureName === "OT_HOURS_GAP");
  ok("binding punya displayCaption", b?.displayCaption === "Jam Lembur");
  ok("binding dimensions object dipertahankan",
    Array.isArray(b?.dimensions) && b.dimensions[0]?.column === "Departemen", JSON.stringify(b?.dimensions));

  section("getBindingsForKpis membawa metadata untuk follow-up");
  const fb = await getBindingsForKpis([kpi.id], [DASH]);
  const f = fb[0];
  ok("follow-up binding punya bindingId", Number.isInteger(f?.bindingId) && f.bindingId > 0);
  ok("follow-up binding punya date mapping", f?.dateTable === "DimDate" && f?.dateColumn === "Date");
  ok("follow-up binding membawa humanName/definition/unit", f?.humanName === "Gap Contract KPI"
    && f?.definition === "definisi gap contract" && f?.unit === "jam");

  section("Router flatten mempertahankan metadata & id stabil");
  const route = await routeEvidence(
    { question: TOKEN, periods: [], scope: { allowedDashboardIds: [DASH], mode: "user_acl" } },
    { searchKpiCandidates });
  ok("route ready", route.status === "ready", route.status);
  const rc = route.candidates.find((c) => c.kpiId === kpi.id);
  ok("router bindingId = id DB stabil (bukan synthetic)", rc?.bindingId === String(b.bindingId),
    `${rc?.bindingId} vs ${b.bindingId}`);
  ok("router mempertahankan bindingKey", rc?.bindingKey === bkey, rc?.bindingKey);
  ok("router mempertahankan dateTable/dateColumn/dateLogic",
    rc?.dateTable === "DimDate" && rc?.dateColumn === "Date" && rc?.dateLogic === "harian",
    JSON.stringify({ t: rc?.dateTable, c: rc?.dateColumn }));
  ok("router mempertahankan definition/unit/numberFormat",
    rc?.definition === "definisi gap contract" && rc?.unit === "jam" && rc?.numberFormat === "#,##0");
  ok("router mempertahankan displayCaption & reportId key present",
    rc?.displayCaption === "Jam Lembur" && "reportId" in rc);
  ok("router mempertahankan dimensions object",
    Array.isArray(rc?.dimensions) && rc.dimensions[0]?.column === "Departemen", JSON.stringify(rc?.dimensions));

  section("Builder: binding tanpa mapping tanggal -> typed failure (tidak mengarang)");
  const schema = {
    model: "Model Gap", datasetId: "ds", tabel: [{ tabel: "FactOT", kolom: ["Departemen"] }],
    measure: ["OT_HOURS_GAP"],
  };
  let typed = false;
  try {
    buildDaxPlan({
      goal: { dimensions: [] },
      binding: { semanticModel: "Model Gap", tableName: "FactOT", measureName: "OT_HOURS_GAP" }, // no dateTable/dateColumn
      period: { from: "2026-08-01", to: "2026-08-31" }, schema,
    });
  } catch (e) {
    typed = e instanceof DaxPlanError && e.code === "DATE_COLUMN_NOT_ALLOWED";
  }
  ok("binding tanpa dateColumn melempar DATE_COLUMN_NOT_ALLOWED", typed);
} finally {
  for (const id of cleanup) await sql.query("DELETE FROM cia_kpis WHERE id=?", [id]);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

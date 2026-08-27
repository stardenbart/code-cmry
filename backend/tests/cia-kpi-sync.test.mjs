// Reconcile binding KPI dari inventory Power BI (model_measure + visual_field_usage).
//
// Matrix yang dijaga (dengan inventory PALSU supaya deterministik):
//  - binding baru            -> discovered (created);
//  - binding sama lagi        -> last_seen_at maju, refreshed (bukan created);
//  - binding hilang           -> missing (BUKAN dihapus);
//  - binding muncul kembali   -> dihidupkan lagi (missing_since null, discovered);
//  - binding confirmed Admin  -> TIDAK diturunkan jadi missing walau tak terlihat;
//  - human name KPI           -> tidak pernah disentuh sync.
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import db from "../src/config/db.js";
import { createKpi } from "../src/models/ciaKpiModel.js";
import { syncKpiBindings, getSyncRun } from "../src/services/ciaKpiSync.service.js";

const sql = db.promise();
const cleanupKpis = [];

const [users] = await sql.query("SELECT id FROM users ORDER BY id LIMIT 1");
const ACTOR = users[0]?.id ?? null;
const [dash] = await sql.query("SELECT id, report_id FROM dashboards ORDER BY id LIMIT 1");
const DASH_ID = dash[0]?.id;
const REPORT_ID = dash[0]?.report_id || "00000000-0000-0000-0000-000000000000";

const MEASURE = "OT_HOURS_SYNCTEST";
const DIM = "Departemen";

function fakeInventory(includeVisual) {
  return {
    async measureIndex() {
      return new Map([[MEASURE.toLowerCase(), { modelName: "Dashboard Lembur Plant", tableName: "FactOT" }]]);
    },
    async listDashboards() { return [{ id: DASH_ID, report_id: REPORT_ID }]; },
    async listVisualFields() {
      if (!includeVisual) return [];
      return [
        { report_id: REPORT_ID, page_name: "Ringkasan", visual_title: "Lembur per Dept", field_name: MEASURE },
        { report_id: REPORT_ID, page_name: "Ringkasan", visual_title: "Lembur per Dept", field_name: DIM },
      ];
    },
  };
}

async function bindingRow(kpiId) {
  const [rows] = await sql.query(
    `SELECT * FROM cia_kpi_bindings WHERE kpi_id=? AND source='visual_sync' ORDER BY id DESC LIMIT 1`, [kpiId]);
  return rows[0] || null;
}

try {
  ok("ada dashboard fixture untuk FK", Boolean(DASH_ID), "tidak ada dashboard di DB");

  const kpi = await createKpi({
    humanName: "Jam lembur (sync test)", domain: "cost",
    synonyms: [MEASURE], unit: "jam",
  }, ACTOR);
  cleanupKpis.push(kpi.id);

  section("Ronde 1: binding baru -> discovered");
  const r1 = await syncKpiBindings({ actorId: ACTOR, inventory: fakeInventory(true) });
  ok("status success", r1.status === "success", JSON.stringify(r1.errors));
  ok("runId ada", typeof r1.runId === "string" && r1.runId.length > 0);
  ok("dashboard discan", r1.dashboardsScanned >= 1, String(r1.dashboardsScanned));
  ok("visual terlihat", r1.visualsSeen >= 1, String(r1.visualsSeen));
  ok("binding dibuat", r1.bindingsCreated >= 1, String(r1.bindingsCreated));
  const b1 = await bindingRow(kpi.id);
  ok("binding discovered", b1?.verification_status === "discovered", b1?.verification_status);
  ok("dashboard_id terisi (untuk ACL)", Number(b1?.dashboard_id) === Number(DASH_ID), String(b1?.dashboard_id));
  ok("dimension tercatat di binding", JSON.stringify(b1?.dimensions_json || []).includes(DIM),
    JSON.stringify(b1?.dimensions_json));
  ok("measure teknis tersimpan", b1?.measure_name === MEASURE, b1?.measure_name);

  section("Ronde 2: binding sama -> refreshed, bukan created");
  const r2 = await syncKpiBindings({ actorId: ACTOR, inventory: fakeInventory(true) });
  ok("tidak ada binding baru", r2.bindingsCreated === 0, String(r2.bindingsCreated));
  ok("binding di-refresh", r2.bindingsRefreshed >= 1, String(r2.bindingsRefreshed));

  section("Ronde 3: binding hilang -> missing (tidak dihapus)");
  const r3 = await syncKpiBindings({ actorId: ACTOR, inventory: fakeInventory(false) });
  ok("ada binding jadi missing", r3.bindingsMissing >= 1, String(r3.bindingsMissing));
  const b3 = await bindingRow(kpi.id);
  ok("binding masih ADA (tidak dihapus)", Boolean(b3), "hilang");
  ok("status jadi missing", b3?.verification_status === "missing", b3?.verification_status);
  ok("missing_since terisi", Boolean(b3?.missing_since));

  section("Ronde 4: binding muncul kembali -> dihidupkan lagi");
  const r4 = await syncKpiBindings({ actorId: ACTOR, inventory: fakeInventory(true) });
  const b4 = await bindingRow(kpi.id);
  ok("status kembali discovered", b4?.verification_status === "discovered", b4?.verification_status);
  ok("missing_since dibersihkan", b4?.missing_since === null, String(b4?.missing_since));

  section("Binding confirmed Admin tidak diturunkan jadi missing");
  await sql.query("UPDATE cia_kpi_bindings SET verification_status='confirmed' WHERE id=?", [b4.id]);
  await syncKpiBindings({ actorId: ACTOR, inventory: fakeInventory(false) });
  const bc = await bindingRow(kpi.id);
  ok("tetap confirmed walau tak terlihat", bc?.verification_status === "confirmed", bc?.verification_status);

  section("Sync tidak menyentuh human name KPI");
  const [k] = await sql.query("SELECT human_name, version FROM cia_kpis WHERE id=?", [kpi.id]);
  ok("human name tetap", k[0].human_name === "Jam lembur (sync test)", k[0].human_name);
  ok("versi KPI tidak dinaikkan sync", Number(k[0].version) === 1, String(k[0].version));

  section("getSyncRun mengembalikan audit");
  const run = await getSyncRun(r1.runId);
  ok("run terbaca", run && run.runId === r1.runId);
  ok("run punya status terminal", ["success", "partial", "error"].includes(run.status), run.status);
} finally {
  for (const id of cleanupKpis) await sql.query("DELETE FROM cia_kpis WHERE id=?", [id]);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

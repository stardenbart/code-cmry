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
import crypto from "crypto";
import { ok, section, summary } from "./harness.mjs";
import db from "../src/config/db.js";
import { createKpi, upsertBinding } from "../src/models/ciaKpiModel.js";
import { syncKpiBindings, getSyncRun } from "../src/services/ciaKpiSync.service.js";

const sql = db.promise();
const cleanupKpis = [];

const [users] = await sql.query("SELECT id FROM users ORDER BY id LIMIT 1");
const ACTOR = users[0]?.id ?? null;
const [dash] = await sql.query("SELECT id, report_id FROM dashboards ORDER BY id LIMIT 1");
const DASH_ID = dash[0]?.id;
const REPORT_ID = dash[0]?.report_id || "00000000-0000-0000-0000-000000000000";

const MEASURE = "OT_HOURS_SYNCTEST";
const VISUAL_ALIAS = "Jam Lembur Tampil";
const MODEL_ANCHOR = "Model Anchor Measure";
const DIM = "Departemen";

function fakeInventory(includeVisual, includeModelAnchor = true) {
  return {
    async measureIndex() {
      return new Map([
        [MEASURE.toLowerCase(), { modelName: "Dashboard Lembur Plant", tableName: "FactOT" }],
        [MODEL_ANCHOR.toLowerCase(), { modelName: "Dashboard Lembur Plant", tableName: "FactOT" }],
      ]);
    },
    async listDashboards() { return [{ id: DASH_ID, report_id: REPORT_ID }]; },
    async listVisualFields() {
      if (!includeVisual) return [];
      return [
        { report_id: REPORT_ID, page_name: "Ringkasan", visual_title: "Lembur per Dept", field_name: VISUAL_ALIAS },
        { report_id: REPORT_ID, page_name: "Ringkasan", visual_title: "Lembur per Dept", field_name: DIM },
        ...(includeModelAnchor ? [{ report_id: REPORT_ID, page_name: "Anchor", visual_title: "Anchor", field_name: MODEL_ANCHOR }] : []),
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
  await upsertBinding({
    kpiId: kpi.id,
    semanticModel: "Dashboard Lembur Plant",
    measureName: MEASURE,
    displayCaption: VISUAL_ALIAS,
    dimensions: [{ table: "FactOT", column: "Departemen", humanName: "Departemen" }],
    dateTable: "Dim_Date",
    dateColumn: "Date",
    dateLogic: "difilter tanggal lembur",
    source: "catalog_import",
  });
  const siblingKpi = await createKpi({
    humanName: "Lembur per plant (shared measure sync test)", domain: "cost",
    synonyms: [MEASURE], unit: "jam",
  }, ACTOR);
  cleanupKpis.push(siblingKpi.id);
  await upsertBinding({
    kpiId: siblingKpi.id,
    semanticModel: "Dashboard Lembur Plant",
    measureName: MEASURE,
    displayCaption: VISUAL_ALIAS,
    dimensions: [{ table: "Dim_Plant", column: "Plant", humanName: "Plant" }],
    dateTable: "Dim_Date",
    dateColumn: "Date",
    dateLogic: "difilter tanggal lembur",
    source: "catalog_import",
  });

  section("Alias visual wajib di-anchor semantic model dashboard");
  const unsafe = await syncKpiBindings({ actorId: ACTOR, inventory: fakeInventory(true, false) });
  ok("alias tanpa satu pun measure asli model tidak membuat binding", unsafe.bindingsCreated === 0,
    String(unsafe.bindingsCreated));

  section("Ronde 1: binding baru -> discovered");
  const r1 = await syncKpiBindings({ actorId: ACTOR, inventory: fakeInventory(true) });
  ok("status success", r1.status === "success", JSON.stringify(r1.errors));
  ok("runId ada", typeof r1.runId === "string" && r1.runId.length > 0);
  ok("dashboard discan", r1.dashboardsScanned >= 1, String(r1.dashboardsScanned));
  ok("visual terlihat", r1.visualsSeen >= 1, String(r1.visualsSeen));
  ok("shared alias membuat binding untuk kedua konsep KPI", r1.bindingsCreated >= 2, String(r1.bindingsCreated));
  const b1 = await bindingRow(kpi.id);
  ok("binding discovered", b1?.verification_status === "discovered", b1?.verification_status);
  ok("dashboard_id terisi (untuk ACL)", Number(b1?.dashboard_id) === Number(DASH_ID), String(b1?.dashboard_id));
  ok("dimension tercatat di binding", JSON.stringify(b1?.dimensions_json || []).includes(DIM),
    JSON.stringify(b1?.dimensions_json));
  ok("measure teknis tersimpan", b1?.measure_name === MEASURE, b1?.measure_name);
  ok("alias visual di-resolve ke measure teknis", b1?.display_caption === "Lembur per Dept",
    b1?.display_caption);
  ok("mapping tanggal katalog ikut ke binding visual", b1?.date_table === "Dim_Date"
    && b1?.date_column === "Date", JSON.stringify(b1));
  ok("dimensi qualified katalog ikut ke binding visual",
    b1?.dimensions_json?.[0]?.table === "FactOT" && b1?.dimensions_json?.[0]?.column === "Departemen",
    JSON.stringify(b1?.dimensions_json));
  const siblingBinding = await bindingRow(siblingKpi.id);
  ok("binding konsep kedua tidak tertimpa konsep pertama",
    siblingBinding?.dimensions_json?.[0]?.table === "Dim_Plant",
    JSON.stringify(siblingBinding?.dimensions_json));

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

  section("Binding visual key format lama dipensiunkan setelah replacement dibuat");
  const legacyRaw = [bc.dashboard_id, bc.semantic_model, bc.table_name, bc.measure_name,
    bc.page_name, bc.visual_title].map((v) => String(v ?? "").trim().toLowerCase()).join("|");
  const legacyKey = crypto.createHash("sha256").update(legacyRaw, "utf8").digest("hex");
  await sql.query("UPDATE cia_kpi_bindings SET binding_key=?, verification_status='confirmed' WHERE id=?",
    [legacyKey, bc.id]);
  await syncKpiBindings({ actorId: ACTOR, inventory: fakeInventory(true) });
  const [legacyRows] = await sql.query("SELECT verification_status,missing_since FROM cia_kpi_bindings WHERE id=?", [bc.id]);
  ok("legacy confirmed menjadi missing", legacyRows[0]?.verification_status === "missing",
    legacyRows[0]?.verification_status);
  ok("legacy missing_since terisi", Boolean(legacyRows[0]?.missing_since));
  const replacement = await bindingRow(kpi.id);
  ok("replacement aktif tersedia", replacement && replacement.id !== bc.id
    && replacement.verification_status === "discovered", JSON.stringify(replacement));

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

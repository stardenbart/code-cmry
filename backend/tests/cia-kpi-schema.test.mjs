// KPI Library: skema cia_kpis / cia_kpi_bindings / cia_kpi_revisions /
// cia_kpi_sync_runs.
//
// Sama seperti cia-telemetry: repo ini tidak punya runner migrasi pencatat,
// jadi uji information_schema inilah satu-satunya penjaga bahwa kolom & indeks
// penting benar-benar terpasang. binding_key yang unik, misalnya, adalah dasar
// idempotensi import dan reconcile — tanpa keunikan itu sync menduplikasi
// binding tiap kali berjalan.
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import db from "../src/config/db.js";

const sql = db.promise();

const kpiColumns = [
  "slug", "human_name", "synonyms_json", "definition", "business_function",
  "answerable_questions_json", "domain", "unit", "number_format", "status",
  "version", "source", "created_by", "updated_by", "created_at", "updated_at",
];
const bindingColumns = [
  "binding_key", "kpi_id", "dashboard_id", "report_id", "page_name",
  "visual_title", "semantic_model", "table_name", "measure_name",
  "display_caption", "dimensions_json", "date_table", "date_column",
  "date_logic", "source", "verification_status", "first_seen_at",
  "last_seen_at", "missing_since",
];
const revisionColumns = [
  "kpi_id", "version", "before_json", "after_json", "reason", "action",
  "actor_id", "created_at",
];
const syncRunColumns = [
  "run_uuid", "status", "dashboards_scanned", "measures_seen", "visuals_seen",
  "bindings_created", "bindings_refreshed", "bindings_missing", "errors_json",
  "actor_id", "started_at", "finished_at",
];

async function columnsOf(table) {
  const [rows] = await sql.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]);
  return new Set(rows.map((r) => r.COLUMN_NAME));
}
async function indexesOf(table) {
  const [rows] = await sql.query(
    `SELECT INDEX_NAME, NON_UNIQUE FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]);
  const byName = new Map();
  for (const r of rows) byName.set(r.INDEX_NAME, Number(r.NON_UNIQUE));
  return byName;
}

async function assertColumns(table, required) {
  const cols = await columnsOf(table);
  ok(`tabel ${table} ada`, cols.size > 0, "belum dibuat");
  for (const c of required) ok(`${table}.${c} ada`, cols.has(c), "kolom hilang");
}

section("Skema cia_kpis");
await assertColumns("cia_kpis", kpiColumns);
{
  const idx = await indexesOf("cia_kpis");
  ok("cia_kpis.slug unik", idx.get("uq_cia_kpis_slug") === 0, `NON_UNIQUE=${idx.get("uq_cia_kpis_slug")}`);
}

section("Skema cia_kpi_bindings");
await assertColumns("cia_kpi_bindings", bindingColumns);
{
  const idx = await indexesOf("cia_kpi_bindings");
  ok("cia_kpi_bindings.binding_key unik",
    idx.get("uq_cia_kpi_bindings_key") === 0, `NON_UNIQUE=${idx.get("uq_cia_kpi_bindings_key")}`);
  ok("indeks (kpi_id) ada", idx.has("idx_cia_kpi_bindings_kpi"));
  ok("indeks (dashboard_id) ada", idx.has("idx_cia_kpi_bindings_dashboard"));
}

section("Skema cia_kpi_revisions");
await assertColumns("cia_kpi_revisions", revisionColumns);
{
  const idx = await indexesOf("cia_kpi_revisions");
  ok("indeks (kpi_id, version) ada", idx.has("idx_cia_kpi_revisions_kpi_version"));
}

section("Skema cia_kpi_sync_runs");
await assertColumns("cia_kpi_sync_runs", syncRunColumns);
{
  const idx = await indexesOf("cia_kpi_sync_runs");
  ok("cia_kpi_sync_runs.run_uuid unik",
    idx.get("uq_cia_kpi_sync_runs_uuid") === 0, `NON_UNIQUE=${idx.get("uq_cia_kpi_sync_runs_uuid")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

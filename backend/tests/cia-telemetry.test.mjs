// Telemetry CIA: skema observability + lifecycle request/event.
//
// Bagian pertama menegaskan BENTUK skema lewat information_schema, karena
// migrasi MySQL di repo ini tidak punya runner pencatat dan satu-satunya
// penjaga bahwa kolom/indeks penting benar-benar ada adalah uji ini. Tanpa
// kolom `legacy_source`/`legacy_id` yang unik, misalnya, backfill log lama
// akan menduplikasi baris setiap kali dijalankan.
//
// Uji ini menyentuh database sungguhan (sama seperti db-pool/kpi-catalog),
// jadi ia mengikuti pola harness yang sudah ada. Penjaga "jalan langsung" di
// bawah membuat `node tests/cia-telemetry.test.mjs` bisa berhenti sendiri;
// tanpa itu pool MySQL menahan event loop dan proses menggantung.
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import db from "../src/config/db.js";

const sql = db.promise();

const requiredRequestColumns = [
  "request_uuid", "user_id", "actor_name", "department", "surface",
  "question_preview", "question_fingerprint", "status", "retrieval_method",
  "input_tokens", "output_tokens", "total_tokens", "latency_ms",
  "retrieval_rounds", "started_at", "finished_at", "legacy_source", "legacy_id",
];
const requiredEventColumns = [
  "request_id", "sequence_no", "stage", "dashboard_id", "semantic_model",
  "provider", "ai_model", "input_tokens", "output_tokens", "total_tokens",
  "latency_ms", "rows_returned", "status", "error_code", "error_message",
  "metadata_json", "created_at",
];

async function columnsOf(table) {
  const [rows] = await sql.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set(rows.map((r) => r.COLUMN_NAME));
}

async function indexesOf(table) {
  const [rows] = await sql.query(
    `SELECT INDEX_NAME, NON_UNIQUE FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  const byName = new Map();
  for (const r of rows) byName.set(r.INDEX_NAME, Number(r.NON_UNIQUE));
  return byName;
}

section("Skema cia_requests");

const reqCols = await columnsOf("cia_requests");
ok("tabel cia_requests ada", reqCols.size > 0, "tabel belum dibuat");
for (const col of requiredRequestColumns) {
  ok(`cia_requests punya kolom ${col}`, reqCols.has(col), "kolom hilang");
}

const reqIdx = await indexesOf("cia_requests");
ok("indeks idx_cia_requests_started ada", reqIdx.has("idx_cia_requests_started"));
ok("indeks idx_cia_requests_user_started ada", reqIdx.has("idx_cia_requests_user_started"));
ok("indeks idx_cia_requests_department_started ada", reqIdx.has("idx_cia_requests_department_started"));
ok("indeks idx_cia_requests_surface_status ada", reqIdx.has("idx_cia_requests_surface_status"));
ok("uq_cia_requests_uuid unik", reqIdx.get("uq_cia_requests_uuid") === 0,
  `NON_UNIQUE=${reqIdx.get("uq_cia_requests_uuid")}`);
ok("uq_cia_requests_legacy unik", reqIdx.get("uq_cia_requests_legacy") === 0,
  `NON_UNIQUE=${reqIdx.get("uq_cia_requests_legacy")}`);

section("Skema cia_request_events");

const evCols = await columnsOf("cia_request_events");
ok("tabel cia_request_events ada", evCols.size > 0, "tabel belum dibuat");
for (const col of requiredEventColumns) {
  ok(`cia_request_events punya kolom ${col}`, evCols.has(col), "kolom hilang");
}

const evIdx = await indexesOf("cia_request_events");
ok("indeks (request_id, sequence_no) ada", evIdx.has("idx_cia_events_request_seq"));
ok("indeks (dashboard_id, created_at) ada", evIdx.has("idx_cia_events_dashboard_created"));
ok("indeks (stage, status, created_at) ada", evIdx.has("idx_cia_events_stage_status_created"));

// Penjaga "jalan langsung": hanya berhenti-sendiri saat file ini dijalankan
// langsung, BUKAN saat di-import run-all.mjs (yang memanggil summary()+exit
// sekali di akhir untuk seluruh suite).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

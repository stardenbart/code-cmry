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
import crypto from "crypto";
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import db from "../src/config/db.js";
import {
  insertRequest, insertEvent, finishRequest, findRequestTrace,
} from "../src/models/ciaTelemetryModel.js";

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

section("Lifecycle request + event");

// user_id NULL sengaja dipakai supaya fixture tidak bergantung pada isi tabel
// users dan tidak menyentuh FK.
let fixtureId = null;
try {
  const uuid = crypto.randomUUID();
  const { id, requestId } = await insertRequest({
    requestId: uuid,
    surface: "dashboard",
    questionPreview: "uji lifecycle telemetry",
    questionFingerprint: "a".repeat(64),
  });
  fixtureId = id;
  ok("insertRequest mengembalikan id numerik", Number.isInteger(id) && id > 0, String(id));
  ok("insertRequest mengembalikan requestId yang sama", requestId === uuid, requestId);

  const ev1 = await insertEvent(id, {
    sequenceNo: 1, stage: "route",
    inputTokens: 6, outputTokens: 3, totalTokens: 9,
    metadata: { candidates: 2 },
  });
  const ev2 = await insertEvent(id, {
    sequenceNo: 2, stage: "synthesize", provider: "gemini", aiModel: "gemini-x",
    inputTokens: 4, outputTokens: 2, totalTokens: 6,
  });
  ok("insertEvent mengembalikan id numerik", Number.isInteger(ev1) && ev1 > 0 && ev2 > ev1);

  await finishRequest(id, {
    status: "success", retrievalMethod: "live_dax",
    inputTokens: 10, outputTokens: 5, totalTokens: 15,
    latencyMs: 1234, retrievalRounds: 2,
  });

  const trace = await findRequestTrace(uuid);
  ok("findRequestTrace menemukan request", Boolean(trace), "null");
  ok("status tersimpan", trace?.request?.status === "success", trace?.request?.status);
  ok("retrieval_method tersimpan", trace?.request?.retrieval_method === "live_dax",
    trace?.request?.retrieval_method);
  ok("token summary 10/5/15",
    Number(trace?.request?.input_tokens) === 10 &&
    Number(trace?.request?.output_tokens) === 5 &&
    Number(trace?.request?.total_tokens) === 15,
    `${trace?.request?.input_tokens}/${trace?.request?.output_tokens}/${trace?.request?.total_tokens}`);
  ok("latency + rounds tersimpan",
    Number(trace?.request?.latency_ms) === 1234 && Number(trace?.request?.retrieval_rounds) === 2);
  ok("dua event terurut sequence 1,2",
    trace?.events?.length === 2 &&
    Number(trace.events[0].sequence_no) === 1 &&
    Number(trace.events[1].sequence_no) === 2,
    `events=${trace?.events?.length}`);
  ok("metadata_json ter-parse kembali",
    trace?.events?.[0]?.metadata_json?.candidates === 2,
    JSON.stringify(trace?.events?.[0]?.metadata_json));

  const missing = await findRequestTrace("00000000-0000-0000-0000-000000000000");
  ok("uuid tak dikenal mengembalikan null", missing === null, JSON.stringify(missing));
} finally {
  if (fixtureId != null) {
    // Events terhapus lewat ON DELETE CASCADE.
    await sql.query("DELETE FROM cia_requests WHERE id = ?", [fixtureId]);
  }
}

// Penjaga "jalan langsung": hanya berhenti-sendiri saat file ini dijalankan
// langsung, BUKAN saat di-import run-all.mjs (yang memanggil summary()+exit
// sekali di akhir untuk seluruh suite).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

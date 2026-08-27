-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: observability kanonis untuk CIA (Fase 1 evidence platform).
-- Aman diulang.
--
-- Dua tabel: satu baris `cia_requests` per pertanyaan/generation, dan baris
-- berurutan `cia_request_events` untuk tiap tahap retrieval/AI. Analytics Admin
-- menghitung request dari `cia_requests` dan melakukan drill-down lewat events,
-- sehingga filter dashboard/surface/status memakai kolom biasa, bukan mengorek
-- JSON.
--
-- Keduanya dibuat lewat CREATE TABLE IF NOT EXISTS dengan seluruh indeks dan
-- foreign key inline. Itu sebabnya tidak ada penjagaan information_schema
-- per-kolom seperti add_cia_access.sql: karena tabel dibuat sekali utuh,
-- menjalankan migrasi kedua kali tidak mengubah apa pun (tabelnya sudah ada,
-- pernyataannya jadi no-op) — bukan melempar error seperti ADD COLUMN polos.
--
-- VARCHAR dipakai untuk surface/stage/status, BUKAN ENUM: PRD menyatakan
-- surface dan stage akan bertambah (mis. multi_chat, whatsapp, schedule;
-- generate_dax, repair_dax), dan menambah nilai ENUM butuh ALTER yang mengunci
-- tabel. VARCHAR pendek tidak.
--
-- Foreign key user_id/dashboard_id memakai ON DELETE SET NULL: telemetry
-- historis tidak boleh hilang ketika user atau dashboard dihapus — snapshot
-- nama/departemen di baris request tetap menyimpan konteks agregasi. Sebaliknya
-- events memakai ON DELETE CASCADE ke request induknya karena event tanpa
-- request tidak punya arti.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cia_requests (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- request_uuid dibuat di application layer dengan crypto.randomUUID() dan
  -- mengikat seluruh tahap satu request end-to-end.
  request_uuid         CHAR(36)     NOT NULL,

  -- Nullable untuk job/WhatsApp yang tidak selalu punya user website.
  user_id              INT          NULL,

  -- Snapshot nama/departemen supaya agregasi historis tetap benar walau user
  -- berganti departemen atau dihapus.
  actor_name           VARCHAR(150) NULL,
  department           VARCHAR(100) NULL,

  surface              VARCHAR(40)  NOT NULL,
  conversation_ref     VARCHAR(100) NULL,

  -- Telemetry tidak menyimpan pertanyaan utuh. Maksimal 300 karakter preview
  -- plus fingerprint SHA-256 (64 hex) untuk mengelompokkan pertanyaan serupa.
  question_preview     VARCHAR(300) NULL,
  question_fingerprint CHAR(64)     NULL,

  status               VARCHAR(30)  NOT NULL DEFAULT 'started',
  retrieval_method     VARCHAR(30)  NULL,

  input_tokens         INT          NOT NULL DEFAULT 0,
  output_tokens        INT          NOT NULL DEFAULT 0,
  total_tokens         INT          NOT NULL DEFAULT 0,
  latency_ms           INT          NULL,
  retrieval_rounds     INT          NOT NULL DEFAULT 0,

  started_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at          DATETIME     NULL,

  -- Idempotensi backfill: satu baris legacy hanya boleh dipetakan satu kali.
  -- Untuk request live keduanya NULL; MySQL memperlakukan NULL sebagai berbeda
  -- pada unique index, jadi banyak request live tidak saling bentrok.
  legacy_source        VARCHAR(40)  NULL,
  legacy_id            VARCHAR(64)  NULL,

  KEY idx_cia_requests_started (started_at),
  KEY idx_cia_requests_user_started (user_id, started_at),
  KEY idx_cia_requests_department_started (department, started_at),
  KEY idx_cia_requests_surface_status (surface, status),
  UNIQUE KEY uq_cia_requests_uuid (request_uuid),
  UNIQUE KEY uq_cia_requests_legacy (legacy_source, legacy_id),

  CONSTRAINT fk_cia_requests_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cia_request_events (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,

  request_id     BIGINT       NOT NULL,

  -- Urutan tahap dalam satu request; mulai dari 1.
  sequence_no    INT          NOT NULL,

  -- route | plan | schema | generate_dax | execute_dax | repair_dax |
  -- synthesize | fallback | request_received | snapshot_read | ai_synthesis |
  -- response_sent | request_failed. VARCHAR agar bertambah tanpa ALTER ENUM.
  stage          VARCHAR(40)  NOT NULL,

  dashboard_id   INT          NULL,
  dashboard_name VARCHAR(200) NULL,
  semantic_model VARCHAR(200) NULL,

  provider       VARCHAR(40)  NULL,
  ai_model       VARCHAR(100) NULL,

  input_tokens   INT          NOT NULL DEFAULT 0,
  output_tokens  INT          NOT NULL DEFAULT 0,
  total_tokens   INT          NOT NULL DEFAULT 0,
  latency_ms     INT          NULL,
  rows_returned  INT          NULL,

  status         VARCHAR(30)  NOT NULL DEFAULT 'success',

  -- Error yang sudah disanitasi: kode ternormalisasi + pesan pendek. TIDAK
  -- boleh memuat DAX mentah, secret, atau body response Power BI.
  error_code     VARCHAR(60)  NULL,
  error_message  VARCHAR(500) NULL,

  -- Metadata JSON tanpa secret (mis. jumlah kandidat, join keys, periode).
  metadata_json  JSON         NULL,

  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_cia_events_request_seq (request_id, sequence_no),
  KEY idx_cia_events_dashboard_created (dashboard_id, created_at),
  KEY idx_cia_events_stage_status_created (stage, status, created_at),

  CONSTRAINT fk_cia_events_request FOREIGN KEY (request_id)
    REFERENCES cia_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_cia_events_dashboard FOREIGN KEY (dashboard_id)
    REFERENCES dashboards (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

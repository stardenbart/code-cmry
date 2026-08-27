-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: KPI Library ter-versioning (Fase 2 evidence platform).
-- Aman diulang.
--
-- Empat tabel:
--   cia_kpis            konsep bisnis (nama manusia, sinonim, definisi, domain).
--   cia_kpi_bindings    ikatan konsep -> measure/model/dashboard/visual aktual.
--   cia_kpi_revisions   histori immutable tiap edit/confirm/restore.
--   cia_kpi_sync_runs   audit tiap sinkronisasi dari inventory Power BI.
--
-- Semua dibuat lewat CREATE TABLE IF NOT EXISTS dengan indeks & FK inline,
-- sehingga menjalankan migrasi dua kali menjadi no-op (bukan error), pola yang
-- sama dengan add_cia_observability.sql — tidak butuh penjagaan information_schema
-- per-kolom karena tabel dibuat sekali utuh.
--
-- VARCHAR (bukan ENUM) untuk status/verification_status/source: nilainya
-- bertambah seiring rollout (draft|confirmed|deprecated;
-- discovered|confirmed|missing|rejected) dan menambah nilai ENUM mengunci tabel.
--
-- binding_key = SHA-256 hex dari (dashboard, model, table, measure, page, visual)
-- dan UNIK: itulah dasar idempotensi import & reconcile. Binding yang hilang saat
-- sync TIDAK dihapus — verification_status-nya menjadi 'missing'.
--
-- FK user memakai ON DELETE SET NULL agar histori/binding tidak hilang saat akun
-- dihapus; FK ke cia_kpis memakai CASCADE karena binding/revisi tanpa KPI induk
-- tidak berarti.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cia_kpis (
  id                        BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- Identitas stabil; dibuat saat create dari domain+nama dan TIDAK berubah
  -- walau human_name diedit, supaya deep-link & binding tetap valid.
  slug                      VARCHAR(160) NOT NULL,

  human_name                VARCHAR(200) NOT NULL,
  synonyms_json             JSON         NULL,
  definition                TEXT         NULL,
  business_function         VARCHAR(300) NULL,
  answerable_questions_json JSON         NULL,
  domain                    VARCHAR(60)  NULL,
  unit                      VARCHAR(40)  NULL,
  number_format             VARCHAR(60)  NULL,

  -- draft | confirmed | deprecated
  status                    VARCHAR(30)  NOT NULL DEFAULT 'draft',
  version                   INT          NOT NULL DEFAULT 1,

  -- catalog_import | manual | ai_suggested (kelak)
  source                    VARCHAR(40)  NULL,

  created_by                INT          NULL,
  updated_by                INT          NULL,
  created_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                         ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_cia_kpis_slug (slug),
  KEY idx_cia_kpis_domain (domain),
  KEY idx_cia_kpis_status (status),

  CONSTRAINT fk_cia_kpis_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_cia_kpis_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cia_kpi_bindings (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,

  binding_key         CHAR(64)     NOT NULL,
  kpi_id              BIGINT       NOT NULL,

  dashboard_id        INT          NULL,
  report_id           CHAR(36)     NULL,
  page_name           VARCHAR(150) NULL,
  visual_title        VARCHAR(200) NULL,

  semantic_model      VARCHAR(200) NULL,
  table_name          VARCHAR(200) NULL,
  measure_name        VARCHAR(300) NULL,

  -- Caption manusia dari visual, dipakai bila mapping KPI belum confirmed.
  display_caption     VARCHAR(300) NULL,
  dimensions_json     JSON         NULL,

  date_table          VARCHAR(200) NULL,
  date_column         VARCHAR(200) NULL,
  date_logic          TEXT         NULL,

  -- catalog_import | schema_sync | visual_sync
  source              VARCHAR(40)  NULL,
  -- discovered | confirmed | missing | rejected
  verification_status VARCHAR(30)  NOT NULL DEFAULT 'discovered',

  first_seen_at       DATETIME     NULL,
  last_seen_at        DATETIME     NULL,
  missing_since       DATETIME     NULL,

  UNIQUE KEY uq_cia_kpi_bindings_key (binding_key),
  KEY idx_cia_kpi_bindings_kpi (kpi_id),
  KEY idx_cia_kpi_bindings_dashboard (dashboard_id),
  KEY idx_cia_kpi_bindings_verification (verification_status),

  CONSTRAINT fk_cia_kpi_bindings_kpi FOREIGN KEY (kpi_id)
    REFERENCES cia_kpis (id) ON DELETE CASCADE,
  CONSTRAINT fk_cia_kpi_bindings_dashboard FOREIGN KEY (dashboard_id)
    REFERENCES dashboards (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cia_kpi_revisions (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  kpi_id      BIGINT       NOT NULL,

  -- Versi cia_kpis SESUDAH perubahan ini diterapkan.
  version     INT          NOT NULL,

  before_json JSON         NULL,
  after_json  JSON         NULL,

  -- create | edit | confirm | restore
  action      VARCHAR(30)  NOT NULL DEFAULT 'edit',
  reason      VARCHAR(500) NOT NULL,
  actor_id    INT          NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_cia_kpi_revisions_kpi_version (kpi_id, version),
  KEY idx_cia_kpi_revisions_kpi_created (kpi_id, created_at),

  CONSTRAINT fk_cia_kpi_revisions_kpi FOREIGN KEY (kpi_id)
    REFERENCES cia_kpis (id) ON DELETE CASCADE,
  CONSTRAINT fk_cia_kpi_revisions_actor FOREIGN KEY (actor_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cia_kpi_sync_runs (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_uuid           CHAR(36)    NOT NULL,

  -- running | success | partial | error
  status             VARCHAR(20) NOT NULL DEFAULT 'running',

  dashboards_scanned INT         NOT NULL DEFAULT 0,
  measures_seen      INT         NOT NULL DEFAULT 0,
  visuals_seen       INT         NOT NULL DEFAULT 0,
  bindings_created   INT         NOT NULL DEFAULT 0,
  bindings_refreshed INT         NOT NULL DEFAULT 0,
  bindings_missing   INT         NOT NULL DEFAULT 0,

  -- Error per dashboard yang sudah disanitasi (tanpa secret/DAX mentah).
  errors_json        JSON        NULL,

  actor_id           INT         NULL,
  started_at         DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at        DATETIME    NULL,

  UNIQUE KEY uq_cia_kpi_sync_runs_uuid (run_uuid),
  KEY idx_cia_kpi_sync_runs_started (started_at),

  CONSTRAINT fk_cia_kpi_sync_runs_actor FOREIGN KEY (actor_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

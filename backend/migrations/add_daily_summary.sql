-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Automated Daily Executive Summary.
-- Aman diulang. CREATE TABLE IF NOT EXISTS berlaku di MySQL maupun MariaDB,
-- jadi tabel tidak butuh penjagaan information_schema seperti penambahan kolom.
--
-- Lima tabel, dua kelompok:
--
-- A. Inventaris measure, supaya katalog KPI dibangun dari bukti:
--    model_measure         daftar measure sebenarnya per semantic model
--    visual_field_usage    field yang benar-benar tampil di visual dashboard
--
-- B. Job harian:
--    daily_summary_snapshot   angka KPI per domain per hari
--    daily_summary_result     hasil AI, status validasi, status kirim
--    daily_summary_lock       kunci konkurensi, satu baris per nama job
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A. Inventaris measure ────────────────────────────────────────────────────

-- Dipanen otomatis lewat EVALUATE INFO.VIEW.MEASURES().
-- Catatan: INFO.MEASURES() ditolak 400 oleh Execute Queries, hanya varian
-- INFO.VIEW.MEASURES() yang diterima. Diuji 2026-08-04, bukan dibaca dari doc.
CREATE TABLE IF NOT EXISTS model_measure (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  dataset_id    CHAR(36)     NOT NULL,
  model_name    VARCHAR(200) NOT NULL,
  measure_name  VARCHAR(300) NOT NULL,
  table_name    VARCHAR(200) NULL,
  is_hidden     TINYINT(1)   NOT NULL DEFAULT 0,
  harvested_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_model_measure (dataset_id, measure_name),
  KEY idx_mm_model (model_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Dipanen dari browser lewat page.getVisuals() dan visual.exportData().
--
-- Ini satu-satunya bukti measure mana yang BENAR-BENAR dipakai di visual.
-- Tiga jalur otomatis sudah dicoba dan tertutup semuanya: Fabric
-- getDefinition menjawab 403 karena app registration tidak punya scope-nya,
-- Export .pbix menjawab 400 OperationIsNotSupportedForPremiumFilesModel, dan
-- INFO.MEASURES() menjawab 400.
--
-- Tanpa tabel ini, katalog KPI akan memuat measure yang ada di model tapi tidak
-- pernah dirender, termasuk sisa percobaan DAX. Angkanya keluar tanpa error dan
-- analisanya jadi menyesatkan.
CREATE TABLE IF NOT EXISTS visual_field_usage (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  dashboard_id  INT          NOT NULL,
  report_id     CHAR(36)     NOT NULL,
  -- Lebar kolom ditahan supaya kunci unik gabungan tetap di bawah batas 3072
  -- byte InnoDB. utf8mb4 memakai 4 byte per karakter, jadi tiga kolom 300
  -- karakter sudah 3604 byte dan CREATE TABLE-nya ditolak. Prefix index sengaja
  -- dihindari: prefix membuat dua nama panjang yang awalnya sama dianggap
  -- duplikat, dan satu field hilang tanpa pesan apa pun.
  page_name     VARCHAR(150) NULL,
  visual_title  VARCHAR(150) NULL,
  visual_type   VARCHAR(60)  NULL,
  field_name    VARCHAR(200) NOT NULL,
  harvested_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vfu (dashboard_id, page_name, visual_title, field_name),
  KEY idx_vfu_field (field_name),
  KEY idx_vfu_dash (dashboard_id),
  CONSTRAINT fk_vfu_dashboard FOREIGN KEY (dashboard_id)
    REFERENCES dashboards (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── B. Job harian ────────────────────────────────────────────────────────────

-- Kunci utama gabungan (tanggal, domain): satu baris per domain per hari.
-- Spec menulis date sebagai PK tunggal, tapi snapshot disimpan per domain dan
-- satu domain yang gagal tidak boleh menghalangi domain lain menulis barisnya.
CREATE TABLE IF NOT EXISTS daily_summary_snapshot (
  report_date     DATE         NOT NULL,
  domain          VARCHAR(40)  NOT NULL,
  kpi_json        JSON         NOT NULL,
  data_freshness  VARCHAR(12)  NOT NULL,
  -- Jam batas data dalam WIB bila freshness = partial. NULL bila penuh.
  -- Tanpa ini, laporan menyajikan angka lembur sampai 17:30 seolah angka
  -- sehari penuh, dan itu sistematis lebih rendah dari kenyataan.
  cutoff_wib      VARCHAR(5)   NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (report_date, domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS daily_summary_result (
  report_date          DATE         NOT NULL PRIMARY KEY,
  ai_summary_text      MEDIUMTEXT   NULL,
  gemini_model_version VARCHAR(80)  NULL,
  prompt_version       VARCHAR(20)  NULL,
  validation_passed    TINYINT(1)   NOT NULL DEFAULT 0,
  -- Alasan validasi gagal disimpan, bukan cuma flag. Tanpa alasannya, "gagal
  -- validasi" di log tidak memberi tahu section mana yang hilang.
  validation_note      VARCHAR(500) NULL,
  is_fallback          TINYINT(1)   NOT NULL DEFAULT 0,
  whatsapp_sent        TINYINT(1)   NOT NULL DEFAULT 0,
  whatsapp_sent_at     DATETIME     NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Kunci di database, bukan di memori proses.
--
-- Job pengumpul dan job pengirim berjalan di jam berbeda, dan restart server
-- di antara keduanya tidak boleh melepas kunci secara diam-diam. Variabel
-- modul akan hilang saat restart dan job bisa jalan dobel.
--
-- expires_at mencegah kunci yatim: proses yang mati saat memegang kunci tidak
-- boleh memblokir job besok. Pengambil kunci berikutnya boleh merebut kunci
-- yang sudah kedaluwarsa.
CREATE TABLE IF NOT EXISTS daily_summary_lock (
  job_name    VARCHAR(60) NOT NULL PRIMARY KEY,
  locked_at   DATETIME    NOT NULL,
  expires_at  DATETIME    NOT NULL,
  holder      VARCHAR(120) NULL,
  report_date DATE        NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

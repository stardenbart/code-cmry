-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: tabel perf_samples untuk telemetri performa.
-- Jalankan SETELAH cod_db.sql. Aman diulang.
--
-- "ADD COLUMN IF NOT EXISTS" adalah sintaks MariaDB dan gagal diam-diam di
-- MySQL — itu pernah terjadi di repo ini dan membuat dua tabel tidak pernah
-- terbentuk. Karena itu penjagaan lewat information_schema, sama seperti
-- add_user_roles.sql.
-- ─────────────────────────────────────────────────────────────────────────────

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'perf_samples') = 0,
  "CREATE TABLE perf_samples (
     id           INT AUTO_INCREMENT PRIMARY KEY,
     user_id      INT NULL,
     kind         ENUM('app_load','dashboard_open') NOT NULL,
     dashboard_id INT NULL,
     metrics      JSON NOT NULL,
     created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_perf_kind_time (kind, created_at)
   )",
  'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

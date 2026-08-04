-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: kolom intent dan answered_locally di ai_chat_logs.
-- Jalankan SETELAH add_ai_usage_tracking.sql. Aman diulang.
--
-- "ADD COLUMN IF NOT EXISTS" adalah sintaks MariaDB dan gagal diam-diam di
-- MySQL, jadi penjagaan lewat information_schema.
--
-- Tanpa dua kolom ini, cakupan penjawab lokal hanya bisa ditebak. Target
-- 35-50% di rencana harus diukur, bukan diasumsikan.
-- ─────────────────────────────────────────────────────────────────────────────

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'ai_chat_logs'
      AND column_name = 'intent') = 0,
  "ALTER TABLE ai_chat_logs ADD COLUMN intent VARCHAR(20) NULL",
  'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'ai_chat_logs'
      AND column_name = 'answered_locally') = 0,
  "ALTER TABLE ai_chat_logs ADD COLUMN answered_locally TINYINT(1) NOT NULL DEFAULT 0",
  'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

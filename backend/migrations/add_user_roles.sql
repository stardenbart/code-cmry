-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: kolom role untuk otorisasi admin
-- Jalankan SETELAH cod_db.sql. Aman diulang.
--
-- MySQL tidak mendukung "ADD COLUMN IF NOT EXISTS" — karena itu dijaga
-- lewat information_schema, sama seperti add_ai_usage_tracking.sql.
--
-- Kolom `tipe_akses` TIDAK dipakai sebagai penanda admin: 24 user memilikinya
-- bernilai 'All Access', dan itu mengatur akses dashboard, bukan hak
-- administratif.
-- ─────────────────────────────────────────────────────────────────────────────

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'role') = 0,
  "ALTER TABLE users ADD COLUMN role ENUM('admin','user') NOT NULL DEFAULT 'user'",
  'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Hanya akun ini yang dijadikan admin. Akun 'superuser' sengaja TIDAK
-- diikutkan — itu keputusan pemilik sistem, bukan asumsi migration.
UPDATE users SET role = 'admin' WHERE username = 'digital.transformation';

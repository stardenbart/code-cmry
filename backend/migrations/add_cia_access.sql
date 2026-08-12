-- Hak akses fitur CIA per user.
--
-- Aman diulang.
--
-- ADD COLUMN IF NOT EXISTS adalah sintaks MariaDB dan GAGAL di MySQL, jadi
-- penambahan kolomnya dijaga lewat information_schema plus PREPARE/EXECUTE.
-- Tanpa penjagaan itu, menjalankan migrasi dua kali melempar error dan
-- menghentikan sisa skrip deploy.
--
-- Bawaannya 0, yaitu MENOLAK. Ini disengaja dan diminta pemilik proyek: semua
-- user tidak bisa memakai CIA kecuali admin membukanya satu per satu. Bawaan
-- yang mengizinkan berarti setiap akun baru langsung bisa memakai kuota AI dan
-- membaca analisa operasional, dan tidak ada yang menyadarinya sampai kuotanya
-- habis.

SET @ada := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'users'
     AND COLUMN_NAME = 'cia_access'
);

SET @sql := IF(
  @ada = 0,
  'ALTER TABLE users ADD COLUMN cia_access TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);

PREPARE pernyataan FROM @sql;
EXECUTE pernyataan;
DEALLOCATE PREPARE pernyataan;

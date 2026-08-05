-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: kolom sent_confirmed di daily_summary_result.
-- Jalankan SETELAH add_daily_summary.sql. Aman diulang.
--
-- MENUTUP KEHILANGAN LAPORAN YANG SENYAP.
--
-- tandaiTerkirim() menandai SEBELUM mengirim, supaya dua proses yang berlomba
-- tidak mungkin keduanya mengirim. Bila pengiriman gagal, penandaannya
-- dibatalkan. Tapi bila PROSESNYA MATI di antara menandai dan mengirim,
-- pembatalan itu tidak pernah jalan: barisnya tetap bertanda terkirim,
-- laporannya tidak pernah sampai, dan tidak ada yang mencoba lagi.
--
-- Terjadi sungguhan 2026-08-06: baris 2026-08-05 bertanda terkirim jam 06:17
-- sementara grup tidak menerima apa pun, karena proses yang menjalankannya mati
-- sebelum 06:34.
--
-- Dengan kolom ini ada tiga keadaan, bukan dua:
--   sent=0                  belum diklaim, boleh dikirim
--   sent=1, confirmed=0     sedang dikirim, atau prosesnya mati saat mengirim
--   sent=1, confirmed=1     provider menjawab berhasil
--
-- Klaim yang menggantung lebih lama dari batas waktu boleh direbut, jadi
-- kematian proses menunda pengiriman, bukan menghilangkannya.
-- ─────────────────────────────────────────────────────────────────────────────

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'daily_summary_result'
      AND column_name = 'sent_confirmed') = 0,
  "ALTER TABLE daily_summary_result ADD COLUMN sent_confirmed TINYINT(1) NOT NULL DEFAULT 0",
  'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Baris lama yang sudah bertanda terkirim dianggap terkonfirmasi, KECUALI yang
-- terbukti hilang. Menganggap semuanya belum terkonfirmasi akan mengirim ulang
-- laporan lama yang sudah dibaca orang, dan itu lebih buruk daripada diam.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'daily_summary_result'
      AND column_name = 'sent_confirmed') = 1,
  "UPDATE daily_summary_result SET sent_confirmed = 1 WHERE whatsapp_sent = 1 AND sent_confirmed = 0",
  'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

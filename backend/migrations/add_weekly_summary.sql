-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: snapshot mingguan untuk Automated Daily Executive Summary.
-- Jalankan SETELAH add_daily_summary.sql. Aman diulang.
--
-- Kenapa mingguan, bukan cuma harian:
--
-- Data 7 hari terakhir masih bergerak. Entri operator masuk terlambat, dan
-- beberapa domain tidak diinput harian sama sekali. Terukur 2026-08-04, keempat
-- KPI harian Energy keluar kosong karena meterannya belum diinput hari itu.
-- Menyimpan satu angka harian sekali lalu menganggapnya final akan mengabadikan
-- angka yang belum lengkap, dan tidak ada error yang menandainya.
--
-- Karena itu setiap penarikan MENYEGARKAN minggu yang masih berjalan, dan minggu
-- yang sudah lewat DIBEKUKAN.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weekly_summary_snapshot (
  -- Hari pertama minggu menurut WIB. Sekaligus penanda minggu, jadi tidak perlu
  -- nomor minggu ISO yang berbeda tafsir antar sistem.
  week_start      DATE         NOT NULL,
  week_end        DATE         NOT NULL,
  domain          VARCHAR(40)  NOT NULL,
  kpi_json        JSON         NOT NULL,
  data_freshness  VARCHAR(12)  NOT NULL,
  cutoff_wib      VARCHAR(5)   NULL,

  -- Pembekuan disimpan EKSPLISIT, tidak disimpulkan dari tanggal saat dibaca.
  -- Kalau disimpulkan, angka yang pernah dipakai laporan bisa berubah diam-diam
  -- ketika logika penyimpulannya diubah. Dengan kolom ini, terlihat kapan sebuah
  -- angka berhenti berubah dan kenapa.
  frozen          TINYINT(1)   NOT NULL DEFAULT 0,
  frozen_at       DATETIME     NULL,

  -- Berapa kali minggu ini ditarik ulang sebelum dibekukan. Bukan hiasan: kalau
  -- sebuah minggu dibekukan setelah satu kali tarik, berarti pembekuannya
  -- terlalu cepat dan datanya belum sempat lengkap.
  pull_count      INT          NOT NULL DEFAULT 1,

  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refreshed_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (week_start, domain),
  KEY idx_wss_frozen (frozen, week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

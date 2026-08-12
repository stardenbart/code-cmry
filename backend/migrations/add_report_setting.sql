-- Setelan laporan performa harian, diatur admin dari website.
--
-- Aman diulang.
--
-- Tabel tersendiri, bukan baris-baris di ai_settings, karena setelan ini punya
-- tipe yang perlu divalidasi (jam 0 sampai 23, hari 0 sampai 6) dan saling
-- berkaitan (hari hanya berarti untuk frekuensi mingguan). Menyimpannya sebagai
-- tujuh baris teks berarti validasinya tersebar dan tidak ada satu tempat pun
-- yang bisa menolak kombinasi yang mustahil.
--
-- SATU baris saja, dikunci id = 1. Bukan tabel riwayat: yang dibutuhkan
-- scheduler adalah keadaan sekarang, dan riwayat perubahan sudah terwakili oleh
-- diubah_oleh beserta waktunya.

CREATE TABLE IF NOT EXISTS report_setting (
  id           TINYINT      NOT NULL DEFAULT 1,

  -- Bawaannya MATI. Menyalakan penjadwalan adalah keputusan sadar admin, sama
  -- seperti SCHEDULER_ENABLED: tanpa ini, backend siapa pun yang menyala akan
  -- mengirim laporan sungguhan ke grup manajemen.
  aktif        TINYINT(1)   NOT NULL DEFAULT 0,

  -- hourly, daily, atau weekly.
  frekuensi    VARCHAR(12)  NOT NULL DEFAULT 'daily',

  -- Jam dan menit WIB. Untuk hourly, hanya menitnya yang dipakai.
  jam          TINYINT      NOT NULL DEFAULT 8,
  menit        TINYINT      NOT NULL DEFAULT 0,

  -- 0 Minggu sampai 6 Sabtu. Hanya berarti untuk frekuensi weekly.
  hari         TINYINT      NOT NULL DEFAULT 1,

  -- Daftar JID grup WhatsApp, dipisah koma. Diisi dari UI supaya menambah grup
  -- tidak menuntut deploy. Kosong berarti memakai WHATSAPP_GROUP_ID dari env.
  grup_jid     VARCHAR(500) NOT NULL DEFAULT '',

  -- gemini atau glm. SENGAJA terpisah dari pilihan provider CIA di ai_settings:
  -- laporan harian dibaca manajemen sebagai fakta dan boleh memakai model yang
  -- berbeda dari tanya jawab santai di grup.
  provider     VARCHAR(12)  NOT NULL DEFAULT 'gemini',

  -- Penjaga supaya satu jadwal tidak dijalankan dua kali. Discheduler dibaca dan
  -- ditulis lewat TIMESTAMPDIFF di SQL, tidak pernah dibandingkan dengan waktu
  -- proses lewat toISOString, karena itu sudah dua kali menggeser hasil sehari.
  terakhir_jalan DATETIME   DEFAULT NULL,

  diubah_oleh  INT          DEFAULT NULL,
  diubah_pada  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  CONSTRAINT fk_report_setting_user FOREIGN KEY (diubah_oleh) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Baris tunggalnya dibuat sekali. INSERT IGNORE supaya migrasi tetap aman
-- diulang tanpa menimpa setelan yang sudah diubah admin.
INSERT IGNORE INTO report_setting (id) VALUES (1);

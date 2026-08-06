-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: tabel ai_finding, memori temuan lintas dashboard.
-- Aman diulang.
--
-- Riwayat chat CODE AI terkunci per dashboard, jadi analisa di satu dashboard
-- tidak pernah sampai ke dashboard berikutnya. Tabel ini menyimpan RINGKASAN
-- temuan, bukan riwayat mentah: riwayat mentah dari enam dashboard sudah
-- melewati batas muatan 10KB dan obrolan tak relevan ikut melebarkan analisa.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_finding (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT          NOT NULL,
  dashboard_id    INT          NOT NULL,
  ringkasan       VARCHAR(400) NOT NULL,

  -- Angka kunci beserta NAMA MEASURE-nya. Inilah yang membuat korelasinya bisa
  -- dipertanggungjawabkan: tanpa angka tersimpan, AI di dashboard berikutnya
  -- mengarang ulang angka dari ingatan. Dengan tersimpan, dashboard berikutnya
  -- menyebut angka yang persis sama dan ketidakcocokan terlihat.
  angka_json      JSON         NULL,

  belum_terjawab  VARCHAR(300) NULL,

  -- id ai_chat_logs terakhir yang sudah tersaring. Mencegah penyaringan berulang
  -- atas percakapan yang sama.
  turn_terakhir   INT          NOT NULL DEFAULT 0,

  dibuat_pada     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disegarkan_pada DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,

  -- Satu temuan per dashboard yang DISEGARKAN, bukan menumpuk. Sepuluh kali
  -- bolak-balik ke dashboard yang sama tidak boleh menghasilkan sepuluh catatan
  -- yang isinya mirip.
  UNIQUE KEY uq_finding (user_id, dashboard_id),
  KEY idx_finding_segar (user_id, disegarkan_pada),

  CONSTRAINT fk_finding_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

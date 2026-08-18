-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: percakapan CIA lintas dashboard.
-- Aman diulang.
--
-- Menggantikan 2026-08-14-create-unified-conversations.js. Berkas itu ditulis
-- sebagai migrasi JavaScript sementara tujuh belas migrasi lain di repo ini
-- berbentuk .sql dan TIDAK ADA runner JavaScript yang memanggilnya. Akibatnya
-- tabelnya tidak pernah dibuat, dan setiap permintaan chat mati di
-- createConversation dengan "Table doesn't exist". Diukur 2026-08-18.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_unified_conversations (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NOT NULL,

  -- Judul percakapan, diambil dari pertanyaan pertama. Dipakai daftar riwayat
  -- di samping supaya user mengenali percakapannya tanpa membukanya satu-satu.
  judul       VARCHAR(200) NULL,

  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                           ON UPDATE CURRENT_TIMESTAMP,
  metadata    JSON         NULL,

  KEY idx_unified_conv_user (user_id, updated_at),

  CONSTRAINT fk_unified_conv_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_unified_turns (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id    INT      NOT NULL,
  turn_number        INT      NOT NULL,
  question           TEXT     NOT NULL,
  dashboards_queried JSON     NULL,
  answer             LONGTEXT NOT NULL,
  tokens_used        JSON     NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_unified_turn (conversation_id, turn_number),
  KEY idx_unified_turn_waktu (conversation_id, created_at),

  CONSTRAINT fk_unified_turn_conv FOREIGN KEY (conversation_id)
    REFERENCES ai_unified_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Kolom judul ditambahkan belakangan untuk pemasangan yang tabelnya sudah ada.
-- ADD COLUMN IF NOT EXISTS adalah sintaks MariaDB dan GAGAL di MySQL, jadi
-- penjagaannya lewat information_schema, sama seperti add_cia_access.sql.
SET @ada := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'ai_unified_conversations'
     AND COLUMN_NAME = 'judul'
);

SET @sql := IF(
  @ada = 0,
  'ALTER TABLE ai_unified_conversations ADD COLUMN judul VARCHAR(200) NULL AFTER user_id',
  'SELECT 1'
);

PREPARE pernyataan FROM @sql;
EXECUTE pernyataan;
DEALLOCATE PREPARE pernyataan;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: AI Dashboard Assistant (Gemini)
-- Run this ONCE against central_of_digitalization, AFTER cod_db.sql
-- Safe to re-run — column additions are guarded via information_schema.
--
-- NOTE: MySQL does NOT support "ALTER TABLE ... ADD COLUMN IF NOT EXISTS"
-- (that is MariaDB syntax), hence the prepared-statement guards below.
-- ─────────────────────────────────────────────────────────────────────────────

-- Export Mode / AI Mode need the Power BI report GUID per dashboard.
-- (Already present on most installs; kept here so a fresh DB is complete.)
SET @has_report_id := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dashboards' AND column_name = 'report_id'
);
SET @sql := IF(@has_report_id = 0,
  'ALTER TABLE dashboards ADD COLUMN report_id VARCHAR(255) DEFAULT NULL AFTER url',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Optional per-user Gemini API key (free tier). Encrypted with AES-256-GCM
-- using a key derived from JWT_SECRET — see src/config/secretBox.js.
CREATE TABLE IF NOT EXISTS ai_user_keys (
  user_id     INT          NOT NULL,
  api_key_enc TEXT         NOT NULL,
  model       VARCHAR(60)  DEFAULT NULL,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_ai_keys_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Q&A audit trail. Doubles as chat memory and as the rate-limit counter.
-- dashboard_id is intentionally NOT a foreign key: deleting a dashboard must not
-- erase its audit history.
CREATE TABLE IF NOT EXISTS ai_chat_logs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT          NOT NULL,
  dashboard_id    INT          DEFAULT NULL,
  dashboard_title VARCHAR(150) DEFAULT NULL,
  question        TEXT         NOT NULL,
  answer          MEDIUMTEXT   DEFAULT NULL,
  model           VARCHAR(60)  DEFAULT NULL,
  key_source      ENUM('user','server') DEFAULT NULL,
  visuals_used    INT          DEFAULT NULL,
  rows_used       INT          DEFAULT NULL,
  prompt_chars    INT          DEFAULT NULL,
  error           VARCHAR(500) DEFAULT NULL,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_logs_user_dash (user_id, dashboard_id, id),
  KEY idx_ai_logs_created   (created_at),
  CONSTRAINT fk_ai_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

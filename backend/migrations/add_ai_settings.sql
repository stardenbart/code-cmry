-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: platform-wide CODE AI settings (universal API key)
-- Run AFTER add_ai_assistant.sql. Safe to re-run.
--
-- Lets an admin manage the shared "universal" key from the UI instead of editing
-- .env and restarting. The value is encrypted with the same AES-256-GCM scheme
-- as personal keys (src/config/secretBox.js).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_settings (
  skey       VARCHAR(60) NOT NULL,
  svalue     TEXT        NOT NULL,
  updated_by INT         DEFAULT NULL,
  updated_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (skey),
  CONSTRAINT fk_ai_settings_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

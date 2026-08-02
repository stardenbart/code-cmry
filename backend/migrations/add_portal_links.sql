-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add portal_links + missing columns
-- Run this ONCE against central_of_digitalization
-- Safe to re-run — column additions are guarded via information_schema.
--
-- NOTE: MySQL does NOT support "ALTER TABLE ... ADD COLUMN IF NOT EXISTS"
-- (that is MariaDB syntax). Using it aborts the whole script on MySQL, which is
-- why the guards below use prepared statements instead.
-- ─────────────────────────────────────────────────────────────────────────────

-- Needed by the notification-count endpoint
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'access_requests' AND column_name = 'last_notified_status'
);
SET @sql := IF(@has_col = 0,
  'ALTER TABLE access_requests ADD COLUMN last_notified_status VARCHAR(20) DEFAULT NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Needed for dashboard access grant/revoke
CREATE TABLE IF NOT EXISTS user_dashboard_access (
  user_id      INT NOT NULL,
  dashboard_id INT NOT NULL,
  granted_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY  (user_id, dashboard_id),
  CONSTRAINT fk_uda_user      FOREIGN KEY (user_id)      REFERENCES users      (id) ON DELETE CASCADE,
  CONSTRAINT fk_uda_dashboard FOREIGN KEY (dashboard_id) REFERENCES dashboards (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Needed by the email-based dashboard approval flow
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dashboards' AND column_name = 'pic_emails'
);
SET @sql := IF(@has_col = 0,
  'ALTER TABLE dashboards ADD COLUMN pic_emails TEXT DEFAULT NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Portal / Landing-page links ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_links (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  url         VARCHAR(500) NOT NULL,
  image_url   TEXT,
  sort_order  INT          DEFAULT 0,
  active      TINYINT(1)   DEFAULT 1,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

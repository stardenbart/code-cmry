-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: CODE AI usage tracking (quota indicator + tier routing)
-- Run AFTER add_ai_assistant.sql. Safe to re-run.
--
-- MySQL does NOT support "ADD COLUMN IF NOT EXISTS" — hence the guards.
-- ─────────────────────────────────────────────────────────────────────────────

-- Token accounting per request, so the quota indicator can estimate how many
-- questions a user has left instead of only counting requests.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'ai_chat_logs' AND column_name = 'prompt_tokens') = 0,
  'ALTER TABLE ai_chat_logs ADD COLUMN prompt_tokens INT DEFAULT NULL', 'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'ai_chat_logs' AND column_name = 'output_tokens') = 0,
  'ALTER TABLE ai_chat_logs ADD COLUMN output_tokens INT DEFAULT NULL', 'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'ai_chat_logs' AND column_name = 'total_tokens') = 0,
  'ALTER TABLE ai_chat_logs ADD COLUMN total_tokens INT DEFAULT NULL', 'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Which CODE AI tier served the request (cepat / standar / mendalam)
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'ai_chat_logs' AND column_name = 'tier') = 0,
  'ALTER TABLE ai_chat_logs ADD COLUMN tier VARCHAR(20) DEFAULT NULL', 'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Whether the answer came from cache (0 tokens spent)
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'ai_chat_logs' AND column_name = 'from_cache') = 0,
  'ALTER TABLE ai_chat_logs ADD COLUMN from_cache TINYINT(1) DEFAULT 0', 'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Index for the per-user/per-model daily rollup behind the quota indicator
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'ai_chat_logs' AND index_name = 'idx_ai_logs_usage') = 0,
  'CREATE INDEX idx_ai_logs_usage ON ai_chat_logs (user_id, created_at, model)', 'DO 0'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Observed rate-limit hits. Used to auto-calibrate the configured limits: a 429
-- while the indicator still shows plenty left means the configured limit is wrong.
CREATE TABLE IF NOT EXISTS ai_quota_events (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT          NOT NULL,
  model         VARCHAR(60)  DEFAULT NULL,
  tier          VARCHAR(20)  DEFAULT NULL,
  requests_today INT         DEFAULT NULL,
  tokens_today   INT         DEFAULT NULL,
  configured_limit INT       DEFAULT NULL,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_quota_events (model, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

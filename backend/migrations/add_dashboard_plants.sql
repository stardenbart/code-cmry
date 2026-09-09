-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: satu dashboard bisa ditautkan ke banyak plant. ADITIF & aman diulang.
--
-- Non-destruktif: kolom lama dashboards.plant_id/department_id DIBIARKAN sebagai
-- "plant utama" (kompatibilitas). Tabel dashboard_plants menampung keanggotaan
-- plant tambahan. Department tetap satu nama per dashboard (kolom dashboards.
-- department); sidebar menampilkannya di bawah department bernama sama pada tiap
-- plant, jadi placement cukup menyimpan (dashboard, plant).
--
-- Backfill INSERT IGNORE dari plant utama yang sudah ada supaya perilaku akses
-- identik dengan sebelumnya, lalu meluas ke multi-plant.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dashboard_plants (
  dashboard_id INT      NOT NULL,
  plant_id     INT      NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (dashboard_id, plant_id),
  KEY idx_dashboard_plants_plant (plant_id),
  CONSTRAINT fk_dashboard_plants_dashboard FOREIGN KEY (dashboard_id)
    REFERENCES dashboards (id) ON DELETE CASCADE,
  CONSTRAINT fk_dashboard_plants_plant FOREIGN KEY (plant_id)
    REFERENCES plants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Backfill dari plant utama existing (idempoten lewat PK + INSERT IGNORE).
INSERT IGNORE INTO dashboard_plants (dashboard_id, plant_id)
SELECT id, plant_id FROM dashboards WHERE plant_id IS NOT NULL;

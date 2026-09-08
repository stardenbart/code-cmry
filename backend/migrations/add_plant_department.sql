-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: hierarki Plant → Department. ADITIF & aman diulang.
--
-- Non-destruktif: tidak menghapus/menimpa kolom lama. users.departemen,
-- users.tipe_akses, dashboards.department dibiarkan apa adanya. Kolom baru
-- dijaga information_schema karena ADD COLUMN IF NOT EXISTS sintaks MariaDB dan
-- GAGAL di MySQL — persis pola add_cia_access.sql.
--
-- Seed plant Sentul(1001) lewat INSERT IGNORE (name & code unik). Backfill
-- dashboard/department/user_plants dilakukan skrip terpisah (backfill-plant-
-- department.mjs) supaya migrasi tetap ringan dan aman diulang.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS plants (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  code       VARCHAR(20)  NOT NULL,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_plants_name (name),
  UNIQUE KEY uq_plants_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS departments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  plant_id   INT          NOT NULL,
  name       VARCHAR(100) NOT NULL,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_departments_plant_name (plant_id, name),
  KEY idx_departments_plant (plant_id),
  CONSTRAINT fk_departments_plant FOREIGN KEY (plant_id)
    REFERENCES plants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_plants (
  user_id    INT      NOT NULL,
  plant_id   INT      NOT NULL,
  granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, plant_id),
  KEY idx_user_plants_plant (plant_id),
  CONSTRAINT fk_user_plants_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_plants_plant FOREIGN KEY (plant_id)
    REFERENCES plants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- users.cross_plant_access
SET @ada := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='cross_plant_access');
SET @sql := IF(@ada=0,
  'ALTER TABLE users ADD COLUMN cross_plant_access TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- dashboards.plant_id
SET @ada := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dashboards' AND COLUMN_NAME='plant_id');
SET @sql := IF(@ada=0,
  'ALTER TABLE dashboards ADD COLUMN plant_id INT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- dashboards.department_id
SET @ada := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dashboards' AND COLUMN_NAME='department_id');
SET @sql := IF(@ada=0,
  'ALTER TABLE dashboards ADD COLUMN department_id INT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- FK dashboards.plant_id (dijaga: hanya tambah bila belum ada)
SET @ada := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dashboards' AND CONSTRAINT_NAME='fk_dashboards_plant');
SET @sql := IF(@ada=0,
  'ALTER TABLE dashboards ADD CONSTRAINT fk_dashboards_plant FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- FK dashboards.department_id
SET @ada := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dashboards' AND CONSTRAINT_NAME='fk_dashboards_department');
SET @sql := IF(@ada=0,
  'ALTER TABLE dashboards ADD CONSTRAINT fk_dashboards_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Seed plant utama Sentul(1001).
INSERT IGNORE INTO plants (name, code) VALUES ('Sentul', '1001');

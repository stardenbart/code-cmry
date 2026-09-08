// Skema Plant/Department: tabel & kolom aditif + seed Sentul(1001).
//
// Migrasi dijaga idempotent lewat information_schema (ADD COLUMN IF NOT EXISTS
// sintaks MariaDB, gagal di MySQL). Uji ini menegaskan bentuk skema + seed.
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import db from "../src/config/db.js";

const sql = db.promise();

async function cols(table) {
  const [rows] = await sql.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [table]);
  return new Set(rows.map((r) => r.COLUMN_NAME));
}
async function indexUnique(table, index) {
  const [rows] = await sql.query(
    `SELECT NON_UNIQUE FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1`, [table, index]);
  return rows.length ? Number(rows[0].NON_UNIQUE) === 0 : false;
}

section("Tabel plants");
{
  const c = await cols("plants");
  for (const k of ["id", "name", "code", "active", "created_at", "updated_at"]) {
    ok(`plants.${k} ada`, c.has(k), "hilang");
  }
  ok("plants.name unik", await indexUnique("plants", "uq_plants_name"));
  ok("plants.code unik", await indexUnique("plants", "uq_plants_code"));
}

section("Tabel departments (per-plant)");
{
  const c = await cols("departments");
  for (const k of ["id", "plant_id", "name", "active", "created_at", "updated_at"]) {
    ok(`departments.${k} ada`, c.has(k), "hilang");
  }
  ok("departments unik (plant_id,name)", await indexUnique("departments", "uq_departments_plant_name"));
}

section("Tabel user_plants (M2M)");
{
  const c = await cols("user_plants");
  ok("user_plants.user_id ada", c.has("user_id"));
  ok("user_plants.plant_id ada", c.has("plant_id"));
}

section("Kolom tambahan users & dashboards");
{
  const u = await cols("users");
  ok("users.cross_plant_access ada", u.has("cross_plant_access"));
  const d = await cols("dashboards");
  ok("dashboards.plant_id ada", d.has("plant_id"));
  ok("dashboards.department_id ada", d.has("department_id"));
}

section("Seed Sentul(1001)");
{
  const [rows] = await sql.query("SELECT id, code FROM plants WHERE name='Sentul' LIMIT 1");
  ok("plant Sentul ada", rows.length === 1, "belum di-seed");
  ok("kode Sentul = 1001", rows[0]?.code === "1001", String(rows[0]?.code));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}

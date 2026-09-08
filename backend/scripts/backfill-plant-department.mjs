// Backfill Plant/Department NON-DESTRUKTIF & idempotent.
//
// - Pastikan plant Sentul(1001) ada.
// - Tiap nilai distinct dashboards.department -> department di bawah Sentul.
// - Dashboard yang plant_id-nya masih NULL dipetakan ke Sentul + department-nya
//   (dept kosong -> "Lainnya"). Dashboard yang SUDAH punya plant (mis. sudah
//   dipindah admin) tidak disentuh.
// - Tiap user dapat baris user_plants ke Sentul (INSERT IGNORE).
//
// Pemakaian: node scripts/backfill-plant-department.mjs
import "dotenv/config";
import { pathToFileURL } from "url";
import db from "../src/config/db.js";

export async function backfillPlantDepartment(pool) {
  await pool.query("INSERT IGNORE INTO plants (name, code) VALUES ('Sentul', '1001')");
  const [sr] = await pool.query("SELECT id FROM plants WHERE name='Sentul' LIMIT 1");
  const sentulId = sr[0].id;

  const [depts] = await pool.query(
    "SELECT DISTINCT department FROM dashboards WHERE department IS NOT NULL AND TRIM(department) <> ''");
  for (const { department } of depts) {
    await pool.query("INSERT IGNORE INTO departments (plant_id, name) VALUES (?, ?)",
      [sentulId, String(department).trim()]);
  }
  await pool.query("INSERT IGNORE INTO departments (plant_id, name) VALUES (?, 'Lainnya')", [sentulId]);

  const [drows] = await pool.query("SELECT id, name FROM departments WHERE plant_id=?", [sentulId]);
  const deptByName = new Map(drows.map((d) => [d.name, d.id]));
  const lainnya = deptByName.get("Lainnya");

  const [dash] = await pool.query("SELECT id, department FROM dashboards WHERE plant_id IS NULL");
  let dashUpdated = 0;
  for (const row of dash) {
    const deptId = deptByName.get(String(row.department || "").trim()) || lainnya;
    await pool.query("UPDATE dashboards SET plant_id=?, department_id=? WHERE id=?",
      [sentulId, deptId, row.id]);
    dashUpdated += 1;
  }

  const [ins] = await pool.query(
    "INSERT IGNORE INTO user_plants (user_id, plant_id) SELECT id, ? FROM users", [sentulId]);

  return { sentulId, departments: deptByName.size, dashboardsMapped: dashUpdated, userPlantsAdded: ins.affectedRows || 0 };
}

async function main() {
  const pool = db.promise();
  const result = await backfillPlantDepartment(pool);
  console.log(`[plant:backfill] ${JSON.stringify(result)}`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

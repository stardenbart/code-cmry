// Model Plant/Department + assignment plant user & helper akses ter-gate plant.
//
// allowedDashboardIdsForUser adalah SATU sumber kebenaran aturan akses berlapis:
//   (All Access ATAU grant eksplisit) DAN (lintas-plant ATAU plant dashboard ∈
//   plant user). Dipakai ulang oleh CIA accessScope agar batas plant konsisten.
import db from "../config/db.js";

const sql = db.promise();

// ── Plants ──────────────────────────────────────────────────────────────────
export async function listPlantsWithDepartments() {
  const [plants] = await sql.query(
    "SELECT id, name, code, active FROM plants ORDER BY name");
  const [depts] = await sql.query(
    "SELECT id, plant_id, name, active FROM departments ORDER BY name");
  const byPlant = new Map();
  for (const d of depts) {
    if (!byPlant.has(d.plant_id)) byPlant.set(d.plant_id, []);
    byPlant.get(d.plant_id).push({ id: d.id, name: d.name, active: Boolean(d.active) });
  }
  return plants.map((p) => ({
    id: p.id, name: p.name, code: p.code, active: Boolean(p.active),
    departments: byPlant.get(p.id) || [],
  }));
}

export async function createPlant({ name, code }) {
  const [res] = await sql.query("INSERT INTO plants (name, code) VALUES (?, ?)",
    [String(name).trim(), String(code).trim()]);
  return res.insertId;
}
export async function updatePlant(id, { name, code, active }) {
  const [res] = await sql.query(
    "UPDATE plants SET name=?, code=?, active=? WHERE id=?",
    [String(name).trim(), String(code).trim(), active ? 1 : 0, id]);
  return res.affectedRows > 0;
}
export async function deletePlant(id) {
  const [res] = await sql.query("DELETE FROM plants WHERE id=?", [id]);
  return res.affectedRows > 0;
}

// ── Departments (per-plant) ──────────────────────────────────────────────────
export async function createDepartment({ plantId, name }) {
  const [res] = await sql.query(
    "INSERT INTO departments (plant_id, name) VALUES (?, ?)",
    [plantId, String(name).trim()]);
  return res.insertId;
}
export async function updateDepartment(id, { name, active }) {
  const [res] = await sql.query(
    "UPDATE departments SET name=?, active=? WHERE id=?",
    [String(name).trim(), active ? 1 : 0, id]);
  return res.affectedRows > 0;
}
export async function deleteDepartment(id) {
  const [res] = await sql.query("DELETE FROM departments WHERE id=?", [id]);
  return res.affectedRows > 0;
}

// ── User ↔ Plant ─────────────────────────────────────────────────────────────
export async function getUserPlants(userId) {
  const [rows] = await sql.query(
    `SELECT p.id, p.name, p.code FROM user_plants up
       JOIN plants p ON p.id = up.plant_id
      WHERE up.user_id = ? ORDER BY p.name`, [userId]);
  return rows;
}

// Set daftar plant user (maks 2 di UI). Transaksional: hapus lalu insert.
export async function setUserPlants(userId, plantIds) {
  const ids = [...new Set((Array.isArray(plantIds) ? plantIds : [])
    .map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 2);
  const conn = await sql.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM user_plants WHERE user_id=?", [userId]);
    for (const pid of ids) {
      await conn.query("INSERT IGNORE INTO user_plants (user_id, plant_id) VALUES (?, ?)", [userId, pid]);
    }
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
  return ids;
}

// ── Akses dashboard ter-gate plant (SATU sumber kebenaran) ───────────────────
export async function allowedDashboardIdsForUser(userId) {
  const [rows] = await sql.query(
    `SELECT d.id
       FROM dashboards d
       JOIN users u ON u.id = ?
       LEFT JOIN user_dashboard_access uda
              ON uda.dashboard_id = d.id AND uda.user_id = u.id
      WHERE d.active = 1
        AND (u.tipe_akses = 'All Access' OR uda.user_id IS NOT NULL)
        AND (u.cross_plant_access = 1
             OR d.plant_id IS NULL
             OR d.plant_id IN (SELECT plant_id FROM user_plants WHERE user_id = u.id))
      ORDER BY d.id`,
    [userId]);
  return rows.map((r) => String(r.id));
}

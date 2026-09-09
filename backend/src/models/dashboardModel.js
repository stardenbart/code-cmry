import db from "../config/db.js";

const sql = db.promise();

// Satu dashboard bisa ditautkan ke banyak plant. plantIds adalah sumber utama;
// kalau kosong, jatuh ke plant_id tunggal (kompatibilitas pemanggil lama).
function normalizePlantIds(plantIds, fallback) {
  let ids = (Array.isArray(plantIds) ? plantIds : [])
    .map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length && fallback != null) {
    const f = Number(fallback);
    if (Number.isInteger(f) && f > 0) ids = [f];
  }
  return [...new Set(ids)];
}

// Ganti seluruh keanggotaan plant sebuah dashboard (transaksional-ringan).
async function replacePlacements(dashboardId, plantIds) {
  await sql.query("DELETE FROM dashboard_plants WHERE dashboard_id = ?", [dashboardId]);
  for (const pid of plantIds) {
    await sql.query(
      "INSERT IGNORE INTO dashboard_plants (dashboard_id, plant_id) VALUES (?, ?)",
      [dashboardId, pid]);
  }
}

export const DashboardModel = {
  getAll: async (department) => {
    // JOIN plant/department (untuk plant utama) agar sidebar bisa membangun pohon
    // tanpa panggilan tambahan. plantIds membawa SEMUA plant tautannya.
    let query =
      `SELECT d.*, p.name AS plant_name, p.code AS plant_code, dep.name AS department_name
         FROM dashboards d
         LEFT JOIN plants p ON p.id = d.plant_id
         LEFT JOIN departments dep ON dep.id = d.department_id`;
    const params = [];
    if (department) { query += " WHERE d.department = ?"; params.push(department); }
    query += " ORDER BY d.id";

    const [rows] = await sql.query(query, params);
    const [placements] = await sql.query(
      "SELECT dashboard_id, plant_id FROM dashboard_plants");
    const byDash = new Map();
    for (const pl of placements) {
      if (!byDash.has(pl.dashboard_id)) byDash.set(pl.dashboard_id, []);
      byDash.get(pl.dashboard_id).push(pl.plant_id);
    }
    return rows.map((d) => ({
      ...d,
      plantIds: byDash.get(d.id) || (d.plant_id != null ? [d.plant_id] : []),
    }));
  },

  create: async ({ title, description, url, report_id, department, pic_emails, plant_id, department_id, plantIds }) => {
    const ids = normalizePlantIds(plantIds, plant_id);
    const primaryPlant = ids[0] ?? null;
    const [result] = await sql.query(
      "INSERT INTO dashboards (title, description, url, report_id, department, pic_emails, plant_id, department_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [title, description, url, report_id || null, department, pic_emails || null,
        primaryPlant, department_id || null]);
    await replacePlacements(result.insertId, ids);
    return result.insertId;
  },

  update: async (id, { title, description, url, report_id, department, pic_emails, plant_id, department_id, plantIds }) => {
    const ids = normalizePlantIds(plantIds, plant_id);
    const primaryPlant = ids[0] ?? null;
    const [result] = await sql.query(
      "UPDATE dashboards SET title=?, description=?, url=?, report_id=?, department=?, pic_emails=?, plant_id=?, department_id=? WHERE id=?",
      [title, description, url, report_id || null, department, pic_emails || null,
        primaryPlant, department_id || null, id]);
    await replacePlacements(id, ids);
    return result;
  },

  delete: async (id) => {
    // dashboard_plants ikut terhapus lewat FK ON DELETE CASCADE.
    const [result] = await sql.query("DELETE FROM dashboards WHERE id = ?", [id]);
    return result;
  },

  getPicEmails: async (dashboardTitle) => {
    const [results] = await sql.query(
      "SELECT pic_emails FROM dashboards WHERE title = ? LIMIT 1", [dashboardTitle]);
    const raw = results[0]?.pic_emails || "";
    return raw.split(",").map((e) => e.trim()).filter(Boolean);
  },
};

import db from "../config/db.js";

export const DashboardModel = {
  getAll: (department) => {
    return new Promise((resolve, reject) => {
      // JOIN plant/department agar sidebar bisa membangun pohon Plant ▸ Dept ▸
      // Dashboard tanpa panggilan tambahan. Kolom lama tetap ikut (d.*).
      let sql =
        `SELECT d.*, p.name AS plant_name, p.code AS plant_code, dep.name AS department_name
           FROM dashboards d
           LEFT JOIN plants p ON p.id = d.plant_id
           LEFT JOIN departments dep ON dep.id = d.department_id`;
      const params = [];
      if (department) {
        sql += " WHERE d.department = ?";
        params.push(department);
      }
      sql += " ORDER BY d.id";
      db.query(sql, params, (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });
  },

  create: ({ title, description, url, report_id, department, pic_emails, plant_id, department_id }) => {
    return new Promise((resolve, reject) => {
      const sql =
        "INSERT INTO dashboards (title, description, url, report_id, department, pic_emails, plant_id, department_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
      db.query(sql, [title, description, url, report_id || null, department, pic_emails || null,
        plant_id || null, department_id || null], (err, result) => {
        if (err) return reject(err);
        resolve(result.insertId);
      });
    });
  },

  update: (id, { title, description, url, report_id, department, pic_emails, plant_id, department_id }) => {
    return new Promise((resolve, reject) => {
      const sql =
        "UPDATE dashboards SET title=?, description=?, url=?, report_id=?, department=?, pic_emails=?, plant_id=?, department_id=? WHERE id=?";
      db.query(sql, [title, description, url, report_id || null, department, pic_emails || null,
        plant_id || null, department_id || null, id], (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  },

  delete: (id) => {
    return new Promise((resolve, reject) => {
      const sql = "DELETE FROM dashboards WHERE id=?";
      db.query(sql, [id], (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  },

  getPicEmails: (dashboardTitle) => {
    return new Promise((resolve, reject) => {
      db.query(
        "SELECT pic_emails FROM dashboards WHERE title = ? LIMIT 1",
        [dashboardTitle],
        (err, results) => {
          if (err) return reject(err);
          const raw = results[0]?.pic_emails || "";
          const emails = raw.split(",").map(e => e.trim()).filter(Boolean);
          resolve(emails);
        }
      );
    });
  },
};

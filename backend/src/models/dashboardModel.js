import db from "../config/db.js";

export const DashboardModel = {
  getAll: (department) => {
    return new Promise((resolve, reject) => {
      let sql = "SELECT * FROM dashboards";
      const params = [];

      if (department) {
        sql += " WHERE department = ?";
        params.push(department);
      }

      db.query(sql, params, (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });
  },

  create: ({ title, description, url, report_id, department, pic_emails }) => {
    return new Promise((resolve, reject) => {
      const sql =
        "INSERT INTO dashboards (title, description, url, report_id, department, pic_emails) VALUES (?, ?, ?, ?, ?, ?)";
      db.query(sql, [title, description, url, report_id || null, department, pic_emails || null], (err, result) => {
        if (err) return reject(err);
        resolve(result.insertId);
      });
    });
  },

  update: (id, { title, description, url, report_id, department, pic_emails }) => {
    return new Promise((resolve, reject) => {
      const sql =
        "UPDATE dashboards SET title=?, description=?, url=?, report_id=?, department=?, pic_emails=? WHERE id=?";
      db.query(sql, [title, description, url, report_id || null, department, pic_emails || null, id], (err, result) => {
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

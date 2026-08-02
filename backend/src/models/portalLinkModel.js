import db from "../config/db.js";

export const PortalLinkModel = {
  getActive: () => new Promise((resolve, reject) => {
    db.query(
      "SELECT * FROM portal_links WHERE active = 1 ORDER BY sort_order ASC, id ASC",
      (err, rows) => err ? reject(err) : resolve(rows)
    );
  }),

  getAll: () => new Promise((resolve, reject) => {
    db.query(
      "SELECT * FROM portal_links ORDER BY sort_order ASC, id ASC",
      (err, rows) => err ? reject(err) : resolve(rows)
    );
  }),

  create: ({ title, url, image_url, sort_order }) => new Promise((resolve, reject) => {
    db.query(
      "INSERT INTO portal_links (title, url, image_url, sort_order) VALUES (?, ?, ?, ?)",
      [title, url, image_url ?? null, sort_order ?? 0],
      (err, result) => err ? reject(err) : resolve(result)
    );
  }),

  update: (id, { title, url, image_url, sort_order, active }) => new Promise((resolve, reject) => {
    db.query(
      "UPDATE portal_links SET title=?, url=?, image_url=?, sort_order=?, active=? WHERE id=?",
      [title, url, image_url ?? null, sort_order ?? 0, active ?? 1, id],
      (err, result) => err ? reject(err) : resolve(result)
    );
  }),

  remove: (id) => new Promise((resolve, reject) => {
    db.query(
      "DELETE FROM portal_links WHERE id=?",
      [id],
      (err, result) => err ? reject(err) : resolve(result)
    );
  }),
};

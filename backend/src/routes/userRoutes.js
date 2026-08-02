// ─────────────────────────────────────────────────────────────────────────────
// User management.
//
// Split out of server.js so the endpoints that create, modify, and delete
// accounts sit together with their guards visible in one screen — scattered
// across an 800-line file, a missing guard is easy to overlook.
//
// Mounted at /api, so paths here are relative to that.
// ─────────────────────────────────────────────────────────────────────────────

import express from "express";
import bcrypt from "bcrypt";
import db from "../config/db.js";
import { requireAdmin, requireSelfOrAdmin } from "../middleware/authorize.js";

const router = express.Router();

// GET ALL USERS
router.get("/users", requireAdmin, (req, res) => {
  const q =
    "SELECT id, nama, departemen, tipe_akses, nik, email, username, approved, role FROM users";
  db.query(q, (err, results) => {
    if (err) return res.status(500).json({ message: "Database error", error: err });
    res.json(results);
  });
});

// CHANGE PASSWORD
// Self-service requires the current password: without it, anyone who finds an
// unattended logged-in browser could lock the owner out permanently. An admin
// resetting someone else's password is exempt — that is the point of a reset.
router.put("/users/:id/password", requireSelfOrAdmin("id"), async (req, res) => {
  const { id } = req.params;
  const { currentPassword, newPassword } = req.body;

  if (!newPassword || newPassword.trim().length < 8) {
    return res.status(400).json({ message: "Password baru minimal 8 karakter" });
  }

  const isSelf = Number(id) === Number(req.dbUser.id);

  try {
    if (isSelf) {
      if (!currentPassword) {
        return res.status(400).json({ message: "Password saat ini wajib diisi" });
      }

      const [rows] = await db.promise().query("SELECT password FROM users WHERE id = ?", [id]);
      if (!rows.length) return res.status(404).json({ message: "User tidak ditemukan" });

      const valid = await bcrypt.compare(currentPassword, rows[0].password);
      if (!valid) return res.status(400).json({ message: "Password saat ini salah" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const [result] = await db
      .promise()
      .query("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }
    res.json({ message: "Password berhasil diperbarui" });
  } catch (error) {
    console.error("Error updating password:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ADD USER
router.post("/add-user", requireAdmin, async (req, res) => {
  const { nama, departemen, tipe_akses, nik, email, username, password } = req.body;

  // bcrypt.hash(undefined) throws, and an unhandled rejection inside an async
  // Express handler kills the process — Express does not catch it. A request
  // with no body used to take the whole backend down.
  if (!username?.trim() || !password?.trim() || !nama?.trim()) {
    return res.status(400).json({ message: "Nama, username, dan password wajib diisi" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const q = `
    INSERT INTO users (nama, departemen, tipe_akses, nik, email, username, password, approved)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `;
  db.query(q, [nama, departemen, tipe_akses, nik, email, username, hashedPassword], (err) => {
    if (err) return res.status(500).json({ message: "Database error", error: err });
    res.status(200).json({ message: "User successfully added" });
  });
});

// UPDATE USER
router.put("/update-user/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { nama, departemen, tipe_akses, nik, email, username, password } = req.body;

  try {
    let q = "";
    let params = [];

    if (password && password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(password, 10);
      q = `
        UPDATE users
        SET nama=?, departemen=?, tipe_akses=?, nik=?, email=?, username=?, password=?
        WHERE id=?`;
      params = [nama, departemen, tipe_akses, nik, email, username, hashedPassword, id];
    } else {
      q = `
        UPDATE users
        SET nama=?, departemen=?, tipe_akses=?, nik=?, email=?, username=?
        WHERE id=?`;
      params = [nama, departemen, tipe_akses, nik, email, username, id];
    }

    db.query(q, params, (err, result) => {
      if (err) return res.status(500).json({ message: "Database error", error: err });
      if (result.affectedRows === 0) return res.status(404).json({ message: "User is not found" });
      res.status(200).json({ message: "User successfully updated" });
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
});

// APPROVE / DECLINE USER
router.put("/approve-user/:id", requireAdmin, (req, res) => {
  const { id } = req.params;

  // Get user info first for notification
  db.query("SELECT nama FROM users WHERE id = ?", [id], (err, users) => {
    if (err || users.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const userName = users[0].nama;

    db.query("UPDATE users SET approved = 1 WHERE id = ?", [id], (err) => {
      if (err) return res.status(500).json({ message: "Database error", error: err });
      res.json({ message: "User successfully approved" });
    });
  });
});

router.put("/decline-user/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM users WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ message: "Database error", error: err });
    res.json({ message: "User declined and deleted" });
  });
});

// DELETE USER
router.delete("/delete-user/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM users WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ message: "Database error", error: err });
    res.json({ message: "User deleted successfully" });
  });
});

export default router;

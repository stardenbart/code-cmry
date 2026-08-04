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

/**
 * Peran yang boleh disimpan.
 *
 * requireAdmin membandingkan role === "admin" persis, jadi nilai di luar daftar
 * ini tidak gagal dengan berisik: ia tersimpan rapi lalu mencabut akses tanpa
 * pesan apa pun. "Admin" dengan A besar sudah cukup untuk mengunci orangnya.
 */
const ROLE_SAH = new Set(["user", "admin"]);

/**
 * Menolak penurunan admin terakhir.
 *
 * Kalau jumlah admin menjadi nol, requireAdmin gagal untuk semua orang dan
 * tidak ada lagi jalan lewat UI untuk memperbaikinya, termasuk untuk
 * mengangkat admin baru. Pemulihannya cuma lewat SQL langsung ke database.
 */
async function menurunkanAdminTerakhir(targetId) {
  const [rows] = await db
    .promise()
    .query("SELECT COUNT(*) AS sisa FROM users WHERE role = 'admin' AND id <> ?", [targetId]);
  return rows[0].sisa === 0;
}

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

  // Bawaannya "user". Akun baru tidak boleh lahir sebagai admin hanya karena
  // body permintaannya menyebut begitu tanpa disengaja.
  const peran = ROLE_SAH.has(req.body?.role) ? req.body.role : "user";

  const hashedPassword = await bcrypt.hash(password, 10);
  const q = `
    INSERT INTO users (nama, departemen, tipe_akses, nik, email, username, password, approved, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `;
  db.query(q, [nama, departemen, tipe_akses, nik, email, username, hashedPassword, peran], (err) => {
    if (err) return res.status(500).json({ message: "Database error", error: err });
    res.status(200).json({ message: "User successfully added" });
  });
});

// UPDATE USER
router.put("/update-user/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { nama, departemen, tipe_akses, nik, email, username, password, role } = req.body;

  try {
    if (role !== undefined && !ROLE_SAH.has(role)) {
      return res.status(400).json({ message: "Role tidak valid" });
    }

    if (role === "user" && (await menurunkanAdminTerakhir(id))) {
      return res.status(409).json({
        message: "Tidak bisa menurunkan admin terakhir. Angkat admin lain dulu supaya akun tidak terkunci.",
      });
    }

    // Kolom disusun bertahap, bukan dua cabang query tetap. Sebelumnya daftar
    // kolomnya pasti, dan menambahkan role=? di situ berarti setiap pemanggil
    // yang tidak mengirim role akan menurunkan perannya ke nilai bawaan.
    // Sekarang kolom yang tidak dikirim memang tidak ikut ditulis.
    const kolom = ["nama=?", "departemen=?", "tipe_akses=?", "nik=?", "email=?", "username=?"];
    const params = [nama, departemen, tipe_akses, nik, email, username];

    if (password && password.trim() !== "") {
      kolom.push("password=?");
      params.push(await bcrypt.hash(password, 10));
    }
    if (role !== undefined) {
      kolom.push("role=?");
      params.push(role);
    }
    params.push(id);

    // Nama kolom berasal dari literal di atas, tidak pernah dari req.body,
    // jadi penggabungan string ini tidak membuka celah injeksi.
    const q = `UPDATE users SET ${kolom.join(", ")} WHERE id=?`;

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

import jwt from "jsonwebtoken";
import db from "../config/db.js";

const sql = db.promise();

// Verifies the Bearer JWT and attaches { id, username } to req.user
export function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Token missing" });
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET || "jwt_secret_key", (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid or expired token" });
    req.user = decoded;
    next();
  });
}

/**
 * Single source of truth for admin rights.
 *
 * Reads the `role` column rather than comparing usernames: the old check was
 * duplicated across five files, broke if the account was renamed, and could
 * never support a second admin.
 */
export function isAdmin(user) {
  return user?.role === "admin";
}

/**
 * Loads a user fresh from the database.
 *
 * Authorization deliberately does NOT trust the role inside the JWT — a token
 * issued before an admin was demoted would keep working until it expired.
 */
export async function loadUser(userId) {
  if (userId === undefined || userId === null) return null;
  const [rows] = await sql.query(
    // cia_access WAJIB ikut. Penjaga akses CIA membacanya, dan kolom yang tidak
    // diambil bernilai undefined untuk SEMUA orang, sehingga penjaganya menolak
    // semua orang tanpa satu pun error yang muncul di mana pun. Persis itu yang
    // pernah terjadi pada kolom role dan membuat kunci universal tidak bisa
    // diatur oleh siapa pun.
    "SELECT id, nama, username, departemen, tipe_akses, role, approved, cia_access FROM users WHERE id = ?",
    [userId]
  );
  return rows[0] || null;
}

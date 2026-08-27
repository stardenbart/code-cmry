// Endpoint control-plane Admin CIA. SELURUH router memakai requireAdmin — tidak
// ada satu handler pun yang boleh dijangkau tanpa hak admin, dan itu dipasang
// sekali di router.use() supaya endpoint baru otomatis terlindungi.
//
// Access management di sini HANYA menulis users.cia_access. userId selalu dibaca
// dari parameter path, tidak pernah dari body — request body tidak dipercaya.
// Role/profil user tetap dikelola User Management.
import express from "express";
import db from "../config/db.js";
import { requireAdmin } from "../middleware/authorize.js";
import {
  normalizeAnalyticsFilters, getOverview, getUsageSeries, getUsageBreakdown,
  getRetrievalHealth, getFilterOptions, getRequestTrace, AnalyticsValidationError,
} from "../services/ciaAdminAnalytics.service.js";

const sql = db.promise();
const router = express.Router();

router.use(requireAdmin);

function handle(res, err) {
  if (err instanceof AnalyticsValidationError) {
    return res.status(400).json({ message: err.message, code: err.code });
  }
  // Log kode/pesan singkat saja — tidak pernah objek error mentah.
  console.error("❌ admin cia error:", err?.code || err?.message);
  return res.status(500).json({ message: "Gagal memuat data analytics CIA" });
}

router.get("/overview", async (req, res) => {
  try {
    const filters = normalizeAnalyticsFilters(req.query);
    res.json(await getOverview(filters));
  } catch (err) { handle(res, err); }
});

router.get("/usage", async (req, res) => {
  try {
    const filters = normalizeAnalyticsFilters(req.query);
    const dimension = typeof req.query.dimension === "string" && req.query.dimension
      ? req.query.dimension : "surface";
    // getUsageBreakdown melempar AnalyticsValidationError untuk dimensi tak valid
    // SEBELUM menyentuh DB; handle() memetakannya ke 400.
    const [series, breakdown] = await Promise.all([
      getUsageSeries(filters),
      getUsageBreakdown(filters, dimension),
    ]);
    res.json({ dimension, series, breakdown });
  } catch (err) { handle(res, err); }
});

router.get("/health", async (req, res) => {
  try {
    const filters = normalizeAnalyticsFilters(req.query);
    res.json(await getRetrievalHealth(filters));
  } catch (err) { handle(res, err); }
});

router.get("/filters", async (req, res) => {
  try {
    const filters = normalizeAnalyticsFilters(req.query);
    res.json(await getFilterOptions(filters));
  } catch (err) { handle(res, err); }
});

router.get("/requests/:requestId", async (req, res) => {
  try {
    const trace = await getRequestTrace(String(req.params.requestId));
    if (!trace) return res.status(404).json({ message: "Request tidak ditemukan" });
    res.json(trace);
  } catch (err) { handle(res, err); }
});

// ── CIA Access management ───────────────────────────────────────────────────
router.get("/access", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const department = typeof req.query.department === "string" ? req.query.department.trim() : "";

    const clauses = [];
    const params = [];
    if (q) {
      clauses.push("(u.nama LIKE ? OR u.username LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    if (department) { clauses.push("u.departemen = ?"); params.push(department); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const [countRows] = await sql.query(
      `SELECT COUNT(*) AS total FROM users u ${where}`, params);
    const [rows] = await sql.query(
      `SELECT u.id, u.nama, u.username, u.departemen, u.role, u.approved,
              u.cia_access
         FROM users u ${where}
        ORDER BY u.nama ASC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      total: Number(countRows[0].total) || 0,
      limit,
      offset,
      users: rows.map((u) => ({
        id: u.id,
        name: u.nama,
        username: u.username,
        department: u.departemen,
        role: u.role,
        approved: Boolean(u.approved),
        ciaAccess: Boolean(u.cia_access),
      })),
    });
  } catch (err) { handle(res, err); }
});

router.put("/access/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: "userId tidak valid" });
    }
    // Boolean eksplisit wajib — tidak menebak dari truthy/falsy sembarang nilai.
    const { enabled } = req.body || {};
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ message: "Field 'enabled' harus boolean" });
    }

    const [result] = await sql.query(
      "UPDATE users SET cia_access = ? WHERE id = ?",
      [enabled ? 1 : 0, userId]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }
    res.json({ userId, ciaAccess: enabled });
  } catch (err) { handle(res, err); }
});

export default router;

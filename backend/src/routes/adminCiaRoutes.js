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
import { ciaAdminAnalyticsEnabled, envFlag } from "../config/featureFlags.js";
import {
  listKpis, getKpi, createKpi, updateKpi, confirmKpi, listRevisions, restoreRevision,
} from "../models/ciaKpiModel.js";
import {
  createSyncRun, runSync, getSyncRun, hasActiveSyncRun,
} from "../services/ciaKpiSync.service.js";

const sql = db.promise();
const router = express.Router();

router.use(requireAdmin);

function handle(res, err) {
  if (err instanceof AnalyticsValidationError) {
    return res.status(400).json({ message: err.message, code: err.code });
  }
  // Error domain (KpiError dll) membawa statusCode + code yang aman ditampilkan.
  if (err && Number.isInteger(err.statusCode) && err.statusCode < 500) {
    return res.status(err.statusCode).json({ message: err.message, code: err.code });
  }
  // Log kode/pesan singkat saja — tidak pernah objek error mentah.
  console.error("❌ admin cia error:", err?.code || err?.message);
  return res.status(500).json({ message: "Gagal memuat data analytics CIA" });
}

function actorId(req) { return req.dbUser?.id ?? req.user?.id ?? null; }

router.get("/settings", (_req, res) => {
  res.json({
    flags: {
      CIA_TELEMETRY_ENABLED: envFlag("CIA_TELEMETRY_ENABLED"),
      CIA_ADMIN_ANALYTICS_ENABLED: envFlag("CIA_ADMIN_ANALYTICS_ENABLED"),
    },
    timezone: process.env.SCHEDULER_TIMEZONE || "Asia/Jakarta",
    maxAnalyticsRangeDays: 366,
  });
});

function requireAnalyticsEnabled(_req, res, next) {
  if (!ciaAdminAnalyticsEnabled()) {
    return res.status(404).json({ message: "Analytics CIA belum diaktifkan" });
  }
  next();
}

router.get("/overview", requireAnalyticsEnabled, async (req, res) => {
  try {
    const filters = normalizeAnalyticsFilters(req.query);
    res.json(await getOverview(filters));
  } catch (err) { handle(res, err); }
});

router.get("/usage", requireAnalyticsEnabled, async (req, res) => {
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

router.get("/health", requireAnalyticsEnabled, async (req, res) => {
  try {
    const filters = normalizeAnalyticsFilters(req.query);
    res.json(await getRetrievalHealth(filters));
  } catch (err) { handle(res, err); }
});

router.get("/filters", requireAnalyticsEnabled, async (req, res) => {
  try {
    const filters = normalizeAnalyticsFilters(req.query);
    res.json(await getFilterOptions(filters));
  } catch (err) { handle(res, err); }
});

router.get("/requests/:requestId", requireAnalyticsEnabled, async (req, res) => {
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
    const [departmentRows] = await sql.query(
      "SELECT DISTINCT departemen FROM users WHERE departemen IS NOT NULL AND departemen <> '' ORDER BY departemen"
    );

    res.json({
      total: Number(countRows[0].total) || 0,
      limit,
      offset,
      departments: departmentRows.map((row) => row.departemen),
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

router.put("/access", async (req, res) => {
  let connection = null;
  try {
    connection = await sql.getConnection();
    const { userIds, enabled } = req.body || {};
    const ids = [...new Set(Array.isArray(userIds) ? userIds.map(Number) : [])];
    if (!ids.length || ids.length > 500 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      return res.status(400).json({ message: "userIds tidak valid" });
    }
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ message: "Field 'enabled' harus boolean" });
    }

    await connection.beginTransaction();
    const placeholders = ids.map(() => "?").join(",");
    const [found] = await connection.query(
      `SELECT id FROM users WHERE id IN (${placeholders}) FOR UPDATE`, ids
    );
    if (found.length !== ids.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Satu atau lebih user tidak ditemukan" });
    }
    await connection.query(
      `UPDATE users SET cia_access = ? WHERE id IN (${placeholders})`,
      [enabled ? 1 : 0, ...ids]
    );
    await connection.commit();
    res.json({ userIds: ids, ciaAccess: enabled, updated: ids.length });
  } catch (err) {
    try { await connection.rollback(); } catch {}
    handle(res, err);
  } finally {
    connection?.release();
  }
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

// ── KPI Library ─────────────────────────────────────────────────────────────
// Manajemen KPI tersedia untuk Admin terlepas dari CIA_KPI_LIBRARY_ENABLED
// (flag itu mengatur read-through reader, bukan hak kelola). Semua tetap
// requireAdmin lewat router.use di atas.

router.get("/kpis", async (req, res) => {
  try {
    res.json(await listKpis({
      q: req.query.q, domain: req.query.domain, status: req.query.status,
      dashboardId: req.query.dashboardId, limit: req.query.limit, offset: req.query.offset,
    }));
  } catch (err) { handle(res, err); }
});

router.post("/kpis", async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.humanName || !String(b.humanName).trim()) {
      return res.status(400).json({ message: "humanName wajib diisi" });
    }
    const kpi = await createKpi(b, actorId(req), b.reason);
    res.status(201).json(kpi);
  } catch (err) { handle(res, err); }
});

// sync didaftarkan SEBELUM :id agar "/kpis/sync/:runId" tidak tertangkap :id.
router.post("/kpis/sync", async (req, res) => {
  try {
    if (await hasActiveSyncRun()) {
      return res.status(409).json({ message: "Sync KPI masih berjalan", code: "SYNC_RUNNING" });
    }
    const dashboardIds = Array.isArray(req.body?.dashboardIds) ? req.body.dashboardIds : null;
    const { runDbId, runUuid } = await createSyncRun(actorId(req));
    // Background: jangan menahan HTTP sampai seluruh dashboard selesai. Catch
    // terpasang supaya kegagalan tidak menjadi unhandled rejection.
    runSync(runDbId, runUuid, { dashboardIds }).catch((err) => {
      console.error("❌ cia kpi sync gagal:", err?.code || err?.message);
    });
    res.status(202).json({ runId: runUuid, status: "running" });
  } catch (err) { handle(res, err); }
});

router.get("/kpis/sync/:runId", async (req, res) => {
  try {
    const run = await getSyncRun(String(req.params.runId));
    if (!run) return res.status(404).json({ message: "Sync run tidak ditemukan" });
    res.json(run);
  } catch (err) { handle(res, err); }
});

router.get("/kpis/:id", async (req, res) => {
  try {
    const kpi = await getKpi(Number(req.params.id));
    if (!kpi) return res.status(404).json({ message: "KPI tidak ditemukan" });
    res.json(kpi);
  } catch (err) { handle(res, err); }
});

router.put("/kpis/:id", async (req, res) => {
  try {
    const { reason, expectedVersion, ...patch } = req.body || {};
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: "reason wajib diisi", code: "REASON_REQUIRED" });
    }
    // Validasi tipe field array sebelum menyentuh DB.
    for (const f of ["synonyms", "answerableQuestions"]) {
      if (patch[f] !== undefined && !Array.isArray(patch[f])) {
        return res.status(400).json({ message: `Field '${f}' harus array`, code: "INVALID_TYPE" });
      }
    }
    const kpi = await updateKpi(Number(req.params.id), patch, actorId(req), reason, { expectedVersion });
    res.json(kpi);
  } catch (err) { handle(res, err); }
});

router.post("/kpis/:id/confirm", async (req, res) => {
  try {
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: "reason wajib diisi", code: "REASON_REQUIRED" });
    }
    const kpi = await confirmKpi(Number(req.params.id), actorId(req), reason);
    res.json(kpi);
  } catch (err) { handle(res, err); }
});

router.get("/kpis/:id/revisions", async (req, res) => {
  try {
    const kpi = await getKpi(Number(req.params.id));
    if (!kpi) return res.status(404).json({ message: "KPI tidak ditemukan" });
    res.json(await listRevisions(Number(req.params.id)));
  } catch (err) { handle(res, err); }
});

router.post("/kpis/:id/revisions/:revisionId/restore", async (req, res) => {
  try {
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: "reason wajib diisi", code: "REASON_REQUIRED" });
    }
    const kpi = await restoreRevision(
      Number(req.params.id), Number(req.params.revisionId), actorId(req), reason);
    res.json(kpi);
  } catch (err) { handle(res, err); }
});

export default router;

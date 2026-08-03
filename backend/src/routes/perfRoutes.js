// ─────────────────────────────────────────────────────────────────────────────
// Telemetri performa.
//
// Tujuannya menjawab satu pertanyaan: waktu buka dashboard habis di mana —
// mengambil token, atau Power BI merender? Tanpa pemisahan itu, optimasi
// berikutnya hanya tebakan yang kebetulan masuk akal.
// ─────────────────────────────────────────────────────────────────────────────

import express from "express";
import db from "../config/db.js";
import * as rateLimit from "../services/rateLimiter.js";
import { requireAdmin } from "../middleware/authorize.js";

const router = express.Router();

// Kunci yang diterima per jenis sampel. Apa pun di luar ini ditolak — kolom
// JSON akan dengan senang hati menyimpan apa saja yang dikirim browser.
const ALLOWED = {
  app_load:       { ttfb: "number", domInteractive: "number", appReady: "number" },
  dashboard_open: { tokenMs: "number", renderMs: "number", prefetchHit: "boolean" },
};

const MAX_MS = 600_000; // 10 menit; apa pun di atas ini bukan pengukuran, itu bug

function validate(kind, metrics) {
  const schema = ALLOWED[kind];
  if (!schema) return "kind tidak dikenal";
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return "metrics harus objek";
  }
  for (const [key, value] of Object.entries(metrics)) {
    const expected = schema[key];
    if (!expected) return `kunci tidak dikenal: ${key}`;
    if (expected === "boolean") {
      if (typeof value !== "boolean") return `${key} harus boolean`;
    } else {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${key} harus angka`;
      if (value < 0 || value > MAX_MS) return `${key} di luar rentang`;
    }
  }
  return null;
}

router.post("/", (req, res) => {
  // Identitas dari token, tidak pernah dari body.
  const userId = req.user?.id ?? null;

  // Endpoint yang menulis ke database tanpa batas adalah alat pengisi disk.
  const limit = rateLimit.hit(`perf:${userId}`, 60, 300);
  if (!limit.allowed) return res.status(429).json({ message: "Terlalu banyak kiriman telemetri" });

  const { kind, dashboard_id: dashboardId, metrics } = req.body || {};
  const problem = validate(kind, metrics);
  if (problem) return res.status(400).json({ message: problem });

  const dash = Number.isInteger(dashboardId) ? dashboardId : null;

  db.query(
    "INSERT INTO perf_samples (user_id, kind, dashboard_id, metrics) VALUES (?, ?, ?, ?)",
    [userId, kind, dash, JSON.stringify(metrics)],
    (err) => {
      // Klien tidak punya tindakan berarti atas kegagalan telemetri, dan
      // membuat pengukuran menjatuhkan fitur yang diukurnya lebih buruk
      // daripada tidak mengukur sama sekali.
      if (err) console.error("[perf] gagal menyimpan sampel:", err.message);
      res.status(204).end();
    }
  );
});

/**
 * Persentil dengan metode nearest-rank.
 *
 * Rata-rata menyembunyikan ekor lambat, dan ekor lambat itulah yang dikeluhkan
 * user — satu muat 9 detik terasa jauh lebih buruk daripada sepuluh muat
 * 1 detik terasa baik.
 */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

function summarise(rows, keys) {
  const p50 = {};
  const p95 = {};
  for (const key of keys) {
    const values = rows
      .map((r) => r.metrics?.[key])
      .filter((v) => typeof v === "number")
      .sort((a, b) => a - b);
    p50[key] = percentile(values, 50);
    p95[key] = percentile(values, 95);
  }
  return { count: rows.length, p50, p95 };
}

// mysql2 sudah mem-parse kolom JSON menjadi objek; string hanya muncul pada
// versi driver lama, jadi keduanya ditangani.
function readMetrics(raw) {
  if (raw && typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

router.get("/summary", requireAdmin, (req, res) => {
  const sql = `
    SELECT p.kind, p.dashboard_id, p.metrics, d.title
    FROM perf_samples p
    LEFT JOIN dashboards d ON d.id = p.dashboard_id
    WHERE p.created_at >= NOW() - INTERVAL 7 DAY
  `;
  db.query(sql, (err, rows) => {
    if (err) return res.status(500).json({ message: "Database error" });

    const parsed = rows.map((r) => ({ ...r, metrics: readMetrics(r.metrics) }));
    const appLoad   = parsed.filter((r) => r.kind === "app_load");
    const dashboard = parsed.filter((r) => r.kind === "dashboard_open");

    const hits = dashboard.filter((r) => r.metrics.prefetchHit === true).length;

    // Lima dashboard dengan p95 render terlambat, minimal 3 sampel supaya satu
    // kejadian aneh tidak menobatkan sebuah dashboard sebagai "paling lambat".
    const byDash = new Map();
    for (const row of dashboard) {
      if (row.dashboard_id == null) continue;
      if (!byDash.has(row.dashboard_id)) {
        byDash.set(row.dashboard_id, {
          dashboard_id: row.dashboard_id,
          title: row.title,
          values: [],
        });
      }
      if (typeof row.metrics.renderMs === "number") {
        byDash.get(row.dashboard_id).values.push(row.metrics.renderMs);
      }
    }
    const slowest = [...byDash.values()]
      .filter((d) => d.values.length >= 3)
      .map((d) => ({
        dashboard_id: d.dashboard_id,
        title: d.title,
        samples: d.values.length,
        p95RenderMs: percentile([...d.values].sort((a, b) => a - b), 95),
      }))
      .sort((a, b) => b.p95RenderMs - a.p95RenderMs)
      .slice(0, 5);

    res.json({
      appLoad: summarise(appLoad, ["ttfb", "domInteractive", "appReady"]),
      dashboard: {
        ...summarise(dashboard, ["tokenMs", "renderMs"]),
        prefetchHitRate: dashboard.length ? hits / dashboard.length : null,
      },
      slowest,
    });
  });
});

export default router;

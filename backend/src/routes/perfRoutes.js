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

export default router;

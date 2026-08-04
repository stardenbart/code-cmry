// ─────────────────────────────────────────────────────────────────────────────
// Panen inventaris visual untuk Automated Daily Executive Summary.
//
// Kenapa panennya lewat browser dan bukan lewat API: tiga jalur otomatis untuk
// membaca ikatan visual sudah dicoba 2026-08-04 dan tertutup semuanya.
//
//   Fabric getDefinition   403  app registration tidak punya scope-nya
//   Export .pbix           400  OperationIsNotSupportedForPremiumFilesModel
//   INFO.MEASURES()        400  (INFO.VIEW.MEASURES() jalan, tapi tidak
//                               menyebut visual sama sekali)
//
// Tanpa inventaris ini, katalog KPI akan memuat measure yang ada di model tapi
// tidak pernah dirender, termasuk sisa percobaan DAX. Angkanya keluar tanpa
// error dan analisa AI-nya jadi menyesatkan.
//
// Mounted di /api/summary.
// ─────────────────────────────────────────────────────────────────────────────

import express from "express";
import db from "../config/db.js";
import { requireAdmin } from "../middleware/authorize.js";

const router = express.Router();
const sql = db.promise();

/** Batas kewarasan: satu report tidak mungkin punya sebanyak ini field. */
const MAKS_FIELD_PER_REPORT = 4000;

/**
 * GET /api/summary/harvest-plan
 *
 * Dashboard yang bisa dipanen, yaitu yang punya report_id. Dua dari 46 dashboard
 * tidak punya, dan itu bukan kegagalan: keduanya memakai link publik yang
 * tokennya bukan report ID, jadi SDK tidak bisa membaca visualnya.
 */
router.get("/harvest-plan", requireAdmin, async (req, res) => {
  try {
    const [rows] = await sql.query(
      `SELECT d.id, d.title, d.report_id,
              (SELECT COUNT(DISTINCT v.field_name) FROM visual_field_usage v
                WHERE v.dashboard_id = d.id) AS field_terpanen,
              (SELECT MAX(v.harvested_at) FROM visual_field_usage v
                WHERE v.dashboard_id = d.id) AS terakhir_panen
         FROM dashboards d
        WHERE d.report_id IS NOT NULL AND d.report_id <> ''
        ORDER BY d.id`
    );
    res.json({
      total: rows.length,
      dashboards: rows.map((r) => ({
        id: r.id,
        title: r.title,
        reportId: r.report_id,
        fieldTerpanen: Number(r.field_terpanen) || 0,
        terakhirPanen: r.terakhir_panen,
      })),
    });
  } catch (err) {
    console.error("harvest-plan error:", err.message);
    res.status(500).json({ message: "Gagal menyusun rencana panen" });
  }
});

/**
 * POST /api/summary/visual-usage
 *
 * Menyimpan hasil panen satu dashboard.
 *
 * Baris lama TIDAK dihapus lebih dulu. Panen yang gagal separuh jalan, misalnya
 * karena satu halaman menolak exportData, tidak boleh meninggalkan dashboard
 * dengan inventaris yang lebih sedikit daripada sebelum panen dijalankan.
 * Upsert membuat panen ulang menambah dan menyegarkan, tidak pernah mengurangi.
 */
router.post("/visual-usage", requireAdmin, async (req, res) => {
  const dashboardId = Number(req.body?.dashboardId);
  const reportId = String(req.body?.reportId || "").trim();
  const visuals = Array.isArray(req.body?.visuals) ? req.body.visuals : null;

  if (!Number.isInteger(dashboardId) || dashboardId <= 0) {
    return res.status(400).json({ message: "dashboardId wajib berupa angka" });
  }
  if (!reportId) return res.status(400).json({ message: "reportId wajib diisi" });
  if (!visuals) return res.status(400).json({ message: "visuals wajib berupa array" });

  // Ratakan jadi baris field. Nama dipangkas ke lebar kolom di sini, bukan
  // dibiarkan MySQL memotongnya diam-diam di mode non-strict.
  const baris = [];
  for (const v of visuals) {
    const fields = Array.isArray(v?.fields) ? v.fields : [];
    for (const f of fields) {
      const nama = String(f || "").trim();
      if (!nama) continue;
      baris.push([
        dashboardId,
        reportId.slice(0, 36),
        (v?.pageName ? String(v.pageName) : "").slice(0, 150) || null,
        (v?.visualTitle ? String(v.visualTitle) : "").slice(0, 150) || null,
        (v?.visualType ? String(v.visualType) : "").slice(0, 60) || null,
        nama.slice(0, 200),
      ]);
      if (baris.length > MAKS_FIELD_PER_REPORT) {
        return res.status(413).json({ message: "Jumlah field melebihi batas kewarasan" });
      }
    }
  }

  try {
    if (baris.length) {
      await sql.query(
        `INSERT INTO visual_field_usage
           (dashboard_id, report_id, page_name, visual_title, visual_type, field_name)
         VALUES ?
         ON DUPLICATE KEY UPDATE
           report_id = VALUES(report_id),
           visual_type = VALUES(visual_type),
           harvested_at = CURRENT_TIMESTAMP`,
        [baris]
      );
    }
    const [n] = await sql.query(
      "SELECT COUNT(DISTINCT field_name) f, COUNT(*) t FROM visual_field_usage WHERE dashboard_id = ?",
      [dashboardId]
    );
    res.json({
      message: "Inventaris visual tersimpan",
      diterima: baris.length,
      fieldUnik: Number(n[0].f),
      totalBaris: Number(n[0].t),
    });
  } catch (err) {
    console.error("visual-usage error:", err.message);
    res.status(500).json({ message: "Gagal menyimpan inventaris visual" });
  }
});

/**
 * GET /api/summary/harvest-status
 *
 * Perpotongan inventaris visual dengan daftar measure model. Inilah angka yang
 * menentukan apakah katalog KPI boleh dibangun.
 *
 * Perlu diingat saat membaca angkanya: exportData mengembalikan nama TAMPILAN
 * field di visual. Kalau seseorang mengganti nama field di visual, namanya tidak
 * akan cocok dengan nama measure aslinya. Karena itu yang tidak cocok dilaporkan
 * terpisah, bukan dibuang, supaya ketidakcocokan bisa diperiksa.
 */
router.get("/harvest-status", requireAdmin, async (req, res) => {
  try {
    const [[dash]] = await sql.query(
      `SELECT COUNT(*) total,
              SUM(report_id IS NOT NULL AND report_id <> '') bisa_dipanen
         FROM dashboards`
    );
    const [[panen]] = await sql.query(
      `SELECT COUNT(DISTINCT dashboard_id) dashboard, COUNT(DISTINCT field_name) field_unik,
              COUNT(*) baris FROM visual_field_usage`
    );
    // Baris dan nama unik dilaporkan terpisah, dan ini bukan detail kosmetik.
    // Satu measure dengan nama sama muncul di beberapa model, jadi 2289 baris
    // hanya berisi 1666 nama unik. Membandingkan "terlihat di visual", yang
    // dihitung per nama unik, terhadap jumlah baris akan membuat pembacanya
    // menyimpulkan ratusan measure sudah terlihat padahal belum satu pun.
    const [[measure]] = await sql.query(
      `SELECT COUNT(*) baris,
              COUNT(DISTINCT measure_name) nama_unik,
              COUNT(DISTINCT model_name) model
         FROM model_measure`
    );

    // Measure yang benar-benar terlihat di visual. Perbandingan case-insensitive
    // karena nama tampilan dan nama measure sering beda kapitalisasinya saja.
    const [[cocok]] = await sql.query(
      `SELECT COUNT(DISTINCT m.measure_name) n
         FROM model_measure m
         JOIN visual_field_usage v ON LOWER(TRIM(v.field_name)) = LOWER(TRIM(m.measure_name))`
    );
    const [[tanpaVisual]] = await sql.query(
      `SELECT COUNT(DISTINCT m.measure_name) n
         FROM model_measure m
        WHERE NOT EXISTS (
                SELECT 1 FROM visual_field_usage v
                 WHERE LOWER(TRIM(v.field_name)) = LOWER(TRIM(m.measure_name)))`
    );
    const [[bukanMeasure]] = await sql.query(
      `SELECT COUNT(DISTINCT v.field_name) n
         FROM visual_field_usage v
        WHERE NOT EXISTS (
                SELECT 1 FROM model_measure m
                 WHERE LOWER(TRIM(m.measure_name)) = LOWER(TRIM(v.field_name)))`
    );

    res.json({
      dashboard: {
        total: Number(dash.total),
        bisaDipanen: Number(dash.bisa_dipanen),
        sudahDipanen: Number(panen.dashboard),
      },
      measure: {
        // baris > namaUnik karena measure bernama sama ada di beberapa model.
        baris: Number(measure.baris),
        namaUnik: Number(measure.nama_unik),
        model: Number(measure.model),
        // Keduanya dihitung per nama unik, jadi jumlahnya HARUS sama dengan
        // namaUnik. Uji menegaskan kesamaan itu, bukan sekadar batas atas.
        terlihatDiVisual: Number(cocok.n),
        tidakTerlihatDiVisual: Number(tanpaVisual.n),
      },
      field: {
        unik: Number(panen.field_unik),
        baris: Number(panen.baris),
        // Field visual yang bukan measure: kolom dimensi, atau measure yang
        // namanya diganti di visual. Perlu dilihat manual, bukan diabaikan.
        bukanMeasure: Number(bukanMeasure.n),
      },
    });
  } catch (err) {
    console.error("harvest-status error:", err.message);
    res.status(500).json({ message: "Gagal membaca status panen" });
  }
});

export default router;

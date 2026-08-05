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

// ── Manual trigger dan dry-run (spec §15) ───────────────────────────────────
//
// dryRun BAWAANNYA true, dan itu keputusan sadar. Provider baileys sudah
// dipasangkan ke grup manajemen, jadi satu panggilan tanpa penjagaan berarti
// pesan sungguhan terkirim ke grup dan tidak bisa ditarik kembali. Untuk
// mengirim sungguhan, pemanggil harus menulis dryRun: false secara eksplisit.

/** Membaca dryRun dari body. Apa pun selain false eksplisit dianggap dry run. */
function bacaDryRun(body) {
  return body?.dryRun === false ? false : true;
}

/** Tanggal opsional, hanya menerima bentuk YYYY-MM-DD. */
function bacaTanggal(body) {
  const t = String(body?.tanggal || "").trim();
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "TIDAK_SAH";
  return t;
}

/**
 * POST /api/summary/run
 * Menjalankan tahap pengumpulan. Bawaannya dry run.
 */
router.post("/run", requireAdmin, async (req, res) => {
  const tanggal = bacaTanggal(req.body);
  if (tanggal === "TIDAK_SAH") {
    return res.status(400).json({ message: "tanggal harus berformat YYYY-MM-DD" });
  }
  const dryRun = bacaDryRun(req.body);

  try {
    const { kumpulkanTerkunci } = await import("../scheduler/dailySummaryJob.js");
    const hasil = await kumpulkanTerkunci({ dryRun, tanggal, holder: `manual-${req.dbUser?.id ?? "?"}` });

    if (!hasil.dijalankan) {
      // 409, bukan 500: job lain sedang jalan adalah keadaan yang sah dan
      // pemanggil hanya perlu menunggu, bukan melaporkan kerusakan.
      return res.status(409).json({ message: "Job lain sedang berjalan", alasan: hasil.alasan });
    }
    res.json({ message: dryRun ? "Dry run selesai, tidak ada yang disimpan atau dikirim" : "Pengumpulan selesai", ...hasil.hasil });
  } catch (err) {
    console.error("summary run error:", err);
    res.status(500).json({ message: "Gagal menjalankan pengumpulan", error: String(err.message).slice(0, 200) });
  }
});

/**
 * POST /api/summary/send
 * Mengirim hasil yang sudah tervalidasi. Bawaannya dry run.
 */
router.post("/send", requireAdmin, async (req, res) => {
  const tanggal = bacaTanggal(req.body);
  if (tanggal === "TIDAK_SAH") {
    return res.status(400).json({ message: "tanggal harus berformat YYYY-MM-DD" });
  }
  const dryRun = bacaDryRun(req.body);

  try {
    const { kirimTerkunci } = await import("../scheduler/dailySummaryJob.js");
    const hasil = await kirimTerkunci({ dryRun, tanggal, holder: `manual-${req.dbUser?.id ?? "?"}` });

    if (!hasil.dijalankan) {
      return res.status(409).json({ message: "Job lain sedang berjalan", alasan: hasil.alasan });
    }
    res.json({
      message: dryRun ? "Dry run selesai, pesan TIDAK dikirim" : "Pengiriman diproses",
      ...hasil.hasil,
    });
  } catch (err) {
    console.error("summary send error:", err);
    res.status(500).json({ message: "Gagal menjalankan pengiriman", error: String(err.message).slice(0, 200) });
  }
});

/**
 * POST /api/summary/run-and-send
 *
 * Satu tombol: olah data lalu kirim ke grup. Digabung di server, bukan dirangkai
 * dari UI, karena rangkaian di UI bisa terputus di tengah, misalnya tab ditutup
 * setelah pengumpulan selesai tapi sebelum pengiriman. Hasilnya laporan
 * tersimpan tanpa terkirim dan tidak ada yang tahu.
 *
 * dryRun tetap BAWAANNYA true, sama seperti /run dan /send. Tombol di UI
 * mengirim dryRun false secara eksplisit setelah admin mengonfirmasi.
 *
 * `paksaKirimUlang` diperlukan karena idempotensi menolak pengiriman kedua untuk
 * tanggal yang sama. Tanpa itu, admin yang menekan tombol setelah laporan
 * terkirim otomatis akan mendapat "sudah terkirim" dan menyangka tombolnya rusak.
 */
router.post("/run-and-send", requireAdmin, async (req, res) => {
  const tanggal = bacaTanggal(req.body);
  if (tanggal === "TIDAK_SAH") {
    return res.status(400).json({ message: "tanggal harus berformat YYYY-MM-DD" });
  }
  const dryRun = bacaDryRun(req.body);
  const paksaKirimUlang = req.body?.paksaKirimUlang === true;
  const holder = `manual-${req.dbUser?.id ?? "?"}`;

  try {
    const { kumpulkanTerkunci, kirimTerkunci } = await import("../scheduler/dailySummaryJob.js");
    const { batalkanTerkirim } = await import("../services/historicalStore.service.js");
    const { jendelaLaporan } = await import("../utils/dateWindow.util.js");

    const kumpul = await kumpulkanTerkunci({ dryRun, tanggal, holder });
    if (!kumpul.dijalankan) {
      return res.status(409).json({ message: "Job lain sedang berjalan", alasan: kumpul.alasan });
    }

    const tgl = tanggal || jendelaLaporan().tanggal;
    if (!dryRun && paksaKirimUlang) await batalkanTerkirim(tgl);

    const kirim = await kirimTerkunci({ dryRun, tanggal, holder });
    if (!kirim.dijalankan) {
      return res.status(409).json({
        message: "Pengumpulan selesai tapi pengiriman terhalang job lain",
        pengumpulan: kumpul.hasil,
        alasan: kirim.alasan,
      });
    }

    res.json({
      message: dryRun
        ? "Dry run selesai. Data diolah, pesan TIDAK dikirim."
        : "Data diolah dan pesan dikirim ke grup.",
      dryRun,
      tanggalLaporan: tgl,
      pengumpulan: kumpul.hasil,
      pengiriman: kirim.hasil,
    });
  } catch (err) {
    console.error("run-and-send error:", err);
    res.status(500).json({ message: "Gagal menjalankan olah dan kirim", error: String(err.message).slice(0, 200) });
  }
});

/**
 * GET /api/summary/job-status
 * Keadaan scheduler, kunci, konfigurasi pengiriman, dan hasil terakhir.
 */
router.get("/job-status", requireAdmin, async (req, res) => {
  try {
    const { statusScheduler } = await import("../config/scheduler.js");
    const { statusKunci } = await import("../scheduler/jobLock.js");
    const { JOB_KUMPUL, JOB_KIRIM } = await import("../scheduler/dailySummaryJob.js");
    const { konfigurasi } = await import("../services/whatsapp.service.js");
    const { ambilHasil, mingguBelumBeku } = await import("../services/historicalStore.service.js");
    const { jendelaLaporan } = await import("../utils/dateWindow.util.js");
    const { tujuanAlert } = await import("../services/alerting.service.js");
    const { statusListener } = await import("../services/whatsappListener.service.js");

    const tgl = jendelaLaporan().tanggal;
    const cfg = konfigurasi();

    res.json({
      scheduler: statusScheduler(),
      kunci: {
        kumpul: await statusKunci(JOB_KUMPUL),
        kirim: await statusKunci(JOB_KIRIM),
      },
      pengiriman: {
        provider: cfg.provider,
        targetMode: cfg.targetMode,
        siap: cfg.siap,
        masalah: cfg.masalah,
        // Group id disamarkan: endpoint ini dibaca dari browser dan id grup
        // cukup untuk mengirim pesan bila providernya sudah dipasangkan.
        groupId: cfg.groupId ? `${cfg.groupId.slice(0, 4)}...@g.us` : null,
        jumlahNomor: cfg.daftarNomor.length,
      },
      alert: { tujuan: tujuanAlert().length },
      listenerWhatsApp: statusListener(),
      hariLaporan: tgl,
      hasilTerakhir: await ambilHasil(tgl),
      mingguBelumBeku: await mingguBelumBeku(),
    });
  } catch (err) {
    console.error("job-status error:", err);
    res.status(500).json({ message: "Gagal membaca status job" });
  }
});

export default router;

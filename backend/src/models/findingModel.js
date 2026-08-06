// ─────────────────────────────────────────────────────────────────────────────
// Akses data temuan lintas dashboard.
//
// Hanya bicara SQL. Penyusunan prompt ada di findingDistiller.js dan
// findingContext.js, supaya masing-masing bisa diuji tanpa menyentuh yang lain.
// ─────────────────────────────────────────────────────────────────────────────

import db from "../config/db.js";

const sql = db.promise();

/** Jendela bawaan. Bisa diubah lewat env bila kebiasaan kerja berbeda. */
export const JAM_JENDELA = Number(process.env.AI_FINDING_WINDOW_HOURS) || 12;
export const MAKS_DASHBOARD = Number(process.env.AI_FINDING_MAX_DASHBOARDS) || 4;
export const RINGKASAN_MAKS = 400;
export const BELUM_TERJAWAB_MAKS = 300;

/**
 * mysql2 mengembalikan kolom JSON sebagai objek terparse pada versi tertentu dan
 * string pada versi lain. Menganggapnya selalu objek gagal di lingkungan yang
 * berbeda dari mesin pengembang.
 */
function bacaJson(nilai) {
  if (nilai === null || nilai === undefined) return [];
  if (typeof nilai === "object") return nilai;
  try {
    return JSON.parse(nilai);
  } catch {
    return [];
  }
}

/**
 * Menyimpan atau menyegarkan temuan satu dashboard.
 *
 * Teks dipangkas di sini, bukan dibiarkan MySQL memotongnya. MySQL di mode
 * non-strict memotong diam-diam, dan ringkasan yang terpotong di tengah kalimat
 * akan terbaca sebagai temuan yang memang berakhir di situ.
 */
export async function simpanTemuan({
  userId, dashboardId, ringkasan, angka, belumTerjawab, turnTerakhir,
}) {
  const r = String(ringkasan || "").slice(0, RINGKASAN_MAKS);
  if (!r.trim()) return { disimpan: false };

  await sql.query(
    `INSERT INTO ai_finding
       (user_id, dashboard_id, ringkasan, angka_json, belum_terjawab, turn_terakhir)
     VALUES (?, ?, ?, CAST(? AS JSON), ?, ?)
     ON DUPLICATE KEY UPDATE
       ringkasan = VALUES(ringkasan),
       angka_json = VALUES(angka_json),
       belum_terjawab = VALUES(belum_terjawab),
       turn_terakhir = VALUES(turn_terakhir)`,
    [
      Number(userId), Number(dashboardId), r,
      JSON.stringify(Array.isArray(angka) ? angka : []),
      belumTerjawab ? String(belumTerjawab).slice(0, BELUM_TERJAWAB_MAKS) : null,
      Number(turnTerakhir) || 0,
    ]
  );
  return { disimpan: true };
}

/**
 * Temuan yang masih dalam jendela, terbaru lebih dulu.
 *
 * Umur dihitung di SQL lewat TIMESTAMPDIFF, bukan di JavaScript dari kolom
 * DATETIME. Kolom DATETIME yang dibaca driver lalu dibandingkan dengan waktu
 * proses sudah dua kali menggeser hasil sehari di proyek ini.
 */
export async function temuanAktif(
  userId,
  { jamKebelakang = JAM_JENDELA, maksDashboard = MAKS_DASHBOARD } = {}
) {
  const [rows] = await sql.query(
    `SELECT f.dashboard_id, f.ringkasan, f.angka_json, f.belum_terjawab,
            TIMESTAMPDIFF(MINUTE, f.disegarkan_pada, NOW()) AS umur_menit,
            d.title AS dashboard_title
       FROM ai_finding f
       LEFT JOIN dashboards d ON d.id = f.dashboard_id
      WHERE f.user_id = ?
        AND f.disegarkan_pada >= DATE_SUB(NOW(), INTERVAL ? HOUR)
      ORDER BY f.disegarkan_pada DESC
      LIMIT ?`,
    [Number(userId), Number(jamKebelakang), Number(maksDashboard)]
  );

  return rows.map((r) => ({
    dashboardId: r.dashboard_id,
    dashboardTitle: r.dashboard_title || `Dashboard #${r.dashboard_id}`,
    ringkasan: r.ringkasan,
    angka: bacaJson(r.angka_json),
    belumTerjawab: r.belum_terjawab,
    umurJam: Math.round((Number(r.umur_menit) / 60) * 10) / 10,
  }));
}

/** id putaran terakhir yang sudah tersaring, 0 bila belum pernah. */
export async function turnTerakhirTersaring(userId, dashboardId) {
  const [[r]] = await sql.query(
    "SELECT turn_terakhir FROM ai_finding WHERE user_id = ? AND dashboard_id = ?",
    [Number(userId), Number(dashboardId)]
  );
  return r ? Number(r.turn_terakhir) : 0;
}

/** Menghapus temuan satu dashboard. Dipakai user yang ingin melupakan konteks. */
export async function hapusTemuan(userId, dashboardId) {
  const [r] = await sql.query(
    "DELETE FROM ai_finding WHERE user_id = ? AND dashboard_id = ?",
    [Number(userId), Number(dashboardId)]
  );
  return r.affectedRows;
}

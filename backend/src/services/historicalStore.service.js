// ─────────────────────────────────────────────────────────────────────────────
// Penyimpanan riwayat KPI harian (spec §11).
//
// Pembanding "vs kemarin", "vs rata-rata 7 hari", dan tren bulanan dihitung dari
// tabel ini, BUKAN dengan query ulang ke Power BI setiap hari. Selain hemat, ini
// juga satu-satunya cara pembandingnya konsisten: angka Power BI untuk tanggal
// lampau bisa berubah setelah refresh berikutnya, jadi membandingkan hari ini
// dengan hasil query hari ini untuk kemarin bukan perbandingan yang stabil.
//
// Perhitungan agregat dilakukan di JavaScript, bukan di SQL. kpi_json bersarang
// dan berisi beberapa varian measure per KPI; memaksakannya ke fungsi JSON MySQL
// menghasilkan query yang tidak bisa dibaca siapa pun dan sulit diuji.
// ─────────────────────────────────────────────────────────────────────────────

import db from "../config/db.js";

const sql = db.promise();

/**
 * @typedef {object} NilaiKpi
 * @property {string} kpi
 * @property {string} status      confirmed | needs_confirmation | blocked
 * @property {string} unit
 * @property {Array<{measure: string, value: number|null}>} values
 */

/**
 * Menyimpan snapshot satu domain untuk satu tanggal.
 *
 * Upsert per (tanggal, domain). Menjalankan ulang job untuk tanggal yang sama
 * menimpa snapshot domain itu, tidak menambah baris kedua, sehingga rata-rata
 * 7 hari tidak menghitung satu hari dua kali.
 */
export async function simpanSnapshot(tanggal, domain, kpi, freshness, cutoffWib = null) {
  await sql.query(
    `INSERT INTO daily_summary_snapshot (report_date, domain, kpi_json, data_freshness, cutoff_wib)
     VALUES (?, ?, CAST(? AS JSON), ?, ?)
     ON DUPLICATE KEY UPDATE
       kpi_json = VALUES(kpi_json),
       data_freshness = VALUES(data_freshness),
       cutoff_wib = VALUES(cutoff_wib)`,
    [tanggal, domain, JSON.stringify(kpi ?? []), freshness, cutoffWib]
  );
}

/** Semua snapshot untuk satu tanggal, per domain. */
export async function ambilSnapshot(tanggal) {
  const [rows] = await sql.query(
    `SELECT domain, kpi_json, data_freshness, cutoff_wib
       FROM daily_summary_snapshot WHERE report_date = ?`,
    [tanggal]
  );
  return rows.map((r) => ({
    domain: r.domain,
    kpi: bacaJson(r.kpi_json),
    freshness: r.data_freshness,
    cutoffWib: r.cutoff_wib,
  }));
}

/**
 * mysql2 mengembalikan kolom JSON sebagai objek yang sudah diparse pada versi
 * tertentu, dan sebagai string pada versi lain. Menganggapnya selalu objek akan
 * gagal di lingkungan yang berbeda dari mesin pengembang.
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
 * Kolom DATE dari MySQL menjadi string YYYY-MM-DD.
 *
 * WAJIB memakai komponen lokal, bukan toISOString(). Kolom DATE tidak punya zona
 * waktu, dan mysql2 membangunnya sebagai Date pada tengah malam waktu LOKAL.
 * Di server WIB, toISOString() menggeser tujuh jam ke belakang sehingga
 * 2019-01-14 terbaca 2019-01-13, dan pembanding "vs kemarin" tidak pernah
 * menemukan barisnya. Kegagalannya senyap: hasilnya null, seolah datanya
 * memang tidak ada.
 */
function tanggalDariBaris(nilai) {
  if (nilai instanceof Date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${nilai.getFullYear()}-${p(nilai.getMonth() + 1)}-${p(nilai.getDate())}`;
  }
  return String(nilai).slice(0, 10);
}

/** Tanggal YYYY-MM-DD digeser n hari ke belakang. */
function geserHari(tanggal, n) {
  const [y, m, d] = String(tanggal).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - n);
  return t.toISOString().slice(0, 10);
}

/**
 * Meratakan snapshot jadi peta kunci datar, supaya pembandingnya bisa dihitung
 * per measure. Kunci: domain|kpi|measure.
 */
function ratakan(snapshots) {
  const peta = new Map();
  for (const s of snapshots || []) {
    for (const k of s.kpi || []) {
      for (const v of k.values || []) {
        if (typeof v.value !== "number" || Number.isNaN(v.value)) continue;
        peta.set(`${s.domain}|${k.kpi}|${v.measure}`, v.value);
      }
    }
  }
  return peta;
}

/**
 * Pembanding untuk satu tanggal laporan.
 *
 * Rata-rata 7 hari dihitung dari hari yang BENAR-BENAR ada datanya, dan jumlah
 * harinya dilaporkan lewat `hariTersedia`. Membagi dengan 7 padahal cuma ada 3
 * hari data akan menghasilkan rata-rata yang terlalu rendah, dan spec §6 menuntut
 * ketidakcukupan bukti disebut eksplisit alih-alih ditutupi.
 *
 * @param {string} tanggal
 * @returns {Promise<Map<string, {kemarin: number|null, avg7: number|null, hariTersedia: number, tren30: number|null}>>}
 */
export async function pembanding(tanggal) {
  const awal30 = geserHari(tanggal, 30);
  const [rows] = await sql.query(
    `SELECT report_date, domain, kpi_json FROM daily_summary_snapshot
      WHERE report_date < ? AND report_date >= ?
      ORDER BY report_date DESC`,
    [tanggal, awal30]
  );

  const perTanggal = new Map();
  for (const r of rows) {
    const kunci = tanggalDariBaris(r.report_date);
    if (!perTanggal.has(kunci)) perTanggal.set(kunci, []);
    perTanggal.get(kunci).push({ domain: r.domain, kpi: bacaJson(r.kpi_json) });
  }

  const kemarinKey = geserHari(tanggal, 1);
  const petaKemarin = ratakan(perTanggal.get(kemarinKey) || []);

  // Kumpulkan nilai per kunci untuk 7 dan 30 hari.
  const kumpul7 = new Map();
  const kumpul30 = new Map();
  for (const [tgl, snaps] of perTanggal) {
    const selisih = Math.round(
      (Date.parse(`${tanggal}T00:00:00Z`) - Date.parse(`${tgl}T00:00:00Z`)) / 86_400_000
    );
    const peta = ratakan(snaps);
    for (const [k, v] of peta) {
      if (selisih <= 7) {
        if (!kumpul7.has(k)) kumpul7.set(k, []);
        kumpul7.get(k).push(v);
      }
      if (!kumpul30.has(k)) kumpul30.set(k, []);
      kumpul30.get(k).push(v);
    }
  }

  const hasil = new Map();
  const semuaKunci = new Set([...petaKemarin.keys(), ...kumpul7.keys(), ...kumpul30.keys()]);
  for (const k of semuaKunci) {
    const n7 = kumpul7.get(k) || [];
    const n30 = kumpul30.get(k) || [];
    hasil.set(k, {
      kemarin: petaKemarin.has(k) ? petaKemarin.get(k) : null,
      avg7: n7.length ? n7.reduce((a, b) => a + b, 0) / n7.length : null,
      hariTersedia: n7.length,
      tren30: n30.length ? n30.reduce((a, b) => a + b, 0) / n30.length : null,
    });
  }
  return hasil;
}

// ── Snapshot mingguan ───────────────────────────────────────────────────────

/**
 * Menyimpan atau menyegarkan snapshot mingguan satu domain.
 *
 * Menolak menulis ke minggu yang SUDAH DIBEKUKAN. Itu inti dari pembekuan: kalau
 * penulisan tetap diizinkan, angka yang sudah dipakai laporan bisa berubah
 * berhari-hari kemudian dan tidak ada yang tahu laporan mana yang memakai angka
 * mana.
 *
 * @returns {Promise<{disimpan: boolean, alasan?: string, pullCount?: number}>}
 */
export async function simpanSnapshotMingguan(minggu, domain, kpi, freshness, cutoffWib = null) {
  const [[ada]] = await sql.query(
    "SELECT frozen, pull_count FROM weekly_summary_snapshot WHERE week_start = ? AND domain = ?",
    [minggu.mulaiTanggal, domain]
  );

  if (ada && Number(ada.frozen) === 1) {
    return { disimpan: false, alasan: "minggu sudah dibekukan", pullCount: Number(ada.pull_count) };
  }

  await sql.query(
    `INSERT INTO weekly_summary_snapshot
       (week_start, week_end, domain, kpi_json, data_freshness, cutoff_wib, pull_count)
     VALUES (?, ?, ?, CAST(? AS JSON), ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       week_end = VALUES(week_end),
       kpi_json = VALUES(kpi_json),
       data_freshness = VALUES(data_freshness),
       cutoff_wib = VALUES(cutoff_wib),
       pull_count = pull_count + 1`,
    [
      minggu.mulaiTanggal, minggu.selesaiTanggal, domain,
      JSON.stringify(kpi ?? []), freshness, cutoffWib,
    ]
  );

  const [[sesudah]] = await sql.query(
    "SELECT pull_count FROM weekly_summary_snapshot WHERE week_start = ? AND domain = ?",
    [minggu.mulaiTanggal, domain]
  );
  return { disimpan: true, pullCount: Number(sesudah?.pull_count || 1) };
}

/** Snapshot mingguan satu minggu, per domain. */
export async function ambilSnapshotMingguan(mulaiTanggal) {
  const [rows] = await sql.query(
    `SELECT week_start, week_end, domain, kpi_json, data_freshness, cutoff_wib,
            frozen, frozen_at, pull_count, refreshed_at
       FROM weekly_summary_snapshot WHERE week_start = ?`,
    [mulaiTanggal]
  );
  return rows.map((r) => ({
    mulaiTanggal: tanggalDariBaris(r.week_start),
    selesaiTanggal: tanggalDariBaris(r.week_end),
    domain: r.domain,
    kpi: bacaJson(r.kpi_json),
    freshness: r.data_freshness,
    cutoffWib: r.cutoff_wib,
    frozen: Boolean(Number(r.frozen)),
    frozenAt: r.frozen_at,
    pullCount: Number(r.pull_count),
    refreshedAt: r.refreshed_at,
  }));
}

/**
 * Membekukan semua minggu yang sudah lewat sepenuhnya.
 *
 * Batasnya `week_end < batasTanggal`, dan batasTanggal adalah hari pertama minggu
 * berjalan. Minggu yang masih berjalan TIDAK ikut, karena datanya masih bergerak.
 *
 * Pembekuan tidak menghapus apa pun dan tidak mengubah angka; ia hanya menutup
 * pintu penulisan berikutnya.
 *
 * @returns {Promise<{dibekukan: number}>}
 */
export async function bekukanMingguLewat(batasTanggal) {
  const [hasil] = await sql.query(
    `UPDATE weekly_summary_snapshot
        SET frozen = 1, frozen_at = NOW()
      WHERE frozen = 0 AND week_end < ?`,
    [batasTanggal]
  );
  return { dibekukan: hasil.affectedRows };
}

/** Minggu yang masih boleh disegarkan, untuk log dan diagnosis. */
export async function mingguBelumBeku() {
  const [rows] = await sql.query(
    `SELECT week_start, week_end, COUNT(*) domain_count, MIN(pull_count) pull_min,
            MAX(pull_count) pull_max
       FROM weekly_summary_snapshot WHERE frozen = 0
      GROUP BY week_start, week_end ORDER BY week_start`
  );
  return rows.map((r) => ({
    mulaiTanggal: tanggalDariBaris(r.week_start),
    selesaiTanggal: tanggalDariBaris(r.week_end),
    jumlahDomain: Number(r.domain_count),
    pullMin: Number(r.pull_min),
    pullMax: Number(r.pull_max),
  }));
}

/** Menyimpan atau memperbarui hasil AI untuk satu tanggal. */
export async function simpanHasil(tanggal, data) {
  await sql.query(
    `INSERT INTO daily_summary_result
       (report_date, ai_summary_text, gemini_model_version, prompt_version,
        validation_passed, validation_note, is_fallback)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       ai_summary_text = VALUES(ai_summary_text),
       gemini_model_version = VALUES(gemini_model_version),
       prompt_version = VALUES(prompt_version),
       validation_passed = VALUES(validation_passed),
       validation_note = VALUES(validation_note),
       is_fallback = VALUES(is_fallback)`,
    [
      tanggal,
      data?.text ?? null,
      data?.modelVersion ?? null,
      data?.promptVersion ?? null,
      data?.validationPassed ? 1 : 0,
      data?.validationNote ? String(data.validationNote).slice(0, 500) : null,
      data?.isFallback ? 1 : 0,
    ]
  );
}

export async function ambilHasil(tanggal) {
  const [[r]] = await sql.query(
    "SELECT * FROM daily_summary_result WHERE report_date = ?",
    [tanggal]
  );
  if (!r) return null;
  return {
    tanggal,
    text: r.ai_summary_text,
    modelVersion: r.gemini_model_version,
    promptVersion: r.prompt_version,
    validationPassed: Boolean(r.validation_passed),
    validationNote: r.validation_note,
    isFallback: Boolean(r.is_fallback),
    whatsappSent: Boolean(r.whatsapp_sent),
    whatsappSentAt: r.whatsapp_sent_at,
  };
}

/**
 * Menandai laporan sudah terkirim, sekali saja.
 *
 * Klausa `AND whatsapp_sent = 0` yang membuat ini idempoten: pemanggil kedua
 * mendapat false, jadi pengirim bisa MENANDAI LEBIH DULU lalu mengirim, dan dua
 * proses yang berlomba tidak mungkin keduanya mengirim.
 *
 * @returns {Promise<boolean>} true bila pemanggil ini yang berhasil menandai
 */
export async function tandaiTerkirim(tanggal) {
  const [hasil] = await sql.query(
    `UPDATE daily_summary_result
        SET whatsapp_sent = 1, whatsapp_sent_at = NOW()
      WHERE report_date = ? AND whatsapp_sent = 0`,
    [tanggal]
  );
  return hasil.affectedRows === 1;
}

/** Membatalkan penandaan bila pengiriman ternyata gagal. */
export async function batalkanTerkirim(tanggal) {
  await sql.query(
    `UPDATE daily_summary_result
        SET whatsapp_sent = 0, whatsapp_sent_at = NULL
      WHERE report_date = ?`,
    [tanggal]
  );
}

/**
 * Membuang snapshot dan hasil yang lebih tua dari batas retensi (spec §11).
 * Bawaannya 90 hari, cukup untuk tren bulanan.
 */
export async function bersihkanRiwayat(hari = Number(process.env.HISTORICAL_STORE_RETENTION_DAYS) || 90) {
  const [a] = await sql.query(
    "DELETE FROM daily_summary_snapshot WHERE report_date < DATE_SUB(CURDATE(), INTERVAL ? DAY)",
    [hari]
  );
  const [b] = await sql.query(
    "DELETE FROM daily_summary_result WHERE report_date < DATE_SUB(CURDATE(), INTERVAL ? DAY)",
    [hari]
  );
  return { snapshotDihapus: a.affectedRows, hasilDihapus: b.affectedRows };
}

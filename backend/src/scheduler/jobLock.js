// ─────────────────────────────────────────────────────────────────────────────
// Kunci konkurensi job, disimpan di database.
//
// Kenapa di database dan bukan variabel modul: job pengumpul jalan 06:15 dan job
// pengirim jalan 08:00. Restart server di antara keduanya akan menghapus state
// di memori tanpa jejak, dan job bisa jalan dobel sehingga laporan terkirim dua
// kali. Spec §4.2 menuntut idempotensi, dan idempotensi yang bersandar pada
// memori proses bukan idempotensi.
//
// Kunci punya masa kedaluwarsa. Proses yang mati saat memegang kunci tidak boleh
// memblokir job besok, dan itu bukan skenario teoretis: satu crash tanpa
// kedaluwarsa berarti fitur ini mati permanen sampai ada yang menghapus barisnya
// secara manual di database.
// ─────────────────────────────────────────────────────────────────────────────

import db from "../config/db.js";

const sql = db.promise();

/** Masa berlaku bawaan. Cukup panjang untuk 25 model, cukup pendek untuk pulih. */
export const TTL_BAWAAN_MS = 30 * 60 * 1000;

/**
 * Mencoba mengambil kunci.
 *
 * Atomik, dan itu inti dari fungsi ini. Membaca dulu lalu menulis akan lolos
 * ketika dua proses membaca pada saat yang sama: keduanya melihat kunci kosong
 * dan keduanya merasa berhasil. Karena itu urutannya INSERT lebih dulu, dan
 * kegagalan duplikat ditangani dengan UPDATE bersyarat yang hanya mengenai baris
 * yang sudah kedaluwarsa. Keduanya operasi tunggal, jadi tidak ada celah.
 *
 * @param {string} jobName
 * @param {{ttlMs?: number, holder?: string, reportDate?: string|null}} [opsi]
 * @returns {Promise<{didapat: boolean, alasan?: string, dipegangSampai?: Date}>}
 */
export async function ambilKunci(jobName, opsi = {}) {
  const ttl = Number(opsi.ttlMs) > 0 ? Number(opsi.ttlMs) : TTL_BAWAAN_MS;
  const detik = Math.ceil(ttl / 1000);
  const holder = String(opsi.holder || `pid-${process.pid}`).slice(0, 120);
  const reportDate = opsi.reportDate || null;

  try {
    await sql.query(
      `INSERT INTO daily_summary_lock (job_name, locked_at, expires_at, holder, report_date)
       VALUES (?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND), ?, ?)`,
      [jobName, detik, holder, reportDate]
    );
    return { didapat: true };
  } catch (err) {
    if (err?.code !== "ER_DUP_ENTRY") throw err;
  }

  // Baris sudah ada. Hanya boleh direbut kalau memang sudah kedaluwarsa.
  const [hasil] = await sql.query(
    `UPDATE daily_summary_lock
        SET locked_at = NOW(),
            expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
            holder = ?,
            report_date = ?
      WHERE job_name = ? AND expires_at <= NOW()`,
    [detik, holder, reportDate, jobName]
  );

  if (hasil.affectedRows === 1) {
    return { didapat: true, alasan: "kunci sebelumnya sudah kedaluwarsa" };
  }

  const [[baris]] = await sql.query(
    "SELECT holder, expires_at FROM daily_summary_lock WHERE job_name = ?",
    [jobName]
  );
  return {
    didapat: false,
    alasan: `masih dipegang ${baris?.holder || "proses lain"}`,
    dipegangSampai: baris?.expires_at,
  };
}

/**
 * Melepas kunci.
 *
 * Hanya melepas kunci milik holder yang sama bila holder disebut. Tanpa syarat
 * itu, job yang lambat bisa melepas kunci yang sudah direbut proses lain setelah
 * kedaluwarsa, dan proses ketiga langsung masuk.
 */
export async function lepasKunci(jobName, holder = null) {
  const [hasil] = holder
    ? await sql.query("DELETE FROM daily_summary_lock WHERE job_name = ? AND holder = ?", [jobName, holder])
    : await sql.query("DELETE FROM daily_summary_lock WHERE job_name = ?", [jobName]);
  return hasil.affectedRows === 1;
}

/** Keadaan kunci saat ini, untuk log dan diagnosis. */
export async function statusKunci(jobName) {
  const [[baris]] = await sql.query(
    `SELECT job_name, locked_at, expires_at, holder, report_date,
            (expires_at <= NOW()) AS kedaluwarsa
       FROM daily_summary_lock WHERE job_name = ?`,
    [jobName]
  );
  if (!baris) return { ada: false };
  return {
    ada: true,
    holder: baris.holder,
    lockedAt: baris.locked_at,
    expiresAt: baris.expires_at,
    reportDate: baris.report_date,
    kedaluwarsa: Boolean(Number(baris.kedaluwarsa)),
  };
}

/**
 * Menjalankan fungsi di bawah kunci, lalu melepasnya apa pun yang terjadi.
 *
 * Pelepasan di blok finally, bukan setelah fn() selesai: fn() yang melempar akan
 * meninggalkan kunci terpegang sampai kedaluwarsa, dan job berikutnya tertunda
 * setengah jam tanpa alasan yang terlihat.
 *
 * @template T
 * @param {string} jobName
 * @param {() => Promise<T>} fn
 * @param {{ttlMs?: number, holder?: string, reportDate?: string|null}} [opsi]
 * @returns {Promise<{dijalankan: boolean, hasil?: T, alasan?: string}>}
 */
export async function denganKunci(jobName, fn, opsi = {}) {
  const holder = String(opsi.holder || `pid-${process.pid}`).slice(0, 120);
  const kunci = await ambilKunci(jobName, { ...opsi, holder });

  if (!kunci.didapat) return { dijalankan: false, alasan: kunci.alasan };

  try {
    const hasil = await fn();
    return { dijalankan: true, hasil };
  } finally {
    await lepasKunci(jobName, holder);
  }
}

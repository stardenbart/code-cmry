// Setelan laporan performa harian, satu baris dikunci id = 1.
//
// Dibaca scheduler pada SETIAP detak, bukan sekali saat proses menyala. Itu
// syarat utamanya: setelan yang diubah admin lewat website harus berlaku tanpa
// restart.
import db from "../config/db.js";
import { bersihkanSetelan } from "../services/reportSchedule.js";

const sql = db.promise();

/** Nilai yang dipakai bila barisnya belum ada, misalnya migrasi belum jalan. */
const BAWAAN = {
  aktif: false,
  frekuensi: "daily",
  jam: 8,
  menit: 0,
  hari: 1,
  provider: "gemini",
  grupJid: "",
  terakhirJalan: null,
  diubahOleh: null,
  diubahPada: null,
};

/**
 * Setelan sekarang.
 *
 * Tidak melempar bila tabelnya belum ada: scheduler memanggil ini tiap menit,
 * dan melempar di sana berarti satu migrasi yang belum dijalankan membanjiri log
 * dengan error tiap menit alih-alih sekadar tidak menjadwalkan apa pun.
 *
 * @returns {Promise<object>}
 */
export async function ambilSetelan() {
  try {
    const [rows] = await sql.query(
      `SELECT aktif, frekuensi, jam, menit, hari, provider, grup_jid,
              terakhir_jalan, diubah_oleh, diubah_pada
         FROM report_setting WHERE id = 1`
    );
    const r = rows[0];
    if (!r) return { ...BAWAAN };

    return {
      aktif: Boolean(Number(r.aktif)),
      frekuensi: r.frekuensi,
      jam: Number(r.jam),
      menit: Number(r.menit),
      hari: Number(r.hari),
      provider: r.provider,
      grupJid: r.grup_jid || "",
      // Kolom DATETIME dikembalikan sebagai Date oleh driver dan dipakai APA
      // ADANYA untuk selisih waktu. Tidak pernah lewat toISOString: itu sudah
      // dua kali menggeser hasil sehari di proyek ini.
      terakhirJalan: r.terakhir_jalan || null,
      diubahOleh: r.diubah_oleh,
      diubahPada: r.diubah_pada,
    };
  } catch (err) {
    console.warn("[report] gagal membaca setelan, memakai bawaan:", err?.message || err);
    return { ...BAWAAN };
  }
}

/**
 * Menyimpan setelan sesudah divalidasi.
 *
 * @param {object} mentah
 * @param {number} [userId]
 * @returns {Promise<{disimpan: boolean, alasan?: string, nilai?: object}>}
 */
export async function simpanSetelan(mentah, userId) {
  const { sah, alasan, nilai } = bersihkanSetelan(mentah);
  if (!sah) return { disimpan: false, alasan };

  await sql.query(
    `INSERT INTO report_setting (id, aktif, frekuensi, jam, menit, hari, provider, grup_jid, diubah_oleh)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       aktif = VALUES(aktif), frekuensi = VALUES(frekuensi), jam = VALUES(jam),
       menit = VALUES(menit), hari = VALUES(hari), provider = VALUES(provider),
       grup_jid = VALUES(grup_jid), diubah_oleh = VALUES(diubah_oleh)`,
    [
      nilai.aktif ? 1 : 0,
      nilai.frekuensi,
      nilai.jam,
      nilai.menit,
      nilai.hari,
      nilai.provider,
      nilai.grupJid,
      userId || null,
    ]
  );

  return { disimpan: true, nilai };
}

/**
 * Menandai jadwal baru saja dijalankan.
 *
 * Waktunya diambil dari NOW() milik database, BUKAN dari jam proses. Kalau
 * kelak ada dua proses backend, keduanya membandingkan jarak waktu terhadap jam
 * yang sama, dan penjaga jalan ganda tetap berlaku lintas proses.
 */
export async function tandaiDijalankan() {
  await sql.query("UPDATE report_setting SET terakhir_jalan = NOW() WHERE id = 1");
}

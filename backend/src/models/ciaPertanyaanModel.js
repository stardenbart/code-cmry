// Catatan pertanyaan yang belum bisa dijawab CIA.
//
// Ini yang membuat kalimat "sudah saya catat supaya cakupan datanya ditambah"
// menjadi benar. Kalau pencatatannya gagal, balasannya TIDAK menyebut janji itu,
// jadi bot tidak pernah mengucapkan sesuatu yang tidak terjadi.
import db from "../config/db.js";

const sql = db.promise();

const PERTANYAAN_MAKS = 400;

/**
 * Mencatat satu pertanyaan yang belum terjawab.
 *
 * Dipotong di kode, bukan dibiarkan MySQL memotongnya: pada mode non-strict
 * MySQL memotong diam-diam dan tidak ada yang tahu teksnya sudah tidak utuh.
 *
 * @param {object} arg
 * @param {string} arg.groupJid
 * @param {string} arg.pertanyaan
 * @param {"di_luar_konteks"|"tidak_lengkap"} [arg.jenis]
 * @returns {Promise<{dicatat: boolean}>}
 */
export async function catatPertanyaan({ groupJid, pertanyaan, jenis = "di_luar_konteks" }) {
  const teks = String(pertanyaan == null ? "" : pertanyaan).trim().slice(0, PERTANYAAN_MAKS);
  if (!teks) return { dicatat: false };

  try {
    await sql.query(
      "INSERT INTO cia_pertanyaan_tercatat (group_jid, pertanyaan, jenis) VALUES (?, ?, ?)",
      [String(groupJid || "").slice(0, 120), teks, String(jenis).slice(0, 24)]
    );
    return { dicatat: true };
  } catch (err) {
    // Gagal mencatat tidak boleh menggagalkan balasan: user bertanya, dan
    // menjawabnya lebih penting daripada mencatatnya.
    console.warn("[CIA] gagal mencatat pertanyaan:", err?.message || err);
    return { dicatat: false };
  }
}

/**
 * Pertanyaan terbaru yang belum terjawab, untuk ditinjau saat memperluas cakupan.
 *
 * @param {{batas?: number, jenis?: string|null}} [opsi]
 * @returns {Promise<Array<{id: number, pertanyaan: string, jenis: string, umurJam: number}>>}
 */
export async function pertanyaanTerbaru({ batas = 50, jenis = null } = {}) {
  // Umur dihitung di SQL lewat TIMESTAMPDIFF. Kolom DATETIME yang dibaca driver
  // lalu dibandingkan dengan waktu proses sudah dua kali menggeser hasil sehari
  // di proyek ini.
  const [rows] = await sql.query(
    `SELECT id, pertanyaan, jenis,
            TIMESTAMPDIFF(MINUTE, dicatat_pada, NOW()) AS umur_menit
       FROM cia_pertanyaan_tercatat
      WHERE (? IS NULL OR jenis = ?)
      ORDER BY dicatat_pada DESC
      LIMIT ?`,
    [jenis, jenis, Number(batas)]
  );

  return rows.map((r) => ({
    id: r.id,
    pertanyaan: r.pertanyaan,
    jenis: r.jenis,
    umurJam: Math.round((Number(r.umur_menit) / 60) * 10) / 10,
  }));
}

/** Membuang catatan. Dipakai uji untuk membersihkan barisnya sendiri. */
export async function hapusPertanyaan(groupJid) {
  await sql.query("DELETE FROM cia_pertanyaan_tercatat WHERE group_jid = ?", [String(groupJid || "")]);
}

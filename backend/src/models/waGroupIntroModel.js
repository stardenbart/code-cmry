// ─────────────────────────────────────────────────────────────────────────────
// Penjaga sekali-sapa untuk perkenalan CIA di grup WhatsApp.
//
// SQL-nya dulu ditulis inline di whatsappListener.service.js. Dipindah ke sini
// supaya bisa diuji langsung ke database tanpa menyalakan socket WhatsApp, dan
// supaya SQL-nya hanya ada di SATU tempat.
// ─────────────────────────────────────────────────────────────────────────────

import db from "../config/db.js";

const sql = db.promise();

/** Apakah grup ini sudah pernah disapa. */
export async function sudahDisapa(groupJid) {
  const [rows] = await sql.query(
    "SELECT group_jid FROM wa_group_intro WHERE group_jid = ?",
    [groupJid]
  );
  return rows.length > 0;
}

/**
 * Menandai grup sebagai sudah disapa.
 *
 * INSERT IGNORE, bukan INSERT biasa: group_jid adalah primary key, jadi
 * menandai grup yang sama dua kali (misalnya karena dua event masuk hampir
 * bersamaan) tidak boleh melempar duplicate-key error. Baris yang tersisa
 * harus tetap satu.
 */
export async function tandaiSudahDisapa(groupJid) {
  await sql.query("INSERT IGNORE INTO wa_group_intro (group_jid) VALUES (?)", [groupJid]);
}

/** Melupakan sapaan grup ini, dipakai uji untuk membersihkan data miliknya sendiri. */
export async function lupakanSapaan(groupJid) {
  await sql.query("DELETE FROM wa_group_intro WHERE group_jid = ?", [groupJid]);
}

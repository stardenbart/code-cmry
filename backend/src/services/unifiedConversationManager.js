// Percakapan CIA lintas dashboard: satu utas per user, bisa banyak utas.
//
// Kolom JSON di MySQL sudah dikembalikan mysql2 sebagai OBJEK, bukan string.
// Versi sebelumnya memanggil JSON.parse atasnya; diukur 2026-08-18, itu
// melempar `"[object Object]" is not valid JSON` begitu ada satu baris
// tersimpan. Jadi tidak ada JSON.parse di berkas ini, dan tidak boleh ada.
import db from "../config/db.js";

const sql = db.promise();

// Atap penyimpanan per user, diminta pemilik proyek: 5GB.
//
// Angka ini praktis tak tersentuh (kira-kira 2,5 juta turn), dan itu memang
// gunanya: batas yang menahan kasus liar, bukan yang dipakai sehari-hari.
// Pemangkasannya per PERCAKAPAN tertua, bukan per turn, supaya tidak ada utas
// yang tinggal separuh dan terbaca sebagai jawaban yang hilang.
export const BATAS_BYTE_PER_USER = 5 * 1024 * 1024 * 1024;

/** Byte yang dipakai user, dihitung dari panjang kolom teksnya. */
export async function pemakaianByte(userId) {
  const [rows] = await sql.query(
    `SELECT COALESCE(SUM(
              LENGTH(t.question) + LENGTH(t.answer)
              + LENGTH(COALESCE(t.dashboards_queried, ''))
              + LENGTH(COALESCE(t.tokens_used, ''))
            ), 0) AS byte
       FROM ai_unified_turns t
       JOIN ai_unified_conversations c ON c.id = t.conversation_id
      WHERE c.user_id = ?`,
    [userId]
  );
  return Number(rows[0]?.byte || 0);
}

/**
 * Buang percakapan tertua sampai pemakaian user kembali di bawah atap.
 * Mengembalikan jumlah percakapan yang dibuang.
 */
export async function pangkasSampaiMuat(userId, batas = BATAS_BYTE_PER_USER) {
  let dibuang = 0;
  // Batas putaran supaya kesalahan hitung tidak pernah jadi loop tak berujung.
  for (let i = 0; i < 200; i += 1) {
    if ((await pemakaianByte(userId)) <= batas) break;
    const [tertua] = await sql.query(
      `SELECT id FROM ai_unified_conversations
        WHERE user_id = ? ORDER BY updated_at ASC LIMIT 1`,
      [userId]
    );
    if (tertua.length === 0) break;
    // ON DELETE CASCADE ikut membuang turn-nya.
    await sql.query("DELETE FROM ai_unified_conversations WHERE id = ?", [tertua[0].id]);
    dibuang += 1;
  }
  return dibuang;
}

/** Judul dari pertanyaan pertama, dipotong supaya muat di daftar riwayat. */
function judulDari(pertanyaan) {
  const bersih = String(pertanyaan || "").replace(/\s+/g, " ").trim();
  if (!bersih) return "Percakapan baru";
  return bersih.length > 80 ? `${bersih.slice(0, 77)}...` : bersih;
}

export async function createConversation(userId, pertanyaanPertama = "") {
  const [hasil] = await sql.query(
    "INSERT INTO ai_unified_conversations (user_id, judul, metadata) VALUES (?, ?, ?)",
    [userId, judulDari(pertanyaanPertama), JSON.stringify({ initiated_at: new Date().toISOString() })]
  );
  return { id: hasil.insertId, user_id: userId, judul: judulDari(pertanyaanPertama), created_at: new Date() };
}

export async function addTurn(conversationId, turnNumber, question, dashboards, answer, tokenCounts) {
  const [hasil] = await sql.query(
    `INSERT INTO ai_unified_turns
       (conversation_id, turn_number, question, dashboards_queried, answer, tokens_used)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [conversationId, turnNumber, question, JSON.stringify(dashboards), answer, JSON.stringify(tokenCounts)]
  );
  // updated_at percakapan ikut naik supaya urutan daftar riwayat dan sasaran
  // pemangkasan mengikuti pemakaian, bukan tanggal pembuatan.
  await sql.query(
    "UPDATE ai_unified_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [conversationId]
  );
  return { id: hasil.insertId, turn_number: turnNumber };
}

/**
 * N turn TERAKHIR, dikembalikan urut maju.
 *
 * Versi sebelumnya `ORDER BY turn_number ASC LIMIT 6`, yang memberi enam turn
 * PERTAMA. Pada percakapan panjang, konteks yang dikirim ke model membeku di
 * awal dan pertanyaan lanjutan dijawab seolah sepuluh turn terakhir tidak
 * pernah terjadi.
 */
export async function getTurns(conversationId, limit = 6) {
  const [rows] = await sql.query(
    `SELECT turn_number, question, answer, dashboards_queried, created_at
       FROM ai_unified_turns
      WHERE conversation_id = ?
      ORDER BY turn_number DESC
      LIMIT ?`,
    [conversationId, limit]
  );
  return rows.reverse().map((row) => ({
    turn_number: row.turn_number,
    question: row.question,
    answer: row.answer,
    dashboards_queried: row.dashboards_queried || [],
    created_at: row.created_at,
  }));
}

/** Jumlah turn, dipakai untuk menomori turn berikutnya tanpa menarik isinya. */
export async function hitungTurn(conversationId) {
  const [rows] = await sql.query(
    "SELECT COALESCE(MAX(turn_number), 0) AS n FROM ai_unified_turns WHERE conversation_id = ?",
    [conversationId]
  );
  return Number(rows[0]?.n || 0);
}

export async function clearConversation(conversationId) {
  await sql.query("DELETE FROM ai_unified_turns WHERE conversation_id = ?", [conversationId]);
}

/** Buang percakapan berikut seluruh turn-nya. */
export async function hapusConversation(conversationId) {
  await sql.query("DELETE FROM ai_unified_conversations WHERE id = ?", [conversationId]);
}

export async function getConversation(conversationId, userId) {
  const [rows] = await sql.query(
    `SELECT id, user_id, judul, created_at, updated_at, metadata
       FROM ai_unified_conversations
      WHERE id = ? AND user_id = ?`,
    [conversationId, userId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    user_id: row.user_id,
    judul: row.judul,
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata: row.metadata || {},
  };
}

export async function getUserConversations(userId, limit = 30) {
  const [rows] = await sql.query(
    `SELECT c.id, c.judul, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM ai_unified_turns t WHERE t.conversation_id = c.id) AS jumlah_turn
       FROM ai_unified_conversations c
      WHERE c.user_id = ?
      ORDER BY c.updated_at DESC
      LIMIT ?`,
    [userId, limit]
  );
  return rows;
}

/**
 * Ringkasan percakapan LAIN milik user yang sama, untuk req 3: CIA bisa
 * merujuk ingatan dari beberapa percakapan sebelumnya.
 *
 * Yang dikirim hanya pertanyaan dan sepotong jawabannya, bukan seluruh utas:
 * enam percakapan penuh sudah melewati batas muatan, dan potongan yang
 * dikirim cukup untuk model tahu topik apa yang PERNAH dibahas lalu memintanya
 * dibuka bila relevan. Prinsipnya sama dengan ai_finding.
 */
export async function ingatanLintasPercakapan(userId, kecualiId = null, { maksPercakapan = 5 } = {}) {
  const [rows] = await sql.query(
    `SELECT c.id, c.judul, t.question, t.answer
       FROM ai_unified_conversations c
       JOIN ai_unified_turns t ON t.conversation_id = c.id
      WHERE c.user_id = ?
        AND (? IS NULL OR c.id <> ?)
        AND t.turn_number = (
          SELECT MAX(x.turn_number) FROM ai_unified_turns x WHERE x.conversation_id = c.id
        )
      ORDER BY c.updated_at DESC
      LIMIT ?`,
    [userId, kecualiId, kecualiId, maksPercakapan]
  );
  return rows.map((r) => ({
    id: r.id,
    judul: r.judul,
    pertanyaanTerakhir: r.question,
    // Jawaban dipotong: yang dibutuhkan model adalah topik dan angka kuncinya,
    // bukan seluruh analisa yang sudah pernah ditulis.
    cuplikanJawaban: String(r.answer || "").replace(/\s+/g, " ").slice(0, 300),
  }));
}

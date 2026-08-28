// Klien chat CIA lintas dashboard.
//
// Memakai instance API bersama, BUKAN fetch telanjang. Seluruh rute /api/ai
// dijaga verifyJWT dan requireCiaAccess, jadi versi fetch sebelumnya selalu
// dijawab 401 sebelum menyentuh controller: tokennya tidak pernah ikut
// terkirim. Instance ini juga yang menangani penyegaran token dan
// pengeluaran user saat akunnya dinonaktifkan.
import API from "../api/api.js";

const BASE = "/api/ai/unified";

/** Pesan error yang bisa dibaca user, bukan "Request failed with status 403". */
function pesanError(err, bawaan) {
  const status = err?.response?.status;
  if (status === 403) return "Akses CIA belum dibuka untuk akun ini. Hubungi admin.";
  if (status === 429) return "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.";
  return err?.response?.data?.error || err?.message || bawaan;
}

export async function askUnified(options, conversationId = null, legacySnapshots = []) {
  try {
    const input = typeof options === "string"
      ? { question: options, conversationId, preferredDashboardIds: [], legacySnapshots }
      : options;
    const { data } = await API.post(`${BASE}/ask`, {
      question: input.question,
      conversationId: input.conversationId || null,
      preferredDashboardIds: input.preferredDashboardIds || [],
      snapshots: input.legacySnapshots || [],
    });
    return data;
  } catch (err) {
    throw new Error(pesanError(err, "Gagal mengirim pertanyaan."));
  }
}

export async function getConversations() {
  try {
    const { data } = await API.get(`${BASE}/conversations`);
    return data;
  } catch (err) {
    throw new Error(pesanError(err, "Gagal memuat daftar percakapan."));
  }
}

export async function getConversationTurns(conversationId) {
  try {
    const { data } = await API.get(`${BASE}/conversations/${conversationId}/turns`);
    return data;
  } catch (err) {
    throw new Error(pesanError(err, "Gagal memuat percakapan."));
  }
}

export async function deleteConversation(conversationId) {
  try {
    const { data } = await API.delete(`${BASE}/conversations/${conversationId}`);
    return data;
  } catch (err) {
    throw new Error(pesanError(err, "Gagal menghapus percakapan."));
  }
}

/** Dashboard mana yang relevan untuk pertanyaan ini, tanpa menarik datanya. */
export async function sarankanDashboard(question) {
  try {
    const { data } = await API.post(`${BASE}/suggest`, { question });
    return data;
  } catch (err) {
    throw new Error(pesanError(err, "Gagal mencari dashboard yang relevan."));
  }
}

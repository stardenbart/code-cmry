// Pemilih provider AI untuk jalur CIA: GLM-5.2 lewat NVIDIA NIM, atau Gemini.
//
// Aturan yang dijaga di sini, semuanya dari keputusan pemilik proyek:
//
// 1. Pilihan provider disimpan di database, BUKAN di kode dan bukan di env,
//    supaya admin bisa mengubahnya dari website tanpa deploy. Defaultnya Gemini,
//    lihat alasan terukur di PROVIDER_DEFAULT di bawah.
// 2. Kalau GLM gagal, timeout, atau kena batas laju, permintaan ITU dijawab
//    Gemini. Tapi permintaan BERIKUTNYA tetap mencoba GLM lebih dulu. Tidak ada
//    status "sedang rusak" yang menempel, karena kegagalan GLM di sini hampir
//    selalu sesaat, dan menempelkan status berarti satu kegagalan membuang
//    seluruh sisa hari ke provider cadangan tanpa ada yang tahu.
// 3. Setiap kegagalan dan setiap peralihan dicatat, supaya seberapa sering GLM
//    gagal bisa dilihat, bukan dikira-kira.
import { askGlm, GlmError, hasGlmKey } from "../config/glm.js";
import { askGemini } from "../config/gemini.js";
import * as rateLimit from "./rateLimiter.js";
import * as aiSettings from "./aiSettings.js";

/** Kunci setelan di tabel ai_settings. Global, satu untuk semua grup. */
export const KUNCI_MODEL_CIA = "cia_model_wa";

export const PROVIDER_SAH = ["glm", "gemini"];

// Default bila belum pernah diatur admin, atau bila baris setelannya hilang.
//
// Gemini, bukan GLM, dan itu dari pengukuran bukan preferensi. Diuji pada akun
// NVIDIA yang ada: z-ai/glm-5.2 terdaftar di katalog tapi tidak pernah menjawab,
// dan sebagian besar model lain membalas "Not found for account". Dua yang hidup
// gagal aritmetika pada soal yang seluruh angkanya sudah disodorkan: satu
// mengarang penyebut 237 jam padahal running time 168 jam diberikan, satu lagi
// menyebut selisih poin persentase sebagai kenaikan.
//
// Default yang mengarah ke provider yang tidak melayani berarti setiap
// pertanyaan menunggu sampai timeout lebih dulu sebelum jatuh ke cadangan.
export const PROVIDER_DEFAULT = "gemini";

// Free tier GLM-5.2 di NVIDIA NIM dibatasi sekitar 40 permintaan per menit.
// Angkanya sengaja sedikit di bawah itu: batas yang dipasang persis di angka
// resmi akan tetap kena 429 karena permintaan dari proses lain ikut terhitung.
const GLM_MAKS_PER_MENIT = Number(process.env.GLM_RATE_LIMIT_PER_MIN) || 35;
const GLM_JENDELA_DETIK = 60;

/**
 * Provider yang sedang dipilih admin.
 *
 * Gagal membaca setelan TIDAK menggagalkan jawaban: kembali ke default, karena
 * tidak bisa menjawab sama sekali jauh lebih buruk daripada menjawab dengan
 * provider yang mungkin bukan pilihan terakhir admin.
 *
 * @returns {Promise<"glm"|"gemini">}
 */
export async function providerTerpilih() {
  try {
    const nilai = await aiSettings.getSetelan(KUNCI_MODEL_CIA);
    const bersih = String(nilai || "").trim().toLowerCase();
    return PROVIDER_SAH.includes(bersih) ? bersih : PROVIDER_DEFAULT;
  } catch (err) {
    console.warn("[AI] gagal membaca setelan model, memakai default:", err?.message || err);
    return PROVIDER_DEFAULT;
  }
}

/**
 * Menyimpan pilihan provider.
 *
 * @param {"glm"|"gemini"} provider
 * @param {number} [userId]
 */
export async function simpanProvider(provider, userId) {
  const bersih = String(provider || "").trim().toLowerCase();
  if (!PROVIDER_SAH.includes(bersih)) {
    throw new Error(`provider tidak dikenal: ${provider}`);
  }
  await aiSettings.setSetelan(KUNCI_MODEL_CIA, bersih, userId);
  return { provider: bersih };
}

/**
 * Apakah GLM boleh dipakai untuk satu permintaan sekarang.
 *
 * Dipisah supaya bisa diuji tanpa jaringan, dan supaya alasan penolakannya bisa
 * dicatat apa adanya, bukan menjadi "GLM gagal" yang tidak menjelaskan apa pun.
 *
 * @returns {{boleh: boolean, alasan: string}}
 */
export function bolehPakaiGlm() {
  if (!hasGlmKey()) return { boleh: false, alasan: "NVIDIA_API_KEY belum diisi" };

  const limit = rateLimit.hit("glm:global", GLM_MAKS_PER_MENIT, GLM_JENDELA_DETIK);
  if (!limit.allowed) {
    return { boleh: false, alasan: `batas laju GLM tercapai, coba lagi ${limit.retryAfterSeconds} detik lagi` };
  }

  return { boleh: true, alasan: "" };
}

/**
 * Bertanya lewat provider terpilih, dengan cadangan Gemini.
 *
 * Bentuk argumen dan kembaliannya mengikuti askGemini supaya pemanggil tidak
 * perlu tahu provider mana yang menjawab.
 *
 * @param {object} arg
 * @param {string} arg.question
 * @param {string} [arg.systemInstruction]
 * @param {Array<{role: string, text: string}>} [arg.history]
 * @param {number} [arg.maxOutputTokens]
 * @param {string} [arg.geminiApiKey] kunci untuk jalur cadangan
 * @param {string} [arg.geminiModel]
 * @param {string} [arg.thinkingLevel] hanya dipakai Gemini
 * @param {object} [arg.deps] penyuntik untuk uji
 * @returns {Promise<{text: string, provider: string, model: string, usage: object|null, cadangan: boolean, alasanCadangan: string}>}
 */
export async function tanyaModel({
  question,
  systemInstruction,
  history = [],
  maxOutputTokens,
  geminiApiKey,
  geminiModel,
  thinkingLevel,
  // Timeout Gemini diteruskan apa adanya. Beberapa jalur memakai batas yang jauh
  // lebih longgar daripada default, dan menjatuhkannya diam-diam di sini berarti
  // jawaban panjang mulai gagal tanpa ada perubahan yang kelihatan.
  geminiTimeoutMs,
  deps = {},
} = {}) {
  const _askGlm = deps.askGlm || askGlm;
  const _askGemini = deps.askGemini || askGemini;
  const _provider = deps.providerTerpilih || providerTerpilih;
  const _boleh = deps.bolehPakaiGlm || bolehPakaiGlm;

  const pilihan = await _provider();

  const keGemini = async (alasanCadangan) => {
    const hasil = await _askGemini({
      apiKey: geminiApiKey,
      model: geminiModel,
      systemInstruction,
      history,
      question,
      thinkingLevel,
      maxOutputTokens,
      ...(Number.isFinite(Number(geminiTimeoutMs)) ? { timeoutMs: Number(geminiTimeoutMs) } : {}),
    });
    return {
      text: hasil.text,
      provider: "gemini",
      model: hasil.model,
      usage: hasil.usage || null,
      cadangan: Boolean(alasanCadangan),
      alasanCadangan: alasanCadangan || "",
    };
  };

  if (pilihan !== "glm") return keGemini("");

  const izin = _boleh();
  if (!izin.boleh) {
    console.warn(`[AI] GLM dilewati, beralih ke Gemini: ${izin.alasan}`);
    return keGemini(izin.alasan);
  }

  try {
    const hasil = await _askGlm({ systemInstruction, history, question, maxOutputTokens });
    return {
      text: hasil.text,
      provider: "glm",
      model: hasil.model,
      usage: hasil.usage || null,
      cadangan: false,
      alasanCadangan: "",
    };
  } catch (err) {
    const kode = err instanceof GlmError ? err.code : "GLM_ERROR";
    const alasan = `${kode}: ${err?.message || err}`;
    console.warn(`[AI] GLM gagal, beralih ke Gemini: ${alasan}`);
    return keGemini(alasan);
  }
}

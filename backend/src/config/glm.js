// Provider GLM-5.2 lewat NVIDIA NIM.
//
// Endpointnya berformat OpenAI, jadi bentuk permintaannya berbeda dari Gemini.
// Yang dijaga sama adalah bentuk KEMBALIANNYA, { text, model, usage }, supaya
// pemanggil bisa menukar provider tanpa tahu bedanya.
//
// Tiga hal yang khusus untuk model ini dan bukan detail sepele:
//
// 1. Balasannya bisa memuat reasoning_content, yaitu jalan pikir model. Itu
//    TIDAK PERNAH ikut dikembalikan. Bukan sekadar tidak ditampilkan: tidak
//    dikembalikan sama sekali, supaya tidak ada pemanggil yang bisa membocorkannya
//    ke grup karena mengira itu bagian jawaban.
// 2. Parameter chat_template_kwargs seperti enable_thinking tidak konsisten
//    didukung endpoint ini. Default MATI, dan kalau dinyalakan lalu ditolak,
//    permintaannya diulang sekali tanpa parameter itu alih-alih gagal.
// 3. Kuota gratisnya sekitar 40 permintaan per menit. Pembatasnya ada di
//    modelRouter, bukan di sini, supaya berkas ini tetap satu tugas saja.
import axios from "axios";

export const GLM_BASE = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
export const GLM_MODEL = process.env.NVIDIA_MODEL || "z-ai/glm-5.2";

/** Timeout eksplisit. Tanpa ini, bot WhatsApp menggantung menunggu balasan. */
export const GLM_TIMEOUT_MS = Number(process.env.GLM_TIMEOUT_MS ?? 30_000);

export class GlmError extends Error {
  constructor(message, status = 500, code = "GLM_ERROR") {
    super(message);
    this.name = "GlmError";
    this.status = status;
    this.code = code;
  }
}

export function getGlmKey() {
  return String(process.env.NVIDIA_API_KEY || "").trim();
}

export function hasGlmKey() {
  return getGlmKey().length > 0;
}

/**
 * Menyusun body permintaan berformat OpenAI.
 *
 * Dipisah dari pengirimannya supaya bisa diuji tanpa jaringan. Kesalahan bentuk
 * body adalah penyebab kegagalan paling umum saat memakai endpoint yang
 * "kompatibel OpenAI" tapi tidak persis sama.
 *
 * @returns {object}
 */
export function susunBody({
  model = GLM_MODEL,
  systemInstruction,
  history = [],
  question,
  maxOutputTokens,
  thinking = false,
}) {
  const messages = [];

  if (systemInstruction) messages.push({ role: "system", content: String(systemInstruction) });

  for (const m of history) {
    if (!m?.text) continue;
    // Gemini memakai "model" untuk giliran asisten, OpenAI memakai "assistant".
    const role = m.role === "model" || m.role === "assistant" ? "assistant" : "user";
    messages.push({ role, content: String(m.text) });
  }

  messages.push({ role: "user", content: String(question) });

  const body = { model, messages, stream: false };
  if (Number.isFinite(Number(maxOutputTokens))) body.max_tokens = Number(maxOutputTokens);

  // Hanya dikirim bila diminta eksplisit. Lihat catatan 2 di kepala berkas.
  if (thinking) body.chat_template_kwargs = { enable_thinking: true };

  return body;
}

/**
 * Membaca balasan dan MEMBUANG jalan pikir model.
 *
 * @param {object} data balasan mentah
 * @returns {{text: string, reasoning: string, usage: object|null}}
 */
export function bacaBalasan(data) {
  const pesan = data?.choices?.[0]?.message || {};
  const text = String(pesan.content || "").trim();
  const reasoning = String(pesan.reasoning_content || "").trim();
  return { text, reasoning, usage: data?.usage || null };
}

/**
 * Bertanya ke GLM-5.2.
 *
 * @param {object} arg
 * @param {string} [arg.apiKey]
 * @param {string} [arg.model]
 * @param {string} [arg.systemInstruction]
 * @param {Array<{role: string, text: string}>} [arg.history]
 * @param {string} arg.question
 * @param {number} [arg.maxOutputTokens]
 * @param {number} [arg.timeoutMs]
 * @param {boolean} [arg.thinking]
 * @param {object} [arg.client] penyuntik untuk uji, default axios
 * @returns {Promise<{text: string, model: string, usage: object|null}>}
 */
export async function askGlm({
  apiKey = getGlmKey(),
  model = GLM_MODEL,
  systemInstruction,
  history = [],
  question,
  maxOutputTokens,
  timeoutMs = GLM_TIMEOUT_MS,
  thinking = /^(1|true|on|yes)$/i.test(String(process.env.GLM_ENABLE_THINKING || "")),
  client = axios,
} = {}) {
  if (!apiKey) throw new GlmError("NVIDIA_API_KEY belum diisi", 400, "NO_API_KEY");
  if (!question) throw new GlmError("Pertanyaan kosong", 400, "EMPTY_QUESTION");

  const kirim = async (pakaiThinking) => {
    const res = await client.post(
      `${GLM_BASE}/chat/completions`,
      susunBody({ model, systemInstruction, history, question, maxOutputTokens, thinking: pakaiThinking }),
      {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        timeout: timeoutMs,
      }
    );
    return res.data;
  };

  let data;
  try {
    data = await kirim(thinking);
  } catch (err) {
    // Endpoint ini kadang menolak chat_template_kwargs dengan 400. Menyerah di
    // situ berarti kehilangan jawaban karena parameter opsional, jadi diulang
    // sekali tanpa parameter itu.
    const status = err?.response?.status;
    if (thinking && status === 400) {
      console.warn("[GLM] parameter thinking ditolak, diulang tanpa parameter itu");
      try {
        data = await kirim(false);
      } catch (err2) {
        throw keGlmError(err2);
      }
    } else {
      throw keGlmError(err);
    }
  }

  const { text, reasoning, usage } = bacaBalasan(data);

  // Jalan pikir hanya masuk log server, tidak pernah ikut kembalian.
  if (reasoning) {
    console.log(`[GLM] reasoning ${reasoning.length} karakter (tidak dikirim ke user)`);
  }

  if (!text) throw new GlmError("Balasan GLM kosong", 502, "EMPTY_RESPONSE");

  return { text, model, usage };
}

function keGlmError(err) {
  if (err?.code === "ECONNABORTED" || /timeout/i.test(String(err?.message || ""))) {
    return new GlmError("GLM timeout", 504, "TIMEOUT");
  }
  const status = err?.response?.status || 500;
  const pesan = err?.response?.data?.detail || err?.response?.data?.error?.message || err?.message;
  if (status === 429) return new GlmError("Kuota GLM habis sementara", 429, "RATE_LIMIT");
  return new GlmError(String(pesan || "GLM gagal"), status, "GLM_ERROR");
}

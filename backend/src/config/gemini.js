import axios from "axios";

// ── Google Gemini (Generative Language API) — free-tier friendly REST client ───
// Uses plain REST via axios so no extra SDK dependency is needed.
// Docs: https://ai.google.dev/api/generate-content

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// Models offered in the UI dropdown.
// Verified callable on a fresh free-tier key (2026-07-31). Deliberately excludes
// the 2.5 family (404 "no longer available to new users") and the 2.0 family
// (429 quota — no free-tier allowance), so the dropdown can't offer a dead option.
export const ALLOWED_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
];

export function normalizeModel(model) {
  return ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL;
}

/**
 * The universal key: one shared allowance for every user who has not brought
 * their own. Kept as a FALLBACK — a personal key is always preferred, because
 * free-tier quota belongs to the key, so everyone on the universal key competes
 * for the same 500/day (and only 20/day on the deep model).
 *
 * CODE_AI_UNIVERSAL_KEY is the current name; GEMINI_API_KEY still works so
 * existing deployments keep running after an upgrade.
 */
export function getServerKey() {
  const key = (process.env.CODE_AI_UNIVERSAL_KEY || process.env.GEMINI_API_KEY || "").trim();
  return key || null;
}

export function hasServerKey() {
  return Boolean(getServerKey());
}

// ── Percobaan ulang ──────────────────────────────────────────────────────────
// 503 UNAVAILABLE ("model is overloaded") dan 504 timeout adalah keadaan sesaat
// di sisi Google, bukan kesalahan permintaan. Tanpa percobaan ulang, satu 503
// membuat classifier mengembalikan daftar kosong, dan user membaca "tidak ada
// dashboard yang cocok" untuk pertanyaan yang sebenarnya cocok.
//
// Jedanya naik (0.6s, 1.5s) supaya tidak menambah beban saat Google memang
// sedang penuh. 429 TIDAK diulang: kuota habis tidak pulih dalam dua detik,
// dan mengulanginya hanya mempercepat habisnya jatah.
const RETRY_DELAYS_MS = [600, 1500];

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

export function bisaDiulang(err) {
  if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT" || err.code === "ECONNRESET") return true;
  const status = err.response?.status;
  return status === 500 || status === 502 || status === 503 || status === 504;
}

function buildGenerationConfig(model, overrides = {}) {
  // maxOutputTokens must cover thinking tokens too, hence the generous default.
  const config = {
    temperature: Number(process.env.GEMINI_TEMPERATURE ?? 0.2),
    topP: 0.95,
    maxOutputTokens: Number(overrides.maxOutputTokens ?? process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 4096),
  };

  // Thinking controls differ per generation:
  //   Gemini 3.x  → thinkingConfig.thinkingLevel ("low" | "high")
  //   Gemini 2.5  → thinkingConfig.thinkingBudget (token count, 0 disables)
  // Measured on 2026-07-31: "low" on gemini-3.6-flash roughly halves thinking
  // tokens AND produced a more complete answer than leaving it unset.
  if (/^gemini-(3|4|5)/.test(model) || model.startsWith("gemini-flash")) {
    config.thinkingConfig = {
      thinkingLevel: overrides.thinkingLevel || process.env.GEMINI_THINKING_LEVEL || "low",
    };
  } else if (model.startsWith("gemini-2.5")) {
    config.thinkingConfig = {
      thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET ?? 0),
    };
  }

  return config;
}

/**
 * Ask Gemini a question.
 *
 * @param {object}   opts
 * @param {string}   opts.apiKey            Gemini API key (user key or server key)
 * @param {string}   opts.model             Model id
 * @param {string}   opts.systemInstruction System prompt
 * @param {Array}    opts.history           [{ role: "user"|"model", text }] previous turns
 * @param {string}   opts.question          Current user message (already includes data context)
 * @param {number}   opts.timeoutMs
 * @returns {Promise<{ text: string, model: string, usage: object|null, finishReason: string|null }>}
 */
export async function askGemini({
  apiKey,
  model = DEFAULT_MODEL,
  systemInstruction,
  history = [],
  question,
  thinkingLevel,
  maxOutputTokens,
  timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS ?? 60_000),
}) {
  if (!apiKey) throw new GeminiError("Gemini API key is not configured", 400, "NO_API_KEY");
  if (!question) throw new GeminiError("Question is empty", 400, "EMPTY_QUESTION");

  const usedModel = normalizeModel(model);

  const contents = [
    ...history
      .filter((m) => m?.text)
      .map((m) => ({
        role: m.role === "model" || m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.text) }],
      })),
    { role: "user", parts: [{ text: question }] },
  ];

  const body = {
    contents,
    generationConfig: buildGenerationConfig(usedModel, { thinkingLevel, maxOutputTokens }),
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  let data;
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await axios.post(
        `${API_BASE}/models/${usedModel}:generateContent`,
        body,
        {
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          timeout: timeoutMs,
        }
      );
      data = res.data;
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt === RETRY_DELAYS_MS.length || !bisaDiulang(err)) break;
      await tidur(RETRY_DELAYS_MS[attempt]);
    }
  }
  if (lastErr) throw toGeminiError(lastErr);

  const candidate = data?.candidates?.[0];
  const text = (candidate?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();

  if (!text) {
    const reason =
      candidate?.finishReason ||
      data?.promptFeedback?.blockReason ||
      "NO_CANDIDATE";
    if (reason === "MAX_TOKENS") {
      throw new GeminiError(
        "Jawaban terpotong karena limit output. Coba pertanyaan yang lebih spesifik.",
        502,
        reason
      );
    }
    if (reason === "SAFETY" || data?.promptFeedback?.blockReason) {
      throw new GeminiError(
        "Pertanyaan atau data diblokir oleh filter keamanan Gemini.",
        400,
        reason
      );
    }
    throw new GeminiError(`Gemini tidak mengembalikan jawaban (${reason}).`, 502, reason);
  }

  return {
    text,
    model: usedModel,
    usage: data?.usageMetadata || null,
    finishReason: candidate?.finishReason || null,
  };
}

/** Cheap key validation — lists models with the given key. */
export async function validateKey(apiKey) {
  try {
    await axios.get(`${API_BASE}/models`, {
      headers: { "x-goog-api-key": apiKey },
      params: { pageSize: 1 },
      timeout: 15_000,
    });
    return true;
  } catch (err) {
    throw toGeminiError(err);
  }
}

export class GeminiError extends Error {
  constructor(message, status = 500, code = "GEMINI_ERROR") {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.code = code;
  }
}

function toGeminiError(err) {
  if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
    return new GeminiError("Gemini timeout — coba lagi.", 504, "TIMEOUT");
  }

  const status = err.response?.status;
  const apiErr = err.response?.data?.error;
  const raw = apiErr?.message || err.message || "Unknown Gemini error";

  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(raw)) {
    return new GeminiError("Gemini API key tidak valid.", 400, "INVALID_KEY");
  }
  if (status === 403) {
    return new GeminiError(
      "Gemini API key ditolak (403). Pastikan Generative Language API aktif untuk key tersebut.",
      403,
      "FORBIDDEN"
    );
  }
  if (status === 429) {
    return new GeminiError(
      "Kuota free-tier Gemini habis / terlalu banyak request. Tunggu sebentar atau pakai API key sendiri.",
      429,
      "QUOTA"
    );
  }
  if (status === 404) {
    if (/no longer available|deprecated/i.test(raw)) {
      return new GeminiError(
        `Model ini sudah tidak tersedia untuk API key kamu. Buka AI Assistant Settings dan pilih model lain (default: ${DEFAULT_MODEL}). Detail: ${raw}`,
        404,
        "MODEL_RETIRED"
      );
    }
    return new GeminiError(`Model Gemini tidak ditemukan: ${raw}`, 404, "MODEL_NOT_FOUND");
  }

  return new GeminiError(`Gemini error: ${raw}`, status && status >= 400 ? status : 502, apiErr?.status || "GEMINI_ERROR");
}

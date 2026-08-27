// Tracker telemetry CIA yang best-effort + sanitasi error.
//
// Kontrak paling penting: MENULIS telemetry tidak boleh mengubah status jawaban
// CIA. Kalau CIA_TELEMETRY_ENABLED tidak "true", atau insert pertama gagal, atau
// database analytics sedang bermasalah, tracker menjadi no-op dan jawaban user
// tetap jalan. Karena itu setiap operasi store dibungkus try/catch dan yang
// dicatat ke log HANYA safeError(err) — tidak pernah objek error mentah, yang
// pada axios membawa Authorization header, basic-auth, dan body response.
//
// safeError membangun objek BARU {code, message}. Ia tidak pernah menyalin atau
// menyaring error lama, sebab menyaring bocor lewat field yang belum terpikir.
import crypto from "crypto";
import * as telemetryModel from "../models/ciaTelemetryModel.js";

const PREVIEW_MAX = 300;

export function telemetryEnabled() {
  return process.env.CIA_TELEMETRY_ENABLED === "true";
}

function daxTimeoutSeconds() {
  const ms = Number(process.env.CIA_DAX_TIMEOUT_MS) || 45000;
  return Math.round(ms / 1000);
}

// ── Sanitasi ────────────────────────────────────────────────────────────────

export function safeError(error) {
  // Non-objek: tidak ada yang bisa dibaca dengan aman.
  if (!error || typeof error !== "object") {
    return { code: "UNKNOWN", message: "Terjadi kesalahan yang tidak diketahui" };
  }

  const code = typeof error.code === "string" ? error.code : "";
  const msg = typeof error.message === "string" ? error.message : "";
  const status = Number(error?.response?.status) || null;

  // Timeout diperiksa lebih dulu: error axios bisa membawa code ECONNABORTED
  // SEKALIGUS response 504, dan yang relevan untuk user adalah timeout-nya.
  if (code === "ECONNABORTED" || code === "ETIMEDOUT" || /timeout/i.test(msg)) {
    return {
      code: "POWERBI_TIMEOUT",
      message: `Power BI tidak merespons dalam ${daxTimeoutSeconds()} detik`,
    };
  }

  if (status === 429 || code === "RATE_LIMIT") {
    return { code: "RATE_LIMITED", message: "Terlalu banyak permintaan, coba lagi sebentar" };
  }
  if (status === 503 || status === 504) {
    return { code: "POWERBI_UNAVAILABLE", message: "Layanan Power BI sedang tidak tersedia" };
  }
  if (status === 401 || status === 403) {
    return { code: "POWERBI_UNAUTHORIZED", message: "Akses ke dataset Power BI ditolak" };
  }
  if (status === 400) {
    return { code: "POWERBI_BAD_REQUEST", message: "Kueri data ditolak Power BI" };
  }
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { code: "POWERBI_UNAVAILABLE", message: "Tidak dapat menjangkau sumber data" };
  }

  // Kode aplikasi internal yang memang sudah aman disebut apa adanya.
  const APP_CODES = new Set([
    "ROUTER_NO_MATCH", "EMPTY_RESULT", "MODEL_NOT_FOUND",
    "DATASET_UNAUTHORIZED", "AI_PROVIDER_ERROR",
  ]);
  if (APP_CODES.has(code)) {
    return { code, message: appMessage(code) };
  }

  return { code: "UNKNOWN", message: "Terjadi kesalahan saat memproses permintaan" };
}

function appMessage(code) {
  switch (code) {
    case "ROUTER_NO_MATCH": return "Tidak ada sumber data yang cocok dengan pertanyaan";
    case "EMPTY_RESULT": return "Kueri berhasil tetapi tidak ada baris data";
    case "MODEL_NOT_FOUND": return "Model semantik tidak ditemukan";
    case "DATASET_UNAUTHORIZED": return "Akses ke dataset ditolak";
    case "AI_PROVIDER_ERROR": return "Penyedia AI gagal merespons";
    default: return "Terjadi kesalahan saat memproses permintaan";
  }
}

export function previewQuestion(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > PREVIEW_MAX ? trimmed.slice(0, PREVIEW_MAX) : trimmed;
}

export function fingerprintQuestion(text) {
  const normalized = (typeof text === "string" ? text : "").trim().toLowerCase();
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

function positiveIntOrNull(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function logSafe(where, err) {
  const safe = safeError(err);
  // Satu baris, tanpa nilai mentah. Cukup untuk menandai bahwa telemetry gagal
  // menulis tanpa membocorkan apa pun ke log.
  console.error(`[cia-telemetry] ${where} gagal: ${safe.code}`);
}

// ── Tracker ───────────────────────────────────────────────────────────────

function createNoopTracker(requestId) {
  return {
    requestId,
    dbId: null,
    enabled: false,
    async event() {},
    async finish() {},
    async fail() {},
  };
}

function createTracker(requestId, dbId, store) {
  let sequenceNo = 0;
  const totals = { input: 0, output: 0, total: 0 };

  function accumulate(data) {
    const inp = Number(data.inputTokens) || 0;
    const out = Number(data.outputTokens) || 0;
    const tot = Number(data.totalTokens) || inp + out;
    totals.input += inp;
    totals.output += out;
    totals.total += tot;
  }

  return {
    requestId,
    dbId,
    enabled: true,

    async event(stage, data = {}) {
      sequenceNo += 1;
      accumulate(data);
      try {
        await store.insertEvent(dbId, { sequenceNo, stage, ...data });
      } catch (err) {
        logSafe("insertEvent", err);
      }
    },

    async finish(summary = {}) {
      try {
        await store.finishRequest(dbId, {
          status: summary.status || "success",
          retrievalMethod: summary.retrievalMethod ?? null,
          inputTokens: summary.inputTokens ?? totals.input,
          outputTokens: summary.outputTokens ?? totals.output,
          totalTokens: summary.totalTokens ?? totals.total,
          latencyMs: summary.latencyMs ?? null,
          retrievalRounds: summary.retrievalRounds ?? 0,
        });
      } catch (err) {
        logSafe("finishRequest", err);
      }
    },

    async fail(error, summary = {}) {
      const safe = safeError(error);
      try {
        sequenceNo += 1;
        await store.insertEvent(dbId, {
          sequenceNo, stage: "request_failed", status: "error",
          errorCode: safe.code, errorMessage: safe.message,
        });
      } catch (err) {
        logSafe("insertEvent(fail)", err);
      }
      try {
        await store.finishRequest(dbId, {
          status: summary.status || "error",
          retrievalMethod: summary.retrievalMethod ?? "none",
          inputTokens: summary.inputTokens ?? totals.input,
          outputTokens: summary.outputTokens ?? totals.output,
          totalTokens: summary.totalTokens ?? totals.total,
          latencyMs: summary.latencyMs ?? null,
          retrievalRounds: summary.retrievalRounds ?? 0,
        });
      } catch (err) {
        logSafe("finishRequest(fail)", err);
      }
    },
  };
}

export async function startCiaTelemetry(envelope = {}, store = telemetryModel) {
  const requestId = envelope.requestId || crypto.randomUUID();
  if (!telemetryEnabled()) return createNoopTracker(requestId);

  const user = envelope.user || {};
  try {
    const { id } = await store.insertRequest({
      requestId,
      userId: positiveIntOrNull(user.id),
      actorName: user.name || user.username || user.nama || null,
      department: user.department || user.departemen || user.divisi || null,
      surface: envelope.surface,
      conversationRef: envelope.conversationId || null,
      questionPreview: previewQuestion(envelope.question),
      questionFingerprint: fingerprintQuestion(envelope.question),
    });
    return createTracker(requestId, id, store);
  } catch (err) {
    logSafe("insertRequest", err);
    return createNoopTracker(requestId);
  }
}

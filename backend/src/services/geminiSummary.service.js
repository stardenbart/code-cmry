// ─────────────────────────────────────────────────────────────────────────────
// Memanggil Gemini untuk executive summary (spec §12).
//
// Kunci yang dipakai: kunci UNIVERSAL dari tabel ai_settings. Job cron tidak
// punya konteks user, jadi kunci pribadi tidak berlaku. Kalau kunci universal
// belum diatur, job TIDAK berhenti: ia mengembalikan kegagalan bertanda supaya
// pemanggil mengirim pesan cadangan berisi angka mentah.
//
// Versi model di-pin lewat env, bukan alias latest (§12.3). Tanpa pin, Google
// bisa mengganti model di belakang dan perilaku job berubah tanpa satu baris
// kode pun diubah, sehingga anomali laporan tidak bisa ditelusuri.
// ─────────────────────────────────────────────────────────────────────────────

import {
  askGemini, GeminiError, normalizeModel, getServerKey,
} from "../config/gemini.js";
import * as aiSettings from "./aiSettings.js";
import {
  instruksiSistem, validasiKeluaran, susunMuatan, PROMPT_VERSION,
} from "./summaryFormatter.js";

/** Model yang dipakai job, di-pin. */
export function modelJob() {
  return normalizeModel(process.env.GEMINI_MODEL_VERSION || process.env.GEMINI_MODEL);
}

/** Model cadangan, dipakai sekali bila model utama gagal. */
export function modelCadangan() {
  const m = process.env.GEMINI_FALLBACK_MODEL_VERSION;
  return m ? normalizeModel(m) : null;
}

/**
 * Kunci untuk job. Universal dari database, env sebagai cadangan terakhir.
 *
 * Urutannya sengaja database lebih dulu: kunci di database bisa diganti admin
 * lewat UI tanpa restart server, sedangkan kunci env menuntut deploy.
 */
async function kunciJob() {
  const dariDb = await aiSettings.getUniversalKey();
  if (dariDb) return { apiKey: dariDb, sumber: "database" };
  const dariEnv = getServerKey();
  if (dariEnv) return { apiKey: dariEnv, sumber: "env" };
  return null;
}

/**
 * Meminta ringkasan dari Gemini.
 *
 * Tidak melempar. Seluruh kegagalan dikembalikan sebagai objek bertanda, karena
 * pemanggilnya adalah job terjadwal yang harus tetap mengirim sesuatu. Melempar
 * di sini berarti tidak ada laporan sama sekali, padahal angka mentahnya sudah
 * ada di tangan.
 *
 * @param {object} arg
 * @param {object} arg.jendela
 * @param {Array<object>} arg.domains
 * @param {Map<string, object>} [arg.banding]
 * @returns {Promise<{berhasil: boolean, teks?: string, modelVersion?: string,
 *   promptVersion: string, muatanByte: number, alasan?: string, validasi?: object}>}
 */
export async function ringkasDenganAI({ jendela, domains, banding }) {
  const muatan = susunMuatan({ jendela, domains, banding });
  const muatanByte = Buffer.byteLength(JSON.stringify(muatan), "utf8");

  const kunci = await kunciJob();
  if (!kunci) {
    return {
      berhasil: false,
      promptVersion: PROMPT_VERSION,
      muatanByte,
      alasan: "kunci universal CODE AI belum diatur, jadi analisis tidak bisa dibuat",
    };
  }

  const pertanyaan = [
    "Berikut data operasional plant dalam JSON. Buat ringkasan operasional",
    "sesuai format dan aturan yang sudah diberikan.",
    "",
    "```json",
    JSON.stringify(muatan),
    "```",
  ].join("\n");

  const dicoba = [modelJob(), modelCadangan()].filter(Boolean);
  let galatTerakhir = null;

  for (const model of dicoba) {
    try {
      const hasil = await askGemini({
        apiKey: kunci.apiKey,
        model,
        systemInstruction: instruksiSistem(),
        question: pertanyaan,
        // maxOutputTokens HARUS mencakup token berpikir, bukan hanya teks yang
        // keluar. Ini tertulis di config/gemini.js dan bawaannya di sana 4096.
        //
        // Versi pertama di sini menimpanya jadi 1600 dengan alasan menjaga pesan
        // WhatsApp tetap pendek, dan hasil nyatanya keluaran 168 karakter yang
        // ditolak validasi: hampir seluruh anggarannya habis untuk berpikir
        // sebelum satu section pun ditulis. Panjang pesan dikendalikan lewat
        // instruksi, bukan dengan mencekik anggaran token.
        maxOutputTokens: Number(process.env.SUMMARY_MAX_OUTPUT_TOKENS) || 4096,
        // Ringkasan terstruktur tidak butuh penalaran panjang, dan "low" terukur
        // memangkas token berpikir sekitar setengah pada gemini-3.6-flash.
        thinkingLevel: process.env.SUMMARY_THINKING_LEVEL || "low",
      });

      // askGemini mengembalikan { text, model, usage, finishReason }.
      const teks = String(hasil?.text || "").trim();
      const validasi = validasiKeluaran(teks);

      if (!validasi.lolos) {
        // Model berikutnya boleh dicoba: keluaran yang tidak lolos validasi
        // sering karena model memangkas format, dan model lain bisa berhasil.
        galatTerakhir = `validasi gagal pada ${model}: ${validasi.catatan}`;
        continue;
      }

      return {
        berhasil: true,
        teks,
        modelVersion: model,
        promptVersion: PROMPT_VERSION,
        muatanByte,
        validasi,
        kunciSumber: kunci.sumber,
      };
    } catch (err) {
      galatTerakhir =
        err instanceof GeminiError
          ? `${err.code || err.status}: ${err.message}`
          : String(err.message).slice(0, 140);
    }
  }

  return {
    berhasil: false,
    promptVersion: PROMPT_VERSION,
    muatanByte,
    alasan: galatTerakhir || "Gemini tidak mengembalikan keluaran yang sah",
  };
}

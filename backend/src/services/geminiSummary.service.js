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
  BATAS_PESAN_KARAKTER,
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

  // Percobaan kedua untuk kasus KEPANJANGAN saja.
  //
  // Terukur berturut-turut: 2929, lalu 4010, lalu 5194 karakter. Menaikkan batas
  // tiap kali berarti mengejar sasaran yang bergerak, dan instruksi "di bawah
  // 3500 karakter" jelas tidak dipatuhi. Yang bekerja adalah memberi tahu model
  // panjang keluarannya yang lalu dan meminta memadatkan, karena itu umpan balik
  // konkret alih-alih aturan umum.
  const upaya = [
    { model: dicoba[0], tambahan: "" },
    // DUA kali padatkan, bukan sekali: percobaan pertama terukur menurunkan
    // 5194 menjadi 4599, masih lewat 99 dari plafon saat itu. Satu putaran lagi
    // jauh lebih murah daripada kehilangan seluruh analisis.
    ...(dicoba[0] ? [{ model: dicoba[0], tambahan: "PADATKAN" }, { model: dicoba[0], tambahan: "PADATKAN" }] : []),
    ...dicoba.slice(1).map((m) => ({ model: m, tambahan: "" })),
  ].filter((u) => u.model);

  for (const { model, tambahan } of upaya) {
    const instruksi = tambahan === "PADATKAN"
      ? `${instruksiSistem()}

PENTING: keluaran sebelumnya DITOLAK karena melebihi ${BATAS_PESAN_KARAKTER} karakter. Tulis ulang jauh lebih padat: satu kalimat per domain, maksimum 3 butir rekomendasi, dan buang kalimat pembuka maupun penutup. Kelima section tetap WAJIB ada.`
      : instruksiSistem();
    try {
      const hasil = await askGemini({
        apiKey: kunci.apiKey,
        model,
        systemInstruction: instruksi,
        question: pertanyaan,
        // Anggaran token job ini SENGAJA jauh lebih besar daripada jalur tanya
        // jawab user, dan keduanya tidak saling memengaruhi karena setelan ini
        // hanya ada di berkas ini. Alasannya sederhana: job berjalan satu kali
        // sehari, sementara jalur chat berjalan puluhan kali dan harus hemat.
        //
        // maxOutputTokens HARUS mencakup token berpikir, bukan hanya teks yang
        // keluar; ini tertulis di config/gemini.js. Versi pertama di sini
        // menimpanya jadi 1600 dengan maksud menjaga pesan WhatsApp tetap
        // pendek, dan hasil nyatanya keluaran 168 karakter yang ditolak
        // validasi: anggarannya habis untuk berpikir sebelum satu section pun
        // ditulis. Panjang pesan dikendalikan lewat instruksi, bukan dengan
        // mencekik anggaran token.
        // Dinaikkan lagi ke 32768 setelah keluaran nyata TERPOTONG: hanya section
        // ANALISIS yang tertulis, sementara PERLU DIKONFIRMASI, REKOMENDASI, dan
        // RISIKO hilang karena token berpikir menghabiskan anggaran 16384 lebih
        // dulu. Sesuai arahan pemilik, anggaran dinaikkan alih-alih penalaran
        // diturunkan, karena job ini berjalan sekali sehari.
        maxOutputTokens: Number(process.env.SUMMARY_MAX_OUTPUT_TOKENS) || 32_768,
        // Penalaran tinggi untuk job ini. Mencari akar masalah lintas Production,
        // Quality, Maintenance, dan Cost adalah pekerjaan yang memang menuntut
        // penalaran, dan sekali sehari membuat biayanya masuk akal. Jalur chat
        // tetap memakai "low" dari config/gemini.js.
        //
        // Perlu diketahui: penalaran tinggi memakai lebih banyak kuota, dan
        // kunci universal free-tier sudah terbukti bisa habis (429) dalam
        // beberapa panggilan. Kalau job ini sering gagal karena kuota, jalannya
        // bukan menurunkan penalaran, tapi memakai kunci berbayar terpisah untuk
        // job supaya tidak berebut kuota dengan chat 57 user.
        thinkingLevel: process.env.SUMMARY_THINKING_LEVEL || "high",
        // Timeout jauh lebih panjang daripada jalur chat, dengan alasan yang sama
        // seperti anggaran tokennya: job ini berjalan sekali sehari dan tidak ada
        // orang yang menunggu di depan layar.
        //
        // Terukur: muatan 9973 byte dengan penalaran tinggi melewati 60 detik
        // bawaan dan gagal TIMEOUT, lalu seluruh laporan jatuh ke angka mentah.
        // Menurunkan penalaran demi mengejar 60 detik justru mengorbankan hal
        // yang membuat laporan ini berguna.
        timeoutMs: Number(process.env.SUMMARY_TIMEOUT_MS) || 240_000,
      });

      // askGemini mengembalikan { text, model, usage, finishReason }.
      const teks = String(hasil?.text || "").trim();
      const validasi = validasiKeluaran(teks);

      if (!validasi.lolos) {
        // Upaya berikutnya boleh dicoba: keluaran yang tidak lolos validasi
        // sering karena model memangkas format atau menulis terlalu panjang.
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

// ─────────────────────────────────────────────────────────────────────────────
// AI yang memilih dashboard, menyusun DAX, menjalankannya, lalu menganalisis
// hasilnya.
//
// Tiga langkah, masing-masing satu panggilan model:
//
//   1. PILIH  dari daftar model beserta cakupannya, pilih paling banyak tiga
//   2. SUSUN  dari skema model terpilih, tulis DAX
//   3. JAWAB  dari hasil query, jawab pertanyaannya
//
// Dipisah bertahap, bukan satu panggilan besar, karena skema seluruh workspace
// jauh melebihi batas muatan: 89 model dengan ribuan kolom. Memilih dulu membuat
// hanya skema yang relevan yang perlu dikirim.
//
// PENJAGAAN YANG TIDAK BOLEH DILEPAS
//
// - Query dijalankan lewat jalankanDaxAman(), yang menolak apa pun selain
//   EVALUATE dan DEFINE serta memotong hasilnya.
// - Query yang gagal DIULANG sekali dengan pesan errornya dikirim balik, karena
//   pesan DAX menyebut kolom mana yang salah dan itu cukup untuk memperbaiki.
// - Jawaban akhir hanya boleh bersandar pada baris yang benar-benar kembali.
//   Query kosong dijawab "tidak ada datanya", bukan dikarang.
// ─────────────────────────────────────────────────────────────────────────────

import { askGemini, GeminiError, normalizeModel, getServerKey } from "../config/gemini.js";
import * as aiSettings from "./aiSettings.js";
import { skemaModel, jalankanDaxAman, resolusiDatasetId } from "./powerbiMeta.service.js";
import { KATALOG_KPI } from "./kpiCatalog.js";
import { sanitasiTeks } from "../utils/sanitizeText.util.js";
import {
  jendelaMinggu, jendelaLaporan, periodeLemburUntukTanggal,
} from "../utils/dateWindow.util.js";

export const MAKS_MODEL = 3;
export const BATAS_JAWABAN_AGEN = Number(process.env.DAX_AGENT_MAX_CHARS) || 1400;

async function kunci() {
  const k = await aiSettings.kunciUntukJob();
  return k?.apiKey || null;
}

async function tanya({ apiKey, instruksi, pertanyaan, maksToken = 4000 }) {
  const hasil = await askGemini({
    apiKey,
    model: normalizeModel(process.env.GEMINI_MODEL_VERSION || process.env.GEMINI_MODEL),
    systemInstruction: instruksi,
    question: pertanyaan,
    maxOutputTokens: maksToken,
    thinkingLevel: process.env.DAX_AGENT_THINKING || "low",
    timeoutMs: Number(process.env.DAX_AGENT_TIMEOUT_MS) || 120_000,
  });
  return String(hasil?.text || "").trim();
}

/**
 * Daftar model beserta cakupannya, dari katalog KPI.
 *
 * Katalog dipakai sebagai peta pengetahuan karena isinya sudah diverifikasi:
 * setiap measure di sana terbukti ada di model DAN terbukti dirender di visual.
 * Menyodorkan seluruh 89 model tanpa keterangan membuat pilihan model jadi
 * tebakan.
 */
export function daftarModelRingkas() {
  const peta = new Map();
  for (const e of KATALOG_KPI) {
    if (!peta.has(e.modelName)) peta.set(e.modelName, new Set());
    peta.get(e.modelName).add(`${e.domain}: ${e.kpi}`);
  }
  return [...peta.entries()].map(([model, isi]) => ({ model, cakupan: [...isi] }));
}

/** Mengambil blok kode pertama, atau seluruh teks bila tidak ada blok. */
function ambilKode(teks) {
  const t = String(teks || "");
  const m = t.match(/```(?:dax|sql|json)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : t).trim();
}

/** Konteks periode, supaya model tidak mengarang rentang tanggal sendiri. */
function konteksPeriode() {
  const hari = jendelaLaporan().tanggal;
  const minggu = jendelaMinggu(hari);
  const lembur = periodeLemburUntukTanggal(hari);
  return [
    `Hari laporan terakhir: ${hari}.`,
    `Minggu berjalan: ${minggu.mulaiTanggal} sampai ${minggu.selesaiTanggal}.`,
    `Periode lembur berjalan (${lembur.label}): ${lembur.mulaiTanggal} sampai ${lembur.selesaiTanggal}.`,
    "Lembur dihitung per periode cut-off tanggal 13, BUKAN bulan kalender.",
  ].join(" ");
}

/**
 * Menjawab pertanyaan dengan menyusun dan menjalankan DAX sendiri.
 *
 * @param {object} arg
 * @param {string} arg.pertanyaan
 * @returns {Promise<{berhasil: boolean, teks?: string, alasan?: string, jejak?: object}>}
 */
export async function jawabDenganDax({ pertanyaan }) {
  const tanyaBersih = sanitasiTeks(pertanyaan, 400);
  if (!tanyaBersih) return { berhasil: false, alasan: "pertanyaan kosong" };

  const apiKey = await kunci();
  if (!apiKey) return { berhasil: false, alasan: "kunci universal CODE AI belum diatur" };

  const jejak = { model: [], query: [], baris: 0 };

  // ── Langkah 1: pilih model ────────────────────────────────────────────────
  const daftar = daftarModelRingkas();
  let terpilih = [];
  try {
    const jawab = await tanya({
      apiKey,
      instruksi: [
        "Kamu memilih semantic model Power BI yang relevan untuk menjawab sebuah",
        "pertanyaan operasional pabrik.",
        `Jawab HANYA dengan array JSON berisi nama model, maksimum ${MAKS_MODEL}.`,
        "Contoh: [\"Dashboard DT ORS\"]",
        "Kalau tidak ada yang relevan, jawab [].",
        "Jangan menambahkan penjelasan apa pun di luar array.",
      ].join("\n"),
      pertanyaan: [
        "Model yang tersedia beserta cakupannya:",
        JSON.stringify(daftar),
        "",
        `Pertanyaan: ${tanyaBersih}`,
      ].join("\n"),
      maksToken: 2000,
    });
    const arr = JSON.parse(ambilKode(jawab));
    const sah = new Set(daftar.map((d) => d.model));
    terpilih = (Array.isArray(arr) ? arr : []).filter((m) => sah.has(m)).slice(0, MAKS_MODEL);
  } catch (err) {
    return { berhasil: false, alasan: `gagal memilih model: ${String(err.message).slice(0, 120)}` };
  }

  if (!terpilih.length) {
    return { berhasil: false, alasan: "tidak ada dashboard yang relevan dengan pertanyaan itu" };
  }
  jejak.model = terpilih;

  // ── Langkah 2 dan 3: susun DAX lalu jalankan, per model ───────────────────
  const hasilQuery = [];
  for (const namaModel of terpilih) {
    const skema = await skemaModel(namaModel);
    if (!skema.berhasil) {
      hasilQuery.push({ model: namaModel, error: skema.alasan });
      continue;
    }
    const datasetId = await resolusiDatasetId(namaModel);

    const instruksiDax = [
      "Kamu menulis query DAX untuk Power BI Execute Queries API.",
      "Jawab HANYA dengan satu query DAX, tanpa penjelasan, tanpa blok kode.",
      "Query WAJIB dimulai dengan EVALUATE atau DEFINE.",
      "Pakai HANYA tabel, kolom, dan measure yang ada di skema. Jangan mengarang nama.",
      "Batasi hasilnya dengan TOPN paling banyak 20 baris.",
      "Buang baris kosong dengan FILTER dan NOT ISBLANK sebelum TOPN.",
      konteksPeriode(),
    ].join("\n");

    let dax = "";
    let hasil = null;

    for (let percobaan = 0; percobaan < 2; percobaan += 1) {
      const isi = [
        `Skema model "${namaModel}":`,
        JSON.stringify({ tabel: skema.tabel, measure: skema.measure }),
        "",
        `Pertanyaan: ${tanyaBersih}`,
      ];
      // Percobaan kedua membawa query sebelumnya beserta errornya. Pesan DAX
      // menyebut kolom mana yang salah, dan itu biasanya cukup untuk diperbaiki.
      if (percobaan === 1 && hasil) {
        isi.push(
          "",
          "Query sebelumnya GAGAL. Perbaiki berdasarkan pesan error ini:",
          `Query: ${dax}`,
          `Error: ${hasil.alasan}`
        );
      }

      try {
        dax = ambilKode(await tanya({ apiKey, instruksi: instruksiDax, pertanyaan: isi.join("\n") }));
      } catch (err) {
        hasil = { berhasil: false, alasan: String(err.message).slice(0, 120) };
        break;
      }

      hasil = await jalankanDaxAman(datasetId, dax, { maksBaris: 20 });
      if (hasil.berhasil) break;
    }

    jejak.query.push({ model: namaModel, dax: dax.slice(0, 400), berhasil: Boolean(hasil?.berhasil) });
    if (hasil?.berhasil) {
      jejak.baris += hasil.baris.length;
      hasilQuery.push({ model: namaModel, kolom: hasil.kolom, baris: hasil.baris });
    } else {
      hasilQuery.push({ model: namaModel, error: hasil?.alasan || "query gagal" });
    }
  }

  const adaData = hasilQuery.some((h) => (h.baris || []).length);
  if (!adaData) {
    const sebab = hasilQuery.map((h) => `${h.model}: ${h.error || "tidak ada baris"}`).join("; ");
    return { berhasil: false, alasan: `query tidak menghasilkan data. ${sebab}`.slice(0, 300), jejak };
  }

  // ── Langkah 4: jawab dari hasilnya ────────────────────────────────────────
  try {
    const teks = await tanya({
      apiKey,
      instruksi: [
        "Kamu asisten operasional CMD Plant Sentul, menjawab di grup WhatsApp",
        "manajemen dalam bahasa Indonesia.",
        "",
        "ATURAN:",
        "1. Jawab HANYA dari baris hasil query di bawah. Jangan menambah angka",
        "   yang tidak ada di sana, jangan menghitung ulang di luar yang tersedia.",
        "2. Kalau hasilnya tidak menjawab pertanyaannya, katakan terus terang",
        "   bagian mana yang tidak terjawab.",
        "3. Tulis angka bergaya Indonesia: titik untuk ribuan, koma untuk desimal.",
        "   Persentase diberi tanda persen.",
        "4. Jangan memakai emoji dan tanda pisah panjang.",
        `5. Maksimum ${BATAS_JAWABAN_AGEN} karakter. Langsung ke jawabannya.`,
        "   Pakai baris berawalan tanda hubung bila menyebut beberapa hal.",
        konteksPeriode(),
      ].join("\n"),
      pertanyaan: [
        "Hasil query:",
        JSON.stringify(hasilQuery),
        "",
        `Pertanyaan: ${tanyaBersih}`,
      ].join("\n"),
      maksToken: 6000,
    });

    if (!teks) return { berhasil: false, alasan: "model tidak mengembalikan jawaban", jejak };

    return {
      berhasil: true,
      teks: teks.length > BATAS_JAWABAN_AGEN
        ? `${teks.slice(0, BATAS_JAWABAN_AGEN - 20).trimEnd()} [dipotong]`
        : teks,
      jejak,
    };
  } catch (err) {
    return {
      berhasil: false,
      alasan: err instanceof GeminiError
        ? `${err.code || err.status}: ${err.message}`
        : String(err.message).slice(0, 140),
      jejak,
    };
  }
}

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

import { GeminiError, normalizeModel } from "../config/gemini.js";
import { tanyaModel } from "./modelRouter.js";
import * as aiSettings from "./aiSettings.js";
import { skemaModel, jalankanDaxAman, resolusiDatasetId } from "./powerbiMeta.service.js";
import { KATALOG_KPI } from "./kpiCatalog.js";
import db from "../config/db.js";
const sql = db.promise();
import { sanitasiTeks } from "../utils/sanitizeText.util.js";
import {
  jendelaMinggu, jendelaLaporan, periodeLemburUntukTanggal,
} from "../utils/dateWindow.util.js";
import { aturanGayaSantai } from "./gayaBahasa.js";
import { kamusNilai, aturanKomparasi } from "./aiKnowledge.js";

// DUA model, bukan tiga. Jalan pertama memilih tiga dan hasilnya tiga jawaban
// yang saling bertentangan untuk pertanyaan yang sama, disajikan berdampingan
// seolah semuanya benar. Bagi pembaca di grup, tiga angka berbeda untuk satu
// mesin lebih buruk daripada satu angka disertai catatan.
export const MAKS_MODEL = 2;
export const BATAS_JAWABAN_AGEN = Number(process.env.DAX_AGENT_MAX_CHARS) || 1400;

async function kunci() {
  const k = await aiSettings.kunciUntukJob();
  return k?.apiKey || null;
}

// Lewat modelRouter, bukan langsung ke Gemini. Router yang memutuskan GLM-5.2
// atau Gemini sesuai setelan admin, dan yang beralih ke Gemini bila GLM gagal,
// timeout, atau kena batas laju. Peralihan itu dicatat, jadi seberapa sering GLM
// gagal bisa dilihat alih-alih dikira-kira.
async function tanya({ apiKey, instruksi, pertanyaan, maksToken = 4000, onResult }) {
  const hasil = await tanyaModel({
    question: pertanyaan,
    systemInstruction: instruksi,
    maxOutputTokens: maksToken,
    geminiApiKey: apiKey,
    geminiModel: normalizeModel(process.env.GEMINI_MODEL_VERSION || process.env.GEMINI_MODEL),
    thinkingLevel: process.env.DAX_AGENT_THINKING || "low",
  });
  onResult?.({ provider: hasil?.provider, model: hasil?.model, usage: hasil?.usage || null });
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

/**
 * Daftar model LENGKAP, dari seluruh model yang measurenya sudah dipanen.
 *
 * Katalog hanya memuat 12 model yang KPI-nya sudah dikurasi, sementara
 * model_measure memuat 25 model beserta nama measure sebenarnya. Membatasi
 * pemilihan ke katalog berarti pertanyaan di luar KPI kurasi selalu dijawab
 * "tidak ada dashboard yang relevan", padahal datanya ada.
 *
 * Nama measure ikut dikirim sebagai kosakata. Nama model saja tidak cukup:
 * "Dashboard WWTP" tidak memberi tahu apa pun tentang isinya, sementara melihat
 * measure seperti dosing PAC dan Polymer membuat pemilihannya beralasan.
 *
 * Jumlah measure per model dibatasi supaya daftarnya tetap muat di satu
 * panggilan; yang dikirim adalah yang paling menggambarkan isinya, bukan semua.
 */
export async function daftarModelLengkap({ measurePerModel = 14 } = {}) {
  const kurasi = new Map(daftarModelRingkas().map((d) => [d.model, d.cakupan]));

  let baris = [];
  try {
    const [rows] = await sql.query(
      `SELECT model_name, measure_name FROM model_measure
        WHERE is_hidden = 0 ORDER BY model_name, measure_name`
    );
    baris = rows;
  } catch {
    // Tanpa tabel measure, katalog masih lebih baik daripada tidak ada apa-apa.
    return daftarModelRingkas();
  }

  const perModel = new Map();
  for (const r of baris) {
    const m = String(r.model_name);
    if (!perModel.has(m)) perModel.set(m, []);
    perModel.get(m).push(String(r.measure_name));
  }

  // Measure yang jelas bukan KPI dibuang: pembantu format visual dan sisa
  // percobaan hanya membuang ruang dan menyesatkan pemilihan.
  const sampah = /color|warna|^desk |^label |debug|^test|dummy|^measure( \d+)?$|coba/i;

  const hasil = [];
  for (const [model, measures] of perModel) {
    const bersih = measures.filter((x) => !sampah.test(x));
    hasil.push({
      model,
      ...(kurasi.has(model) ? { kpiTerkurasi: kurasi.get(model) } : {}),
      contohMeasure: bersih.slice(0, measurePerModel),
      totalMeasure: bersih.length,
    });
  }

  // Model yang ada di katalog didahulukan: KPI-nya sudah diverifikasi dua arah,
  // jadi jawaban darinya lebih bisa dipertanggungjawabkan.
  hasil.sort((a, b) => (b.kpiTerkurasi ? 1 : 0) - (a.kpiTerkurasi ? 1 : 0));
  return hasil;
}

/** Mengambil blok kode pertama, atau seluruh teks bila tidak ada blok. */
function ambilKode(teks) {
  const t = String(teks || "");
  const m = t.match(/```(?:dax|sql|json)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : t).trim();
}

export async function perbaikiDaxTerbatas({ dax, errorMessage, plan, geminiApiKey } = {}, deps = {}) {
  const callModel = deps.callModel || tanyaModel;
  const apiKey = geminiApiKey || (deps.callModel ? null : await kunci());
  const result = await callModel({
    question: [
      "Perbaiki query DAX berikut berdasarkan error Power BI.",
      "Gunakan hanya identifier dari allowlist. Jawab hanya query DAX.",
      `Allowlist: ${JSON.stringify(plan?.allowedDaxIdentifiers || [])}`,
      `Query: ${String(dax || "").slice(0, 4000)}`,
      `Error: ${String(errorMessage || "").slice(0, 300)}`,
    ].join("\n"),
    systemInstruction: "Kamu memperbaiki DAX Power BI. Jangan menambah table, column, atau measure di luar allowlist.",
    maxOutputTokens: 2_000,
    geminiApiKey: apiKey,
    geminiModel: normalizeModel(process.env.GEMINI_MODEL_VERSION || process.env.GEMINI_MODEL),
    thinkingLevel: process.env.DAX_AGENT_THINKING || "low",
  });
  return ambilKode(result?.text).slice(0, 4_000);
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
  if (!apiKey) return { berhasil: false, alasan: "kunci universal CIA belum diatur" };

  const jejak = { model: [], query: [], baris: 0, ai: [] };
  const rekamAi = (hasil) => jejak.ai.push(hasil);

  // ── Langkah 1: pilih model ────────────────────────────────────────────────
  const daftar = await daftarModelLengkap();
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
      onResult: rekamAi,
    });
    const arr = JSON.parse(ambilKode(jawab));
    const sah = new Set(daftar.map((d) => d.model));
    terpilih = (Array.isArray(arr) ? arr : []).filter((m) => sah.has(m)).slice(0, MAKS_MODEL);
  } catch (err) {
    return { berhasil: false, alasan: `gagal memilih model: ${String(err.message).slice(0, 120)}`, jejak };
  }

  if (!terpilih.length) {
    return { berhasil: false, alasan: "tidak ada dashboard yang relevan dengan pertanyaan itu", jejak };
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
      "",
      "WAJIB DIFILTER PERIODE. Kecuali pertanyaannya jelas meminta sepanjang",
      "masa, batasi dengan kolom tanggal ke periode yang disebut di bawah.",
      "Tanpa filter, hasilnya akumulasi bertahun-tahun: jalan pertama sistem ini",
      "mengembalikan running hours 1.356.159 jam, yang berarti 154 tahun.",
      "",
      "JANGAN MENGHITUNG RASIO ANTAR SATUAN YANG BERBEDA. Banyak measure durasi",
      "di model ini bersatuan menit walau namanya menyebut hour. Membagi durasi",
      "bersatuan menit dengan running time berjam menghasilkan angka yang",
      "terlihat seperti persen padahal bukan. Kalau satuannya tidak bisa",
      "dipastikan dari skema, JANGAN membuat kolom persentase; kembalikan saja",
      "durasi dan running time sebagai dua kolom terpisah.",
      "",
      "PASTIKAN NILAINYA IKUT DIKELOMPOKKAN. Bila satu measure mengembalikan",
      "angka yang sama persis untuk setiap baris, measure itu mengabaikan",
      "konteks baris dan TIDAK boleh dipakai per mesin. Pakai SUM atas kolom",
      "fakta, bukan measure semacam itu.",
      "",
      "PAKAI NILAI YANG TERSIMPAN, BUKAN KATA YANG DIPAKAI USER. Skema di bawah",
      "memberi nama tabel dan kolom, tapi TIDAK memberi isi kolomnya. Kamus di",
      "bawah berisi nilai yang sudah diukur langsung dari model. Memfilter dengan",
      "kata user, misalnya \"Pasuruan\" padahal tersimpan \"CMDPSR\", menghasilkan",
      "nol baris, dan nol baris bukan berarti angkanya nol.",
      kamusNilai(tanyaBersih),
      aturanKomparasi(tanyaBersih),
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
        dax = ambilKode(await tanya({
          apiKey, instruksi: instruksiDax, pertanyaan: isi.join("\n"), onResult: rekamAi,
        }));
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
        "3. BILA DUA MODEL MEMBERI ANGKA YANG BERBEDA JAUH untuk hal yang sama,",
        "   JANGAN menyajikan keduanya berdampingan seolah sama benar. Pilih",
        "   satu yang paling masuk akal, sebut dari model mana, dan katakan",
        "   bahwa model lain memberi angka berbeda sehingga perlu dipastikan.",
        "   Tiga angka berbeda untuk satu mesin membuat pembacanya tidak bisa",
        "   memakai satu pun.",
        "4. TOLAK angka yang jelas tidak masuk akal alih-alih meneruskannya:",
        "   running hours ratusan ribu jam, atau nilai yang sama persis untuk",
        "   semua mesin. Sebut bahwa angkanya mencurigakan dan perlu diperiksa.",
        "5. Tulis angka bergaya Indonesia: titik untuk ribuan, koma untuk desimal.",
        "   Persentase diberi tanda persen.",
        "6. Jangan memakai emoji dan tanda pisah panjang.",
        `7. Maksimum ${BATAS_JAWABAN_AGEN} karakter. Langsung ke jawabannya.`,
        "   Pakai baris berawalan tanda hubung bila menyebut beberapa hal.",
        "8. AKHIRI dengan satu baris saran: dua contoh pertanyaan lanjutan yang",
        "   bisa ditanyakan dengan menandai CIA, dan yang BENAR-BENAR bisa",
        "   dijawab dari data yang baru saja kamu lihat. Sebutkan nama mesin,",
        "   CMD, atau periode yang nyata, karena pertanyaan yang menyebut nama",
        "   spesifik bisa dijawab langsung sementara pertanyaan umum tidak.",
        konteksPeriode(),
        "",
        aturanGayaSantai(),
      ].join("\n"),
      pertanyaan: [
        "Hasil query:",
        JSON.stringify(hasilQuery),
        "",
        `Pertanyaan: ${tanyaBersih}`,
      ].join("\n"),
      maksToken: 6000,
      onResult: rekamAi,
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

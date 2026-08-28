// ─────────────────────────────────────────────────────────────────────────────
// Metadata semantic model: resolusi nama ke GUID, daftar measure, dan status
// kesegaran data.
//
// Tiga hal di sini hasil pengukuran 2026-08-04, bukan bacaan dokumentasi:
//
// 1. Execute Queries BISA dipakai di workspace ini. Spec awal memperkirakan
//    hanya jalan di PPU/Premium/Fabric dan menganggapnya penghalang.
// 2. INFO.MEASURES() dijawab 400, tetapi INFO.VIEW.MEASURES() diterima. Hanya
//    varian VIEW yang dipakai di sini.
// 3. Nama model tidak bisa dipakai sebagai kunci. API mengembalikan
//    "Dashboard Warehouse Utilization " dengan spasi di ujung, dan registry
//    mencatatnya sebagai model yang hilang justru karena itu.
// ─────────────────────────────────────────────────────────────────────────────

import axios from "axios";
import { getAADToken } from "../config/powerbi.js";
import db from "../config/db.js";
import { nilaiCakupan } from "../utils/dateWindow.util.js";

// Pola yang sama dipakai aiSettings.js: pool callback dibungkus jadi promise.
const sql = db.promise();

const API = "https://api.powerbi.com/v1.0/myorg";
const WORKSPACE = () => process.env.POWERBI_WORKSPACE_ID;

/** Cache daftar dataset. Nama -> baris dataset. Dibangun sekali per proses. */
let cacheDataset = null;
let cacheDatasetSaat = 0;
const CACHE_TTL_MS = 30 * 60 * 1000;

async function header() {
  return { Authorization: `Bearer ${await getAADToken()}` };
}

/** Kunci pencocokan nama: trim lalu lowercase. Lihat catatan 3 di kepala berkas. */
const kunci = (nama) => String(nama || "").trim().toLowerCase();

/**
 * Mengambil seluruh dataset di workspace, ter-index berdasarkan nama ternormalisasi.
 * @returns {Promise<Map<string, {id: string, name: string, isRefreshable: boolean}>>}
 */
export async function daftarDataset({ paksaSegar = false } = {}) {
  if (!paksaSegar && cacheDataset && Date.now() - cacheDatasetSaat < CACHE_TTL_MS) {
    return cacheDataset;
  }
  const { data } = await axios.get(`${API}/groups/${WORKSPACE()}/datasets`, {
    headers: await header(),
    timeout: 60_000,
  });
  const peta = new Map();
  for (const d of data.value || []) peta.set(kunci(d.name), d);
  cacheDataset = peta;
  cacheDatasetSaat = Date.now();
  return peta;
}

/**
 * Nama model -> GUID dataset.
 *
 * Mengembalikan null, bukan melempar, supaya satu model yang hilang tidak
 * menggagalkan pengumpulan domain lain (spec §14).
 */
export async function resolusiDatasetId(namaModel) {
  const peta = await daftarDataset();
  return peta.get(kunci(namaModel))?.id || null;
}

/**
 * Menjalankan satu query DAX.
 *
 * Retry dengan backoff eksponensial hanya untuk kegagalan yang memang sementara.
 * 400 dari DAX yang salah tulis tidak akan pernah berhasil kalau diulang, dan
 * mengulangnya cuma memperlambat job serta membakar kuota permintaan.
 */
export async function jalankanDax(datasetId, dax, { percobaan = 3 } = {}) {
  let galatTerakhir = null;

  for (let i = 0; i < percobaan; i += 1) {
    try {
      const { data } = await axios.post(
        `${API}/datasets/${datasetId}/executeQueries`,
        { queries: [{ query: dax }], serializerSettings: { includeNulls: true } },
        { headers: { ...(await header()), "Content-Type": "application/json" }, timeout: 90_000 }
      );
      return data?.results?.[0]?.tables?.[0]?.rows || [];
    } catch (err) {
      galatTerakhir = err;
      const status = err?.response?.status;
      const bolehUlang = status === 429 || status === 503 || status === 504 || !status;
      if (!bolehUlang || i === percobaan - 1) break;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
  throw galatTerakhir;
}

/**
 * Daftar measure sebenarnya milik satu model.
 * @returns {Promise<Array<{nama: string, tabel: string|null, hidden: boolean}>>}
 */
export async function daftarMeasure(datasetId) {
  const rows = await jalankanDax(datasetId, "EVALUATE INFO.VIEW.MEASURES()");
  return rows.map((r) => ({
    nama: r["[Name]"],
    tabel: r["[Table]"] ?? null,
    hidden: r["[IsHidden]"] === true,
  }));
}

/**
 * Memanen daftar measure sejumlah model ke tabel model_measure.
 *
 * Satu model yang gagal dicatat dan dilewati, tidak menghentikan sisanya.
 *
 * @param {string[]} namaModel
 * @returns {Promise<{tersimpan: number, perModel: Array<object>}>}
 */
export async function panenMeasure(namaModel) {
  const perModel = [];
  let tersimpan = 0;

  for (const nama of namaModel) {
    const datasetId = await resolusiDatasetId(nama);
    if (!datasetId) {
      perModel.push({ model: nama, status: "tidak ditemukan", jumlah: 0 });
      continue;
    }
    try {
      const measures = await daftarMeasure(datasetId);
      if (measures.length) {
        // ON DUPLICATE KEY UPDATE, bukan DELETE lalu INSERT: measure yang
        // dihapus dari model tetap tertinggal barisnya, dan itu memang
        // disengaja supaya katalog KPI yang menunjuk ke measure hilang bisa
        // dilacak, bukan senyap berubah jadi tidak ada.
        const nilai = measures.map((m) => [datasetId, nama, m.nama, m.tabel, m.hidden ? 1 : 0]);
        await sql.query(
          `INSERT INTO model_measure (dataset_id, model_name, measure_name, table_name, is_hidden)
           VALUES ?
           ON DUPLICATE KEY UPDATE
             model_name = VALUES(model_name),
             table_name = VALUES(table_name),
             is_hidden  = VALUES(is_hidden),
             harvested_at = CURRENT_TIMESTAMP`,
          [nilai]
        );
        tersimpan += measures.length;
      }
      perModel.push({ model: nama, status: "ok", jumlah: measures.length });
    } catch (err) {
      const status = err?.response?.status;
      perModel.push({
        model: nama,
        status: `gagal ${status || ""} ${String(err.message).slice(0, 60)}`.trim(),
        jumlah: 0,
      });
    }
  }

  return { tersimpan, perModel };
}

/**
 * Status kesegaran satu dataset terhadap hari laporan.
 *
 * Hanya refresh berstatus Completed yang dihitung. Refresh yang gagal atau
 * masih berjalan tidak menambah cakupan data apa pun, dan menghitungnya akan
 * membuat model yang refresh-nya selalu gagal terlihat segar.
 *
 * @param {string} datasetId
 * @param {import("../utils/dateWindow.util.js").JendelaLaporan} jendela
 */
export async function statusKesegaran(datasetId, jendela) {
  try {
    const { data } = await axios.get(
      `${API}/groups/${WORKSPACE()}/datasets/${datasetId}/refreshes?$top=10`,
      { headers: await header(), timeout: 45_000 }
    );
    const selesai = (data.value || []).filter((x) => x.status === "Completed" && x.endTime);
    const terakhir = selesai.length ? new Date(selesai[0].endTime) : null;
    return { ...nilaiCakupan(terakhir, jendela), refreshTerakhir: terakhir };
  } catch {
    // Tidak bisa membaca riwayat refresh bukan berarti datanya tidak ada, tapi
    // job tidak boleh mengarang cakupan yang tidak bisa dibuktikan.
    return { freshness: "unavailable", cutoffWib: null, refreshTerakhir: null };
  }
}

/**
 * Menjalankan DAX yang DISUSUN MODEL, dengan penjagaan.
 *
 * Membiarkan model menulis query lalu menjalankannya tanpa pemeriksaan itu
 * ceroboh, walau Execute Queries sendiri hanya membaca. Tiga penjagaan:
 *
 * 1. Hanya EVALUATE dan DEFINE yang diterima. DAX tidak punya perintah tulis,
 *    tapi menerima teks apa pun berarti tidak ada yang menahan bila API-nya
 *    berubah, dan pemeriksaan ini gratis.
 * 2. Panjang query dibatasi. Query raksasa hasil model yang mengulang-ulang
 *    dirinya bisa membuat model Power BI bekerja sangat lama.
 * 3. Hasil dibatasi jumlah barisnya SEBELUM dikirim balik ke model, karena
 *    ribuan baris akan menembus batas muatan dan menghabiskan kuota.
 *
 * @returns {Promise<{berhasil: boolean, baris?: object[], kolom?: string[], alasan?: string}>}
 */
export async function jalankanDaxAman(datasetId, dax, { maksBaris = 40 } = {}) {
  const q = String(dax || "").trim();

  if (!q) return { berhasil: false, errorCode: "DAX_INVALID", alasan: "query kosong" };
  if (q.length > 4000) return { berhasil: false, errorCode: "DAX_INVALID", alasan: `query terlalu panjang: ${q.length} karakter` };
  // Perbandingan string biasa, BUKAN regex. Regex dengan batas kata di sini
  // pernah rusak menjadi karakter backspace 0x08 akibat skrip suntingan,
  // sehingga query yang sah pun ditolak. Untuk pemeriksaan sesederhana ini,
  // regex tidak memberi keuntungan apa pun dan menambah satu cara untuk gagal.
  const awal = q.trimStart().toUpperCase();
  if (!awal.startsWith("EVALUATE") && !awal.startsWith("DEFINE")) {
    return { berhasil: false, errorCode: "DAX_INVALID", alasan: "query harus dimulai dengan EVALUATE atau DEFINE" };
  }

  try {
    const rows = await jalankanDax(datasetId, q, { percobaan: 1 });
    const dipotong = rows.length > maksBaris;
    const baris = rows.slice(0, maksBaris);
    return {
      berhasil: true,
      baris,
      kolom: baris.length ? Object.keys(baris[0]) : [],
      jumlahAsli: rows.length,
      ...(dipotong ? { dipotong: true } : {}),
    };
  } catch (err) {
    // Pesan errornya DIKEMBALIKAN, bukan ditelan: model butuh tahu apa yang
    // salah untuk memperbaiki querynya sendiri di percobaan berikutnya.
    const d = err?.response?.data?.error;
    const detail = d?.["pbi.error"]?.details?.[0]?.detail?.value || d?.message || err.message;
    return {
      berhasil: false,
      errorCode: powerBiErrorCode(err),
      alasan: String(detail).slice(0, 300),
    };
  }
}

export function powerBiErrorCode(error) {
  const status = Number(error?.response?.status) || 0;
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "");
  if (code === "ECONNABORTED" || code === "ETIMEDOUT" || /timeout/i.test(message)) return "POWERBI_TIMEOUT";
  if (status === 401) return "POWERBI_AUTH";
  if (status === 403) return "POWERBI_FORBIDDEN";
  if (status === 429) return "POWERBI_THROTTLED";
  if (status === 400) return "DAX_INVALID";
  return "POWERBI_UNKNOWN";
}

/**
 * Skema satu model dalam bentuk ringkas untuk dibaca AI.
 *
 * Hanya tabel dan kolom yang TIDAK tersembunyi, dan auto-date table bawaan Power
 * BI dibuang: tiap kolom tanggal punya satu, jadi menyertakannya membanjiri
 * skema dengan puluhan tabel yang tidak pernah dipakai orang.
 */
const cacheSkema = new Map();

export async function skemaModel(namaModel) {
  if (cacheSkema.has(namaModel)) return cacheSkema.get(namaModel);

  const datasetId = await resolusiDatasetId(namaModel);
  if (!datasetId) return { berhasil: false, alasan: `model ${namaModel} tidak ditemukan` };

  try {
    const [kolomRows, measureRows] = await Promise.all([
      jalankanDax(datasetId, "EVALUATE INFO.VIEW.COLUMNS()", { percobaan: 2 }),
      daftarMeasure(datasetId),
    ]);

    const bukanOtomatis = (n) => !/^LocalDateTable_|^DateTableTemplate_/i.test(String(n || ""));
    const perTabel = new Map();
    for (const c of kolomRows) {
      const t = String(c["[Table]"] || "");
      if (!bukanOtomatis(t)) continue;
      if (c["[IsHidden]"] === true) continue;
      const nama = String(c["[Name]"] || "");
      if (!nama || nama.startsWith("RowNumber-")) continue;
      if (!perTabel.has(t)) perTabel.set(t, []);
      perTabel.get(t).push(`${nama}:${String(c["[DataType]"] || "?").toLowerCase()}`);
    }

    const hasil = {
      berhasil: true,
      datasetId,
      model: namaModel,
      tabel: [...perTabel.entries()].map(([t, k]) => ({ tabel: t, kolom: k })),
      measure: measureRows.filter((m) => !m.hidden).map((m) => m.nama),
    };
    cacheSkema.set(namaModel, hasil);
    return hasil;
  } catch (err) {
    return { berhasil: false, alasan: String(err.message).slice(0, 200) };
  }
}

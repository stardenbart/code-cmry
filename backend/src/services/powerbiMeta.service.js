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

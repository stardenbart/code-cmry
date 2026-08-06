// ─────────────────────────────────────────────────────────────────────────────
// Penyaring percakapan menjadi temuan.
//
// Fungsi MURNI: menyusun prompt dan membaca hasilnya. Tidak memanggil Gemini,
// tidak menyentuh database. Itu yang membuatnya bisa diuji tanpa kuota dan tanpa
// hasil yang berubah setiap dijalankan.
// ─────────────────────────────────────────────────────────────────────────────

import { sanitasiTeks } from "../utils/sanitizeText.util.js";
import { RINGKASAN_MAKS, BELUM_TERJAWAB_MAKS } from "../models/findingModel.js";

/** Instruksi untuk model penyaring. */
export function instruksiPenyaring() {
  return [
    "Kamu menyaring percakapan analisa dashboard pabrik menjadi catatan singkat",
    "yang akan dipakai sebagai konteks ketika user membuka dashboard lain.",
    "",
    "Jawab HANYA dengan satu objek JSON, tanpa penjelasan, tanpa blok kode:",
    '{"ringkasan": "...", "angka": [{"measure": "...", "nilai": 0}], "belumTerjawab": "..."}',
    "",
    "ATURAN:",
    `1. ringkasan maksimum ${RINGKASAN_MAKS} karakter. Isi intinya: apa yang`,
    "   ditemukan, di mana, dan seberapa besar. Bukan ringkasan percakapan.",
    "2. angka berisi angka kunci yang MUNCUL di percakapan, beserta NAMA MEASURE",
    "   aslinya. Jangan mengarang angka, jangan menambah yang tidak disebut,",
    "   jangan menghitung ulang. Angka tanpa nama measure tidak berguna karena",
    "   tidak bisa dicocokkan di dashboard lain.",
    "3. belumTerjawab berisi pertanyaan yang masih menggantung di percakapan itu,",
    "   atau null bila tidak ada. Inilah yang membuat analisa bisa dilanjutkan.",
    "4. Kalau percakapannya tidak menghasilkan temuan apa pun, misalnya user cuma",
    "   bertanya cara pakai, kembalikan ringkasan berupa string kosong.",
  ].join("\n");
}

/**
 * Menyusun permintaan penyaring dari putaran percakapan.
 *
 * Teks percakapan disanitasi: isinya diketik user dan bisa memuat karakter tak
 * terlihat hasil salin tempel dari Excel atau dashboard.
 */
export function susunPermintaanPenyaring({ dashboardTitle, putaran }) {
  const baris = [`Percakapan di dashboard "${sanitasiTeks(dashboardTitle, 120)}":`, ""];

  for (const p of putaran || []) {
    baris.push(`User: ${sanitasiTeks(p.question, 400)}`);
    baris.push(`CODE AI: ${sanitasiTeks(p.answer, 900)}`);
    baris.push("");
  }

  baris.push("Saring menjadi JSON sesuai aturan.");
  return baris.join("\n");
}

/** Mengambil objek JSON pertama, melepas blok kode bila ada. */
function ambilJson(teks) {
  const t = String(teks || "").trim();
  if (!t) return null;

  const blok = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const isi = (blok ? blok[1] : t).trim();

  try {
    return JSON.parse(isi);
  } catch {
    // Model kadang menambah kalimat sebelum atau sesudah JSON-nya.
    const mulai = isi.indexOf("{");
    const akhir = isi.lastIndexOf("}");
    if (mulai === -1 || akhir <= mulai) return null;
    try {
      return JSON.parse(isi.slice(mulai, akhir + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Membaca hasil penyaring.
 *
 * Mengembalikan null bila tidak sah, dan pemanggil memperlakukan null sebagai
 * "tidak ada temuan". Mengembalikan objek setengah terisi akan menyimpan
 * ringkasan kosong yang lalu masuk prompt dashboard berikutnya sebagai baris
 * kosong yang membingungkan.
 *
 * @returns {{ringkasan: string, angka: Array<{measure: string, nilai: number}>, belumTerjawab: string|null}|null}
 */
export function bacaHasilPenyaring(teks) {
  const obj = ambilJson(teks);
  if (!obj || typeof obj !== "object") return null;

  const ringkasanMentah = String(obj.ringkasan || "").trim();
  if (!ringkasanMentah) return null;

  // Ruang penanda disisakan LEBIH DULU. Versi pertama pemangkas lain di proyek
  // ini memotong ke batas lalu menambahkan penanda, sehingga hasilnya melewati
  // batas yang baru saja ditegakkan.
  const PENANDA = " [dipotong]";
  const ringkasan = ringkasanMentah.length > RINGKASAN_MAKS
    ? `${ringkasanMentah.slice(0, RINGKASAN_MAKS - PENANDA.length).trimEnd()}${PENANDA}`
    : ringkasanMentah;

  // Angka tanpa nama measure tidak bisa dipakai mengorelasikan apa pun, dan
  // nilai non-numerik akan merusak perbandingan di dashboard berikutnya.
  const angka = (Array.isArray(obj.angka) ? obj.angka : [])
    .filter((a) => a && String(a.measure || "").trim() && Number.isFinite(Number(a.nilai)))
    .map((a) => ({ measure: String(a.measure).trim().slice(0, 120), nilai: Number(a.nilai) }))
    .slice(0, 8);

  const bt = obj.belumTerjawab ? String(obj.belumTerjawab).trim() : "";

  return {
    ringkasan,
    angka,
    belumTerjawab: bt ? bt.slice(0, BELUM_TERJAWAB_MAKS) : null,
  };
}

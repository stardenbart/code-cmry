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
    "5. ringkasan, angka.measure, dan belumTerjawab TIDAK BOLEH memuat nama orang,",
    "   nama supplier, nama vendor, atau nama pelanggan. Kalau konteksnya perlu",
    "   menyebut orang atau organisasi tertentu, sebut PERANNYA saja, misalnya",
    '   "operator", "supplier", atau "pelanggan", tanpa menyebut namanya.',
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

// ── Penjagaan nama di lapisan kode ──────────────────────────────────────────
//
// distillFindings memanggil sanitizer baru yang belum pernah melihat snapshot
// dashboard mana pun (lihat kepala aiSanitizer.js), jadi maskKnownEntities tidak
// pernah punya apa pun untuk dimasker di jalur ini. Instruksi di atas melarang
// model menyebut nama, tapi instruksi bisa diabaikan model. Ini penjagaan KEDUA
// yang sebenarnya menahan, bukan sekadar meminta.
//
// JUJUR soal apa yang ini LAKUKAN dan TIDAK lakukan: ini penjagaan berbasis
// POLA teks yang jelas bukan nama measure (gelar organisasi PT/CV/UD, sapaan
// Bpk/Ibu/Sdr), BUKAN pendeteksi entitas nama bebas. Nama tanpa gelar/sapaan di
// depannya, misalnya "Sumber Makmur Jaya" tanpa "PT", tidak akan tertangkap.
// Penopengan penuh menunggu pendeteksi entitas dari teks bebas yang belum ada
// di proyek ini.
const POLA_ORGANISASI_SRC = "\\b(?:PT|CV|UD)\\.?\\s+[A-Z][\\w.'-]*(?:\\s+[A-Z][\\w.'-]*){0,4}";
const POLA_SAPAAN_SRC = "\\b(?:Bpk|Ibu|Sdri?)\\.?\\s+[A-Z][\\w.'-]*(?:\\s+[A-Z][\\w.'-]*){0,3}";

// TANPA flag "i": kalau dibuat case-insensitive, [A-Z] jadi cocok dengan huruf
// kecil juga, dan kata sambung tak berhuruf besar seperti "pada" ikut tersedot
// ke dalam satu kecocokan bersama kata berikutnya yang memang berhuruf besar
// ("...Jaya pada CMD" bisa lenyap seluruhnya). Gelar (PT/CV/UD) dan sapaan
// (Bpk/Ibu/Sdr) memang lazim ditulis dengan huruf besar, jadi case-sensitive
// tidak kehilangan kasus nyata dan menghindari bug itu.

/** True bila teks memuat pola nama organisasi atau sapaan orang. */
function memuatPolaNama(teks) {
  return new RegExp(POLA_ORGANISASI_SRC).test(String(teks || "")) ||
    new RegExp(POLA_SAPAAN_SRC).test(String(teks || ""));
}

/** Mengganti bagian yang cocok pola nama dengan kata perannya, sisanya utuh. */
function sensorPolaNama(teks) {
  return String(teks || "")
    .replace(new RegExp(POLA_ORGANISASI_SRC, "g"), "[supplier]")
    .replace(new RegExp(POLA_SAPAAN_SRC, "g"), "[operator]");
}

/**
 * Membaca hasil penyaring.
 *
 * Mengembalikan null bila tidak sah, dan pemanggil memperlakukan null sebagai
 * "tidak ada temuan". Mengembalikan objek setengah terisi akan menyimpan
 * ringkasan kosong yang lalu masuk prompt dashboard berikutnya sebagai baris
 * kosong yang membingungkan.
 *
 * @returns {{ringkasan: string, angka: Array<{measure: string, nilai: number}>, belumTerjawab: string|null, namaTersensor: boolean}|null}
 */
export function bacaHasilPenyaring(teks) {
  const obj = ambilJson(teks);
  if (!obj || typeof obj !== "object") return null;

  const ringkasanMentah = String(obj.ringkasan || "").trim();
  if (!ringkasanMentah) return null;

  let namaTersensor = false;

  // Ringkasan dan belumTerjawab tidak dibuang seluruhnya karena satu nama di
  // dalamnya: itu membuang informasi sah bersama namanya. Hanya bagian yang
  // cocok pola nama yang disensor, sisanya tetap dikirim.
  const ringkasanSensor = memuatPolaNama(ringkasanMentah) ? sensorPolaNama(ringkasanMentah) : ringkasanMentah;
  if (ringkasanSensor !== ringkasanMentah) namaTersensor = true;

  // Ruang penanda disisakan LEBIH DULU. Versi pertama pemangkas lain di proyek
  // ini memotong ke batas lalu menambahkan penanda, sehingga hasilnya melewati
  // batas yang baru saja ditegakkan.
  const PENANDA = " [dipotong]";
  const ringkasan = ringkasanSensor.length > RINGKASAN_MAKS
    ? `${ringkasanSensor.slice(0, RINGKASAN_MAKS - PENANDA.length).trimEnd()}${PENANDA}`
    : ringkasanSensor;

  // Angka tanpa nama measure tidak bisa dipakai mengorelasikan apa pun, dan
  // nilai non-numerik akan merusak perbandingan di dashboard berikutnya. Baris
  // yang measure-nya memuat pola nama dibuang SELURUHNYA, bukan disensor:
  // measure adalah label pendek, jadi tidak ada sisa informasi berguna sesudah
  // namanya dibuang.
  const angkaMentah = Array.isArray(obj.angka) ? obj.angka : [];
  const angka = angkaMentah
    .filter((a) => a && String(a.measure || "").trim() && typeof a.nilai === "number" && Number.isFinite(a.nilai))
    .filter((a) => {
      if (memuatPolaNama(a.measure)) {
        namaTersensor = true;
        return false;
      }
      return true;
    })
    .map((a) => ({ measure: String(a.measure).trim().slice(0, 120), nilai: Number(a.nilai) }))
    .slice(0, 8);

  const btMentah = obj.belumTerjawab ? String(obj.belumTerjawab).trim() : "";
  const btSensor = btMentah && memuatPolaNama(btMentah) ? sensorPolaNama(btMentah) : btMentah;
  if (btSensor !== btMentah) namaTersensor = true;

  return {
    ringkasan,
    angka,
    belumTerjawab: btSensor ? btSensor.slice(0, BELUM_TERJAWAB_MAKS) : null,
    namaTersensor,
  };
}

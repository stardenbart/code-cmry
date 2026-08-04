// ─────────────────────────────────────────────────────────────────────────────
// Sanitasi teks bebas sebelum masuk prompt Gemini (spec §12.2).
//
// Sumber teksnya entri operator: alasan downtime, catatan defect, deskripsi
// komplain. Diketik manusia di lapangan, jadi bisa memuat karakter kontrol,
// karakter tak terlihat hasil salin-tempel dari Excel atau WhatsApp, dan
// panjang yang tidak terduga.
//
// Yang dilindungi bukan hanya bentuk JSON-nya. JSON.stringify sudah menangani
// escaping dengan benar, jadi bahaya sisanya adalah isi field yang terbaca
// sebagai instruksi tambahan oleh model. Dua vektor paling nyata:
//
//   1. Karakter tak terlihat, zero-width sampai bidi override, yang
//      menyembunyikan teks dari orang yang memeriksa data tapi tetap terbaca
//      model.
//   2. Pembatas blok seperti tiga backtick yang menutup blok data di prompt
//      lebih awal, sehingga sisa teksnya berada di luar konteks data.
//
// Yang TIDAK dilakukan: mendeteksi maksud jahat dari kalimatnya. Mencocokkan
// frasa seperti "abaikan instruksi sebelumnya" mudah dilewati dan mudah salah
// tuduh pada catatan yang sah. Yang dilakukan adalah MENANDAI teks mencurigakan
// lewat mengandungPolaInstruksi() supaya laporannya menyebut keberadaannya,
// bukan diam-diam mempercayainya.
//
// Catatan implementasi: kelas karakter ditulis dengan escape, bukan karakter
// literal. Untuk util yang justru bertugas membuang karakter tersembunyi, kode
// yang isinya sendiri tersembunyi dari peninjau adalah cacat tersendiri.
// ─────────────────────────────────────────────────────────────────────────────

/** Panjang maksimum per field. Cukup untuk satu alasan downtime yang utuh. */
export const PANJANG_MAKS = 300;

/**
 * Karakter kontrol C0 dan C1, kecuali tab, CR, dan LF yang diubah jadi spasi
 * lebih dulu. Sisanya dibuang: tidak ada catatan operator yang sah memuat
 * karakter bell atau escape.
 */
const KONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

// Definisi kelas tak terlihat ada di TAK_TERLIHAT_ESC di bawah.

/**
 * Kelas karakter tak terlihat, versi yang bisa dibaca peninjau.
 *
 * Dibangun dari string escape lewat new RegExp, BUKAN literal regex. Versi
 * pertama memakai karakter literal di dalam /[...]/ dan itu tidak bisa ditinjau
 * siapa pun: barisnya terlihat hampir kosong di editor padahal memuat sepuluh
 * codepoint. Untuk util yang justru bertugas membuang karakter tersembunyi,
 * kode yang isinya tersembunyi adalah cacat tersendiri.
 *
 * Cakupannya: soft hyphen, zero-width, penanda bidi, dan BOM.
 */
const TAK_TERLIHAT_ESC = new RegExp(
  "[\\u00AD\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u206A-\\u206F\\uFEFF]",
  "g"
);

/** Pembatas yang bisa menutup blok data di prompt lebih awal. */
const PEMBATAS_BLOK = /`{3,}|~{3,}/g;

/**
 * Pola yang menandai teks PERLU DIPERIKSA, bukan otomatis ditolak.
 *
 * Dipakai untuk menandai, tidak untuk menyensor. Catatan operator yang sah bisa
 * memuat kata instruksi, dan membuang catatannya justru menghilangkan informasi
 * yang dibutuhkan analisa.
 */
const POLA_INSTRUKSI = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\b/i,
  /\babaikan\s+(?:semua\s+)?(?:instruksi|perintah|petunjuk)\b/i,
  /\bsystem\s*(?:prompt|message)\b/i,
  /\byou\s+are\s+now\b/i,
  /\bsekarang\s+kamu\s+adalah\b/i,
  /\b(?:disregard|forget)\s+(?:the\s+)?(?:above|previous)\b/i,
];

/**
 * Menyanitasi satu field teks bebas.
 *
 * @param {unknown} nilai
 * @param {number} [maks]
 * @returns {string} string bersih, bisa kosong
 */
export function sanitasiTeks(nilai, maks = PANJANG_MAKS) {
  if (nilai === null || nilai === undefined) return "";

  let t = String(nilai);

  // Tab dan newline jadi spasi lebih dulu, supaya baris baru tidak memecah
  // struktur prompt tapi kata-katanya tetap terpisah.
  t = t.replace(/[\t\r\n]+/g, " ");
  t = t.replace(KONTROL, "");
  t = t.replace(TAK_TERLIHAT_ESC, "");
  t = t.replace(PEMBATAS_BLOK, " ");
  t = t.replace(/\s+/g, " ").trim();

  if (t.length > maks) {
    // Dipotong di batas kata bila memungkinkan, lalu diberi penanda supaya
    // pembaca tahu teksnya tidak utuh. Potongan tanpa penanda membuat catatan
    // terbaca seolah memang berakhir di situ.
    //
    // Ruang untuk penandanya disisakan LEBIH DULU. Versi pertama memotong ke
    // maks lalu menambahkan penanda, sehingga hasilnya justru melewati batas
    // yang baru saja ditegakkan: satu kata 400 karakter menghasilkan 311
    // karakter pada maks 300.
    const PENANDA = " [dipotong]";
    const ruang = Math.max(1, maks - PENANDA.length);
    const potong = t.slice(0, ruang);
    const spasi = potong.lastIndexOf(" ");
    const inti = spasi > ruang * 0.6 ? potong.slice(0, spasi) : potong;
    t = `${inti.trimEnd()}${PENANDA}`;
  }

  return t;
}

/**
 * Apakah teks memuat pola yang menyerupai instruksi ke model.
 * Hasilnya untuk MENANDAI, bukan menolak. Lihat catatan di kepala berkas.
 */
export function mengandungPolaInstruksi(nilai) {
  return POLA_INSTRUKSI.some((p) => p.test(String(nilai || "")));
}

/**
 * Menyanitasi seluruh field teks pada objek, satu tingkat.
 *
 * Angka, boolean, dan null dibiarkan apa adanya: yang perlu disanitasi hanya
 * teks bebas, dan mengubah angka jadi string akan merusak perhitungan di hilir.
 *
 * @param {Record<string, unknown>} objek
 * @param {number} [maks]
 * @returns {{bersih: Record<string, unknown>, ditandai: string[]}}
 */
export function sanitasiObjek(objek, maks = PANJANG_MAKS) {
  const bersih = {};
  const ditandai = [];

  for (const [kunci, nilai] of Object.entries(objek || {})) {
    if (typeof nilai === "string") {
      if (mengandungPolaInstruksi(nilai)) ditandai.push(kunci);
      bersih[kunci] = sanitasiTeks(nilai, maks);
    } else if (Array.isArray(nilai)) {
      bersih[kunci] = nilai.map((x) => {
        if (typeof x !== "string") return x;
        if (mengandungPolaInstruksi(x)) ditandai.push(kunci);
        return sanitasiTeks(x, maks);
      });
    } else {
      bersih[kunci] = nilai;
    }
  }

  return { bersih, ditandai: [...new Set(ditandai)] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pengenal maksud pertanyaan, deterministik, tanpa panggilan API.
//
// Urutan pemeriksaan penting: kata analitis diperiksa PALING AWAL. Pertanyaan
// "kenapa total downtime naik?" mengandung kata "total", dan kalau TOTAL
// diperiksa lebih dulu, ia akan dijawab dengan satu angka padahal yang diminta
// penjelasan. Salah menjawab lebih mahal daripada satu panggilan API.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kata yang menandakan user meminta interpretasi, bukan angka.
 *
 * Diambil dari pertanyaan nyata di ai_chat_logs. "vs" masuk karena
 * perbandingan dua periode bukan pekerjaan template.
 */
const KATA_ANALITIS = [
  "kenapa", "mengapa", "kok ", "penyebab", "akar masalah", "root cause", "rca",
  "analisa", "analisis", "bandingkan", "perbandingan", " vs ", " vs.", "versus",
  "tren", "trend", "rekomendasi", "saran", "menurutmu", "menurut kamu",
  "summary", "summarykan", "summary kan", "ringkas", "jelaskan", "jelasin",
  "insight", "evaluasi", "kesimpulan", "prediksi", "forecast",
];

const POLA_GLOSARIUM = [
  /\bapa\s+(?:itu|arti|maksud)\b/i,
  /\bartinya\s+apa\b/i,
  /\bitu\s+apa\b/i,
  /\bkepanjangan\b/i,
  /\bsingkatan\s+dari\b/i,
];

const POLA_FILTER = [
  /\bfilter\s+(?:apa|mana|yang)\b/i,
  /\bfilter\s+aktif\b/i,
  /\bslicer\b/i,
];

/** "3" dari "top 3", "5 besar", "3 teratas". */
function bacaN(t) {
  const m =
    t.match(/\btop\s*(\d{1,2})\b/i) ||
    t.match(/\b(\d{1,2})\s*(?:besar|teratas|terbawah|tertinggi|terendah)\b/i);
  if (m) return Number(m[1]);
  if (/\btop\b/i.test(t)) return 3; // "top mesin downtime" tanpa angka
  return null;
}

function bacaArah(t) {
  if (/\b(?:paling\s+rendah|terendah|terkecil|paling\s+kecil|paling\s+sedikit|minimum|terbawah)\b/i.test(t)) {
    return "terendah";
  }
  if (/\b(?:paling\s+tinggi|tertinggi|terbesar|paling\s+besar|paling\s+banyak|maksimum|teratas|paling\s+lama)\b/i.test(t)) {
    return "tertinggi";
  }
  return null;
}

/**
 * Entitas untuk VALUE_OF: nama mesin, lini, atau produk yang disebut.
 *
 * Diambil dari pola "mesin X", "line X", "lini X". Sengaja sempit: menebak
 * entitas dari kata bebas menghasilkan pencarian baris yang salah, dan lebih
 * baik menyerahkannya ke AI daripada menjawab baris yang bukan diminta.
 */
function bacaEntitas(t) {
  const m = t.match(/\b(?:mesin|line|lini|produk|customer|pelanggan)\s+([\p{L}\p{N}][\p{L}\p{N}\s.-]{0,24})/iu);
  if (!m) return null;
  const nilai = m[1]
    .replace(/\b(?:bulan|tahun|berapa|durasinya|ya|dong|itu|pada|di|yang|paling)\b.*$/i, "")
    .trim();
  return nilai.length >= 2 ? nilai : null;
}

/** Petunjuk nama kolom, dipakai untuk memilih kolom numerik yang tepat. */
function bacaKolom(t) {
  const m = t.match(/\bkolom\s+([\p{L}\p{N}][\p{L}\p{N}\s()%.-]{0,30})/iu);
  return m ? m[1].trim() : null;
}

/**
 * @param {string} question
 * @returns {{intent: string, arah: string|null, n: number|null, entitas: string|null, kolomDiminta: string|null}}
 */
export function classifyIntent(question) {
  const asli = String(question || "");
  const t = ` ${asli.toLowerCase().replace(/\s+/g, " ").trim()} `;

  const kosong = {
    intent: "UNKNOWN", arah: null, n: null, entitas: null, kolomDiminta: null,
  };
  if (!t.trim()) return kosong;

  // PALING AWAL. Lihat komentar di kepala berkas.
  if (KATA_ANALITIS.some((k) => t.includes(k))) {
    return { ...kosong, intent: "ANALYTICAL" };
  }

  if (POLA_GLOSARIUM.some((p) => p.test(asli))) {
    return { ...kosong, intent: "GLOSSARY" };
  }

  if (POLA_FILTER.some((p) => p.test(asli))) {
    return { ...kosong, intent: "FILTER_STATE" };
  }

  const arah = bacaArah(t);
  const n = bacaN(t);
  const entitas = bacaEntitas(t);
  const kolomDiminta = bacaKolom(t);
  const dasar = { arah, n, entitas, kolomDiminta };

  // TOP_N diperiksa sebelum MAX: "top 3 tertinggi" adalah daftar, bukan satu.
  if (n !== null && arah) return { ...dasar, intent: "TOP_N" };

  if (/\b(?:rata-rata|rata rata|average|avg|mean)\b/i.test(t)) {
    return { ...dasar, intent: "AVG" };
  }

  if (/\b(?:ada\s+berapa|berapa\s+(?:banyak|jumlah)|jumlah\s+(?:mesin|line|lini|baris|item)|hitung\s+berapa)\b/i.test(t)) {
    return { ...dasar, intent: "COUNT" };
  }

  if (/\b(?:berapa\s+persen|persentase|kontribusi|menyumbang|share|porsi)\b/i.test(t)) {
    return { ...dasar, intent: "SHARE" };
  }

  // "mesin mana", "line mana" + arah -> satu pemenang.
  if (arah && /\b(?:mana|siapa)\b/i.test(t)) {
    return { ...dasar, intent: arah === "terendah" ? "MIN" : "MAX" };
  }

  // Entitas + "berapa" -> nilai satu baris.
  if (entitas && /\bberapa\b/i.test(t)) {
    return { ...dasar, intent: "VALUE_OF" };
  }

  if (/\b(?:total|jumlah|keseluruhan|akumulasi)\b/i.test(t)) {
    return { ...dasar, intent: "TOTAL" };
  }

  if (arah) return { ...dasar, intent: arah === "terendah" ? "MIN" : "MAX" };

  return kosong;
}

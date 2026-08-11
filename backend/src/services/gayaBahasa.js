// ─────────────────────────────────────────────────────────────────────────────
// Gaya bahasa untuk pesan yang dibaca orang di WhatsApp.
//
// Meminta "santai" saja tidak mengubah apa pun: model tetap menulis kalimat
// kaku karena itu bentuk yang paling sering muncul di data latihnya. Yang
// membuat pesan terbaca seperti surat dinas adalah pola tertentu, jadi polanya
// yang dilarang secara eksplisit.
// ─────────────────────────────────────────────────────────────────────────────

/** Aturan gaya yang ditempel ke instruksi sistem. */
export function aturanGayaSantai() {
  return [
    "GAYA BAHASA:",
    "Tulis seperti rekan kerja yang menjelaskan singkat, bukan seperti surat",
    "dinas. Langsung ke intinya.",
    "",
    "JANGAN memakai pola ini:",
    '- "berdasarkan data yang tersedia", cukup sebut angkanya',
    '- "adapun", "sebagaimana", "dapat disimpulkan bahwa"',
    '- "perlu diinformasikan bahwa", "demikian disampaikan"',
    "- kalimat pembuka seperti baik, tentu, oke, siap",
    "",
    "TETAPI pembacanya manajemen di grup kerja, jadi:",
    "- jangan memakai slang atau bahasa gaul",
    "- jangan memakai emoji",
    "- jangan memakai tanda pisah panjang",
    "- tetap sebut angka dengan tepat, jangan dibulatkan sendiri",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Pertanyaan lanjutan yang kehilangan subjeknya.
//
// Di grup, orang menyambung percakapan dengan satu kata: "bandingkan",
// "detailkan", "lanjut". Itu BUKAN pertanyaan di luar konteks, itu pertanyaan
// yang subjeknya ada di pesan sebelumnya. Menjawabnya dengan penolakan generik
// membuat user mengulang dan tetap ditolak, lalu berhenti memakai botnya.
// ─────────────────────────────────────────────────────────────────────────────

// Kata perintah yang tidak membawa subjek apa pun. Daftar tertutup dan sengaja
// pendek: melebarkannya berarti pertanyaan sah yang kebetulan singkat ikut
// dianggap tidak lengkap.
const KATA_PERINTAH_KOSONG = new Set([
  "bandingkan", "banding", "bandingin", "komparasi",
  "detailkan", "detail", "detailin", "rinci", "rincikan", "rinciin",
  "jelaskan", "jelasin", "jelas",
  "lanjut", "lanjutkan", "terus", "next",
  "gimana", "bagaimana", "kok", "kenapa", "mengapa",
  "sebutkan", "tampilkan", "tunjukkan", "coba", "tolong", "dong", "ya", "yg",
  "itu", "nya", "aja", "saja", "lagi",
]);

/**
 * Apakah pesan ini perintah tanpa subjek, misalnya "bandingkan" atau "detailkan".
 *
 * Menghapus dulu teks mention, karena pesan di grup selalu memuat nama bot.
 * Dianggap tidak lengkap hanya bila SELURUH kata sisanya ada di daftar tertutup
 * di atas dan jumlahnya paling banyak tiga. Pertanyaan sungguhan membawa subjek,
 * misalnya nama mesin, gedung, atau metrik, dan subjek itu tidak ada di daftar.
 *
 * @param {unknown} teks
 * @returns {boolean}
 */
export function tanyaTidakLengkap(teks) {
  // Mention datang dalam dua bentuk. Di teks mentah Baileys berupa nomor,
  // "@6281234567890". Di tampilan dan di salinan yang ditempel orang berupa nama
  // yang BISA MENGANDUNG SPASI, misalnya "@CIA Bot". Menghapus hanya token @ pertama
  // menyisakan "AI" sebagai kata, dan sisa itu membuat "bandingkan" terlihat
  // punya subjek padahal tidak.
  const t = String(teks == null ? "" : teks)
    .replace(/@\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/^(?:\s*(?:ai|cia|code)\b)+/i, " ")
    .trim()
    .toLowerCase();

  if (!t) return false;

  const kata = t.split(/\s+/).filter(Boolean);
  if (!kata.length || kata.length > 3) return false;

  return kata.every((k) => KATA_PERINTAH_KOSONG.has(k));
}

/**
 * Balasan untuk perintah tanpa subjek.
 *
 * Tidak memakai kata "di luar data", karena pertanyaannya bukan di luar data:
 * subjeknya saja yang belum disebut. Menyebut topik terakhir bila diketahui,
 * supaya user cukup mengiyakan alih-alih mengulang seluruh pertanyaannya.
 *
 * @param {object} arg
 * @param {string} arg.perintah            kata yang dipakai user, misalnya "bandingkan"
 * @param {string|null} [arg.topikTerakhir] topik yang baru dibahas di grup ini
 * @param {string[]} [arg.contohMesin]
 */
export function susunBalasanTidakLengkap({ perintah, topikTerakhir = null, contohMesin = [] }) {
  const kata = String(perintah || "").trim().toLowerCase() || "itu";
  const baris = [];

  if (topikTerakhir) {
    baris.push(`Siap, ${kata} bagian mana dari ${topikTerakhir}?`);
    baris.push("");
    baris.push("Sebutkan saja yang mau dilihat, misalnya per mesin, per gedung, atau dibanding periode sebelumnya.");
    return baris.join("\n");
  }

  baris.push(`Boleh, tapi ${kata} yang mana ya? Pesannya belum menyebut angka atau mesin yang dimaksud.`);
  baris.push("");
  baris.push("Contoh yang langsung bisa saya kerjakan:");

  const mesin = (contohMesin || []).filter(Boolean).slice(0, 1);
  baris.push(
    mesin.length
      ? `- "bandingkan downtime ${mesin[0]} minggu ini dengan minggu lalu"`
      : '- "bandingkan downtime minggu ini dengan minggu lalu"'
  );
  baris.push('- "detailkan penyebab downtime di CMD 3"');
  baris.push('- "rekap output hari ini"');

  return baris.join("\n");
}

/**
 * Balasan ketika pertanyaan di luar data yang dipunya.
 *
 * Menyebut contoh NYATA, bukan kategori umum. Balasan generik seperti "saya bisa
 * ringkasan atau detail mesin" tidak menolong karena user tidak tahu harus
 * menyebut apa, dan pertanyaan umum memang ditolak sebagai ambigu.
 *
 * @param {object} arg
 * @param {string[]} arg.contohMesin        nama mesin dari daftar sebenarnya
 * @param {string|null} arg.labelPeriodeLembur  misalnya "Juli 2026"
 */
export function susunBalasanDiLuarKonteks({ contohMesin, labelPeriodeLembur, dicatat = false }) {
  const baris = [];

  // Terima kasihnya ditaruh di depan dan pertanyaannya disebut berguna, karena
  // pertanyaan yang belum bisa dijawab memang menunjukkan celah yang nyata.
  baris.push("Terima kasih, pertanyaan ini belum bisa saya jawab dari data yang saya pegang sekarang.");

  // Janji perbaikan HANYA diucapkan bila pertanyaannya benar-benar dicatat.
  // Menjanjikan perbaikan tanpa mencatat berarti bot mengucapkan hal yang tidak
  // terjadi, berulang kali, ke orang yang sama.
  if (dicatat) {
    baris.push("Sudah saya catat supaya cakupan datanya ditambah dan pertanyaan seperti ini bisa dijawab nanti.");
  }

  baris.push("");
  baris.push("Sementara ini yang bisa saya kerjakan:");

  baris.push("- Ringkasan operasional: tag saya dengan kata update atau rekap");

  const mesin = (contohMesin || []).filter(Boolean).slice(0, 2);
  baris.push(
    mesin.length
      ? `- Downtime per mesin: misalnya ${mesin.join(" atau ")}`
      : "- Downtime per mesin: sebutkan nama mesinnya"
  );

  baris.push("- Angka per CMD: NC dan Deviasi CMD 1 sampai CMD 3");

  // Periode lembur disebut apa adanya bila diketahui. Menyebut "bulan ini" akan
  // salah karena lembur memakai cut-off tanggal 13, bukan bulan kalender.
  baris.push(
    labelPeriodeLembur
      ? `- Lembur per periode cut-off, sekarang periode ${labelPeriodeLembur}`
      : "- Lembur per periode cut-off tanggal 13"
  );

  return baris.join("\n");
}

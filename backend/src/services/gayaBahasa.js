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
export function susunBalasanDiLuarKonteks({ contohMesin, labelPeriodeLembur }) {
  const baris = ["Itu di luar data yang saya punya. Yang bisa saya jawab:"];

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

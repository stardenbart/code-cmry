// ─────────────────────────────────────────────────────────────────────────────
// Menjawab pertanyaan langsung dari snapshot, tanpa memanggil Gemini.
//
// Snapshot sudah ada di backend sebagai tabel terstruktur dan statistiknya
// sudah dihitung tabular.js. Pertanyaan yang jawabannya sudah ada di angka itu
// tidak perlu dikirim ke model.
//
// Modul ini lebih sering MENOLAK daripada menjawab, dan itu memang tujuannya.
// Satu jawaban salah merusak kepercayaan pada seluruh fitur; satu panggilan API
// yang sebenarnya bisa dihindari hanya memakan kuota.
// ─────────────────────────────────────────────────────────────────────────────

import { classifyIntent } from "./aiIntent.js";
import { columnStats, detectNumericColumns, parseNumber } from "./tabular.js";
import { getGlossaryRows } from "./aiKnowledge.js";

const AMBANG = 0.7;

const fmt = (n) =>
  Number.isInteger(n) ? String(n) : Number(n.toFixed(2)).toString().replace(".", ",");

function tolak(reason, intent = "UNKNOWN") {
  return { answered: false, reason, intent };
}

/** Kalimat konteks filter, supaya angkanya tidak salah dibaca. */
function konteks(snapshot) {
  const f = (snapshot?.filters || []).filter(Boolean);
  if (!f.length) return "Tanpa filter aktif.";
  return `Filter aktif: ${f.join("; ")}.`;
}

/**
 * Merapikan satu baris glosarium untuk dibaca user.
 *
 * Baris mentahnya berisi anotasi internal yang berguna untuk prompt model tetapi
 * membingungkan bila dibaca orang: "(model: Dashboard Daily Meeting ...)" dan
 * "[Needs confirmation]" adalah catatan tentang status verifikasi measure, bukan
 * bagian dari arti istilahnya. Em dash juga dibuang, mengikuti batasan teks
 * proyek ini; berkas sumbernya sendiri tidak diubah.
 */
function rapikanGlosarium(baris) {
  let s = String(baris).replace(/^-\s*/, "");

  // Blok "(model: ...)" boleh memuat tanda kurung di dalamnya, misalnya
  // "(model: Dashboard Daily Meeting untuk OEE (source), duplicated into ...)".
  // Regex /\(model:[^)]*\)/ berhenti di ")" PERTAMA, yaitu kurung dalamnya,
  // dan menyisakan potongan menggantung. Karena itu dipindai berpasangan.
  const mulai = s.toLowerCase().indexOf("(model:");
  if (mulai !== -1) {
    let dalam = 0;
    let akhir = -1;
    for (let i = mulai; i < s.length; i += 1) {
      if (s[i] === "(") dalam += 1;
      else if (s[i] === ")") {
        dalam -= 1;
        if (dalam === 0) { akhir = i; break; }
      }
    }
    // Tanda kurung tidak berpasangan: buang sampai akhir baris daripada
    // menyisakan teks setengah.
    s = s.slice(0, mulai) + (akhir === -1 ? "" : s.slice(akhir + 1));
  }

  return s
    .replace(/\s*\[(?:Confirmed|Needs confirmation)\]/gi, "")
    .replace(/\s*—\s*/g, ". ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();
}

/** Kata yang tidak membedakan apa pun, jadi tidak dipakai mencocokkan kolom. */
const KATA_UMUM = new Set([
  "berapa", "total", "jumlah", "yang", "mana", "paling", "tertinggi", "terendah",
  "rata", "ratarata", "average", "top", "dari", "pada", "untuk", "dan", "atau",
  "adalah", "itu", "ini", "di", "ke", "nya", "apa", "saja", "bulan", "tahun",
  "mesin", "line", "lini", "data", "dashboard", "visual", "kolom", "tabel",
]);

/** Kata bermakna dari pertanyaan, dipakai mencocokkan nama kolom atau visual. */
function kataKunci(question) {
  return String(question || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !KATA_UMUM.has(w));
}

/** Melengkapi kandidat dengan kolom label untuk menyebut nama barisnya. */
function lengkapi({ visual, valueIdx, numericIdx }) {
  const labelIdx = visual.columns.findIndex((_, i) => !numericIdx.includes(i));
  return { visual, valueIdx, labelIdx: labelIdx === -1 ? null : labelIdx };
}

/**
 * Memilih SATU visual dan SATU kolom angka yang jelas.
 *
 * Dashboard nyata hampir selalu punya beberapa visual berangka, jadi menolak
 * begitu jumlahnya lebih dari satu akan membuat penjawab ini praktis tidak
 * pernah menyala. Yang dilakukan: cocokkan kata bermakna dari pertanyaan ke
 * nama kolom dan judul visual. Kalau tepat SATU yang cocok, itu jawabannya.
 * Kalau nol atau lebih dari satu, barulah menolak.
 *
 * Inilah ambang keyakinan yang dimaksud spec: menebak kolom berarti menjawab
 * pertanyaan yang tidak ditanya.
 */
function pilihTarget(snapshot, kolomDiminta, question) {
  const visuals = (snapshot?.visuals || []).filter(
    (v) => Array.isArray(v?.rows) && v.rows.length > 0 && Array.isArray(v?.columns)
  );
  if (!visuals.length) return { error: "snapshot tidak punya visual berisi baris" };

  // Setiap pasangan (visual, kolom angka) adalah satu kandidat jawaban.
  const kandidat = [];
  for (const visual of visuals) {
    const numericIdx = detectNumericColumns(visual.columns, visual.rows);
    for (const idx of numericIdx) {
      kandidat.push({ visual, valueIdx: idx, numericIdx });
    }
  }
  if (!kandidat.length) return { error: "tidak ada kolom angka" };

  // Satu-satunya kandidat: tidak ada yang bisa salah pilih.
  if (kandidat.length === 1) return lengkapi(kandidat[0]);

  // Petunjuk eksplisit "kolom X" paling kuat.
  if (kolomDiminta) {
    const cari = kolomDiminta.toLowerCase();
    const cocok = kandidat.filter((k) =>
      String(k.visual.columns[k.valueIdx]).toLowerCase().includes(cari)
    );
    if (cocok.length === 1) return lengkapi(cocok[0]);
    return { error: `nama kolom "${kolomDiminta}" cocok ke ${cocok.length} kandidat` };
  }

  // Cocokkan kata bermakna pertanyaan ke nama kolom, lalu ke judul visual.
  const kata = kataKunci(question);
  if (!kata.length) {
    return { error: `${kandidat.length} kandidat dan pertanyaan tidak menyebut metriknya` };
  }

  const cocokKolom = kandidat.filter((k) => {
    const nama = String(k.visual.columns[k.valueIdx]).toLowerCase();
    return kata.some((w) => nama.includes(w));
  });
  if (cocokKolom.length === 1) return lengkapi(cocokKolom[0]);

  if (cocokKolom.length === 0) {
    const cocokVisual = kandidat.filter((k) => {
      const judul = String(k.visual.title || "").toLowerCase();
      return kata.some((w) => judul.includes(w));
    });
    // Judul visual cocok DAN visual itu hanya punya satu kolom angka.
    if (cocokVisual.length === 1) return lengkapi(cocokVisual[0]);
    return { error: "tidak ada kolom atau visual yang cocok dengan pertanyaan" };
  }

  return { error: `pertanyaan cocok ke ${cocokKolom.length} kolom angka sekaligus` };
}

function barisTerurut(visual, valueIdx, arah) {
  const isi = visual.rows
    .map((r) => ({ row: r, n: parseNumber(r?.[valueIdx]) }))
    .filter((x) => Number.isFinite(x.n));
  isi.sort((a, b) => (arah === "terendah" ? a.n - b.n : b.n - a.n));
  return isi;
}

/**
 * @param {{question: string, snapshot: object, dashboard: object}} arg
 * @returns {{answered: true, text: string, intent: string, confidence: number}
 *          |{answered: false, reason: string, intent: string}}
 */
export function tryAnswerLocally({ question, snapshot, dashboard }) {
  const { intent, arah, n, entitas, kolomDiminta } = classifyIntent(question);

  if (intent === "ANALYTICAL") return tolak("pertanyaan meminta interpretasi", intent);
  if (intent === "UNKNOWN") return tolak("maksud pertanyaan tidak dikenali", intent);

  // ── Glosarium: jawabannya ada di berkas pengetahuan, bukan di snapshot ────
  if (intent === "GLOSSARY") {
    const istilah = (String(question).match(/\b[A-Z]{2,6}\b/g) || []).map((s) => s.toUpperCase());
    if (!istilah.length) return tolak("tidak ada singkatan yang bisa dicari", intent);

    // getGlossaryRows mengembalikan STRING ber-newline berformat "- NAMA: arti",
    // bukan array. Memanggil .filter() di atasnya melempar TypeError.
    const baris = String(getGlossaryRows(200) || "")
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean);
    if (!baris.length) return tolak("glosarium tidak tersedia di server ini", intent);

    const ketemu = [];
    for (const t of istilah) {
      const cocok = baris.find((b) => new RegExp(`\\b${t}\\b`, "i").test(b));
      if (cocok && !ketemu.includes(cocok)) ketemu.push(cocok);
    }
    if (!ketemu.length) return tolak("istilah tidak ada di glosarium", intent);

    return {
      answered: true, intent, confidence: 0.9,
      text: ketemu.map(rapikanGlosarium).join("\n"),
    };
  }

  // ── FILTER_STATE: tidak butuh kolom angka ────────────────────────────────
  if (intent === "FILTER_STATE") {
    const f = (snapshot?.filters || []).filter(Boolean);
    const halaman = (snapshot?.pagesRead || []).filter(Boolean);
    if (!f.length && !halaman.length) return tolak("snapshot tidak membawa filter", intent);
    const bagian = [];
    if (f.length) bagian.push(`Filter aktif: ${f.join("; ")}.`);
    else bagian.push("Tidak ada filter aktif.");
    if (halaman.length) bagian.push(`Halaman yang dibaca: ${halaman.join(", ")}.`);
    return { answered: true, intent, confidence: 0.95, text: bagian.join(" ") };
  }

  const target = pilihTarget(snapshot, kolomDiminta, question);
  if (target.error) return tolak(target.error, intent);

  const { visual, valueIdx, labelIdx } = target;
  const namaKolom = String(visual.columns[valueIdx]);
  const stats = columnStats(visual.rows, valueIdx);
  if (!stats) return tolak("kolom angka tidak punya nilai terbaca", intent);

  const ekor = konteks(snapshot);
  const sumber = `Dihitung dari ${stats.count} baris pada visual "${visual.title || "tanpa judul"}".`;

  if (intent === "TOTAL") {
    return {
      answered: true, intent, confidence: 0.9,
      text: `Total ${namaKolom} adalah ${fmt(stats.total)}. ${sumber} ${ekor}`,
    };
  }

  if (intent === "AVG") {
    return {
      answered: true, intent, confidence: 0.9,
      text: `Rata-rata ${namaKolom} adalah ${fmt(stats.mean)}, dengan median ${fmt(stats.median)}. ${sumber} ${ekor}`,
    };
  }

  if (intent === "COUNT") {
    return {
      answered: true, intent, confidence: 0.85,
      text: `Ada ${visual.rows.length} baris pada visual "${visual.title || "tanpa judul"}". ${ekor}`,
    };
  }

  if (intent === "MAX" || intent === "MIN") {
    if (labelIdx === null) return tolak("tidak ada kolom label untuk menyebut pemenangnya", intent);
    const urut = barisTerurut(visual, valueIdx, intent === "MIN" ? "terendah" : "tertinggi");
    if (!urut.length) return tolak("tidak ada baris dengan angka", intent);
    const juara = urut[0];
    const kata = intent === "MIN" ? "terendah" : "tertinggi";
    return {
      answered: true, intent, confidence: 0.85,
      text: `${namaKolom} ${kata} ada pada ${String(juara.row[labelIdx])}, yaitu ${fmt(juara.n)}. ${sumber} ${ekor}`,
    };
  }

  if (intent === "TOP_N") {
    if (labelIdx === null) return tolak("tidak ada kolom label untuk didaftar", intent);
    const jumlah = Math.min(n || 3, 10);
    const urut = barisTerurut(visual, valueIdx, arah === "terendah" ? "terendah" : "tertinggi");
    if (urut.length < 2) return tolak("baris terlalu sedikit untuk sebuah daftar", intent);
    const dipakai = urut.slice(0, jumlah);
    const daftar = dipakai
      .map((x, i) => `${i + 1}. ${String(x.row[labelIdx])}: ${fmt(x.n)}`)
      .join("\n");
    const kata = arah === "terendah" ? "terendah" : "tertinggi";
    return {
      answered: true, intent, confidence: 0.85,
      text: `${jumlah} ${namaKolom} ${kata}:\n${daftar}\n${sumber} ${ekor}`,
    };
  }

  if (intent === "VALUE_OF") {
    if (labelIdx === null || !entitas) return tolak("entitas atau kolom label tidak ada", intent);
    const cari = entitas.toLowerCase();
    const cocok = visual.rows.filter((r) => String(r?.[labelIdx] ?? "").toLowerCase().includes(cari));
    if (cocok.length === 0) return tolak(`entitas "${entitas}" tidak ada di data`, intent);
    if (cocok.length > 1) return tolak(`entitas "${entitas}" cocok ke ${cocok.length} baris`, intent);
    const nilai = parseNumber(cocok[0][valueIdx]);
    if (!Number.isFinite(nilai)) return tolak("nilai baris tidak terbaca sebagai angka", intent);
    return {
      answered: true, intent, confidence: 0.85,
      text: `${namaKolom} untuk ${String(cocok[0][labelIdx])} adalah ${fmt(nilai)}. ${ekor}`,
    };
  }

  if (intent === "SHARE") {
    if (labelIdx === null || !entitas) return tolak("entitas atau kolom label tidak ada", intent);
    const cari = entitas.toLowerCase();
    const cocok = visual.rows.filter((r) => String(r?.[labelIdx] ?? "").toLowerCase().includes(cari));
    if (cocok.length !== 1) return tolak("entitas tidak cocok tepat satu baris", intent);
    const nilai = parseNumber(cocok[0][valueIdx]);
    if (!Number.isFinite(nilai) || !stats.total) return tolak("tidak bisa menghitung porsi", intent);
    const persen = (nilai / stats.total) * 100;
    return {
      answered: true, intent, confidence: 0.8,
      text: `${String(cocok[0][labelIdx])} menyumbang ${fmt(persen)} persen dari total ${namaKolom} (${fmt(nilai)} dari ${fmt(stats.total)}). ${ekor}`,
    };
  }

  return tolak("intent dikenali tapi belum ada perendernya", intent);
}

export { AMBANG as AMBANG_KEYAKINAN };

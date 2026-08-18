// ─────────────────────────────────────────────────────────────────────────────
// Turns the raw "data snapshot" captured from an embedded Power BI report into
// a compact, model-friendly text block, plus the system prompt that constrains
// the assistant to answer ONLY from that snapshot.
// ─────────────────────────────────────────────────────────────────────────────

import {
  detectNumericColumns, columnStats, groupTotals,
  pickRankColumn, pickGroupColumn, parseNumber,
} from "./tabular.js";

export const MAX_CONTEXT_CHARS = Number(process.env.AI_MAX_CONTEXT_CHARS ?? 120_000);
// Multi-page snapshots carry many more visuals than a single page, and the models
// in use have ~1M-token context, so the char budget is the real constraint here.
export const MAX_VISUALS = Number(process.env.AI_MAX_VISUALS ?? 80);
export const MAX_ROWS_PER_VISUAL = Number(process.env.AI_MAX_ROWS_PER_VISUAL ?? 800);

// ── Row budget governor ──────────────────────────────────────────────────────
// Measured 2026-08-01: a 20-visual × 500-row snapshot costs 76,233 prompt tokens.
// Sending top/bottom rows plus statistics computed over ALL rows answers the same
// questions for ~8% of that. See docs/CODE-AI-OPTIMIZATION-PLAN.md §4.
export const SUMMARY_THRESHOLD = Number(process.env.AI_ROW_SUMMARY_THRESHOLD ?? 25);
export const SUMMARY_TOP       = Number(process.env.AI_ROW_SUMMARY_TOP ?? 15);
export const SUMMARY_BOTTOM    = Number(process.env.AI_ROW_SUMMARY_BOTTOM ?? 5);
// Total sample rows across every summarized visual in one request
export const MAX_SAMPLE_ROWS   = Number(process.env.AI_MAX_SAMPLE_ROWS ?? 150);

// Char budget per request, per tier. ~1.5 chars/token on this data shape.
export const TIER_CHAR_BUDGET = {
  cepat:    Number(process.env.AI_BUDGET_CEPAT    ?? 8_000),
  standar:  Number(process.env.AI_BUDGET_STANDAR  ?? 18_000),
  mendalam: Number(process.env.AI_BUDGET_MENDALAM ?? 40_000),
};

const stripHtml = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// Power BI exports full float precision ("11.052631578947368"). Those trailing
// digits are noise: they cost tokens, they make the answer look unreadable when
// the model quotes them verbatim, and they are what an over-eager identifier
// pattern used to mistake for an ID number.
const DECIMALS = Number(process.env.AI_DECIMAL_PLACES ?? 3);

const roundLongDecimals = (s) =>
  s.replace(/(?<![\d.,])(\d+)([.,])(\d{5,})(?![\d.,])/g, (match, intPart, sep, frac) => {
    const n = Number(`${intPart}.${frac}`);
    if (!Number.isFinite(n)) return match;
    const rounded = n.toFixed(DECIMALS).replace(/\.?0+$/, "");
    return sep === "," ? rounded.replace(".", ",") : rounded;
  });

const cell = (v) => {
  if (v === null || v === undefined) return "";
  let s = String(v).replace(/\r?\n/g, " ").trim();
  s = roundLongDecimals(s);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
};

/**
 * Renders one large visual as top rows + bottom rows + statistics computed over
 * EVERY row, so totals and averages stay correct even though most rows are not
 * in the prompt.
 */
function summarizeVisualBlock(columns, rows, visual, budget = {}) {
  const out = [];
  const numericIdx = detectNumericColumns(columns, rows);
  const rankIdx = pickRankColumn(columns, rows, numericIdx);
  const totalRows = Number(visual.rowCount ?? rows.length);

  // Adaptive: with many visuals competing for the same budget, each gets fewer
  // sample rows. Statistics are unaffected — they always cover every row.
  const topN = Math.max(5, Math.round(SUMMARY_TOP * (budget.scale ?? 1)));
  const bottomN = Math.max(2, Math.round(SUMMARY_BOTTOM * (budget.scale ?? 1)));

  out.push(
    `(${totalRows} baris — ditampilkan ringkas: ${topN} teratas + ${bottomN} terbawah. ` +
    `STATISTIK DI BAWAH DIHITUNG DARI SELURUH ${rows.length} BARIS, jadi total/rata-rata sudah benar — ` +
    `JANGAN menjumlahkan sendiri baris yang ditampilkan untuk mendapatkan total.)`
  );

  const ordered = rankIdx >= 0
    ? [...rows].sort((a, b) => {
        const na = parseNumber(a?.[rankIdx]);
        const nb = parseNumber(b?.[rankIdx]);
        return (Number.isFinite(nb) ? nb : -Infinity) - (Number.isFinite(na) ? na : -Infinity);
      })
    : rows;

  const header = columns.join(" | ");
  const divider = columns.map(() => "---").join(" | ");
  const render = (r) => (Array.isArray(r) ? r : [r]).map(cell).join(" | ");

  out.push(rankIdx >= 0 ? `TOP ${topN} (urut "${columns[rankIdx]}" terbesar):` : `${topN} baris pertama:`);
  out.push(header);
  out.push(divider);
  ordered.slice(0, topN).forEach((r) => out.push(render(r)));

  if (ordered.length > topN + bottomN) {
    out.push(`BOTTOM ${bottomN}:`);
    ordered.slice(-bottomN).forEach((r) => out.push(render(r)));
  }

  if (numericIdx.length) {
    out.push(`STATISTIK KOLOM NUMERIK (dari seluruh ${rows.length} baris):`);
    for (const idx of numericIdx) {
      const s = columnStats(rows, idx);
      if (s) out.push(`  ${columns[idx]}: ${s.text}`);
    }
  }

  const groupIdx = pickGroupColumn(columns, rows, numericIdx);
  if (groupIdx >= 0 && rankIdx >= 0) {
    const dist = groupTotals(rows, groupIdx, rankIdx);
    if (dist) {
      out.push(`DISTRIBUSI "${columns[rankIdx]}" per "${columns[groupIdx]}" (${dist.groups} grup, seluruh baris):`);
      out.push(`  ${dist.text}`);
    }
  }

  // Summarizing loses no aggregate information — statistics cover every captured
  // row. But if the BROWSER could not capture every row, the data really is
  // incomplete and the user must be told.
  if (totalRows > rows.length) {
    out.push(
      `(CATATAN: data TIDAK LENGKAP — dashboard punya ~${totalRows} baris, ` +
      `hanya ${rows.length} yang berhasil ditarik browser. Statistik di atas hanya mencakup ${rows.length} baris itu.)`
    );
  }

  return out;
}

/**
 * @param {object} snapshot  Payload produced by frontend/src/utils/powerbiData.js
 * @param {object} dashboard { title, department, description }
 * @param {number} [charCap] per-tier budget (see TIER_CHAR_BUDGET)
 */
export function buildDataContext(snapshot, dashboard, charCap) {
  const lines = [];
  const stats = { visuals: 0, rows: 0, truncated: false, summarized: 0 };

  lines.push("=== DASHBOARD CONTEXT ===");
  lines.push(`Nama dashboard : ${dashboard?.title || "(unknown)"}`);
  if (dashboard?.department) lines.push(`Departemen     : ${dashboard.department}`);
  if (dashboard?.description) {
    lines.push(`Deskripsi      : ${stripHtml(dashboard.description)}`);
  }
  if (snapshot?.reportName) lines.push(`Report         : ${snapshot.reportName}`);
  if (snapshot?.pageName) lines.push(`Halaman yang dibuka user : ${snapshot.pageName}`);

  const pagesRead = Array.isArray(snapshot?.pagesRead) ? snapshot.pagesRead : [];
  const allPages = Array.isArray(snapshot?.pages) ? snapshot.pages : [];

  if (pagesRead.length) {
    lines.push(`Halaman yang datanya ADA di snapshot : ${pagesRead.join(" | ")}`);
    const notRead = allPages.filter((p) => !pagesRead.includes(p));
    if (notRead.length) {
      lines.push(
        `Halaman yang datanya TIDAK diambil  : ${notRead.join(" | ")} ` +
        `(jangan menjawab soal halaman ini — suruh user mencentang halaman tersebut di panel Ask AI lalu Refresh)`
      );
    }
  } else if (allPages.length) {
    lines.push(`Halaman report : ${allPages.join(" | ")}`);
  }

  if (Array.isArray(snapshot?.pageNotes) && snapshot.pageNotes.length) {
    snapshot.pageNotes.forEach((n) => lines.push(`Catatan halaman: ${cell(n)}`));
  }
  if (snapshot?.capturedAt) lines.push(`Snapshot diambil: ${snapshot.capturedAt}`);

  const filters = Array.isArray(snapshot?.filters) ? snapshot.filters.filter(Boolean) : [];
  const slicers = Array.isArray(snapshot?.slicers) ? snapshot.slicers.filter(Boolean) : [];

  lines.push("");
  lines.push("=== FILTER / SLICER YANG SEDANG AKTIF ===");
  if (!filters.length && !slicers.length) {
    lines.push("(tidak ada filter eksplisit yang terdeteksi — data adalah tampilan default dashboard)");
  } else {
    filters.forEach((f) => lines.push(`- Filter: ${cell(f)}`));
    slicers.forEach((s) => lines.push(`- Slicer: ${cell(s)}`));
  }

  lines.push("");
  lines.push("=== DATA DARI VISUAL DASHBOARD (angka asli yang tampil di layar) ===");

  const visuals = Array.isArray(snapshot?.visuals) ? snapshot.visuals : [];
  if (!visuals.length) {
    lines.push("(tidak ada data visual yang berhasil diambil)");
  }

  const hardCap = Math.min(MAX_CONTEXT_CHARS, charCap || MAX_CONTEXT_CHARS);
  let charBudget = hardCap - lines.join("\n").length;

  // Share the budget across the visuals that will need summarizing, so 20 large
  // visuals each get a smaller sample instead of the first few eating everything.
  const bigVisuals = visuals
    .slice(0, MAX_VISUALS)
    .filter((v) => !v.error && Array.isArray(v.rows) && v.rows.length > SUMMARY_THRESHOLD).length;

  const perVisualChars = bigVisuals > 0 ? charBudget / bigVisuals : charBudget;
  const byChars = Math.min(1, perVisualChars / ((SUMMARY_TOP + SUMMARY_BOTTOM) * 90 + 700));

  // Hard ceiling on sample rows for the whole request. Past a handful of large
  // visuals the model is served by statistics plus a few exemplars — more sample
  // rows cost tokens linearly while adding almost nothing. Statistics are never
  // affected: they always cover every row.
  const byRows = bigVisuals > 0
    ? Math.min(1, (MAX_SAMPLE_ROWS / bigVisuals) / (SUMMARY_TOP + SUMMARY_BOTTOM))
    : 1;

  const scale = Math.max(0.3, Math.min(byChars, byRows));

  for (const v of visuals.slice(0, MAX_VISUALS)) {
    const columns = Array.isArray(v.columns) ? v.columns.map(cell) : [];
    const rows = Array.isArray(v.rows) ? v.rows.slice(0, MAX_ROWS_PER_VISUAL) : [];

    const block = [];
    block.push("");
    block.push(`--- VISUAL: ${cell(v.title) || "(tanpa judul)"} [tipe: ${cell(v.type) || "unknown"}]${v.pageName ? ` (halaman: ${cell(v.pageName)})` : ""}`);

    if (v.error) {
      block.push(`(data visual ini tidak bisa diekstrak: ${cell(v.error)})`);
    } else if (!columns.length || !rows.length) {
      block.push("(visual ini tidak mengembalikan data)");
    } else if (rows.length > SUMMARY_THRESHOLD) {
      block.push(...summarizeVisualBlock(columns, rows, v, { scale }));
      stats.rows += rows.length;
      stats.summarized += 1;
      // "Summarized" is lossless for aggregates; "truncated" means rows never
      // reached us at all. Only the latter warrants the warning badge in the UI.
      if (Number(v.rowCount ?? rows.length) > rows.length || v.truncated) {
        stats.truncated = true;
      }
    } else {
      block.push(columns.join(" | "));
      block.push(columns.map(() => "---").join(" | "));
      for (const r of rows) {
        block.push((Array.isArray(r) ? r : [r]).map(cell).join(" | "));
      }
      const total = Number(v.rowCount ?? rows.length);
      if (total > rows.length || v.truncated) {
        block.push(
          `(CATATAN: hanya ${rows.length} baris pertama dari ~${total} baris yang disertakan — data tidak lengkap)`
        );
        stats.truncated = true;
      }
      stats.rows += rows.length;
    }

    const text = block.join("\n");
    if (text.length > charBudget) {
      lines.push("");
      lines.push(
        `(CATATAN: sisa visual dipotong karena batas ukuran konteks. ${stats.visuals} dari ${visuals.length} visual disertakan.)`
      );
      stats.truncated = true;
      break;
    }

    lines.push(text);
    charBudget -= text.length;
    stats.visuals += 1;
  }

  if (visuals.length > MAX_VISUALS && stats.visuals >= MAX_VISUALS) {
    lines.push("");
    lines.push(`(CATATAN: dashboard punya ${visuals.length} visual, hanya ${MAX_VISUALS} pertama disertakan.)`);
    stats.truncated = true;
  }

  return { text: lines.join("\n"), stats };
}

const SANITIZATION_NOTES = [
  "",
  "PENYAMARAN DATA (penting):",
  "- Beberapa nilai sudah disamarkan sebelum dikirim ke kamu. Token seperti `ORANG_a1b2` (nama orang), `MITRA_c3d4` (supplier/customer/vendor), dan `DOK_e5f6` (nomor dokumen) adalah PENGGANTI nilai asli.",
  "- Pakai token itu apa adanya dalam jawabanmu. JANGAN menebak nama aslinya, jangan bilang tokennya tidak valid, dan jangan minta user menyebutkan nama aslinya — sistem akan otomatis mengganti token itu kembali ke nama asli sebelum user membacanya.",
  "- Token yang sama = entitas yang sama. Token berbeda = entitas berbeda. Jadi kamu tetap bisa mengurutkan, mengelompokkan, dan membandingkan antar entitas.",
  "- Nilai `[EMAIL]`, `[TELP]`, `[NPWP]`, `[NO_ID]`, `[DISAMARKAN]` sengaja dihapus permanen dan tidak bisa dipulihkan — kalau pertanyaannya butuh itu, bilang datanya memang tidak dikirim demi kerahasiaan.",
  "- Kolom bertanda `(% dari total kolom)` sudah diubah jadi porsi relatif, bukan angka absolut. Bicaralah dalam persentase/porsi untuk kolom itu, jangan mengarang nilai rupiah absolutnya.",
].join("\n");

/**
 * Builds context for multiple dashboard snapshots (unified chat).
 * Each dashboard is clearly labeled so the model knows which data came from where.
 *
 * @param {Array} snapshots - [{ pagesRead, visuals, ... }]
 * @param {Array} dashboards - [{ id, title, department, description }]
 * @param {number} charCap - Total character budget for all dashboards combined
 * @returns {string}
 */
export function buildMultiDashboardContext(snapshots, dashboards, charCap = TIER_CHAR_BUDGET.standar) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return "=== MULTI-DASHBOARD CONTEXT ===\n(tidak ada dashboard yang diberikan)";
  }

  const lines = ["=== MULTI-DASHBOARD CONTEXT ===", ""];
  const perDashboardBudget = Math.floor(charCap / snapshots.length);

  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    const dashboard = dashboards[i];
    lines.push(`\n--------- DASHBOARD ${(i + 1)}: ${dashboard?.title || `Dashboard ${i + 1}`} ---------`);
    // .text, BUKAN objeknya. buildDataContext mengembalikan { text, stats };
    // menempelkan objeknya membuat SELURUH konteks jadi string "[object Object]",
    // jadi model tidak pernah menerima satu angka pun dan menjawab "data tidak
    // tersedia" untuk pertanyaan yang datanya jelas-jelas ada di snapshot.
    // Kegagalan diam: statusnya 200 dan jawabannya terdengar masuk akal.
    const { text: singleContext } = buildDataContext(snapshot, dashboard, perDashboardBudget);
    lines.push(singleContext);
    lines.push("");
  }

  return lines.join("\n");
}

export function buildSystemPrompt({ userName, userDept, dashboardTitle, knowledge, sanitized }) {
  const base = [
    "Kamu adalah \"CIA (Cimory Intelligence Assistant)\" — Principal Analytics Engineer / Power BI Semantic Analyst untuk PT. Cisarua Mountain Dairy (Cimory), CMD Plant Sentul.",
    `Kamu membantu ${userName || "seorang user"}${userDept ? ` (departemen ${userDept})` : ""} memahami dashboard Power BI berjudul \"${dashboardTitle || "(dashboard)"}\".`,
    "",
    "ATURAN WAJIB:",
    "1. Jawab HANYA berdasarkan DATA SNAPSHOT yang diberikan di pesan user. Snapshot itu adalah angka asli yang sedang tampil di dashboard.",
    "2. JANGAN mengarang angka, nama mesin, tanggal, atau kategori yang tidak ada di snapshot. Jangan pakai pengetahuan umum untuk menambal angka.",
    "3. Kalau informasi yang diminta tidak ada di snapshot, katakan terus terang bahwa datanya tidak tersedia di tampilan ini, lalu sarankan konkret apa yang perlu dilakukan user (buka halaman lain, ubah slicer/filter periode, atau buka visual tertentu).",
    "4. Kalau snapshot menandai data terpotong (truncated), sebutkan bahwa kesimpulan hanya berlaku untuk sebagian data yang terlihat.",
    "5. Selalu sadari konteks filter/slicer aktif. Kalau relevan, sebutkan periode/filter yang berlaku supaya angkanya tidak salah dibaca.",
    "6. Saat menghitung (total, rata-rata, delta, %, ranking), hitung dari baris-baris snapshot dan tunjukkan angka kuncinya. Pertahankan satuan dan skala apa adanya (jangan ubah jam ke menit, dsb, kecuali diminta).",
    "7. Balas dengan BAHASA YANG SAMA dengan pertanyaan user (Bahasa Indonesia untuk pertanyaan Indonesia).",
    "8. JANGAN mengarang nama tabel, measure, atau formula KPI yang tidak ada di DOMAIN KNOWLEDGE. Kalau istilah/KPI-nya tidak terkonfirmasi di sana, katakan belum terkonfirmasi — jangan menebak.",
    "9. Kalau KPI yang dipakai bertanda [Needs confirmation] atau [Blocked], sebutkan itu sebagai asumsi/ambiguitas di akhir jawaban, jangan diam-diam memilih satu versi.",
    "10. Hati-hati akronim yang bertabrakan (PM = Packaging Material vs Preventive Maintenance; DT = Downtime vs Digital Transformation) — tentukan artinya dari konteks dashboard ini, jangan pakai arti global.",
    "",
    "GAYA JAWABAN:",
    "- Ringkas dan langsung ke inti. Mulai dengan 1-2 kalimat jawaban utama (Ringkasan Temuan).",
    "- Pakai bullet untuk rincian angka, dan **bold** untuk angka penting.",
    "- Maksimal ~200 kata untuk pertanyaan sederhana. Untuk pertanyaan investigatif (kenapa/root cause/naik-turun), pakai struktur eksekutif: Ringkasan Temuan → Data Pendukung → Root Cause (sebutkan confidence High/Medium/Low + alasan satu baris) → Rekomendasi → Asumsi.",
    "- Kalau berguna, tutup dengan 1 baris insight atau saran tindakan operasional (contoh: mesin/kategori mana yang perlu diprioritaskan).",
    "- Jangan menampilkan ulang seluruh tabel; cukup angka yang relevan.",
  ].join("\n");

  const parts = [base];
  if (sanitized) parts.push(SANITIZATION_NOTES);
  if (knowledge) parts.push(knowledge);

  return parts.join("\n\n");
}

/**
 * Detects an answer that says "the data isn't in this snapshot".
 *
 * Used to offer the user a concrete next step (adjust filters / tick pages →
 * Refresh → ask again) instead of leaving them with a dead end. Deliberately
 * conservative: a false positive only adds a hint strip, a false negative just
 * means no hint, so neither breaks the answer.
 */
export function answerNeedsMoreData(answer, snapshot) {
  const text = String(answer || "");

  const saysMissing =
    /tidak (ada|tersedia|ditemukan|termuat)|belum (ada|tersedia|diambil|dimuat)|tidak (saya |kami )?(punya|memiliki|dapat menemukan)|di luar (data|snapshot|tampilan)|snapshot (ini|saat ini) tidak/i
      .test(text);
  if (!saysMissing) return null;

  const allPages = Array.isArray(snapshot?.pages) ? snapshot.pages : [];
  const readPages = Array.isArray(snapshot?.pagesRead) ? snapshot.pagesRead : [];
  const unreadPages = allPages.filter((p) => !readPages.includes(p));

  return {
    unreadPages,
    // Changing a slicer is the fix when every page was already read
    suggest: unreadPages.length ? "pages" : "filters",
  };
}

/**
 * @param {object} arg
 * @param {string} arg.dataContext    snapshot dashboard yang sedang dibuka
 * @param {string} arg.question
 * @param {string} [arg.konteksTemuan] blok temuan dari dashboard lain, boleh kosong
 */
export function buildUserMessage({ dataContext, question, konteksTemuan }) {
  const baris = [
    "DATA SNAPSHOT DASHBOARD:",
    "```",
    dataContext,
    "```",
  ];

  // Urutannya disengaja: snapshot dashboard sekarang lebih dulu supaya itu yang
  // jadi rujukan utama, temuan dashboard lain sebagai konteks tambahan, lalu
  // pertanyaan paling akhir supaya paling dekat dengan jawaban.
  const temuan = String(konteksTemuan || "").trim();
  if (temuan) baris.push("", temuan);

  baris.push("", "PERTANYAAN USER:", question);
  return baris.join("\n");
}
